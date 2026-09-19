const { ActionRowBuilder, MessageFlags, UserSelectMenuBuilder } = require('discord.js');
const {
    normalizeInteractionUpdatePayload,
    normalizeMessageEditPayload,
    normalizeMessagePayload,
} = require('../../componentsV2');
const { request } = require('../../bridge/requests');
const { buildReply, getRequesterPayload, translateBot } = require('../../commands/_sxpanel/common');
const {
    buildCommandTelemetryEvent,
    createCommandTelemetryContext,
    instrumentInteractionAck,
    markCommandDenied,
    markCommandFailure,
    runWithCommandTelemetry,
} = require('../../telemetry');

const playerListPageButtonPrefix = 'sxpanel:playerList:page:';
const legacyPlayerListPageButtonPrefix = 'fxpanel:playerList:page:';
const playerListPageButtonPrefixes = [playerListPageButtonPrefix, legacyPlayerListPageButtonPrefix];
const ticketInteractionPrefix = 'sxpanel:ticket:';
const legacyTicketInteractionPrefix = 'fxpanel:ticket:';
const ticketInteractionPrefixes = [ticketInteractionPrefix, legacyTicketInteractionPrefix];
const ticketAssignSelectAction = 'assignSelect';
const supportedTicketActions = new Set(['summary', 'claim', 'assign', 'resolve', 'reopen']);

const t = (source, key, params = {}) => {
    return translateBot(source, key, params);
};

const getRetryAfterSeconds = (resetAt) => {
    if (typeof resetAt !== 'number') return 1;

    return Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
};

const recordAddonRuntimeIssue = (client, issue) => {
    if (typeof client.sxpanel?.recordAddonRuntimeIssue !== 'function') return;

    client.sxpanel.recordAddonRuntimeIssue({
        ...issue,
        updatedAt: Date.now(),
    });
};

const buildAddonRateLimitReply = (interactionType, resetAt) => {
    const retryAfterSeconds = getRetryAfterSeconds(resetAt);
    return buildReply(
        'warning',
        t(null, 'interaction.addon.rate_limited', { interactionType, retryAfterSeconds }),
        true,
    );
};

const sendAddonInteractionReply = async (interaction, type, message) => {
    if (!interaction?.isRepliable?.()) return;

    const payload = buildReply(type, message, true);
    if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload).catch(() => {});
        return;
    }

    await interaction.reply(payload).catch(() => {});
};

const getAddonInteractionType = (interaction) => {
    if (interaction.isButton()) return 'button';
    if (interaction.isModalSubmit()) return 'modal';
    if (interaction.isStringSelectMenu()) return 'stringSelectMenu';
    if (interaction.isUserSelectMenu()) return 'userSelectMenu';
    if (interaction.isRoleSelectMenu()) return 'roleSelectMenu';
    if (interaction.isMentionableSelectMenu()) return 'mentionableSelectMenu';
    if (interaction.isChannelSelectMenu()) return 'channelSelectMenu';

    return null;
};

const getPlayerListPageButtonPrefix = (customId) => {
    return typeof customId === 'string'
        ? playerListPageButtonPrefixes.find((prefix) => customId.startsWith(prefix))
        : undefined;
};

const getTicketInteractionPrefix = (customId) => {
    return typeof customId === 'string'
        ? ticketInteractionPrefixes.find((prefix) => customId.startsWith(prefix))
        : undefined;
};

const isAddonInteractionTypeMatch = (interaction, expectedType) => {
    return getAddonInteractionType(interaction) === expectedType;
};

