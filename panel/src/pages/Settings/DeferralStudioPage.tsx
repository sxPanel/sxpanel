import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { navigate } from 'wouter/use-browser-location';
import { PageHeader } from '@/components/page-header';
import { useLocale } from '@/hooks/locale';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AutosizeTextarea } from '@/components/ui/autosize-textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { txToast } from '@/components/TxToaster';
import { ApiTimeout, useBackendApi } from '@/hooks/fetch';
import { deferralEditorAtom } from './deferralEditorState';
import {
    type DeferralCardTemplate,
    type DeferralCardsConfig,
    type DeferralScenarioId,
    DEFERRAL_SCENARIO_META,
    DEFAULT_DEFERRAL_CARD_TEMPLATES,
    normalizeDeferralCardsConfig,
    applySharedPlaceholdersToDeferralConfig,
    resolveDeferralDiscordInvite,
    resolveDeferralScenarioShowLogo,
    DEFERRAL_WATERMARK_MAX_HEIGHT_PX,
    DEFERRAL_WATERMARK_MAX_WIDTH_PX,
} from '@shared/deferralCardTypes';
import { isAddonDeferralScenarioId } from '@shared/deferralAddonTypes';
import { getDeferralTemplateOrDefault } from '@shared/deferralScenarioAccess';
import { useDeferralAddonMeta } from '@/hooks/deferralAddonMeta';
import { canonicalDeferralCardsForDiff, patchDeferralScenario } from '@shared/deferralCardRender';
import {
    buildDeferralCardsSavePayload,
    isDeferralScenarioDirty,
    listDirtyDeferralScenarioIds,
    mergeDeferralCardsAfterScenarioSave,
} from '@shared/deferralCardDirty';
import type { DeferralCardTokens } from '@shared/deferralCardRender';
import { syncLegacyFieldsFromLayout } from '@shared/deferralCardLayout';
import { useOpenConfirmDialog } from '@/hooks/dialogs';
import { exportDeferralCardsFull, exportDeferralScenario, importDeferralCardFile } from '@shared/deferralCardExport';
import type { DeferralCanvasElement } from '@shared/deferralCardCanvas';
import type { DeferralBlockType } from '@shared/deferralCardLayout';
import {
    clampCardSize,
    createCanvasElement,
    DEFERRAL_CARD_CANVAS_HEIGHT,
    DEFERRAL_CARD_CANVAS_WIDTH,
    DEFERRAL_CARD_SIZE_PRESETS,
    estimateCanvasElementSize,
    getCanvasContentWidth,
    getTemplateCanvas,
    loadStudioCanvasElements,
    normalizeCanvasElements,
    resolveCanvasHeight,
    snapDeferralCoord,
    templateWithCanvas,
} from '@shared/deferralCardCanvas';
import type { DeferralCardSizePresetId } from '@shared/deferralCardCanvas';
import TxAnchor from '@/components/TxAnchor';
import { DeferralStudioCanvas } from './deferral/DeferralStudioCanvas';
import { DeferralStudioLayers } from './deferral/DeferralStudioLayers';
import { DeferralStudioToolbar } from './deferral/DeferralStudioToolbar';
import {
    DEFAULT_DEFERRAL_STUDIO_PREFS,
    loadDeferralStudioPrefs,
    saveDeferralStudioPrefs,
} from './deferral/deferralStudioPrefs';
import type { SaveConfigsReq, SaveConfigsResp } from '@shared/otherTypes';
import { emsg } from '@shared/emsg';
import { rasterizeCanvasElements } from '@shared/deferralCardImage';
import {
    DEFERRAL_PNG_MAX_BYTES,
    DEFERRAL_SVG_MAX_BYTES,
    deferralCustomImageHasPreview,
    readDeferralImageFile,
} from '@shared/deferralCardSvg';
import { DeferralStudioAnimatedImage } from './deferral/DeferralStudioAnimatedImage';
import { DeferralButtonEditor } from './deferral/DeferralButtonEditor';
import { deferralBlockLabel, deferralScenarioLabel } from './deferral/deferralStudioLocale';
import { ImageIcon, LayoutTemplateIcon, Trash2 } from 'lucide-react';

const PREVIEW_SAMPLE: Record<
    DeferralScenarioId,
    {
        body: string;
        requestId?: string;
        tierName?: string;
        banExpires?: string;
        banReason?: string;
        banId?: string;
        banDate?: string;
    }
