import { now } from '@lib/misc';
import { broadcastTicketAddonEvent } from '@lib/addonEvents';
import type { DatabaseTicketType } from '@shared/ticketApiTypes';
import { emsg } from '@shared/emsg';
import {
    buildTicketQueueSummaryEmbed,
    buildTicketSummaryMessagePayload,
    escapeDiscordText,
    normalizeTicketCommandTicketId,
} from './ticketCommandUtils';
import { resolveAdminPermission } from './bridgePermissions';
import {
    buildDeniedReply,
    buildEmbedReply,
    buildFailedReply,
    buildSuccessResponse,
    commandFooter,
    EPHEMERAL_MESSAGE_FLAG,
    logDiscordAdminAction,
    replyColors,
    translateBot,
    withTelemetry,
} from './bridgeReplyHelpers';
import type { BridgeMessage } from './bridgeServer';

export const translateTicketCommand = (key: string, data: Record<string, unknown> = {}) => {
    return translateBot(`tickets.queue.command.${key}`, data);
};

type TicketCommandDependencies = {
    sendAnnouncement: (content: {
        title?: string;
        description: string;
        type: 'success' | 'info' | 'warning' | 'danger';
    }) => Promise<boolean | undefined>;
};

export const resolveTicketFromMessage = (message: BridgeMessage) => {
    const normalizedTicketId = normalizeTicketCommandTicketId(message.ticketId);
    if (normalizedTicketId) {
        const ticket = txCore.database.tickets.findOne(normalizedTicketId);
        if (!ticket) {
            return buildDeniedReply(
                'warning',
                translateTicketCommand('ticket_not_found', { ticketId: normalizedTicketId }),
                'invalid_target',
            );
        }

        return { ticket };
    }

    if (typeof message.threadId === 'string' && message.threadId.length) {
        const ticket = txCore.database.tickets.findByDiscordThread(message.threadId);
        if (!ticket) {
            return buildDeniedReply('warning', translateTicketCommand('thread_not_linked'), 'invalid_target');
        }

        return { ticket };
    }

    return buildDeniedReply('danger', translateTicketCommand('provide_ticket_or_thread'), 'invalid_target');
};

export const buildTicketCommandSummaryReply = (
    ticket: DatabaseTicketType,
    options?: { title?: string; note?: string; color?: number },
) => {
    const messagePayload = buildTicketSummaryMessagePayload(ticket, {
        title: options?.title,
        note: options?.note,
        color: options?.color,
        footer: commandFooter,
    });

    return buildSuccessResponse({
        reply: {
            flags: EPHEMERAL_MESSAGE_FLAG,
            ...messagePayload,
        },
        messagePayload,
    });
};

export const handleTicketThreadMessage = (message: BridgeMessage) => {
    if (
        typeof message.threadId !== 'string' ||
        typeof message.authorName !== 'string' ||
        typeof message.content !== 'string' ||
        typeof message.ts !== 'number'
    ) {
        console.verbose.warn('Dropped ticketThreadMessage bridge push with malformed payload.', message);
        return;
    }

    try {
        const ticket = txCore.database.tickets.findByDiscordThread(message.threadId);
        if (!ticket) {
            console.warn(
                `Received a Discord ticket message for thread ${message.threadId}, but no ticket is linked to that thread/channel ID.`,
            );
            return;
        }

        const ticketMessage = {
            author: message.authorName,
            authorType: 'discord' as const,
            content: message.content,
            imageUrls: Array.isArray(message.imageUrls)
                ? message.imageUrls.filter((entry): entry is string => typeof entry === 'string').slice(0, 3)
                : undefined,
            ts: message.ts,
        };
        txCore.database.tickets.addMessage(ticket.id, ticketMessage);
        txCore.fxRunner.sendEvent('ticketNewMessage', {
            ticketId: ticket.id,
            reporterLicense: ticket.reporter.license,
            message: ticketMessage,
        });
        broadcastTicketAddonEvent('ticketNewMessage', {
            ticketId: ticket.id,
            reporterLicense: ticket.reporter.license,
            message: ticketMessage,
        });
    } catch (error) {
        console.error(`Failed to process ticket message for thread ${String(message.threadId)}: ${emsg(error)}`);
    }
};

export const handleSxTicketsResolveReporterDiscord = (message: BridgeMessage) => {
    const requestedTicketId =
        typeof message.ticketId === 'string' ? normalizeTicketCommandTicketId(message.ticketId) : '';
    const requestedThreadId = typeof message.threadId === 'string' ? message.threadId.trim() : '';

    let ticket: DatabaseTicketType | null = null;
    if (requestedTicketId) {
        ticket = txCore.database.tickets.findOne(requestedTicketId);
    }
    if (!ticket && requestedThreadId) {
        ticket = txCore.database.tickets.findByDiscordThread(requestedThreadId);
    }
    if (!ticket) {
        return { ticketId: null, discordId: null };
    }

    let player: { ids: string[] } | null;
    try {
        player = txCore.database.players.findOne(ticket.reporter.license);
    } catch {
        player = null;
    }

    const discordIdentifier = player?.ids.find((id) => /^discord:\d{17,20}$/.test(id));
    return {
        ticketId: ticket.id,
        discordId: discordIdentifier ? discordIdentifier.slice('discord:'.length) : null,
    };
};

