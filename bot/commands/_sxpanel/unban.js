const { SlashCommandBuilder } = require('discord.js');
const { request } = require('../../bridge/requests');
const {
    buildReply,
    getNoReplyPayloadError,
    getRequesterPayload,
    resolveBridgeReply,
    resolveSearchId,
    sendBridgeError,
    sendInteractionReply,
    translateBot,
} = require('./common');
const { addTargetSubcommands } = require('./moderationCommon');

const data = new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Revoke an active player ban using your linked sxPanel account permissions.')
    .addSubcommand((subcommand) => {
        return subcommand
            .setName('action')
            .setDescription('Revoke a ban by action ID.')
            .addStringOption((option) => {
                return option
                    .setName('action_id')
                    .setDescription('Ban action ID (for example B1234).')
                    .setRequired(true)
                    .setMinLength(2)
                    .setMaxLength(16);
            })
            .addStringOption((option) => {
                return option
                    .setName('reason')
                    .setDescription('Optional revocation reason.')
                    .setRequired(false)
                    .setMaxLength(300);
            });
    });

addTargetSubcommands(
    data,
    {
        member: 'Revoke the active ban for the player linked to a Discord member.',
        id: 'Revoke the active ban for a player by identifier.',
    },
    (subcommand) => {
        return subcommand.addStringOption((option) => {
            return option
                .setName('reason')
                .setDescription('Optional revocation reason.')
                .setRequired(false)
                .setMaxLength(300);
        });
    },
);

module.exports = {
    data,
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        try {
            let response;
            if (subcommand === 'action') {
                response = await request('moderationCommand', {
                    command: 'unban',
                    actionId: interaction.options.getString('action_id', true).trim().toUpperCase(),
                    reason: interaction.options.getString('reason')?.trim(),
                    ...getRequesterPayload(interaction),
                });
            } else if (subcommand === 'member' || subcommand === 'id' || subcommand === 'serverid') {
                const result = resolveSearchId(interaction);
                if (result.errorReply) {
                    await sendInteractionReply(interaction, result.errorReply);
                    return;
                }

                response = await request('moderationCommand', {
                    command: 'unban',
                    searchId: result.searchId,
                    reason: interaction.options.getString('reason')?.trim(),
                    ...getRequesterPayload(interaction),
                });
            } else {
                await sendInteractionReply(
                    interaction,
                    buildReply(
                        'danger',
                        translateBot(interaction, 'common.subcommand_not_found', { subcommand }),
                        true,
                    ),
                );
                return;
            }

            if (await resolveBridgeReply(interaction, response)) return;
            throw getNoReplyPayloadError(interaction, '/unban');
        } catch (error) {
            await sendBridgeError(interaction, '/unban', error);
        }
    },
};
