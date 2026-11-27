const modulename = 'WebServer:SelfUpdateApply';
import { z } from 'zod';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
import { ApiToastResp } from '@shared/genericApiTypes';

const bodySchema = z.object({
    mode: z.enum(['now', 'scheduled', 'manual']),
    delayMinutes: z
        .number()
        .int()
        .min(1)
        .max(24 * 60)
        .optional(),
});

/**
 * Installs the downloaded sxPanel update: restart now, schedule a restart, or install the next
 * time FXServer is closed (manual restart).
 */
export default async function SelfUpdateApply(ctx: AuthedCtx) {
    if (!ctx.admin.testPermission('all_permissions', modulename)) {
        return ctx.send<ApiToastResp>({
            type: 'error',
            msg: 'Only admins with all permissions can manage sxPanel updates.',
        });
    }

    const parsed = bodySchema.safeParse(ctx.request.body ?? {});
    if (!parsed.success) {
        return ctx.send<ApiToastResp>({ type: 'error', msg: 'Invalid update install request.' });
    }
    const { mode, delayMinutes } = parsed.data;
    if (mode === 'scheduled' && !delayMinutes) {
        return ctx.send<ApiToastResp>({ type: 'error', msg: 'Pick when the restart should happen.' });
    }

    if (txCore.selfUpdater.status.phase !== 'extracted') {
        return ctx.send<ApiToastResp>({
            type: 'error',
            msg: 'No downloaded update is ready to install. Download it first.',
        });
    }

    const version = txCore.selfUpdater.staged ?? 'update';
    if (mode === 'now') {
        //Runs in the background, the process will shut down
        txCore.selfUpdater.apply('now').catch(() => {
            //Error is already stored in status
        });
        ctx.admin.logCommand(`sxPanel ${version}: install + restart now`, 'selfUpdate.apply');
        return ctx.send<ApiToastResp>({
            type: 'warning',
            msg: 'Installing the update. FXServer will restart and the panel will be back in a moment.',
        });
    }

    try {
        await txCore.selfUpdater.apply(mode, delayMinutes);
    } catch (error) {
        return ctx.send<ApiToastResp>({ type: 'error', msg: emsg(error) ?? 'Failed to schedule the update.' });
    }

    if (mode === 'scheduled') {
        ctx.admin.logCommand(`sxPanel ${version}: restart scheduled in ${delayMinutes}m`, 'selfUpdate.apply');
        return ctx.send<ApiToastResp>({
            type: 'success',
            msg: `Restart scheduled in ${delayMinutes} minute(s). Players will be warned before it happens.`,
        });
    } else {
        ctx.admin.logCommand(`sxPanel ${version}: install on next manual restart`, 'selfUpdate.apply');
        return ctx.send<ApiToastResp>({
            type: 'success',
            msg: 'Update armed. It will be installed the next time you close FXServer.',
        });
    }
}
