import type { LucideIcon } from 'lucide-react';
import type { PanelFeatureKey } from '@shared/otherTypes';
import {
    LayoutDashboardIcon,
    UsersIcon,
    TerminalIcon,
    BoxIcon,
    ActivityIcon,
    TrendingDownIcon,
    BarChart3Icon,
    ClockIcon,
    FlagIcon,
    ShieldIcon,
    ClipboardListIcon,
    FileTextIcon,
    SlidersHorizontalIcon,
    Settings2Icon,
    ShieldCheckIcon,
    FileCodeIcon,
    PackageIcon,
    ScrollTextIcon,
    BlocksIcon,
    SparklesIcon,
} from 'lucide-react';

export type SidebarNavItemConfig = {
    href: string;
    icon: LucideIcon;
    labelKey: string;
    permission?: string;
    /** Optional sxPanel page toggle (Settings → sxPanel → Panel Features). Hidden when disabled. */
    featureFlag?: PanelFeatureKey;
};

export type SidebarSectionConfig = {
    sectionKey: string;
    items: SidebarNavItemConfig[];
};

export const SIDEBAR_SECTIONS: SidebarSectionConfig[] = [
    {
        sectionKey: 'panel.sidebar.section.overview',
        items: [{ href: '/', icon: LayoutDashboardIcon, labelKey: 'panel.sidebar.item.dashboard' }],
    },
    {
        sectionKey: 'panel.sidebar.section.players',
        items: [
            { href: '/players', icon: UsersIcon, labelKey: 'panel.sidebar.item.players' },
            {
                href: '/whitelist',
                icon: ShieldCheckIcon,
                labelKey: 'panel.sidebar.item.whitelist',
                featureFlag: 'whitelistPage',
            },
            {
                href: '/history',
                icon: ClockIcon,
                labelKey: 'panel.sidebar.item.history',
                featureFlag: 'historyPage',
            },
            {
                href: '/reports',
                icon: FlagIcon,
                labelKey: 'panel.sidebar.item.reports',
                permission: 'players.reports',
            },
        ],
    },
    {
        sectionKey: 'panel.sidebar.section.server',
        items: [
            {
                href: '/server/console',
                icon: TerminalIcon,
                labelKey: 'panel.sidebar.item.live_console',
                permission: 'console.view',
            },
            {
                href: '/server/resources',
                icon: BoxIcon,
                labelKey: 'panel.sidebar.item.resources',
                featureFlag: 'resourcesPage',
            },
            {
                href: '/server/cfg-editor',
                icon: FileCodeIcon,
                labelKey: 'panel.sidebar.item.cfg_editor',
                permission: 'server.cfg.editor',
                featureFlag: 'cfgEditorPage',
            },
            {
                href: '/server/server-log',
                icon: FileTextIcon,
                labelKey: 'panel.sidebar.item.server_log',
                permission: 'server.log.view',
                featureFlag: 'serverLogPage',
            },
            {
                href: '/admins',
                icon: ShieldIcon,
                labelKey: 'panel.sidebar.item.admins',
                permission: 'manage.admins',
            },
        ],
    },
    {
        sectionKey: 'panel.sidebar.section.analytics',
        items: [
            {
                href: '/insights',
                icon: ActivityIcon,
                labelKey: 'panel.sidebar.item.insights',
                featureFlag: 'insightsPage',
            },
            {
                href: '/server/player-drops',
                icon: TrendingDownIcon,
                labelKey: 'panel.sidebar.item.player_drops',
                featureFlag: 'playerDropsPage',
            },
            {
                href: '/reports/analytics',
                icon: BarChart3Icon,
                labelKey: 'panel.sidebar.item.report_analytics',
                permission: 'players.reports',
                featureFlag: 'reportAnalyticsPage',
            },
        ],
    },
    {
        sectionKey: 'panel.sidebar.section.addons',
        items: [
            {
                href: '/addons',
                icon: BlocksIcon,
                labelKey: 'panel.sidebar.item.addon_manager',
                permission: 'all_permissions',
                featureFlag: 'addonsPage',
            },
        ],
    },
    {
        sectionKey: 'panel.sidebar.section.system',
        items: [
            {
                href: '/system/action-log',
                icon: ClipboardListIcon,
                labelKey: 'panel.sidebar.item.action_log',
                permission: 'txadmin.log.view',
                featureFlag: 'actionLogPage',
            },
            {
                href: '/system/console-log',
                icon: ScrollTextIcon,
                labelKey: 'panel.sidebar.item.console_log',
                permission: 'txadmin.log.view',
                featureFlag: 'consoleLogPage',
            },
            { href: '/system/diagnostics', icon: SlidersHorizontalIcon, labelKey: 'panel.sidebar.item.diagnostics' },
            {
                href: '/system/artifacts',
                icon: PackageIcon,
                labelKey: 'panel.sidebar.item.artifacts',
                permission: 'all_permissions',
            },
            {
                href: '/system/panel-update',
                icon: SparklesIcon,
                labelKey: 'panel.sidebar.item.panel_update',
                permission: 'all_permissions',
            },
            {
                href: '/settings',
                icon: Settings2Icon,
                labelKey: 'panel.sidebar.item.settings',
                permission: 'settings.view',
            },
        ],
    },
];
