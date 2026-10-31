import {
    configChangeLogActionDefinitions,
    getSystemLogActionDefinitions,
    legacyConfigSaveActionId,
    type SystemLogActionId,
} from './systemLogTypes';

export const discordLogRouteDefinitions = [
    {
        key: 'system.action',
        label: 'Panel Action Logs',
        description: 'Log panel-side actions, moderation activity, and ticket workflow events.',
        supportsEntryFilter: true,
    },
    {
        key: 'whitelist',
        label: 'Whitelist Logs',
        description: 'Log whitelist applications, approvals, grants, and revocations.',
        supportsEntryFilter: true,
    },
    {
        key: 'system.command',
        label: 'Panel Command Logs',
        description: 'Log server control commands and live console commands executed through sxPanel.',
        supportsEntryFilter: true,
    },
    {
        key: 'system.login',
        label: 'Login Logs',
        description: 'Log successful administrator sign-ins.',
        supportsEntryFilter: true,
    },
    {
        key: 'system.config',
        label: 'Config Change Logs',
        description: 'Log configuration changes saved through sxPanel.',
        supportsEntryFilter: true,
    },
    {
        key: 'system.monitor',
        label: 'Monitor Logs',
        description: 'Log monitor events such as restarts, crash handling, and health alerts.',
        supportsEntryFilter: true,
    },
    {
        key: 'system.scheduler',
        label: 'Scheduler Logs',
        description: 'Log scheduled actions handled by the server scheduler.',
        supportsEntryFilter: true,
    },
    {
        key: 'system.system',
        label: 'System Logs',
        description: 'Log other sxPanel system events that do not fall into a more specific category.',
        supportsEntryFilter: true,
    },
    {
        key: 'server.menu',
        label: 'Admin Command Logs',
        description:
            'Log in-game admin menu actions such as noclip, teleport, heal, spectate, vehicle tools, and troll actions.',
        supportsEntryFilter: true,
    },
    {
        key: 'server.combat',
        label: 'Combat Logs',
        description:
            'Log player kills, other deaths, and non-lethal combat summaries. Hit, damage, and distance details require the Combat Log to be enabled by the server owner in Game settings.',
        supportsEntryFilter: true,
    },
    {
        key: 'server.connection',
        label: 'Player Connection Logs',
        description: 'Log players joining and leaving the server, and joins denied by bans or the whitelist.',
        supportsEntryFilter: true,
    },
    {
        key: 'server.chat',
        label: 'Chat Logs',
        description: 'Log in-game chat messages. Busy servers may want a dedicated channel for this stream.',
        supportsEntryFilter: false,
    },
] as const;

export type DiscordLogRouteKey = (typeof discordLogRouteDefinitions)[number]['key'];

export type DiscordLogRouteEntryDefinition = {
    id: string;
    label: string;
    description: string;
};

export type DiscordLogRouteConfig = {
    key: DiscordLogRouteKey;
    enabled: boolean;
    channelId: string | null;
    useEntryFilter: boolean;
    entryFilter: string[];
};