> = {
    ban_temporary: {
        body: 'You can join <strong>{discordInvite}</strong> to appeal this ban.',
        banExpires: '2 days',
        banReason: 'Example ban',
        banId: 'A12345',
        banDate: 'Jun 2, 2026, 10:40:41 PM',
    },
    ban_permanent: {
        body: 'You can join <strong>{discordInvite}</strong> to appeal this ban.',
        banReason: 'Example permanent ban',
        banId: 'A12345',
        banDate: 'Jun 2, 2026, 10:40:41 PM',
    },
    whitelist_pending: {
        body: 'Please join our Discord for whitelist instructions.',
        requestId: 'R12345',
    },
    whitelist_schedule_closed: { body: 'Whitelist applications are currently closed.' },
    whitelist_admin_denied: { body: '' },
    whitelist_admin_insufficient_ids: { body: '' },
    whitelist_discord_member_denied: { body: 'Join our Discord server to play.' },
    whitelist_discord_member_insufficient_ids: { body: '' },
    whitelist_discord_roles_not_member: { body: 'You must be in our Discord guild.' },
    whitelist_discord_roles_no_roles: { body: 'You need a whitelisted Discord role.' },
    whitelist_discord_roles_insufficient_ids: { body: '' },
    whitelist_insufficient_license: { body: '' },
    whitelist_error: { body: 'Could not verify Discord membership.' },
    connection_queue: { body: 'You are #3 in queue. Estimated wait: 2 minutes.' },
    access_denied: { body: 'You cannot join this server.' },
};

const BASE_ADDABLE: DeferralBlockType[] = [
    'heading',
    'text',
    'custom_text',
    'paragraph',
    'rejection_message',
    'request_id',
    'ban_id',
    'tier_name',
    'custom_image',
    'button',
    'spacer',
    'divider',
    'logo',
];

const BAN_ADDABLE: DeferralBlockType[] = ['ban_reason', 'ban_expires'];

function addableBlocksForScenario(scenarioId: string | null): DeferralBlockType[] {
    const isBan = scenarioId === 'ban_temporary' || scenarioId === 'ban_permanent';
    return isBan ? [...BASE_ADDABLE, ...BAN_ADDABLE] : BASE_ADDABLE;
}

function initialCardSize(cfg: ReturnType<typeof normalizeDeferralCardsConfig>, scenarioId: string | null) {
    if (!scenarioId) {
        return { width: DEFERRAL_CARD_CANVAS_WIDTH, height: DEFERRAL_CARD_CANVAS_HEIGHT };
    }
    const canvas = getTemplateCanvas(getDeferralTemplateOrDefault(cfg, scenarioId));
    return { width: canvas.width, height: resolveCanvasHeight(canvas) };
}

