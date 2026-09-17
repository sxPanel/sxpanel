const modulename = 'WebServer:HistoryActions';
import { GenericApiOkResp } from '@shared/genericApiTypes';
import { DatabaseActionType } from '@modules/Database/databaseTypes';
import { calcExpirationFromDuration } from '@lib/misc';
import consts from '@shared/consts';
import consoleFactory from '@lib/console';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
import {
    addLegacyBanBodySchema,
    revokeActionBodySchema,
    deleteActionBodySchema,
    changeBanDurationBodySchema,
} from '@shared/historyApiSchemas';
const console = consoleFactory(modulename);

/**
 * Endpoint to interact with the actions database.
 */
export default async function HistoryActions(ctx: AuthedCtx & { params: any }) {
    //Sanity check
    if (!ctx.params.action) {
        return ctx.utils.error(400, 'Invalid Request');
    }
    const action = ctx.params.action;
    const sendTypedResp = (data: GenericApiOkResp) => ctx.send(data);

    //Delegate to the specific action handler
    if (action === 'addLegacyBan') {
        return sendTypedResp(await handleBandIds(ctx));
    } else if (action === 'revokeAction') {
        return sendTypedResp(await handleRevokeAction(ctx));
    } else if (action === 'changeBanDuration') {
        return sendTypedResp(await handleChangeBanDuration(ctx));
    } else if (action === 'deleteAction') {
        return sendTypedResp(await handleDeleteAction(ctx));
    } else {
        return sendTypedResp({ error: 'unknown action' });
    }
}

/**
 * Handle Ban Player IDs (legacy ban!)
 * This is only called from the players page, where you ban an ID array instead of a PlayerClass
 * Doesn't support HWIDs, only banning player does
 */
async function handleBandIds(ctx: AuthedCtx): Promise<GenericApiOkResp> {
    //Checking request
    const schemaRes = addLegacyBanBodySchema.safeParse(ctx.request.body);
    if (!schemaRes.success) {
        return { error: 'Invalid request body.' };
    }
    const { reason, identifiers: identifiersInput, duration: durationInput } = schemaRes.data;

    //Filtering identifiers
    if (!identifiersInput.length) {
        return { error: 'You must send at least one identifier' };
    }
    const invalids = identifiersInput.filter((id) => {
        return typeof id !== 'string' || !Object.values(consts.validIdentifiers).some((vf) => vf.test(id));
    });
    if (invalids.length) {
        return { error: 'Invalid IDs: ' + invalids.join(', ') };
    }
    const identifiers = [...new Set(identifiersInput)];

    //Calculating expiration/duration
    let calcResults;
    try {
        calcResults = calcExpirationFromDuration(durationInput);
    } catch (error) {
        return { error: emsg(error) };
    }
    const { expiration, duration } = calcResults;

    //Check permissions
    if (!ctx.admin.testPermission('players.ban', modulename)) {
        return { error: "You don't have permission to execute this action." };
    }
    if (expiration === false && !ctx.admin.testPermission('players.ban.permanent', modulename)) {
        return { error: "You don't have permission to apply permanent bans." };
    }

    //Register action
    let actionId;
    try {
        actionId = txCore.database.actions.registerBan(identifiers, ctx.admin.name, reason, expiration, false);
    } catch (error) {
        return { error: `Failed to ban identifiers: ${emsg(error)}` };
    }
    ctx.admin.logAction(`Banned <${identifiers.join(';')}>: ${reason}`, 'history.ban_legacy');

    // Dispatch `txAdmin:events:playerBanned`
    try {
        let kickMessage, durationTranslated;
        const tOptions: any = {
            author: ctx.admin.name,
            reason: reason,
        };
        if (expiration !== false && duration) {
            durationTranslated = txCore.translator.tDuration(duration * 1000, { units: ['d', 'h'] });
            tOptions.expiration = durationTranslated;
            kickMessage = txCore.translator.t('ban_messages.kick_temporary', tOptions);
        } else {
            durationTranslated = null;
            kickMessage = txCore.translator.t('ban_messages.kick_permanent', tOptions);
        }
        const historyBanData = {
            author: ctx.admin.name,
            reason,
            actionId,
            expiration,
            durationInput,
            durationTranslated,
            targetNetId: null,
            targetIds: identifiers,
            targetHwids: [],
            targetName: 'identifiers',
            kickMessage,
        };
        txCore.fxRunner.sendEvent('playerBanned', historyBanData);
        txCore.addonManager?.broadcastEvent('playerBanned', historyBanData);
    } catch (error) {
        /* fxserver event notification is best-effort */
    }

    return { success: true };
}

