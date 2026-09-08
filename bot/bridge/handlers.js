const {
    ActivityType,
    AttachmentBuilder,
    ChannelType,
    PermissionFlagsBits,
    PermissionsBitField,
} = require('discord.js');
const { buildCardMessage, normalizeMessageEditPayload, normalizeMessagePayload } = require('../componentsV2');
const { translateDiscord } = require('../discordLocale');

const embedColors = {
    danger: 0xed4245,
    warning: 0xfee75c,
    info: 0x5865f2,
    success: 0x57f287,
};

const ticketStatusLocaleKeyMap = {
    open: 'open',
    inReview: 'in_review',
    resolved: 'resolved',
    closed: 'closed',
};

const translateBot = (source, key, params = {}) => {
    return translateDiscord(source, key, params);
};

const transientDiscordNetworkErrorCodes = new Set([
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_SOCKET',
    'ECONNRESET',
    'ETIMEDOUT',
    'EAI_AGAIN',
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isTransientDiscordNetworkError = (error) => {
    const codes = [error?.code, error?.cause?.code, error?.cause?.cause?.code];

    return codes.some((code) => transientDiscordNetworkErrorCodes.has(code));
};

const runDiscordOperation = async (label, operation) => {
    try {
        return await operation();
    } catch (error) {
        if (!isTransientDiscordNetworkError(error)) {
            throw error;
        }

        console.warn(`[BotBridge] ${label} failed with a transient Discord network error. Retrying once.`);
        await sleep(1000);
        return await operation();
    }
};

const fetchChannel = async (client, channelId, label) => {
    try {
        return await runDiscordOperation(label, () => client.channels.fetch(channelId));
    } catch {
        return null;
    }
};

const formatTicketStatus = (source, status) => {
    const localeKey = ticketStatusLocaleKeyMap[status];
    return localeKey ? translateBot(source, `tickets.status_labels.${localeKey}`) : String(status);
};

const formatTicketPriority = (source, priority) => {
    return priority
        ? translateBot(source, `tickets.priority_labels.${priority}`)
        : translateBot(source, 'tickets.priority_labels.none');
};

const sendBridgeMessage = (message) => {
    const { send } = require('./index');
    send(message);
};

const sendResponse = (requestId, payload) => {
    sendBridgeMessage({ requestId, payload });
};

const sendError = (requestId, error) => {
    sendBridgeMessage({
        requestId,
        error: error instanceof Error ? error.message : String(error),
    });
};

const interpolate = (template, snapshot) => {
    if (typeof template !== 'string') return '';

    const replacements = {
        playerCount: snapshot?.playerCount ?? 0,
        maxPlayers: snapshot?.maxPlayers ?? '??',
        serverName: snapshot?.serverName ?? 'sxPanel',
        uptime: snapshot?.uptime ?? 0,
    };

    return template.replace(/\{(playerCount|maxPlayers|serverName|uptime)\}/g, (_, key) => {
        return String(replacements[key] ?? '');
    });
};

const resolveSnapshot = (client, msg) => {
    const snapshot = msg?.payload ?? msg?.data ?? msg?.snapshot ?? msg ?? null;
    client.sxpanel.latestConfigSnapshot = snapshot;
    return snapshot;
};

const resolveGuildId = (client) => {
    return client.sxpanel.latestConfigSnapshot?.discordBot?.guild ?? process.env.BOT_GUILD_ID ?? null;
};

const resolveGuild = async (client) => {
    const guildId = resolveGuildId(client);
    if (!guildId) throw new Error('Discord guild is not configured for the bridge bot.');

    const guild = client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId).catch(() => null));
    if (!guild) throw new Error(`Discord guild ${guildId} could not be resolved.`);

    return guild;
};

const resolveMember = async (client, uid) => {
    const guild = await resolveGuild(client);
    let member = guild.members.cache.get(uid);
    if (!member) {
        member = await guild.members.fetch(uid).catch(() => null);
    }

    return { guild, member };
};

