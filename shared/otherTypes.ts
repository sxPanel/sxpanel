import type { ReactAuthDataType } from './authApiTypes';

import type { PermissionDefinition } from './permissions';

//Config stuff
export type TxConfigs = any;
export type PartialTxConfigs = any;
export type ConfigChangelogEntry = any;
export type GetConfigsResp = any;
export type SaveConfigsReq = any;
export type SaveConfigsResp = any;
export type BanTemplatesDataType = any;
export type BanDurationType = any;
export type ResetServerDataPathResp = any;
export type GetBanTemplatesSuccessResp = any;
export type SaveBanTemplatesResp = any;
export type SaveBanTemplatesReq = any;
export type CustomThemeDataType = any;
export type GetCustomThemesSuccessResp = any;
export type SaveCustomThemesResp = any;
export type SaveCustomThemesReq = any;

//Stats stuff
export type SvRtLogFilteredType = any;
export type SvRtPerfCountsThreadType = any;
export type SvRtPerfThreadNamesType = 'svMain' | 'svNetwork' | 'svSync';
export type PerfChartApiResp = any;
export type PerfChartApiSuccessResp = any;
export type PlayerDropsApiResp = any;
export type PlayerDropsApiSuccessResp = any;
export type PlayerDropsDetailedWindow = any;
export type PlayerDropsSummaryHour = any;
export type PDLChangeEventType = any;

//Other stuff
export type { ApiAddLegacyBanReqSchema, ApiRevokeActionReqSchema, ApiDeleteActionReqSchema } from './historyApiSchemas';

export type UpdateDataType =
    | {
          version: string;
          isImportant: boolean;
          downloadUrl?: string;
      }
    | undefined;

export type FxUpdateStatus =
    | { phase: 'idle' }
    | { phase: 'downloading'; percentage: number }
    | { phase: 'extracting' }
    | { phase: 'extracted' }
    | { phase: 'applying' }
    | { phase: 'error'; message: string };

export type FxUpdateStatusResp = {
    currentVersion: number;
    currentVersionTag: string;
    updateData: UpdateDataType;
    updateStatus: FxUpdateStatus;
};

export type ArtifactTierInfo = {
    tier: 'latest' | 'recommended' | 'optional' | 'critical';
    version: number;
    downloadUrl: string;
};

export type ArtifactListResp = {
    currentVersion: number;
    currentVersionTag: string;
    minCompatibleVersion: number;
    tiers: ArtifactTierInfo[];
    updateStatus: FxUpdateStatus;
    customDownloadEnabled: boolean;
};

export type PanelReleaseInfo = {
    version: string;
    isPrerelease: boolean;
    isOutdated: boolean;
    releaseUrl: string;
    zipUrl: string;
    shaUrl: string;
};

/**
 * How a downloaded sxPanel update gets applied once it's sitting in the staging folder.
 * - now: stop the server, install into the monitor folder, relaunch FXServer.
 * - scheduled: same as "now", but at a set time with in-game/Discord countdown warnings.
 * - manual: a background script installs the files as soon as the admin closes FXServer;
 *           the admin starts it again themselves.
 */
export type PanelUpdateApplyMode = 'now' | 'scheduled' | 'manual';

export type PanelUpdateRestartPlan = { mode: 'scheduled'; scheduledTs: number } | { mode: 'manual' } | undefined;

export type PanelUpdateApplyReq = {
    mode: PanelUpdateApplyMode;
    /** Required for mode=scheduled. Minutes from now (1 - 1440). */
    delayMinutes?: number;
};

export type PanelUpdateListResp = {
    currentVersion: string;
    latestRelease?: PanelReleaseInfo;
    updateStatus: FxUpdateStatus;
    /** Version currently sitting in the staging folder, ready to install. */
    stagedVersion?: string;
    restartPlan: PanelUpdateRestartPlan;
    isWindows: boolean;
};

export type ThemeType = {
    id: string;
    name: string;
    isDark: boolean;
    style: { [key: string]: string };
};

/**
 * sxPanel optional-page toggle keys. Must stay in sync with the `panelFeatures`
 * config scope (core/modules/ConfigStore/schema/panelFeatures.ts) and the
 * `featureFlag` tags in panel/src/layout/sidebarConfig.ts + MainRouter.tsx.
 */
export const PANEL_FEATURE_KEYS = [
    'whitelistPage',
    'historyPage',
    'insightsPage',
    'playerDropsPage',
    'reportAnalyticsPage',
    'resourcesPage',
    'cfgEditorPage',
    'databasePage',
    'serverLogPage',
    'actionLogPage',
    'consoleLogPage',
    'addonsPage',
] as const;
export type PanelFeatureKey = (typeof PANEL_FEATURE_KEYS)[number];

export type InjectedTxConsts = {
    //Env
    fxsVersion: string;
    fxsOutdated: UpdateDataType;
    fxsIsGen9: boolean;
    txaVersion: string;
    txaOutdated: UpdateDataType;

    serverTimezone: string;
    isWindows: boolean;
    isWebInterface: boolean;
    showAdvanced: boolean;
    hasMasterAccount: boolean;
    defaultTheme: string;
    customThemes: Omit<ThemeType, 'style'>[];
    providerLogo: string | undefined;
    providerName: string | undefined;
    hostConfigSource: string;
    server: {
        name: string;
        game: string | undefined;
        icon: string | undefined;
        /** Inlined icon (from `load_server_icon` / runtime) for login/NUI where `/.runtime/` may not resolve. */
        iconDataUrl: string | undefined;
        desc: string | undefined;
    };
    hideFxsUpdateNotification: boolean;
    allowSelfIdentifierEdit: boolean;
    requireAdminTwoFactor: boolean;
    resourceDownloadEnabled: boolean;
    discordOAuthEnabled: boolean;
    reportsEnabled: boolean;
    /** Hide Reports + Report Analytics sidebar items (NUI always; web when reports are disabled). */
    hideReportsNav: boolean;
    /** sxPanel optional-page toggles from `txConfig.panelFeatures`; a missing key means enabled. */
    panelFeatures: Record<PanelFeatureKey, boolean>;

    //Addon permissions (dynamic, registered by running addons)
    addonPermissions: PermissionDefinition[];

    //Addon theme compatibility
    addonThemeLogo: string | undefined;

    //Auth
    preAuth: ReactAuthDataType | false;
};

//Maybe extract to some shared folder
export type PlayerIdsObjectType = {
    discord: string | null;
    fivem: string | null;
    license: string | null;
    license2: string | null;
    live: string | null;
    steam: string | null;
    xbl: string | null;
};
