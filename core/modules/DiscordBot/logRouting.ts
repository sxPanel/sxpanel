import {
    discordLogRouteDefinitions,
    discordMenuCommandDefinitions,
    normalizeDiscordLogRoutes,
    type DiscordLogRouteConfig,
    type DiscordLogRouteKey,
} from '@shared/discordLogRoutes';
import { permissionsMap } from '@shared/permissions';
import type { SystemLogCategory, SystemLogEntry } from '@shared/systemLogTypes';
import { buildDiscordCardMessageFromEmbed } from './componentsV2';
import { formatCombatDistance, parseCombatDamageSummary, parseCombatSummary, type CombatSummary } from '@lib/combatLog';

export type DiscordLogMessagePayload = {
    channelId: string;
    guildId: string | null;
    flags?: number;
    components: Record<string, unknown>[];
    allowedMentions?: Record<string, unknown>;
};

type ServerLogEntry = {
    ts: number;
    src: {
        id: string | false;
        name: string;
    };
    msg: string;
};

type ServerLogEvent = {
    type?: unknown;
    src?: unknown;
    data?: unknown;
};

/**
 * Minimal player info used to enrich log cards.
 * Resolved by the caller so this module stays free of runtime state.
 */
export type DiscordLogPlayerInfo = {
    netid: number;
    displayName: string;
    discordId: string | null;
};
export type DiscordLogPlayerResolver = (netid: number) => DiscordLogPlayerInfo | undefined;

type EmbedField = { name: string; value: string; inline: boolean };

type ServerMenuEventData = {
    action?: unknown;
    message?: unknown;
    commandId?: unknown;
    permissionId?: unknown;
    location?: unknown;
};

const routeLabelByKey = new Map(discordLogRouteDefinitions.map((route) => [route.key, route.label]));
const menuCommandById = new Map(discordMenuCommandDefinitions.map((command) => [command.id, command]));

const systemLogRouteByCategory: Record<SystemLogCategory, DiscordLogRouteKey> = {
    action: 'system.action',
    command: 'system.command',
    login: 'system.login',
    config: 'system.config',
    monitor: 'system.monitor',
    scheduler: 'system.scheduler',
    system: 'system.system',
};

const routeColorByKey: Record<DiscordLogRouteKey, number> = {
    'system.action': 0x2563eb,
    whitelist: 0x14b8a6,
    'system.command': 0x7c3aed,
    'system.login': 0x16a34a,
    'system.config': 0xd97706,
    'system.monitor': 0xdc2626,
    'system.scheduler': 0x0891b2,
    'system.system': 0x475569,
    'server.menu': 0xf59e0b,
    'server.combat': 0xb91c1c,
    'server.connection': 0x22c55e,
    'server.chat': 0x3b82f6,
};

const combatDeathColor = 0x64748b;
const combatDamageColor = 0xf97316;
const connectionLeaveColor = 0xf97316;
const connectionDeniedColor = 0xef4444;

const truncate = (value: string, maxLength: number) => {
    return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
};

