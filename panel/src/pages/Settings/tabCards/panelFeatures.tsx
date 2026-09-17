import { useCallback, useEffect, useMemo, useReducer } from 'react';
import SwitchText from '@/components/SwitchText';
import { useLocale } from '@/hooks/locale';
import { useOpenConfirmDialog } from '@/hooks/dialogs';
import SettingsCardShell from '../SettingsCardShell';
import { SettingItem, SettingItemDesc } from '../settingsItems';
import {
    configsReducer,
    getConfigAccessors,
    getConfigDiff,
    getConfigEmptyState,
    getPageConfig,
    reconcileCardPendingSave,
    type SettingsCardProps,
} from '../utils';

/**
 * "Panel Features" — toggles which optional sxPanel pages are reachable. Each flag is a
 * boolean in the `panelFeatures` config scope (plus `gameFeatures.reportsEnabled` for the
 * Reports page, surfaced here for a single control surface). Disabling a page hides it from
 * every nav surface and redirects its route to "/" — enforced client-side in sidebarConfig,
 * LeftSidebar, TopNav and MainRouter, all reading `window.txConsts` which is only populated
 * at page load, hence the reload prompt after a save.
 */
//Every field here is a plain boolean defaulting to enabled.
export const pageConfigs = {
    reportsEnabled: getPageConfig('gameFeatures', 'reportsEnabled', undefined, true),
    whitelistPage: getPageConfig('panelFeatures', 'whitelistPage', undefined, true),
    historyPage: getPageConfig('panelFeatures', 'historyPage', undefined, true),
    reportAnalyticsPage: getPageConfig('panelFeatures', 'reportAnalyticsPage', undefined, true),
    insightsPage: getPageConfig('panelFeatures', 'insightsPage', undefined, true),
    playerDropsPage: getPageConfig('panelFeatures', 'playerDropsPage', undefined, true),
    resourcesPage: getPageConfig('panelFeatures', 'resourcesPage', undefined, true),
    cfgEditorPage: getPageConfig('panelFeatures', 'cfgEditorPage', undefined, true),
    serverLogPage: getPageConfig('panelFeatures', 'serverLogPage', undefined, true),
    actionLogPage: getPageConfig('panelFeatures', 'actionLogPage', undefined, true),
    consoleLogPage: getPageConfig('panelFeatures', 'consoleLogPage', undefined, true),
    addonsPage: getPageConfig('panelFeatures', 'addonsPage', undefined, true),
} as const;

type ToggleName = keyof typeof pageConfigs;

const GROUPS: { titleKey: string; items: { name: ToggleName; labelKey: string; descKey?: string }[] }[] = [
    {
        titleKey: 'panel.settings.panel_features.group_players',
        items: [
            { name: 'whitelistPage', labelKey: 'panel.sidebar.item.whitelist' },
            { name: 'historyPage', labelKey: 'panel.sidebar.item.history' },
            {
                name: 'reportsEnabled',
                labelKey: 'panel.sidebar.item.reports',
                //Reports maps to gameFeatures.reportsEnabled, which also gates the in-game
                ///report command, the report APIs and the Discord commands — not just nav.
                descKey: 'panel.settings.panel_features.item_desc_reports',
            },
        ],
    },
    {
        titleKey: 'panel.settings.panel_features.group_analytics',
        items: [
            { name: 'insightsPage', labelKey: 'panel.sidebar.item.insights' },
            { name: 'playerDropsPage', labelKey: 'panel.sidebar.item.player_drops' },
            { name: 'reportAnalyticsPage', labelKey: 'panel.sidebar.item.report_analytics' },
        ],
    },
    {
        titleKey: 'panel.settings.panel_features.group_server',
        items: [
            { name: 'resourcesPage', labelKey: 'panel.sidebar.item.resources' },
            { name: 'cfgEditorPage', labelKey: 'panel.sidebar.item.cfg_editor' },
            { name: 'serverLogPage', labelKey: 'panel.sidebar.item.server_log' },
        ],
    },
    {
        titleKey: 'panel.settings.panel_features.group_system',
        items: [
            { name: 'actionLogPage', labelKey: 'panel.sidebar.item.action_log' },
            { name: 'consoleLogPage', labelKey: 'panel.sidebar.item.console_log' },
            { name: 'addonsPage', labelKey: 'panel.sidebar.item.addon_manager' },
        ],
    },
];

export default function ConfigCardPanelFeatures({ cardCtx, pageCtx }: SettingsCardProps) {
    const { t } = useLocale();
    const openConfirmDialog = useOpenConfirmDialog();
    const [states, dispatch] = useReducer(configsReducer<typeof pageConfigs>, null, () =>
        getConfigEmptyState(pageConfigs),
    );
    const cfg = useMemo(() => {
        return getConfigAccessors(cardCtx.cardId, pageConfigs, pageCtx.apiData, dispatch);
    }, [cardCtx.cardId, pageCtx.apiData, dispatch]);

    const updatePageState = useCallback(() => {
        const res = getConfigDiff(cfg, states, {}, false);
        pageCtx.setCardPendingSave(reconcileCardPendingSave(cardCtx, res.hasChanges));
        return res;
    }, [cfg, states, pageCtx, cardCtx]);

    useEffect(() => {
        updatePageState();
    }, [updatePageState]);

    const handleOnSave = () => {
        const { hasChanges, localConfigs } = updatePageState();
        if (!hasChanges) return;

        pageCtx.saveChanges(cardCtx, localConfigs);

        //The nav/router read window.txConsts, which is only populated at page load, so
        //visibility changes need a reload to show. saveChanges surfaces its own error
        //toast; a failed save just leaves this prompt for the user to dismiss.
        openConfirmDialog({
            title: t('panel.settings.panel_features.reload_prompt_title'),
            message: t('panel.settings.panel_features.reload_prompt_msg'),
            actionLabel: t('panel.settings.panel_features.reload_now'),
            cancelLabel: t('panel.settings.panel_features.reload_later'),
            onConfirm: () => window.location.reload(),
        });
    };

    return (
        <SettingsCardShell cardCtx={cardCtx} pageCtx={pageCtx} onClickSave={handleOnSave}>
            <p className="text-muted-foreground max-w-4xl text-sm leading-relaxed">
                {t('panel.settings.panel_features.blurb')}
            </p>

            {GROUPS.map((group) => (
                <div key={group.titleKey} className="space-y-4">
                    <p className="text-muted-foreground/60 text-[11px] font-semibold tracking-widest uppercase">
                        {t(group.titleKey)}
                    </p>
                    {group.items.map(({ name, labelKey, descKey }) => {
                        const label = t(labelKey);
                        return (
                            <SettingItem key={name} label={label}>
                                <SwitchText
                                    id={cfg[name].eid}
                                    checkedLabel={t('panel.settings.switch.visible')}
                                    uncheckedLabel={t('panel.settings.switch.hidden')}
                                    variant="checkedGreen"
                                    checked={states[name] as boolean}
                                    onCheckedChange={cfg[name].state.set}
                                    disabled={pageCtx.isReadOnly}
                                />
                                <SettingItemDesc>
                                    {descKey
                                        ? t(descKey)
                                        : t('panel.settings.panel_features.item_desc', { page: label })}
                                </SettingItemDesc>
                            </SettingItem>
                        );
                    })}
                </div>
            ))}
        </SettingsCardShell>
    );
}
