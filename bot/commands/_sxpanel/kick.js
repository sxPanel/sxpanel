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
            .setName('kick')
            .setDescription('Kick a connected player using your linked sxPanel account permissions.'),
        {
            member: 'Kick the player linked to a Discord member.',
            id: 'Kick a player by identifier.',
        },
        (subcommand) => {
            return subcommand.addStringOption((option) => {
                return option
                    .setName('reason')
                    .setDescription('Reason for the kick.')
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
                command: 'kick',
                searchId: result.searchId,
                reason: interaction.options.getString('reason', true).trim(),
                ...getRequesterPayload(interaction),
            });

            if (await resolveBridgeReply(interaction, response)) return;
            throw getNoReplyPayloadError(interaction, '/kick');
        } catch (error) {
            await sendBridgeError(interaction, '/kick', error);
        }
    },
};
