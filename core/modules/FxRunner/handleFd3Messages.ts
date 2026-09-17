import { anyUndefined, calcExpirationFromDuration } from '@lib/misc';
import { ServerPlayer } from '@lib/player/playerClasses';
import { applyPlayerTagChange } from '@lib/player/playerTags';
import { emsg } from '@shared/emsg';
import consoleFactory from '@lib/console';
import { txEnv } from '@core/globalData';
import { CommandBridgeSchema, PlayerTagChangeSchema } from './fd3Schemas';
const console = consoleFactory('FXProc:FD3');

//Types
type StructuredTraceType = {
    key: number;
    value: {
        channel: string;
        data: any;
        file: string;
        func: string;
        line: number;
    };
};

/**
 * FiveM may deliver structured-trace payload as a JSON string or object.
 */
const resolveMonitorTracePayload = (payload: unknown) => {
    if (typeof payload === 'string') {
        try {
            return JSON.parse(payload);
        } catch {
            return null;
        }
    }
    if (payload && typeof payload === 'object') {
        return payload;
    }
    return null;
};

/**
 * Handles custom tag add/remove from resource exports (FD3 fallback).
 */
const handlePlayerTagChange = (payload: unknown) => {
    try {
        const parsed = PlayerTagChangeSchema.safeParse(payload);
        if (!parsed.success) {
            throw new Error('invalid payload');
        }
        const { action, tagId, netId } = parsed.data;
        const resolvedNetId = typeof netId === 'number' ? netId : parseInt(netId, 10);
        if (action === 'add') {
            applyPlayerTagChange(resolvedNetId, tagId, true);
        } else if (action === 'remove') {
            applyPlayerTagChange(resolvedNetId, tagId, false);
        }
    } catch (error) {
        console.warn(`handlePlayerTagChange error: ${emsg(error)}`);
    }
};

/**
 * Handles bridged commands from txResource.
 */
