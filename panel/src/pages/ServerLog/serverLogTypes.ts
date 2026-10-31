type ServerLogEventSource = {
    id: string | false;
    name: string;
};

export type ServerLogEvent = {
    ts: number;
    type: string;
    src: ServerLogEventSource;
    msg: string;
};

const EVENT_TYPES = [
    'playerJoining',
    'playerJoinDenied',
    'playerDropped',
    'ChatMessage',
    'DeathNotice',
    'CombatDamage',
    'MenuEvent',
    'explosionEvent',
    'CommandExecuted',
    'LoggerStarted',
    'DebugMessage',
] as const;

export type EventFilterKey =
    | 'joins'
    | 'leaves'
    | 'chat'
    | 'deaths'
    | 'combat'
    | 'menu'
    | 'explosions'
    | 'commands'
    | 'system';

export type EventFilterConfig = {
    key: EventFilterKey;
    label: string;
    types: string[];
    color: string;
    icon: string;
};

export const EVENT_FILTERS: EventFilterConfig[] = [
    {
        key: 'joins',
        label: 'Joins',
        types: ['playerJoining', 'playerJoinDenied'],
        color: 'text-green-500',
        icon: 'LogIn',
    },
    { key: 'leaves', label: 'Leaves', types: ['playerDropped'], color: 'text-orange-400', icon: 'LogOut' },
    { key: 'chat', label: 'Chat', types: ['ChatMessage'], color: 'text-blue-400', icon: 'MessageSquare' },
    { key: 'deaths', label: 'Deaths', types: ['DeathNotice'], color: 'text-red-500', icon: 'Skull' },
    { key: 'combat', label: 'Combat', types: ['CombatDamage'], color: 'text-orange-500', icon: 'Swords' },
    { key: 'menu', label: 'Menu', types: ['MenuEvent'], color: 'text-purple-400', icon: 'Menu' },
    { key: 'explosions', label: 'Explosions', types: ['explosionEvent'], color: 'text-yellow-500', icon: 'Flame' },
    { key: 'commands', label: 'Commands', types: ['CommandExecuted'], color: 'text-cyan-400', icon: 'Terminal' },
    {
        key: 'system',
        label: 'System',
        types: ['LoggerStarted', 'DebugMessage'],
        color: 'text-muted-foreground',
        icon: 'Settings',
    },
];

export type EventFiltersState = Record<EventFilterKey, boolean>;

export const DEFAULT_FILTERS: EventFiltersState = {
    joins: true,
    leaves: true,
    chat: true,
    deaths: true,
    combat: true,
    menu: true,
    explosions: true,
    commands: true,
    system: true,
};

export const LOCALSTORAGE_FILTERS_KEY = 'serverLogFilters';
export const LOCALSTORAGE_SOUND_KEY = 'serverLogSoundNotifs';
