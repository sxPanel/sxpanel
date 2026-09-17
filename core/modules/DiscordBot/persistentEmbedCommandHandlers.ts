import { emsg } from '@shared/emsg';
import { generatePlayerListMessage, generateStatusMessage } from './statusMessage';
import { resolveAdminPermission } from './bridgePermissions';
import {
    buildDeniedReply,
    buildReply,
    buildReplyResult,
    buildSuccessResponse,
    logDiscordAdminAction,
    translateBot,
} from './bridgeReplyHelpers';
import type { BridgeMessage } from './bridgeServer';

export type PersistentEmbedTarget = 'status' | 'playerList';

export const persistentEmbedStateKeys = {
    status: {
        channelId: 'discord:status:channelId',
        messageId: 'discord:status:messageId',
    },
    playerList: {
        channelId: 'discord:playerlist:channelId',
        messageId: 'discord:playerlist:messageId',
        page: 'discord:playerlist:page',
    },
} as const;

export const persistentEmbedMeta = {
    status: {
        displayName: 'Status embed',
        lowerName: 'status embed',
    },
    playerList: {
        displayName: 'Player list embed',
        lowerName: 'player list embed',
    },
} as const;

export const resolvePersistentEmbedTarget = (value: unknown): PersistentEmbedTarget => {
    return value === 'playerList' || value === 'players' ? 'playerList' : 'status';
};

export const getPersistentEmbedLocaleMeta = (target: PersistentEmbedTarget) => {
    const localeKey = target === 'playerList' ? 'player_list' : 'status';

    return {
        displayName: translateBot(`persistent_embed.${localeKey}.display_name`),
        lowerName: translateBot(`persistent_embed.${localeKey}.lower_name`),
        saved: translateBot(`persistent_embed.${localeKey}.saved`),
        removed: translateBot(`persistent_embed.${localeKey}.removed`),
    };
};

export const getPersistentEmbedPage = () => {
    const rawPage = txCore.cacheStore.get(persistentEmbedStateKeys.playerList.page);
    if (typeof rawPage === 'number' && Number.isInteger(rawPage) && rawPage > 0) {
        return rawPage;
    }
    if (typeof rawPage === 'string' && /^\d+$/.test(rawPage)) {
        const parsedPage = Number.parseInt(rawPage, 10);
        if (parsedPage > 0) {
            return parsedPage;
        }
    }

    return 1;
};

export const setPersistentEmbedPage = (page: number) => {
    txCore.cacheStore.set(persistentEmbedStateKeys.playerList.page, page);
};

export const getPersistentEmbedState = (target: PersistentEmbedTarget) => {
    const targetStateKeys = persistentEmbedStateKeys[target];
    const channelId = txCore.cacheStore.get(targetStateKeys.channelId);
    const messageId = txCore.cacheStore.get(targetStateKeys.messageId);

    return {
        channelId: typeof channelId === 'string' ? channelId : undefined,
        messageId: typeof messageId === 'string' ? messageId : undefined,
    };
};

export const buildPersistentEmbedMessagePayload = (target: PersistentEmbedTarget, options?: { page?: number }) => {
    const messagePayload =
        target === 'playerList'
            ? generatePlayerListMessage(undefined, undefined, {
                  page: options?.page ?? getPersistentEmbedPage(),
              })
            : generateStatusMessage();

    return messagePayload as {
        embeds?: Record<string, unknown>[];
        components?: Record<string, unknown>[];
    };
};

export const handlePersistentEmbedCommand = (message: BridgeMessage) => {
    const permissionResult = resolveAdminPermission(message.requesterId, message.memberRoles, 'settings.write');
    if ('reply' in permissionResult) return permissionResult;

    const adminName = permissionResult.actorName;
    const action = message.action;
    const target = resolvePersistentEmbedTarget(message.target ?? message.embedType);
    const targetStateKeys = persistentEmbedStateKeys[target];
    const targetMeta = getPersistentEmbedLocaleMeta(target);
    if (action === 'getState') {
        return {
            ...getPersistentEmbedState(target),
            ...(target === 'playerList' ? { page: getPersistentEmbedPage() } : {}),
        };
    }

    if (action === 'getMessage') {
        try {
            return buildSuccessResponse({ messagePayload: buildPersistentEmbedMessagePayload(target) });
        } catch (error) {
            return buildReplyResult(
                'warning',
                translateBot('persistent_embed.generate_failed', {
                    embedLabel: targetMeta.lowerName,
                    message: emsg(error),
                }),
                { outcome: 'failed' },
                true,
            );
        }
    }

    if (action === 'saveLocation') {
        if (typeof message.channelId !== 'string' || typeof message.messageId !== 'string') {
            return buildDeniedReply(
                'danger',
                translateBot('persistent_embed.invalid_location', { embedLabel: targetMeta.lowerName }),
                'invalid_target',
            );
        }

        txCore.cacheStore.set(targetStateKeys.channelId, message.channelId);
        txCore.cacheStore.set(targetStateKeys.messageId, message.messageId);
        if (target === 'playerList') {
            setPersistentEmbedPage(1);
        }
        logDiscordAdminAction(
            adminName,
            targetMeta.saved,
            target === 'status' ? 'embed.status.save' : 'embed.player_list.save',
        );
        return buildSuccessResponse({ ok: true });
    }

    if (action === 'clearLocation') {
        txCore.cacheStore.delete(targetStateKeys.channelId);
        txCore.cacheStore.delete(targetStateKeys.messageId);
        if (target === 'playerList') {
            txCore.cacheStore.delete(targetStateKeys.page);
        }
        if (message.logAction !== false) {
            logDiscordAdminAction(
                adminName,
                targetMeta.removed,
                target === 'status' ? 'embed.status.clear' : 'embed.player_list.clear',
            );
        }
        return buildSuccessResponse({ ok: true });
    }

    return buildDeniedReply(
        'danger',
        translateBot('persistent_embed.unknown_action', { action: String(action) }),
        'invalid_request',
    );
};

export const handlePersistentEmbedPageRequest = (message: BridgeMessage) => {
    const target = resolvePersistentEmbedTarget(message.target ?? message.embedType);
    if (target !== 'playerList') {
        return {
            reply: buildReply('warning', translateBot('persistent_embed.pagination_only_player_list'), true),
        };
    }

    const { channelId, messageId } = getPersistentEmbedState(target);
    if (!channelId || !messageId) {
        return { reply: buildReply('warning', translateBot('persistent_embed.player_list_not_configured'), true) };
    }
    if (message.channelId !== channelId || message.messageId !== messageId) {
        return {
            reply: buildReply('warning', translateBot('persistent_embed.player_list_no_longer_active'), true),
        };
    }

    const requestedPage =
        typeof message.page === 'number'
            ? message.page
            : typeof message.page === 'string' && /^\d+$/.test(message.page)
              ? Number.parseInt(message.page, 10)
              : NaN;
    if (!Number.isInteger(requestedPage) || requestedPage < 1) {
        return { reply: buildReply('danger', translateBot('persistent_embed.invalid_page'), true) };
    }

    setPersistentEmbedPage(requestedPage);

    try {
        return {
            messagePayload: buildPersistentEmbedMessagePayload(target, { page: requestedPage }),
        };
    } catch (error) {
        return {
            reply: buildReply(
                'warning',
                translateBot('persistent_embed.page_change_failed', { message: emsg(error) }),
                true,
            ),
        };
    }
};
