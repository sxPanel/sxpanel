const modulename = 'FxPlayerlist';
import { ServerPlayer } from '@lib/player/playerClasses.js';
import { DatabaseActionWarnType, DatabasePlayerType } from '@modules/Database/databaseTypes';
import consoleFactory from '@lib/console';
import { now } from '@lib/misc';
import { PlayerDroppedEventType, PlayerJoiningEventType, PlayerlistPlayerType } from '@shared/socketioTypes';
import {
    computePlayerTags,
    getTagDefinitions,
    hasDiscordManagedTagMappings,
    refreshPlayerDiscordTags,
} from '@lib/player/playerTags';
import { emsg } from '@shared/emsg';
import { SYM_SYSTEM_AUTHOR } from '@lib/symbols';
import { PlayerlistEventSchema } from './playerlistEventSchemas';
const console = consoleFactory(modulename);

export type PlayerDropEvent = {
    type: 'txAdminPlayerlistEvent';
    event: 'playerDropped';
    id: number;
    reason: string; //need to check if this is always a string
    resource?: string;
    category?: number;
    sessionTimeSeconds?: number;
};

/**
 * Module that holds the server playerlist to mirrors FXServer's internal playerlist state, as well as recently
 * disconnected players' licenses for quick searches. This also handles the playerJoining and playerDropped events.
 *
 * NOTE: licenseCache will keep an array of ['mutex#id', license], to be used for searches from server log clicks.
 * The licenseCache will contain only the licenses from last 50k disconnected players, which should be one entire
 *  session for the q99.9 servers out there and weight around 4mb.
 * The idea is: all players with license will be in the database, so storing only license is enough to find them.
 *
 * NOTE: #playerlist keeps all players in this session, a heap snapshot revealed that an
 *  average player (no actions) will weight about 520 bytes, and the q9999 of max netid is ~22k,
 *  meaning that for 99.99 of the servers, the list will be under 11mb.
 * A list with 50k connected players will weight around 26mb, meaning no optimization is required there.
 */
export default class FxPlayerlist {
    #playerlist: (ServerPlayer | undefined)[] = [];
    licenseCache: [mutexid: string, license: string][] = [];
    licenseCacheLimit = 50_000; //mutex+id+license * 50_000 = ~4mb
    joinLeaveLog: [ts: number, isJoin: boolean][] = [];
    joinLeaveLogLimitTime = 30 * 60 * 1000; //30 mins, [ts+isJoin] * 100_000 = ~4.3mb
    #highestSeenNetid = 0;
    #rolloverCount = 0;
    #lastPlayerlistBroadcastJson: string | undefined;
    /** Last dispatched txaInitialData signature per netId, to skip redundant identical stdin writes. */
    #lastDispatchSignature: Map<number, string> = new Map();
    readonly #playtimeTickTimer: ReturnType<typeof setInterval>;

    constructor() {
        this.#playtimeTickTimer = setInterval(() => this.#tickConnectedPlaytime(), 60_000);
    }

    /** Single global playtime tick — replaces per-player setInterval timers. */
    #tickConnectedPlaytime() {
        const connected = this.getConnectedPlayers();
        if (!connected.length) return;

