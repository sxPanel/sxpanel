import { useState, useEffect, useRef, useCallback, type RefObject } from 'react';
import { useBackendApi, ApiTimeout } from '@/hooks/fetch';
import { useOpenConfirmDialog } from '@/hooks/dialogs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useLocale } from '@/hooks/locale';
import { txToast } from '@/components/TxToaster';
import { cn } from '@/lib/utils';
import {
    Loader2Icon,
    DownloadIcon,
    RotateCcwIcon,
    RotateCwIcon,
    AlertTriangleIcon,
    CheckCircle2Icon,
    ExternalLinkIcon,
    PackageIcon,
} from 'lucide-react';
import type { ArtifactListResp, ArtifactTierInfo } from '@shared/otherTypes';
import type { ApiToastResp } from '@shared/genericApiTypes';
import { emsg } from '@shared/emsg';

const tierLabels: Record<ArtifactTierInfo['tier'], { label: string; desc: string }> = {
    latest: { label: 'Latest', desc: 'Newest available build' },
    recommended: { label: 'Recommended', desc: 'Stable and tested' },
    optional: { label: 'Optional', desc: 'Minor fixes and improvements' },
    critical: { label: 'Critical', desc: 'Minimum safe version' },
};

const PHASE_LABELS: Record<string, string> = {
    downloading: 'Downloading artifact',
    extracting: 'Extracting archive',
    extracted: 'Ready to apply',
    applying: 'Applying update',
};

function HeaderBand({
    title,
    currentVersion,
    isBusy,
    isRefreshing,
    onRefresh,
}: {
    title: string;
    currentVersion?: string;
    isBusy: boolean;
    isRefreshing: boolean;
    onRefresh: () => void;
}) {
    return (
        <div className="border-border/60 bg-background rounded-xl border">
            <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                    <div className="bg-secondary/50 text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-xl">
                        <PackageIcon className="size-5" />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-foreground text-lg font-semibold tracking-tight">{title}</h1>
                        <p className="text-muted-foreground mt-0.5 text-xs">
                            Manage FXServer runtime builds and apply safe updates.
                        </p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="border-border/50 bg-secondary/40 inline-flex items-center gap-2 rounded-full border px-3 py-1.5">
                        <span className="text-muted-foreground/70 text-[11px] font-semibold tracking-wider uppercase">
                            Current
                        </span>
                        <span className="text-foreground font-mono text-sm font-semibold">{currentVersion ?? '—'}</span>
                    </div>
                    <div
                        className={cn(
                            'inline-flex items-center gap-2 rounded-full border px-3 py-1.5',
                            isBusy ? 'border-warning/40 bg-warning/10' : 'border-success/40 bg-success/10',
                        )}
                    >
                        <span
                            className={cn(
                                'inline-flex size-1.5 rounded-full',
                                isBusy ? 'bg-warning animate-pulse' : 'bg-success',
                            )}
                            aria-hidden="true"
                        />
                        <span className="text-muted-foreground/70 text-[11px] font-semibold tracking-wider uppercase">
                            {isBusy ? 'Updating' : 'Ready'}
                        </span>
                    </div>
                    <div className="bg-border/60 mx-1 hidden h-6 w-px sm:block" aria-hidden="true" />
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onRefresh}
                        disabled={isRefreshing}
                        aria-label="Refresh artifact status"
                    >
                        {isRefreshing ? (
                            <Loader2Icon className="size-4 animate-spin" />
                        ) : (
                            <RotateCwIcon className="size-4" />
                        )}
                    </Button>
                </div>
            </div>
        </div>
    );
}

