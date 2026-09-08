const modulename = 'WebServer:PlayerActions';
import playerResolver from '@lib/player/playerResolver';
import { GenericApiErrorResp, GenericApiResp } from '@shared/genericApiTypes';
import { PlayerClass, ServerPlayer } from '@lib/player/playerClasses';
import { anyUndefined, calcExpirationFromDuration } from '@lib/misc';
import consoleFactory from '@lib/console';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
import { SYM_CURRENT_MUTEX } from '@lib/symbols';
import { getAssignableCustomTagIds, getDiscordManagedTagIds, normalizePlayerTagId } from '@lib/player/playerTags';
const console = consoleFactory(modulename);

const apiError = (errorCode: string, error: string): GenericApiErrorResp => ({
    errorCode,
    error,
});

/**
 * Actions route for the player modal
 */
export default async function PlayerActions(ctx: AuthedCtx) {
    //Sanity check
    if (anyUndefined(ctx.params.action)) {
        return ctx.utils.error(400, 'Invalid Request');
    }
    const action = ctx.params.action;
    const { mutex, netid, license } = ctx.query;
    const sendTypedResp = (data: GenericApiResp) => ctx.send(data);

    //Finding the player
    let player;
    try {
        const refMutex = mutex === 'current' ? SYM_CURRENT_MUTEX : mutex;
        player = playerResolver(refMutex, parseInt(netid as string), license);
    } catch (error) {
        return sendTypedResp(apiError('player_action.player_not_found', emsg(error)));
    }

    //Delegate to the specific action handler
    if (action === 'save_note') {
        return sendTypedResp(await handleSaveNote(ctx, player));
    } else if (action === 'warn') {
        return sendTypedResp(await handleWarning(ctx, player));
    } else if (action === 'ban') {
        return sendTypedResp(await handleBan(ctx, player));
    } else if (action === 'whitelist') {
        return sendTypedResp(await handleSetWhitelist(ctx, player));
    } else if (action === 'message') {
        return sendTypedResp(await handleDirectMessage(ctx, player));
    } else if (action === 'kick') {
        return sendTypedResp(await handleKick(ctx, player));
    } else if (action === 'heal') {
        return sendTypedResp(await handleHeal(ctx, player));
    } else if (action === 'spectate') {
        return sendTypedResp(await handleSpectate(ctx, player));
    } else if (action === 'wipe_ids') {
        return sendTypedResp(await handleWipeIds(ctx, player));
    } else if (action === 'wipe_hwids') {
        return sendTypedResp(await handleWipeHwids(ctx, player));
    } else if (action === 'set_tag') {
        return sendTypedResp(await handleSetTag(ctx, player));
    } else if (action === 'delete_player') {
        return sendTypedResp(await handleDeletePlayer(ctx, player));
    } else {
        return sendTypedResp(apiError('player_action.unknown_action', 'unknown action'));
    }
}

/**
 * Handle Save Note (open to all admins)
 */
export async function handleSaveNote(ctx: AuthedCtx, player: PlayerClass): Promise<GenericApiResp> {
    //Checking request
    if (anyUndefined(ctx.request.body, ctx.request.body.note) || typeof ctx.request.body.note !== 'string') {
        return apiError('player_action.invalid_request', 'Invalid request.');
    }
    const note = ctx.request.body.note.trim();

    try {
        player.setNote(note, ctx.admin.getActionAuthor());
        ctx.admin.logAction(`Set notes for ${player.license}`, 'player.notes.save');
        return { success: true };
    } catch (error) {
        return apiError('player_action.failed_save_note', `Failed to save note: ${emsg(error)}`);
    }
}

/**
 * Handle Send Warning
 */
