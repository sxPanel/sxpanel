import { useState, useEffect, useCallback, useRef } from 'react';
import { useBackendApi, ApiTimeout } from '@/hooks/fetch';
import { useOpenConfirmDialog } from '@/hooks/dialogs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
    Loader2Icon,
    DownloadIcon,
    RotateCcwIcon,
    RotateCwIcon,
    AlertTriangleIcon,
    CheckCircle2Icon,
    ExternalLinkIcon,
    SparklesIcon,
} from 'lucide-react';
import type { PanelUpdateListResp } from '@shared/otherTypes';
import type { ApiToastResp } from '@shared/genericApiTypes';
import { emsg } from '@shared/emsg';

const PHASE_LABELS: Record<string, string> = {
    downloading: 'Downloading update',
    extracting: 'Extracting archive',
    extracted: 'Ready to apply',
    applying: 'Applying update',
};

function HeaderBand({
    currentVersion,
    isBusy,
    isRefreshing,
    onRefresh,
}: {
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
                        <SparklesIcon className="size-5" />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-foreground text-lg font-semibold tracking-tight">sxPanel Update</h1>
                        <p className="text-muted-foreground mt-0.5 text-xs">
                            Check for and apply new sxPanel (monitor resource) releases.
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
                        aria-label="Refresh update status"
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
    data: PanelUpdateListResp;
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
                                The update has been downloaded and verified. Click &quot;Apply &amp; Restart&quot; to
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

function AvailableUpdateCard({
    data,
    isBusy,
    onDownload,
}: {
    data: PanelUpdateListResp;
    isBusy: boolean;
    onDownload: () => void;
}) {
    const { currentVersion, latestRelease } = data;

    if (!latestRelease) {
        return (
            <Card className="border-border/60 bg-background rounded-xl shadow-none">
                <CardHeader>
                    <CardTitle className="text-lg">Available Update</CardTitle>
                    <CardDescription>Latest release information from GitHub</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="text-muted-foreground flex flex-col items-center gap-3 py-8">
                        <div className="bg-secondary/50 flex size-12 items-center justify-center rounded-xl">
                            <SparklesIcon className="size-6" />
                        </div>
                        <p className="text-sm font-medium">Could not fetch release information</p>
                        <p className="text-muted-foreground/70 text-xs">
                            Try refreshing, or check your connection to GitHub.
                        </p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="border-border/60 bg-background rounded-xl shadow-none">
            <CardHeader>
                <CardTitle className="text-lg">Available Update</CardTitle>
                <CardDescription>Latest release published on GitHub</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-3xl leading-none font-bold tabular-nums">
                        {latestRelease.version}
                    </span>
                    {latestRelease.isPrerelease && (
                        <Badge variant="outline" className="text-xs">
                            Prerelease
                        </Badge>
                    )}
                    {latestRelease.version === currentVersion ? (
                        <Badge variant="secondary" className="text-xs">
                            Current
                        </Badge>
                    ) : latestRelease.isOutdated ? (
                        <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning text-xs">
                            Update available
                        </Badge>
                    ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button disabled={isBusy || !latestRelease.isOutdated} onClick={onDownload}>
                        <DownloadIcon className="mr-2 size-4" />
                        Download &amp; Verify
                    </Button>
                    <a
                        href={latestRelease.releaseUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent inline-flex items-center gap-1 text-xs hover:underline"
                    >
                        View release notes <ExternalLinkIcon className="size-3" />
                    </a>
                </div>
            </CardContent>
        </Card>
    );
}

export default function SelfUpdaterPage() {
    const [data, setData] = useState<PanelUpdateListResp | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const openConfirmDialog = useOpenConfirmDialog();

    const statusApi = useBackendApi<PanelUpdateListResp>({
        method: 'GET',
        path: '/panel/update',
    });
    const downloadApi = useBackendApi<ApiToastResp>({
        method: 'POST',
        path: '/panel/update/download',
    });
    const applyApi = useBackendApi<ApiToastResp>({
        method: 'POST',
        path: '/panel/update/apply',
    });

    const fetchStatus = useCallback(async () => {
        try {
            const resp = await statusApi({ timeout: ApiTimeout.LONG });
            if (resp) {
                setData(resp);
                setFetchError(null);
            }
        } catch (e) {
            setFetchError(emsg(e));
        } finally {
            setIsLoading(false);
        }
    }, [statusApi]);

    const handleManualRefresh = useCallback(async () => {
        setIsRefreshing(true);
        await fetchStatus();
        setIsRefreshing(false);
    }, [fetchStatus]);

    //Poll every 2s while downloading/applying, 30s otherwise
    const hasInitialFetchRef = useRef(true);
    useEffect(() => {
        const currentPhase = data?.updateStatus.phase;

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

    const handleDownload = () => {
        downloadApi({ toastLoadingMessage: 'Starting download…' });
        setData((prev) => (prev ? { ...prev, updateStatus: { phase: 'downloading', percentage: 0 } } : prev));
    };

    const handleApply = () => {
        openConfirmDialog({
            title: 'Apply sxPanel Update',
            message:
                'This will stop the game server, replace the sxPanel files, and restart the entire process. Make sure you have warned your players. Continue?',
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
                <HeaderBand isBusy={false} isRefreshing={isRefreshing} onRefresh={handleManualRefresh} />
                {isLoading ? (
                    <div className="border-border/60 bg-background flex h-48 flex-col items-center justify-center gap-3 rounded-xl border">
                        <Loader2Icon className="text-muted-foreground size-6 animate-spin" />
                        <p className="text-muted-foreground text-sm">Loading update data…</p>
                    </div>
                ) : fetchError ? (
                    <div className="border-destructive/30 bg-destructive/5 flex h-48 flex-col items-center justify-center gap-3 rounded-xl border">
                        <AlertTriangleIcon className="text-destructive-inline size-6" />
                        <p className="text-foreground text-sm font-medium">Failed to load update data</p>
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

    const { currentVersion, updateStatus } = data;
    const isBusy =
        updateStatus.phase !== 'idle' && updateStatus.phase !== 'error' && updateStatus.phase !== 'extracted';

    return (
        <div className="mx-auto w-full max-w-5xl space-y-4">
            <HeaderBand
                currentVersion={currentVersion}
                isBusy={isBusy}
                isRefreshing={isRefreshing}
                onRefresh={handleManualRefresh}
            />

            <StatusSection data={data} onApply={handleApply} onReset={handleReset} />

            <AvailableUpdateCard data={data} isBusy={isBusy} onDownload={handleDownload} />
        </div>
    );
}