function StatusSection({
    data,
    onApply,
    onReset,
}: {
    data: ArtifactListResp;
    onApply: () => void;
    onReset: () => void;
}) {
    const { updateStatus } = data;
    if (updateStatus.phase === 'idle') return null;

    const statusLabel = PHASE_LABELS[updateStatus.phase] || 'Update failed';

    return (
        <Card className="border-border/60 bg-background rounded-xl shadow-none">
            <CardHeader className="pb-3">
                <CardTitle className="text-lg">Update Progress</CardTitle>
                <CardDescription className="flex items-center gap-2">
                    <span
                        className={cn(
                            'inline-flex size-2 rounded-full',
                            updateStatus.phase === 'error'
                                ? 'bg-destructive'
                                : updateStatus.phase === 'extracted'
                                  ? 'bg-success'
                                  : 'bg-primary animate-pulse',
                        )}
                    />
                    {statusLabel}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
                {updateStatus.phase === 'downloading' && (
                    <div className="space-y-2.5">
                        <div className="text-muted-foreground flex items-center gap-2 text-sm">
                            <Loader2Icon className="size-4 animate-spin" />
                            Downloading… {updateStatus.percentage}%
                        </div>
                        <div
                            className="bg-muted/70 border-border/40 h-2.5 w-full overflow-hidden rounded-full border"
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={updateStatus.percentage}
                            aria-label={`Downloading: ${updateStatus.percentage}%`}
                        >
                            <div
                                className="bg-primary h-full rounded-full transition-all duration-300"
                                style={{ width: `${updateStatus.percentage}%` }}
                            />
                        </div>
                    </div>
                )}
                {updateStatus.phase === 'extracting' && (
                    <div className="text-muted-foreground flex items-center gap-2 text-sm">
                        <Loader2Icon className="size-4 animate-spin" />
                        Extracting archive…
                    </div>
                )}
                {updateStatus.phase === 'extracted' && (
                    <>
                        <Alert>
                            <CheckCircle2Icon className="size-4" />
                            <AlertTitle>Download Complete</AlertTitle>
                            <AlertDescription>
                                The artifact has been downloaded and extracted. Click &quot;Apply &amp; Restart&quot; to
                                install it.
                            </AlertDescription>
                        </Alert>
                        <Button variant="warning" className="w-full sm:w-auto" onClick={onApply}>
                            <RotateCcwIcon className="mr-2 size-4" />
                            Apply &amp; Restart
                        </Button>
                    </>
                )}
                {updateStatus.phase === 'applying' && (
                    <Alert>
                        <Loader2Icon className="size-4 animate-spin" />
                        <AlertTitle>Applying Update</AlertTitle>
                        <AlertDescription>
                            The server is being updated and will restart momentarily. This page will become
                            unresponsive.
                        </AlertDescription>
                    </Alert>
                )}
                {updateStatus.phase === 'error' && (
                    <>
                        <Alert variant="destructive">
                            <AlertTriangleIcon className="size-4" />
                            <AlertTitle>Error</AlertTitle>
                            <AlertDescription>{updateStatus.message}</AlertDescription>
                        </Alert>
                        <Button variant="outline" className="w-full sm:w-auto" onClick={onReset}>
                            Dismiss
                        </Button>
                    </>
                )}
            </CardContent>
        </Card>
    );
}