        txCore.database.beginWriteBatch();
        try {
            for (const player of connected) {
                if (player.isRegistered) {
                    player.tickPlaytimeMinute();
                }
            }
        } finally {
            txCore.database.endWriteBatch();
        }
    }

    get onlineCount() {
        return this.#playerlist.filter((p) => p && p.isConnected).length;
    }

    /**
     * Number of players that joined/left in the last hour.
     */
    get joinLeaveTally() {
        let toRemove = 0;
        const out = { joined: 0, left: 0 };
        const tsWindowStart = Date.now() - this.joinLeaveLogLimitTime;
        for (const [ts, isJoin] of this.joinLeaveLog) {
            if (ts > tsWindowStart) {
                out[isJoin ? 'joined' : 'left']++;
            } else {
                toRemove++;
            }
        }
        this.joinLeaveLog.splice(0, toRemove);
        return out;
    }

    /**
     * Handler for server restart - it will kill all players
     * We MUST do .disconnect() for all players to clear the timers.
     * NOTE: it's ok for us to overfill before slicing the licenseCache because it's at most ~4mb
     */
    handleServerClose(oldMutex: string) {
        for (const player of this.#playerlist) {
            if (player) {
                player.disconnect();
                if (player.license) {
                    this.licenseCache.push([player.psid, player.license]);
                }
            }
        }
        this.licenseCache = this.licenseCache.slice(-this.licenseCacheLimit);
        this.#playerlist = [];
        this.joinLeaveLog = [];
        this.#highestSeenNetid = 0;
        this.#rolloverCount = 0;
        this.#lastPlayerlistBroadcastJson = undefined;
        this.#lastDispatchSignature.clear();
        txCore.webServer.webSocket!.buffer('playerlist', {
            mutex: oldMutex,
            type: 'fullPlayerlist',
            playerlist: [],
        });
    }

    /**
     * To guarantee multiple instances of the same player license have their dbData synchronized,
     * this function (called by database.players.update) goes through every matching player
     * (except the source itself) to update their dbData.
     */
    handleDbDataSync(dbData: DatabasePlayerType, srcUniqueId: Symbol) {
        for (const player of this.#playerlist) {
            if (
                player instanceof ServerPlayer &&
                player.isRegistered &&
                player.license === dbData.license &&
                player.uniqueId !== srcUniqueId
            ) {
                player.syncUpstreamDbData(dbData);
            }
        }
    }

    /**
     * Returns all connected ServerPlayer instances.
     */
    getConnectedPlayers() {
        return this.#playerlist.filter(
            (player): player is ServerPlayer => player instanceof ServerPlayer && player.isConnected,
        );
    }

    /**
     * Returns connected players matching a Discord snowflake identifier.
     */
    getConnectedPlayersByDiscordId(discordId: string) {
        const normalized = discordId.trim();
        if (!normalized.length) return [] as ServerPlayer[];

        return this.getConnectedPlayers().filter((player) =>
            player.ids.some((identifier) => identifier === `discord:${normalized}`),
        );
    }

    /**
     * Returns a playerlist array with ServerPlayer data of all connected players.
     * The data is cloned to prevent pollution.
     */
    getPlayerList() {
        const currentTs = now();
        const fd3Players = this.#playerlist
            .filter((p) => p?.isConnected)
            .map((p) => {
                return {
                    netid: p!.netid,
                    displayName: p!.displayName,
                    pureName: p!.pureName,
                    ids: [...p!.ids],
                    license: p!.license,
                    playTimeMinutes: p!.dbData && typeof p!.dbData.playTime === 'number' ? p!.dbData.playTime : 0,
                    sessionTimeSeconds: Math.max(currentTs - p!.tsConnected, 0),
                    tags: computePlayerTags(p!),
                };
            });

        return fd3Players;
    }

    /**
     * Returns a specifc ServerPlayer or undefined.
     * NOTE: this returns the actual object and not a deep clone!
     */
    getPlayerById(netid: number) {
        return this.#playerlist[netid];
    }

    /**
     * Returns a specifc ServerPlayer or undefined.
     * NOTE: this returns the actual object and not a deep clone!
     */
    getOnlinePlayersByLicense(searchLicense: string) {
        return this.#playerlist.filter((p) => p && p.license === searchLicense && p.isConnected) as ServerPlayer[];
    }

    /**
     * Returns a set of all online players' licenses.
     */
    getOnlinePlayersLicenses() {
        return new Set(this.#playerlist.filter((p) => p && p.isConnected).map((p) => p!.license));
    }

    /**
     * Receives initial data callback from ServerPlayer and dispatches to the server as stdin.
     */
    dispatchInitialPlayerData(playerId: number, pendingWarn?: DatabaseActionWarnType) {
        const player = this.#playerlist[playerId];
        const tags = player ? computePlayerTags(player) : [];
        const cmdData: Record<string, any> = {
            netId: playerId,
            tags,
        };
        if (pendingWarn) {
            cmdData.pendingWarn = {
                author: pendingWarn.author,
                reason: pendingWarn.reason,
                actionId: pendingWarn.id,
                targetNetId: playerId,
                targetIds: pendingWarn.ids,
                targetName: pendingWarn.playerName,
            };
        }

        // Skip the stdin write if this exact payload (tags + pending warn) was already
        // dispatched for this netId - avoids duplicate txaInitialData commands, which
        // otherwise fire once on playerJoining and again once DB data finishes loading.
        const signature = JSON.stringify([tags, pendingWarn?.id ?? null]);
        if (this.#lastDispatchSignature.get(playerId) === signature) return;
        this.#lastDispatchSignature.set(playerId, signature);

        txCore.fxRunner.sendCommand('txaInitialData', [cmdData], SYM_SYSTEM_AUTHOR);
    }

    /** Panel websocket payload — omits volatile playtime/session fields the sidebar does not render. */
    #getWsPlayerlist(): PlayerlistPlayerType[] {
        return this.getPlayerList().map(({ netid, displayName, pureName, ids, license, tags }) => ({
            netid,
            displayName,
            pureName,
            ids,
            license,
            tags,
        }));
    }

    /** Push current playerlist + tag definitions to the panel websocket. */
    broadcastPlayerlistState() {
        const payload = {
            mutex: txCore.fxRunner.child?.mutex ?? null,
            type: 'fullPlayerlist' as const,
            playerlist: this.#getWsPlayerlist(),
            tagDefinitions: getTagDefinitions(),
        };
        const serialized = JSON.stringify(payload);
        if (serialized === this.#lastPlayerlistBroadcastJson) return;
        this.#lastPlayerlistBroadcastJson = serialized;
        txCore.webServer.webSocket?.buffer('playerlist', payload);
    }

    /** Recompute and push tags for every connected player (e.g. after tag config changes). */
    resyncAllPlayerTags() {
        for (const player of this.getConnectedPlayers()) {
            this.dispatchInitialPlayerData(player.netid);
        }
        this.broadcastPlayerlistState();
    }

    /**
     * Refreshes discord-managed tags from the Discord API when configured,
     * then recomputes and pushes tags for every connected player.
     */
    async resyncAllPlayerTagsAfterConfigChange() {
        if (hasDiscordManagedTagMappings()) {
            for (const player of this.getConnectedPlayers()) {
                if (!player.isRegistered) continue;
                await refreshPlayerDiscordTags(player);
            }
        }
        this.resyncAllPlayerTags();
    }

    /** Re-sync discord-managed tags for connected players, then refresh playerlist state. */
    async resyncDiscordManagedPlayerTags() {
        if (!hasDiscordManagedTagMappings()) {
            this.resyncAllPlayerTags();
            return;
        }

        for (const player of this.getConnectedPlayers()) {
            if (!player.isRegistered) continue;
            const changed = await refreshPlayerDiscordTags(player);
            if (changed) {
                this.dispatchInitialPlayerData(player.netid);
            }
        }
        this.broadcastPlayerlistState();
    }

    /** Push recomputed tags to the FXServer resource + panel websocket after tag edits. */
    syncPlayerTags(netid: number) {
        const player = this.#playerlist[netid];
        if (!(player instanceof ServerPlayer) || !player.isConnected) return;

        this.dispatchInitialPlayerData(netid);
        this.broadcastPlayerlistState();
    }

    /**
     * Handler for all txAdminPlayerlistEvent structured trace events
     */
    async handleServerEvents(payload: unknown, mutex: string) {
        const parsed = PlayerlistEventSchema.safeParse(payload);
        if (!parsed.success) {
            console.warn(`Invalid playerlist event: ${JSON.stringify(payload)}`);
            return;
        }
        const data = parsed.data;
        const currTs = Date.now();

        if (data.event === 'playerJoining') {
            try {
                if (this.#playerlist[data.id] !== undefined) throw new Error(`duplicated player id`);

                //Detect netid uint16 rollover
                if (this.#highestSeenNetid > 30000 && data.id < this.#highestSeenNetid - 30000) {
                    this.#rolloverCount++;
                    this.#highestSeenNetid = data.id;
                } else if (data.id > this.#highestSeenNetid) {
                    this.#highestSeenNetid = data.id;
                }

                const svPlayer = new ServerPlayer(data.id, data.player, this, mutex, this.#rolloverCount);
                this.#playerlist[data.id] = svPlayer;
                this.dispatchInitialPlayerData(data.id);
                this.joinLeaveLog.push([currTs, true]);
                txCore.logger.server.write(
                    [
                        {
                            type: 'playerJoining',
                            src: data.id,
                            ts: currTs,
                            data: { ids: this.#playerlist[data.id]!.ids },
                        },
                    ],
                    mutex,
                );
                txCore.webServer.webSocket.buffer<PlayerJoiningEventType>('playerlist', {
                    mutex,
                    type: 'playerJoining',
                    netid: svPlayer.netid,
                    displayName: svPlayer.displayName,
                    pureName: svPlayer.pureName,
                    ids: svPlayer.ids,
                    license: svPlayer.license,
                    tags: computePlayerTags(svPlayer),
                });
                txCore.addonManager?.broadcastEvent('playerJoining', {
                    netid: svPlayer.netid,
                    displayName: svPlayer.displayName,
                    license: svPlayer.license,
                    ids: svPlayer.ids,
                });
                if (hasDiscordManagedTagMappings() && svPlayer.isRegistered) {
                    refreshPlayerDiscordTags(svPlayer)
                        .then((changed) => {
                            if (changed) {
                                this.syncPlayerTags(svPlayer.netid);
                            }
                        })
                        .catch(() => {});
                }
            } catch (error) {
                console.verbose.warn(`playerJoining event error: ${emsg(error)}`);
            }
        } else if (data.event === 'playerDropped') {
            try {
                if (!(this.#playerlist[data.id] instanceof ServerPlayer)) throw new Error(`player id not found`);
                const player = this.#playerlist[data.id]!;
                const sessionTimeSeconds = Math.max(now() - player.tsConnected, 0);
                player.disconnect();
                this.joinLeaveLog.push([currTs, false]);
                const reasonCategory = txCore.metrics.playerDrop.handlePlayerDrop({
                    ...data,
                    sessionTimeSeconds,
                });
                if (reasonCategory !== false) {
                    txCore.logger.server.write(
                        [
                            {
                                type: 'playerDropped',
                                src: data.id,
                                ts: currTs,
                                data: { reason: data.reason },
                            },
                        ],
                        mutex,
                    );
                }
                txCore.webServer.webSocket.buffer<PlayerDroppedEventType>('playerlist', {
                    mutex,
                    type: 'playerDropped',
                    netid: player.netid,
                    reasonCategory: reasonCategory ? reasonCategory : undefined,
                });
                txCore.addonManager?.broadcastEvent('playerDropped', {
                    netid: player.netid,
                    reason: data.reason,
                });
                this.#playerlist[data.id] = undefined;
                this.#lastDispatchSignature.delete(data.id);
            } catch (error) {
                console.verbose.warn(`playerDropped event error: ${emsg(error)}`);
            }
        }
    }
}
