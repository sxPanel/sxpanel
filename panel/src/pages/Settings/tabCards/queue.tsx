import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { DiscordRoleMultiSelect } from '@/components/DiscordRoleMultiSelect';
import { Checkbox } from '@/components/ui/checkbox';
import SwitchText from '@/components/SwitchText';
import { PlusIcon, TrashIcon } from 'lucide-react';
import { SettingItem, SettingItemDesc } from '../settingsItems';
import { useEffect, useMemo, useReducer, useRef } from 'react';
import {
    getConfigEmptyState,
    getConfigAccessors,
    SettingsCardProps,
    getPageConfig,
    configsReducer,
    getConfigDiff,
    reconcileCardPendingSave,
} from '../utils';
import SettingsCardShell from '../SettingsCardShell';
import { txToast } from '@/components/TxToaster';
import { useLocale } from '@/hooks/locale';
import consts from '@shared/consts';
import type { QueueRule, QueueSlotPool } from '@shared/queueTypes';
import { sumPoolSlots } from '@shared/queueTypes';

const generateUuid = () => {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.randomUUID) {
        return cryptoApi.randomUUID();
    }
    return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
};

const resolveQueueRules = (value: unknown) => {
    if (!Array.isArray(value)) return [] as QueueRule[];
    const seenIds = new Set<string>();
    const rules = [] as QueueRule[];
    for (const entry of value) {
        if (!entry || typeof entry !== 'object') continue;
        const raw = entry as Partial<QueueRule>;
        const id = typeof raw.id === 'string' && raw.id.length ? raw.id : generateUuid();
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        rules.push({
            id,
            label: typeof raw.label === 'string' ? raw.label : '',
            discordRoleIds: Array.isArray(raw.discordRoleIds)
                ? raw.discordRoleIds.filter((v): v is string => typeof v === 'string')
                : [],
            priority: typeof raw.priority === 'number' ? raw.priority : 0,
        });
    }
    return rules;
};

const resolveQueuePools = (value: unknown) => {
    if (!Array.isArray(value)) return [] as QueueSlotPool[];
    const seenIds = new Set<string>();
    const pools = [] as QueueSlotPool[];
    for (const entry of value) {
        if (!entry || typeof entry !== 'object') continue;
        const raw = entry as Partial<QueueSlotPool>;
        const id = typeof raw.id === 'string' && raw.id.length ? raw.id : generateUuid();
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        pools.push({
            id,
            label: typeof raw.label === 'string' ? raw.label : '',
            slots: typeof raw.slots === 'number' ? raw.slots : 0,
            staffCanAccess: raw.staffCanAccess === true,
            ruleIds: Array.isArray(raw.ruleIds) ? raw.ruleIds.filter((v): v is string => typeof v === 'string') : [],
        });
    }
    return pools;
};

export const pageConfigs = {
    enabled: getPageConfig('queue', 'enabled', undefined, false),
    rules: getPageConfig('queue', 'rules', undefined, [] as QueueRule[]),
    pools: getPageConfig('queue', 'pools', undefined, [] as QueueSlotPool[]),
    maxConcurrentDeferrals: getPageConfig('queue', 'maxConcurrentDeferrals', undefined, 100),
} as const;