const handleBridgedCommands = (payload: unknown) => {
    const parsed = CommandBridgeSchema.safeParse(payload);
    if (!parsed.success) {
        console.warn(`Command bridge received invalid payload:`);
        console.dir(payload);
        return;
    }
    const data = parsed.data;

    if (data.command === 'announcement') {
        try {
            const message = data.message.trim();
            if (!message.length) throw new Error(`empty message`);

            const author = data.author;

            txCore.fxRunner.sendEvent('announcement', { message, author });

            txCore.logger.system.write(author, `Sending announcement: ${message}`, 'action', {
                actionId: 'announcement.send',
            });

            const publicAuthor = txCore.adminStore.getAdminPublicName(author, 'message');
            txCore.discordBot.sendAnnouncement({
                type: 'info',
                title: {
                    key: 'nui_menu.misc.announcement_title',
                    data: { author: publicAuthor },
                },
                description: message,
            });
        } catch (error) {
            console.verbose.warn(`handleBridgedCommands handler error:`);
            console.verbose.dir(error);
        }
        return;
    }

    const author = data.author;

    if (data.command === 'restartServer' || data.command === 'stopServer') {
        const reason = (data.reason ?? '').trim() || 'in-game admin menu';
        try {
            if (data.command === 'restartServer') {
                txCore.logger.system.write(author, `Restarting server: ${reason}`, 'command', {
                    actionId: 'server.restart',
                });
                txCore.fxRunner.restartServer(reason, author).catch((error) => {
                    console.verbose.warn(`In-game restartServer failed: ${emsg(error)}`);
                });
            } else {
                txCore.logger.system.write(author, `Stopping server: ${reason}`, 'command', {
                    actionId: 'server.stop',
                });
                txCore.fxRunner.killServer(reason, author, false).catch((error) => {
                    console.verbose.warn(`In-game stopServer failed: ${emsg(error)}`);
                });
            }
        } catch (error) {
            console.verbose.warn(`handleBridgedCommands ${data.command} error:`);
            console.verbose.dir(error);
        }
        return;
    }

    if (data.command !== 'kick' && data.command !== 'ban' && data.command !== 'warn') {
        return;
    }

    const targetNetId = data.targetNetId;
    const reason = (data.reason ?? '').trim() || 'no reason provided';

    if (data.command === 'kick') {
        try {
            const player = txCore.fxPlayerlist.getPlayerById(targetNetId);
            if (!(player instanceof ServerPlayer) || !player.isConnected) {
                throw new Error(`player netid ${targetNetId} not found or not connected`);
            }

            const allIds = player.getAllIdentifiers();
            if (!allIds.length) throw new Error(`no identifiers found for player netid ${targetNetId}`);

            txCore.database.actions.registerKick(allIds, author, reason, player.displayName);
            txCore.logger.system.write(author, `Kicked "${player.displayName}": ${reason}`, 'action', {
                actionId: 'player.kick',
            });

            const dropMessage = txCore.translator.t('kick_messages.player', { reason });
            txCore.fxRunner.sendEvent('playerKicked', {
                target: player.netid,
                author,
                reason,
                dropMessage,
            });
        } catch (error) {
            console.verbose.warn(`handleBridgedCommands kick error:`);
            console.verbose.dir(error);
        }
    } else if (data.command === 'ban') {
        try {
            const durationInput = (data.duration ?? '').trim() || 'permanent';

            const player = txCore.fxPlayerlist.getPlayerById(targetNetId);
            if (!(player instanceof ServerPlayer)) {
                throw new Error(`player netid ${targetNetId} not found`);
            }

            const { expiration, duration } = calcExpirationFromDuration(durationInput);

            const allIds = player.getAllIdentifiers();
            const allHwids = player.getAllHardwareIdentifiers();
            if (!allIds.length) throw new Error(`player has no identifiers`);

            const actionId = txCore.database.actions.registerBan(
                allIds,
                author,
                reason,
                expiration,
                player.displayName,
                allHwids,
            );

            txCore.logger.system.write(author, `Banned "${player.displayName}": ${reason}`, 'action', {
                actionId: 'player.ban',
            });

            let kickMessage;
            let durationTranslated: string | null = null;
            const publicAuthor = txCore.adminStore.getAdminPublicName(author, 'punishment');
            const tOptions: any = { author: publicAuthor, reason };
            if (expiration !== false && duration) {
                durationTranslated = txCore.translator.tDuration(duration * 1000, { units: ['d', 'h'] as any });
                tOptions.expiration = durationTranslated;
                kickMessage = txCore.translator.t('ban_messages.kick_temporary', tOptions);
            } else {
                kickMessage = txCore.translator.t('ban_messages.kick_permanent', tOptions);
            }

            txCore.fxRunner.sendEvent('playerBanned', {
                author,
                reason,
                actionId,
                expiration,
                durationInput,
                durationTranslated,
                targetNetId: player.netid,
                targetIds: allIds,
                targetHwids: allHwids,
                targetName: player.displayName,
                kickMessage,
            });
        } catch (error) {
            console.verbose.warn(`handleBridgedCommands ban error:`);
            console.verbose.dir(error);
        }
    } else if (data.command === 'warn') {
        try {
            const player = txCore.fxPlayerlist.getPlayerById(targetNetId);
            if (!(player instanceof ServerPlayer)) {
                throw new Error(`player netid ${targetNetId} not found`);
            }

            const allIds = player.getAllIdentifiers();
            if (!allIds.length) throw new Error(`player has no identifiers`);

            const actionId = txCore.database.actions.registerWarn(allIds, author, reason, player.displayName);

            txCore.logger.system.write(author, `Warned "${player.displayName}": ${reason}`, 'action', {
                actionId: 'player.warn',
            });

            txCore.fxRunner.sendEvent('playerWarned', {
                author,
                reason,
                actionId,
                targetNetId: player.isConnected ? player.netid : null,
                targetIds: allIds,
                targetName: player.displayName,
            });
        } catch (error) {
            console.verbose.warn(`handleBridgedCommands warn error:`);
            console.verbose.dir(error);
        }
    }
};

/**
 * Processes FD3 Messages
 *
 * Mapped message types:
 * - nucleus_connected
 * - watchdog_bark
 * - bind_error
 * - script_log
 * - script_structured_trace (handled by server logger)
 */
