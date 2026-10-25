/**
 * Custom chat commands — definitions shared by core (validation/storage),
 * the panel (editor UI) and mirrored by resource/sv_custom_commands.lua.
 *
 * NOTE: the menu action ids below are dispatched by resource/cl_custom_commands.lua,
 * keep both lists in sync when adding new actions.
 */
import { z } from 'zod';

export const CUSTOM_COMMAND_ID_LENGTH = 16;
export const CUSTOM_COMMANDS_MAX = 100;
export const CUSTOM_COMMAND_MAX_ALIASES = 5;
export const CUSTOM_COMMAND_NAME_REGEX = /^[a-z0-9_-]{1,32}$/;
export const CUSTOM_COMMAND_EVENT_REGEX = /^[\w:.-]{1,96}$/;

/**
 * Command names that are already registered by sxPanel or are FXServer built-ins.
 * Custom commands cannot shadow them, since client-registered commands always win
 * and overriding core commands would be confusing (or dangerous).
 */
export const RESERVED_COMMAND_NAMES = new Set([
    // sxPanel built-in chat commands
    'tx',
    'txadmin',
    'txadmin-reauth',
    'ban',
    'kick',
    'warn',
    'announce',
    'goto',
    'tpm',
    'ticket',
    'report',
    'staffchat',
    // FXServer / common built-ins
    'quit',
    'disconnect',
    'connect',
    'restart',
    'start',
    'stop',
    'ensure',
    'refresh',
    'say',
    'exec',
    'set',
    'sets',
    'setr',
    'seta',
    'add_ace',
    'add_principal',
    'remove_ace',
    'remove_principal',
    'cmdlist',
    'netgraph',
    'loadlevel',
    'bind',
    'unbind',
    'rbind',
]);

/**
 * MARK: Menu actions
 * Actions from the /tx menu that can be exposed as chat commands.
 */
export type CustomCommandMenuActionArg = {
    name: string;
    help: string;
    /** If omitted, the action falls back to its menu dialog (when there is one) */
    optional?: boolean;
};

export type CustomCommandMenuActionDef = {
    id: string;
    label: string;
    description: string;
    group: 'Teleport' | 'Health' | 'Player Mode' | 'Vehicle' | 'World' | 'Players' | 'Staff Tools' | 'Server';
    /** The permission required by the underlying menu action (re-checked server-side) */
    permission: string;
    /** Name suggested when adding this action as a command */
    suggestedName: string;
    args: CustomCommandMenuActionArg[];
};