const handleAddonAutocomplete = async (interaction, client, bridge) => {
    const command = client.commands.get(interaction.commandName);
    if (!command || typeof command.autocomplete !== 'function') {
        await interaction.respond([]).catch(() => {});
        return true;
    }

    const addonCommand = client.sxpanel.getAddonCommandMetadata(interaction.commandName);
    if (addonCommand) {
        const rateLimitResult = client.sxpanel.consumeAddonRateLimit({
            addonId: addonCommand.addonId,
            handlerId: `autocomplete:${interaction.commandName}`,
            requesterId: interaction.user?.id,
            rateLimit: addonCommand.autocompleteRateLimit,
        });
        if (rateLimitResult.limited) {
            recordAddonRuntimeIssue(client, {
                addonId: addonCommand.addonId,
                interactionType: 'autocomplete',
                phase: 'rate_limit',
                handlerId: interaction.commandName,
                filePath: addonCommand.filePath,
                message: `Autocomplete for /${interaction.commandName} exceeded the configured rate limit.`,
            });
            await interaction.respond([]).catch(() => {});
            return true;
        }
    }

    try {
        await command.autocomplete(
            interaction,
            bridge,
            addonCommand
                ? {
                      addonId: addonCommand.addonId,
                      commandName: interaction.commandName,
                      filePath: addonCommand.filePath,
                  }
                : undefined,
        );
    } catch (error) {
        if (addonCommand) {
            recordAddonRuntimeIssue(client, {
                addonId: addonCommand.addonId,
                interactionType: 'autocomplete',
                phase: 'execute',
                handlerId: interaction.commandName,
                filePath: addonCommand.filePath,
                message: error instanceof Error ? error.message : String(error),
            });
        }

        console.error(`[Bot] Error executing autocomplete for /${interaction.commandName}:`, error);
        await interaction.respond([]).catch(() => {});
    }

    return true;
};

const handleAddonComponentInteraction = async (interaction, client, bridge) => {
    const resolved = client.sxpanel.resolveAddonInteraction(interaction.customId);
    if (!resolved) return false;

    const { parsed, handler } = resolved;
    const interactionType = getAddonInteractionType(interaction);
    if (!interactionType || !isAddonInteractionTypeMatch(interaction, parsed.kind)) {
        recordAddonRuntimeIssue(client, {
            addonId: parsed.addonId,
            interactionType: parsed.kind,
            phase: 'execute',
            handlerId: parsed.action,
            message: `Received ${interactionType ?? 'unknown'} interaction for ${parsed.kind} handler ${parsed.action}.`,
        });
        await sendAddonInteractionReply(
            interaction,
            'warning',
            t(interaction, 'interaction.addon.wrong_component_type'),
        );
        return true;
    }

    if (!handler) {
        recordAddonRuntimeIssue(client, {
            addonId: parsed.addonId,
            interactionType: parsed.kind,
            phase: 'execute',
            handlerId: parsed.action,
            message: `No handler is registered for addon interaction ${parsed.action}.`,
        });
        await sendAddonInteractionReply(interaction, 'warning', t(interaction, 'interaction.addon.no_handler'));
        return true;
    }

    const rateLimitResult = client.sxpanel.consumeAddonRateLimit({
        addonId: handler.addonId,
        handlerId: `${parsed.kind}:${parsed.action}`,
        requesterId: interaction.user?.id,
        rateLimit: handler.rateLimit,
    });
    if (rateLimitResult.limited) {
        recordAddonRuntimeIssue(client, {
            addonId: handler.addonId,
            interactionType: parsed.kind,
            phase: 'rate_limit',
            handlerId: parsed.action,
            filePath: handler.filePath,
            message: `Addon ${parsed.kind} handler ${parsed.action} exceeded the configured rate limit.`,
        });

        await sendAddonInteractionReply(
            interaction,
            'warning',
            t(interaction, 'interaction.addon.rate_limited', {
                interactionType: parsed.kind,
                retryAfterSeconds: getRetryAfterSeconds(rateLimitResult.resetAt),
            }),
        );
        return true;
    }

    try {
        await handler.execute(interaction, bridge, {
            addonId: handler.addonId,
            action: parsed.action,
            kind: parsed.kind,
            state: parsed.state,
            rawState: parsed.rawState,
            commandName: handler.commandName,
            filePath: handler.filePath,
        });
    } catch (error) {
        recordAddonRuntimeIssue(client, {
            addonId: handler.addonId,
            interactionType: parsed.kind,
            phase: 'execute',
            handlerId: parsed.action,
            filePath: handler.filePath,
            message: error instanceof Error ? error.message : String(error),
        });

        await sendAddonInteractionReply(
            interaction,
            'danger',
            t(interaction, 'interaction.addon.execute_failed', {
                interactionType: parsed.kind,
                message: error instanceof Error ? error.message : String(error),
            }),
        );
    }

    return true;
};