export default function ConfigCardQueue({ cardCtx, pageCtx }: SettingsCardProps) {
    const { t } = useLocale();
    const [states, dispatch] = useReducer(configsReducer<typeof pageConfigs>, null, () =>
        getConfigEmptyState(pageConfigs),
    );

    const cfg = useMemo(() => {
        return getConfigAccessors(cardCtx.cardId, pageConfigs, pageCtx.apiData, dispatch);
    }, [pageCtx.apiData, dispatch]);

    const rules = useMemo(
        () => resolveQueueRules(states.rules ?? cfg.rules.initialValue),
        [states.rules, cfg.rules.initialValue],
    );
    const pools = useMemo(
        () => resolveQueuePools(states.pools ?? cfg.pools.initialValue),
        [states.pools, cfg.pools.initialValue],
    );

    const maxConcurrentDeferralsRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        updatePageState();
    }, [states]);

    const updateRules = (updater: (prev: QueueRule[]) => QueueRule[]) => {
        cfg.rules.state.set((prev: unknown) => updater(resolveQueueRules(prev ?? cfg.rules.initialValue)));
    };

    const updatePools = (updater: (prev: QueueSlotPool[]) => QueueSlotPool[]) => {
        cfg.pools.state.set((prev: unknown) => updater(resolveQueuePools(prev ?? cfg.pools.initialValue)));
    };

    const updateRule = <K extends keyof QueueRule>(id: string, key: K, value: QueueRule[K]) => {
        updateRules((prev) => prev.map((rule) => (rule.id === id ? { ...rule, [key]: value } : rule)));
    };

    const updatePool = <K extends keyof QueueSlotPool>(id: string, key: K, value: QueueSlotPool[K]) => {
        updatePools((prev) => prev.map((pool) => (pool.id === id ? { ...pool, [key]: value } : pool)));
    };

    const togglePoolRule = (poolId: string, ruleId: string, checked: boolean) => {
        updatePools((prev) =>
            prev.map((pool) => {
                if (pool.id !== poolId) return pool;
                const set = new Set(pool.ruleIds);
                if (checked) set.add(ruleId);
                else set.delete(ruleId);
                return { ...pool, ruleIds: [...set] };
            }),
        );
    };

    const addRule = () => {
        updateRules((prev) => [...prev, { id: generateUuid(), label: '', discordRoleIds: [], priority: 0 }]);
    };

    const addPool = () => {
        updatePools((prev) => [
            ...prev,
            {
                id: generateUuid(),
                label: '',
                slots: 0,
                staffCanAccess: false,
                ruleIds: [],
            },
        ]);
    };

    const removeRule = (id: string) => {
        updateRules((prev) => prev.filter((rule) => rule.id !== id));
        updatePools((prev) =>
            prev.map((pool) => ({
                ...pool,
                ruleIds: pool.ruleIds.filter((rid) => rid !== id),
            })),
        );
    };

    const removePool = (id: string) => {
        updatePools((prev) => prev.filter((pool) => pool.id !== id));
    };

    const updatePageState = () => {
        const parsedMax = Number.parseInt(maxConcurrentDeferralsRef.current?.value ?? '', 10);
        const maxConcurrentDeferrals = Number.isFinite(parsedMax) ? parsedMax : cfg.maxConcurrentDeferrals.initialValue;
        const res = getConfigDiff(cfg, states, { maxConcurrentDeferrals }, false);
        pageCtx.setCardPendingSave(reconcileCardPendingSave(cardCtx, res.hasChanges));
        return res;
    };

    const handleOnSave = () => {
        const { hasChanges, localConfigs } = updatePageState();
        if (!hasChanges) return;

        const next = localConfigs.queue;
        if (!next) {
            return txToast.error(t('panel.settings.queue.toast_unexpected_payload'));
        }

        const normalizedRules = rules.map((rule) => ({
            ...rule,
            label: rule.label.trim(),
            priority: Math.floor(Number(rule.priority) || 0),
        }));

        const normalizedPools = pools.map((pool) => ({
            ...pool,
            label: pool.label.trim(),
            slots: Math.max(0, Math.floor(Number(pool.slots) || 0)),
            staffCanAccess: pool.staffCanAccess === true,
            ruleIds: pool.ruleIds.filter((rid) => normalizedRules.some((r) => r.id === rid)),
        }));

        const emptyRuleLabel = normalizedRules.find((r) => !r.label.length);
        if (emptyRuleLabel) {
            return txToast.error(t('panel.settings.queue.toast_rule_label_required'));
        }

        const emptyPoolLabel = normalizedPools.find((p) => !p.label.length);
        if (emptyPoolLabel) {
            return txToast.error(t('panel.settings.queue.toast_pool_label_required'));
        }

        for (const rule of normalizedRules) {
            for (const roleId of rule.discordRoleIds) {
                if (!consts.regexDiscordSnowflake.test(roleId)) {
                    return txToast.error({
                        title: t('panel.settings.queue.toast_invalid_role_title'),
                        msg: t('panel.settings.queue.toast_invalid_role_msg', { roleId }),
                    });
                }
            }
        }

        const usesDiscordRoles = normalizedRules.some((r) => r.discordRoleIds.length > 0);
        if (next.enabled && usesDiscordRoles && pageCtx.apiData?.storedConfigs.discordBot?.enabled !== true) {
            return txToast.warning({
                title: t('panel.settings.queue.toast_discord_bot_required_title'),
                msg: t('panel.settings.queue.toast_discord_bot_required_msg'),
            });
        }

        for (const pool of normalizedPools) {
            if (pool.slots <= 0) continue;
            const hasAccess = pool.staffCanAccess || pool.ruleIds.length > 0;
            if (!hasAccess) {
                return txToast.error(t('panel.settings.queue.toast_pool_needs_access', { label: pool.label }));
            }
            for (const ruleId of pool.ruleIds) {
                const rule = normalizedRules.find((r) => r.id === ruleId);
                if (!rule?.discordRoleIds.length) {
                    return txToast.error(
                        t('panel.settings.queue.toast_pool_rule_no_roles', {
                            poolLabel: pool.label,
                            ruleLabel: rule?.label ?? ruleId,
                        }),
                    );
                }
            }
        }

        localConfigs.queue.rules = normalizedRules;
        localConfigs.queue.pools = normalizedPools;
        pageCtx.saveChanges(cardCtx, localConfigs);
    };

    const reservedTotal = sumPoolSlots(pools);
    const activePoolCount = pools.filter((p) => p.slots > 0).length;
    const slotSummaryText =
        reservedTotal === 1 && activePoolCount === 1
            ? t('panel.settings.queue.slot_summary_one')
            : t('panel.settings.queue.slot_summary_many', { count: reservedTotal, poolCount: activePoolCount });

    return (
        <SettingsCardShell cardCtx={cardCtx} pageCtx={pageCtx} onClickSave={handleOnSave}>
            <SettingItem label={t('panel.settings.queue.enabled_label')}>
                <SwitchText
                    id={cfg.enabled.eid}
                    checkedLabel={t('panel.settings.switch.enabled')}
                    uncheckedLabel={t('panel.settings.switch.disabled')}
                    variant="checkedGreen"
                    checked={states.enabled === true}
                    onCheckedChange={cfg.enabled.state.set}
                    disabled={pageCtx.isReadOnly}
                />
                <SettingItemDesc>{t('panel.settings.queue.enabled_desc')}</SettingItemDesc>
            </SettingItem>

            <SettingItem label={t('panel.settings.queue.max_users_label')} htmlFor={cfg.maxConcurrentDeferrals.eid}>
                <Input
                    id={cfg.maxConcurrentDeferrals.eid}
                    ref={maxConcurrentDeferralsRef}
                    defaultValue={String(cfg.maxConcurrentDeferrals.initialValue ?? 100)}
                    type="number"
                    min={1}
                    max={500}
                    step={1}
                    onInput={updatePageState}
                    disabled={pageCtx.isReadOnly}
                />
                <SettingItemDesc>{t('panel.settings.queue.max_users_desc')}</SettingItemDesc>
            </SettingItem>

            {reservedTotal > 0 ? (
                <SettingItem label={t('panel.settings.queue.slot_summary_label')} showOptional>
                    <p className="text-muted-foreground text-sm">{slotSummaryText}</p>
                </SettingItem>
            ) : null}

            <SettingItem label={t('panel.settings.queue.slot_pools_label')}>
                <div className="space-y-4">
                    {pools.length ? (
                        pools.map((pool) => (
                            <div key={pool.id} className="space-y-3 rounded-md border p-4">
                                <div className="flex flex-wrap items-end gap-3">
                                    <div className="min-w-40 flex-1 space-y-1">
                                        <label
                                            className="text-muted-foreground text-xs"
                                            htmlFor={`${cfg.pools.eid}:${pool.id}:label`}
                                        >
                                            {t('panel.settings.queue.pool_name_label')}
                                        </label>
                                        <Input
                                            id={`${cfg.pools.eid}:${pool.id}:label`}
                                            value={pool.label}
                                            onChange={(e) => updatePool(pool.id, 'label', e.currentTarget.value)}
                                            disabled={pageCtx.isReadOnly}
                                            placeholder={t('panel.settings.queue.pool_name_placeholder')}
                                            maxLength={64}
                                        />
                                    </div>
                                    <div className="w-28 space-y-1">
                                        <label
                                            className="text-muted-foreground text-xs"
                                            htmlFor={`${cfg.pools.eid}:${pool.id}:slots`}
                                        >
                                            {t('panel.settings.queue.slots_label')}
                                        </label>
                                        <Input
                                            id={`${cfg.pools.eid}:${pool.id}:slots`}
                                            type="number"
                                            min={0}
                                            step={1}
                                            value={pool.slots}
                                            onChange={(e) =>
                                                updatePool(
                                                    pool.id,
                                                    'slots',
                                                    Number.parseInt(e.currentTarget.value, 10) || 0,
                                                )
                                            }
                                            disabled={pageCtx.isReadOnly}
                                        />
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="text-destructive-inline size-9 shrink-0"
                                        onClick={() => removePool(pool.id)}
                                        disabled={pageCtx.isReadOnly}
                                        aria-label={t('panel.settings.queue.remove_pool_aria')}
                                    >
                                        <TrashIcon className="size-4" />
                                    </Button>
                                </div>

                                <SwitchText
                                    id={`${cfg.pools.eid}:${pool.id}:staff`}
                                    checkedLabel={t('panel.settings.queue.staff_pool_on')}
                                    uncheckedLabel={t('panel.settings.queue.staff_pool_off')}
                                    variant="checkedGreen"
                                    checked={pool.staffCanAccess}
                                    onCheckedChange={(checked) => updatePool(pool.id, 'staffCanAccess', checked)}
                                    disabled={pageCtx.isReadOnly}
                                />

                                {rules.length ? (
                                    <div className="space-y-2">
                                        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                                            {t('panel.settings.queue.pool_rules_heading')}
                                        </p>
                                        <div className="space-y-2 rounded-md border border-dashed p-3">
                                            {rules.map((rule) => (
                                                <label
                                                    key={rule.id}
                                                    className="flex cursor-pointer items-start gap-2 text-sm"
                                                    htmlFor={`${cfg.pools.eid}:${pool.id}:rule:${rule.id}`}
                                                >
                                                    <Checkbox
                                                        id={`${cfg.pools.eid}:${pool.id}:rule:${rule.id}`}
                                                        checked={pool.ruleIds.includes(rule.id)}
                                                        onCheckedChange={(checked) =>
                                                            togglePoolRule(pool.id, rule.id, checked === true)
                                                        }
                                                        disabled={pageCtx.isReadOnly || !rule.discordRoleIds.length}
                                                    />
                                                    <span>
                                                        <span className="font-medium">
                                                            {rule.label || t('panel.settings.queue.unnamed_rule')}
                                                        </span>
                                                        {!rule.discordRoleIds.length ? (
                                                            <span className="text-muted-foreground block text-xs">
                                                                {t('panel.settings.queue.add_roles_first')}
                                                            </span>
                                                        ) : (
                                                            <span className="text-muted-foreground block text-xs">
                                                                {t('panel.settings.queue.rule_priority', {
                                                                    priority: rule.priority,
                                                                })}
                                                            </span>
                                                        )}
                                                    </span>
                                                </label>
                                            ))}
                                        </div>
                                        <SettingItemDesc>{t('panel.settings.queue.pool_rules_desc')}</SettingItemDesc>
                                    </div>
                                ) : (
                                    <p className="text-muted-foreground text-xs">
                                        {t('panel.settings.queue.add_rules_hint')}
                                    </p>
                                )}
                            </div>
                        ))
                    ) : (
                        <div className="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
                            {t('panel.settings.queue.empty_pools')}
                        </div>
                    )}

                    <Button variant="outline" size="sm" onClick={addPool} disabled={pageCtx.isReadOnly}>
                        <PlusIcon className="mr-1 size-4" /> {t('panel.settings.queue.add_pool')}
                    </Button>
                </div>
            </SettingItem>

            <SettingItem label={t('panel.settings.queue.rules_label')}>
                <div className="space-y-4">
                    {rules.length ? (
                        rules.map((rule) => (
                            <div key={rule.id} className="space-y-3 rounded-md border p-4">
                                <div className="flex flex-wrap items-end gap-3">
                                    <div className="min-w-56 flex-1 space-y-1">
                                        <label
                                            className="text-muted-foreground text-xs"
                                            htmlFor={`${cfg.rules.eid}:${rule.id}:label`}
                                        >
                                            {t('panel.settings.queue.rule_label')}
                                        </label>
                                        <Input
                                            id={`${cfg.rules.eid}:${rule.id}:label`}
                                            value={rule.label}
                                            onChange={(event) =>
                                                updateRule(rule.id, 'label', event.currentTarget.value)
                                            }
                                            disabled={pageCtx.isReadOnly}
                                            placeholder={t('panel.settings.queue.rule_label_placeholder')}
                                            maxLength={64}
                                        />
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="text-destructive-inline size-9 shrink-0"
                                        onClick={() => removeRule(rule.id)}
                                        disabled={pageCtx.isReadOnly}
                                        aria-label={t('panel.settings.queue.remove_rule_aria')}
                                    >
                                        <TrashIcon className="size-4" />
                                    </Button>
                                </div>

                                <div className="grid gap-4 md:grid-cols-3">
                                    <div className="space-y-1 md:col-span-2">
                                        <label
                                            className="text-muted-foreground text-xs"
                                            htmlFor={`${cfg.rules.eid}:${rule.id}:roles`}
                                        >
                                            {t('panel.settings.queue.discord_roles_label')}
                                        </label>
                                        <DiscordRoleMultiSelect
                                            id={`${cfg.rules.eid}:${rule.id}:roles`}
                                            value={rule.discordRoleIds}
                                            onChange={(roleIds) => updateRule(rule.id, 'discordRoleIds', roleIds)}
                                            disabled={
                                                pageCtx.isReadOnly ||
                                                !pageCtx.apiData?.storedConfigs.discordBot?.enabled
                                            }
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label
                                            className="text-muted-foreground text-xs"
                                            htmlFor={`${cfg.rules.eid}:${rule.id}:priority`}
                                        >
                                            {t('panel.settings.queue.priority_label')}
                                        </label>
                                        <Input
                                            id={`${cfg.rules.eid}:${rule.id}:priority`}
                                            type="number"
                                            step={1}
                                            value={rule.priority}
                                            onChange={(event) =>
                                                updateRule(
                                                    rule.id,
                                                    'priority',
                                                    Number.parseInt(event.currentTarget.value, 10) || 0,
                                                )
                                            }
                                            disabled={pageCtx.isReadOnly}
                                        />
                                        <SettingItemDesc>{t('panel.settings.queue.priority_desc')}</SettingItemDesc>
                                    </div>
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
                            {t('panel.settings.queue.empty_rules')}
                        </div>
                    )}

                    <Button variant="outline" size="sm" onClick={addRule} disabled={pageCtx.isReadOnly}>
                        <PlusIcon className="mr-1 size-4" /> {t('panel.settings.queue.add_rule')}
                    </Button>
                </div>
            </SettingItem>
        </SettingsCardShell>
    );
}
