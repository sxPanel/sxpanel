const modulename = 'Player';
import cleanPlayerName from '@shared/cleanPlayerName';
import { DatabaseActionWarnType, DatabasePlayerType } from '@modules/Database/databaseTypes';
import { union } from 'lodash-es';
import { now } from '@lib/misc';
import { parsePlayerIds } from '@lib/player/idUtils';
import { buildPlayerSessionId } from '@lib/player/playerSessionId';
import consoleFactory from '@lib/console';
import consts from '@shared/consts';
import type FxPlayerlist from '@modules/FxPlayerlist';
const console = consoleFactory(modulename);

/**
 * Base class for ServerPlayer and DatabasePlayer.
 * NOTE: player classes are responsible to every and only business logic regarding the player object in the database.
 * In the future, when actions become part of the player object, also add them to these classes.
 */
export class BasePlayer {
    displayName: string = 'unknown';
    pureName: string = 'unknown';
    ids: string[] = [];
    hwids: string[] = [];
    license: null | string = null; //extracted for convenience
    dbData: false | DatabasePlayerType = false;
    isConnected: boolean = false;

    constructor(readonly uniqueId: Symbol) {}

    /**
     * Mutates the database data based on a source object to be applied
     * FIXME: if this is called for a disconnected ServerPlayer, it will not clean after 120s
     */
    protected mutateDbData(srcData: object) {
        if (!this.license) throw new Error(`cannot mutate database for a player that has no license`);
        this.dbData = txCore.database.players.update(this.license, srcData, this.uniqueId);
    }

    /**
     * Returns all available identifiers (current+db)
     */
    getAllIdentifiers() {
        if (this.dbData && this.dbData.ids) {
            return union(this.ids, this.dbData.ids);
        } else {
            return [...this.ids];
        }
    }

    /**
     * Returns all available hardware identifiers (current+db)
     */
    getAllHardwareIdentifiers() {
        if (this.dbData && this.dbData.hwids) {
            return union(this.hwids, this.dbData.hwids);
        } else {
            return [...this.hwids];
        }
    }

    /**
     * Returns all actions related to all available ids
     * NOTE: theoretically ServerPlayer.setupDatabaseData() guarantees that DatabasePlayer.dbData.ids array
     *  will contain the license but may be better to also explicitly add it to the array here?
     */
    getHistory() {
        if (!this.ids.length) return [];
        return txCore.database.actions.findMany(this.getAllIdentifiers(), this.getAllHardwareIdentifiers());
    }

    /**
     * Saves notes for this player.
     * NOTE: Techinically, we should be checking this.isRegistered, but not available in BasePlayer
     */
    setNote(text: string, author: string) {
        if (!this.license) throw new Error(`cannot save notes for a player that has no license`);
        this.mutateDbData({
            notes: {
                text,
                lastAdmin: author,
                tsLastEdit: now(),
            },
        });
    }

    /**
     * Saves the whitelist status for this player
     * NOTE: Techinically, we should be checking this.isRegistered, but not available in BasePlayer
     */
    setWhitelist(enabled: boolean) {
        if (!this.license) throw new Error(`cannot set whitelist status for a player that has no license`);
        const ts = now();
        const identifier = `license:${this.license}`;

        this.mutateDbData({ tsWhitelisted: undefined });

        if (enabled) {
            const existing = txCore.database.whitelist.findEntryByIdentifier(identifier);
            if (existing) {
                if (typeof existing.tsFirstConnect !== 'number') {
                    txCore.database.whitelist.consumeEntry(identifier, ts);
                }
            } else {
                txCore.database.whitelist.registerEntry({
                    identifier,
                    tsGranted: ts,
                    grantedBy: 'panel',
                    source: 'manual',
                    playerName: this.displayName,
                    playerAvatar: null,
                    license: this.license,
                    tsFirstConnect: ts,
                });
            }
            txCore.database.whitelist.removeManyApplications({ license: this.license, status: 'pending' });
            const allIdsFilter = (entry) => this.getAllIdentifiers().includes(entry.identifier);
            txCore.database.whitelist.removeManyEntries(
                (entry) => allIdsFilter(entry) && typeof entry.tsFirstConnect !== 'number',
            );
        } else {
            txCore.database.whitelist.removeManyEntries({ license: this.license });
            txCore.database.whitelist.removeManyEntries({ identifier });
            txCore.database.whitelist.removeManyApplications({ license: this.license });
        }
    }

