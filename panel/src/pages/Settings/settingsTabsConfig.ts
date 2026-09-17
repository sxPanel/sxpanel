import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { SettingsCardInfo, SettingsCardProps, SettingsTabInfo } from './utils';

type SettingsCardComponent = ComponentType<SettingsCardProps>;
type LazySettingsCard = LazyExoticComponent<SettingsCardComponent>;

const lazySettingsCard = (loader: () => Promise<{ default: SettingsCardComponent }>) => lazy(loader);

type SettingsTabDef =
    | { nameKey: string; Component: LazySettingsCard }
    | { nameKey: string; cards: { nameKey: string; Component: LazySettingsCard }[] };

function isSettingsTabMulti(
    tab: SettingsTabDef,
): tab is { nameKey: string; cards: { nameKey: string; Component: LazySettingsCard }[] } {
    return 'cards' in tab;
}

export const settingsTabsBase: SettingsTabDef[] = [
    {
        nameKey: 'panel.settings.tabs.appearance',
        Component: lazySettingsCard(() => import('./tabCards/appearance')),
    },
    {
        nameKey: 'panel.settings.tabs.panel_features',
        Component: lazySettingsCard(() => import('./tabCards/panelFeatures')),
    },
    { nameKey: 'panel.settings.tabs.general', Component: lazySettingsCard(() => import('./tabCards/general')) },
    { nameKey: 'panel.settings.tabs.fxserver', Component: lazySettingsCard(() => import('./tabCards/fxserver')) },
    { nameKey: 'panel.settings.tabs.bans', Component: lazySettingsCard(() => import('./tabCards/bans')) },
    {
        nameKey: 'panel.settings.tabs.deferral_cards',
        Component: lazySettingsCard(() => import('./tabCards/deferralCards')),
    },
    { nameKey: 'panel.settings.tabs.whitelist', Component: lazySettingsCard(() => import('./tabCards/whitelist')) },
    { nameKey: 'panel.settings.tabs.queue', Component: lazySettingsCard(() => import('./tabCards/queue')) },
    { nameKey: 'panel.settings.tabs.discord', Component: lazySettingsCard(() => import('./tabCards/discord')) },
    { nameKey: 'panel.settings.tabs.game', Component: lazySettingsCard(() => import('./tabCards/game')) },
    {
        nameKey: 'panel.settings.tabs.player_tags',
        Component: lazySettingsCard(() => import('./tabCards/gamePlayerTags')),
    },
];

type SettingGroup = {
    ctx: SettingsTabInfo & SettingsCardInfo;
    Component: LazySettingsCard;
};
type SettingTabMulti = {
    ctx: SettingsTabInfo;
    cards: SettingGroup[];
};
type SettingTabSingle = SettingGroup;
export type SettingTabsDatum = SettingTabMulti | SettingTabSingle;

const nameToId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '-');

export function buildSettingsTabs(t: (key: string) => string): SettingTabsDatum[] {
    return settingsTabsBase.map((tab) => {
        const tabName = t(tab.nameKey);
        const tabCtx = {
            tabId: nameToId(tabName),
            tabName,
        } satisfies SettingsTabInfo;
        if (isSettingsTabMulti(tab)) {
            return {
                ctx: tabCtx,
                cards: tab.cards.map((card) => {
                    const cardName = t(card.nameKey);
                    return {
                        ctx: {
                            ...tabCtx,
                            cardId: `${tabCtx.tabId}-${nameToId(cardName)}`,
                            cardName,
                            cardTitle: `${tabCtx.tabName} ${cardName}`,
                        },
                        Component: card.Component,
                    } satisfies SettingGroup;
                }),
            } satisfies SettingTabMulti;
        }
        return {
            ctx: {
                ...tabCtx,
                cardId: tabCtx.tabId,
                cardName: tabCtx.tabName,
                cardTitle: tabCtx.tabName,
            },
            Component: tab.Component,
        } satisfies SettingTabSingle;
    });
}
