const { SlashCommandBuilder } = require('discord.js');
const { request } = require('../../bridge/requests');
const {
    buildReply,
    getNoReplyPayloadError,
    getRequesterPayload,
    resolveBridgeReply,
    sendBridgeError,
    sendInteractionReply,
    translateBot,
} = require('./common');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('whitelist')
        .setDescription('Whitelist embed commands.')
        .addSubcommand((subcommand) => {
            return subcommand
                .setName('member')
                .setDescription('Adds a member to the whitelist approvals.')
                .addUserOption((option) => {
                    return option
                        .setName('member')
                        .setDescription('The member that will be whitelisted.')
                        .setRequired(true);
                });
        })
        .addSubcommand((subcommand) => {
            return subcommand
                .setName('application')
                .setDescription('Approves a whitelist application ID (eg R1234).')
                .addStringOption((option) => {
                    return option
                        .setName('id')
                        .setDescription('The ID of the application (eg R1234).')
                        .setRequired(true)
                        .setMinLength(5)
                        .setMaxLength(5);
                });
        })
        .addSubcommand((subcommand) => {
            return subcommand
                .setName('request')
                .setDescription('Approves a whitelist application ID (eg R1234). Alias for /application.')
                .addStringOption((option) => {
                    return option
                        .setName('id')
                        .setDescription('The ID of the request (eg R1234).')
                        .setRequired(true)
                        .setMinLength(5)
                        .setMaxLength(5);
                });
        }),
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        try {
            let response;
            if (subcommand === 'member') {
                const user = interaction.options.getUser('member', true);
                const guildMember = interaction.options.getMember('member');
                const playerName = guildMember?.nickname ?? user.globalName ?? user.username;
                const playerAvatar =
                    guildMember?.displayAvatarURL?.({ size: 64, forceStatic: true }) ??
                    user.displayAvatarURL({ size: 64, forceStatic: true });

                response = await request('whitelistCommand', {
                    subcommand,
                    ...getRequesterPayload(interaction),
                    identifier: `discord:${user.id}`,
                    playerName,
                    playerAvatar,
                });
            } else if (subcommand === 'request' || subcommand === 'application') {
                const requestId = interaction.options.getString('id', true).trim().toUpperCase();
                if (requestId.length !== 5 || requestId[0] !== 'R') {
                    await sendInteractionReply(
                        interaction,
                        buildReply('danger', translateBot(interaction, 'whitelist.invalid_request_id'), true),
                    );
                    return;
                }

                response = await request('whitelistCommand', {
                    subcommand,
                    ...getRequesterPayload(interaction),
                    requestId,
                });
            } else {
                await sendInteractionReply(
                    interaction,
                    buildReply(
                        'danger',
                        translateBot(interaction, 'whitelist.subcommand_not_found', { subcommand }),
                        true,
                    ),
                );
                return;
            }

            if (await resolveBridgeReply(interaction, response)) return;
            throw getNoReplyPayloadError(interaction, '/whitelist');
        } catch (error) {
            await sendBridgeError(interaction, '/whitelist', error);
        }
    },
};