export const customCommandMenuActions = [
    // Teleport
    {
        id: 'tpWaypoint',
        label: 'Teleport to Waypoint',
        description: 'Teleports you to the map waypoint.',
        group: 'Teleport',
        permission: 'players.teleport',
        suggestedName: 'tpw',
        args: [],
    },
    {
        id: 'tpCoords',
        label: 'Teleport to Coords',
        description: 'Teleports you to the given coordinates. Opens the coords dialog when used without arguments.',
        group: 'Teleport',
        permission: 'players.teleport',
        suggestedName: 'tpc',
        args: [
            { name: 'x', help: 'X coordinate', optional: true },
            { name: 'y', help: 'Y coordinate', optional: true },
            { name: 'z', help: 'Z coordinate (0 = ground)', optional: true },
        ],
    },
    {
        id: 'tpBack',
        label: 'Teleport Back',
        description: 'Returns you to where you were before your last teleport.',
        group: 'Teleport',
        permission: 'players.teleport',
        suggestedName: 'tpback',
        args: [],
    },
    {
        id: 'bringPlayer',
        label: 'Bring Player',
        description: 'Teleports a player to you.',
        group: 'Teleport',
        permission: 'players.teleport',
        suggestedName: 'bring',
        args: [{ name: 'player ID', help: 'Server ID of the player to bring' }],
    },
    {
        id: 'returnPlayer',
        label: 'Return Player',
        description: 'Sends a player back to where they were before you last brought them.',
        group: 'Teleport',
        permission: 'players.teleport',
        suggestedName: 'return',
        args: [{ name: 'player ID', help: 'Server ID of the player to send back' }],
    },

    // Health
    {
        id: 'healSelf',
        label: 'Heal Yourself',
        description: 'Heals (and revives) yourself.',
        group: 'Health',
        permission: 'players.heal',
        suggestedName: 'healme',
        args: [],
    },
    {
        id: 'healPlayer',
        label: 'Heal Player',
        description: 'Heals (and revives) a specific player.',
        group: 'Health',
        permission: 'players.heal',
        suggestedName: 'heal',
        args: [{ name: 'player ID', help: 'Server ID of the player to heal' }],
    },
    {
        id: 'healAll',
        label: 'Heal Everyone',
        description: 'Heals (and revives) every player on the server.',
        group: 'Health',
        permission: 'players.heal',
        suggestedName: 'healall',
        args: [],
    },
    {
        id: 'healRadius',
        label: 'Heal Radius',
        description: 'Heals every player within the given radius around you.',
        group: 'Health',
        permission: 'players.heal',
        suggestedName: 'healradius',
        args: [{ name: 'radius', help: 'Radius in meters (1-500)' }],
    },

    // Player mode
    {
        id: 'noclip',
        label: 'Toggle NoClip',
        description: 'Toggles NoClip on or off.',
        group: 'Player Mode',
        permission: 'players.noclip',
        suggestedName: 'noclip',
        args: [],
    },
    {
        id: 'godmode',
        label: 'God Mode',
        description: 'Switches your player mode to God Mode.',
        group: 'Player Mode',
        permission: 'players.godmode',
        suggestedName: 'god',
        args: [],
    },
    {
        id: 'superjump',
        label: 'Super Jump',
        description: 'Switches your player mode to Super Jump.',
        group: 'Player Mode',
        permission: 'players.superjump',
        suggestedName: 'superjump',
        args: [],
    },
    {
        id: 'normalMode',
        label: 'Normal Mode',
        description: 'Disables NoClip, God Mode and Super Jump.',
        group: 'Player Mode',
        permission: 'players.noclip',
        suggestedName: 'normal',
        args: [],
    },
    {
        id: 'toggleInvisible',
        label: 'Toggle Invisibility',
        description: 'Hides you from other players, or makes you visible again.',
        group: 'Player Mode',
        permission: 'players.invisible',
        suggestedName: 'invis',
        args: [],
    },

    // Vehicle
    {
        id: 'spawnVehicle',
        label: 'Spawn Vehicle',
        description: 'Spawns a vehicle by model name. Opens the spawn dialog when used without arguments.',
        group: 'Vehicle',
        permission: 'menu.vehicle.spawn',
        suggestedName: 'car',
        args: [{ name: 'model', help: 'Vehicle model name (eg. adder)', optional: true }],
    },
    {
        id: 'fixVehicle',
        label: 'Fix Vehicle',
        description: 'Repairs the vehicle you are in.',
        group: 'Vehicle',
        permission: 'menu.vehicle.fix',
        suggestedName: 'fix',
        args: [],
    },
    {
        id: 'deleteVehicle',
        label: 'Delete Vehicle',
        description: 'Deletes the vehicle you are in.',
        group: 'Vehicle',
        permission: 'menu.vehicle.delete',
        suggestedName: 'dv',
        args: [],
    },
    {
        id: 'boostVehicle',
        label: 'Boost Vehicle',
        description: 'Boosts the vehicle you are in.',
        group: 'Vehicle',
        permission: 'menu.vehicle.boost',
        suggestedName: 'boost',
        args: [],
    },

    // World
    {
        id: 'clearArea',
        label: 'Clear Area',
        description: 'Clears entities around you. Opens the radius dialog when used without arguments.',
        group: 'World',
        permission: 'menu.clear_area',
        suggestedName: 'cleararea',
        args: [{ name: 'radius', help: 'Radius in meters', optional: true }],
    },
    {
        id: 'togglePlayerIds',
        label: 'Toggle Player IDs',
        description: 'Shows or hides overhead player IDs.',
        group: 'World',
        permission: 'menu.viewids',
        suggestedName: 'ids',
        args: [],
    },
    {
        id: 'toggleMapBlips',
        label: 'Toggle Player Blips',
        description: 'Shows or hides player blips on the map.',
        group: 'World',
        permission: 'menu.mapblips',
        suggestedName: 'blips',
        args: [],
    },
    {
        id: 'cleanupVehicles',
        label: 'Clean Up Vehicles',
        description:
            'Deletes every unoccupied vehicle within the given radius around you. Opens the radius dialog when used without arguments.',
        group: 'World',
        permission: 'menu.delete_entities',
        suggestedName: 'dvall',
        args: [{ name: 'radius', help: 'Radius in meters (1-300)', optional: true }],
    },

    // Players
    {
        id: 'spectatePlayer',
        label: 'Spectate Player',
        description: 'Starts spectating a player.',
        group: 'Players',
        permission: 'players.spectate',
        suggestedName: 'spectate',
        args: [{ name: 'player ID', help: 'Server ID of the player to spectate' }],
    },
    {
        id: 'freezePlayer',
        label: 'Freeze Player',
        description: 'Toggles freeze on a player.',
        group: 'Players',
        permission: 'players.freeze',
        suggestedName: 'freeze',
        args: [{ name: 'player ID', help: 'Server ID of the player to (un)freeze' }],
    },
    {
        id: 'disarmPlayer',
        label: 'Disarm Player',
        description: 'Removes all weapons from a player.',
        group: 'Players',
        permission: 'players.disarm',
        suggestedName: 'disarm',
        args: [{ name: 'player ID', help: 'Server ID of the player to disarm' }],
    },
    {
        id: 'openPlayersPage',
        label: 'Open Players Page',
        description: 'Opens the /tx menu directly on the players page.',
        group: 'Players',
        permission: '',
        suggestedName: 'players',
        args: [],
    },

    // Staff tools
    {
        id: 'staffChat',
        label: 'Staff Chat',
        description: 'Sends a message only visible to online staff. Same as the built-in /staffchat command.',
        group: 'Staff Tools',
        permission: 'menu.staffchat',
        suggestedName: 'sc',
        args: [{ name: 'message', help: 'The message to send to online staff' }],
    },
    {
        id: 'toggleCoordsHud',
        label: 'Toggle Coords HUD',
        description: 'Shows or hides your live coordinates and heading on screen.',
        group: 'Staff Tools',
        permission: 'menu.devtools',
        suggestedName: 'coords',
        args: [],
    },
    {
        id: 'toggleInspector',
        label: 'Toggle Entity Inspector',
        description:
            'Shows details about the entity you are aiming at. With the Delete Entities permission, press DELETE to remove it.',
        group: 'Staff Tools',
        permission: 'menu.devtools',
        suggestedName: 'inspect',
        args: [],
    },

    // Server
    {
        id: 'restartServer',
        label: 'Restart Server',
        description: 'Restarts the FXServer.',
        group: 'Server',
        permission: 'control.server',
        suggestedName: 'restartserver',
        args: [],
    },
    {
        id: 'stopServer',
        label: 'Stop Server',
        description: 'Stops the FXServer. It stays offline until started from the panel.',
        group: 'Server',
        permission: 'control.server',
        suggestedName: 'stopserver',
        args: [],
    },
] as const satisfies readonly CustomCommandMenuActionDef[];

