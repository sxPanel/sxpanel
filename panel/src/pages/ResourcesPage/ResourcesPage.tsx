import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import useSWR from 'swr';
import {
    FolderIcon,
    SearchIcon,
    RefreshCwIcon,
    PlayIcon,
    SquareIcon,
    RotateCwIcon,
    PackageIcon,
    Loader2Icon,
    AlertCircleIcon,
    ChevronDownIcon,
    ChevronRightIcon,
    ChevronsDownUpIcon,
    ChevronsUpDownIcon,
    CpuIcon,
    MemoryStickIcon,
    TimerIcon,
    DownloadIcon,
    XIcon,
    FilterXIcon,
    ArrowUpCircleIcon,
} from 'lucide-react';
import { useBackendApi, ApiTimeout } from '@/hooks/fetch';
import { txToast } from '@/components/TxToaster';
import { useLocale } from '@/hooks/locale';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAdminPerms, useCsrfToken } from '@/hooks/auth';
import {
    ResourcesListResp,
    ResourceItemData,
    ResourceGroup,
    ResourceStatusEvent,
    ResourcesWsEventType,
} from '@shared/resourcesApiTypes';
import { ApiToastResp } from '@shared/genericApiTypes';
import { getSocket, joinSocketRoom, leaveSocketRoom, submitAuthedDownload, cn } from '@/lib/utils';
import { ResourcesHeaderBand } from './ResourcesHeaderBand';

type StatusFilter = 'all' | 'started' | 'stopped' | 'updates';

type ResourcesViewState = {
    searchQuery: string;
    statusFilter: StatusFilter;
    collapsedFolders: Set<string>;
    selectedFolder: string | null;
};

// Merge WebSocket updates into the SWR data
function mergeWsUpdate(
    data: Exclude<ResourcesListResp, { error: string }> | undefined,
    wsData: Map<string, ResourceStatusEvent>,
): Exclude<ResourcesListResp, { error: string }> | undefined {
    if (!data) return data;
    let startedCount = 0;
    let stoppedCount = 0;
    const groups = data.groups.map((group) => ({
        ...group,
        resources: group.resources.map((res) => {
            const ws = wsData.get(res.name);
            const updated = ws
                ? { ...res, status: ws.status, perf: ws.perf, updateNotice: ws.updateNotice ?? res.updateNotice }
                : res;
            if (updated.status === 'started') startedCount++;
            else stoppedCount++;
            return updated;
        }),
    }));
    return { groups, totalResources: startedCount + stoppedCount, startedCount, stoppedCount };
}

/**
 * Resources V2 — redesign goals over V1:
 * - V2 header band (icon tile + live count pills) replacing PageHeader,
 *   matching the Players/Action Log bands.
 * - Content in a rounded card with a sticky toolbar instead of the
 *   full-bleed folder sidebar; folder filtering moved to a Select that
 *   works at every viewport size.
 * - Folders start expanded, with an expand/collapse-all toggle.
 * - Inline action buttons on every row (no dropdown), with tooltips.
 * - Richer empty/error states matching the other V2 pages.
 */