const applyPresence = async (client, presenceConfig) => {
    if (!client.user || !presenceConfig) return;

    const snapshot = client.sxpanel.latestConfigSnapshot;
    const resolvedText = interpolate(presenceConfig.activityText, snapshot);
    const resolvedType = ActivityType[presenceConfig.activityType] ?? ActivityType.Watching;

    await client.user.setPresence({
        status: presenceConfig.status,
        activities: [{ name: resolvedText, type: resolvedType }],
    });
};

const sendAnnouncement = async (msg, client) => {
    const snapshot = client.sxpanel.latestConfigSnapshot;
    const payload = msg?.payload ?? msg;
    const channelId = payload.channelId ?? snapshot?.discordBot?.warningsChannel ?? null;
    const announcementType = payload.announcementType ?? payload.embedType ?? null;
    if (!channelId) return;

    const channel = await fetchChannel(client, channelId, `Failed to resolve announcement channel ${channelId}`);
    if (!channel?.isTextBased()) return;

    if (payload.embeds || payload.files) {
        await runDiscordOperation(`Failed to send announcement to ${channelId}`, () =>
            channel.send(
                normalizeMessagePayload({
                    content: payload.content,
                    embeds: payload.embeds,
                    files: payload.files,
                }),
            ),
        );
        return;
    }

    const description = typeof payload.description === 'string' ? payload.description : null;
    if (!description) return;

    await runDiscordOperation(`Failed to send announcement to ${channelId}`, () =>
        channel.send(
            buildCardMessage({
                accentColor:
                    announcementType && embedColors[announcementType] ? embedColors[announcementType] : undefined,
                title: typeof payload.title === 'string' ? payload.title : undefined,
                body: description,
            }),
        ),
    );
};

const postLogMessage = async (msg, client) => {
    const payload = msg?.payload ?? msg;
    const channelId = typeof payload.channelId === 'string' ? payload.channelId : null;
    if (!channelId) return;

    const channel = await fetchChannel(client, channelId, `Failed to resolve log channel ${channelId}`);
    if (!channel?.isTextBased()) return;

    if (typeof payload.guildId === 'string' && 'guildId' in channel && channel.guildId !== payload.guildId) {
        throw new Error(`Discord channel ${channelId} is not part of guild ${payload.guildId}.`);
    }

    const embeds = Array.isArray(payload.embeds) ? payload.embeds : [];
    const components = Array.isArray(payload.components) ? payload.components : [];
    const content = typeof payload.content === 'string' ? payload.content : undefined;
    const flags = typeof payload.flags === 'number' ? payload.flags : undefined;
    const allowedMentions =
        payload.allowedMentions && typeof payload.allowedMentions === 'object'
            ? payload.allowedMentions
            : { parse: [] };
    if (!content && embeds.length === 0 && components.length === 0) return;

    await runDiscordOperation(`Failed to send routed log message to ${channelId}`, () =>
        channel.send(
            normalizeMessagePayload({
                ...(content ? { content } : {}),
                ...(embeds.length ? { embeds } : {}),
                ...(components.length ? { components } : {}),
                ...(flags ? { flags } : {}),
                allowedMentions,
            }),
        ),
    );
};

const normalizeTicketMessagePayload = (payload) => {
    if (!payload || typeof payload !== 'object') return null;

    const embeds = Array.isArray(payload.embeds) ? payload.embeds : [];
    const components = Array.isArray(payload.components) ? payload.components : [];
    const content = typeof payload.content === 'string' ? payload.content : undefined;

    if (!content && embeds.length === 0 && components.length === 0) {
        return null;
    }

    return normalizeMessagePayload({
        ...(content ? { content } : {}),
        ...(embeds.length ? { embeds } : {}),
        ...(components.length ? { components } : {}),
        allowedMentions: { parse: [] },
    });
};

