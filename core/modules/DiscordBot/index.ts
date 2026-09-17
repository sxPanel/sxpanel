const modulename = 'DiscordBot';
import { randomUUID } from 'node:crypto';
import { UpdateConfigKeySet } from '@modules/ConfigStore/utils';
import consoleFactory from '@lib/console';
import { broadcastTicketAddonEvent } from '@lib/addonEvents';
import { DiscordBotStatus } from '@shared/enums';
import type { DiscordGuildRoleOption } from '@shared/discordGuildRoles';
import type { SystemLogEntry } from '@shared/systemLogTypes';
import type { DatabaseTicketType } from '@shared/ticketApiTypes';
import {
    formatFxChildNodeResolutionDiagnostics,
    getFxChildNodeRuntimeResolution,
    isHostProcessExecPathNodeLike,
} from '@lib/resolveFxChildNode';
import BotProcess from './botProcess';
import BridgeServer, { BridgeMessage } from './bridgeServer';
import { getDisplayPlayerCount } from '@lib/fxserver/httpHealthCheck';
import { buildTicketSummaryMessagePayload } from './ticketCommandUtils';
import {
    buildServerMenuDiscordPayload,
    buildSystemLogDiscordPayload,
    type DiscordLogMessagePayload,
} from './logRouting';
import { handleModerationCommand } from './moderationCommands';
import { getActiveWorkflow } from '@modules/Whitelist/WhitelistService';
import { getDiscordLocaleSnapshot } from './discordLocale';
import {
    buildReply,
    buildSuccessResponse,
    commandFooter,
    infoEmbedColor,
    logDiscordAdminAction,
    normalizeBotCommandEvent,
    withTelemetry,
    type BridgeCommandResponse,
} from './bridgeReplyHelpers';
import { handleAddonRouteRequest, resolveAdminPermission } from './bridgePermissions';
import { buildPlayerLookupReply } from './playerLookupCommand';
import { handleWhitelistCommand, handleWhitelistReviewReaction } from './whitelistCommandHandlers';
import {
    handleSxTicketsResolveReporterDiscord,
    handleTicketCommand,
    handleTicketThreadMessage,
} from './ticketCommandHandlers';
import {
    buildPersistentEmbedMessagePayload,
    getPersistentEmbedState,
    handlePersistentEmbedCommand,
    handlePersistentEmbedPageRequest,
    persistentEmbedMeta,
} from './persistentEmbedCommandHandlers';
import { handleAdminDiscordRoleChange } from './adminRoleSync';

const console = consoleFactory(modulename);

type MessageTranslationType = {
    key: string;
    data?: object;
};

type AnnouncementType = {
    title?: string | MessageTranslationType;
    description: string | MessageTranslationType;
    type: 'info' | 'success' | 'warning' | 'danger';
};

type SpawnConfig = Pick<TxConfigs['discordBot'], 'enabled' | 'token' | 'guild' | 'warningsChannel'>;

type PendingStart = {
    resolve: (message: string) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
};

type DiscordBotAddonLoadFailure = {
    kind: 'command' | 'event';
    filePath: string;
    message: string;
    addonId: string | null;
    updatedAt: number;
};

type DiscordBotAddonRuntimeIssue = {
    addonId: string;
    interactionType: string;
    phase: 'execute' | 'rate_limit';
    handlerId: string;
    message: string;
    filePath: string | null;
    updatedAt: number;
    count: number;
};

type DiscordBotRecoverySource = 'manual' | 'automatic';

type DiscordBotRecoveryAction = {
    action: 'restartRuntime' | 'reloadAddons' | 'resyncRuntime';
    source: DiscordBotRecoverySource;
    ok: boolean;
    message: string;
    at: number;
};

const BRIDGE_AUTO_HEAL_DELAY_MS = 30_000;

/**
 * Module that handles the discord bot bridge, provides methods to resolve members and send announcements,
 * as well as the standalone bot process lifecycle.
 */
export default class DiscordBot {
    static readonly configKeysWatched = [
        'discordBot.embedJson',
        'discordBot.embedConfigJson',
        'discordBot.playerListEmbedJson',
        'discordBot.playerListEmbedConfigJson',
        'discordBot.presence',
        'discordBot.customCommands',
        'discordBot.rolePermissions',
        'discordBot.logRoutes',
        'gameFeatures.reportsEnabled',
    ];

