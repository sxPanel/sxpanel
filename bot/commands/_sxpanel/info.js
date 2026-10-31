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

module.exports = {
    data: new SlashCommandBuilder()
        .setName('info')
        .setDescription('Searches for a player in the sxPanel database and prints information.')
        .addSubcommand((subcommand) => {
            return subcommand.setName('self').setDescription('Searches for whomever is using the command.');
        })
        .addSubcommand((subcommand) => {
            return subcommand
                .setName('member')
                .setDescription('Searches for a player with matching Discord ID.')
                .addUserOption((option) => {
                    return option
                        .setName('member')
                        .setDescription('The member that will be searched for.')
                        .setRequired(true);
                });
        })
        .addSubcommand((subcommand) => {
            return subcommand
                .setName('id')
                .setDescription('Searches for an identifier.')
                .addStringOption((option) => {
                    return option
                        .setName('id')
                        .setDescription('The ID to search for (eg fivem:271816).')
                        .setRequired(true)
                        .setMinLength(5);
                });
        }),
    async execute(interaction) {
        const result = resolveSearchId(interaction);
        if (result.errorReply) {
            await sendInteractionReply(interaction, result.errorReply);
            return;
        }

        try {
            const response = await request('playerLookup', {
                searchId: result.searchId,
                adminView: false,
                ...getRequesterPayload(interaction),
            });
            if (await resolveBridgeReply(interaction, response)) return;

            throw getNoReplyPayloadError(interaction, '/info');
        } catch (error) {
            await sendBridgeError(interaction, '/info', error);
        }
    },
};
