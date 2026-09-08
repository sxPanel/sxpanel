import { Input } from '@/components/ui/input';
import { DiscordRoleMultiSelect } from '@/components/DiscordRoleMultiSelect';
import TxAnchor from '@/components/TxAnchor';
import { SettingItem, SettingItemDesc } from '../settingsItems';
import { RadioGroup } from '@/components/ui/radio-group';
import BigRadioItem from '@/components/BigRadioItem';
import SwitchText from '@/components/SwitchText';
import { useEffect, useRef, useMemo, useReducer } from 'react';
import {
    getConfigEmptyState,
    getConfigAccessors,
    SettingsCardProps,
    getPageConfig,
    configsReducer,
    reconcileCardPendingSave,
} from '../utils';
import { dequal } from 'dequal/lite';
import { AutosizeTextarea, AutosizeTextAreaRef } from '@/components/ui/autosize-textarea';
import SettingsCardShell from '../SettingsCardShell';
import { txToast } from '@/components/TxToaster';
import consts from '@shared/consts';
import type { WhitelistSchedule, WhitelistWorkflow, WhitelistWorkflowType } from '@shared/whitelistTypes';
import { WHITELIST_DEFAULT_WORKFLOW_ID } from '@shared/whitelistTypes';
import { WhitelistScheduleEditor } from './whitelist-schedule-editor';
import { useLocale } from '@/hooks/locale';

export const pageConfigs = {
    enabled: getPageConfig('whitelist', 'enabled', undefined, false),
    workflows: getPageConfig('whitelist', 'workflows'),
    activeWorkflowId: getPageConfig('whitelist', 'activeWorkflowId'),
    schedule: getPageConfig('whitelist', 'schedule'),
    serverBrowserInstructions: getPageConfig('whitelist', 'serverBrowserInstructions'),
} as const;

const WORKFLOW_OPTION_VALUES: WhitelistWorkflowType[] = [
    'disabled',
    'auto_admin',
    'auto_discord_member',
    'auto_discord_role',
    'manual_review',
    'external_whitelist',
];

function getActiveWorkflow(workflows: WhitelistWorkflow[] | undefined, activeWorkflowId: string | undefined) {
    const list = workflows ?? [];
    return list.find((w) => w.id === activeWorkflowId) ?? list[0];
}

function syncWorkflowType(
    workflows: WhitelistWorkflow[] | undefined,
    activeWorkflowId: string | undefined,
    type: WhitelistWorkflowType,
    discordRoleIds: string[],
    discordReviewChannelId?: string,
): WhitelistWorkflow[] {
    const defaultWorkflows: WhitelistWorkflow[] = [
        { id: WHITELIST_DEFAULT_WORKFLOW_ID, name: 'Default', type: 'manual_review' },
    ];
    const list = structuredClone(workflows?.length ? workflows : defaultWorkflows);
    const idx = list.findIndex((w) => w.id === (activeWorkflowId ?? WHITELIST_DEFAULT_WORKFLOW_ID));
    const target = idx >= 0 ? idx : 0;
    const prev = list[target];
    const next: WhitelistWorkflow = {
        id: prev.id,
        name: prev.name,
        type,
    };
    if (type === 'auto_discord_role') {
        next.discordRoleIds = discordRoleIds;
    }
    const channel = discordReviewChannelId?.trim();
    if (channel) {
        next.discordReviewChannelId = channel;
    }
    list[target] = next;
    return list;
}

type WhitelistSavePatch = {
    enabled: boolean;
    workflows: WhitelistWorkflow[];
    activeWorkflowId: string;
    schedule: WhitelistSchedule;
    serverBrowserInstructions: string;
};

function buildWhitelistSavePatch(input: {
    workflows: WhitelistWorkflow[] | undefined;
    activeWorkflowId: string | undefined;
    schedule: WhitelistSchedule | undefined;
    serverBrowserInstructions: string | undefined;
    workflowType: WhitelistWorkflowType;
    activeWorkflow: WhitelistWorkflow | undefined;
    discordRoleIds: string[];
    discordReviewChannelId: string;
    closedMessage: string;
}): WhitelistSavePatch {
    const schedule: WhitelistSchedule = {
        enabled: input.schedule?.enabled === true,
        timezone: input.schedule?.timezone ?? 'UTC',
        windows: input.schedule?.windows ?? [],
        closedMessage: input.closedMessage,
    };

    return {
        enabled: input.workflowType !== 'disabled',
        workflows: syncWorkflowType(
            input.workflows,
            input.activeWorkflowId,
            input.workflowType,
            input.discordRoleIds,
            input.discordReviewChannelId,
        ),
        activeWorkflowId: input.activeWorkflowId ?? WHITELIST_DEFAULT_WORKFLOW_ID,
        schedule,
        serverBrowserInstructions: input.serverBrowserInstructions ?? '',
    };
}

