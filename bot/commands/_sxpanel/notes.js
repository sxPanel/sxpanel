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
    .setName('notes')
    .setDescription('View or update player notes using your linked sxPanel account.');

addTargetSubcommands(
    data
        .addSubcommandGroup((group) => {
            return group.setName('view').setDescription('View player notes.');
        })
        .addSubcommandGroup((group) => {
            return group.setName('set').setDescription('Update player notes.');
        }),
    {
        self: 'View your linked player notes.',
        member: 'View notes for the player linked to a Discord member.',
        id: 'View notes for a player by identifier.',
    },
    undefined,
    { includeSelf: true },
);

addTargetSubcommands(
    data,
    {
        self: 'Update your linked player notes.',
        member: 'Update notes for the player linked to a Discord member.',
        id: 'Update notes for a player by identifier.',
    },
    (subcommand) => {
        return subcommand.addStringOption((option) => {
            return option.setName('note').setDescription('Note text to save.').setRequired(true).setMaxLength(1000);
        });
    },
    { includeSelf: true },
);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('notes')
        .setDescription('View or update player notes using your linked sxPanel account.')
        .addSubcommandGroup((group) => {
            return addTargetSubcommands(
                group.setName('view').setDescription('View player notes.'),
                {
                    self: 'View your linked player notes.',
                    member: 'View notes for the player linked to a Discord member.',
                    id: 'View notes for a player by identifier.',
                },
                undefined,
                { includeSelf: true },
            );
        })
        .addSubcommandGroup((group) => {
            return addTargetSubcommands(
                group.setName('set').setDescription('Update player notes.'),
                {
                    self: 'Update your linked player notes.',
                    member: 'Update notes for the player linked to a Discord member.',
                    id: 'Update notes for a player by identifier.',
                },
                (subcommand) => {
                    return subcommand.addStringOption((option) => {
                        return option
                            .setName('note')
                            .setDescription('Note text to save.')
                            .setRequired(true)
                            .setMaxLength(1000);
                    });
                },
                { includeSelf: true },
            );
        }),
    async execute(interaction) {
        const group = interaction.options.getSubcommandGroup();
        const result = resolveSearchId(interaction);
        if (result.errorReply) {
            await sendInteractionReply(interaction, result.errorReply);
            return;
        }

        try {
            if (group !== 'view' && group !== 'set') {
                await sendInteractionReply(
                    interaction,
                    buildReply(
                        'danger',
                        translateBot(interaction, 'common.subcommand_group_not_found', { group: String(group) }),
                        true,
                    ),
                );
                return;
            }

            const response = await request('moderationCommand', {
                command: 'notes',
                action: group,
                searchId: result.searchId,
                note: group === 'set' ? interaction.options.getString('note', true).trim() : undefined,
                ...getRequesterPayload(interaction),
            });

            if (await resolveBridgeReply(interaction, response)) return;
            throw getNoReplyPayloadError(interaction, '/notes');
        } catch (error) {
            await sendBridgeError(interaction, '/notes', error);
        }
    },
};