    readonly cooldowns = new Map();
    readonly #botProcess: BotProcess;
    #bridgeServer: BridgeServer | undefined;
    #bridgeRuntimeConfig: { port: number; secret: string } | undefined;
    #pendingStart: PendingStart | undefined;
    #closingBridge = false;
    #ignoreNextBridgeDisconnect = false;
    #runtimeBridgeSecret: string | undefined;
    #lastGuildMembersCacheRefresh = 0;
    #lastStatus = DiscordBotStatus.Disabled;
    #lastExplicitStatus = DiscordBotStatus.Disabled;
    #activeBotConfig: SpawnConfig | false | undefined;
    #lastReadyAt: number | undefined;
    #lastBridgeAuthenticatedAt: number | undefined;
    #lastBridgeDisconnectedAt: number | undefined;
    #bridgeDisconnectedSince: number | undefined;
    #bridgeConnectCount = 0;
    #bridgeDisconnectCount = 0;
    #lastReconnectDurationMs: number | undefined;
    #bridgeAutoHealAt: number | undefined;
    #bridgeAutoHealTimer: NodeJS.Timeout | undefined;
    #lastBotError:
        | {
              code: string | null;
              message: string;
              at: number;
          }
        | undefined;
    #lastProcessFailure:
        | {
              reason: string;
              at: number;
          }
        | undefined;
    #lastRecoveryAction: DiscordBotRecoveryAction | undefined;
    #runtimeDiagnostics: {
        addonLoadFailures: DiscordBotAddonLoadFailure[];
        addonRuntimeIssues: DiscordBotAddonRuntimeIssue[];
        updatedAt: number | undefined;
    } = {
        addonLoadFailures: [],
        addonRuntimeIssues: [],
        updatedAt: undefined,
    };
    guildName: string | undefined;

    constructor() {
        this.#botProcess = new BotProcess({
            onError: ({ reason }) => {
                this.#handleBotProcessFailure(reason);
            },
            onExit: ({ reason }) => {
                this.#handleBotProcessFailure(reason);
            },
        });

        //NOTE: the preflight may trigger a sync fs scan for the child Node runtime,
        //so it must stay off the boot-critical path and only run if the bot will start.
        setImmediate(() => {
            if (txConfig.discordBot.enabled) {
                this.#logNodeRuntimePreflight();
                this.startBot().catch((error) => {
                    console.error(`Initial Discord bot startup failed: ${emsg(error)}`);
                });
            }
        });

        setInterval(() => {
            if (this.#isBotEnabled()) {
                this.updateBotStatus().catch(() => {});
                this.#syncDiscordLinkedAdminAuths().catch(() => {});
            }
        }, 60_000);
        setInterval(() => {
            this.refreshWsStatus();
        }, 7500);
    }

    public handleConfigUpdate(updatedConfigs: UpdateConfigKeySet) {
        if (!this.#isBotEnabled()) return false;

        const shouldReloadCommands = updatedConfigs.hasMatch('discordBot.customCommands');
        const shouldReloadReportsCommands = updatedConfigs.hasMatch('gameFeatures.reportsEnabled');
        const shouldRefreshAdminAuths = updatedConfigs.hasMatch('discordBot.rolePermissions');
        if (updatedConfigs.hasMatch(['discordBot.guild', 'discordBot.enabled'])) {
            this.#guildRolesCache = null;
        }

        if (this.#bridgeServer?.isReady && (shouldReloadCommands || shouldReloadReportsCommands)) {
            if (shouldReloadReportsCommands) {
                this.#bridgeServer.send({ type: 'configSnapshot', payload: this.#buildConfigSnapshot() });
            }
            this.#bridgeServer.send({ type: 'reloadCommands' });
        }
        if (shouldRefreshAdminAuths) {
            txCore.webServer.webSocket.reCheckAdminAuths().catch(() => {});
        }

        return this.updateBotStatus();
    }

    public handleAddonReload() {
        if (!this.#bridgeServer?.isReady) return false;

        this.#bridgeServer.send({ type: 'configSnapshot', payload: this.#buildConfigSnapshot() });
        this.#bridgeServer.send({ type: 'reloadCommands' });
        return true;
    }

    public handleShutdown() {
        this.#rejectPendingStart(new Error('Discord bot shutdown.'));
        this.#clearBridgeAutoHealTimer();
        void this.#stopRuntime();
    }

    async attemptBotReset(botCfg: SpawnConfig | false) {
        this.#lastGuildMembersCacheRefresh = 0;
        this.#activeBotConfig = botCfg;
        this.#rejectPendingStart(new Error('Discord bot restart superseded.'));

        if (!botCfg || !botCfg.enabled) {
            this.#clearBridgeAutoHealTimer();
            await this.#stopRuntime();
            this.guildName = undefined;
            this.#lastExplicitStatus = DiscordBotStatus.Disabled;
            this.refreshWsStatus();
            return true;
        }

        return await this.startBot(botCfg);
    }

    get isClientReady() {
        return this.#bridgeServer?.isReady === true && this.#lastExplicitStatus === DiscordBotStatus.Ready;
    }

    get status(): DiscordBotStatus {
        if (!this.#isBotEnabled()) {
            return DiscordBotStatus.Disabled;
        }

        if (this.isClientReady) {
            return DiscordBotStatus.Ready;
        }

        return this.#lastExplicitStatus;
    }

    #buildNodeRuntimeDiagnostics() {
        if (isHostProcessExecPathNodeLike()) {
            return {
                hostExecPath: process.execPath,
                resolved: true,
                resolvedChildLabel: process.execPath,
                resolvedViaMuslLoader: false,
                candidateCount: 0,
                candidateSample: [] as string[],
                cfxRoot: null as string | null,
                suggestedBotNodePath: null as string | null,
            };
        }

        const resolution = getFxChildNodeRuntimeResolution();
        return {
            hostExecPath: resolution.hostExecPath,
            resolved: Boolean(resolution.childExecPath),
            resolvedChildLabel: resolution.resolvedChildLabel ?? resolution.childExecPath ?? null,
            resolvedViaMuslLoader: resolution.resolvedViaMuslLoader,
            candidateCount: resolution.candidateCount,
            candidateSample: resolution.candidateSample,
            cfxRoot: resolution.cfxRoot ?? null,
            suggestedBotNodePath: resolution.suggestedBotNodePath ?? null,
        };
    }

    #logNodeRuntimePreflight() {
        if (isHostProcessExecPathNodeLike()) {
            console.ok('Discord bot child runtime: using host Node process (process.execPath).');
            return;
        }

        const resolution = getFxChildNodeRuntimeResolution();
        const diagnostics = formatFxChildNodeResolutionDiagnostics(resolution);
        if (resolution.childExecPath) {
            console.ok(`Discord bot child runtime: ${diagnostics}`);
            return;
        }

        console.warn(`Discord bot child runtime: ${diagnostics}`);
    }

    getDiagnostics() {
        const currentTs = Date.now();

        return {
            enabled: this.#isBotEnabled(),
            status: this.status,
            isClientReady: this.isClientReady,
            guildName: this.guildName ?? null,
            lastReadyAt: this.#lastReadyAt ?? null,
            lastBotError: this.#lastBotError ?? null,
            lastProcessFailure: this.#lastProcessFailure ?? null,
            lastRecoveryAction: this.#lastRecoveryAction ?? null,
            bridge: {
                isConnected: this.#bridgeServer?.isReady === true,
                connectCount: this.#bridgeConnectCount,
                disconnectCount: this.#bridgeDisconnectCount,
                lastAuthenticatedAt: this.#lastBridgeAuthenticatedAt ?? null,
                lastDisconnectedAt: this.#lastBridgeDisconnectedAt ?? null,
                disconnectedForMs: this.#bridgeDisconnectedSince ? currentTs - this.#bridgeDisconnectedSince : null,
                lastReconnectDurationMs: this.#lastReconnectDurationMs ?? null,
                autoHealAt: this.#bridgeAutoHealAt ?? null,
            },
            process: {
                isRunning: this.#botProcess.isRunning,
                hasPendingRestart: this.#botProcess.hasPendingRestart,
                nextRestartDelayMs: this.#botProcess.nextRestartDelayMs,
                lastOutputLine: this.#botProcess.lastOutputLine ?? null,
                lastErrorLine: this.#botProcess.lastErrorLine ?? null,
            },
            runtime: {
                addonLoadFailures: this.#runtimeDiagnostics.addonLoadFailures,
                addonRuntimeIssues: this.#runtimeDiagnostics.addonRuntimeIssues,
                updatedAt: this.#runtimeDiagnostics.updatedAt ?? null,
            },
            nodeRuntime: this.#buildNodeRuntimeDiagnostics(),
        };
    }

    async restartRuntime(source: DiscordBotRecoverySource = 'manual') {
        const botCfg = this.#getCurrentSpawnConfig();
        if (!botCfg?.enabled) {
            const error = new Error('Discord bot is disabled.');
            this.#recordRecoveryAction('restartRuntime', source, false, error.message);
            throw error;
        }

        try {
            const result = await this.attemptBotReset(botCfg);
            const message = typeof result === 'string' ? result : 'Discord bot restart requested.';
            this.#recordRecoveryAction('restartRuntime', source, true, message);
            return message;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.#recordRecoveryAction('restartRuntime', source, false, message);
            throw error;
        }
    }

    async reloadRuntimeAddons(source: DiscordBotRecoverySource = 'manual') {
        if (!this.handleAddonReload()) {
            const error = new Error('Discord bridge is not connected.');
            this.#recordRecoveryAction('reloadAddons', source, false, error.message);
            throw error;
        }

        const message = 'Discord bot addon commands and events reload requested.';
        this.#recordRecoveryAction('reloadAddons', source, true, message);
        return message;
    }

    async resyncRuntime(source: DiscordBotRecoverySource = 'manual') {
        const updated = await this.updateBotStatus();
        if (!updated) {
            const error = new Error('Discord bridge is not connected.');
            this.#recordRecoveryAction('resyncRuntime', source, false, error.message);
            throw error;
        }

        const message = 'Discord bot config snapshot, presence, and embeds were resynced.';
        this.#recordRecoveryAction('resyncRuntime', source, true, message);
        return message;
    }

    applyRuntimeDiagnostics(payload: {
        addonLoadFailures?: DiscordBotAddonLoadFailure[];
        addonRuntimeIssues?: DiscordBotAddonRuntimeIssue[];
        updatedAt?: number;
    }) {
        if (Array.isArray(payload.addonLoadFailures)) {
            this.#runtimeDiagnostics.addonLoadFailures = payload.addonLoadFailures.map((entry) => ({
                kind: entry.kind === 'event' ? 'event' : 'command',
                filePath: String(entry.filePath ?? ''),
                message: String(entry.message ?? ''),
                addonId: typeof entry.addonId === 'string' && entry.addonId.length ? entry.addonId : null,
                updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : Date.now(),
            }));
        }

        if (Array.isArray(payload.addonRuntimeIssues)) {
            this.#runtimeDiagnostics.addonRuntimeIssues = payload.addonRuntimeIssues.map((entry) => ({
                addonId: String(entry.addonId ?? ''),
                interactionType: String(entry.interactionType ?? ''),
                phase: entry.phase === 'rate_limit' ? 'rate_limit' : 'execute',
                handlerId: String(entry.handlerId ?? ''),
                message: String(entry.message ?? ''),
                filePath: typeof entry.filePath === 'string' && entry.filePath.length ? entry.filePath : null,
                updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : Date.now(),
                count: typeof entry.count === 'number' && entry.count > 0 ? entry.count : 1,
            }));
        }

        this.#runtimeDiagnostics.updatedAt = typeof payload.updatedAt === 'number' ? payload.updatedAt : Date.now();
    }

    refreshWsStatus() {
        if (this.#lastStatus !== this.status) {
            this.#lastStatus = this.status;
            txCore.webServer.webSocket.pushRefresh('status');
        }
    }

    async sendAnnouncement(content: AnnouncementType) {
        if (!this.#isBotEnabled()) return;
        if (!this.#bridgeServer?.isReady) {
            console.verbose.warn('not ready yet to send announcement');
            return false;
        }

        try {
            this.#bridgeServer.send({
                type: 'sendAnnouncement',
                title: this.#translate(content.title),
                description: this.#translate(content.description),
                announcementType: content.type,
            });
            return true;
        } catch (error) {
            console.error(`Error sending Discord announcement: ${emsg(error)}`);
            return false;
        }
    }

    async postLogMessage(payload: DiscordLogMessagePayload) {
        if (!this.#isBotEnabled()) return false;
        if (!this.#bridgeServer?.isReady) return false;

        const channelId = typeof payload.channelId === 'string' ? payload.channelId.trim() : '';
        if (!channelId.length || !Array.isArray(payload.components) || payload.components.length === 0) {
            return false;
        }

        this.#bridgeServer.send({
            type: 'postLogMessage',
            payload: {
                channelId,
                guildId:
                    typeof payload.guildId === 'string' && payload.guildId.length
                        ? payload.guildId
                        : (txConfig.discordBot.logGuildOverride ?? txConfig.discordBot.guild ?? null),
                flags: payload.flags,
                components: payload.components,
                allowedMentions: payload.allowedMentions,
            },
        });
        return true;
    }

    async handleSystemLogEntry(entry: SystemLogEntry) {
        const payload = buildSystemLogDiscordPayload(txConfig.discordBot.logRoutes, entry);
        if (!payload) return false;

        return await this.postLogMessage(payload);
    }

    async handleServerLogEvent(
        rawEvent: { type?: unknown; data?: unknown },
        logEntry: { ts: number; src: { id: string | false; name: string }; msg: string; type: string },
    ) {
        const payload = buildServerMenuDiscordPayload(txConfig.discordBot.logRoutes, rawEvent, logEntry);
        if (!payload) return false;

        return await this.postLogMessage(payload);
    }

    async updateBotStatus() {
        if (!this.#bridgeServer?.isReady) {
            console.verbose.warn('not ready yet to update status');
            return false;
        }

        const snapshot = this.#buildConfigSnapshot();
        this.#bridgeServer.send({ type: 'configSnapshot', payload: snapshot });
        this.#bridgeServer.send({ type: 'updatePresence', payload: snapshot.discordBot.presence });

        for (const target of ['status', 'playerList'] as const) {
            const { channelId, messageId } = getPersistentEmbedState(target);
            if (!channelId || !messageId) continue;

            try {
                this.#bridgeServer.send({
                    type: 'updateStatusEmbed',
                    payload: {
                        channelId,
                        messageId,
                        messagePayload: buildPersistentEmbedMessagePayload(target),
                    },
                });
            } catch (error) {
                console.verbose.warn(`Failed to update ${persistentEmbedMeta[target].lowerName}: ${emsg(error)}`);
            }
        }

        return true;
    }

    startBot(botCfg?: SpawnConfig) {
        botCfg ??= this.#getCurrentSpawnConfig();
        if (!botCfg?.enabled) return;
        if (typeof botCfg.token !== 'string' || !botCfg.token.length) {
            throw this.#buildError('Discord bot enabled while token is not set.');
        }
        if (typeof botCfg.guild !== 'string' || !botCfg.guild.length) {
            throw this.#buildError('Discord bot enabled while guild id is not set.');
        }

        this.#activeBotConfig = botCfg;

        return (async () => {
            const bridgePort = txConfig.discordBot.bridgePort;
            const bridgeSecret = this.#getBridgeSecret();
            await this.#ensureBridgeServer(bridgePort, bridgeSecret);

            this.guildName = undefined;
            this.#lastExplicitStatus = DiscordBotStatus.Starting;
            this.refreshWsStatus();

            this.#ignoreNextBridgeDisconnect = this.#bridgeServer?.isReady === true && this.#botProcess.isRunning;
            const waitForReady = this.#createStartPromise();
            this.#botProcess.restart({
                token: botCfg.token,
                guild: botCfg.guild,
                bridgePort,
                secret: bridgeSecret,
            });

            try {
                return await waitForReady;
            } catch (error) {
                this.#ignoreNextBridgeDisconnect = false;

                //A slow startup (cold disk, AV scanning, Discord rate limits) is not fatal:
                //keep the process alive and let the eventual 'ready' status flip it to Ready.
                const isStartupTimeout = (error as Error & { code?: unknown })?.code === 'StartupTimeout';
                if (isStartupTimeout && this.#botProcess.isRunning) {
                    this.refreshWsStatus();
                    throw this.#buildError(
                        'Discord bot startup is taking longer than 60 seconds. ' +
                            'The bot process is still running and will keep starting in the background — check its status shortly.',
                        'StartupTimeout',
                    );
                }

                this.#lastExplicitStatus = DiscordBotStatus.Error;
                this.refreshWsStatus();
                this.#botProcess.stop();
                throw error;
            }
        })();
    }

    async createTicketThread(
        channelId: string,
        threadName: string,
        ticket: DatabaseTicketType,
        screenshotBuffer?: Buffer,
    ): Promise<void> {
        if (!this.#bridgeServer?.isReady) throw new Error('discord bot not ready yet');

        const messagePayload = buildTicketSummaryMessagePayload(ticket, {
            footer: commandFooter,
        });

        const response = (await this.#bridgeServer.request('createTicketThread', {
            channelId,
            threadName,
            ticket,
            messagePayload,
            screenshotBase64: screenshotBuffer ? screenshotBuffer.toString('base64') : undefined,
        })) as { threadId?: string };

        if (!response?.threadId) {
            throw new Error('Discord bridge did not return a thread id.');
        }

        txCore.database.tickets.setDiscordThread(ticket.id, response.threadId);
        broadcastTicketAddonEvent('ticketDiscordLinked', {
            ticketId: ticket.id,
            discordThreadId: response.threadId,
            channelId,
        });
    }

    async postTicketThreadMessage(
        ticketId: string,
        authorName: string,
        content: string,
        imageUrls?: string[],
    ): Promise<void> {
        if (!this.#bridgeServer?.isReady) {
            console.verbose.warn(`Not forwarding ticket ${ticketId} message to Discord: bridge is not ready.`);
            return;
        }

        const threadId = txCore.database.tickets.getDiscordThreadId(ticketId);
        if (!threadId) {
            console.verbose.warn(
                `Not forwarding ticket ${ticketId} message to Discord: ticket has no linked Discord thread/channel.`,
            );
            return;
        }

        this.#bridgeServer.send({
            type: 'postTicketMessage',
            threadId,
            authorName,
            content,
            imageUrls,
        });
    }

    async refreshMemberCache() {
        if (!this.#isBotEnabled()) throw new Error('discord bot is disabled');
        if (!this.#bridgeServer?.isReady) throw new Error('discord bot not ready yet');

        const currTs = Date.now();
        if (currTs - this.#lastGuildMembersCacheRefresh <= 60_000) {
            return false;
        }

        const refreshed = await this.#bridgeServer.request('refreshMemberCache');
        if (refreshed) {
            this.#lastGuildMembersCacheRefresh = currTs;
            return true;
        }

        return false;
    }

    async #syncDiscordLinkedAdminAuths() {
        if (!this.isClientReady) return false;
        if (!txConfig.discordBot.rolePermissions.length) return false;

        try {
            await this.refreshMemberCache();
        } catch {
            // Role checks can still resolve individual members even if a bulk refresh fails.
        }

        await txCore.webServer.webSocket.reCheckAdminAuths();
        return true;
    }

    async resolveMemberRoles(uid: string) {
        if (!this.#isBotEnabled()) throw new Error('discord bot is disabled');
        if (!this.#bridgeServer?.isReady) throw new Error('discord bot not ready yet');

        return (await this.#bridgeServer.request('resolveMemberRoles', { uid })) as {
            isMember: boolean;
            memberRoles?: string[];
        };
    }

    #guildRolesCache: { fetchedAt: number; roles: DiscordGuildRoleOption[] } | null = null;

    async listGuildRoles(options?: { forceRefresh?: boolean }) {
        if (!this.#isBotEnabled()) throw new Error('discord bot is disabled');
        if (!this.#bridgeServer?.isReady) throw new Error('discord bot not ready yet');

        const cacheTtlMs = 60_000;
        const nowMs = Date.now();
        if (!options?.forceRefresh && this.#guildRolesCache && nowMs - this.#guildRolesCache.fetchedAt < cacheTtlMs) {
            return { roles: this.#guildRolesCache.roles };
        }

        const response = (await this.#bridgeServer.request('listGuildRoles', {})) as {
            roles?: DiscordGuildRoleOption[];
        };
        const roles = Array.isArray(response?.roles) ? response.roles : [];
        this.#guildRolesCache = { fetchedAt: nowMs, roles };
        return { roles };
    }

    async resolveMemberProfile(uid: string) {
        if (!this.#bridgeServer?.isReady) throw new Error('discord bot not ready yet');

        return (await this.#bridgeServer.request('resolveMemberProfile', { uid })) as {
            tag: string;
            avatar: string;
        };
    }

    readonly #handleBridgePushMessage = async (message: BridgeMessage) => {
        switch (message.type) {
            case 'botStatus': {
                this.#handleBotStatus(message);
                return;
            }
            case 'botDiagnostics': {
                this.applyRuntimeDiagnostics(
                    (message.payload ?? message.diagnostics ?? {}) as {
                        addonLoadFailures?: DiscordBotAddonLoadFailure[];
                        addonRuntimeIssues?: DiscordBotAddonRuntimeIssue[];
                        updatedAt?: number;
                    },
                );
                return;
            }
            case 'botCommandUsage': {
                if (typeof message.commandName === 'string') {
                    txManager.txRuntime.botCommands.count(message.commandName);
                }
                return;
            }
            case 'botCommandTelemetry': {
                const event = normalizeBotCommandEvent(message);
                if (event) {
                    txCore.database.botAnalytics.recordCommandEvent(event);
                }
                return;
            }
            case 'syncAdminDiscordRoleChange': {
                await handleAdminDiscordRoleChange(message, {
                    resolveMemberRoles: (uid) => this.resolveMemberRoles(uid),
                });
                return;
            }
            case 'ticketThreadMessage': {
                handleTicketThreadMessage(message);
                return;
            }
            default: {
                console.verbose.warn(`Unhandled Discord bridge push message: ${message.type}`);
            }
        }
    };

    #attachBridgeRequestTelemetry(message: BridgeMessage, response: unknown, handlerStartedAt: number) {
        const requestType = typeof message.type === 'string' ? message.type : 'unknown';
        const handlerDurationMs = Math.max(0, Date.now() - handlerStartedAt);

        if (!response || typeof response !== 'object' || Array.isArray(response)) {
            return {
                payload: response,
                telemetry: {
                    outcome: 'success',
                    requestType,
                    handlerDurationMs,
                },
            };
        }

        const typedResponse = response as BridgeCommandResponse;
        return {
            ...typedResponse,
            telemetry: {
                outcome: 'success',
                ...(typedResponse.telemetry ?? {}),
                requestType,
                handlerDurationMs,
            },
        };
    }

    readonly #handleBridgeRequest = async (message: BridgeMessage) => {
        const handlerStartedAt = Date.now();
        let response: unknown;

        switch (message.type) {
            case 'configSnapshot': {
                response = this.#buildConfigSnapshot();
                break;
            }
            case 'playerLookup': {
                response = buildPlayerLookupReply(message.searchId, message.adminView === true, message.requesterId);
                break;
            }
            case 'permissionCheck': {
                const permissionResult = resolveAdminPermission(
                    message.requesterId,
                    message.memberRoles,
                    String(message.requiredPermission ?? ''),
                );
                if ('reply' in permissionResult) {
                    response = withTelemetry(
                        { granted: false },
                        permissionResult.telemetry ?? { outcome: 'denied', denialReason: 'missing_permissions' },
                    );
                    break;
                }

                response = buildSuccessResponse({
                    granted: true,
                    resolvedName: permissionResult.resolvedName,
                    source: permissionResult.source,
                });
                break;
            }
            case 'whitelistCommand': {
                response = handleWhitelistCommand(message);
                break;
            }
            case 'whitelistReviewReaction': {
                response = handleWhitelistReviewReaction(message);
                break;
            }
            case 'ticketCommand': {
                response = handleTicketCommand(message, {
                    sendAnnouncement: (content) => this.sendAnnouncement(content),
                });
                break;
            }
            case 'sxTicketsResolveReporterDiscord': {
                response = handleSxTicketsResolveReporterDiscord(message);
                break;
            }
            case 'moderationCommand': {
                response = await handleModerationCommand(message, {
                    buildReply,
                    adminStore: txCore.adminStore,
                    logAction: logDiscordAdminAction,
                    footer: commandFooter,
                    infoEmbedColor,
                });
                break;
            }
            case 'persistentEmbedCommand':
            case 'statusEmbedCommand': {
                response = handlePersistentEmbedCommand(message);
                break;
            }
            case 'persistentEmbedPage': {
                response = handlePersistentEmbedPageRequest(message);
                break;
            }
            case 'addonRoute': {
                response = await handleAddonRouteRequest(message);
                break;
            }
            default: {
                throw new Error(`Unhandled Discord bridge request type: ${message.type}`);
            }
        }

        return this.#attachBridgeRequestTelemetry(message, response, handlerStartedAt);
    };

    async #ensureBridgeServer(port: number, secret: string) {
        if (
            this.#bridgeServer &&
            this.#bridgeRuntimeConfig?.port === port &&
            this.#bridgeRuntimeConfig.secret === secret
        ) {
            await this.#bridgeServer.listen();
            return;
        }

        await this.#closeBridgeServer();
        this.#bridgeRuntimeConfig = { port, secret };
        this.#bridgeServer = new BridgeServer({
            port,
            secret,
            onAuthenticated: () => {
                const currentTs = Date.now();
                this.#bridgeConnectCount += 1;
                this.#lastBridgeAuthenticatedAt = currentTs;
                if (this.#bridgeDisconnectedSince) {
                    this.#lastReconnectDurationMs = currentTs - this.#bridgeDisconnectedSince;
                }
                this.#bridgeDisconnectedSince = undefined;
                this.#clearBridgeAutoHealTimer();
            },
            onDisconnected: () => {
                if (this.#ignoreNextBridgeDisconnect) {
                    this.#ignoreNextBridgeDisconnect = false;
                    return;
                }
                if (this.#closingBridge || !this.#isBotEnabled()) return;
                this.#lastBridgeDisconnectedAt = Date.now();
                this.#bridgeDisconnectCount += 1;
                this.#bridgeDisconnectedSince ??= this.#lastBridgeDisconnectedAt;
                this.#lastExplicitStatus = DiscordBotStatus.Error;
                this.refreshWsStatus();
                if (this.#pendingStart) {
                    this.#botProcess.stop();
                    this.#rejectPendingStart(new Error('Discord bridge disconnected before the bot reported ready.'));
                    return;
                }

                this.#scheduleBridgeAutoHeal();
            },
            onPushMessage: this.#handleBridgePushMessage,
            onRequest: this.#handleBridgeRequest,
        });
        await this.#bridgeServer.listen();
    }

    async #stopRuntime() {
        this.#clearBridgeAutoHealTimer();
        this.#botProcess.stop();
        await this.#closeBridgeServer();
    }

    async #closeBridgeServer() {
        if (!this.#bridgeServer) return;

        this.#closingBridge = true;
        try {
            await this.#bridgeServer.close();
        } finally {
            this.#closingBridge = false;
        }
    }

    #createStartPromise() {
        this.#rejectPendingStart(new Error('Discord bot startup superseded.'));

        const waitForReady = new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.#pendingStart = undefined;
                reject(this.#buildError('Discord bot startup timed out.', 'StartupTimeout'));
            }, 60_000);
            this.#pendingStart = { resolve, reject, timer };
        });

        void waitForReady.catch(() => {});
        return waitForReady;
    }

    #resolvePendingStart(message: string) {
        if (!this.#pendingStart) return;

        clearTimeout(this.#pendingStart.timer);
        this.#pendingStart.resolve(message);
        this.#pendingStart = undefined;
    }

    #rejectPendingStart(error: Error) {
        if (!this.#pendingStart) return;

        clearTimeout(this.#pendingStart.timer);
        this.#pendingStart.reject(error);
        this.#pendingStart = undefined;
    }

    #buildConfigSnapshot() {
        const activeBotConfig = this.#activeBotConfig && this.#activeBotConfig !== false ? this.#activeBotConfig : null;
        const runtimeConfig = {
            ...txConfig.discordBot,
            guild: activeBotConfig?.guild ?? txConfig.discordBot.guild,
            warningsChannel: activeBotConfig?.warningsChannel ?? txConfig.discordBot.warningsChannel,
        };
        const { token, bridgeSecret, oauthClientSecret, ...publicDiscordConfig } = runtimeConfig;

        return {
            discordBot: publicDiscordConfig,
            discordBotLocale: getDiscordLocaleSnapshot(),
            discordBotAddons: txCore.addonManager?.getDiscordBotManifest() ?? [],
            gameFeatures: {
                reportsEnabled: txConfig.gameFeatures.reportsEnabled,
            },
            locale: txConfig.general.language,
            playerCount: getDisplayPlayerCount(),
            maxPlayers: txCore.cacheStore.get('fxsRuntime:maxClients') ?? '??',
            serverName: txConfig.general.serverName,
            uptime: txCore.fxMonitor.status.uptime,
        };
    }

    #handleBotStatus(message: BridgeMessage) {
        if (message.status === 'ready') {
            this.#ignoreNextBridgeDisconnect = false;
            this.#botProcess.markHealthy();
            this.guildName = typeof message.guildName === 'string' ? message.guildName : undefined;
            this.#lastExplicitStatus = DiscordBotStatus.Ready;
            this.#lastReadyAt = Date.now();
            this.#lastBotError = undefined;
            this.#clearBridgeAutoHealTimer();

            const userTag = typeof message.tag === 'string' ? message.tag : 'unknown';
            const guildLabel = this.guildName ?? this.#getCurrentSpawnConfig()?.guild ?? 'unknown';
            this.#resolvePendingStart(`Discord bot running as \`${userTag}\` on \`${guildLabel}\`.`);
            this.refreshWsStatus();
            this.updateBotStatus().catch(() => {});
            this.#syncDiscordLinkedAdminAuths().catch(() => {});
            return;
        }

        if (message.status === 'error') {
            this.#ignoreNextBridgeDisconnect = false;
            this.guildName = undefined;
            this.#lastExplicitStatus = DiscordBotStatus.Error;
            this.refreshWsStatus();
            this.#botProcess.stop();

            const errorMessage =
                typeof message.message === 'string' ? message.message : 'Discord bot reported an error.';
            const errorCode =
                typeof message.code === 'string' || typeof message.code === 'number' ? message.code : 'unknown';
            this.#lastBotError = {
                code: String(errorCode),
                message: errorMessage,
                at: Date.now(),
            };
            console.error(`Discord bot reported an error (${String(errorCode)}): ${errorMessage}`);

            const error = this.#buildError(errorMessage, message.code);
            if (message.clientId) {
                Object.assign(error, { clientId: message.clientId });
            }
            if (message.prohibitedPermsInUse) {
                Object.assign(error, { prohibitedPermsInUse: message.prohibitedPermsInUse });
            }
            this.#rejectPendingStart(error);
        }
    }

    #handleBotProcessFailure(reason: string) {
        this.#ignoreNextBridgeDisconnect = false;
        this.guildName = undefined;
        this.#lastExplicitStatus = DiscordBotStatus.Error;
        this.#lastProcessFailure = {
            reason,
            at: Date.now(),
        };
        this.refreshWsStatus();

        if (this.#pendingStart) {
            this.#botProcess.stop();
            this.#rejectPendingStart(new Error(reason));
        }
    }

    /**
     * Creates a Discord review thread for a new whitelist application when configured.
     */
    async createWhitelistReviewThread(
        channelId: string,
        applicationId: string,
        license: string,
        playerName: string,
    ): Promise<string | undefined> {
        if (!this.#bridgeServer?.isReady) return undefined;

        const response = (await this.#bridgeServer.request('createWhitelistReviewThread', {
            channelId,
            applicationId,
            license,
            playerName,
        })) as { threadId?: string };

        return response?.threadId;
    }

    /**
     * Optional hook when a whitelist application is created (review channel thread support).
     */
    notifyWhitelistApplicationCreated(applicationId: string, license: string, playerName: string) {
        const workflow = getActiveWorkflow();
        const channelId = workflow?.discordReviewChannelId;
        if (!channelId || !this.isClientReady) return;

        this.createWhitelistReviewThread(channelId, applicationId, license, playerName)
            .then((threadId) => {
                if (!threadId) return;
                txCore.database.whitelist.updateApplication(license, { discordThreadId: threadId });
            })
            .catch((error) => {
                console.error(`Failed to create whitelist review thread: ${emsg(error)}`);
            });
    }

    #translate(content: string | MessageTranslationType | undefined) {
        if (!content) return undefined;
        if (typeof content === 'string') return content;
        return txCore.translator.t(content.key, content.data);
    }

    #recordRecoveryAction(
        action: DiscordBotRecoveryAction['action'],
        source: DiscordBotRecoverySource,
        ok: boolean,
        message: string,
    ) {
        this.#lastRecoveryAction = {
            action,
            source,
            ok,
            message,
            at: Date.now(),
        };
    }

    #clearBridgeAutoHealTimer() {
        if (this.#bridgeAutoHealTimer) {
            clearTimeout(this.#bridgeAutoHealTimer);
            this.#bridgeAutoHealTimer = undefined;
        }
        this.#bridgeAutoHealAt = undefined;
    }

    #scheduleBridgeAutoHeal() {
        if (this.#bridgeAutoHealTimer || !this.#botProcess.isRunning || this.#pendingStart) return;

        this.#bridgeAutoHealAt = Date.now() + BRIDGE_AUTO_HEAL_DELAY_MS;
        this.#bridgeAutoHealTimer = setTimeout(() => {
            this.#bridgeAutoHealTimer = undefined;
            this.#bridgeAutoHealAt = undefined;
            if (this.#bridgeServer?.isReady || !this.#isBotEnabled()) return;

            this.restartRuntime('automatic').catch((error) => {
                console.error(
                    `Discord bot bridge auto-heal failed: ${error instanceof Error ? error.message : String(error)}`,
                );
            });
        }, BRIDGE_AUTO_HEAL_DELAY_MS);
    }

    #isBotEnabled() {
        if (this.#activeBotConfig !== undefined) {
            return this.#activeBotConfig !== false && this.#activeBotConfig.enabled;
        }

        return txConfig.discordBot.enabled;
    }

    #getCurrentSpawnConfig(): SpawnConfig | undefined {
        if (this.#activeBotConfig && this.#activeBotConfig !== false) {
            return this.#activeBotConfig;
        }

        if (!txConfig.discordBot.enabled) return undefined;
        return {
            enabled: txConfig.discordBot.enabled,
            token: txConfig.discordBot.token,
            guild: txConfig.discordBot.guild,
            warningsChannel: txConfig.discordBot.warningsChannel,
        };
    }

    #getBridgeSecret() {
        if (typeof txConfig.discordBot.bridgeSecret === 'string' && txConfig.discordBot.bridgeSecret.length) {
            return txConfig.discordBot.bridgeSecret;
        }

        this.#runtimeBridgeSecret ??= randomUUID();
        return this.#runtimeBridgeSecret;
    }

    #buildError(message: string, code?: unknown) {
        const error = new Error(message) as Error & { code?: unknown };
        if (typeof code !== 'undefined') {
            error.code = code;
        }
        return error;
    }
}
