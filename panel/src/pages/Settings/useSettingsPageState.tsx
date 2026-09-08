import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { setUrlHash } from '@/lib/navigation';
import { ApiTimeout, useBackendApi } from '@/hooks/fetch';
import { useOpenConfirmDialog } from '@/hooks/dialogs';
import { txToast } from '@/components/TxToaster';
import { useAdminPerms } from '@/hooks/auth';
import { useAddonWidgets, useAddonWidgetsByPrefix } from '@/hooks/addons';
import { useLocale } from '@/hooks/locale';
import { emsg } from '@shared/emsg';
import type { GetConfigsResp, PartialTxConfigs, SaveConfigsReq, SaveConfigsResp } from '@shared/otherTypes';
import { SYM_RESET_CONFIG, type SettingsCardContext, type SettingsPageContext } from './utils';
import { buildSettingsTabs, type SettingTabsDatum } from './settingsTabsConfig';

function resolveTabFromHash(settingsTabs: SettingTabsDatum[], pageHash: string, canMaster: boolean): string {
    if (pageHash === 'danger-zone' && canMaster) return 'danger-zone';
    if (pageHash.startsWith('addon-')) return pageHash;
    const match = settingsTabs.find((entry) => entry.ctx.tabId === pageHash);
    if (match) return match.ctx.tabId;
    return settingsTabs[0]?.ctx.tabId ?? 'general';
}

export function useSettingsPageState() {
    const { t } = useLocale();
    const settingsTabs = useMemo(() => buildSettingsTabs(t), [t]);
    const [cardPendingSave, setCardPendingSave] = useState<SettingsCardContext | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const openConfirmDialog = useOpenConfirmDialog();
    const { hasPerm } = useAdminPerms();
    const hasPermRef = useRef(hasPerm);
    useEffect(() => {
        hasPermRef.current = hasPerm;
    }, [hasPerm]);

    const addonSettingsTabs = useAddonWidgets('settings.tab');
    const addonTabInject = useAddonWidgetsByPrefix('settings.tab.');
    const saveHandlersRef = useRef(new Map<string, () => void>());

    const registerSaveHandler = useCallback((cardId: string, handler: () => void) => {
        saveHandlersRef.current.set(cardId, handler);
    }, []);

    const unregisterSaveHandler = useCallback((cardId: string) => {
        saveHandlersRef.current.delete(cardId);
    }, []);

    const triggerPendingSave = useCallback(() => {
        if (!cardPendingSave) return;
        saveHandlersRef.current.get(cardPendingSave.cardId)?.();
    }, [cardPendingSave]);

    const [tab, setTab] = useState(() => {
        const pageHash = window.location?.hash.slice(1) ?? '';
        return resolveTabFromHash(settingsTabs, pageHash, hasPerm('master'));
    });

    useEffect(() => {
        if (tab === 'danger-zone' || tab.startsWith('addon-')) return;
        if (settingsTabs.some((entry) => entry.ctx.tabId === tab)) return;
        const fallback = settingsTabs[0]?.ctx.tabId;
        if (!fallback) return;
        setTab(fallback);
        setUrlHash(fallback);
    }, [settingsTabs, tab]);

    useEffect(() => {
        const onHashChange = () => {
            const hash = window.location.hash.slice(1);
            let nextTab: string | null = null;

            if (hash) {
                nextTab = resolveTabFromHash(settingsTabs, hash, hasPermRef.current('master'));
            }

            if (nextTab) {
                setTab(nextTab);
            }
        };
        window.addEventListener('hashchange', onHashChange);
        return () => window.removeEventListener('hashchange', onHashChange);
    }, [settingsTabs]);

    useEffect(() => {
        if (!cardPendingSave) return;
        const handler = (e: BeforeUnloadEvent) => {
            e.preventDefault();
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [cardPendingSave]);

    const queryApi = useBackendApi<GetConfigsResp>({
        method: 'GET',
        path: `/settings/configs`,
        throwGenericErrors: true,
    });
    const saveApi = useBackendApi<SaveConfigsResp, SaveConfigsReq>({
        method: 'POST',
        path: `/settings/configs/:card`,
        throwGenericErrors: true,
    });

    const swr = useSWR(
        '/settings/configs',
        async () => {
            const data = await queryApi({});
            if (!data) throw new Error('No data returned');
            return data;
        },
        {
            revalidateOnMount: true,
            revalidateOnFocus: false,
        },
    );

    const saveChanges = async (source: SettingsCardContext, changes: PartialTxConfigs) => {
        if (isSaving) return;
        const toastId = txToast.loading(t('panel.settings.saving', { cardTitle: source.cardTitle }), {
            id: 'settingsSave',
        });
        setIsSaving(true);
        try {
            if (!swr.data) throw new Error('Cannot save changes without swr.data.');
            const resetKeys: string[] = [];
            for (const [scopeName, scopeData] of Object.entries(changes)) {
                for (const [configKey, configValue] of Object.entries(scopeData as Record<string, unknown>)) {
                    if (configValue === SYM_RESET_CONFIG) {
                        resetKeys.push(`${scopeName}.${configKey}`);
                    }
                }
            }
            const saveResp = await saveApi({
                pathParams: { card: source.cardId },
                data: { resetKeys, changes },
                timeout:
                    source.cardId === 'discord' || source.cardId === 'discord-bot'
                        ? ApiTimeout.REALLY_REALLY_LONG
                        : ApiTimeout.LONG,
                toastId,
            });
            if (!saveResp) throw new Error('empty_response');
            if (saveResp.type === 'error') return;
            if (!saveResp.stored) throw new Error('no_stored_data');
            if (!saveResp.changelog) throw new Error('no_changelog_data');
            swr.mutate(
                {
                    ...swr.data,
                    storedConfigs: saveResp.stored,
                    changelog: saveResp.changelog,
                },
                false,
            );
            setCardPendingSave(null);
        } catch (error) {
            txToast.error(
                {
                    title: t('panel.settings.save_error', { cardTitle: source.cardTitle }),
                    msg: emsg(error),
                },
                { id: toastId },
            );
        } finally {
            setIsSaving(false);
        }
    };

    const switchTab = (newTab: string) => {
        setCardPendingSave(null);
        setTab(newTab);
        setUrlHash(newTab);
    };

    const handleTabChange = (newTab: string) => {
        if (cardPendingSave && newTab && newTab !== cardPendingSave?.tabId) {
            openConfirmDialog({
                title: t('panel.dialogs.discard_changes_title'),
                actionLabel: t('panel.settings.discard_action'),
                confirmBtnVariant: 'destructive',
                message: (
                    <>
                        {t('panel.settings.discard_unsaved_message', { cardTitle: cardPendingSave.cardTitle })} <br />
                        {t('panel.settings.discard_confirm')}
                    </>
                ),
                onConfirm: () => {
                    switchTab(newTab);
                },
            });
        } else {
            switchTab(newTab);
        }
    };

    const pageCtx: SettingsPageContext = {
        apiData: swr.data,
        isReadOnly: swr.isLoading || isSaving || !swr.data || !hasPerm('settings.write'),
        isLoading: swr.isLoading,
        isSaving,
        swrError: swr.error ? swr.error.message : undefined,
        cardPendingSave,
        setCardPendingSave,
        saveChanges,
        registerSaveHandler,
        unregisterSaveHandler,
        triggerPendingSave,
    };

    return {
        t,
        settingsTabs,
        tab,
        handleTabChange,
        cardPendingSave,
        pageCtx,
        addonSettingsTabs,
        addonTabInject,
        hasPerm,
        swr,
    };
}
