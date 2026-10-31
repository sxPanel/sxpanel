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

const getThreadId = (interaction) => {
    return interaction.channel && typeof interaction.channel.isThread === 'function' && interaction.channel.isThread()
        ? interaction.channelId
        : undefined;
};

const getOptionalTicketId = (interaction) => {
    const rawId = interaction.options.getString('id');
    return typeof rawId === 'string' && rawId.trim().length ? rawId.trim().toUpperCase() : undefined;
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reports')
        .setDescription('Discord-native report triage commands.')
        .addSubcommand((subcommand) => {
            return subcommand
                .setName('summary')
                .setDescription('Show a queue summary or the details for one ticket.')
                .addStringOption((option) => {
                    return option
                        .setName('id')
                        .setDescription('Ticket ID. Leave empty to use the current thread or show the queue summary.')
                        .setRequired(false);
                });
        })
        .addSubcommand((subcommand) => {
            return subcommand
                .setName('claim')
                .setDescription('Claim or unclaim a ticket for yourself.')
                .addStringOption((option) => {
                    return option
                        .setName('id')
                        .setDescription('Ticket ID. Leave empty to use the current ticket thread.')
                        .setRequired(false);
                });
        })
        .addSubcommand((subcommand) => {
            return subcommand
                .setName('assign')
                .setDescription('Assign a ticket to a linked sxPanel admin.')
                .addUserOption((option) => {
                    return option
                        .setName('member')
                        .setDescription('Discord member to assign the ticket to.')
                        .setRequired(true);
                })
                .addStringOption((option) => {
                    return option
                        .setName('id')
                        .setDescription('Ticket ID. Leave empty to use the current ticket thread.')
                        .setRequired(false);
                });
        })
        .addSubcommand((subcommand) => {
            return subcommand
                .setName('resolve')
                .setDescription('Resolve a ticket.')
                .addStringOption((option) => {
                    return option
                        .setName('id')
                        .setDescription('Ticket ID. Leave empty to use the current ticket thread.')
                        .setRequired(false);
                });
        })
        .addSubcommand((subcommand) => {
            return subcommand
                .setName('reopen')
                .setDescription('Reopen a resolved or closed ticket.')
                .addStringOption((option) => {
                    return option
                        .setName('id')
                        .setDescription('Ticket ID. Leave empty to use the current ticket thread.')
                        .setRequired(false);
                });
        }),
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        try {
            const basePayload = {
                subcommand,
                ticketId: getOptionalTicketId(interaction),
                threadId: getThreadId(interaction),
                ...getRequesterPayload(interaction),
            };

            let response;
            if (subcommand === 'assign') {
                const member = interaction.options.getUser('member', true);
                response = await request('ticketCommand', {
                    ...basePayload,
                    assigneeDiscordId: member.id,
                });
            } else if (
                subcommand === 'summary' ||
                subcommand === 'claim' ||
                subcommand === 'resolve' ||
                subcommand === 'reopen'
            ) {
                response = await request('ticketCommand', basePayload);
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
            throw getNoReplyPayloadError(interaction, '/reports');
        } catch (error) {
            await sendBridgeError(interaction, '/reports', error);
        }
    },
};