const parseTicketInteractionId = (customId) => {
    if (!getTicketInteractionPrefix(customId)) return null;

    const parts = customId.split(':');
    if (parts.length < 4 || !['sxpanel', 'fxpanel'].includes(parts[0]) || parts[1] !== 'ticket') return null;

    const action = parts[2];
    const ticketId = parts[3];
    if (!ticketId) return null;

    if (action === ticketAssignSelectAction) {
        const targetMessageId = parts[4];
        return targetMessageId ? { action, ticketId, targetMessageId } : null;
    }

    if (!supportedTicketActions.has(action)) return null;
    return { action, ticketId };
};

const getTicketThreadId = (interaction) => {
    return interaction.channel && typeof interaction.channel.isThread === 'function' && interaction.channel.isThread()
        ? interaction.channelId
        : undefined;
};

const toInteractionUpdatePayload = (payload) => {
    return normalizeInteractionUpdatePayload(payload);
};

const buildAssignPickerReply = (source, ticketId, targetMessageId) => {
    const reply = buildReply('info', t(source, 'interaction.ticket.assign_prompt'), true);
    const menu = new UserSelectMenuBuilder()
        .setCustomId(`${ticketInteractionPrefix}${ticketAssignSelectAction}:${ticketId}:${targetMessageId}`)
        .setPlaceholder(t(source, 'interaction.ticket.assign_placeholder'))
        .setMinValues(1)
        .setMaxValues(1);

    return {
        ...reply,
        components: [
            ...(Array.isArray(reply.components) ? reply.components : []),
            new ActionRowBuilder().addComponents(menu).toJSON(),
        ],
    };
};

const editSourceTicketMessage = async (interaction, messageId, messagePayload) => {
    if (!messageId || !messagePayload || !interaction.channel?.messages?.edit) return false;

    try {
        await interaction.channel.messages.edit(messageId, normalizeMessageEditPayload(messagePayload));
        return true;
    } catch {
        return false;
    }
};

const handlePlayerListPageButton = async (interaction) => {
    const matchingPrefix = getPlayerListPageButtonPrefix(interaction.customId);
    const rawPage = matchingPrefix ? interaction.customId.slice(matchingPrefix.length) : '';
    if (!/^\d+$/.test(rawPage) || !interaction.message?.id) {
        await interaction
            .reply(buildReply('warning', t(interaction, 'interaction.player_list.invalid_request'), true))
            .catch(() => {});
        return;
    }

    try {
        const response = await request('persistentEmbedPage', {
            target: 'playerList',
            page: Number.parseInt(rawPage, 10),
            channelId: interaction.channelId,
            messageId: interaction.message.id,
        });

        if (response?.reply) {
            await interaction.reply(normalizeMessagePayload(response.reply)).catch(() => {});
            return;
        }
        if (!response?.messagePayload) {
            await interaction
                .reply(buildReply('warning', t(interaction, 'interaction.player_list.no_updated_payload'), true))
                .catch(() => {});
            return;
        }

        await interaction.update(toInteractionUpdatePayload(response.messagePayload));
    } catch (error) {
        const message = t(interaction, 'interaction.player_list.change_failed', {
            message: error instanceof Error ? error.message : String(error),
        });
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(buildReply('danger', message, true)).catch(() => {});
            return;
        }

        await interaction.reply(buildReply('danger', message, true)).catch(() => {});
    }
};

