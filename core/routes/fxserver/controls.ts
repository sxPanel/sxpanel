const modulename = 'WebServer:FXServerControls';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
import consoleFactory from '@lib/console';
import { ApiToastResp } from '@shared/genericApiTypes';
import { msToShortishDuration } from '@lib/misc';
const console = consoleFactory(modulename);

/**
 * Handle all the server control actions
 */
export default async function FXServerControls(ctx: AuthedCtx) {
    //Sanity check
    if (typeof ctx.request.body?.action !== 'string') {
        return ctx.utils.error(400, 'Invalid Request');
    }
    const { action } = ctx.request.body;

    //Check permissions
    if (!ctx.admin.testPermission('control.server', modulename)) {
        return ctx.send<ApiToastResp>({
            type: 'error',
            msg: "You don't have permission to execute this action.",
        });
    }

    if (action === 'restart') {
        ctx.admin.logCommand('RESTART SERVER', 'server.restart');

        //If too much of a delay, do it async
        const respawnDelay = txCore.fxRunner.restartSpawnDelay;
        if (respawnDelay.ms > 10_000) {
            txCore.fxRunner.restartServer('admin request', ctx.admin.getCommandAuthor()).catch((e) => {});
            const durationStr = msToShortishDuration(respawnDelay.ms, { units: ['m', 's', 'ms'] });
            return ctx.send<ApiToastResp>({
                type: 'warning',
                msg: `The server is will restart with delay of ${durationStr}.`,
            });
        } else {
            const restartResult = await txCore.fxRunner.restartServer('admin request', ctx.admin.getCommandAuthor());
            if (!restartResult.success) {
                return ctx.send<ApiToastResp>({ type: 'error', md: restartResult.md, msg: restartResult.error });
            } else {
                return ctx.send<ApiToastResp>({ type: 'success', msg: 'The server is now restarting.' });
            }
        }
    } else if (action === 'stop') {
        if (txCore.fxRunner.isIdle) {
            return ctx.send<ApiToastResp>({ type: 'success', msg: 'The server is already stopped.' });
        }
        ctx.admin.logCommand('STOP SERVER', 'server.stop');
        await txCore.fxRunner.killServer('admin request', ctx.admin.getCommandAuthor(), false);
        return ctx.send<ApiToastResp>({ type: 'success', msg: 'Server stopped.' });
    } else if (action === 'start') {
        if (!txCore.fxRunner.isIdle) {
            return ctx.send<ApiToastResp>({
                type: 'error',
                msg: "The server is already running. If it's not working, press RESTART.",
            });
        }
        ctx.admin.logCommand('START SERVER', 'server.start');
        const spawnResult = await txCore.fxRunner.spawnServer(true);
        if (!spawnResult.success) {
            return ctx.send<ApiToastResp>({ type: 'error', md: spawnResult.md, msg: spawnResult.error });
        } else {
            return ctx.send<ApiToastResp>({ type: 'success', msg: 'The server is now starting.' });
        }
    } else {
        return ctx.send<ApiToastResp>({
            type: 'error',
            msg: `Unknown control action '${action}'.`,
        });
    }
}