function CurrentBuildSection({
    currentVersion,
    currentVersionTag,
    updateStatus,
    selectedTier,
}: {
    currentVersion: ArtifactListResp['currentVersion'];
    currentVersionTag: ArtifactListResp['currentVersionTag'];
    updateStatus: ArtifactListResp['updateStatus'];
    selectedTier?: ArtifactTierInfo;
}) {
    const isBusy =
        updateStatus.phase !== 'idle' && updateStatus.phase !== 'error' && updateStatus.phase !== 'extracted';

    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="border-border/60 bg-background rounded-xl shadow-none lg:col-span-2">
                <CardHeader className="pb-3">
                    <CardTitle className="text-lg">Current Build</CardTitle>
                    <CardDescription>Installed artifact version on this host</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-wrap items-center gap-3">
                        <span className="font-mono text-3xl leading-none font-bold tabular-nums">{currentVersion}</span>
                        <Badge variant="secondary" className="font-mono">
                            {currentVersionTag}
                        </Badge>
                        {selectedTier && (
                            <Badge variant="outline" className="capitalize">
                                {selectedTier.tier}
                            </Badge>
                        )}
                    </div>
                </CardContent>
            </Card>

            <Card className="border-border/60 bg-background rounded-xl shadow-none">
                <CardHeader className="pb-3">
                    <CardTitle className="text-lg">Update State</CardTitle>
                    <CardDescription>Live status from updater daemon</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="border-border/50 bg-secondary/40 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                        <span
                            className={cn(
                                'inline-flex size-2 rounded-full',
                                updateStatus.phase === 'error'
                                    ? 'bg-destructive'
                                    : isBusy
                                      ? 'bg-warning animate-pulse'
                                      : 'bg-success',
                            )}
                        />
                        <span className="capitalize">{updateStatus.phase}</span>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

function AvailableBuildsCard({
    tiers,
    currentVersion,
    minCompatibleVersion,
    isBusy,
    onDownload,
    fullWidth,
}: {
    tiers: ArtifactTierInfo[];
    currentVersion: ArtifactListResp['currentVersion'];
    minCompatibleVersion: ArtifactListResp['minCompatibleVersion'];
    isBusy: boolean;
    onDownload: (url: string, version: string) => void;
    fullWidth?: boolean;
}) {
    return (
        <Card
            className={cn(
                'border-border/60 bg-background rounded-xl shadow-none',
                fullWidth ? 'xl:col-span-3' : 'xl:col-span-2',
            )}
        >
            <CardHeader>
                <CardTitle className="text-lg">Available Builds</CardTitle>
                <CardDescription>Select an artifact tier and download the matching build</CardDescription>
            </CardHeader>
            <CardContent>
                {tiers.length === 0 ? (
                    <div className="text-muted-foreground flex flex-col items-center gap-3 py-8">
                        <div className="bg-secondary/50 flex size-12 items-center justify-center rounded-xl">
                            <PackageIcon className="size-6" />
                        </div>
                        <p className="text-sm font-medium">Could not fetch available builds</p>
                        <p className="text-muted-foreground/70 text-xs">Try refreshing the page.</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {tiers.map((tier) => {
                            const info = tierLabels[tier.tier] ?? { label: tier.tier, desc: 'Unknown tier' };
                            const isCurrent = tier.version === currentVersion;
                            const isIncompatible = tier.version < minCompatibleVersion;
                            return (
                                <div
                                    key={tier.tier}
                                    className={cn(
                                        'bg-background rounded-xl border p-3 sm:p-4',
                                        isCurrent ? 'border-success/40 bg-success/5' : 'border-border/60',
                                        isIncompatible && 'opacity-60',
                                    )}
                                >
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="min-w-0 space-y-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="font-semibold tracking-tight">{info.label}</span>
                                                <Badge variant="outline" className="font-mono text-xs">
                                                    #{tier.version}
                                                </Badge>
                                                {isCurrent ? (
                                                    <Badge variant="secondary" className="text-xs">
                                                        Current
                                                    </Badge>
                                                ) : null}
                                                {isIncompatible ? (
                                                    <Badge variant="destructive" className="text-xs">
                                                        Incompatible
                                                    </Badge>
                                                ) : null}
                                            </div>
                                            <p className="text-muted-foreground text-xs sm:text-sm">
                                                {isIncompatible
                                                    ? `Below the minimum build supported by sxPanel (#${minCompatibleVersion})`
                                                    : info.desc}
                                            </p>
                                        </div>
                                        <Button
                                            size="sm"
                                            variant={isCurrent ? 'muted' : 'default'}
                                            disabled={isBusy || isIncompatible}
                                            onClick={() => onDownload(tier.downloadUrl, tier.version.toString())}
                                            className="w-full sm:w-auto"
                                        >
                                            <DownloadIcon className="mr-1.5 size-3.5" />
                                            Download
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function CustomDownloadCard({
    inputRef,
    isBusy,
    onDownload,
}: {
    inputRef: RefObject<HTMLInputElement | null>;
    isBusy: boolean;
    onDownload: () => void;
}) {
    return (
        <Card className="border-border/60 bg-background rounded-xl shadow-none">
            <CardHeader>
                <CardTitle className="text-lg">Custom URL</CardTitle>
                <CardDescription>Paste a direct runtime link to download any supported artifact build.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="flex flex-col gap-2">
                    <Input
                        ref={inputRef}
                        placeholder="https://runtime.fivem.net/artifacts/fivem/…"
                        disabled={isBusy}
                        aria-label="Custom artifact download URL"
                    />
                    <Button disabled={isBusy} onClick={onDownload} className="w-full">
                        <DownloadIcon className="mr-2 size-4" />
                        Download from URL
                    </Button>
                </div>
                <div className="flex flex-col gap-y-1.5 pt-1">
                    <a
                        href="https://runtime.fivem.net/artifacts/fivem/build_server_windows/master/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent inline-flex items-center gap-1 text-xs hover:underline"
                    >
                        FiveM Artifacts <ExternalLinkIcon className="size-3" />
                    </a>
                    <a
                        href="https://runtime.fivem.net/artifacts/fivem/build_proot_linux/master/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent inline-flex items-center gap-1 text-xs hover:underline"
                    >
                        FiveM Linux Artifacts <ExternalLinkIcon className="size-3" />
                    </a>
                </div>
            </CardContent>
        </Card>
    );
}

/**
 * FxUpdater V2 — redesign goals over V1:
 * - V2 header band (icon tile + version/status pills + manual refresh)
 *   replacing PageHeader; V1 had no way to refresh without reloading.
 * - Structured loading and error states (card-styled with retry) instead
 *   of a bare spinner / Alert.
 * - Cards normalized to the flat `rounded-xl border-border/60 bg-background`
 *   language (matching the player sidebar), with token-based hint surfaces.
 */
export default function FxUpdaterPage() {
    const { t } = useLocale();
    const [data, setData] = useState<ArtifactListResp | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const customUrlRef = useRef<HTMLInputElement>(null);
    const openConfirmDialog = useOpenConfirmDialog();

    const listApi = useBackendApi<ArtifactListResp>({
        method: 'GET',
        path: '/fxserver/artifacts',
    });
    const downloadApi = useBackendApi<ApiToastResp, { url: string; version: string }>({
        method: 'POST',
        path: '/fxserver/artifacts/download',
    });
    const applyApi = useBackendApi<ApiToastResp>({
        method: 'POST',
        path: '/fxserver/artifacts/apply',
    });

    const fetchStatus = useCallback(async () => {
        try {
            const resp = await listApi({ timeout: ApiTimeout.LONG });
            if (resp) {
                setData(resp);
                setFetchError(null);
            }
        } catch (e) {
            setFetchError(emsg(e));
        } finally {
            setIsLoading(false);
        }
    }, [listApi]);

    const handleManualRefresh = useCallback(async () => {
        setIsRefreshing(true);
        await fetchStatus();
        setIsRefreshing(false);
    }, [fetchStatus]);

    //Poll every 2s while downloading/applying, 30s otherwise
    const hasInitialFetchRef = useRef(true);
    useEffect(() => {
        const currentPhase = data?.updateStatus.phase;

        // Only fetch immediately on the initial mount
        if (hasInitialFetchRef.current) {
            hasInitialFetchRef.current = false;
            fetchStatus();
        }

        const interval = setInterval(
            () => {
                fetchStatus();
            },
            currentPhase === 'downloading' || currentPhase === 'extracting' || currentPhase === 'applying'
                ? 2000
                : 30000,
        );
        return () => clearInterval(interval);
    }, [fetchStatus, data?.updateStatus.phase]);

    const handleDownload = (url: string, version: string) => {
        downloadApi({
            data: { url, version },
            toastLoadingMessage: 'Starting download…',
        });
        //Optimistically show downloading state so UI updates immediately
        setData((prev) => (prev ? { ...prev, updateStatus: { phase: 'downloading', percentage: 0 } } : prev));
    };

    const handleCustomDownload = () => {
        const url = customUrlRef.current?.value?.trim();
        if (!url) {
            txToast.error('Please enter a URL');
            return;
        }
        const ALLOWED_DOWNLOAD_DOMAINS = ['runtime.fivem.net'];
        try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'https:') throw new Error('not https');
            if (!ALLOWED_DOWNLOAD_DOMAINS.includes(parsed.hostname)) {
                txToast.error(
                    `Please enter a valid https URL from an allowed domain (${ALLOWED_DOWNLOAD_DOMAINS.join(', ')})`,
                );
                return;
            }
        } catch {
            txToast.error('Please enter a valid https URL');
            return;
        }
        handleDownload(url, 'custom');
    };

    const handleApply = () => {
        openConfirmDialog({
            title: 'Apply Artifact Update',
            message:
                'This will stop the game server, replace the artifact files, and restart the entire sxPanel process. Make sure you have warned your players. Continue?',
            confirmBtnVariant: 'warning',
            onConfirm: () => {
                applyApi({
                    toastLoadingMessage: 'Applying update…',
                    timeout: ApiTimeout.REALLY_REALLY_LONG,
                });
            },
        });
    };

    const handleReset = () => {
        setData((prev) => (prev ? { ...prev, updateStatus: { phase: 'idle' } } : prev));
    };

    if (!data) {
        return (
            <div className="mx-auto w-full max-w-5xl space-y-4">
                <HeaderBand
                    title={t('panel.routes.artifacts')}
                    isBusy={false}
                    isRefreshing={isRefreshing}
                    onRefresh={handleManualRefresh}
                />
                {isLoading ? (
                    <div className="border-border/60 bg-background flex h-48 flex-col items-center justify-center gap-3 rounded-xl border">
                        <Loader2Icon className="text-muted-foreground size-6 animate-spin" />
                        <p className="text-muted-foreground text-sm">Loading artifact data…</p>
                    </div>
                ) : fetchError ? (
                    <div className="border-destructive/30 bg-destructive/5 flex h-48 flex-col items-center justify-center gap-3 rounded-xl border">
                        <AlertTriangleIcon className="text-destructive-inline size-6" />
                        <p className="text-foreground text-sm font-medium">Failed to load artifact data</p>
                        <p className="text-muted-foreground max-w-md text-center text-xs">{fetchError}</p>
                        <Button variant="outline" size="sm" onClick={handleManualRefresh}>
                            <RotateCwIcon className="mr-1.5 size-4" />
                            Retry
                        </Button>
                    </div>
                ) : null}
            </div>
        );
    }

    const { currentVersion, currentVersionTag, minCompatibleVersion, tiers, updateStatus, customDownloadEnabled } =
        data;
    const isBusy =
        updateStatus.phase !== 'idle' && updateStatus.phase !== 'error' && updateStatus.phase !== 'extracted';
    const selectedTier = tiers.find((t) => t.version === currentVersion);

    return (
        <div className="mx-auto w-full max-w-5xl space-y-4">
            <HeaderBand
                title={t('panel.routes.artifacts')}
                currentVersion={String(currentVersion)}
                isBusy={isBusy}
                isRefreshing={isRefreshing}
                onRefresh={handleManualRefresh}
            />

            {!customDownloadEnabled ? (
                <div className="border-border/50 bg-secondary/40 text-muted-foreground rounded-lg border px-3 py-2 text-sm">
                    {window.txConsts.hostConfigSource}: Custom artifact URLs are disabled by the host.
                </div>
            ) : null}

            <CurrentBuildSection
                currentVersion={currentVersion}
                currentVersionTag={currentVersionTag}
                updateStatus={updateStatus}
                selectedTier={selectedTier}
            />

            {/* Download/Apply Status */}
            <StatusSection data={data} onApply={handleApply} onReset={handleReset} />

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <AvailableBuildsCard
                    tiers={tiers}
                    currentVersion={currentVersion}
                    minCompatibleVersion={minCompatibleVersion}
                    isBusy={isBusy}
                    onDownload={handleDownload}
                    fullWidth={!customDownloadEnabled}
                />
                {customDownloadEnabled ? (
                    <CustomDownloadCard inputRef={customUrlRef} isBusy={isBusy} onDownload={handleCustomDownload} />
                ) : null}
            </div>
        </div>
    );
}
