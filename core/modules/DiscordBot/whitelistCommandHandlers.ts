import { now } from '@lib/misc';
import { emsg } from '@shared/emsg';
import { approveWhitelistRequest, handleWhitelistThreadReaction } from '@modules/Whitelist/requestActions';
import { resolveAdminPermission } from './bridgePermissions';
import {
    buildDeniedReply,
    buildFailedReply,
    buildSuccessResponse,
    buildReply,
    logDiscordAdminAction,
    translateBot,
} from './bridgeReplyHelpers';
import type { BridgeMessage } from './bridgeServer';

export const translateWhitelist = (key: string, data: Record<string, unknown> = {}) => {
    return translateBot(`whitelist.${key}`, data);
};

export const handleWhitelistCommand = (message: BridgeMessage) => {
    const permissionResult = resolveAdminPermission(message.requesterId, message.memberRoles, 'players.whitelist');
    if ('reply' in permissionResult) return permissionResult;
    const adminName = permissionResult.actorName;

    if (message.subcommand === 'member') {
        if (typeof message.identifier !== 'string' || typeof message.playerName !== 'string') {
            return buildDeniedReply('danger', translateWhitelist('failed_resolve_member'), 'invalid_request');
        }

        try {
            txCore.database.whitelist.registerApproval({
                identifier: message.identifier,
                playerName: message.playerName,
                playerAvatar: typeof message.playerAvatar === 'string' ? message.playerAvatar : null,
                tsApproved: now(),
                approvedBy: adminName,
            });
            txCore.fxRunner.sendEvent('whitelistPreApproval', {
                action: 'added',
                identifier: message.identifier,
                playerName: message.playerName,
                adminName,
            });
        } catch (error) {
            return buildFailedReply(
                'danger',
                translateWhitelist('save_approval_failed', { message: emsg(error) }),
                false,
            );
        }

        const replyMessage = translateWhitelist('approval_added', { playerName: message.playerName });
        logDiscordAdminAction(adminName, replyMessage, 'whitelist.approval.add');
        return buildSuccessResponse({ reply: buildReply('success', replyMessage) });
    }

    if (message.subcommand === 'request' || message.subcommand === 'application') {
        if (typeof message.requestId !== 'string' || message.requestId.length !== 5 || message.requestId[0] !== 'R') {
            return buildDeniedReply('danger', translateWhitelist('invalid_request_id'), 'invalid_request');
        }

        const requests = txCore.database.whitelist.findManyRequests({ id: message.requestId });
        if (!requests.length) {
            return buildDeniedReply(
                'warning',
                translateWhitelist('request_not_found', { requestId: message.requestId }),
                'invalid_target',
                false,
            );
        }

        const request = requests[0];
        const playerName = request.discordTag ?? request.playerDisplayName;
        const result = approveWhitelistRequest(message.requestId, adminName);
        if ('error' in result) {
            return buildFailedReply(
                'danger',
                translateWhitelist('save_request_approval_failed', { message: result.error }),
                false,
            );
        }

        const replyMessage = translateWhitelist('request_approved', {
            requestId: message.requestId,
            playerName,
        });
        logDiscordAdminAction(adminName, replyMessage, 'whitelist.request.approve');
        return buildSuccessResponse({ reply: buildReply('success', replyMessage) });
    }

    return buildDeniedReply(
        'danger',
        translateWhitelist('subcommand_not_found', { subcommand: String(message.subcommand) }),
        'invalid_request',
    );
};

export const handleWhitelistReviewReaction = (message: BridgeMessage) => {
    const permissionResult = resolveAdminPermission(message.requesterId, message.memberRoles, 'players.whitelist');
    if ('reply' in permissionResult) return permissionResult;
    const adminName = permissionResult.actorName;

    const threadId = typeof message.threadId === 'string' ? message.threadId : '';
    const action = message.action === 'deny' ? 'deny' : message.action === 'approve' ? 'approve' : null;
    if (!threadId || !action) {
        return buildDeniedReply('danger', translateWhitelist('invalid_request'), 'invalid_request');
    }

    const result = handleWhitelistThreadReaction(threadId, action, adminName);
    if ('error' in result) {
        return buildDeniedReply('warning', result.error, 'invalid_target', false);
    }

    const replyMessage =
        action === 'approve'
            ? `Whitelist application approved via reaction.`
            : `Whitelist application denied via reaction.`;
    logDiscordAdminAction(adminName, replyMessage, `whitelist.thread.${action}`);
    return buildSuccessResponse({ reply: buildReply('success', replyMessage) });
};
