import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import SettingsCardShell from '../SettingsCardShell';
import { txToast } from '@/components/TxToaster';
import { useLocale } from '@/hooks/locale';
import {
    configsReducer,
    getConfigAccessors,
    getConfigDiff,
    getConfigEmptyState,
    reconcileCardPendingSave,
    type SettingsCardProps,
} from '../utils';
import { GameMenuSettingsFields, gameMenuPageConfigs } from './gameMenu';
import { GameNotificationsSettingsFields, gameNotificationsPageConfigs } from './gameNotifications';
import { GameReportsSettingsFields, gameReportsPageConfigs } from './gameReports';

export const pageConfigs = {
    ...gameMenuPageConfigs,
    ...gameNotificationsPageConfigs,
    ...gameReportsPageConfigs,
} as const;

export default function ConfigCardGame({ cardCtx, pageCtx }: SettingsCardProps) {
    const { t } = useLocale();
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [states, dispatch] = useReducer(configsReducer<typeof pageConfigs>, null, () =>
        getConfigEmptyState(pageConfigs),
    );
    const cfg = useMemo(() => {
        return getConfigAccessors(cardCtx.cardId, pageConfigs, pageCtx.apiData, dispatch);
    }, [cardCtx.cardId, pageCtx.apiData, dispatch]);

    const playerIdDistanceRef = useRef<HTMLInputElement | null>(null);
    const categoriesRef = useRef<HTMLInputElement | null>(null);
    const retentionDaysRef = useRef<HTMLInputElement | null>(null);
    const ticketChannelRef = useRef<HTMLInputElement | null>(null);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        updatePageState();
    }, [states]);

    useEffect(() => {
        if (showAdvanced) return;
        Object.values(cfg).forEach((c) => c.isAdvanced && c.state.discard());
    }, [showAdvanced, cfg]);

    useEffect(() => {
        if (!pageCtx.apiData) return;

        const stored = pageCtx.apiData.storedConfigs as {
            gameFeatures?: {
                ticketCategories?: string[];
                ticketRetentionDays?: number;
            };
            discordBot?: {
                ticketChannelId?: string | null;
            };
        };
        const defaults = pageCtx.apiData.defaultConfigs as typeof stored;

        const cats = stored?.gameFeatures?.ticketCategories ?? defaults?.gameFeatures?.ticketCategories ?? [];
        const ret = stored?.gameFeatures?.ticketRetentionDays ?? defaults?.gameFeatures?.ticketRetentionDays ?? 30;
        const chan = stored?.discordBot?.ticketChannelId ?? defaults?.discordBot?.ticketChannelId ?? '';

        if (categoriesRef.current) categoriesRef.current.value = cats.join(', ');
        if (retentionDaysRef.current) retentionDaysRef.current.value = String(ret);
        if (ticketChannelRef.current) ticketChannelRef.current.value = chan ?? '';
    }, [pageCtx.apiData]);

    useEffect(() => {
        return () => {
            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        };
    }, []);

    const updatePageState = useCallback(() => {
        const distanceVal = playerIdDistanceRef.current?.value;
        const overwrites: Record<string, unknown> = {};

        if (distanceVal !== undefined) {
            const parsed = parseInt(distanceVal, 10);
            overwrites.playerIdDistance = isNaN(parsed) ? 150 : Math.min(1000, Math.max(1, parsed));
        }

        const rawCategories = categoriesRef.current?.value ?? '';
        const categories = rawCategories.split(/[,;]\s*/).reduce<string[]>((values, value) => {
            const trimmedValue = value.trim();
            if (trimmedValue.length > 0) {
                values.push(trimmedValue);
            }
            return values;
        }, []);

        const retDays = parseInt(retentionDaysRef.current?.value ?? '30', 10);
        const chanId = ticketChannelRef.current?.value.trim() || null;

        overwrites.ticketCategories = categories.length ? categories : undefined;
        overwrites.ticketRetentionDays = Number.isFinite(retDays) ? retDays : undefined;
        overwrites.ticketChannelId = chanId;

        const res = getConfigDiff(cfg, states, overwrites, showAdvanced);
        pageCtx.setCardPendingSave(reconcileCardPendingSave(cardCtx, res.hasChanges));
        return res;
    }, [cardCtx, cfg, pageCtx, showAdvanced, states]);

    const debouncedUpdatePageState = useCallback(() => {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
            updatePageState();
        }, 300);
    }, [updatePageState]);

    const handlePageKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!e.metaKey) e.preventDefault();
        if (['Escape', 'Backspace'].includes(e.code)) {
            cfg.pageKey.state.set('Tab');
        } else {
            cfg.pageKey.state.set(e.code);
        }
    };

    const handleOnSave = () => {
        const retDays = parseInt(retentionDaysRef.current?.value ?? '30', 10);
        if (!Number.isFinite(retDays) || retDays < 1 || retDays > 365) {
            return txToast.error(t('panel.settings.game_reports.toast_retention_invalid'));
        }

        const { hasChanges, localConfigs } = updatePageState();
        if (!hasChanges) return;
        pageCtx.saveChanges(cardCtx, localConfigs);
    };

    return (
        <SettingsCardShell
            cardCtx={cardCtx}
            pageCtx={pageCtx}
            onClickSave={handleOnSave}
            advancedVisible={showAdvanced}
            advancedSetter={setShowAdvanced}
        >
            <GameMenuSettingsFields
                cfg={cfg}
                states={states}
                pageCtx={pageCtx}
                showAdvanced={showAdvanced}
                playerIdDistanceRef={playerIdDistanceRef}
                updatePageState={updatePageState}
                handlePageKey={handlePageKey}
            />
            <GameNotificationsSettingsFields cfg={cfg} states={states} pageCtx={pageCtx} />
            <GameReportsSettingsFields
                cardId={cardCtx.cardId}
                cfg={cfg}
                states={states}
                pageCtx={pageCtx}
                categoriesRef={categoriesRef}
                retentionDaysRef={retentionDaysRef}
                ticketChannelRef={ticketChannelRef}
                updatePageState={updatePageState}
                debouncedUpdatePageState={debouncedUpdatePageState}
            />
        </SettingsCardShell>
    );
}
