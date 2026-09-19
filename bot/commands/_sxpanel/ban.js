const { SlashCommandBuilder } = require('discord.js');
const { request } = require('../../bridge/requests');
const {
    getNoReplyPayloadError,
    getRequesterPayload,
    resolveBridgeReply,
    resolveSearchId,
    sendBridgeError,
    sendInteractionReply,
} = require('./common');
const { addTargetSubcommands } = require('./moderationCommon');

module.exports = {
    data: addTargetSubcommands(
        new SlashCommandBuilder()
            .setName('ban')
            .setDescription('Ban a player using your linked sxPanel account permissions.'),
        {
            member: 'Ban the player linked to a Discord member.',
            id: 'Ban a player by identifier.',
        },
        (subcommand) => {
            return subcommand
                .addStringOption((option) => {
                    return option
                        .setName('duration')
                        .setDescription('Ban duration such as "1 day", "2 weeks", or "permanent".')
                        .setRequired(true)
                        .setMaxLength(40);
                })
                .addStringOption((option) => {
                    return option
                        .setName('reason')
                        .setDescription('Reason for the ban.')
                        .setRequired(true)
                        .setMaxLength(300);
                });
        },
    ),
    async execute(interaction) {
        const result = resolveSearchId(interaction);
        if (result.errorReply) {
            await sendInteractionReply(interaction, result.errorReply);
            return;
        }

        try {
            const response = await request('moderationCommand', {
                command: 'ban',
                searchId: result.searchId,
                duration: interaction.options.getString('duration', true).trim(),
                reason: interaction.options.getString('reason', true).trim(),
                ...getRequesterPayload(interaction),
            });

            if (await resolveBridgeReply(interaction, response)) return;
            throw getNoReplyPayloadError(interaction, '/ban');
        } catch (error) {
            await sendBridgeError(interaction, '/ban', error);
        }
    },
};