//Escapes Discord markdown in user-controlled text (player names, chat messages)
const escapeMarkdown = (value: string) => {
    return value.replace(/([\\`*_~|>#[\]()-])/g, '\\$1').replace(/@/g, '@\u200b');
};

const describePlayer = (player: DiscordLogPlayerInfo | undefined, fallbackName: string, netid?: number) => {
    const name = escapeMarkdown(truncate(player?.displayName ?? fallbackName, 75));
    const id = player?.netid ?? netid;
    const label = typeof id === 'number' ? `${name} (#${id})` : name;
    return player?.discordId ? `${label} • <@${player.discordId}>` : label;
};

const formatTimestamp = (ts: number) => `<t:${Math.floor(ts / 1000)}:F>`;

//NOTE: high-volume routes use few multi-line fields, since every field costs 2 of the
//40 components a Discord message can hold, and the batcher packs several cards per message
const buildLinesField = (name: string, lines: (string | false | null | undefined)[]): EmbedField => ({
    name,
    value: truncate(
        lines.filter((line): line is string => typeof line === 'string' && line.length > 0).join('\n'),
        1024,
    ),
    inline: false,
});

const getEventNetid = (rawEvent: ServerLogEvent) => {
    return typeof rawEvent.src === 'number' && Number.isInteger(rawEvent.src) && rawEvent.src > 0
        ? rawEvent.src
        : undefined;
};

const getEventData = (rawEvent: ServerLogEvent) => {
    return rawEvent.data && typeof rawEvent.data === 'object' ? (rawEvent.data as Record<string, unknown>) : {};
};

const isEntryAllowed = (route: DiscordLogRouteConfig, entryId: string) => {
    return !route.useEntryFilter || route.entryFilter.includes(entryId);
};

const buildCombatStatLines = (combat: CombatSummary | null) => {
    if (!combat) return [];
    const lines: string[] = [];
    const stats: string[] = [];
    if (combat.hits > 0) {
        stats.push(`**Hits:** ${combat.hits}`, `**Headshots:** ${combat.headshots}`, `**Damage:** ${combat.damage}`);
    }
    const distance = formatCombatDistance(combat.distance);
    if (distance) stats.push(`**Distance:** ${distance}`);
    if (stats.length) lines.push(stats.join(' • '));
    if (combat.weapons.length > 1) lines.push(`**Weapons Used:** ${combat.weapons.join(', ')}`);
    return lines;
};

const resolveRoute = (routesValue: unknown, routeKey: DiscordLogRouteKey) => {
    return normalizeDiscordLogRoutes(routesValue).find((route) => route.key === routeKey) ?? null;
};

const buildPayload = (route: DiscordLogRouteConfig, embed: Record<string, unknown>): DiscordLogMessagePayload => {
    return {
        channelId: route.channelId!,
        guildId: null,
        ...buildDiscordCardMessageFromEmbed(embed, {
            allowedMentions: { parse: [] },
        }),
    };
};

const formatLocation = (value: unknown) => {
    if (!value || typeof value !== 'object') return 'Unknown';

    const location = value as Record<string, unknown>;
    const x = typeof location.x === 'number' ? location.x : Number(location.x);
    const y = typeof location.y === 'number' ? location.y : Number(location.y);
    const z = typeof location.z === 'number' ? location.z : Number(location.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        return 'Unknown';
    }

    return `X: ${x.toFixed(2)}, Y: ${y.toFixed(2)}, Z: ${z.toFixed(2)}`;
};

export const buildSystemLogDiscordPayload = (routesValue: unknown, entry: SystemLogEntry) => {
    const routeKey =
        entry.category === 'action' &&
        typeof entry.actionId === 'string' &&
        (entry.actionId.startsWith('whitelist.') || entry.actionId.startsWith('player.whitelist.'))
            ? 'whitelist'
            : systemLogRouteByCategory[entry.category];
    const route = resolveRoute(routesValue, routeKey);
    if (!route?.enabled || !route.channelId) return false;
    if (route.useEntryFilter) {
        if (typeof entry.actionId !== 'string' || !route.entryFilter.includes(entry.actionId)) {
            return false;
        }
    }

    const embed = {
        title: routeLabelByKey.get(routeKey) ?? 'sxPanel Log',
        color: routeColorByKey[routeKey],
        description: truncate(entry.action, 2048),
        fields: [
            {
                name: 'Username',
                value: truncate(entry.author, 1024),
                inline: true,
            },
            {
                name: 'Category',
                value: entry.category,
                inline: true,
            },
            {
                name: 'Time',
                value: `<t:${Math.floor(entry.ts / 1000)}:F>`,
                inline: true,
            },
        ],
    } satisfies Record<string, unknown>;

    return buildPayload(route, embed);
};

export const buildServerMenuDiscordPayload = (
    routesValue: unknown,
    rawEvent: ServerLogEvent,
    logEntry: ServerLogEntry,
) => {
    if (rawEvent.type !== 'MenuEvent') return false;

    const route = resolveRoute(routesValue, 'server.menu');
    if (!route?.enabled || !route.channelId) return false;

    const eventData = rawEvent.data && typeof rawEvent.data === 'object' ? (rawEvent.data as ServerMenuEventData) : {};
    const commandId =
        typeof eventData.commandId === 'string' && eventData.commandId.length
            ? eventData.commandId
            : typeof eventData.action === 'string' && eventData.action.length
              ? eventData.action
              : 'unknown';

    if (route.useEntryFilter && !route.entryFilter.includes(commandId)) {
        return false;
    }

    const commandDefinition = menuCommandById.get(commandId);
    const permissionId =
        typeof eventData.permissionId === 'string' && eventData.permissionId.length
            ? eventData.permissionId
            : commandDefinition?.permissionId;
    const permissionLabel = permissionId ? (permissionsMap.get(permissionId)?.label ?? permissionId) : 'Unknown';
    const description =
        typeof eventData.message === 'string' && eventData.message.length ? eventData.message : logEntry.msg;

    const embed = {
        title: routeLabelByKey.get('server.menu') ?? 'Admin Command Log',
        color: routeColorByKey['server.menu'],
        description: truncate(description, 2048),
        fields: [
            {
                name: 'Username',
                value: truncate(logEntry.src.name, 1024),
                inline: true,
            },
            {
                name: 'Command',
                value: commandDefinition?.label ?? commandId,
                inline: true,
            },
            {
                name: 'Permission',
                value: truncate(permissionLabel, 1024),
                inline: true,
            },
            {
                name: 'Location',
                value: formatLocation(eventData.location),
                inline: false,
            },
            {
                name: 'Time',
                value: `<t:${Math.floor(logEntry.ts / 1000)}:F>`,
                inline: false,
            },
        ],
    } satisfies Record<string, unknown>;

    return buildPayload(route, embed);
};

const buildCombatDiscordPayload = (
    routesValue: unknown,
    rawEvent: ServerLogEvent,
    logEntry: ServerLogEntry,
    resolvePlayer: DiscordLogPlayerResolver,
) => {
    const route = resolveRoute(routesValue, 'server.combat');
    if (!route?.enabled || !route.channelId) return false;

    const eventData = getEventData(rawEvent);
    const subjectNetid = getEventNetid(rawEvent);
    const subject = subjectNetid ? resolvePlayer(subjectNetid) : undefined;
    const description = truncate(`${logEntry.src.name} ${logEntry.msg}`, 2048);

    if (rawEvent.type === 'CombatDamage') {
        if (!isEntryAllowed(route, 'combat.damage')) return false;
        const summary = parseCombatDamageSummary(eventData);
        if (!summary) return false;

        const victim = resolvePlayer(summary.victim);
        const embed = {
            title: 'Combat Damage',
            color: combatDamageColor,
            description,
            fields: [
                buildLinesField('Players', [
                    `**Attacker:** ${describePlayer(subject, logEntry.src.name, subjectNetid)}`,
                    `**Victim:** ${describePlayer(victim, 'Unknown player', summary.victim)}`,
                ]),
                buildLinesField('Details', [
                    `**Weapon:** ${summary.weapon ?? 'Unknown'}`,
                    ...buildCombatStatLines(summary),
                    `**Time:** ${formatTimestamp(logEntry.ts)}`,
                ]),
            ],
        } satisfies Record<string, unknown>;
        return buildPayload(route, embed);
    }

    //DeathNotice
    const killerNetid =
        typeof eventData.killer === 'number' && Number.isInteger(eventData.killer) && eventData.killer > 0
            ? eventData.killer
            : undefined;
    const cause = typeof eventData.cause === 'string' && eventData.cause.length ? eventData.cause : 'unknown';
    const victimLine = `**Victim:** ${describePlayer(subject, logEntry.src.name, subjectNetid)}`;
    const causeLine = `**Cause:** ${truncate(cause, 128)}`;
    const timeLine = `**Time:** ${formatTimestamp(logEntry.ts)}`;

    if (killerNetid) {
        if (!isEntryAllowed(route, 'combat.kill')) return false;
        const killer = resolvePlayer(killerNetid);
        const embed = {
            title: 'Player Kill',
            color: routeColorByKey['server.combat'],
            description,
            fields: [
                buildLinesField('Players', [
                    `**Killer:** ${describePlayer(killer, 'Unknown player', killerNetid)}`,
                    victimLine,
                ]),
                buildLinesField('Details', [
                    causeLine,
                    ...buildCombatStatLines(parseCombatSummary(eventData.combat)),
                    timeLine,
                ]),
            ],
        } satisfies Record<string, unknown>;
        return buildPayload(route, embed);
    }

    if (!isEntryAllowed(route, 'combat.death')) return false;
    const embed = {
        title: 'Player Death',
        color: combatDeathColor,
        description,
        fields: [buildLinesField('Details', [victimLine, causeLine, timeLine])],
    } satisfies Record<string, unknown>;
    return buildPayload(route, embed);
};

const connectionEntryByType = {
    playerJoining: { entryId: 'player.join', title: 'Player Joined', color: routeColorByKey['server.connection'] },
    playerDropped: { entryId: 'player.leave', title: 'Player Left', color: connectionLeaveColor },
    playerJoinDenied: { entryId: 'player.join_denied', title: 'Join Denied', color: connectionDeniedColor },
} as const;

const buildConnectionDiscordPayload = (
    routesValue: unknown,
    rawEvent: ServerLogEvent,
    logEntry: ServerLogEntry,
    resolvePlayer: DiscordLogPlayerResolver,
) => {
    const entry = connectionEntryByType[rawEvent.type as keyof typeof connectionEntryByType];
    if (!entry) return false;

    const route = resolveRoute(routesValue, 'server.connection');
    if (!route?.enabled || !route.channelId) return false;
    if (!isEntryAllowed(route, entry.entryId)) return false;

    const netid = getEventNetid(rawEvent);
    const player = netid ? resolvePlayer(netid) : undefined;
    const eventData = getEventData(rawEvent);
    const reason = typeof eventData.reason === 'string' && eventData.reason.length ? eventData.reason : null;
    const fields = [
        buildLinesField('Details', [
            rawEvent.type !== 'playerJoinDenied' && `**Player:** ${describePlayer(player, logEntry.src.name, netid)}`,
            reason && `**Reason:** ${truncate(reason, 512)}`,
            `**Time:** ${formatTimestamp(logEntry.ts)}`,
        ]),
    ];

    const embed = {
        title: entry.title,
        color: entry.color,
        description: truncate(`${logEntry.src.name} ${logEntry.msg}`, 2048),
        fields,
    } satisfies Record<string, unknown>;
    return buildPayload(route, embed);
};

const buildChatDiscordPayload = (
    routesValue: unknown,
    rawEvent: ServerLogEvent,
    logEntry: ServerLogEntry,
    resolvePlayer: DiscordLogPlayerResolver,
) => {
    const route = resolveRoute(routesValue, 'server.chat');
    if (!route?.enabled || !route.channelId) return false;

    const eventData = getEventData(rawEvent);
    const text = typeof eventData.text === 'string' ? eventData.text.replace(/\^([0-9])/g, '').trim() : '';
    if (!text.length) return false;

    const netid = getEventNetid(rawEvent);
    const player = netid ? resolvePlayer(netid) : undefined;
    const author =
        typeof eventData.author === 'string' && eventData.author.length ? eventData.author : logEntry.src.name;

    const embed = {
        title: 'Chat Message',
        color: routeColorByKey['server.chat'],
        description: truncate(escapeMarkdown(text), 2048),
        fields: [
            buildLinesField('', [
                `**Author:** ${describePlayer(player, author, netid)}`,
                `**Time:** ${formatTimestamp(logEntry.ts)}`,
            ]),
        ],
    } satisfies Record<string, unknown>;
    return buildPayload(route, embed);
};

/**
 * Builds the Discord payload for any routed in-game (server log) event, or false if it should not be sent.
 */
export const buildServerLogDiscordPayload = (
    routesValue: unknown,
    rawEvent: ServerLogEvent,
    logEntry: ServerLogEntry,
    resolvePlayer: DiscordLogPlayerResolver = () => undefined,
) => {
    switch (rawEvent.type) {
        case 'MenuEvent':
            return buildServerMenuDiscordPayload(routesValue, rawEvent, logEntry);
        case 'DeathNotice':
        case 'CombatDamage':
            return buildCombatDiscordPayload(routesValue, rawEvent, logEntry, resolvePlayer);
        case 'playerJoining':
        case 'playerDropped':
        case 'playerJoinDenied':
            return buildConnectionDiscordPayload(routesValue, rawEvent, logEntry, resolvePlayer);
        case 'ChatMessage':
            return buildChatDiscordPayload(routesValue, rawEvent, logEntry, resolvePlayer);
        default:
            return false;
    }
};