export async function handleWarning(ctx: AuthedCtx, player: PlayerClass): Promise<GenericApiResp> {
    //Checking request
    if (anyUndefined(ctx.request.body, ctx.request.body.reason) || typeof ctx.request.body.reason !== 'string') {
        return apiError('player_action.invalid_request', 'Invalid request.');
    }
    const reason = ctx.request.body.reason.trim() || 'no reason provided';

    //Check permissions
    if (!ctx.admin.testPermission('players.warn', modulename)) {
        return apiError('player_action.no_permission', "You don't have permission to execute this action.");
    }

    //Validating server & player
    const allIds = player.getAllIdentifiers();
    if (!allIds.length) {
        return apiError('player_action.no_identifiers', 'Cannot warn a player with no identifiers.');
    }

    //Register action
    let actionId;
    try {
        actionId = txCore.database.actions.registerWarn(
            allIds,
            ctx.admin.getActionAuthor(),
            reason,
            player.displayName,
        );
    } catch (error) {
        return apiError('player_action.failed_warn', `Failed to warn player: ${emsg(error)}`);
    }
    ctx.admin.logAction(`Warned player "${player.displayName}" (${player.license}): ${reason}`, 'player.warn');

    // Dispatch `txAdmin:events:playerWarned`
    const warnEventData = {
        author: ctx.admin.getActionAuthor(),
        reason,
        actionId,
        targetNetId: player instanceof ServerPlayer && player.isConnected ? player.netid : null,
        targetIds: allIds,
        targetName: player.displayName,
    };
    const eventSent = txCore.fxRunner.sendEvent('playerWarned', warnEventData);
    txCore.addonManager?.broadcastEvent('playerWarned', warnEventData);

    if (eventSent) {
        return { success: true };
    } else {
        return apiError(
            'player_action.warn_stdin_failed',
            `Warn saved, but likely failed to send the warn in game (stdin error).`,
        );
    }
}

/**
 * Handle Banning command
 */