export const handleTicketCommand = (message: BridgeMessage, deps: TicketCommandDependencies) => {
    const permissionResult = resolveAdminPermission(message.requesterId, message.memberRoles, 'players.reports');
    if ('reply' in permissionResult) return permissionResult;

    if (!txConfig.gameFeatures.reportsEnabled) {
        return buildDeniedReply('warning', translateTicketCommand('reports_disabled'), 'feature_disabled');
    }

    const adminName = permissionResult.actorName;
    const subcommand = typeof message.subcommand === 'string' ? message.subcommand : '';

    if (subcommand === 'summary') {
        const normalizedTicketId = normalizeTicketCommandTicketId(message.ticketId);
        if (normalizedTicketId) {
            const ticket = txCore.database.tickets.findOne(normalizedTicketId);
            if (!ticket) {
                return buildDeniedReply(
                    'warning',
                    translateTicketCommand('ticket_not_found', { ticketId: normalizedTicketId }),
                    'invalid_target',
                );
            }

            return buildTicketCommandSummaryReply(ticket);
        }

        if (typeof message.threadId === 'string' && message.threadId.length) {
            const ticket = txCore.database.tickets.findByDiscordThread(message.threadId);
            if (!ticket) {
                return buildDeniedReply('warning', translateTicketCommand('thread_not_linked'), 'invalid_target');
            }

            return buildTicketCommandSummaryReply(ticket);
        }

        const analytics = txCore.database.tickets.getAnalytics(30);
        const activeTickets = txCore.database.tickets
            .findAll()
            .filter((ticket) => ticket.status === 'open' || ticket.status === 'inReview')
            .sort((left, right) => right.tsLastActivity - left.tsLastActivity);

        return buildEmbedReply(
            buildTicketQueueSummaryEmbed(analytics, activeTickets, {
                footer: commandFooter,
            }),
        );
    }

    const ticketResult = resolveTicketFromMessage(message);
    if ('reply' in ticketResult) return ticketResult;

    const ticket = ticketResult.ticket;

    if (subcommand === 'claim') {
        const nextClaimer = ticket.claimedBy === adminName ? null : adminName;
        const success = txCore.database.tickets.setClaimed(ticket.id, nextClaimer);
        if (!success) {
            return buildFailedReply('danger', translateTicketCommand('update_failed', { ticketId: ticket.id }));
        }

        txCore.database.tickets.addActivityEntry(ticket.id, {
            ts: now(),
            adminName,
            action: nextClaimer ? 'claimed' : 'unclaimed',
            details: nextClaimer ?? undefined,
        });
        logDiscordAdminAction(
            adminName,
            nextClaimer ? `Claimed ticket ${ticket.id}.` : `Unclaimed ticket ${ticket.id}.`,
            nextClaimer ? 'ticket.claim' : 'ticket.unclaim',
        );
        broadcastTicketAddonEvent('ticketClaimChanged', {
            ticketId: ticket.id,
            claimedBy: nextClaimer,
            adminName,
        });

        const updatedTicket = txCore.database.tickets.findOne(ticket.id) ?? {
            ...ticket,
            claimedBy: nextClaimer ?? undefined,
        };

        return buildTicketCommandSummaryReply(updatedTicket, {
            title: translateTicketCommand(nextClaimer ? 'claim_title' : 'unclaim_title', { ticketId: ticket.id }),
            note: nextClaimer
                ? translateTicketCommand('assigned_note', { adminName: escapeDiscordText(nextClaimer) })
                : translateTicketCommand('unassigned_note'),
            color: replyColors.success,
        });
    }

    if (subcommand === 'assign') {
        const assigneeDiscordId = typeof message.assigneeDiscordId === 'string' ? message.assigneeDiscordId.trim() : '';
        if (!assigneeDiscordId.length) {
            return buildDeniedReply('danger', translateTicketCommand('assign_missing_member'), 'invalid_request');
        }

        const assignee = txCore.adminStore.getAdminByProviderUID(assigneeDiscordId);
        if (!assignee) {
            return buildDeniedReply('warning', translateTicketCommand('assign_unlinked_member'), 'invalid_target');
        }

        if (ticket.claimedBy === assignee.name) {
            return buildTicketCommandSummaryReply(ticket, {
                title: translateTicketCommand('assignment_title', { ticketId: ticket.id }),
                note: translateTicketCommand('already_assigned_note', {
                    adminName: escapeDiscordText(assignee.name),
                }),
            });
        }

        const success = txCore.database.tickets.setClaimed(ticket.id, assignee.name);
        if (!success) {
            return buildFailedReply('danger', translateTicketCommand('assign_failed', { ticketId: ticket.id }));
        }

        txCore.database.tickets.addActivityEntry(ticket.id, {
            ts: now(),
            adminName,
            action: 'assigned',
            details: assignee.name,
        });
        logDiscordAdminAction(adminName, `Assigned ticket ${ticket.id} to ${assignee.name}.`, 'ticket.assign');
        broadcastTicketAddonEvent('ticketClaimChanged', {
            ticketId: ticket.id,
            claimedBy: assignee.name,
            adminName,
        });

        const updatedTicket = txCore.database.tickets.findOne(ticket.id) ?? {
            ...ticket,
            claimedBy: assignee.name,
        };

        return buildTicketCommandSummaryReply(updatedTicket, {
            title: translateTicketCommand('assigned_title', { ticketId: ticket.id }),
            note: translateTicketCommand('assigned_note', { adminName: escapeDiscordText(assignee.name) }),
            color: replyColors.success,
        });
    }

    if (subcommand === 'resolve') {
        if (ticket.status === 'resolved') {
            return withTelemetry(
                buildTicketCommandSummaryReply(ticket, {
                    title: translateTicketCommand('already_resolved_title', { ticketId: ticket.id }),
                    note: translateTicketCommand('already_resolved_note'),
                }),
                { outcome: 'denied', denialReason: 'invalid_target' },
            );
        }

        if (ticket.status === 'closed') {
            return withTelemetry(
                buildTicketCommandSummaryReply(ticket, {
                    title: translateTicketCommand('already_closed_title', { ticketId: ticket.id }),
                    note: translateTicketCommand('already_closed_note'),
                    color: replyColors.warning,
                }),
                { outcome: 'denied', denialReason: 'invalid_target' },
            );
        }

        const success = txCore.database.tickets.setStatus(ticket.id, 'resolved', adminName);
        if (!success) {
            return buildFailedReply('danger', translateTicketCommand('resolve_failed', { ticketId: ticket.id }));
        }

        txCore.database.tickets.addActivityEntry(ticket.id, {
            ts: now(),
            adminName,
            action: 'resolved',
        });
        logDiscordAdminAction(adminName, `Resolved ticket ${ticket.id}.`, 'ticket.resolve');
        broadcastTicketAddonEvent('ticketStatusChanged', {
            ticketId: ticket.id,
            status: 'resolved',
            previousStatus: ticket.status,
            adminName,
        });

        const updatedTicket = txCore.database.tickets.findOne(ticket.id) ?? {
            ...ticket,
            status: 'resolved',
            resolvedBy: adminName,
            tsResolved: now(),
        };
        void deps.sendAnnouncement({
            type: 'success',
            title: translateTicketCommand('resolved_announcement_title', { ticketId: ticket.id }),
            description: translateTicketCommand('resolved_announcement_description', {
                reporterName: escapeDiscordText(ticket.reporter.name),
                category: escapeDiscordText(ticket.category),
                adminName: escapeDiscordText(adminName),
            }),
        });

        return buildTicketCommandSummaryReply(updatedTicket, {
            title: translateTicketCommand('resolved_title', { ticketId: ticket.id }),
            note: translateTicketCommand('resolved_note', { adminName: escapeDiscordText(adminName) }),
            color: replyColors.success,
        });
    }

    if (subcommand === 'reopen') {
        if (ticket.status === 'open') {
            return withTelemetry(
                buildTicketCommandSummaryReply(ticket, {
                    title: translateTicketCommand('already_open_title', { ticketId: ticket.id }),
                    note: translateTicketCommand('already_open_note'),
                }),
                { outcome: 'denied', denialReason: 'invalid_target' },
            );
        }

        const success = txCore.database.tickets.setStatus(ticket.id, 'open');
        if (!success) {
            return buildFailedReply('danger', translateTicketCommand('reopen_failed', { ticketId: ticket.id }));
        }

        txCore.database.tickets.addActivityEntry(ticket.id, {
            ts: now(),
            adminName,
            action: 'reopened',
        });
        logDiscordAdminAction(adminName, `Reopened ticket ${ticket.id}.`, 'ticket.reopen');
        broadcastTicketAddonEvent('ticketStatusChanged', {
            ticketId: ticket.id,
            status: 'open',
            previousStatus: ticket.status,
            adminName,
        });

        const updatedTicket = txCore.database.tickets.findOne(ticket.id) ?? {
            ...ticket,
            status: 'open',
            resolvedBy: undefined,
            tsResolved: undefined,
        };

        return buildTicketCommandSummaryReply(updatedTicket, {
            title: translateTicketCommand('reopened_title', { ticketId: ticket.id }),
            note: translateTicketCommand('reopened_note', { adminName: escapeDiscordText(adminName) }),
            color: replyColors.info,
        });
    }

    return buildDeniedReply(
        'danger',
        translateTicketCommand('subcommand_not_found', { subcommand }),
        'invalid_request',
    );
};