export default function DeferralStudioPage() {
    const { t } = useLocale();
    const { meta: addonDeferralMeta } = useDeferralAddonMeta();
    const editorState = useAtomValue(deferralEditorAtom);
    const setEditorState = useSetAtom(deferralEditorAtom);
    const openConfirmDialog = useOpenConfirmDialog();
    const importInputRef = useRef<HTMLInputElement>(null);
    const svgUploadInputRef = useRef<HTMLInputElement>(null);

    const initialConfig = useMemo(
        () => canonicalDeferralCardsForDiff(normalizeDeferralCardsConfig(editorState?.deferralCards)),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- baseline only when studio opens
        [],
    );

    const [savedConfig, setSavedConfig] = useState<DeferralCardsConfig>(() => initialConfig);
    const [deferralCards, setDeferralCards] = useState(() => normalizeDeferralCardsConfig(editorState?.deferralCards));
    const initialScenario = editorState?.scenarioId ?? null;
    const [scenarioId, setScenarioId] = useState<string | null>(initialScenario);
    const [canvasElements, setCanvasElements] = useState<DeferralCanvasElement[]>(() => {
        if (!initialScenario) return [];
        const cfg = normalizeDeferralCardsConfig(editorState?.deferralCards);
        const tpl = getDeferralTemplateOrDefault(cfg, initialScenario);
        const sampleBody = PREVIEW_SAMPLE[initialScenario as DeferralScenarioId]?.body ?? '{customMessage}';
        return loadStudioCanvasElements(tpl, initialScenario, sampleBody);
    });
    const [cardSize, setCardSize] = useState(() => {
        const cfg = normalizeDeferralCardsConfig(editorState?.deferralCards);
        return initialCardSize(cfg, initialScenario);
    });
    const [sizePreset, setSizePreset] = useState<DeferralCardSizePresetId | 'custom'>(() => {
        const cfg = normalizeDeferralCardsConfig(editorState?.deferralCards);
        const size = initialCardSize(cfg, initialScenario);
        return matchSizePreset(size.width, size.height);
    });
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [studioPrefs, setStudioPrefs] = useState(() => DEFAULT_DEFERRAL_STUDIO_PREFS);

    useEffect(() => {
        setStudioPrefs(loadDeferralStudioPrefs());
    }, []);

    const snapCoord = (value: number) => (studioPrefs.snapToGrid ? snapDeferralCoord(value) : Math.round(value));

    const updateStudioPrefs = (patch: Partial<typeof studioPrefs>) => {
        setStudioPrefs((prev) => {
            const next = { ...prev, ...patch };
            saveDeferralStudioPrefs(next);
            return next;
        });
    };

    const saveApi = useBackendApi<SaveConfigsResp, SaveConfigsReq>({
        method: 'POST',
        path: '/settings/configs/:card',
        throwGenericErrors: false,
    });

    useEffect(() => {
        if (!editorState) navigate('/settings#deferral-cards');
    }, [editorState]);

    const template = scenarioId ? getDeferralTemplateOrDefault(deferralCards, scenarioId) : null;
    const selected = canvasElements.find((e) => e.id === selectedId) ?? null;

    const previewTokens: DeferralCardTokens = useMemo(() => {
        if (!scenarioId) return {};
        const sample = isAddonDeferralScenarioId(scenarioId)
            ? { body: '{customMessage}' }
            : PREVIEW_SAMPLE[scenarioId as DeferralScenarioId];
        return {
            requestId: sample.requestId,
            tierName: sample.tierName,
            customMessage: sample.body,
            guildName: 'Your Discord',
            discordInvite: resolveDeferralDiscordInvite(deferralCards),
            serverName: 'Your Server Name',
            playerName: 'SniperSpools',
            queuePosition: '3',
            queueSize: '12',
            queueEta: '00:11',
            title: template?.title,
            body: sample.body,
            banExpires: sample.banExpires,
            banReason: sample.banReason,
            banId: sample.banId,
            banDate: sample.banDate,
        };
    }, [scenarioId, template?.title, deferralCards]);

    const workingTemplate = useMemo((): DeferralCardTemplate | null => {
        if (!template || !scenarioId) return null;
        return templateWithCanvas(template, {
            width: cardSize.width,
            height: cardSize.height,
            elements: canvasElements,
        });
    }, [template, scenarioId, canvasElements, cardSize]);

    const dirtyScenarioIds = useMemo(
        () => listDirtyDeferralScenarioIds(deferralCards, savedConfig),
        [deferralCards, savedConfig],
    );

    const isCurrentDirty = useMemo(() => {
        if (!scenarioId || !workingTemplate) return false;
        return isDeferralScenarioDirty(workingTemplate, getDeferralTemplateOrDefault(savedConfig, scenarioId));
    }, [scenarioId, workingTemplate, savedConfig]);

    const hasAnyUnsavedChanges = dirtyScenarioIds.length > 0;

    useEffect(() => {
        if (!hasAnyUnsavedChanges) return;
        const handler = (e: BeforeUnloadEvent) => {
            e.preventDefault();
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [hasAnyUnsavedChanges]);

    const scenarioShowLogo = useMemo(() => {
        if (!template) return deferralCards.skin.showLogo !== false;
        return resolveDeferralScenarioShowLogo(workingTemplate ?? template, deferralCards.skin);
    }, [template, workingTemplate, deferralCards.skin]);

    const handleShowLogoChange = (checked: boolean) => {
        if (!scenarioId || !template) return;
        setDeferralCards((prev) =>
            patchDeferralScenario(prev, scenarioId, {
                ...template,
                showLogo: checked,
            }),
        );
    };

    const loadScenarioIntoStudio = (id: string, cfg = deferralCards) => {
        const tpl = getDeferralTemplateOrDefault(cfg, id);
        const canvas = getTemplateCanvas(tpl);
        const sampleBody = isAddonDeferralScenarioId(id)
            ? '{customMessage}'
            : (PREVIEW_SAMPLE[id as DeferralScenarioId]?.body ?? '');
        setScenarioId(id);
        setSelectedId(null);
        setCardSize({ width: canvas.width, height: resolveCanvasHeight(canvas) });
        setSizePreset(matchSizePreset(canvas.width, resolveCanvasHeight(canvas)));
        setCanvasElements(loadStudioCanvasElements(tpl, id, sampleBody));
    };

    /** Config merged with the live canvas for the scenario currently open in the studio. */
    const deferralCardsForFileOps = useMemo((): DeferralCardsConfig => {
        if (!scenarioId || !workingTemplate) return deferralCards;
        return patchDeferralScenario(deferralCards, scenarioId, workingTemplate);
    }, [deferralCards, scenarioId, workingTemplate]);

    const revertScenarioToSaved = (id: string) => {
        const savedTpl = getDeferralTemplateOrDefault(savedConfig, id);
        setDeferralCards((prev) => patchDeferralScenario(prev, id, savedTpl));
        return savedTpl;
    };

    const scenarioLabel = (id: string) => {
        const core = DEFERRAL_SCENARIO_META.find((s) => s.id === id);
        const addon = addonDeferralMeta.scenarios.find((s) => s.id === id);
        return deferralScenarioLabel(t, id, core?.label ?? addon?.label ?? id);
    };

    const confirmDiscardCurrent = (onProceed: () => void) => {
        if (!scenarioId || !isCurrentDirty) {
            onProceed();
            return;
        }
        openConfirmDialog({
            title: t('panel.deferral_studio.discard_scenario_title'),
            message: (
                <>
                    <strong>{scenarioLabel(scenarioId)}</strong> {t('panel.deferral_studio.discard_scenario_message')}
                </>
            ),
            actionLabel: t('panel.deferral_studio.discard_action'),
            confirmBtnVariant: 'destructive',
            onConfirm: () => {
                revertScenarioToSaved(scenarioId);
                onProceed();
            },
        });
    };

    const confirmLeaveStudio = (onProceed: () => void) => {
        if (!hasAnyUnsavedChanges) {
            onProceed();
            return;
        }
        const names = dirtyScenarioIds.map(scenarioLabel).join(', ');
        openConfirmDialog({
            title: t('panel.deferral_studio.leave_unsaved_title'),
            message: (
                <>
                    {t('panel.deferral_studio.leave_unsaved_message')} <strong>{names}</strong>.{' '}
                    {t('panel.deferral_studio.leave_unsaved_suffix')}
                </>
            ),
            actionLabel: t('panel.deferral_studio.leave_action'),
            confirmBtnVariant: 'destructive',
            onConfirm: onProceed,
        });
    };

    const handleSelectScenario = (id: string) => {
        if (id === scenarioId) return;
        confirmDiscardCurrent(() => loadScenarioIntoStudio(id));
    };

    const applyCardSize = (width: number, height: number, preset: DeferralCardSizePresetId | 'custom') => {
        const clamped = clampCardSize(width, height);
        setCardSize(clamped);
        setSizePreset(preset);
        if (!scenarioId || !template) return;
        const normalized = normalizeCanvasElements(canvasElements, clamped.width, clamped.height);
        setCanvasElements(normalized);
        const next = templateWithCanvas(template, {
            width: clamped.width,
            height: clamped.height,
            elements: normalized,
        });
        setDeferralCards((prev) => patchDeferralScenario(prev, scenarioId, next));
    };

    const persistCanvas = (elements: DeferralCanvasElement[]) => {
        if (!scenarioId || !template) return;
        const normalized = normalizeCanvasElements(elements, cardSize.width, cardSize.height);
        setCanvasElements(normalized);
        const next = templateWithCanvas(template, {
            width: cardSize.width,
            height: cardSize.height,
            elements: normalized,
        });
        setDeferralCards((prev) => patchDeferralScenario(prev, scenarioId, next));
    };

    const handleMoveElement = (id: string, x: number, y: number) => {
        persistCanvas(canvasElements.map((e) => (e.id === id ? { ...e, x, y } : e)));
    };

    const handlePatchSelected = (patch: Partial<DeferralCanvasElement>) => {
        if (!selectedId) return;
        const snapped =
            patch.x !== undefined || patch.y !== undefined
                ? {
                      ...patch,
                      ...(patch.x !== undefined ? { x: snapCoord(patch.x) } : {}),
                      ...(patch.y !== undefined ? { y: snapCoord(patch.y) } : {}),
                  }
                : patch;
        persistCanvas(canvasElements.map((e) => (e.id === selectedId ? { ...e, ...snapped } : e)));
    };

    const handleAddBlock = (type: DeferralBlockType) => {
        const contentWidth = getCanvasContentWidth(cardSize.width);
        const maxY = canvasElements.reduce((m, e) => {
            const h = estimateCanvasElementSize(e, contentWidth).height;
            return Math.max(m, e.y + h);
        }, 0);
        persistCanvas([...canvasElements, createCanvasElement(type, snapCoord(maxY + 8), cardSize.width)]);
    };

    const handleRemoveSelected = () => {
        if (!selectedId) return;
        persistCanvas(canvasElements.filter((e) => e.id !== selectedId));
        setSelectedId(null);
    };

    const handleToggleLayerVisible = (id: string) => {
        persistCanvas(canvasElements.map((e) => (e.id === id ? { ...e, enabled: e.enabled === false } : e)));
    };

    const handleReorderLayers = (ordered: DeferralCanvasElement[]) => {
        persistCanvas(ordered);
    };

    const handleRestoreDefault = () => {
        if (!scenarioId) return;
        openConfirmDialog({
            title: t('panel.deferral_studio.restore_default_title'),
            message: t('panel.deferral_studio.restore_default_message'),
            actionLabel: t('panel.deferral_studio.restore_action'),
            confirmBtnVariant: 'destructive',
            onConfirm: () => {
                if (isAddonDeferralScenarioId(scenarioId)) {
                    txToast.error({
                        title: t('panel.deferral_studio.cannot_restore_title'),
                        msg: t('panel.deferral_studio.cannot_restore_msg'),
                    });
                    return;
                }
                const defaultTpl = structuredClone(DEFAULT_DEFERRAL_CARD_TEMPLATES[scenarioId as DeferralScenarioId]);
                const synced = syncLegacyFieldsFromLayout(defaultTpl);
                const canvas = getTemplateCanvas(synced);
                const height = resolveCanvasHeight(canvas);
                setDeferralCards((prev) => patchDeferralScenario(prev, scenarioId, synced));
                setCardSize({ width: canvas.width, height });
                setSizePreset(matchSizePreset(canvas.width, height));
                setCanvasElements(
                    loadStudioCanvasElements(
                        synced,
                        scenarioId,
                        PREVIEW_SAMPLE[scenarioId as DeferralScenarioId]?.body ?? '',
                    ),
                );
                setSelectedId(null);
                txToast.success({
                    title: t('panel.deferral_studio.default_restored_title'),
                    msg: t('panel.deferral_studio.default_restored_msg'),
                });
            },
        });
    };

    const handleSave = async () => {
        if (!scenarioId || !template || !workingTemplate) {
            txToast.error({
                title: t('panel.toasts.save_failed'),
                msg: t('panel.deferral_studio.save_failed_select_scenario'),
            });
            return;
        }
        if (!isCurrentDirty) return;

        setIsSaving(true);
        const label = scenarioLabel(scenarioId);
        const toastId = txToast.loading(t('panel.deferral_studio.saving_scenario', { label }), {
            id: 'deferralStudioSave',
        });
        const savedBefore = savedConfig;
        try {
            const baseTemplate = workingTemplate;
            const rasterizedElements = await rasterizeCanvasElements(canvasElements);
            const workingWithCanvas = patchDeferralScenario(deferralCards, scenarioId, {
                ...templateWithCanvas(template, {
                    width: cardSize.width,
                    height: cardSize.height,
                    elements: rasterizedElements,
                }),
            });
            const payload = buildDeferralCardsSavePayload(
                savedBefore,
                applySharedPlaceholdersToDeferralConfig(workingWithCanvas),
                {
                    scenarioId,
                    baseTemplate,
                    canvas: {
                        width: cardSize.width,
                        height: cardSize.height,
                        elements: rasterizedElements,
                    },
                },
            );
            const resp = await saveApi({
                pathParams: { card: 'deferral-cards' },
                data: { resetKeys: [], changes: { whitelist: { deferralCards: payload } } },
                timeout: ApiTimeout.LONG,
                toastId,
            });
            if (!resp) {
                txToast.error(
                    {
                        title: t('panel.toasts.save_failed'),
                        msg: t('panel.deferral_studio.save_failed_no_response'),
                    },
                    { id: toastId },
                );
                return;
            }
            if (resp.type === 'error') {
                txToast.error(
                    {
                        title: t('panel.toasts.save_failed'),
                        msg: typeof resp.msg === 'string' ? resp.msg : t('panel.deferral_studio.save_failed_rejected'),
                        md: resp.md,
                    },
                    { id: toastId },
                );
                return;
            }
            const mergedWorking = mergeDeferralCardsAfterScenarioSave(
                payload,
                workingWithCanvas,
                savedBefore,
                scenarioId,
            );
            setSavedConfig(payload);
            setDeferralCards(mergedWorking);
            setCanvasElements(normalizeCanvasElements(rasterizedElements, cardSize.width, cardSize.height));
            setEditorState((prev) => (prev ? { ...prev, deferralCards: mergedWorking } : prev));
            txToast.success(
                {
                    title: t('panel.deferral_studio.scenario_saved_title', { label }),
                    msg: t('panel.deferral_studio.scenario_saved_msg'),
                },
                { id: toastId },
            );
        } catch (error) {
            txToast.error({ title: t('panel.toasts.save_failed'), msg: emsg(error) }, { id: toastId });
        } finally {
            setIsSaving(false);
        }
    };

    const handleExportScenario = () => {
        if (!scenarioId) return;
        downloadJson(exportDeferralScenario(deferralCardsForFileOps, scenarioId), `deferral-${scenarioId}.json`);
        txToast.success({ title: t('panel.toasts.card_exported'), msg: scenarioId });
    };

    const handleExportAll = () => {
        downloadJson(exportDeferralCardsFull(deferralCardsForFileOps), 'deferral-cards-all.json');
        txToast.success({
            title: t('panel.toasts.card_exported'),
            msg: t('panel.deferral_studio.cards_exported_msg'),
        });
    };

    const handleImportFile = async (file: File) => {
        try {
            const result = importDeferralCardFile(deferralCardsForFileOps, JSON.parse(await file.text()), {
                installedAddonIds: addonDeferralMeta.installedAddonIds,
            });
            if (!result.ok) {
                txToast.error({ title: t('panel.toasts.import_failed'), msg: result.error });
                return;
            }
            const imported = normalizeDeferralCardsConfig(result.config);
            setDeferralCards(imported);
            setSavedConfig(canonicalDeferralCardsForDiff(imported));
            setEditorState((prev) => (prev ? { ...prev, deferralCards: imported } : prev));

            const allImported = [...result.importedScenarios, ...result.importedAddonScenarios];
            const targetScenario: string | null =
                allImported.length === 1
                    ? allImported[0]!
                    : scenarioId && allImported.includes(scenarioId)
                      ? scenarioId
                      : (allImported[0] ?? null);

            if (targetScenario) {
                loadScenarioIntoStudio(targetScenario, imported);
            }

            if (result.skippedAddonScenarios.length) {
                txToast.warning({
                    title: t('panel.deferral_studio.addon_cards_skipped_title'),
                    msg: result.skippedAddonScenarios.join(', '),
                });
            }

            txToast.success({
                title: t('panel.deferral_studio.imported_title'),
                msg: t('panel.deferral_studio.imported_scenarios_msg', {
                    count: result.importedScenarios.length,
                }),
            });
        } catch {
            txToast.error({
                title: t('panel.toasts.import_failed'),
                msg: t('panel.deferral_studio.invalid_json'),
            });
        }
    };

    if (!editorState) return null;

    const blankTemplate: DeferralCardTemplate = {
        title: '',
        bodyTemplate: '',
        showRequestId: true,
        showTierName: false,
        customPlaceholders: [],
    };

    return (
        <div className="max-h-contentvh flex h-full min-h-0 w-full flex-col gap-3">
            <PageHeader
                icon={<LayoutTemplateIcon />}
                title={t('panel.routes.deferral_studio')}
                parentName={t('panel.deferral_studio.parent_deferral_cards')}
                parentLink="/settings#deferral-cards"
            />

            <DeferralStudioToolbar
                scenarioId={scenarioId}
                addonScenarios={addonDeferralMeta.scenarios}
                onScenarioChange={handleSelectScenario}
                sizePreset={sizePreset}
                cardSize={cardSize}
                onSizePresetChange={setSizePreset}
                onApplyCardSize={applyCardSize}
                addableTypes={addableBlocksForScenario(scenarioId)}
                onAddBlock={handleAddBlock}
                showLogo={scenarioShowLogo}
                onShowLogoChange={handleShowLogoChange}
                studioPrefs={studioPrefs}
                onStudioPrefsChange={updateStudioPrefs}
                onExportAll={handleExportAll}
                onExportScenario={handleExportScenario}
                onImport={() => importInputRef.current?.click()}
                onRestoreDefault={handleRestoreDefault}
                onSave={handleSave}
                isSaving={isSaving}
                isCurrentDirty={isCurrentDirty}
                dirtyScenarioIds={dirtyScenarioIds}
                onBack={() => confirmLeaveStudio(() => navigate('/settings#deferral-cards'))}
            />

            <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void handleImportFile(file);
                }}
            />

            <div className="shell-xl:flex-row flex min-h-0 flex-1 flex-col gap-3">
                {scenarioId ? (
                    <aside className="bg-card shell-xl:w-44 shell-2xl:w-48 flex w-full shrink-0 flex-col overflow-hidden rounded-xl border">
                        <div className="border-border/60 text-foreground shrink-0 border-b px-3 py-2 text-xs font-semibold tracking-wide uppercase">
                            {t('panel.deferral_studio.layers_heading')}
                        </div>
                        <ScrollArea className="min-h-0 flex-1">
                            <div className="p-2">
                                <DeferralStudioLayers
                                    elements={canvasElements}
                                    selectedId={selectedId}
                                    onSelect={setSelectedId}
                                    onToggleVisible={handleToggleLayerVisible}
                                    onReorder={handleReorderLayers}
                                />
                            </div>
                        </ScrollArea>
                    </aside>
                ) : null}

                {workingTemplate && scenarioId ? (
                    <DeferralStudioCanvas
                        cardWidth={cardSize.width}
                        cardHeight={cardSize.height}
                        elements={canvasElements}
                        selectedId={selectedId}
                        showLogo={scenarioShowLogo}
                        showGrid={studioPrefs.showGrid}
                        snapToGrid={studioPrefs.snapToGrid}
                        template={workingTemplate}
                        tokens={previewTokens}
                        isBlank={false}
                        onSelect={setSelectedId}
                        onMoveElement={handleMoveElement}
                    />
                ) : (
                    <DeferralStudioCanvas
                        cardWidth={cardSize.width}
                        cardHeight={cardSize.height}
                        elements={[]}
                        selectedId={null}
                        showLogo={scenarioShowLogo}
                        showGrid={studioPrefs.showGrid}
                        snapToGrid={studioPrefs.snapToGrid}
                        template={blankTemplate}
                        tokens={{}}
                        isBlank
                        onSelect={setSelectedId}
                        onMoveElement={() => {}}
                    />
                )}

                <aside className="bg-card shell-xl:w-64 shell-2xl:w-72 flex w-full shrink-0 flex-col overflow-hidden rounded-xl border">
                    <ScrollArea className="min-h-0 flex-1">
                        <div className="space-y-4 p-4">
                            {selected ? (
                                <>
                                    <div className="flex items-center justify-between">
                                        <p className="text-foreground text-sm font-medium">
                                            {deferralBlockLabel(t, selected.type)}
                                        </p>
                                        <Button
                                            type="button"
                                            size="icon"
                                            variant="ghost"
                                            onClick={handleRemoveSelected}
                                        >
                                            <Trash2 className="size-4" />
                                        </Button>
                                    </div>
                                    {(selected.type === 'heading' ||
                                        selected.type === 'paragraph' ||
                                        selected.type === 'text' ||
                                        selected.type === 'custom_text') && (
                                        <AutosizeTextarea
                                            value={selected.content ?? ''}
                                            onChange={(e) => handlePatchSelected({ content: e.target.value })}
                                            minHeight={selected.type === 'custom_text' ? 120 : 88}
                                            maxHeight={280}
                                            placeholder={
                                                selected.type === 'custom_text'
                                                    ? t('panel.deferral_studio.custom_text_placeholder')
                                                    : undefined
                                            }
                                        />
                                    )}
                                    {selected.type === 'button' ? (
                                        <DeferralButtonEditor
                                            content={selected.content}
                                            onChange={(serialized) => handlePatchSelected({ content: serialized })}
                                        />
                                    ) : null}
                                    {selected.type === 'custom_image' ? (
                                        <div className="space-y-2">
                                            <input
                                                ref={svgUploadInputRef}
                                                type="file"
                                                accept=".svg,image/svg+xml,.png,image/png,.gif,image/gif"
                                                className="hidden"
                                                onChange={async (e) => {
                                                    const file = e.target.files?.[0];
                                                    e.target.value = '';
                                                    if (!file) return;
                                                    const result = await readDeferralImageFile(file);
                                                    if (!result.ok) {
                                                        txToast.error({
                                                            title: t('panel.deferral_studio.image_upload_failed'),
                                                            msg: result.error,
                                                        });
                                                        return;
                                                    }
                                                    handlePatchSelected({ content: result.content });
                                                }}
                                            />
                                            {deferralCustomImageHasPreview(selected.content) ? (
                                                <div className="bg-muted/30 flex max-h-32 items-center justify-center rounded-md border p-3">
                                                    <DeferralStudioAnimatedImage
                                                        src={selected.content ?? ''}
                                                        alt={t('panel.deferral_studio.image_preview_alt')}
                                                        className="max-h-28 max-w-full object-contain"
                                                    />
                                                </div>
                                            ) : (
                                                <p className="text-muted-foreground text-xs">
                                                    {t('panel.deferral_studio.no_image_yet', {
                                                        svgKb: Math.round(DEFERRAL_SVG_MAX_BYTES / 1024),
                                                        pngKb: Math.round(DEFERRAL_PNG_MAX_BYTES / 1024),
                                                    })}
                                                </p>
                                            )}
                                            <div className="flex flex-wrap gap-2">
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="secondary"
                                                    onClick={() => svgUploadInputRef.current?.click()}
                                                >
                                                    <ImageIcon className="mr-1.5 size-4" />
                                                    {t('panel.deferral_studio.upload_image')}
                                                </Button>
                                                {selected.content ? (
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => handlePatchSelected({ content: '' })}
                                                    >
                                                        {t('panel.common.remove')}
                                                    </Button>
                                                ) : null}
                                            </div>
                                        </div>
                                    ) : null}
                                    {selected.type === 'logo' ? (
                                        <>
                                            <p className="text-muted-foreground text-xs leading-relaxed">
                                                {t('panel.deferral_studio.logo_drag_hint')}
                                            </p>
                                            <div className="grid grid-cols-2 gap-2">
                                                <div>
                                                    <label className="text-foreground mb-1 block text-xs font-medium">
                                                        {t('panel.deferral_studio.coord_x')}
                                                    </label>
                                                    <Input
                                                        type="number"
                                                        step={8}
                                                        value={Math.round(selected.x)}
                                                        onChange={(e) =>
                                                            handlePatchSelected({ x: Number(e.target.value) || 0 })
                                                        }
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-foreground mb-1 block text-xs font-medium">
                                                        {t('panel.deferral_studio.coord_y')}
                                                    </label>
                                                    <Input
                                                        type="number"
                                                        step={8}
                                                        value={Math.round(selected.y)}
                                                        onChange={(e) =>
                                                            handlePatchSelected({ y: Number(e.target.value) || 0 })
                                                        }
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-foreground mb-1 block text-xs font-medium">
                                                        {t('panel.deferral_studio.width')}
                                                    </label>
                                                    <Input
                                                        type="number"
                                                        min={24}
                                                        max={DEFERRAL_WATERMARK_MAX_WIDTH_PX}
                                                        value={Math.round(
                                                            selected.width ?? DEFERRAL_WATERMARK_MAX_WIDTH_PX,
                                                        )}
                                                        onChange={(e) =>
                                                            handlePatchSelected({
                                                                width: Math.min(
                                                                    DEFERRAL_WATERMARK_MAX_WIDTH_PX,
                                                                    Math.max(24, Number(e.target.value) || 24),
                                                                ),
                                                            })
                                                        }
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-foreground mb-1 block text-xs font-medium">
                                                        {t('panel.deferral_studio.height')}
                                                    </label>
                                                    <Input
                                                        type="number"
                                                        min={16}
                                                        max={DEFERRAL_WATERMARK_MAX_HEIGHT_PX}
                                                        value={Math.round(
                                                            selected.height ?? DEFERRAL_WATERMARK_MAX_HEIGHT_PX,
                                                        )}
                                                        onChange={(e) =>
                                                            handlePatchSelected({
                                                                height: Math.min(
                                                                    DEFERRAL_WATERMARK_MAX_HEIGHT_PX,
                                                                    Math.max(16, Number(e.target.value) || 16),
                                                                ),
                                                            })
                                                        }
                                                    />
                                                </div>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <label className="text-foreground mb-1 block text-xs font-medium">
                                                    {t('panel.deferral_studio.coord_x')}
                                                </label>
                                                <Input
                                                    type="number"
                                                    step={8}
                                                    value={Math.round(selected.x)}
                                                    onChange={(e) =>
                                                        handlePatchSelected({ x: Number(e.target.value) || 0 })
                                                    }
                                                />
                                            </div>
                                            <div>
                                                <label className="text-foreground mb-1 block text-xs font-medium">
                                                    {t('panel.deferral_studio.coord_y')}
                                                </label>
                                                <Input
                                                    type="number"
                                                    step={8}
                                                    value={Math.round(selected.y)}
                                                    onChange={(e) =>
                                                        handlePatchSelected({ y: Number(e.target.value) || 0 })
                                                    }
                                                />
                                            </div>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <p className="text-muted-foreground text-sm leading-relaxed">
                                    {t('panel.deferral_studio.select_element_hint')}
                                </p>
                            )}

                            <p className="text-muted-foreground border-t pt-4 text-xs leading-relaxed">
                                {t('panel.deferral_studio.custom_placeholders_footer')}{' '}
                                <TxAnchor href="/settings#deferral-cards">
                                    {t('panel.deferral_studio.custom_placeholders_footer_link')}
                                </TxAnchor>{' '}
                                {t('panel.deferral_studio.custom_placeholders_footer_suffix')}
                            </p>
                        </div>
                    </ScrollArea>
                </aside>
            </div>
        </div>
    );
}

function matchSizePreset(width: number, height: number): DeferralCardSizePresetId | 'custom' {
    for (const [id, preset] of Object.entries(DEFERRAL_CARD_SIZE_PRESETS)) {
        if (preset.width === width && preset.height === height) {
            return id as DeferralCardSizePresetId;
        }
    }
    return 'custom';
}

function downloadJson(payload: unknown, filename: string) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