const handleFd3Messages = (mutex: string, trace: StructuredTraceType) => {
    //Filter valid and fresh packages
    if (!mutex || mutex !== txCore.fxRunner.child?.mutex) return;
    if (anyUndefined(trace, trace.value, trace.value.data, trace.value.channel)) return;
    const { channel, data } = trace.value;

    //Handle bind errors
    if (channel === 'citizen-server-impl' && data?.type === 'bind_error') {
        try {
            const newDelayBackoffMs = txCore.fxRunner.signalSpawnBackoffRequired(true);
            const [_ip, port] = data.address.split(':');
            const secs = Math.floor(newDelayBackoffMs / 1000);
            console.defer().error(`Detected FXServer error: Port ${port} is busy! Setting backoff delay to ${secs}s.`);
        } catch (e) {
            /* best-effort backoff signal */
        }
        return;
    }

    //Handle nucleus auth
    if (channel === 'citizen-server-impl' && data.type === 'nucleus_connected') {
        if (typeof data.url !== 'string') {
            console.error(`FD3 nucleus_connected event without URL.`);
        } else {
            try {
                const matches = /^(https:\/\/)?.*-([0-9a-z]{6,})\.users\.cfx\.re\/?$/.exec(data.url);
                if (!matches || !matches[2]) throw new Error(`invalid cfxid`);
                txCore.cacheStore.set('fxsRuntime:cfxId', matches[2]);
            } catch (error) {
                console.error(`Error decoding server nucleus URL.`);
            }
        }
        return;
    }

    //Handle watchdog
    if (channel === 'citizen-server-impl' && data.type === 'watchdog_bark') {
        setTimeout(() => {
            const thread = data?.thread ?? 'UNKNOWN';
            if (!data?.stack || data.stack.trim() === 'root') {
                console.error(`Detected server thread ${thread} hung without a stack trace.`);
            } else {
                console.error(`Detected server thread ${thread} hung with stack:`);
                console.error(`- ${data.stack}`);
                console.error('Please check the resource above to prevent server restarts.');
            }
        }, 250);
        return;
    }

    // if (data.type == 'script_log') {
    //     return console.dir(data);
    // }

    //Handle script traces
    if (
        channel === 'citizen-server-impl'
        && data.type === 'script_structured_trace'
        && data.resource === txEnv.txaResourceName
    ) {
        const tracePayload = resolveMonitorTracePayload(data.payload);
        if (!tracePayload || typeof tracePayload.type !== 'string') return;

        if (tracePayload.type === 'txAdminHeartBeat') {
            txCore.fxMonitor.handleHeartBeat('fd3');
        } else if (tracePayload.type === 'txAdminLogData') {
            txCore.logger.server.write(tracePayload.logs, mutex);
        } else if (tracePayload.type === 'txAdminLogNodeHeap') {
            txCore.metrics.svRuntime.logServerNodeMemory(tracePayload);
        } else if (tracePayload.type === 'txAdminResourceEvent') {
            txCore.fxResources.handleServerEvents(tracePayload, mutex);
        } else if (tracePayload.type === 'txAdminResourcePerf') {
            txCore.fxResources.handlePerfData(tracePayload);
        } else if (tracePayload.type === 'txAdminResourceRuntimes') {
            txManager.txRuntime.handleResourceRuntimes(tracePayload);
        } else if (tracePayload.type === 'txAdminPlayerlistEvent') {
            txCore.fxPlayerlist.handleServerEvents(tracePayload, mutex);
        } else if (tracePayload.type === 'txAdminCommandBridge') {
            handleBridgedCommands(tracePayload);
        } else if (tracePayload.type === 'txAdminAckWarning') {
            txCore.database.actions.ackWarn(tracePayload.actionId);
        } else if (tracePayload.type === 'txAdminPlayerTag') {
            handlePlayerTagChange(tracePayload);
        }
    }
};

/**
 * Handles all the FD3 traces from the FXServer
 * NOTE: this doesn't need to be a class, but might need to hold state in the future
 */
export default (mutex: string, trace: StructuredTraceType) => {
    try {
        handleFd3Messages(mutex, trace);
    } catch (error) {
        console.verbose.error('Error processing FD3 stream output:');
        console.verbose.dir(error);
    }
};