const normalizeTicketChannelSegment = (value, fallback) => {
    const normalized = String(value ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return normalized.length ? normalized.slice(0, 28) : fallback;
};

const buildTicketChannelName = (ticket) => {
    const category = normalizeTicketChannelSegment(ticket.category, 'ticket');
    const reporter = normalizeTicketChannelSegment(ticket.reporter?.name, 'player');
    const id = normalizeTicketChannelSegment(ticket.id, 'new');

    return `${category}-${reporter}-${id}`.slice(0, 100);
};

const isTicketMessageTarget = (channel) => {
    return (
        channel?.isThread?.() ||
        channel?.type === ChannelType.GuildText ||
        channel?.type === ChannelType.GuildAnnouncement
    );
};

const buildTicketChannelPermissionOverwrites = (category) => {
    const overwrites = category.permissionOverwrites.cache.map((overwrite) => ({
        id: overwrite.id,
        type: overwrite.type,
        allow: overwrite.allow,
        deny: overwrite.deny,
    }));
    const everyoneRoleId = category.guild.roles.everyone.id;
    const everyoneOverwrite = overwrites.find((overwrite) => overwrite.id === everyoneRoleId);

    if (everyoneOverwrite) {
        everyoneOverwrite.allow = new PermissionsBitField(everyoneOverwrite.allow).remove(
            PermissionFlagsBits.ViewChannel,
        );
        everyoneOverwrite.deny = new PermissionsBitField(everyoneOverwrite.deny).add(PermissionFlagsBits.ViewChannel);
    } else {
        overwrites.push({
            id: everyoneRoleId,
            deny: [PermissionFlagsBits.ViewChannel],
        });
    }

    return overwrites;
};

const createTicketThread = async (msg, client) => {
    const channel = await client.channels.fetch(msg.channelId);
    if (!channel) throw new Error(`Ticket channel/category ${msg.channelId} not found.`);

    const ticket = msg.ticket;
    const priorityColorMap = {
        critical: embedColors.danger,
        high: embedColors.danger,
        medium: embedColors.warning,
    };
    const priorityColor = ticket.priority ? (priorityColorMap[ticket.priority] ?? embedColors.info) : embedColors.info;

    const messagePayload =
        normalizeTicketMessagePayload(msg.messagePayload) ??
        buildCardMessage({
            accentColor: priorityColor,
            title: `[${ticket.id}] ${ticket.category}`,
            body: String(ticket.description ?? '').slice(0, 2048),
            sections: [
                `### ${translateBot(client, 'tickets.summary.fields.reporter')}\n${ticket.reporter.name} (#${ticket.reporter.netid})`,
                `### ${translateBot(client, 'tickets.summary.fields.status')}\n${formatTicketStatus(client, ticket.status)}`,
                ...(ticket.priority
                    ? [
                          `### ${translateBot(client, 'tickets.summary.fields.priority')}\n${formatTicketPriority(client, ticket.priority)}`,
                      ]
                    : []),
                ...(ticket.targets.length > 0
                    ? [
                          `### ${translateBot(client, 'tickets.summary.fields.targets')}\n${ticket.targets.map((target) => `${target.name} (#${target.netid})`).join(', ')}`,
                      ]
                    : []),
            ],
            footer: `<t:${ticket.tsCreated}:F>`,
        });

    let target;
    if (channel.type === ChannelType.GuildCategory) {
        target = await channel.guild.channels.create({
            name: buildTicketChannelName(ticket),
            type: ChannelType.GuildText,
            parent: channel.id,
            topic: `sxPanel ticket ${ticket.id}`,
            permissionOverwrites: buildTicketChannelPermissionOverwrites(channel),
            reason: `sxPanel ticket ${ticket.id}`,
        });
        await target.send(messagePayload);
    } else if (channel.type === ChannelType.GuildForum) {
        target = await channel.threads.create({
            name: msg.threadName,
            message: messagePayload,
        });
    } else if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) {
        const entryMessage = await channel.send(messagePayload);
        target = await entryMessage.startThread({ name: msg.threadName });
    } else {
        throw new Error(`Channel type ${channel.type} is not supported for ticket channels.`);
    }

    if (msg.screenshotBase64) {
        const attachment = new AttachmentBuilder(Buffer.from(msg.screenshotBase64, 'base64'), {
            name: 'screenshot.png',
        });
        await target.send({ content: translateBot(client, 'bridge.ticket.screenshot_attached'), files: [attachment] });
    }

    return { threadId: target.id };
};

const createWhitelistReviewThread = async (msg, client) => {
    const channel = await fetchChannel(
        client,
        msg.channelId,
        `Failed to resolve whitelist review channel ${msg.channelId}`,
    );
    const messagePayload = buildCardMessage({
        accentColor: embedColors.info,
        title: `[${msg.applicationId}] Whitelist application`,
        body: `**Player:** ${msg.playerName}\n**License:** \`${msg.license}\``,
        sections: [`Use \`/whitelist application ${msg.applicationId}\` to approve.`],
        footer: 'sxPanel Whitelist',
    });

    let thread;
    if (channel.type === ChannelType.GuildForum) {
        thread = await channel.threads.create({
            name: `wl-${msg.applicationId}-${msg.playerName}`.slice(0, 100),
            message: messagePayload,
        });
    } else if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) {
        const entryMessage = await channel.send(messagePayload);
        await entryMessage.react('✅').catch(() => {});
        await entryMessage.react('❌').catch(() => {});
        thread = await entryMessage.startThread({
            name: `wl-${msg.applicationId}`.slice(0, 100),
        });
    } else {
        throw new Error(`Channel type ${channel.type} is not supported for whitelist review threads.`);
    }

    if (channel.type === ChannelType.GuildForum) {
        const starter = await thread.fetchStarterMessage().catch(() => null);
        if (starter) {
            await starter.react('✅').catch(() => {});
            await starter.react('❌').catch(() => {});
        }
    }

    return { threadId: thread.id };
};

