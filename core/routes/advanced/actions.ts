const modulename = 'WebServer:AdvancedActions';
import v8 from 'node:v8';
import bytes from 'bytes';
import got from '@lib/got';
import type { AuthedCtx } from '@modules/WebServer/ctxTypes';
import consoleFactory from '@lib/console';
import { SYM_SYSTEM_AUTHOR } from '@lib/symbols';
import { txEnv } from '@core/globalData';
import { emsg } from '@shared/emsg';
const console = consoleFactory(modulename);

//Helper functions
const isUndefined = (x: unknown): x is undefined => x === undefined;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Endpoint for running advanced commands - basically, should not ever be used
 */
export default async function AdvancedActions(ctx: AuthedCtx) {
    //Sanity check
    if (isUndefined(ctx.request.body.action) || typeof ctx.request.body.action !== 'string') {
        console.warn('Invalid request!');
        return ctx.send({ type: 'danger', message: 'Invalid request.' });
    }
    const action = ctx.request.body.action;
    const parameter = typeof ctx.request.body.parameter === 'string' ? ctx.request.body.parameter : '';

    //Check permissions
    if (!ctx.admin.testPermission('all_permissions', modulename)) {
        return ctx.send({
            type: 'danger',
            message: "You don't have permission to execute this action.",
        });
    }

    //Action: Change Verbosity
    if (action == 'change_verbosity') {
        console.setVerbose(parameter == 'true');
        //temp disabled because the verbosity convar is not being set by this method
        return ctx.send({ refresh: true });
    } else if (action == 'perform_magic') {
        const message = JSON.stringify(txCore.fxPlayerlist.getPlayerList(), null, 2);
        return ctx.send({ type: 'success', message });
    } else if (action == 'show_db') {
        const dbo = txCore.database.getDboRef();
        console.dir(dbo);
        return ctx.send({ type: 'success', message: JSON.stringify(dbo, null, 2) });
    } else if (action == 'show_log') {
        return ctx.send({
            type: 'success',
            message: JSON.stringify((txCore.logger.server as any).getRecentBuffer(), null, 2),
        });
    } else if (action == 'memory') {
        let memory: string;
        try {
            const usage = process.memoryUsage();
            const formatted: Record<string, string> = {};
            Object.keys(usage).forEach((prop) => {
                formatted[prop] = bytes(usage[prop as keyof NodeJS.MemoryUsage]) ?? 'unknown';
            });
            memory = JSON.stringify(formatted, null, 2);
        } catch (error) {
            memory = 'error';
        }
        return ctx.send({ type: 'success', message: memory });
    } else if (action == 'freeze') {
        console.warn('Freezing process for 50 seconds.');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * 1000);
        return ctx.send({ type: 'success', message: 'Froze process for 50 seconds.' });
    } else if (action == 'updateMutableConvars') {
        (txCore.fxRunner as any).updateMutableConvars();
        return ctx.send({ refresh: true });
    } else if (action == 'reauthLast10Players') {
        // force refresh the admin status of the last 10 players to join
        const lastPlayers = txCore.fxPlayerlist
            .getPlayerList()
            .map((p: { netid: number }) => p.netid)
            .slice(-10);
        txCore.fxRunner.sendEvent('adminsUpdated', lastPlayers);
        return ctx.send({ type: 'success', message: `refreshed: ${JSON.stringify(lastPlayers)}` });
    } else if (action == 'getLoggerErrors') {
        const outData = {
            admin: (txCore.logger.admin as any).lrLastError,
            system: (txCore.logger.system as any).lrLastError,
            fxserver: (txCore.logger.fxserver as any).lrLastError,
            server: (txCore.logger.server as any).lrLastError,
        };
        return ctx.send({ type: 'success', message: JSON.stringify(outData, null, 2) });
    } else if (action == 'testSrcAddress') {
        const url = 'https://api.myip.com';
        try {
            const [respDefault, respReset] = await Promise.all([
                got(url, { timeout: { request: 10000 } }).json(),
                got(url, { localAddress: undefined, timeout: { request: 10000 } }).json(),
            ]);
            const outData = {
                url,
                respDefault,
                respReset,
            };
            return ctx.send({ type: 'success', message: JSON.stringify(outData, null, 2) });
        } catch (error) {
            return ctx.send({ type: 'danger', message: `Failed to test source address: ${emsg(error)}` });
        }
    } else if (action == 'getProcessEnv') {
        // Allowlist of env var names that are known-safe to display verbatim.
        // Anything outside this set is masked — this is defence in depth against
        // operators setting custom, arbitrarily-named secret envvars (WEBHOOK_URL,
        // PRIVATE_KEY, CREDENTIALS, etc.) that a denylist regex would miss.
        const SAFE_ENV_ALLOWLIST = new Set([
            'NODE_ENV',
            'NODE_VERSION',
            'LANG',
            'LC_ALL',
            'TZ',
            'PWD',
            'SHELL',
            'USER',
            'USERNAME',
            'LOGNAME',
            'HOME',
            'TERM',
            'OS',
            'OSTYPE',
            'PROCESSOR_ARCHITECTURE',
            'NUMBER_OF_PROCESSORS',
            'COMPUTERNAME',
            'HOSTNAME',
            'TXADMIN_DEV_ENABLED',
            'TXADMIN_DEV_VERBOSE',
        ]);
        const redactedEnv: Record<string, string> = {};
        for (const [key, value] of Object.entries(process.env)) {
            const upper = key.toUpperCase();
            if (SAFE_ENV_ALLOWLIST.has(upper)) {
                redactedEnv[key] = value ?? '';
            } else {
                // Still report the key existed (useful for diagnostics) without
                // leaking its value, but never show the value itself.
                redactedEnv[key] = '********';
            }
        }
        return ctx.send({ type: 'success', message: JSON.stringify(redactedEnv, null, 2) });
    } else if (action == 'snap') {
        setTimeout(() => {
            // if (Citizen && Citizen.snap) Citizen.snap();
            const snapFile = v8.writeHeapSnapshot();
            console.warn(`Heap snapshot written to: ${snapFile}`);
        }, 50);
        return ctx.send({ type: 'success', message: 'terminal' });
    } else if (action === 'gc') {
        if (typeof globalThis.gc === 'function') {
            globalThis.gc();
            return ctx.send({ type: 'success', message: 'done' });
        } else {
            return ctx.send({ type: 'danger', message: 'GC is not exposed' });
        }
    } else if (action == 'profile_monitor') {
        if (!txCore.fxRunner.child?.isAlive) {
            return ctx.send({ type: 'danger', message: 'The server is not running.' });
        }
        ctx.admin.logAction('Profiling txAdmin instance.', 'advanced.profile_monitor');

        const profileDuration = 5;
        const savePath = txEnv.profileSubPath('data', 'txProfile.bin');
        ExecuteCommand('profiler record start');
        await delay(profileDuration * 1000);
        ExecuteCommand('profiler record stop');
        await delay(150);
        ExecuteCommand(`profiler save "${savePath}"`);
        await delay(150);
        console.ok(`Profile saved to: ${savePath}`);
        txCore.fxRunner.sendCommand('profiler', ['view', savePath], ctx.admin.name);
        return ctx.send({ type: 'success', message: 'Check your live console in a few seconds.' });
    } else if (action === 'safeEnsureMonitor') {
        const setCmdResult = txCore.fxRunner.sendCommand(
            'set',
            ['txAdmin-luaComToken', txCore.webServer.luaComToken],
            SYM_SYSTEM_AUTHOR,
        );
        if (!setCmdResult) {
            return ctx.send({ type: 'danger', message: 'Failed to reset luaComToken.' });
        }
        const ensureCmdResult = txCore.fxRunner.sendCommand('ensure', ['monitor'], SYM_SYSTEM_AUTHOR);
        if (ensureCmdResult) {
            return ctx.send({ type: 'success', message: 'done' });
        } else {
            return ctx.send({ type: 'danger', message: 'Failed to ensure monitor.' });
        }
    } else if (action.startsWith('playerDrop')) {
        const reason = action.slice('playerDrop'.length).trim();
        if (!reason.length) {
            return ctx.send({ type: 'danger', message: 'Missing playerDrop reason.' });
        }
        const category = txCore.metrics.playerDrop.handlePlayerDrop({
            type: 'txAdminPlayerlistEvent',
            event: 'playerDropped',
            id: 0,
            reason,
        });
        return ctx.send({ type: 'success', message: String(category) });
    } else if (action.startsWith('set')) {
        // set general.language "pt"
        // set general.language "en"
        // set server.onesync "on"
        // set server.onesync "legacy"
        try {
            const setMatch = action.match(/^set\s+(\S+)\s+(.+)$/);
            if (!setMatch) throw new Error(`Invalid set command: ${action}`);
            const scopeKey = setMatch[1];
            const valueJson = setMatch[2];
            const [scope, key] = scopeKey.split('.');
            if (!scope || !key) throw new Error(`Invalid set command: ${action}`);
            const configUpdate = { [scope]: { [key]: JSON.parse(valueJson) } };
            const storedKeysChanges = txCore.configStore.saveConfigs(configUpdate, ctx.admin.name);
            const outParts = [
                'Keys Updated: ' + JSON.stringify(storedKeysChanges ?? 'not set', null, 2),
                '-'.repeat(16),
                'Stored:' + JSON.stringify(txCore.configStore.getStoredConfig(), null, 2),
            ];
            return ctx.send({ type: 'success', message: outParts.join('\n') });
        } catch (error) {
            return ctx.send({ type: 'danger', message: emsg(error) });
        }
    } else if (action == 'printFxRunnerChildHistory') {
        const message = JSON.stringify(txCore.fxRunner.history, null, 2);
        return ctx.send({ type: 'success', message });
    }

    //Catch all
    return ctx.send({ type: 'danger', message: '<strong>Unknown action :(</strong>' });
}