export const discordMenuCommandDefinitions = [
    {
        id: 'players.noclip',
        label: 'NoClip',
        description: 'Toggle noclip in the in-game admin menu.',
        permissionId: 'players.noclip',
    },
    {
        id: 'players.godmode',
        label: 'God Mode',
        description: 'Toggle god mode in the in-game admin menu.',
        permissionId: 'players.godmode',
    },
    {
        id: 'players.superjump',
        label: 'Super Jump',
        description: 'Toggle super jump in the in-game admin menu.',
        permissionId: 'players.superjump',
    },
    {
        id: 'players.standard_mode',
        label: 'Return To Standard Mode',
        description: 'Disable the active player mode and return to standard play.',
        permissionId: 'players.noclip',
    },
    {
        id: 'players.teleport.waypoint',
        label: 'Teleport To Waypoint',
        description: 'Teleport to the current waypoint.',
        permissionId: 'players.teleport',
    },
    {
        id: 'players.teleport.coords',
        label: 'Teleport To Coordinates',
        description: 'Teleport to specific coordinates.',
        permissionId: 'players.teleport',
    },
    {
        id: 'players.teleport.player',
        label: 'Teleport To Player',
        description: 'Teleport to another player from the player modal.',
        permissionId: 'players.teleport',
    },
    {
        id: 'players.summon',
        label: 'Summon Player',
        description: 'Summon a player to your position.',
        permissionId: 'players.teleport',
    },
    {
        id: 'players.spectate',
        label: 'Spectate Player',
        description: 'Start spectating a player.',
        permissionId: 'players.spectate',
    },
    {
        id: 'players.freeze',
        label: 'Freeze Player',
        description: 'Toggle freeze on a player.',
        permissionId: 'players.freeze',
    },
    {
        id: 'players.heal.self',
        label: 'Heal Self',
        description: 'Heal yourself from the main page.',
        permissionId: 'players.heal',
    },
    {
        id: 'players.heal.all',
        label: 'Heal All Players',
        description: 'Heal every player on the server.',
        permissionId: 'players.heal',
    },
    {
        id: 'players.heal.radius',
        label: 'Heal Radius',
        description: 'Heal players within a radius.',
        permissionId: 'players.heal',
    },
    {
        id: 'players.heal.player',
        label: 'Heal Player',
        description: 'Heal a specific player.',
        permissionId: 'players.heal',
    },
    {
        id: 'menu.vehicle.spawn',
        label: 'Spawn Vehicle',
        description: 'Spawn a vehicle from the in-game menu.',
        permissionId: 'menu.vehicle.spawn',
    },
    {
        id: 'menu.vehicle.delete',
        label: 'Delete Vehicle',
        description: 'Delete a vehicle from the in-game menu.',
        permissionId: 'menu.vehicle.delete',
    },
    {
        id: 'menu.vehicle.fix',
        label: 'Repair Vehicle',
        description: 'Repair your current vehicle.',
        permissionId: 'menu.vehicle.fix',
    },
    {
        id: 'menu.vehicle.boost',
        label: 'Boost Vehicle',
        description: 'Boost your current vehicle.',
        permissionId: 'menu.vehicle.boost',
    },
    {
        id: 'menu.clear_area',
        label: 'Clear Area',
        description: 'Clear a world area around you.',
        permissionId: 'menu.clear_area',
    },
    {
        id: 'announcement',
        label: 'Announcement',
        description: 'Send a server-wide announcement.',
        permissionId: 'announcement',
    },
    {
        id: 'menu.viewids',
        label: 'Show Player IDs',
        description: 'Toggle the overhead player ID display.',
        permissionId: 'menu.viewids',
    },
    {
        id: 'menu.mapblips',
        label: 'Show Map Blips',
        description: 'Toggle player blips on the in-game map.',
        permissionId: 'menu.mapblips',
    },
    {
        id: 'players.invisible',
        label: 'Invisibility',
        description: 'Toggle invisibility in the in-game admin menu.',
        permissionId: 'players.invisible',
    },
    {
        id: 'players.return',
        label: 'Return Player',
        description: 'Send a player back to where they were before being brought.',
        permissionId: 'players.teleport',
    },
    {
        id: 'players.disarm',
        label: 'Disarm Player',
        description: 'Remove all weapons from a player.',
        permissionId: 'players.disarm',
    },
    {
        id: 'menu.devtools',
        label: 'Developer Tools',
        description: 'Toggle the coordinates HUD or the entity inspector.',
        permissionId: 'menu.devtools',
    },
    {
        id: 'menu.delete_entities.aimed',
        label: 'Delete Aimed Entity',
        description: 'Delete an entity using the entity inspector.',
        permissionId: 'menu.delete_entities',
    },
    {
        id: 'menu.delete_entities.vehicles',
        label: 'Clean Up Vehicles',
        description: 'Delete unoccupied vehicles within a radius.',
        permissionId: 'menu.delete_entities',
    },
    {
        id: 'menu.staffchat',
        label: 'Staff Chat',
        description: 'Send a staff-only chat message.',
        permissionId: 'menu.staffchat',
    },
    {
        id: 'players.troll.drunk',
        label: 'Drunk Effect',
        description: 'Trigger the drunk troll action on a player.',
        permissionId: 'players.troll',
    },
    {
        id: 'players.troll.fire',
        label: 'Set On Fire',
        description: 'Set a player on fire from the troll menu.',
        permissionId: 'players.troll',
    },
    {
        id: 'players.troll.wild_attack',
        label: 'Wild Attack',
        description: 'Trigger a wild attack on a player.',
        permissionId: 'players.troll',
    },
] as const;

export const discordCombatEntryDefinitions = [
    {
        id: 'combat.kill',
        label: 'Player Kills',
        description: 'A player killed another player. Includes hits, headshots, damage, and distance when available.',
    },
    {
        id: 'combat.death',
        label: 'Other Deaths',
        description: 'A player died without another player being responsible, such as falls, NPCs, or suicide.',
    },
    {
        id: 'combat.damage',
        label: 'Damage Summaries',
        description: 'A non-lethal fight between two players ended. Requires Combat Log damage summaries.',
    },
] as const;

export const discordConnectionEntryDefinitions = [
    {
        id: 'player.join',
        label: 'Player Joined',
        description: 'A player connected to the server.',
    },
    {
        id: 'player.leave',
        label: 'Player Left',
        description: 'A player disconnected from the server, including the drop reason.',
    },
    {
        id: 'player.join_denied',
        label: 'Join Denied',
        description: 'A connection was refused, for example due to an active ban.',
    },
] as const;