export type CustomCommandMenuActionId = (typeof customCommandMenuActions)[number]['id'];
export const customCommandMenuActionIds = customCommandMenuActions.map((a) => a.id) as [
    CustomCommandMenuActionId,
    ...CustomCommandMenuActionId[],
];
export const getMenuActionDef = (id: string): CustomCommandMenuActionDef | undefined =>
    customCommandMenuActions.find((a) => a.id === id);

/**
 * MARK: Command schema
 */
export const customCommandActionTypes = [
    'menuAction',
    'chatMessage',
    'consoleCommand',
    'serverEvent',
    'clientEvent',
] as const;
export type CustomCommandActionType = (typeof customCommandActionTypes)[number];

const commandNameSchema = z
    .string()
    .trim()
    .toLowerCase()
    .regex(CUSTOM_COMMAND_NAME_REGEX, 'Only lowercase letters, numbers, - and _ are allowed (max 32 chars).')
    .refine((name) => !RESERVED_COMMAND_NAMES.has(name), { message: 'This command name is reserved.' });

export const CustomCommandActionSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('menuAction'),
        actionId: z.enum(customCommandMenuActionIds),
    }),
    z.object({
        type: z.literal('chatMessage'),
        message: z.string().trim().min(1).max(1000),
        broadcast: z.boolean(),
    }),
    z.object({
        type: z.literal('consoleCommand'),
        command: z.string().trim().min(1).max(500),
    }),
    z.object({
        type: z.literal('serverEvent'),
        eventName: z.string().regex(CUSTOM_COMMAND_EVENT_REGEX, 'Invalid event name.'),
    }),
    z.object({
        type: z.literal('clientEvent'),
        eventName: z.string().regex(CUSTOM_COMMAND_EVENT_REGEX, 'Invalid event name.'),
    }),
]);
export type CustomCommandAction = z.infer<typeof CustomCommandActionSchema>;