const postTicketMessage = async (msg, client) => {
    const target = await client.channels.fetch(msg.threadId).catch(() => null);
    if (!isTicketMessageTarget(target) || !target.isTextBased?.()) {
        console.warn(
            `[BotBridge] Could not post ticket message to ${msg.threadId}: channel not found or not a valid ticket message target (type ${target?.type ?? 'unknown'}).`,
        );
        return;
    }

    let text = `**${msg.authorName}:** ${String(msg.content ?? '').slice(0, 1900)}`;
    if (Array.isArray(msg.imageUrls) && msg.imageUrls.length > 0) {
        text += `\n${msg.imageUrls.slice(0, 3).join('\n')}`;
    }

    await target.send(text.trim());
};

const updateStatusEmbed = async (msg, client) => {
    const payload = msg?.payload ?? msg;
    const channelId = payload.channelId ?? msg.channelId;
    const messageId = payload.messageId ?? msg.messageId;
    const messagePayload = payload.messagePayload ?? payload.message ?? null;
    if (!channelId || !messageId || !messagePayload) return;

    const channel = await fetchChannel(client, channelId, `Failed to resolve status embed channel ${channelId}`);
    if (channel?.type !== ChannelType.GuildText && channel?.type !== ChannelType.GuildAnnouncement) return;

    await runDiscordOperation(`Failed to update status embed message ${messageId}`, () =>
        channel.messages.edit(messageId, normalizeMessageEditPayload(messagePayload)),
    );
};

const refreshMemberCache = async (client) => {
    const guild = await resolveGuild(client);
    await guild.members.fetch();
    return true;
};

const resolveMemberRoles = async (client, uid) => {
    const { member } = await resolveMember(client, uid);
    if (!member) {
        return { isMember: false };
    }

    return {
        isMember: true,
        memberRoles: member.roles.cache.map((role) => role.id),
    };
};

