const { ChannelType, SlashCommandBuilder } = require('discord.js');
const { normalizeMessageEditPayload } = require('../../componentsV2');
const { request } = require('../../bridge/requests');
const {
    buildReply,
    getRequesterPayload,
    resolveBridgeReply,
    sendBridgeError,
    sendInteractionReply,
    translateBot,
} = require('./common');

const staleStoredEmbedErrorCodes = new Set([10003, 10008, 'StoredChannelNotFound']);

const getErrorCode = (error) => {
    return error && typeof error === 'object' && 'code' in error ? error.code : undefined;
};

const isStaleStoredEmbedError = (error) => {
    return staleStoredEmbedErrorCodes.has(getErrorCode(error));
};

const getStoredEmbedChannel = async (source, client, channelId, embedLabel) => {
    const oldChannel = await client.channels.fetch(channelId).catch((error) => {
        if (isStaleStoredEmbedError(error)) return null;
        throw error;
    });
    if (!oldChannel) {
        const error = new Error(translateBot(source, 'persistent_embed.channel_not_found', { channelId }));
        error.code = 'StoredChannelNotFound';
        throw error;
    }

    if (oldChannel.type !== ChannelType.GuildText && oldChannel.type !== ChannelType.GuildAnnouncement) {
        throw new Error(translateBot(source, 'persistent_embed.stored_channel_not_supported', { embedLabel }));
    }

    return oldChannel;
};

const deleteStoredEmbedMessage = async (source, client, channelId, messageId, embedLabel) => {
    const oldChannel = await getStoredEmbedChannel(source, client, channelId, embedLabel);
    await oldChannel.messages.delete(messageId);
};

const editStoredEmbedMessage = async (source, client, channelId, messageId, embedLabel, messagePayload) => {
    const oldChannel = await getStoredEmbedChannel(source, client, channelId, embedLabel);
    await oldChannel.messages.edit(messageId, normalizeMessageEditPayload(messagePayload));
};

