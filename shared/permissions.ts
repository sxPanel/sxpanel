/**
 * Centralized permission definitions for txAdmin.
 * Used by both the backend (AdminStore) and the panel UI.
 */

export type PermCategoryId = 'system' | 'server' | 'ingame' | 'players' | 'addons';

export type PermissionDefinition = {
    id: string;
    label: string;
    description: string;
    category: PermCategoryId;
    dangerous?: boolean;
    /** If this perm was split from an old combined perm, list the old id here for migration */
    migratedFrom?: string;
    /** The addon ID that registered this permission (only for addon-registered perms) */
    addonId?: string;
};

export type PermCategory = {
    id: PermCategoryId;
    label: string;
};

export const permCategories: PermCategory[] = [
    { id: 'system', label: 'System' },
    { id: 'server', label: 'Server' },
    { id: 'ingame', label: 'In-Game Menu' },
    { id: 'players', label: 'Player Management' },
    { id: 'addons', label: 'Addons' },
];

/**
 * The full list of granular permissions.
 * Split permissions (ban/unban, spawn/fix, noclip/godmode/superjump) are now separate.
 */
export const registeredPermissions: PermissionDefinition[] = [
    // ── System ──
    {
        id: 'all_permissions',
        label: 'All Permissions',
        description: 'Root permission — grants every other permission.',
        category: 'system',
        dangerous: true,
    },
    {
        id: 'manage.admins',
        label: 'Manage Admins',
        description: 'Create, edit, and delete admin accounts.',
        category: 'system',
        dangerous: true,
    },
    {
        id: 'settings.view',
        label: 'Settings: View',
        description: 'View settings (sensitive tokens hidden).',
        category: 'system',
    },
    {
        id: 'settings.write',
        label: 'Settings: Change',
        description: 'Modify sxPanel settings.',
        category: 'system',
        dangerous: true,
    },
    {
        id: 'txadmin.log.view',
        label: 'View System Logs',
        description: 'View sxPanel system and admin action logs.',
        category: 'system',
    },
    {
        id: 'txadmin.log.view_ips',
        label: 'View Login IPs',
        description: 'View the IP addresses recorded in admin login log entries.',
        category: 'system',
    },

    // ── Server ──
    {
        id: 'console.view',
        label: 'Console: View',
        description: 'View the live FXServer console.',
        category: 'server',
    },
    {
        id: 'console.write',
        label: 'Console: Write',
        description: 'Execute commands in the FXServer console.',
        category: 'server',
        dangerous: true,
    },
    {
        id: 'control.server',
        label: 'Start / Stop / Restart Server',
        description: 'Start, stop, restart the FXServer and scheduler.',
        category: 'server',
    },
    {
        id: 'announcement',
        label: 'Send Announcements',
        description: 'Broadcast announcements to all players.',
        category: 'server',
    },
    {
        id: 'commands.resources',
        label: 'Start / Stop Resources',
        description: 'Start or stop server resources.',
        category: 'server',
    },
    {
        id: 'commands.resources.download',
        label: 'Download Resources',
        description: 'Zip and download a resource folder from the server host.',
        category: 'server',
    },
    {
        id: 'server.cfg.editor',
        label: 'server.cfg Editor',
        description: 'Read and write the server.cfg file.',
        category: 'server',
    },
    {
        id: 'server.log.view',
        label: 'View Server Logs',
        description: 'View FXServer log output.',
        category: 'server',
    },

    // ── In-Game Menu ──
    {
        id: 'menu.vehicle.spawn',
        label: 'Spawn Vehicles',
        description: 'Spawn vehicles via the in-game menu.',
        category: 'ingame',
        migratedFrom: 'menu.vehicle',
    },
    {
        id: 'menu.vehicle.fix',
        label: 'Fix Vehicles',
        description: 'Repair vehicles via the in-game menu.',
        category: 'ingame',
        migratedFrom: 'menu.vehicle',
    },
    {
        id: 'menu.vehicle.boost',
        label: 'Boost Vehicles',
        description: 'Boost vehicles via the in-game menu.',
        category: 'ingame',
        migratedFrom: 'menu.vehicle',
    },
    {
        id: 'menu.vehicle.delete',
        label: 'Delete Vehicles',
        description: 'Delete vehicles via the in-game menu.',
        category: 'ingame',
        migratedFrom: 'menu.vehicle',
    },
    {
        id: 'menu.clear_area',
        label: 'Reset World Area',
        description: 'Reset a world area via the in-game menu.',
        category: 'ingame',
    },
    {
        id: 'menu.viewids',
        label: 'View Player IDs',
        description: 'See player IDs overhead in-game.',
        category: 'ingame',
    },
    {
        id: 'menu.mapblips',
        label: 'View Map Blips',
        description: 'See all players on the in-game map via map blips.',
        category: 'ingame',
    },

    // ── Player Management ──
    {
        id: 'players.direct_message',
        label: 'Direct Message',
        description: 'Send direct messages to players.',
        category: 'players',
    },
    {
        id: 'players.whitelist',
        label: 'Whitelist',
        description: 'Whitelist players.',
        category: 'players',
    },
    {
        id: 'players.warn',
        label: 'Warn',
        description: 'Issue warnings to players.',
        category: 'players',
    },
    {
        id: 'players.kick',
        label: 'Kick',
        description: 'Kick players from the server.',
        category: 'players',
    },
    {
        id: 'players.ban',
        label: 'Ban',
        description: 'Ban players from the server. Only temporary bans, unless "Ban: Permanent" is also granted.',
        category: 'players',
    },
    {
        id: 'players.ban.permanent',
        label: 'Ban: Permanent',
        description: 'Apply permanent bans, and turn existing temporary bans into permanent ones.',
        category: 'players',
        dangerous: true,
    },
    {
        id: 'players.unban',
        label: 'Unban',
        description: 'Revoke existing player bans.',
        category: 'players',
        migratedFrom: 'players.ban',
    },
    {
        id: 'players.freeze',
        label: 'Freeze Players',
        description: 'Freeze player peds in-game.',
        category: 'players',
    },
    {
        id: 'players.heal',
        label: 'Heal',
        description: 'Heal self or all players.',
        category: 'players',
    },
    {
        id: 'players.noclip',
        label: 'NoClip',
        description: 'Toggle NoClip mode for yourself.',
        category: 'players',
        migratedFrom: 'players.playermode',
    },
    {
        id: 'players.godmode',
        label: 'God Mode',
        description: 'Toggle invincibility for yourself.',
        category: 'players',
        migratedFrom: 'players.playermode',
    },
    {
        id: 'players.superjump',
        label: 'Super Jump',
        description: 'Toggle super jump for yourself.',
        category: 'players',
        migratedFrom: 'players.playermode',
    },
    {
        id: 'players.spectate',
        label: 'Spectate',
        description: 'Spectate players.',
        category: 'players',
    },
    {
        id: 'players.teleport',
        label: 'Teleport',
        description: 'Teleport self or bring/go to players.',
        category: 'players',
    },
    {
        id: 'players.troll',
        label: 'Troll Actions',
        description: 'Use the troll menu on players.',
        category: 'players',
    },
    {
        id: 'players.reports',
        label: 'Reports',
        description: 'View and manage player reports.',
        category: 'players',
    },
    {
        id: 'manage_tickets',
        label: 'Manage Tickets',
        description: 'Delete any ticket at any time.',
        category: 'players',
        dangerous: true,
    },
    {
        id: 'players.delete',
        label: 'Remove Player Data',
        description: 'Delete bans/warns, players, and player identifiers.',
        category: 'players',
        dangerous: true,
    },
];

/**
 * Map of old (combined) permission id → array of new permission ids it was split into.
 * Used for migrating admins.json on load.
 */
export const permMigrationMap: Record<string, string[]> = {
    'menu.vehicle': ['menu.vehicle.spawn', 'menu.vehicle.fix', 'menu.vehicle.boost', 'menu.vehicle.delete'],
    'players.playermode': ['players.noclip', 'players.godmode', 'players.superjump'],
    // players.ban now only means "ban"; the new "players.unban" is separate
};

/**
 * Quick lookup: permission id → definition
 */
export const permissionsMap = new Map<string, PermissionDefinition>(registeredPermissions.map((p) => [p.id, p]));

/**
 * All valid permission ids (for validation).
 */
export const allPermissionIds = registeredPermissions.map((p) => p.id);

/**
 * Grouped permissions by category (handy for rendering).
 */
export const permissionsByCategory = permCategories.map((cat) => ({
    ...cat,
    permissions: registeredPermissions.filter((p) => p.category === cat.id),
}));

// ── Presets ──

export type PermissionPreset = {
    id: string;
    name: string;
    permissions: string[];
};