export default function ResourcesPage() {
    const { t } = useLocale();
    const [viewState, setViewState] = useState<ResourcesViewState>({
        searchQuery: '',
        statusFilter: 'all',
        collapsedFolders: new Set(),
        selectedFolder: null,
    });
    const wsDataRef = useRef<Map<string, ResourceStatusEvent>>(new Map());
    const [wsRevision, setWsRevision] = useState(0);
    const [isReloading, setIsReloading] = useState(false);
    const { searchQuery, statusFilter, collapsedFolders, selectedFolder } = viewState;
    const { hasPerm } = useAdminPerms();
    const canControl = hasPerm('commands.resources');
    const canDownload = hasPerm('commands.resources.download') && window.txConsts.resourceDownloadEnabled;

    const setViewField = <K extends keyof ResourcesViewState>(key: K, value: ResourcesViewState[K]) => {
        setViewState((prev) => ({ ...prev, [key]: value }));
    };

    const listApi = useBackendApi<ResourcesListResp>({
        method: 'GET',
        path: '/resources/list',
    });

    const commandApi = useBackendApi<ApiToastResp>({
        method: 'POST',
        path: '/fxserver/commands',
    });

    const swr = useSWR(
        '/resources/list',
        async () => {
            const data = await listApi({ timeout: ApiTimeout.LONG });
            if (!data) throw new Error('empty response');
            if ('error' in data) throw new Error(data.error);
            return data;
        },
        {
            revalidateOnFocus: false,
            dedupingInterval: 5_000,
        },
    );

    // WebSocket integration for real-time updates
    useEffect(() => {
        const socket = getSocket();
        const resourcesHandler = (data: ResourcesWsEventType) => {
            if (data.type === 'full' && data.resources) {
                const map = new Map<string, ResourceStatusEvent>();
                for (const res of data.resources) {
                    map.set(res.name, res);
                }
                wsDataRef.current = map;
            } else if (data.type === 'update' && data.updates) {
                for (const update of data.updates) {
                    wsDataRef.current.set(update.name, update);
                }
            }
            setWsRevision((r) => r + 1);
        };
        socket.on('resources', resourcesHandler);
        joinSocketRoom('resources');

        return () => {
            socket.off('resources', resourcesHandler);
            leaveSocketRoom('resources');
        };
    }, []);

    // Merge REST data with WebSocket real-time updates
    const liveData = useMemo(() => {
        void wsRevision; // dependency trigger
        return mergeWsUpdate(swr.data, wsDataRef.current);
    }, [swr.data, wsRevision]);

    const handleResourceAction = useCallback(
        async (action: string, resourceName: string) => {
            try {
                await commandApi({
                    data: { action, parameter: resourceName },
                });
                setTimeout(() => swr.mutate(), 1500);
            } catch {
                // Error handled by the hook's toast
            }
        },
        [commandApi, swr],
    );

    const handleReloadResources = useCallback(async () => {
        const toastId = txToast.loading(canControl ? 'Refreshing resources...' : 'Reloading resources...');
        setIsReloading(true);
        try {
            if (canControl) {
                await commandApi({
                    data: { action: 'refresh_res', parameter: '' },
                });
                await new Promise((resolve) => setTimeout(resolve, 1500));
            }
            const data = await swr.mutate();
            if (!data) {
                throw new Error('empty response');
            }
            if ('error' in data) {
                txToast.error({ msg: String(data.error) }, { id: toastId });
                return;
            }
            txToast.success('Resources reloaded successfully.', { id: toastId });
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Failed to reload resources.';
            txToast.error({ msg }, { id: toastId });
        } finally {
            setIsReloading(false);
        }
    }, [canControl, commandApi, swr]);

    const toggleFolder = useCallback((folderPath: string) => {
        setViewState((prev) => {
            const nextCollapsed = new Set(prev.collapsedFolders);
            if (nextCollapsed.has(folderPath)) {
                nextCollapsed.delete(folderPath);
            } else {
                nextCollapsed.add(folderPath);
            }
            return { ...prev, collapsedFolders: nextCollapsed };
        });
    }, []);

    // Filter groups based on search, status filter, and selected folder
    const filteredGroups = useMemo(() => {
        if (!liveData) return [];
        let groups = liveData.groups;

        if (selectedFolder) {
            groups = groups.filter((g) => g.subPath === selectedFolder);
        }

        return groups.flatMap((group) => {
            let resources = group.resources;

            if (statusFilter === 'updates') {
                resources = resources.filter((r) => !!r.updateNotice);
            } else if (statusFilter !== 'all') {
                resources = resources.filter((r) => r.status === statusFilter);
            }

            if (searchQuery.trim()) {
                const query = searchQuery.toLowerCase();
                resources = resources.filter(
                    (r) =>
                        r.name.toLowerCase().includes(query) ||
                        r.author.toLowerCase().includes(query) ||
                        r.description.toLowerCase().includes(query),
                );
            }

            return resources.length > 0 ? [{ ...group, resources }] : [];
        });
    }, [liveData, searchQuery, statusFilter, selectedFolder]);

    const isFiltering = Boolean(searchQuery.trim()) || statusFilter !== 'all' || selectedFolder !== null;
    // While searching, force-expand every group with matches
    const effectiveCollapsed = searchQuery.trim() ? new Set<string>() : collapsedFolders;
    const allCollapsed = filteredGroups.length > 0 && filteredGroups.every((g) => effectiveCollapsed.has(g.subPath));

    const toggleAllFolders = useCallback(() => {
        setViewState((prev) => {
            if (!liveData) return prev;
            const anyExpanded = liveData.groups.some((g) => !prev.collapsedFolders.has(g.subPath));
            return {
                ...prev,
                collapsedFolders: anyExpanded ? new Set(liveData.groups.map((g) => g.subPath)) : new Set(),
            };
        });
    }, [liveData]);

    const handleClearFilters = useCallback(() => {
        setViewState((prev) => ({
            ...prev,
            searchQuery: '',
            statusFilter: 'all',
            selectedFolder: null,
        }));
    }, []);

    const updatesCount = useMemo(() => {
        if (!liveData) return undefined;
        return liveData.groups.reduce((acc, group) => acc + group.resources.filter((r) => !!r.updateNotice).length, 0);
    }, [liveData]);

    const statusChips: { key: StatusFilter; label: string; count?: number }[] = [
        { key: 'all', label: 'All', count: liveData?.totalResources },
        { key: 'started', label: 'Started', count: liveData?.startedCount },
        { key: 'stopped', label: 'Stopped', count: liveData?.stoppedCount },
        { key: 'updates', label: 'Updates', count: updatesCount },
    ];

    return (
        <div className="h-contentvh mx-auto flex w-full max-w-(--tx-page-max-width) flex-col px-2 md:px-0">
            <ResourcesHeaderBand
                title={t('panel.routes.resources')}
                total={liveData?.totalResources}
                started={liveData?.startedCount}
                stopped={liveData?.stoppedCount}
                folders={liveData?.groups.length}
                updates={updatesCount}
                isLoading={swr.isLoading}
            />

            <TooltipProvider delayDuration={300}>
                <div className="bg-background border-border/60 flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-xl border">
                    {/* Toolbar */}
                    <div className="bg-card sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b px-4 py-2">
                        {/* Search */}
                        <div className="relative max-w-xs min-w-40 flex-1 basis-48">
                            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
                            <Input
                                placeholder="Search resources..."
                                value={searchQuery}
                                onChange={(e) => setViewField('searchQuery', e.target.value)}
                                className="h-7 pr-7 pl-8 text-sm"
                            />
                            {searchQuery && (
                                <button
                                    type="button"
                                    className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
                                    onClick={() => setViewField('searchQuery', '')}
                                >
                                    <XIcon className="size-3.5" />
                                </button>
                            )}
                        </div>

                        {/* Folder filter */}
                        <Select
                            value={selectedFolder ?? '__all__'}
                            onValueChange={(value) =>
                                setViewField('selectedFolder', value === '__all__' ? null : value)
                            }
                        >
                            <SelectTrigger className="h-7 w-auto min-w-36 gap-1 text-xs">
                                <FolderIcon className="size-3.5 shrink-0" />
                                <SelectValue placeholder="Folder" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__all__">All Folders</SelectItem>
                                {liveData?.groups.map((group) => (
                                    <SelectItem key={group.subPath} value={group.subPath}>
                                        <span>{group.subPath}</span>
                                        <span className="text-muted-foreground ml-1.5">({group.resources.length})</span>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        {/* Status filter chips */}
                        <div className="flex items-center gap-1.5">
                            {statusChips.map((chip) => {
                                const isActive = statusFilter === chip.key;
                                const isUpdatesAlert = chip.key === 'updates' && (chip.count ?? 0) > 0;
                                return (
                                    <button
                                        key={chip.key}
                                        type="button"
                                        onClick={() => setViewField('statusFilter', chip.key)}
                                        className={cn(
                                            'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors',
                                            isActive
                                                ? 'bg-secondary text-secondary-foreground border-border'
                                                : isUpdatesAlert
                                                  ? 'text-warning border-warning/40 bg-warning/10 hover:bg-warning/15'
                                                  : 'text-muted-foreground/50 hover:border-border border-transparent bg-transparent',
                                        )}
                                    >
                                        <span>{chip.label}</span>
                                        <span
                                            className={cn(
                                                'ml-0.5 text-[10px] tabular-nums',
                                                isActive
                                                    ? 'text-muted-foreground'
                                                    : isUpdatesAlert
                                                      ? 'text-warning'
                                                      : 'text-muted-foreground/40',
                                            )}
                                        >
                                            {chip.count ?? '—'}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Spacer */}
                        <div className="flex-1" />

                        {/* Expand/collapse all */}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="xs" onClick={toggleAllFolders}>
                                    {allCollapsed ? (
                                        <ChevronsUpDownIcon className="size-3.5" />
                                    ) : (
                                        <ChevronsDownUpIcon className="size-3.5" />
                                    )}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                {allCollapsed ? 'Expand all folders' : 'Collapse all folders'}
                            </TooltipContent>
                        </Tooltip>

                        {/* Refresh */}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="xs"
                                    onClick={handleReloadResources}
                                    disabled={swr.isLoading || isReloading}
                                >
                                    {swr.isLoading || isReloading ? (
                                        <Loader2Icon className="size-3.5 animate-spin" />
                                    ) : (
                                        <RefreshCwIcon className="size-3.5" />
                                    )}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                {canControl ? 'Refresh and reload resources' : 'Reload resources'}
                            </TooltipContent>
                        </Tooltip>
                    </div>

                    {/* Resource list */}
                    <div className="flex-1 overflow-y-auto">
                        {swr.isLoading ? (
                            <div className="flex items-center justify-center py-16">
                                <Loader2Icon className="text-muted-foreground size-8 animate-spin" />
                            </div>
                        ) : swr.error ? (
                            <div className="text-muted-foreground flex flex-col items-center justify-center gap-3 py-16">
                                <div className="bg-muted flex size-12 items-center justify-center rounded-xl">
                                    <AlertCircleIcon className="text-destructive size-6" />
                                </div>
                                <p className="text-sm font-medium">Failed to load resources</p>
                                <p className="text-muted-foreground/70 max-w-xs text-center text-xs">
                                    {swr.error.message}
                                </p>
                                <Button variant="outline" size="sm" onClick={handleReloadResources}>
                                    Retry
                                </Button>
                            </div>
                        ) : filteredGroups.length === 0 ? (
                            <div className="text-muted-foreground flex flex-col items-center justify-center gap-3 py-16">
                                <div className="bg-muted flex size-12 items-center justify-center rounded-xl">
                                    {isFiltering ? (
                                        <FilterXIcon className="size-6" />
                                    ) : (
                                        <PackageIcon className="size-6" />
                                    )}
                                </div>
                                <p className="text-sm font-medium">
                                    {isFiltering ? 'No resources match your filters' : 'No resources found'}
                                </p>
                                {isFiltering && (
                                    <Button variant="outline" size="sm" onClick={handleClearFilters}>
                                        Clear all filters
                                    </Button>
                                )}
                            </div>
                        ) : (
                            <div className="p-2">
                                {filteredGroups.map((group) => (
                                    <ResourceGroupSection
                                        key={group.subPath}
                                        group={group}
                                        expanded={!effectiveCollapsed.has(group.subPath)}
                                        onToggle={() => toggleFolder(group.subPath)}
                                        canControl={canControl}
                                        canDownload={canDownload}
                                        onAction={handleResourceAction}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </TooltipProvider>
        </div>
    );
}

function ResourceGroupSection({
    group,
    expanded,
    onToggle,
    canControl,
    canDownload,
    onAction,
}: {
    group: ResourceGroup;
    expanded: boolean;
    onToggle: () => void;
    canControl: boolean;
    canDownload: boolean;
    onAction: (action: string, name: string) => void;
}) {
    const startedCount = group.resources.filter((r) => r.status === 'started').length;
    const updateCount = group.resources.filter((r) => !!r.updateNotice).length;

    return (
        <div className="mb-1.5">
            <button
                onClick={onToggle}
                className="hover:bg-accent/60 group flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors"
            >
                {expanded ? (
                    <ChevronDownIcon className="text-muted-foreground size-4 shrink-0" />
                ) : (
                    <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" />
                )}
                {/* Folder name and pills centered in the row */}
                <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
                    <div className="bg-secondary/40 border-border/50 text-accent/80 flex size-7 shrink-0 items-center justify-center rounded-md border">
                        <FolderIcon className="size-3.5" />
                    </div>
                    <span className="truncate text-sm font-semibold tracking-tight">{group.subPath}</span>
                    <span
                        className={cn(
                            'shrink-0 rounded-full border px-2 py-px text-[10px] font-semibold tabular-nums',
                            startedCount === group.resources.length
                                ? 'border-success/30 bg-success/10 text-success-inline'
                                : 'border-border/50 bg-muted/15 text-muted-foreground',
                        )}
                    >
                        {startedCount}/{group.resources.length}
                    </span>
                    {updateCount > 0 && (
                        <span className="border-warning/40 bg-warning/10 text-warning shrink-0 rounded-full border px-2 py-px text-[10px] font-semibold tabular-nums">
                            {updateCount} update{updateCount > 1 ? 's' : ''}
                        </span>
                    )}
                </div>
                {/* Invisible spacer mirroring the chevron so the center is the true row middle */}
                <div className="size-4 shrink-0" aria-hidden="true" />
            </button>
            {expanded && (
                <div className="border-border/60 divide-border/40 ml-[1.4rem] divide-y border-l pl-2.5">
                    {group.resources.map((resource) => (
                        <ResourceRow
                            key={resource.name}
                            resource={resource}
                            canControl={canControl}
                            canDownload={canDownload}
                            onAction={onAction}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function PerfDisplay({ resource, className }: { resource: ResourceItemData; className?: string }) {
    if (!resource.perf) return null;
    const { cpu, memory, tickTime } = resource.perf;

    return (
        <div className={cn('flex items-center gap-3 text-xs', className)}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <span className={`flex items-center gap-1 ${cpu > 5 ? 'text-warning' : 'text-muted-foreground'}`}>
                        <CpuIcon className="size-3" />
                        {cpu.toFixed(1)}ms
                    </span>
                </TooltipTrigger>
                <TooltipContent>CPU time per frame</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <span
                        className={`flex items-center gap-1 ${memory > 128000 ? 'text-warning' : 'text-muted-foreground'}`}
                    >
                        <MemoryStickIcon className="size-3" />
                        {memory > 1024 ? `${(memory / 1024).toFixed(1)}MB` : `${memory}KB`}
                    </span>
                </TooltipTrigger>
                <TooltipContent>Memory usage</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <span
                        className={`flex items-center gap-1 ${tickTime > 5 ? 'text-warning' : 'text-muted-foreground'}`}
                    >
                        <TimerIcon className="size-3" />
                        {tickTime.toFixed(2)}ms
                    </span>
                </TooltipTrigger>
                <TooltipContent>Average tick time</TooltipContent>
            </Tooltip>
        </div>
    );
}

function ResourceRow({
    resource,
    canControl,
    canDownload,
    onAction,
}: {
    resource: ResourceItemData;
    canControl: boolean;
    canDownload: boolean;
    onAction: (action: string, name: string) => void;
}) {
    const csrfToken = useCsrfToken();
    const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

    const handleDownload = () => {
        if (!csrfToken) return;
        txToast.info('Preparing download…');
        submitAuthedDownload('/resources/download', csrfToken, {
            name: resource.name,
            path: resource.path,
        });
    };
    const isStarted = resource.status === 'started';
    const isStarting = resource.status === 'starting';
    const statusLabel = isStarted ? 'Started' : isStarting ? 'Starting' : 'Stopped';
    const hasActions = canControl || canDownload;

    const rowContent = (
        <>
            <div className="flex items-center gap-3">
                {/* Status indicator */}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div
                            className={cn(
                                'size-2 shrink-0 rounded-full ring-2',
                                isStarted
                                    ? 'bg-success ring-success/20'
                                    : isStarting
                                      ? 'bg-warning ring-warning/20 animate-pulse'
                                      : 'bg-destructive ring-destructive/20',
                            )}
                        />
                    </TooltipTrigger>
                    <TooltipContent>{statusLabel}</TooltipContent>
                </Tooltip>

                {/* Name and metadata */}
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{resource.name}</span>
                        {resource.version && (
                            <span className="text-muted-foreground bg-muted/40 border-border/40 shrink-0 rounded border px-1 py-px font-mono text-[10px]">
                                {resource.version}
                            </span>
                        )}
                        {!isStarted && (
                            <span
                                className={cn(
                                    'shrink-0 text-[10px] font-semibold tracking-wider uppercase',
                                    isStarting ? 'text-warning' : 'text-destructive',
                                )}
                            >
                                {statusLabel}
                            </span>
                        )}
                        {resource.updateNotice && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <span className="border-warning/40 bg-warning/10 text-warning inline-flex shrink-0 cursor-help items-center gap-1 rounded-full border px-2 py-px text-[10px] font-semibold">
                                        <ArrowUpCircleIcon className="size-3" />
                                        Update available
                                    </span>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-sm">
                                    <p className="font-mono text-xs wrap-break-word">{resource.updateNotice}</p>
                                </TooltipContent>
                            </Tooltip>
                        )}
                    </div>
                    {(resource.description || resource.author) && (
                        <div className="text-muted-foreground mt-0.5 flex items-center gap-2 text-xs">
                            {resource.description && <span className="truncate">{resource.description}</span>}
                            {resource.author && <span className="shrink-0">by {resource.author}</span>}
                        </div>
                    )}
                </div>

                {/* Performance stats (desktop) */}
                {isStarted && <PerfDisplay resource={resource} className="hidden md:flex" />}
            </div>

            {/* Performance stats (compact viewports) */}
            {isStarted && <PerfDisplay resource={resource} className="mt-1 pl-5 md:hidden" />}
        </>
    );

    if (!hasActions) {
        return <div className="hover:bg-accent/40 px-2 py-2 transition-colors">{rowContent}</div>;
    }

    // Clicking anywhere on the row opens the actions menu at the cursor position,
    // via a zero-size virtual anchor placed at the click coordinates.
    return (
        <>
            <div
                role="button"
                tabIndex={0}
                aria-label={`Actions for ${resource.name}`}
                onClick={(e) => setMenuPos({ x: e.clientX, y: e.clientY })}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setMenuPos({ x: rect.left + 24, y: rect.bottom });
                    }
                }}
                className={cn(
                    'hover:bg-accent/40 focus-visible:bg-accent/40 cursor-pointer px-2 py-2 transition-colors focus-visible:outline-hidden',
                    menuPos && 'bg-accent/60',
                )}
            >
                {rowContent}
            </div>
            {menuPos && (
                <DropdownMenu open modal={false} onOpenChange={(open) => !open && setMenuPos(null)}>
                    <DropdownMenuTrigger asChild>
                        <span aria-hidden="true" className="fixed size-0" style={{ left: menuPos.x, top: menuPos.y }} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-52">
                        <DropdownMenuLabel className="truncate">{resource.name}</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {canControl && (
                            <>
                                <DropdownMenuItem onClick={() => onAction('restart_res', resource.name)}>
                                    <RotateCwIcon className="mr-2 size-4" />
                                    Restart
                                </DropdownMenuItem>
                                {isStarted ? (
                                    <DropdownMenuItem onClick={() => onAction('stop_res', resource.name)}>
                                        <SquareIcon className="mr-2 size-4" />
                                        Stop
                                    </DropdownMenuItem>
                                ) : (
                                    <DropdownMenuItem onClick={() => onAction('start_res', resource.name)}>
                                        <PlayIcon className="mr-2 size-4" />
                                        Start
                                    </DropdownMenuItem>
                                )}
                            </>
                        )}
                        {canControl && canDownload && <DropdownMenuSeparator />}
                        {canDownload && (
                            <DropdownMenuItem disabled={!csrfToken} onClick={handleDownload}>
                                <DownloadIcon className="mr-2 size-4" />
                                Download
                            </DropdownMenuItem>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
        </>
    );
}