    /**
     * Adds or removes a custom tag for this player
     */
    setCustomTag(tagId: string, enabled: boolean) {
        if (!this.license) throw new Error(`cannot set custom tag for a player that has no license`);
        const dbData = this.getDbData();
        const current = dbData ? (dbData.customTags ?? []) : [];
        let updated: string[];
        if (enabled) {
            updated = current.includes(tagId) ? current : [...current, tagId];
        } else {
            updated = current.filter((t: string) => t !== tagId);
        }
        this.mutateDbData({ customTags: updated });
    }
}

type PlayerDataType = {
    name: string;
    ids: string[];
    hwids: string[];
};

/**
 * Class to represent a player that is or was connected to the currently running server process.
 */
export class ServerPlayer extends BasePlayer {
    readonly #fxPlayerlist: FxPlayerlist;
    readonly psid: string;
    readonly netid: number;
    readonly tsConnected = now();
    readonly isRegistered: boolean;
    // #offlineDbDataCacheTimeout?: ReturnType<typeof setTimeout>;

    constructor(
        netid: number,
        playerData: PlayerDataType,
        fxPlayerlist: FxPlayerlist,
        mutex: string,
        rollover: number,
    ) {
        super(Symbol(`netid${netid}`));
        this.#fxPlayerlist = fxPlayerlist;
        this.netid = netid;
        this.psid = buildPlayerSessionId(mutex, netid, rollover);
        this.isConnected = true;
        if (
            playerData === null ||
            typeof playerData !== 'object' ||
            typeof playerData.name !== 'string' ||
            !Array.isArray(playerData.ids) ||
            !Array.isArray(playerData.hwids)
        ) {
            throw new Error(`invalid player data`);
        }

        //Processing identifiers
        //NOTE: ignoring IP completely
        const { validIdsArray, validIdsObject } = parsePlayerIds(playerData.ids);
        this.license = validIdsObject.license;
        this.ids = validIdsArray.map((id) => id.toLowerCase());
        this.hwids = playerData.hwids.filter((x) => {
            return typeof x === 'string' && consts.regexValidHwidToken.test(x);
        });

        //Processing player name
        const { displayName, pureName } = cleanPlayerName(playerData.name);
        this.displayName = displayName;
        this.pureName = pureName;

        //If this player is eligible to be on the database
        if (this.license) {
            this.#setupDatabaseData();
            this.isRegistered = !!this.dbData;
        } else {
            this.isRegistered = false;
        }
    }

    /**
     * Registers or retrieves the player data from the database.
     * NOTE: if player has license, we are guaranteeing license will be added to the database ids array
     */
    #setupDatabaseData() {
        if (!this.license || !this.isConnected) return;

        //Make sure the database is ready - this should be impossible
        if (!txCore.database.isReady) {
            console.error(`Players database not yet ready, cannot read db status for player id ${this.displayName}.`);
            return;
        }

        //Check if player is already on the database
        try {
            const dbPlayer = txCore.database.players.findOne(this.license);
            if (dbPlayer) {
                //Updates database data
                this.dbData = dbPlayer;

                //Update name history if the current name is new
                const nameHistory = dbPlayer.nameHistory ?? [dbPlayer.displayName];
                if (!nameHistory.includes(this.displayName)) {
                    nameHistory.push(this.displayName);
                }

                this.mutateDbData({
                    displayName: this.displayName,
                    pureName: this.pureName,
                    tsLastConnection: this.tsConnected,
                    ids: union(dbPlayer.ids, this.ids),
                    hwids: union(dbPlayer.hwids, this.hwids),
                    nameHistory,
                });
            } else {
                //Register player to the database
                const toRegister: DatabasePlayerType = {
                    license: this.license,
                    ids: this.ids,
                    hwids: this.hwids,
                    displayName: this.displayName,
                    pureName: this.pureName,
                    playTime: 0,
                    tsLastConnection: this.tsConnected,
                    tsJoined: this.tsConnected,
                    nameHistory: [this.displayName],
                };
                txCore.database.players.register(toRegister);
                this.dbData = toRegister;
                console.verbose.ok(`Adding '${this.displayName}' to players database.`);
            }
            setImmediate(this.#sendInitialData.bind(this));
        } catch (error) {
            console.error(`Failed to load/register player ${this.displayName} from/to the database with error:`);
            console.dir(error);
        }
    }

    /**
     * Prepares the initial player data and reports to FxPlayerlist, which will dispatch to the server via command.
     */
    #sendInitialData() {
        if (!this.isConnected) return;

        let oldestPendingWarn: undefined | DatabaseActionWarnType;
        if (this.isRegistered && this.dbData) {
            const actionHistory = this.getHistory();
            for (const action of actionHistory) {
                if (action.type !== 'warn' || action.revocation) continue;
                if (!action.acked) {
                    oldestPendingWarn = action;
                    break;
                }
            }
        }

