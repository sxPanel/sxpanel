import SwitchText from '@/components/SwitchText';
import { Input } from '@/components/ui/input';
import { useAdminPerms } from '@/hooks/auth';
import { useLocale } from '@/hooks/locale';
import { SettingItem, SettingItemDesc } from '../settingsItems';
import type { SettingsCardProps } from '../utils';
import { getConfigAccessors, getPageConfig } from '../utils';

export const gameCombatLogPageConfigs = {
    combatLogEnabled: getPageConfig('gameFeatures', 'combatLogEnabled', undefined, false),
    combatLogDamageSummaries: getPageConfig('gameFeatures', 'combatLogDamageSummaries', undefined, true),
    combatLogEngagementWindow: getPageConfig('gameFeatures', 'combatLogEngagementWindow', undefined, 10),
} as const;

type GameCombatLogSettingsFieldsProps = {
    cfg: ReturnType<typeof getConfigAccessors<typeof gameCombatLogPageConfigs>>;
    states: Record<string, unknown>;
    pageCtx: SettingsCardProps['pageCtx'];
    engagementWindowRef: React.RefObject<HTMLInputElement | null>;
    updatePageState: () => void;
};

export function GameCombatLogSettingsFields({
    cfg,
    states,
    pageCtx,
    engagementWindowRef,
    updatePageState,
}: GameCombatLogSettingsFieldsProps) {
    const { t } = useLocale();
    const { isMaster } = useAdminPerms();
    //NOTE: the backend also enforces this, the combat log records player activity so only the owner can toggle it
    const isDisabled = pageCtx.isReadOnly || !isMaster;
    const isEnabled = states.combatLogEnabled as boolean;

    return (
        <>
            <SettingItem label={t('panel.settings.game_combat_log.enabled_label')}>
                <SwitchText
                    id={cfg.combatLogEnabled.eid}
                    checkedLabel={t('panel.settings.switch.enabled')}
                    uncheckedLabel={t('panel.settings.switch.disabled')}
                    variant="checkedGreen"
                    checked={isEnabled}
                    onCheckedChange={cfg.combatLogEnabled.state.set}
                    disabled={isDisabled}
                />
                <SettingItemDesc>
                    {t('panel.settings.game_combat_log.enabled_desc')} <br />
                    {t('panel.settings.game_combat_log.enabled_desc_discord')} <br />
                    <strong className="text-warning-inline">{t('panel.settings.fxserver.warning_label')}</strong>{' '}
                    {t('panel.settings.game_combat_log.onesync_warning')}
                    {!isMaster && (
                        <>
                            <br />
                            <strong>{t('panel.settings.game_combat_log.master_only')}</strong>
                        </>
                    )}
                </SettingItemDesc>
            </SettingItem>

            <SettingItem label={t('panel.settings.game_combat_log.damage_summaries_label')}>
                <SwitchText
                    id={cfg.combatLogDamageSummaries.eid}
                    checkedLabel={t('panel.settings.switch.enabled')}
                    uncheckedLabel={t('panel.settings.switch.disabled')}
                    variant="checkedGreen"
                    checked={states.combatLogDamageSummaries as boolean}
                    onCheckedChange={cfg.combatLogDamageSummaries.state.set}
                    disabled={isDisabled || !isEnabled}
                />
                <SettingItemDesc>{t('panel.settings.game_combat_log.damage_summaries_desc')}</SettingItemDesc>
            </SettingItem>

            <SettingItem
                label={t('panel.settings.game_combat_log.engagement_window_label')}
                htmlFor={cfg.combatLogEngagementWindow.eid}
            >
                <Input
                    id={cfg.combatLogEngagementWindow.eid}
                    ref={engagementWindowRef}
                    type="number"
                    min={3}
                    max={60}
                    defaultValue={cfg.combatLogEngagementWindow.initialValue}
                    onInput={updatePageState}
                    disabled={isDisabled || !isEnabled}
                    className="w-24"
                    placeholder="10"
                />
                <SettingItemDesc>{t('panel.settings.game_combat_log.engagement_window_desc')}</SettingItemDesc>
            </SettingItem>
        </>
    );
}