export async function handleBan(ctx: AuthedCtx, player: PlayerClass): Promise<GenericApiResp> {
    //Checking request
    if (
        anyUndefined(ctx.request.body, ctx.request.body.duration, ctx.request.body.reason) ||
        typeof ctx.request.body.duration !== 'string' ||
        typeof ctx.request.body.reason !== 'string'
    ) {
        return apiError('player_action.invalid_request', 'Invalid request.');
    }
    const durationInput = ctx.request.body.duration.trim();
    const reason = (ctx.request.body.reason as string).trim() || 'no reason provided';

    //Calculating expiration/duration
    let calcResults;
    try {
        calcResults = calcExpirationFromDuration(durationInput);
    } catch (error) {
        return apiError('player_action.invalid_duration', emsg(error));
    }
    const { expiration, duration } = calcResults;

    //Check permissions
    if (!ctx.admin.testPermission('players.ban', modulename)) {
        return apiError('player_action.no_permission', "You don't have permission to execute this action.");
    }
    if (expiration === false && !ctx.admin.testPermission('players.ban.permanent', modulename)) {
        return apiError('player_action.no_permission', "You don't have permission to apply permanent bans.");
    }

    //Validating player - hwids.length can be zero
    const allIds = player.getAllIdentifiers();
    const allHwids = player.getAllHardwareIdentifiers();
    if (!allIds.length) {
        return apiError('player_action.no_identifiers', 'Cannot ban a player with no identifiers.');
    }

    //Register action
    let actionId;
    try {
        actionId = txCore.database.actions.registerBan(
            allIds,
            ctx.admin.getActionAuthor(),
            reason,
            expiration,
            player.displayName,
            allHwids,
        );
    } catch (error) {
        return apiError('player_action.failed_ban', `Failed to ban player: ${emsg(error)}`);
    }
    if (!actionId) {
        return apiError('player_action.failed_ban', 'Failed to register ban to database.');
    }
    ctx.admin.logAction(`Banned player "${player.displayName}" (${player.license}): ${reason}`, 'player.ban');

    //No need to dispatch events if server is not online
    if (txCore.fxRunner.isIdle) {
        return { success: true };
    }

    //Prepare and send command
    let kickMessage, durationTranslated;
    const tOptions: any = {
        author: txCore.adminStore.getAdminPublicName(ctx.admin.name, 'punishment'),
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

    // Dispatch `txAdmin:events:playerBanned`
    const banEventData = {
        author: ctx.admin.getActionAuthor(),
        reason,
        actionId,
        expiration,
        durationInput,
        durationTranslated,
        targetNetId: player instanceof ServerPlayer ? player.netid : null,
        targetIds: player.ids,
        targetHwids: player.hwids,
        targetName: player.displayName,
        kickMessage,
    };
    const eventSent = txCore.fxRunner.sendEvent('playerBanned', banEventData);
    txCore.addonManager?.broadcastEvent('playerBanned', banEventData);

    if (eventSent) {
        return { success: true };
    } else {
        return apiError(
            'player_action.ban_stdin_failed',
            `Player banned, but likely failed to kick player (stdin error).`,
        );
    }
}

/**
 * Handle Player Whitelist Action
 */
async function handleSetWhitelist(ctx: AuthedCtx, player: PlayerClass): Promise<GenericApiResp> {
    //Checking request
    if (anyUndefined(ctx.request.body, ctx.request.body.status)) {
        return apiError('player_action.invalid_request', 'Invalid request.');
    }
    const status = ctx.request.body.status === 'true' || ctx.request.body.status === true;

    //Check permissions
    if (!ctx.admin.testPermission('players.whitelist', modulename)) {
        return apiError('player_action.no_permission', "You don't have permission to execute this action.");
    }

    try {
        player.setWhitelist(status);
        if (status) {
            ctx.admin.logAction(`Added ${player.license} to the whitelist.`, 'player.whitelist.add');
        } else {
            ctx.admin.logAction(`Removed ${player.license} from the whitelist.`, 'player.whitelist.remove');
        }

        // Dispatch `txAdmin:events:whitelistPlayer`
        txCore.fxRunner.sendEvent('whitelistPlayer', {
            action: status ? 'added' : 'removed',
            license: player.license,
            playerName: player.displayName,
            adminName: ctx.admin.getActionAuthor(),
        });

        return { success: true };
    } catch (error) {
        return apiError('player_action.failed_whitelist', `Failed to save whitelist status: ${emsg(error)}`);
    }
}

/**
 * Handle Set Tag Action
 */
async function handleSetTag(ctx: AuthedCtx, player: PlayerClass): Promise<GenericApiResp> {
    //Checking request
    if (anyUndefined(ctx.request.body, ctx.request.body.tagId, ctx.request.body.status)) {
        return apiError('player_action.invalid_request', 'Invalid request.');
    }
    const tagId = normalizePlayerTagId(ctx.request.body.tagId as string);
    const status = ctx.request.body.status === 'true' || ctx.request.body.status === true;
    if (!tagId.length) {
        return apiError('player_action.invalid_request', 'Invalid tag id.');
    }

    //Check permissions
    if (!ctx.admin.testPermission('players.write', modulename)) {
        return apiError('player_action.no_permission', "You don't have permission to execute this action.");
    }

    //Validate tag ID against config
    const validIds = getAssignableCustomTagIds();
    if (!validIds.has(tagId)) {
        return apiError('player_action.unknown_tag', `Unknown custom tag: ${tagId}`);
    }
    if (getDiscordManagedTagIds().has(tagId)) {
        return apiError('player_action.discord_managed_tag', `Tag '${tagId}' is managed by Discord roles.`);
    }

    try {
        player.setCustomTag(tagId, status);
        if (player instanceof ServerPlayer && player.isConnected) {
            txCore.fxPlayerlist.syncPlayerTags(player.netid);
        }
        const actionLabel = status ? 'Added' : 'Removed';
        ctx.admin.logAction(
            `${actionLabel} tag '${tagId}' for ${player.license}.`,
            status ? 'player.tag.add' : 'player.tag.remove',
        );
        return { success: true };
    } catch (error) {
        return apiError('player_action.failed_save_tag', `Failed to save tag: ${emsg(error)}`);
    }
}

/**
 * Handle Direct Message Action
 */
async function handleDirectMessage(ctx: AuthedCtx, player: PlayerClass): Promise<GenericApiResp> {
    //Checking request
    if (anyUndefined(ctx.request.body, ctx.request.body.message) || typeof ctx.request.body.message !== 'string') {
        return apiError('player_action.invalid_request', 'Invalid request.');
    }
    const message = ctx.request.body.message.trim();
    if (!message.length) {
        return apiError('player_action.empty_message', 'Cannot send a DM with empty message.');
    }

    //Check permissions
    if (!ctx.admin.testPermission('players.direct_message', modulename)) {
        return apiError('player_action.no_permission', "You don't have permission to execute this action.");
    }

    //Validating server & player
    if (!txCore.fxRunner.child?.isAlive) {
        return apiError('server_not_running', 'The server is not running.');
    }
    if (!(player instanceof ServerPlayer) || !player.isConnected) {
        return apiError('player_not_connected', 'This player is not connected to the server.');
    }

    try {
        ctx.admin.logAction(`DM to "${player.displayName}" (${player.license}): ${message}`, 'player.message.send');

        // Dispatch `txAdmin:events:playerDirectMessage`
        txCore.fxRunner.sendEvent('playerDirectMessage', {
            target: player.netid,
            author: ctx.admin.getActionAuthor(),
            message,
        });

        return { success: true };
    } catch (error) {
        return apiError('player_action.failed_dm', `Failed to save dm player: ${emsg(error)}`);
    }
}

/**
 * Handle Kick Action
 */
export async function handleKick(ctx: AuthedCtx, player: PlayerClass): Promise<GenericApiResp> {
    //Checking request
    if (anyUndefined(ctx.request.body, ctx.request.body.reason) || typeof ctx.request.body.reason !== 'string') {
        return apiError('player_action.invalid_request', 'Invalid request.');
    }
    const kickReason = ctx.request.body.reason.trim() || txCore.translator.t('kick_messages.unknown_reason');

    //Check permissions
    if (!ctx.admin.testPermission('players.kick', modulename)) {
        return apiError('player_action.no_permission', "You don't have permission to execute this action.");
    }

    //Validating server & player
    if (!txCore.fxRunner.child?.isAlive) {
        return apiError('server_not_running', 'The server is not running.');
    }
    if (!(player instanceof ServerPlayer) || !player.isConnected) {
        return apiError('player_not_connected', 'This player is not connected to the server.');
    }

    //Register kick to DB
    const allIds = player.getAllIdentifiers();
    try {
        txCore.database.actions.registerKick(allIds, ctx.admin.getActionAuthor(), kickReason, player.displayName);
    } catch (error) {
        return apiError('player_action.failed_kick', `Failed to register kick: ${emsg(error)}`);
    }

    try {
        ctx.admin.logAction(`Kicked "${player.displayName}" (${player.license}): ${kickReason}`, 'player.kick');
        const dropMessage = txCore.translator.t('kick_messages.player', { reason: kickReason });

        // Dispatch `txAdmin:events:playerKicked`
        const kickEventData = {
            target: player.netid,
            author: ctx.admin.getActionAuthor(),
            reason: kickReason,
            dropMessage,
        };
        txCore.fxRunner.sendEvent('playerKicked', kickEventData);
        txCore.addonManager?.broadcastEvent('playerKicked', kickEventData);

        return { success: true };
    } catch (error) {
        return apiError('player_action.failed_kick', `Failed to save kick player: ${emsg(error)}`);
    }
}

/**
 * Handle Heal Action
 */
async function handleHeal(ctx: AuthedCtx, player: PlayerClass): Promise<GenericApiResp> {
    //Check permissions
    if (!ctx.admin.testPermission('players.heal', modulename)) {
        return apiError('player_action.no_permission', "You don't have permission to execute this action.");
    }

    //Validating server & player
    if (!txCore.fxRunner.child?.isAlive) {
        return apiError('server_not_running', 'The server is not running.');
    }
    if (!(player instanceof ServerPlayer) || !player.isConnected) {
        return apiError('player_not_connected', 'This player is not connected to the server.');
    }

    try {
        ctx.admin.logAction(`Healed "${player.displayName}" (${player.license}) from web panel.`, 'player.heal');
        txCore.fxRunner.sendEvent('webPlayerHealed', {
            target: player.netid,
            author: ctx.admin.getActionAuthor(),
        });
        return { success: true };
    } catch (error) {
        return apiError('player_action.failed_heal', `Failed to heal player: ${emsg(error)}`);
    }
}

/**
 * Handle Spectate Action
 * Triggers spectate mode on the admin's in-game client
 */
async function handleSpectate(ctx: AuthedCtx, player: PlayerClass): Promise<GenericApiResp> {
    //Check permissions
    if (!ctx.admin.testPermission('players.spectate', modulename)) {
        return apiError('player_action.no_permission', "You don't have permission to execute this action.");
    }

    //Validating server & player
    if (!txCore.fxRunner.child?.isAlive) {
        return apiError('server_not_running', 'The server is not running.');
    }
    if (!(player instanceof ServerPlayer) || !player.isConnected) {
        return apiError('player_not_connected', 'This player is not connected to the server.');
    }

    try {
        ctx.admin.logAction(
            `Spectating "${player.displayName}" (${player.license}) from web panel.`,
            'player.spectate',
        );
        txCore.fxRunner.sendEvent('webSpectatePlayer', {
            target: player.netid,
            adminName: ctx.admin.getActionAuthor(),
        });
        return { success: true };
    } catch (error) {
        return apiError('player_action.failed_spectate', `Failed to spectate player: ${emsg(error)}`);
    }
}

/**
 * Handle Wipe Player IDs (keeps license only)
 */
async function handleWipeIds(ctx: AuthedCtx, player: PlayerClass): Promise<GenericApiResp> {
    if (!ctx.admin.testPermission('players.delete', modulename)) {
        return apiError('player_action.no_permission', "You don't have permission to execute this action.");
    }
    if (!player.license) {
        return apiError('player_action.no_license', 'Cannot wipe IDs for a player without a license.');
    }
    try {
        txCore.database.players.wipePlayerIds(player.license);
        ctx.admin.logAction(`Wiped IDs for ${player.license}`, 'player.ids.wipe');
        return { success: true };
    } catch (error) {
        return apiError('player_action.failed_wipe_ids', `Failed to wipe player IDs: ${emsg(error)}`);
    }
}

/**
 * Handle Wipe Player HWIDs
 */
async function handleWipeHwids(ctx: AuthedCtx, player: PlayerClass): Promise<GenericApiResp> {
    if (!ctx.admin.testPermission('players.delete', modulename)) {
        return apiError('player_action.no_permission', "You don't have permission to execute this action.");
    }
    if (!player.license) {
        return apiError('player_action.no_license', 'Cannot wipe HWIDs for a player without a license.');
    }
    try {
        txCore.database.players.wipePlayerHwids(player.license);
        ctx.admin.logAction(`Wiped HWIDs for ${player.license}`, 'player.hwids.wipe');
        return { success: true };
    } catch (error) {
        return apiError('player_action.failed_wipe_hwids', `Failed to wipe player HWIDs: ${emsg(error)}`);
    }
}

/**
 * Handle Delete Player from database
 */
async function handleDeletePlayer(ctx: AuthedCtx, player: PlayerClass): Promise<GenericApiResp> {
    if (!ctx.admin.testPermission('players.delete', modulename)) {
        return apiError('player_action.no_permission', "You don't have permission to execute this action.");
    }
    if (!player.license) {
        return apiError('player_action.no_license', 'Cannot delete a player without a license.');
    }
    try {
        txCore.database.players.deletePlayer(player.license);
        ctx.admin.logAction(`Deleted player ${player.displayName} (${player.license}) from database`, 'player.delete');
        return { success: true };
    } catch (error) {
        return apiError('player_action.failed_delete', `Failed to delete player: ${emsg(error)}`);
    }
}
