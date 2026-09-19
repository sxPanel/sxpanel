const { MessageFlags } = require('discord.js');
const { buildCardMessage, normalizeMessagePayload } = require('../../componentsV2');
const { translateDiscord } = require('../../discordLocale');

const replyColors = {
    info: 0x5865f2,
    success: 0x57f287,
    warning: 0xfee75c,
    danger: 0xed4245,
};

const buildReply = (type, description, ephemeral = false) => {
    return buildCardMessage({
        accentColor: replyColors[type] ?? replyColors.info,
        body: description,
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });
};

const translateBot = (source, key, params = {}) => {
    return translateDiscord(source, key, params);
};

const getNoReplyPayloadError = (source, commandName) => {
    return new Error(translateBot(source, 'common.no_reply_payload', { command: commandName }));
};

const isEphemeralPayload = (payload) => {
    const flags = Number(payload?.flags);
    return Number.isInteger(flags) && Boolean(flags & MessageFlags.Ephemeral);
};

// Commands are deferred as soon as they're dispatched (see interactionCreate.js) so a slow
// bridge round-trip never blows Discord's 3s ack window. Since the deferred reply's visibility
// is locked in at defer time, a final reply whose ephemeral flag doesn't match it is delivered
// as a follow-up (with the placeholder deferred reply removed) instead of an edit.
const sendInteractionReply = async (interaction, payload) => {
    if (interaction.replied) {
        await interaction.followUp(payload);
        return;
    }

    if (interaction.deferred) {
        if (isEphemeralPayload(payload) === Boolean(interaction.ephemeral)) {
            await interaction.editReply(payload);
            return;
        }

        await interaction.deleteReply().catch(() => {});
        await interaction.followUp(payload);
        return;
    }

    await interaction.reply(payload);
};

const resolveBridgeReply = async (interaction, response) => {
    if (!response?.reply) return false;

    await sendInteractionReply(interaction, normalizeMessagePayload(response.reply));
    return true;
};

const sendBridgeError = async (interaction, action, error) => {
    const message = error instanceof Error ? error.message : String(error);
    await sendInteractionReply(
        interaction,
        buildReply('danger', translateBot(interaction, 'common.command_failed', { action, message }), true),
    );
};

const getRequesterPayload = (interaction) => {
    const memberRoles =
        interaction.inGuild() && interaction.member?.roles?.cache
            ? [...interaction.member.roles.cache.keys()].filter((roleId) => roleId !== interaction.guildId)
            : [];

    return {
        requesterId: interaction.user.id,
        memberRoles,
    };
};

const resolveSearchId = (interaction) => {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'self') {
        return { searchId: `discord:${interaction.user.id}` };
    }

    if (subcommand === 'member') {
        const member = interaction.options.getUser('member', true);
        return { searchId: `discord:${member.id}` };
    }

    if (subcommand === 'id') {
        const input = interaction.options.getString('id', true).trim();
        if (!input.length) {
            return {
                errorReply: buildReply('danger', translateBot(interaction, 'common.invalid_identifier'), true),
            };
        }

        return { searchId: input.toLowerCase() };
    }

    if (subcommand === 'serverid') {
        const serverId = interaction.options.getInteger('serverid', true);
        if (!Number.isInteger(serverId) || serverId < 1) {
            return {
                errorReply: buildReply('danger', translateBot(interaction, 'common.invalid_server_id'), true),
            };
        }

        return { searchId: `serverid:${serverId}` };
    }

    return {
        errorReply: buildReply(
            'danger',
            translateBot(interaction, 'common.subcommand_not_found', { subcommand }),
            true,
        ),
    };
};

module.exports = {
    buildReply,
    getNoReplyPayloadError,
    getRequesterPayload,
    resolveBridgeReply,
    resolveSearchId,
    sendBridgeError,
    sendInteractionReply,
    translateBot,
};
