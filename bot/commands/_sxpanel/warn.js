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
            .setName('warn')
            .setDescription('Warn a player using your linked sxPanel account permissions.'),
        {
            member: 'Warn the player linked to a Discord member.',
            id: 'Warn a player by identifier.',
        },
        (subcommand) => {
            return subcommand.addStringOption((option) => {
                return option
                    .setName('reason')
                    .setDescription('Reason for the warning.')
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
                command: 'warn',
                searchId: result.searchId,
                reason: interaction.options.getString('reason', true).trim(),
                ...getRequesterPayload(interaction),
            });

            if (await resolveBridgeReply(interaction, response)) return;
            throw getNoReplyPayloadError(interaction, '/warn');
        } catch (error) {
            await sendBridgeError(interaction, '/warn', error);
        }
    },
};