/**
 * Handle revoke database action.
 * This is called from the player modal or the players page.
 */
export async function handleRevokeAction(ctx: AuthedCtx): Promise<GenericApiOkResp> {
    //Checking request
    const schemaRes = revokeActionBodySchema.safeParse(ctx.request.body);
    if (!schemaRes.success) {
        return { error: 'Invalid request body.' };
    }
    const { actionId, reason } = schemaRes.data;

    //Check permissions
    const perms = [];
    if (ctx.admin.hasPermission('players.unban')) perms.push('ban');
    if (ctx.admin.hasPermission('players.warn')) perms.push('warn');

    let action;
    try {
        action = txCore.database.actions.revoke(
            actionId,
            ctx.admin.name,
            perms,
            reason || undefined,
        ) as DatabaseActionType;
        ctx.admin.logAction(
            `Revoked ${action.type} id ${actionId} from ${action.playerName ?? 'identifiers'}`,
            'history.revoke',
        );
    } catch (error) {
        return { error: `Failed to revoke action: ${emsg(error)}` };
    }

    // Dispatch `txAdmin:events:actionRevoked`
    try {
        txCore.fxRunner.sendEvent('actionRevoked', {
            actionId: action.id,
            actionType: action.type,
            actionReason: action.reason,
            actionAuthor: action.author,
            playerName: action.playerName,
            playerIds: action.ids,
            playerHwids: 'hwids' in action ? action.hwids : [],
            revokedBy: ctx.admin.name,
        });
    } catch (error) {
        /* fxserver event notification is best-effort */
    }

    return { success: true };
}

/**
 * Handle changing the duration of a ban.
 */
async function handleChangeBanDuration(ctx: AuthedCtx): Promise<GenericApiOkResp> {
    //Checking request
    const schemaRes = changeBanDurationBodySchema.safeParse(ctx.request.body);
    if (!schemaRes.success) {
        return { error: 'Invalid request body.' };
    }
    const { actionId, duration: durationInput } = schemaRes.data;

    //Check permissions
    if (!ctx.admin.testPermission('players.ban', modulename)) {
        return { error: "You don't have permission to execute this action." };
    }

    //Calculating expiration
    let newExpiration: number | false;
    try {
        const calcResults = calcExpirationFromDuration(durationInput);
        newExpiration = calcResults.expiration;
    } catch (error) {
        return { error: emsg(error) };
    }
    if (newExpiration === false && !ctx.admin.testPermission('players.ban.permanent', modulename)) {
        return { error: "You don't have permission to apply permanent bans." };
    }

    //Update the ban
    try {
        const action = txCore.database.actions.changeBanExpiration(actionId, newExpiration);
        ctx.admin.logAction(
            `Changed ban duration for ${action.id} (${action.playerName || 'identifiers'}) to ${durationInput}`,
            'history.ban_duration.change',
        );
    } catch (error) {
        return { error: `Failed to change ban duration: ${emsg(error)}` };
    }

    return { success: true };
}

/**
 * Handle deleting an action from the database entirely.
 */
async function handleDeleteAction(ctx: AuthedCtx): Promise<GenericApiOkResp> {
    //Checking request
    const schemaRes = deleteActionBodySchema.safeParse(ctx.request.body);
    if (!schemaRes.success) {
        return { error: 'Invalid request body.' };
    }
    const { actionId } = schemaRes.data;

    //Check permissions
    if (!ctx.admin.testPermission('players.delete', modulename)) {
        return { error: "You don't have permission to execute this action." };
    }

    try {
        const action = txCore.database.actions.deleteAction(actionId);
        ctx.admin.logAction(
            `Deleted ${action.type} id ${actionId} from ${action.playerName ?? 'identifiers'}`,
            'history.delete',
        );
    } catch (error) {
        return { error: `Failed to delete action: ${emsg(error)}` };
    }

    return { success: true };
}
