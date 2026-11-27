const modulename = 'WebServer:SelfUpdateCancel';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
import { ApiToastResp } from '@shared/genericApiTypes';

/**
 * Cancels a scheduled update restart, or a pending "install on next restart".
 */
export default async function SelfUpdateCancel(ctx: AuthedCtx) {
    if (!ctx.admin.testPermission('all_permissions', modulename)) {
        return ctx.send<ApiToastResp>({
            type: 'error',
            msg: 'Only admins with all permissions can manage sxPanel updates.',
        });
    }

    if (!txCore.selfUpdater.cancelPlan()) {
        return ctx.send<ApiToastResp>({ type: 'info', msg: 'There is no pending update restart to cancel.' });
    }
    ctx.admin.logCommand('sxPanel update restart cancelled', 'selfUpdate.cancel');
    return ctx.send<ApiToastResp>({
        type: 'success',
        msg: 'Cancelled. The update is still downloaded, so you can pick another option.',
    });
}