export default function ConfigCardWhitelist({ cardCtx, pageCtx }: SettingsCardProps) {
    const { t } = useLocale();

    const workflowOptions = useMemo(
        () =>
            WORKFLOW_OPTION_VALUES.map((value) => ({
                value,
                title: t(`panel.settings.whitelist.workflow.${value}.title`),
                desc: t(`panel.settings.whitelist.workflow.${value}.desc`),
            })),
        [t],
    );

    const defaultClosedMessage = t('panel.settings.whitelist.schedule_closed_default');
    const [states, dispatch] = useReducer(configsReducer<typeof pageConfigs>, null, () =>
        getConfigEmptyState(pageConfigs),
    );
    const cfg = useMemo(() => {
        return getConfigAccessors(cardCtx.cardId, pageConfigs, pageCtx.apiData, dispatch);
    }, [pageCtx.apiData, dispatch]);

    const scheduleClosedRef = useRef<HTMLInputElement | null>(null);
    const serverBrowserInstructionsRef = useRef<AutosizeTextAreaRef | null>(null);
    const discordReviewChannelRef = useRef<HTMLInputElement | null>(null);

    const activeWorkflow = getActiveWorkflow(states.workflows, states.activeWorkflowId);
    const workflowType: WhitelistWorkflowType = activeWorkflow?.type ?? 'disabled';
    const isWhitelistActive = workflowType !== 'disabled';
    const isExternalWhitelist = workflowType === 'external_whitelist';

    useEffect(() => {
        updatePageState();
    }, [states]);

    const updatePageState = () => {
        const scheduleState = states.schedule as WhitelistSchedule | undefined;
        const closedFromRef = scheduleClosedRef.current?.value;
        const closedMessage =
            closedFromRef !== undefined && closedFromRef !== ''
                ? closedFromRef
                : (scheduleState?.closedMessage ?? defaultClosedMessage);

        const instructionsFromRef = serverBrowserInstructionsRef.current?.textArea.value;
        const serverBrowserInstructions =
            instructionsFromRef !== undefined && instructionsFromRef !== ''
                ? instructionsFromRef
                : ((states.serverBrowserInstructions as string | undefined) ?? '');

        const discordRoles = activeWorkflow?.discordRoleIds ?? [];

        const discordReviewChannelId =
            discordReviewChannelRef.current?.value ?? activeWorkflow?.discordReviewChannelId ?? '';

        const patch = buildWhitelistSavePatch({
            workflows: states.workflows as WhitelistWorkflow[],
            activeWorkflowId: states.activeWorkflowId as string | undefined,
            schedule: scheduleState,
            serverBrowserInstructions,
            workflowType,
            activeWorkflow,
            discordRoleIds: discordRoles,
            discordReviewChannelId,
            closedMessage,
        });

        const storedWorkflows = cfg.workflows.initialValue as WhitelistWorkflow[] | undefined;
        const storedActiveId = cfg.activeWorkflowId.initialValue as string | undefined;
        const storedActive = getActiveWorkflow(storedWorkflows, storedActiveId);
        const storedType = storedActive?.type ?? 'disabled';

        const storedPatch = buildWhitelistSavePatch({
            workflows: storedWorkflows,
            activeWorkflowId: storedActiveId,
            schedule: cfg.schedule.initialValue as WhitelistSchedule | undefined,
            serverBrowserInstructions: cfg.serverBrowserInstructions.initialValue as string | undefined,
            workflowType: storedType,
            activeWorkflow: storedActive,
            discordRoleIds: storedActive?.discordRoleIds ?? [],
            discordReviewChannelId: storedActive?.discordReviewChannelId ?? '',
            closedMessage:
                (cfg.schedule.initialValue as WhitelistSchedule | undefined)?.closedMessage ?? defaultClosedMessage,
        });

        const hasChanges = !dequal(patch, storedPatch);
        pageCtx.setCardPendingSave(reconcileCardPendingSave(cardCtx, hasChanges));

        return {
            hasChanges,
            localConfigs: { whitelist: patch },
        };
    };

    const handleDiscordRoleIdsChange = (roleIds: string[]) => {
        const workflows = syncWorkflowType(
            states.workflows as WhitelistWorkflow[],
            states.activeWorkflowId as string | undefined,
            workflowType,
            roleIds,
            activeWorkflow?.discordReviewChannelId,
        );
        cfg.workflows.state.set(workflows);
    };

    const handleWorkflowTypeChange = (type: WhitelistWorkflowType) => {
        const discordRoles = activeWorkflow?.discordRoleIds ?? [];
        const workflows = syncWorkflowType(
            states.workflows as WhitelistWorkflow[],
            states.activeWorkflowId,
            type,
            discordRoles,
        );
        cfg.workflows.state.set(workflows);
        cfg.enabled.state.set(type !== 'disabled');
    };

    const handleOnSave = () => {
        const { hasChanges, localConfigs } = updatePageState();
        if (!hasChanges) return;

        const wl = localConfigs.whitelist;

        const type = getActiveWorkflow(wl?.workflows, wl?.activeWorkflowId)?.type;
        if (type === 'auto_discord_member' || type === 'auto_discord_role') {
            if (pageCtx.apiData?.storedConfigs.discordBot?.enabled !== true) {
                return txToast.warning({
                    title: t('panel.settings.whitelist.toast_discord_bot_required_title'),
                    msg: t('panel.settings.whitelist.toast_discord_bot_required_msg'),
                });
            }
        }
        if (type === 'auto_discord_role') {
            const roles = getActiveWorkflow(wl?.workflows, wl?.activeWorkflowId)?.discordRoleIds ?? [];
            if (!roles.length) {
                return txToast.warning({
                    title: t('panel.settings.whitelist.toast_discord_roles_required_title'),
                    msg: t('panel.settings.whitelist.toast_discord_roles_required_msg'),
                });
            }
            for (const roleId of roles) {
                if (!consts.regexDiscordSnowflake.test(roleId)) {
                    return txToast.error({
                        title: t('panel.settings.whitelist.toast_invalid_role_title'),
                        msg: t('panel.settings.whitelist.toast_invalid_role_msg', { roleId }),
                    });
                }
            }
        }

        if (wl?.enabled && !wl.serverBrowserInstructions?.trim()) {
            return txToast.error({
                title: t('panel.settings.whitelist.toast_instructions_required_title'),
                msg: t('panel.settings.whitelist.toast_instructions_required_msg'),
            });
        }

        if (wl?.serverBrowserInstructions && wl.serverBrowserInstructions.length > 512) {
            return txToast.error({
                title: t('panel.settings.whitelist.toast_instructions_too_long_title'),
                msg: t('panel.settings.whitelist.toast_instructions_too_long_msg'),
            });
        }

        if (wl?.schedule?.enabled && !wl.schedule.windows?.length) {
            return txToast.error({
                title: t('panel.settings.whitelist.toast_schedule_windows_title'),
                msg: t('panel.settings.whitelist.toast_schedule_windows_msg'),
            });
        }

        const reviewChannel = getActiveWorkflow(wl?.workflows, wl?.activeWorkflowId)?.discordReviewChannelId;
        if (reviewChannel && !consts.regexDiscordSnowflake.test(reviewChannel)) {
            return txToast.error({
                title: t('panel.settings.whitelist.toast_invalid_review_channel_title'),
                msg: t('panel.settings.whitelist.toast_invalid_review_channel_msg'),
            });
        }

        pageCtx.saveChanges(cardCtx, localConfigs);
    };

    return (
        <SettingsCardShell cardCtx={cardCtx} pageCtx={pageCtx} onClickSave={handleOnSave}>
            <SettingItem label={t('panel.settings.whitelist.enabled_label')}>
                <SwitchText
                    id={cfg.enabled.eid}
                    checkedLabel={t('panel.settings.switch.enabled')}
                    uncheckedLabel={t('panel.settings.switch.disabled')}
                    checked={states.enabled === true}
                    onCheckedChange={(checked) => {
                        cfg.enabled.state.set(checked);
                        if (!checked) handleWorkflowTypeChange('disabled');
                    }}
                    disabled={pageCtx.isReadOnly}
                />
                <SettingItemDesc>{t('panel.settings.whitelist.enabled_desc')}</SettingItemDesc>
            </SettingItem>

            <SettingItem label={t('panel.settings.whitelist.workflow_label')}>
                <RadioGroup
                    value={workflowType}
                    onValueChange={(v) => handleWorkflowTypeChange(v as WhitelistWorkflowType)}
                    disabled={pageCtx.isReadOnly}
                >
                    {workflowOptions.map((opt) => (
                        <BigRadioItem
                            key={opt.value}
                            groupValue={workflowType}
                            value={opt.value}
                            title={opt.title}
                            desc={opt.desc}
                        />
                    ))}
                </RadioGroup>
            </SettingItem>

            {!isExternalWhitelist ? null : null}

            {isWhitelistActive ? (
                <SettingItem
                    label={t('panel.settings.whitelist.browser_instructions_label')}
                    htmlFor="wl-browser-instructions"
                >
                    <AutosizeTextarea
                        id="wl-browser-instructions"
                        ref={serverBrowserInstructionsRef}
                        defaultValue={(states.serverBrowserInstructions as string) ?? ''}
                        onInput={updatePageState}
                        minHeight={60}
                        maxHeight={160}
                        disabled={pageCtx.isReadOnly}
                        placeholder={t('panel.settings.whitelist.browser_instructions_placeholder')}
                    />
                    <SettingItemDesc>{t('panel.settings.whitelist.browser_instructions_desc')}</SettingItemDesc>
                </SettingItem>
            ) : null}

            {workflowType === 'manual_review' ? (
                <SettingItem
                    label={t('panel.settings.whitelist.discord_review_channel_label')}
                    htmlFor="wl-discord-review-channel"
                    showOptional
                >
                    <Input
                        id="wl-discord-review-channel"
                        ref={discordReviewChannelRef}
                        defaultValue={activeWorkflow?.discordReviewChannelId ?? ''}
                        placeholder={t('panel.settings.whitelist.discord_review_channel_placeholder')}
                        onInput={updatePageState}
                        disabled={pageCtx.isReadOnly}
                    />
                    <SettingItemDesc>{t('panel.settings.whitelist.discord_review_channel_desc')}</SettingItemDesc>
                </SettingItem>
            ) : null}

            {workflowType === 'auto_discord_role' ? (
                <SettingItem label={t('panel.settings.whitelist.discord_roles_label')} htmlFor="wl-discord-roles">
                    <DiscordRoleMultiSelect
                        id="wl-discord-roles"
                        value={activeWorkflow?.discordRoleIds ?? []}
                        onChange={handleDiscordRoleIdsChange}
                        disabled={pageCtx.isReadOnly || pageCtx.apiData?.storedConfigs.discordBot?.enabled !== true}
                    />
                    <SettingItemDesc>{t('panel.settings.whitelist.discord_roles_desc')}</SettingItemDesc>
                </SettingItem>
            ) : null}

            {!isExternalWhitelist ? (
                <>
                    <SettingItem label={t('panel.settings.whitelist.deferral_cards_label')}>
                        <SettingItemDesc>
                            {t('panel.settings.whitelist.deferral_cards_desc_prefix')}{' '}
                            <TxAnchor href="/settings#deferral-cards">
                                {t('panel.settings.tabs.deferral_cards')}
                            </TxAnchor>{' '}
                            {t('panel.settings.whitelist.deferral_cards_desc_suffix')}
                        </SettingItemDesc>
                    </SettingItem>

                    <SettingItem label={t('panel.settings.whitelist.schedule_label')}>
                        <SwitchText
                            checkedLabel={t('panel.settings.whitelist.schedule_on')}
                            uncheckedLabel={t('panel.settings.whitelist.schedule_off')}
                            checked={(states.schedule as WhitelistSchedule)?.enabled === true}
                            onCheckedChange={(checked) => {
                                cfg.schedule.state.set({
                                    ...(states.schedule as WhitelistSchedule),
                                    enabled: checked,
                                });
                            }}
                            disabled={pageCtx.isReadOnly}
                        />
                        <Input
                            ref={scheduleClosedRef}
                            className="mt-3"
                            defaultValue={(states.schedule as WhitelistSchedule)?.closedMessage}
                            placeholder={t('panel.settings.whitelist.schedule_closed_placeholder')}
                            onInput={updatePageState}
                            disabled={pageCtx.isReadOnly}
                        />
                        {(states.schedule as WhitelistSchedule)?.enabled ? (
                            <WhitelistScheduleEditor
                                schedule={
                                    (states.schedule as WhitelistSchedule) ?? {
                                        enabled: false,
                                        timezone: 'UTC',
                                        windows: [],
                                        closedMessage: '',
                                    }
                                }
                                disabled={pageCtx.isReadOnly}
                                onChange={(schedule) => cfg.schedule.state.set(schedule)}
                            />
                        ) : null}
                        <SettingItemDesc>{t('panel.settings.whitelist.schedule_desc')}</SettingItemDesc>
                    </SettingItem>
                </>
            ) : null}

            <SettingItem label={t('panel.settings.whitelist.manage_label')}>
                <SettingItemDesc>
                    {t('panel.settings.whitelist.manage_desc')}{' '}
                    <TxAnchor href="/whitelist">{t('panel.routes.whitelist')}</TxAnchor>
                </SettingItemDesc>
            </SettingItem>
        </SettingsCardShell>
    );
}