const listGuildRoles = async (client) => {
    const guild = await resolveGuild(client);
    await guild.roles.fetch();
    const roles = [...guild.roles.cache.values()]
        .filter((role) => role.id !== guild.id)
        .sort((a, b) => b.position - a.position)
        .map((role) => ({
            id: role.id,
            name: role.name,
            color: role.hexColor === '#000000' ? null : role.hexColor,
            position: role.position,
        }));
    return { roles };
};

const resolveMemberProfile = async (client, uid) => {
    const avatarOptions = { size: 64, forceStatic: true };
    const { member } = await resolveMember(client, uid);
    if (member) {
        return {
            tag: member.nickname ?? member.user.username,
            avatar: member.displayAvatarURL(avatarOptions) ?? member.user.displayAvatarURL(avatarOptions),
        };
    }

    const user = await client.users.fetch(uid);
    if (!user) throw new Error(`Discord user ${uid} could not be resolved.`);

    return {
        tag: user.username,
        avatar: user.displayAvatarURL(avatarOptions),
    };
};

const reloadCommands = async (client) => {
    await client.sxpanel.reloadAddonModules({ clearCustomCache: true, clearAddonCache: true });
    const guildId = resolveGuildId(client) ?? undefined;
    await client.sxpanel.registerCommands(guildId);
};

const handleRequest = async (msg, client) => {
    switch (msg.type) {
        case 'configSnapshot': {
            sendResponse(msg.requestId, client.sxpanel.latestConfigSnapshot ?? null);
            return;
        }
        case 'createTicketThread': {
            sendResponse(msg.requestId, await createTicketThread(msg, client));
            return;
        }
        case 'createWhitelistReviewThread': {
            sendResponse(msg.requestId, await createWhitelistReviewThread(msg, client));
            return;
        }
        case 'refreshMemberCache': {
            sendResponse(msg.requestId, await refreshMemberCache(client));
            return;
        }
        case 'resolveMemberRoles': {
            sendResponse(msg.requestId, await resolveMemberRoles(client, msg.uid));
            return;
        }
        case 'listGuildRoles': {
            sendResponse(msg.requestId, await listGuildRoles(client));
            return;
        }
        case 'resolveMemberProfile': {
            sendResponse(msg.requestId, await resolveMemberProfile(client, msg.uid));
            return;
        }
        default: {
            sendError(msg.requestId, new Error(`Unhandled request type: ${msg.type}`));
        }
    }
};

const handle = async (msg, client) => {
    if (msg.requestId) {
        try {
            await handleRequest(msg, client);
        } catch (error) {
            sendError(msg.requestId, error);
        }
        return;
    }

    switch (msg.type) {
        case 'configSnapshot': {
            const snapshot = resolveSnapshot(client, msg);
            await applyPresence(client, snapshot?.discordBot?.presence);
            const guildId = resolveGuildId(client) ?? undefined;
            if (guildId) {
                await client.sxpanel.registerCommands(guildId);
            }
            return;
        }
        case 'updatePresence': {
            const presenceConfig = msg?.payload ?? msg?.presence ?? msg;
            await applyPresence(client, presenceConfig);
            return;
        }
        case 'reloadCommands': {
            await reloadCommands(client);
            return;
        }
        case 'sendAnnouncement': {
            await sendAnnouncement(msg, client);
            return;
        }
        case 'postLogMessage': {
            await postLogMessage(msg, client);
            return;
        }
        case 'postTicketMessage': {
            await postTicketMessage(msg, client);
            return;
        }
        case 'updateStatusEmbed': {
            await updateStatusEmbed(msg, client);
            return;
        }
        default: {
            console.warn(`[BotBridge] Unhandled message type: ${msg.type}`);
        }
    }
};

module.exports = {
    handle,
};