const createPersistentEmbedCommand = ({
    commandName,
    description,
    addDescription,
    removeDescription,
    embedTarget,
    localeKey,
}) => {
    return {
        data: new SlashCommandBuilder()
            .setName(commandName)
            .setDescription(description)
            .addSubcommand((subcommand) => {
                return subcommand.setName('add').setDescription(addDescription);
            })
            .addSubcommand((subcommand) => {
                return subcommand.setName('remove').setDescription(removeDescription);
            }),
        async execute(interaction) {
            const subcommand = interaction.options.getSubcommand();
            const embedLabel = translateBot(interaction, `persistent_embed.${localeKey}.lower_name`);
            const savedReply = translateBot(interaction, `persistent_embed.${localeKey}.saved`);
            const removedReply = translateBot(interaction, `persistent_embed.${localeKey}.removed`);
            const requesterPayload = {
                target: embedTarget,
                ...getRequesterPayload(interaction),
            };

            try {
                const stateResponse = await request('persistentEmbedCommand', {
                    action: 'getState',
                    ...requesterPayload,
                });
                if (await resolveBridgeReply(interaction, stateResponse)) return;

                const hasStoredEmbed =
                    typeof stateResponse?.channelId === 'string' && typeof stateResponse?.messageId === 'string';

                if (subcommand === 'remove') {
                    if (!hasStoredEmbed) {
                        await sendInteractionReply(
                            interaction,
                            buildReply(
                                'warning',
                                translateBot(interaction, 'persistent_embed.failed_remove_no_saved_message', {
                                    embedLabel,
                                }),
                                true,
                            ),
                        );
                        return;
                    }

                    try {
                        await deleteStoredEmbedMessage(
                            interaction,
                            interaction.client,
                            stateResponse.channelId,
                            stateResponse.messageId,
                            embedLabel,
                        );
                    } catch (error) {
                        await sendInteractionReply(
                            interaction,
                            buildReply(
                                'warning',
                                translateBot(interaction, 'persistent_embed.failed_remove_error', {
                                    embedLabel,
                                    message: error instanceof Error ? error.message : String(error),
                                }),
                                true,
                            ),
                        );
                        return;
                    }

                    const clearResponse = await request('persistentEmbedCommand', {
                        action: 'clearLocation',
                        ...requesterPayload,
                    });
                    if (await resolveBridgeReply(interaction, clearResponse)) return;

                    await sendInteractionReply(interaction, buildReply('success', removedReply, true));
                    return;
                }

                if (
                    interaction.channel?.type !== ChannelType.GuildText &&
                    interaction.channel?.type !== ChannelType.GuildAnnouncement
                ) {
                    await sendInteractionReply(
                        interaction,
                        buildReply('danger', translateBot(interaction, 'common.channel_type_not_supported'), true),
                    );
                    return;
                }

                const messageResponse = await request('persistentEmbedCommand', {
                    action: 'getMessage',
                    ...requesterPayload,
                });
                if (await resolveBridgeReply(interaction, messageResponse)) return;
                if (!messageResponse?.messagePayload) {
                    throw new Error(translateBot(interaction, 'persistent_embed.no_bridge_payload', { embedLabel }));
                }

                if (hasStoredEmbed && stateResponse.channelId === interaction.channelId) {
                    try {
                        await editStoredEmbedMessage(
                            interaction,
                            interaction.client,
                            stateResponse.channelId,
                            stateResponse.messageId,
                            embedLabel,
                            messageResponse.messagePayload,
                        );
                        const saveResponse = await request('persistentEmbedCommand', {
                            action: 'saveLocation',
                            ...requesterPayload,
                            channelId: stateResponse.channelId,
                            messageId: stateResponse.messageId,
                        });
                        if (await resolveBridgeReply(interaction, saveResponse)) return;

                        await sendInteractionReply(interaction, buildReply('success', savedReply, true));
                        return;
                    } catch (error) {
                        if (!isStaleStoredEmbedError(error)) {
                            await sendInteractionReply(
                                interaction,
                                buildReply(
                                    'warning',
                                    translateBot(interaction, 'persistent_embed.failed_remove_error', {
                                        embedLabel,
                                        message: error instanceof Error ? error.message : String(error),
                                    }),
                                    true,
                                ),
                            );
                            return;
                        }
                    }
                }

                if (hasStoredEmbed) {
                    try {
                        await deleteStoredEmbedMessage(
                            interaction,
                            interaction.client,
                            stateResponse.channelId,
                            stateResponse.messageId,
                            embedLabel,
                        );
                    } catch (error) {
                        if (!isStaleStoredEmbedError(error)) {
                            await sendInteractionReply(
                                interaction,
                                buildReply(
                                    'warning',
                                    translateBot(interaction, 'persistent_embed.failed_remove_error', {
                                        embedLabel,
                                        message: error instanceof Error ? error.message : String(error),
                                    }),
                                    true,
                                ),
                            );
                            return;
                        }
                    }

                    const clearResponse = await request('persistentEmbedCommand', {
                        action: 'clearLocation',
                        logAction: false,
                        ...requesterPayload,
                    });
                    if (clearResponse?.reply) {
                        await resolveBridgeReply(interaction, clearResponse);
                        return;
                    }
                }

                const newMessage = await interaction.channel.send(
                    buildReply('warning', translateBot(interaction, 'persistent_embed.placeholder_message')),
                );
                await newMessage.edit(normalizeMessageEditPayload(messageResponse.messagePayload));

                const saveResponse = await request('persistentEmbedCommand', {
                    action: 'saveLocation',
                    ...requesterPayload,
                    channelId: interaction.channelId,
                    messageId: newMessage.id,
                });
                if (await resolveBridgeReply(interaction, saveResponse)) return;

                await sendInteractionReply(interaction, buildReply('success', savedReply, true));
            } catch (error) {
                await sendBridgeError(interaction, `/${commandName}`, error);
            }
        },
    };
};

module.exports = {
    createPersistentEmbedCommand,
};