const handleTicketButton = async (interaction) => {
    const parsed = parseTicketInteractionId(interaction.customId);
    if (!parsed || parsed.action === ticketAssignSelectAction) {
        await interaction
            .reply(buildReply('warning', t(interaction, 'interaction.ticket.invalid_request'), true))
            .catch(() => {});
        return;
    }

    if (parsed.action === 'assign') {
        const targetMessageId = interaction.message?.id ?? '0';
        await interaction.reply(buildAssignPickerReply(interaction, parsed.ticketId, targetMessageId)).catch(() => {});
        return;
    }

    try {
        const response = await request('ticketCommand', {
            subcommand: parsed.action,
            ticketId: parsed.ticketId,
            threadId: getTicketThreadId(interaction),
            ...getRequesterPayload(interaction),
        });

        if (response?.messagePayload) {
            await interaction.update(toInteractionUpdatePayload(response.messagePayload));
            return;
        }

        if (response?.reply) {
            await interaction.reply(normalizeMessagePayload(response.reply)).catch(() => {});
            return;
        }

        await interaction
            .reply(buildReply('warning', t(interaction, 'interaction.ticket.no_updated_payload'), true))
            .catch(() => {});
    } catch (error) {
        const message = t(interaction, 'interaction.ticket.action_failed', {
            message: error instanceof Error ? error.message : String(error),
        });
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(buildReply('danger', message, true)).catch(() => {});
            return;
        }

        await interaction.reply(buildReply('danger', message, true)).catch(() => {});
    }
};