        this.#fxPlayerlist.dispatchInitialPlayerData(this.netid, oldestPendingWarn);
    }

    /**
     * Applies a mid-session rename (SET_PLAYER_NAME native) to this player and the database.
     * Returns false if the cleaned name did not change.
     */
    updateName(rawName: string) {
        const { displayName, pureName } = cleanPlayerName(rawName);
        if (displayName === this.displayName && pureName === this.pureName) return false;
        this.displayName = displayName;
        this.pureName = pureName;

        if (this.isConnected && this.isRegistered && this.license) {
            try {
                const dbData = this.getDbData();
                if (dbData) {
                    const nameHistory = dbData.nameHistory ?? [dbData.displayName];
                    if (!nameHistory.includes(displayName)) {
                        nameHistory.push(displayName);
                    }
                    this.mutateDbData({ displayName, pureName, nameHistory });
                }
            } catch (error) {
                console.error(`Failed to save the new name of player ${displayName} to the database with error:`);
                console.dir(error);
            }
        }
        return true;
    }

    /**
     * Sets the dbData.
     * Used when some other player instance mutates the database and we need to sync all players
     * with the same license.
     */
    syncUpstreamDbData(srcData: DatabasePlayerType) {
        this.dbData = structuredClone(srcData);
    }

    /**
     * Returns a clone of this.dbData.
     * If the data is not available, it means the player was disconnected and dbData wiped to save memory,
     * so start an 120s interval to wipe it from memory again. This period can be considered a "cache"
     * FIXME: review dbData optimization, 50k players would be up to 50mb
     */
    getDbData() {
        if (this.dbData) {
            return structuredClone(this.dbData);
        } else if (this.license && this.isRegistered) {
            const dbPlayer = txCore.database.players.findOne(this.license);
            if (!dbPlayer) return false;

            this.dbData = dbPlayer;
            // clearTimeout(this.#offlineDbDataCacheTimeout); //maybe not needed?
            // this.#offlineDbDataCacheTimeout = setTimeout(() => {
            //     this.dbData = false;
            // }, 120_000);
            return structuredClone(this.dbData);
        } else {
            return false;
        }
    }

    /**
     * Updates dbData play time every minute and tracks per-hour session history.
     * Called from FxPlayerlist global playtime tick.
     */
    tickPlaytimeMinute() {
        if (!this.dbData || !this.isConnected) return;
        try {
            const today = new Date();
            const currHour = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}T${String(today.getUTCHours()).padStart(2, '0')}`;
            const sessionHistory = this.dbData.sessionHistory ?? [];

            if (sessionHistory.length && sessionHistory.at(-1)![0] === currHour) {
                sessionHistory.at(-1)![1]++;
            } else {
                //Trim entries older than 120 days
                const cutoffTs =
                    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) -
                    120 * 24 * 60 * 60 * 1000;
                const trimmedHistory = sessionHistory.filter(([key]) => {
                    const day = key.includes('T') ? key.split('T')[0] : key;
                    return new Date(day).getTime() >= cutoffTs;
                });
                trimmedHistory.push([currHour, 1]);
                sessionHistory.length = 0;
                sessionHistory.push(...trimmedHistory);
            }

            this.mutateDbData({
                playTime: this.dbData.playTime + 1,
                sessionHistory,
            });
        } catch (error) {
            console.warn(`Failed to update playtime for player ${this.displayName}:`);
            console.dir(error);
        }
    }

    /**
     * Marks this player as disconnected and clears dbData (mem optimization).
     */
    disconnect() {
        this.isConnected = false;
        this.dbData = false;
    }
}

/**
 * Class to represent players stored in the database.
 */
export class DatabasePlayer extends BasePlayer {
    readonly isRegistered = true; //no need to check because otherwise constructor throws

    constructor(license: string, srcPlayerData?: DatabasePlayerType) {
        super(Symbol(`db${license}`));
        if (typeof license !== 'string') {
            throw new Error(`invalid player license`);
        }

        //Set dbData either from constructor params, or from querying the database
        if (srcPlayerData) {
            this.dbData = srcPlayerData;
        } else {
            const foundData = txCore.database.players.findOne(license);
            if (!foundData) {
                throw new Error(`player not found in database`);
            } else {
                this.dbData = foundData;
            }
        }

        //fill in data
        this.license = license;
        this.ids = this.dbData.ids;
        this.hwids = this.dbData.hwids;
        this.displayName = this.dbData.displayName;
        this.pureName = this.dbData.pureName;
    }

    /**
     * Returns a clone of this.dbData
     */
    getDbData() {
        return structuredClone(this.dbData);
    }
}

export type PlayerClass = ServerPlayer | DatabasePlayer;
