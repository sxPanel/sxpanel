import type { BanTemplatesDataType, SvRtPerfThreadNamesType } from './otherTypes';
import type { ReactAuthDataType } from './authApiTypes';
import type { UpdateDataType } from './otherTypes';
import { DiscordBotStatus, TxConfigState, type FxMonitorHealth } from './enums';
import type { LiveConsoleInitialData } from './consoleBlock';
import type { SpectateFrameEventData } from './spectateApiTypes';
import type { ResourcesWsEventType } from './resourcesApiTypes';

export type SvRtNodeMemoryType = {
    used: number;
    limit: number;
};
export type SvRtPerfBoundariesType = Array<number | '+Inf'>;

/**
 * Status channel
 */
export type GlobalStatusType = {
    serverTime: number;
    language: string;
    configState: TxConfigState;
    discord: DiscordBotStatus;
    runner: {
        isIdle: boolean;
        isChildAlive: boolean;
    };
    server: {
        name: string;
        uptime: number;
        playerCount: number;
        health: FxMonitorHealth;
        healthReason: string;
        whitelist: 'disabled' | 'adminOnly' | 'approvedLicense' | 'discordMember' | 'discordRoles';
    };
    scheduler:
        | {
              nextRelativeMs: number;
              nextSkip: boolean;
              nextIsTemp: boolean;
          }
        | {
              nextRelativeMs: false;
              nextSkip: false;
              nextIsTemp: false;
          };
};

/**
 * Status channel
 */
export type DashboardSvRuntimeDataType = {
    fxsMemory?: number;
    nodeMemory?: SvRtNodeMemoryType;
    perfBoundaries?: SvRtPerfBoundariesType;
    perfBucketCounts?: {
        [key in SvRtPerfThreadNamesType]: number[];
    };
};
export type DashboardPleyerDropDataType = {
    summaryLast6h: [reasonCategory: string, count: number][];
};
export type DashboardDataEventType = {
    svRuntime: DashboardSvRuntimeDataType;
    playerDrop: DashboardPleyerDropDataType;
    // joinLeaveTally30m: {
    //     joined: number;
    //     left: number;
    // };
};

/**
 * Player tags
 */
export type TagDefinition = {
    id: string;
    label: string;
    color: string;
    /** Shown before the player name in overhead IDs (e.g. "[S] "). */
    prefix?: string;
    priority: number;
    enabled?: boolean;
    /** Nearest FiveM HUD colour index for in-game overhead tags (computed server-side). */
    hudColor?: number;
    discordRoleIds?: string[];
};

export const AUTO_TAG_DEFINITIONS: TagDefinition[] = [
    { id: 'staff', label: 'Staff', color: '#EF4444', prefix: '[S] ', priority: 10, enabled: true },
    { id: 'problematic', label: 'Problematic', color: '#FB923C', prefix: '[!] ', priority: 20, enabled: true },
    { id: 'newplayer', label: 'Newcomer', color: '#A3E635', prefix: '[N] ', priority: 30, enabled: true },
];

export type PlayerTag = string;

/**
 * Returns the highest-priority tag id from a player's tags that exists in the lookup.
 * Lower `priority` values rank higher. Tags missing from the lookup are ignored.
 */
export const getPrimaryPlayerTag = (
    tags: PlayerTag[],
    lookup: Record<string, Pick<TagDefinition, 'priority'>>,
): string | undefined => {
    //Guard against non-array input — empty Lua tables cross the NUI bridge as `{}`
    if (!Array.isArray(tags)) return undefined;

    let bestTag: string | undefined;
    let bestPriority = Infinity;

    for (const tagId of tags) {
        const definition = lookup[tagId];
        if (!definition) continue;
        if (definition.priority < bestPriority) {
            bestPriority = definition.priority;
            bestTag = tagId;
        }
    }

    return bestTag;
};

/**
 * Playerlist channel
 * TODO: apply those types to the playerlistManager
 */
export type FullPlayerlistEventType = {
    mutex: string | null;
    type: 'fullPlayerlist';
    playerlist: PlayerlistPlayerType[];
    tagDefinitions: TagDefinition[];
};

export type PlayerlistPlayerType = {
    netid: number;
    displayName: string;
    pureName: string;
    ids: string[];
    license: string | null;
    tags: PlayerTag[];
};

export type PlayerDroppedEventType = {
    mutex: string;
    type: 'playerDropped';
    netid: number;
    reasonCategory?: string; //missing in case of server shutdown
};

export type PlayerJoiningEventType = {
    mutex: string;
    type: 'playerJoining';
} & PlayerlistPlayerType;

export type PlayerlistEventType = FullPlayerlistEventType | PlayerDroppedEventType | PlayerJoiningEventType;

/**
 * Standalone events (no room)
 */
export type UpdateAvailableEventType = {
    fxserver?: UpdateDataType;
    txadmin?: UpdateDataType;
};

/**
 * Listen Events Map
 */
export type ListenEventsMap = {
    error: (reason?: string) => void;
    logout: (reason?: string) => void;
    refreshToUpdate: () => void;
    txAdminShuttingDown: () => void;
    fxpAdminShuttingDown: () => void;
    status: (status: GlobalStatusType) => void;
    playerlist: (playerlistData: PlayerlistEventType[]) => void;
    updateAuthData: (authData: ReactAuthDataType) => void;
    consoleData: (data: string | LiveConsoleInitialData) => void;
    logData: (data: { ts: number; type: string; src: { id: string | false; name: string }; msg: string }[]) => void;
    dashboard: (data: DashboardDataEventType) => void;
    banTemplatesUpdate: (data: BanTemplatesDataType[]) => void;
    resources: (data: ResourcesWsEventType) => void;
    addonReloaded: (data: { addonId: string; action: string }) => void;

    //Standalone events
    updateAvailable: (event: UpdateAvailableEventType) => void;

    //Live spectate
    spectateFrame: (data: SpectateFrameEventData) => void;
};