export const CustomCommandSchema = z.object({
    id: z
        .string()
        .regex(/^[a-zA-Z0-9]+$/)
        .length(CUSTOM_COMMAND_ID_LENGTH),
    name: commandNameSchema,
    aliases: z.array(commandNameSchema).max(CUSTOM_COMMAND_MAX_ALIASES).default([]),
    description: z.string().trim().max(128).default(''),
    enabled: z.boolean(),
    /** Empty string = anyone can use it; otherwise an sxPanel permission id */
    permission: z.string().max(64),
    cooldownSeconds: z.number().int().min(0).max(3600).default(0),
    action: CustomCommandActionSchema,
});
export type CustomCommand = z.infer<typeof CustomCommandSchema>;

/**
 * Validates the cross-command rules: unique ids and no name/alias collisions.
 * Returns a list of human readable errors (empty if valid).
 */
export const findCustomCommandConflicts = (commands: CustomCommand[]) => {
    const errors: string[] = [];
    if (commands.length > CUSTOM_COMMANDS_MAX) {
        errors.push(`At most ${CUSTOM_COMMANDS_MAX} custom commands are allowed.`);
    }
    const ids = new Set<string>();
    const names = new Map<string, string>();
    for (const cmd of commands) {
        if (ids.has(cmd.id)) errors.push(`Duplicate command id: ${cmd.id}`);
        ids.add(cmd.id);
        for (const name of [cmd.name, ...cmd.aliases]) {
            const owner = names.get(name);
            if (owner !== undefined) {
                errors.push(
                    owner === cmd.name
                        ? `/${cmd.name} lists "${name}" more than once.`
                        : `"/${name}" is used by both /${owner} and /${cmd.name}.`,
                );
            } else {
                names.set(name, cmd.name);
            }
        }
    }
    return errors;
};

export const CustomCommandsArraySchema = z.array(CustomCommandSchema).superRefine((cmds, ctx) => {
    for (const message of findCustomCommandConflicts(cmds)) {
        ctx.addIssue({ code: 'custom', message });
    }
});

/**
 * Whether saving this command requires console write access.
 * Console commands run arbitrary server commands, and server events can reach any resource handler.
 */
export const isPrivilegedCustomCommand = (cmd: Pick<CustomCommand, 'action'>) =>
    cmd.action.type === 'consoleCommand' || cmd.action.type === 'serverEvent';

/**
 * MARK: API types
 */
export type GetCustomCommandsResp = {
    commands: CustomCommand[];
    menuEnabled: boolean;
    serverOnline: boolean;
};
export type SaveCustomCommandsReq = {
    commands: CustomCommand[];
};
export type SaveCustomCommandsResp = { success: true; liveReloaded: boolean } | { error: string };