export type DiscordMenuCommandId = (typeof discordMenuCommandDefinitions)[number]['id'];
export type DiscordCombatEntryId = (typeof discordCombatEntryDefinitions)[number]['id'];
export type DiscordConnectionEntryId = (typeof discordConnectionEntryDefinitions)[number]['id'];
export type DiscordLogRouteEntryId =
    | DiscordMenuCommandId
    | DiscordCombatEntryId
    | DiscordConnectionEntryId
    | SystemLogActionId;

export const discordLogRouteEntryDefinitions = {
    'system.action': getSystemLogActionDefinitions('action'),
    whitelist: getSystemLogActionDefinitions('action').filter((entry) => {
        return entry.id.startsWith('whitelist.') || entry.id.startsWith('player.whitelist.');
    }),
    'system.command': getSystemLogActionDefinitions('command'),
    'system.login': getSystemLogActionDefinitions('login'),
    'system.config': getSystemLogActionDefinitions('config'),
    'system.monitor': getSystemLogActionDefinitions('monitor'),
    'system.scheduler': getSystemLogActionDefinitions('scheduler'),
    'system.system': getSystemLogActionDefinitions('system'),
    'server.menu': discordMenuCommandDefinitions,
    'server.combat': discordCombatEntryDefinitions,
    'server.connection': discordConnectionEntryDefinitions,
    'server.chat': [],
} satisfies Record<DiscordLogRouteKey, readonly DiscordLogRouteEntryDefinition[]>;

const discordLogRouteKeySet = new Set<string>(discordLogRouteDefinitions.map((route) => route.key));
const discordMenuCommandIdSet = new Set<string>(discordMenuCommandDefinitions.map((command) => command.id));

export const isDiscordLogRouteKey = (value: unknown): value is DiscordLogRouteKey => {
    return typeof value === 'string' && discordLogRouteKeySet.has(value);
};

export const isDiscordMenuCommandId = (value: unknown): value is DiscordMenuCommandId => {
    return typeof value === 'string' && discordMenuCommandIdSet.has(value);
};

export const getDiscordLogRouteEntryDefinitions = (routeKey: DiscordLogRouteKey) => {
    return discordLogRouteEntryDefinitions[routeKey];
};

export const normalizeDiscordLogRouteEntryFilter = (routeKey: DiscordLogRouteKey, value: unknown) => {
    if (!Array.isArray(value)) return [] as string[];

    const allowedIds = new Set<string>(getDiscordLogRouteEntryDefinitions(routeKey).map((entry) => entry.id));
    const seen = new Set<string>();
    const normalized = [] as string[];

    const pushEntry = (entryId: string) => {
        if (!allowedIds.has(entryId) || seen.has(entryId)) return;

        seen.add(entryId);
        normalized.push(entryId);
    };

    for (const entry of value) {
        if (typeof entry !== 'string') continue;

        if (routeKey === 'system.config' && entry === legacyConfigSaveActionId) {
            for (const definition of configChangeLogActionDefinitions) {
                pushEntry(definition.id);
            }
            continue;
        }

        pushEntry(entry);
    }

    return normalized;
};

export const normalizeDiscordMenuCommandFilter = (value: unknown) => {
    return normalizeDiscordLogRouteEntryFilter('server.menu', value) as DiscordMenuCommandId[];
};

export const normalizeDiscordLogRoutes = (value: unknown) => {
    if (!Array.isArray(value)) return [] as DiscordLogRouteConfig[];

    const seenKeys = new Set<string>();
    const normalized = [] as DiscordLogRouteConfig[];

    for (const entry of value) {
        if (!entry || typeof entry !== 'object') continue;

        const route = entry as Partial<DiscordLogRouteConfig> & {
            useCommandFilter?: boolean;
            commandFilter?: unknown;
        };
        if (!isDiscordLogRouteKey(route.key) || seenKeys.has(route.key)) continue;

        seenKeys.add(route.key);
        normalized.push({
            key: route.key,
            enabled: route.enabled === true,
            channelId:
                typeof route.channelId === 'string' && route.channelId.trim().length ? route.channelId.trim() : null,
            useEntryFilter:
                typeof route.useEntryFilter === 'boolean' ? route.useEntryFilter : route.useCommandFilter === true,
            entryFilter: normalizeDiscordLogRouteEntryFilter(
                route.key,
                Array.isArray(route.entryFilter) ? route.entryFilter : route.commandFilter,
            ),
        });
    }

    return normalized;
};

const discordLogRoutes = {
    discordLogRouteDefinitions,
    discordLogRouteEntryDefinitions,
    discordMenuCommandDefinitions,
    discordCombatEntryDefinitions,
    discordConnectionEntryDefinitions,
    isDiscordLogRouteKey,
    isDiscordMenuCommandId,
    getDiscordLogRouteEntryDefinitions,
    normalizeDiscordLogRouteEntryFilter,
    normalizeDiscordMenuCommandFilter,
    normalizeDiscordLogRoutes,
};

export default discordLogRoutes;