const handleTicketAssignSelect = async (interaction) => {
    const parsed = parseTicketInteractionId(interaction.customId);
    const assigneeDiscordId = Array.isArray(interaction.values) ? interaction.values[0] : undefined;
    if (!parsed || parsed.action !== ticketAssignSelectAction || !assigneeDiscordId) {
        await interaction
            .update(
                toInteractionUpdatePayload(
                    buildReply('warning', t(interaction, 'interaction.ticket.select_member'), true),
                ),
            )
            .catch(() => {});
        return;
    }

    try {
        const response = await request('ticketCommand', {
            subcommand: 'assign',
            ticketId: parsed.ticketId,
            assigneeDiscordId,
            threadId: getTicketThreadId(interaction),
            ...getRequesterPayload(interaction),
        });

        if (response?.messagePayload) {
            await editSourceTicketMessage(interaction, parsed.targetMessageId, response.messagePayload);
        }

        const replyPayload = response?.reply ? toInteractionUpdatePayload(response.reply) : null;
        if (replyPayload) {
            await interaction.update(replyPayload);
            return;
        }

        if (response?.messagePayload) {
            await interaction
                .update(
                    toInteractionUpdatePayload(
                        buildReply(
                            'success',
                            t(interaction, 'interaction.ticket.updated', { ticketId: parsed.ticketId }),
                            true,
                        ),
                    ),
                )
                .catch(() => {});
            return;
        }

        await interaction
            .update(
                toInteractionUpdatePayload(
                    buildReply('warning', t(interaction, 'interaction.ticket.no_assignment_payload'), true),
                ),
            )
            .catch(() => {});
    } catch (error) {
        const message = t(interaction, 'interaction.ticket.assignment_failed', {
            message: error instanceof Error ? error.message : String(error),
        });
        await interaction.update(toInteractionUpdatePayload(buildReply('danger', message, true))).catch(() => {});
    }
};

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client, bridge) {
        if (interaction.user?.bot) return;

        if (interaction.isAutocomplete()) {
            await handleAddonAutocomplete(interaction, client, bridge);
            return;
        }

        if (interaction.isButton() && getPlayerListPageButtonPrefix(interaction.customId)) {
            await handlePlayerListPageButton(interaction);
            return;
        }

        if (interaction.isButton() && getTicketInteractionPrefix(interaction.customId)) {
            await handleTicketButton(interaction);
            return;
        }

        if (interaction.isUserSelectMenu() && getTicketInteractionPrefix(interaction.customId)) {
            await handleTicketAssignSelect(interaction);
            return;
        }

        if (interaction.customId) {
            const wasAddonInteractionHandled = await handleAddonComponentInteraction(interaction, client, bridge);
            if (wasAddonInteractionHandled) {
                return;
            }
        }

        if (!interaction.isChatInputCommand()) {
            if (interaction.isRepliable()) {
                const identifier = interaction.customId ?? 'unknown';
                await interaction
                    .reply(
                        buildReply(
                            'warning',
                            t(interaction, 'common.no_handler_interaction', {
                                interactionType: interaction.type,
                                identifier,
                            }),
                            true,
                        ),
                    )
                    .catch(() => {});
            }
            return;
        }

        const command = client.commands.get(interaction.commandName);
        if (!command) {
            const telemetryContext = createCommandTelemetryContext(interaction.commandName);
            const restoreInteractionAck = instrumentInteractionAck(interaction, telemetryContext);
            markCommandDenied(telemetryContext, 'invalid_request');

            await interaction
                .reply(
                    buildReply(
                        'warning',
                        t(interaction, 'common.no_handler_command', { commandName: interaction.commandName }),
                        true,
                    ),
                )
                .catch(() => {});

            restoreInteractionAck();
            bridge.send({
                type: 'botCommandTelemetry',
                payload: buildCommandTelemetryEvent(telemetryContext),
            });
            return;
        }

        const telemetryContext = createCommandTelemetryContext(interaction.commandName);
        const restoreInteractionAck = instrumentInteractionAck(interaction, telemetryContext);
        const addonCommand = client.sxpanel.getAddonCommandMetadata(interaction.commandName);

        try {
            if (addonCommand) {
                const rateLimitResult = client.sxpanel.consumeAddonRateLimit({
                    addonId: addonCommand.addonId,
                    handlerId: `command:${interaction.commandName}`,
                    requesterId: interaction.user?.id,
                    rateLimit: addonCommand.rateLimit,
                });
                if (rateLimitResult.limited) {
                    markCommandDenied(telemetryContext, 'rate_limited');
                    recordAddonRuntimeIssue(client, {
                        addonId: addonCommand.addonId,
                        interactionType: 'command',
                        phase: 'rate_limit',
                        handlerId: interaction.commandName,
                        filePath: addonCommand.filePath,
                        message: `/${interaction.commandName} exceeded the configured rate limit.`,
                    });
                    await interaction
                        .reply(buildAddonRateLimitReply('command', rateLimitResult.resetAt))
                        .catch(() => {});
                    return;
                }
            }

            bridge.send({
                type: 'botCommandUsage',
                commandName: interaction.commandName,
            });

            // Ack immediately so a slow bridge/database round-trip inside command.execute()
            // can never blow Discord's 3s interaction window ("The application did not respond").
            // Command reply helpers (sendInteractionReply) know how to turn this into the
            // right final message regardless of its eventual public/ephemeral visibility.
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            await runWithCommandTelemetry(telemetryContext, async () => {
                await command.execute(interaction, bridge);
            });
        } catch (error) {
            markCommandFailure(telemetryContext, error);
            if (addonCommand) {
                recordAddonRuntimeIssue(client, {
                    addonId: addonCommand.addonId,
                    interactionType: 'command',
                    phase: 'execute',
                    handlerId: interaction.commandName,
                    filePath: addonCommand.filePath,
                    message: error instanceof Error ? error.message : String(error),
                });
            }
            const message = `Error executing /${interaction.commandName}: ${error instanceof Error ? error.message : String(error)}`;
            const localizedMessage = t(interaction, 'common.error_executing_command', {
                commandName: interaction.commandName,
                message: error instanceof Error ? error.message : String(error),
            });
            console.error('[Bot] ' + message);

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(buildReply('danger', localizedMessage, true)).catch(() => {});
                return;
            }

            await interaction.reply(buildReply('danger', localizedMessage, true)).catch(() => {});
        } finally {
            restoreInteractionAck();
            bridge.send({
                type: 'botCommandTelemetry',
                payload: buildCommandTelemetryEvent(telemetryContext),
            });
        }
    },
};
