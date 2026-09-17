import type { LucideIcon } from 'lucide-react';
import {
    Gamepad2Icon,
    GavelIcon,
    MessageSquareIcon,
    PaletteIcon,
    ServerIcon,
    Settings2Icon,
    ShieldAlertIcon,
    SlidersHorizontalIcon,
    TagsIcon,
    UsersIcon,
} from 'lucide-react';

export type SettingsNavGroupId = 'personal' | 'panel' | 'server' | 'moderation' | 'integrations' | 'gameplay';

export const SETTINGS_NAV_GROUP_LABELS: Record<SettingsNavGroupId, string> = {
    personal: 'Personal',
    panel: 'sxPanel',
    server: 'Server',
    moderation: 'Moderation',
    integrations: 'Integrations',
    gameplay: 'Gameplay',
};

export const SETTINGS_NAV_GROUP_ORDER: SettingsNavGroupId[] = [
    'personal',
    'panel',
    'server',
    'moderation',
    'integrations',
    'gameplay',
];

export const SETTINGS_TAB_NAV_META: Record<string, { group: SettingsNavGroupId; icon: LucideIcon }> = {
    'panel.settings.tabs.appearance': { group: 'personal', icon: PaletteIcon },
    'panel.settings.tabs.panel_features': { group: 'panel', icon: SlidersHorizontalIcon },
    'panel.settings.tabs.general': { group: 'server', icon: Settings2Icon },
    'panel.settings.tabs.fxserver': { group: 'server', icon: ServerIcon },
    'panel.settings.tabs.queue': { group: 'server', icon: UsersIcon },
    'panel.settings.tabs.bans': { group: 'moderation', icon: GavelIcon },
    'panel.settings.tabs.deferral_cards': { group: 'moderation', icon: ShieldAlertIcon },
    'panel.settings.tabs.whitelist': { group: 'moderation', icon: UsersIcon },
    'panel.settings.tabs.discord': { group: 'integrations', icon: MessageSquareIcon },
    'panel.settings.tabs.game': { group: 'gameplay', icon: Gamepad2Icon },
    'panel.settings.tabs.player_tags': { group: 'gameplay', icon: TagsIcon },
};

export const settingsTabsBaseNameKeys = [
    'panel.settings.tabs.appearance',
    'panel.settings.tabs.panel_features',
    'panel.settings.tabs.general',
    'panel.settings.tabs.fxserver',
    'panel.settings.tabs.bans',
    'panel.settings.tabs.deferral_cards',
    'panel.settings.tabs.whitelist',
    'panel.settings.tabs.queue',
    'panel.settings.tabs.discord',
    'panel.settings.tabs.game',
    'panel.settings.tabs.player_tags',
] as const;
