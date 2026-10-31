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
            .setName('history')
            .setDescription('Show recent moderation history using your linked sxPanel account.'),
        {
            self: 'Show your linked player history.',
            member: 'Show history for the player linked to a Discord member.',
            id: 'Show history for a player by identifier.',
        },
        (subcommand) => {
            return subcommand.addIntegerOption((option) => {
                return option
                    .setName('limit')
                    .setDescription('How many recent actions to show (default 5, max 10).')
                    .setRequired(false)
                    .setMinValue(1)
                    .setMaxValue(10);
            });
        },
        { includeSelf: true },
    ),
    async execute(interaction) {
        const result = resolveSearchId(interaction);
        if (result.errorReply) {
            await sendInteractionReply(interaction, result.errorReply);
            return;
        }

        try {
            const response = await request('moderationCommand', {
                command: 'history',
                searchId: result.searchId,
                limit: interaction.options.getInteger('limit') ?? undefined,
                ...getRequesterPayload(interaction),
            });

            if (await resolveBridgeReply(interaction, response)) return;
            throw getNoReplyPayloadError(interaction, '/history');
        } catch (error) {
            await sendBridgeError(interaction, '/history', error);
        }
    },
};
