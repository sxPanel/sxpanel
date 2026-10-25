import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/page-header';
import { cn } from '@/lib/utils';
import {
    ActivityIcon,
    BarChart3Icon,
    CpuIcon,
    GaugeIcon,
    LayoutDashboardIcon,
    Loader2Icon,
    MessageSquareIcon,
    ScrollTextIcon,
    ServerIcon,
    type LucideIcon,
} from 'lucide-react';
import { BotStatusHero } from './BotStatusHero';
import { DiagnosticsHeroStats } from './DiagnosticsHeroStats';
import {
    discordBotStatusLabels,
    diagnosticsSections,
    emptyBotCommandAnalytics,
    formatDuration,
    formatLatency,
    formatRecoveryAction,
    formatTimestamp,
    useDiagnosticsModel,
} from './diagnosticsModel';
import { KeyValueRow, SectionLabel, SlimPercentBar } from './KeyValueRow';
import { ProcessRow } from './ProcessRow';

function parseHeapPercent(raw: string): number | null {
    const n = Number.parseFloat(String(raw).replace(/%/g, '').trim());
    if (!Number.isFinite(n)) return null;
    return Math.min(100, Math.max(0, n));
}

function CpuBadge({ cores, speed }: { cores: number; speed: number }) {
    if (!speed) return null; //unknown speed, don't flag it
    if (speed <= 2.4) {
        return (
            <span className="bg-destructive text-destructive-foreground ml-1 rounded px-1.5 py-0.5 text-xs font-bold">
                VERY SLOW!
            </span>
        );
    }
    if (speed < 3.0 && cores < 8) {
        return (
            <span className="bg-warning text-warning-foreground ml-1 rounded px-1.5 py-0.5 text-xs font-bold">
                SLOW
            </span>
        );
    }
    return null;
}

function DiagnosticsCard({
    icon: Icon,
    title,
    subtitle,
    children,
    className,
}: {
    icon: LucideIcon;
    title: string;
    subtitle?: string;
    children: ReactNode;
    className?: string;
}) {
    return (
        <div className={cn('border-border/60 bg-background rounded-xl border', className)}>
            <div className="border-border/40 flex flex-wrap items-start gap-3 border-b p-4">
                <div className="bg-secondary/50 text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
                    <Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                    <h2 className="text-foreground text-sm font-semibold">{title}</h2>
                    {subtitle ? <p className="text-muted-foreground mt-0.5 text-xs">{subtitle}</p> : null}
                </div>
            </div>
            <div className="p-4">{children}</div>
        </div>
    );
}

function DiagnosticsMetricCard({
    label,
    value,
    detail,
    tone,
}: {
    label: string;
    value: ReactNode;
    detail?: ReactNode;
    tone?: string;
}) {
    return (
        <div className="bg-secondary/40 border-border/50 rounded-lg border p-3">
            <p className="text-muted-foreground/60 text-[11px] font-semibold tracking-widest uppercase">{label}</p>
            <p className={cn('mt-2 text-2xl font-semibold tabular-nums', tone ?? 'text-foreground')}>{value}</p>
            {detail ? <p className="text-muted-foreground mt-1 text-xs">{detail}</p> : null}
        </div>
    );
}

function DiagnosticsMiniCard({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="bg-secondary/40 border-border/50 rounded-lg border p-3">
            <h3 className="text-muted-foreground/60 mb-2 text-[11px] font-semibold tracking-widest uppercase">
                {title}
            </h3>
            <div className="space-y-0">{children}</div>
        </div>
    );
}

function Pill({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <span
            className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold', className)}
        >
            {children}
        </span>
    );
}

const REPORT_PAYLOAD_BULLETS = [
    'All diagnostics page data',
    'Recent sxPanel (system), live console and server log',
    'Environment variables',
    'Server performance (dashboard chart) data',
    'Player database statistics',
    'sxPanel settings (no bot token)',
    'List of admins (no passwords/hashes)',
    'List of files/folders in server data and monitor folders',
    'Config files in server data folder',
] as const;

export default function DiagnosticsPage() {
    const model = useDiagnosticsModel();

    if (model.status === 'loading') {
        return (
            <div className="flex min-h-96 items-center justify-center">
                <Loader2Icon className="size-8 animate-spin" />
            </div>
        );
    }

    if (model.status === 'error') {
        return (
            <div className="flex min-h-96 flex-col items-center justify-center gap-2">
                <p className="text-destructive">Failed to load diagnostics data.</p>
                <p className="text-muted-foreground text-sm">{model.message}</p>
            </div>
        );
    }

    const { data, state, dispatch, handleBotAction, handleSendReport } = model;
    const { section, reportModalOpen, reportState, reportId, reportError, botActionState } = state;

    const { host, txadmin, fxserver, processes, discordBot } = data;
    const botCommandAnalytics = data.botCommandAnalytics ?? emptyBotCommandAnalytics;
    const {
        overview: commandOverview,
        latency: commandLatency,
        byCommand: commandBreakdown,
        denialReasons: commandDenialReasons,
        timelineDays: commandTimelineDays,
        rollups: commandRollups,
    } = botCommandAnalytics;

    const discordBotStatusLabel = discordBotStatusLabels[discordBot.status] ?? `CODE-${discordBot.status}`;
    const isBotActionLoading = botActionState.action !== null;
    const discordBotRuntimeUpdated = formatTimestamp(discordBot.runtime.updatedAt);

    const cpuPct = host?.dynamic ? host.dynamic.cpuUsage : null;
    const memPct = host?.dynamic?.memory.usage ?? null;
    const heapPct = parseHeapPercent(txadmin.memoryUsage.heap_pct);
    const r = txadmin.monitor.restarts;
    const monitorRestartsTotal = r.bootTimeout + r.close + r.heartBeat + r.healthCheck + r.both;
    const hbFailsTotal = txadmin.monitor.hbFails.http + txadmin.monitor.hbFails.fd3;

    const commandOutcomeRows = [
        { label: 'Success', count: commandOverview.success, colorClass: 'bg-success' },
        { label: 'Denied', count: commandOverview.denied, colorClass: 'bg-warning' },
        { label: 'Failed', count: commandOverview.failed, colorClass: 'bg-destructive' },
        { label: 'Timed Out', count: commandOverview.timedOut, colorClass: 'bg-muted-foreground' },
    ];

    const sortedProcesses = processes?.length ? [...processes].sort((a, b) => (b.cpu ?? 0) - (a.cpu ?? 0)) : [];
    const cpuMax = sortedProcesses.reduce((m, p) => Math.max(m, p.cpu ?? 0), 0) || 1;
    const memMax = sortedProcesses.reduce((m, p) => Math.max(m, p.memory ?? 0), 0) || 1;

    return (
        <div
            data-diagnostics-v2-redesign=""
            className="DiagnosticsShell mx-auto w-full max-w-(--breakpoint-xl) space-y-4 px-2 md:px-0"
        >
            <PageHeader
                icon={<ActivityIcon />}
                title="Diagnostics"
                description="Inspect runtime health, process state, and support data."
            />

            <Tabs
                value={section}
                onValueChange={(value) => dispatch({ section: value as (typeof diagnosticsSections)[number]['id'] })}
                className="space-y-4"
            >
                <TabsList className="h-auto flex-wrap justify-start gap-1 bg-transparent p-0">
                    {diagnosticsSections.map((item) => (
                        <TabsTrigger
                            key={item.id}
                            value={item.id}
                            className="data-[state=active]:bg-card data-[state=active]:border-border rounded-lg border border-transparent px-3 py-1.5 data-[state=active]:shadow-xs"
                        >
                            {item.label}
                        </TabsTrigger>
                    ))}
                </TabsList>

                <TabsContent value="overview" className="mt-0 space-y-4">
                    <DiagnosticsHeroStats
                        cpuPct={cpuPct}
                        memPct={memPct}
                        heapPct={heapPct}
                        uptime={txadmin.uptime}
                        monitorRestarts={monitorRestartsTotal}
                        hbFailsTotal={hbFailsTotal}
                    />

                    <div className="grid gap-4 xl:grid-cols-2">
                        <DiagnosticsCard icon={ServerIcon} title="Environment" subtitle="Host and Node runtime">
                            {!host ? (
                                <p className="text-muted-foreground text-sm">Host data not available.</p>
                            ) : host.error ? (
                                <p className="text-destructive text-sm">{host.error}</p>
                            ) : host.static ? (
                                <div className="space-y-0">
                                    <KeyValueRow label="Node" value={host.static.nodeVersion} mono />
                                    <KeyValueRow label="OS" value={host.static.osDistro} />
                                    <KeyValueRow label="Username" value={host.static.username} />
                                    <KeyValueRow
                                        label="CPU model"
                                        value={`${host.static.cpu.manufacturer} ${host.static.cpu.brand}`}
                                    />
                                    <KeyValueRow
                                        label="CPU layout"
                                        value={
                                            <>
                                                {host.static.cpu.physicalCores}c / {host.static.cpu.cores}t @{' '}
                                                {host.static.cpu.speedMin
                                                    ? `${host.static.cpu.speedMin} GHz`
                                                    : 'unknown speed'}
                                                <CpuBadge
                                                    cores={host.static.cpu.cores}
                                                    speed={host.static.cpu.speedMin}
                                                />
                                            </>
                                        }
                                    />
                                    {host.dynamic ? (
                                        <>
                                            <div className="pt-1">
                                                <div className="mb-1.5 flex items-center justify-between">
                                                    <SectionLabel>CPU usage</SectionLabel>
                                                    <span className="font-mono text-sm tabular-nums">
                                                        {host.dynamic.cpuUsage}%
                                                    </span>
                                                </div>
                                                <SlimPercentBar value={host.dynamic.cpuUsage} />
                                            </div>
                                            <div className="pt-2">
                                                <div className="mb-1.5 flex items-center justify-between">
                                                    <SectionLabel>Memory usage</SectionLabel>
                                                    <span className="font-mono text-sm tabular-nums">
                                                        {host.dynamic.memory.usage ?? '—'}% (
                                                        {host.dynamic.memory.used?.toFixed(2) ?? '—'} /{' '}
                                                        {host.dynamic.memory.total?.toFixed(2) ?? '—'})
                                                    </span>
                                                </div>
                                                <SlimPercentBar
                                                    value={host.dynamic.memory.usage ?? 0}
                                                    className={
                                                        host.dynamic.memory.usage !== null &&
                                                        host.dynamic.memory.usage > 85
                                                            ? 'bg-warning'
                                                            : undefined
                                                    }
                                                />
                                            </div>
                                        </>
                                    ) : (
                                        <p className="text-muted-foreground pt-2 text-sm italic">
                                            Dynamic usage data not available.
                                        </p>
                                    )}
                                </div>
                            ) : null}
                        </DiagnosticsCard>

                        <DiagnosticsCard
                            icon={LayoutDashboardIcon}
                            title="sxPanel runtime"
                            subtitle="Versions, paths, monitor, performance, memory"
                        >
                            <div className="space-y-4">
                                <div>
                                    <SectionLabel>Core</SectionLabel>
                                    <div className="mt-1 space-y-0">
                                        <KeyValueRow label="Uptime" value={txadmin.uptime} mono />
                                        <KeyValueRow
                                            label="Versions"
                                            value={
                                                <span>
                                                    <code className="text-xs">v{window.txConsts.txaVersion}</code>
                                                    <span className="text-muted-foreground"> / </span>
                                                    <code className="text-xs">b{window.txConsts.fxsVersion}</code>
                                                </span>
                                            }
                                            mono
                                        />
                                        <KeyValueRow label="Database file" value={txadmin.databaseFileSize} mono />
                                    </div>
                                </div>

                                <div>
                                    <SectionLabel>Paths & host defaults</SectionLabel>
                                    <div className="mt-1 space-y-0">
                                        <KeyValueRow label="FXServer" value={txadmin.txEnv.fxsPath} mono breakAll />
                                        <KeyValueRow label="Profile" value={txadmin.txEnv.profilePath} mono breakAll />
                                        <KeyValueRow
                                            label="Defaults"
                                            value={
                                                txadmin.txHostConfig.defaults.length > 0
                                                    ? txadmin.txHostConfig.defaults.join(', ')
                                                    : '—'
                                            }
                                            mono
                                            breakAll
                                        />
                                        <KeyValueRow
                                            label="Interface"
                                            value={txadmin.txHostConfig.netInterface ?? '—'}
                                            mono
                                        />
                                        <KeyValueRow
                                            label="Provider"
                                            value={txadmin.txHostConfig.providerName ?? '—'}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <SectionLabel>Monitor</SectionLabel>
                                    <div className="mt-1 space-y-0">
                                        <KeyValueRow
                                            label="HB fails"
                                            value={`HTTP ${txadmin.monitor.hbFails.http} · FD3 ${txadmin.monitor.hbFails.fd3}`}
                                            mono
                                        />
                                        <KeyValueRow
                                            label="Restarts"
                                            value={`BT ${txadmin.monitor.restarts.bootTimeout} · CL ${txadmin.monitor.restarts.close} · HB ${txadmin.monitor.restarts.heartBeat} · HC ${txadmin.monitor.restarts.healthCheck} · BO ${txadmin.monitor.restarts.both}`}
                                            mono
                                        />
                                    </div>
                                </div>

                                <div>
                                    <SectionLabel>Performance times</SectionLabel>
                                    <div className="mt-1 space-y-0">
                                        <KeyValueRow label="Ban check" value={txadmin.performance.banCheck} mono />
                                        <KeyValueRow
                                            label="Whitelist check"
                                            value={txadmin.performance.whitelistCheck}
                                            mono
                                        />
                                        <KeyValueRow
                                            label="Players table"
                                            value={txadmin.performance.playersTableSearch}
                                            mono
                                        />
                                        <KeyValueRow
                                            label="History table"
                                            value={txadmin.performance.historyTableSearch}
                                            mono
                                        />
                                        <KeyValueRow
                                            label="Database save"
                                            value={txadmin.performance.databaseSave}
                                            mono
                                        />
                                        <KeyValueRow
                                            label="Perf collection"
                                            value={txadmin.performance.perfCollection}
                                            mono
                                        />
                                    </div>
                                </div>

                                <div>
                                    <SectionLabel>Memory</SectionLabel>
                                    <div className="mt-1 space-y-0">
                                        <KeyValueRow
                                            label="Heap"
                                            value={`${txadmin.memoryUsage.heap_used} / ${txadmin.memoryUsage.heap_limit} (${txadmin.memoryUsage.heap_pct})`}
                                            mono
                                            breakAll
                                        />
                                        {heapPct !== null ? (
                                            <div className="pb-2">
                                                <SlimPercentBar
                                                    value={heapPct}
                                                    className={heapPct > 85 ? 'bg-warning' : undefined}
                                                />
                                            </div>
                                        ) : null}
                                        <KeyValueRow label="Physical" value={txadmin.memoryUsage.physical} mono />
                                        <KeyValueRow
                                            label="Peak allocated"
                                            value={txadmin.memoryUsage.peak_malloced}
                                            mono
                                        />
                                    </div>
                                </div>

                                <div>
                                    <SectionLabel>Logger</SectionLabel>
                                    <div className="mt-1 space-y-0">
                                        <KeyValueRow label="Storage size" value={txadmin.logger.storageSize} mono />
                                        <KeyValueRow label="Admin" value={txadmin.logger.statusAdmin} mono />
                                        <KeyValueRow label="FXServer" value={txadmin.logger.statusFXServer} mono />
                                        <KeyValueRow label="Server" value={txadmin.logger.statusServer} mono />
                                    </div>
                                </div>
                            </div>
                        </DiagnosticsCard>
                    </div>

                    <DiagnosticsCard
                        icon={ScrollTextIcon}
                        title="Snapshot metadata"
                        subtitle="Server-generated summary line"
                    >
                        <p className="text-muted-foreground text-sm">{data.message}</p>
                    </DiagnosticsCard>
                </TabsContent>

                <TabsContent value="discord" className="mt-0 space-y-4">
                    <BotStatusHero
                        discordBot={discordBot}
                        discordBotRuntimeUpdated={discordBotRuntimeUpdated}
                        discordBotStatusLabel={discordBotStatusLabel}
                        isBotActionLoading={isBotActionLoading}
                        botActionState={botActionState}
                        onRestart={() => handleBotAction('restart')}
                        onReloadAddons={() => handleBotAction('reload-addons')}
                        onResync={() => handleBotAction('resync')}
                    />

                    <div className="border-border/60 bg-background rounded-xl border p-4">
                        <div className="grid gap-3 xl:grid-cols-2">
                            <DiagnosticsMiniCard title="Bridge health">
                                <KeyValueRow label="Connected" value={discordBot.bridge.isConnected ? 'Yes' : 'No'} />
                                <KeyValueRow
                                    label="Connect / disconnect"
                                    value={`${discordBot.bridge.connectCount} / ${discordBot.bridge.disconnectCount}`}
                                    mono
                                />
                                <KeyValueRow
                                    label="Last auth"
                                    value={formatTimestamp(discordBot.bridge.lastAuthenticatedAt)}
                                    mono
                                />
                                <KeyValueRow
                                    label="Last disconnect"
                                    value={formatTimestamp(discordBot.bridge.lastDisconnectedAt)}
                                    mono
                                />
                                <KeyValueRow
                                    label="Down for"
                                    value={formatDuration(discordBot.bridge.disconnectedForMs)}
                                    mono
                                />
                                <KeyValueRow
                                    label="Reconnect time"
                                    value={formatDuration(discordBot.bridge.lastReconnectDurationMs)}
                                    mono
                                />
                                <KeyValueRow
                                    label="Auto heal at"
                                    value={formatTimestamp(discordBot.bridge.autoHealAt)}
                                    mono
                                />
                            </DiagnosticsMiniCard>

                            <DiagnosticsMiniCard title="Runtime state">
                                <KeyValueRow label="Client ready" value={discordBot.isClientReady ? 'Yes' : 'No'} />
                                <KeyValueRow label="Last ready" value={formatTimestamp(discordBot.lastReadyAt)} mono />
                                <KeyValueRow
                                    label="Pending restart"
                                    value={discordBot.process.hasPendingRestart ? 'Yes' : 'No'}
                                />
                                <KeyValueRow
                                    label="Restart delay"
                                    value={formatDuration(discordBot.process.nextRestartDelayMs)}
                                    mono
                                />
                                <KeyValueRow
                                    label="Last recovery"
                                    value={formatRecoveryAction(discordBot.lastRecoveryAction)}
                                />
                                <KeyValueRow
                                    label="Recovery time"
                                    value={formatTimestamp(discordBot.lastRecoveryAction?.at ?? null)}
                                    mono
                                />
                            </DiagnosticsMiniCard>

                            <DiagnosticsMiniCard title="Recent process output">
                                <KeyValueRow
                                    label="stderr"
                                    value={discordBot.process.lastErrorLine ?? '—'}
                                    mono
                                    breakAll
                                />
                                <KeyValueRow
                                    label="stdout"
                                    value={discordBot.process.lastOutputLine ?? '—'}
                                    mono
                                    breakAll
                                />
                            </DiagnosticsMiniCard>

                            <DiagnosticsMiniCard title="Node child runtime">
                                <KeyValueRow label="Resolved" value={discordBot.nodeRuntime.resolved ? 'Yes' : 'No'} />
                                <KeyValueRow
                                    label="Runtime path"
                                    value={discordBot.nodeRuntime.resolvedChildLabel ?? '—'}
                                    mono
                                    breakAll
                                />
                                <KeyValueRow
                                    label="Via musl loader"
                                    value={discordBot.nodeRuntime.resolvedViaMuslLoader ? 'Yes' : 'No'}
                                />
                                <KeyValueRow
                                    label="Host execPath"
                                    value={discordBot.nodeRuntime.hostExecPath}
                                    mono
                                    breakAll
                                />
                                <KeyValueRow
                                    label="Candidates checked"
                                    value={String(discordBot.nodeRuntime.candidateCount)}
                                    mono
                                />
                                {!discordBot.nodeRuntime.resolved && discordBot.nodeRuntime.suggestedBotNodePath ? (
                                    <KeyValueRow
                                        label="Suggested SXPANEL_BOT_NODE_PATH"
                                        value={discordBot.nodeRuntime.suggestedBotNodePath}
                                        mono
                                        breakAll
                                    />
                                ) : null}
                                {!discordBot.nodeRuntime.resolved && discordBot.nodeRuntime.candidateSample.length ? (
                                    <KeyValueRow
                                        label="Candidate sample"
                                        value={discordBot.nodeRuntime.candidateSample.join(', ')}
                                        mono
                                        breakAll
                                    />
                                ) : null}
                            </DiagnosticsMiniCard>

                            <DiagnosticsMiniCard title="Recovery notes">
                                <KeyValueRow label="Bot enabled" value={discordBot.enabled ? 'Yes' : 'No'} />
                                <KeyValueRow label="Runtime updated" value={discordBotRuntimeUpdated} mono />
                                <KeyValueRow
                                    label="Addon hook failures"
                                    value={String(discordBot.runtime.addonLoadFailures.length)}
                                    mono
                                />
                            </DiagnosticsMiniCard>
                        </div>

                        {discordBot.lastBotError ? (
                            <div className="border-destructive/30 bg-destructive/10 mt-4 rounded-lg border p-3">
                                <p className="text-destructive text-sm font-medium">
                                    Bot error {discordBot.lastBotError.code ? `(${discordBot.lastBotError.code})` : ''}
                                </p>
                                <p className="text-destructive mt-1 text-xs">{discordBot.lastBotError.message}</p>
                                <p className="text-muted-foreground mt-1 font-mono text-xs">
                                    {formatTimestamp(discordBot.lastBotError.at)}
                                </p>
                            </div>
                        ) : null}

                        {discordBot.lastProcessFailure ? (
                            <div className="border-warning/30 bg-warning/10 mt-4 rounded-lg border p-3">
                                <p className="text-warning text-sm font-medium">Process failure</p>
                                <p className="text-warning mt-1 text-xs">{discordBot.lastProcessFailure.reason}</p>
                                <p className="text-muted-foreground mt-1 font-mono text-xs">
                                    {formatTimestamp(discordBot.lastProcessFailure.at)}
                                </p>
                            </div>
                        ) : null}

                        {(botActionState.message || botActionState.error) && (
                            <div
                                className={cn(
                                    'mt-4 rounded-lg border p-3 text-sm',
                                    botActionState.error
                                        ? 'border-destructive/30 bg-destructive/10 text-destructive'
                                        : 'border-success/30 bg-success/10 text-success',
                                )}
                            >
                                {botActionState.error || botActionState.message}
                            </div>
                        )}
                    </div>

                    <DiagnosticsCard
                        icon={MessageSquareIcon}
                        title="Addon hook failures"
                        subtitle="Command and event load errors"
                    >
                        {discordBot.runtime.addonLoadFailures.length === 0 ? (
                            <p className="text-muted-foreground text-sm">
                                No addon command or event load failures recorded.
                            </p>
                        ) : (
                            <div className="space-y-2">
                                {discordBot.runtime.addonLoadFailures.map((failure) => (
                                    <div
                                        key={`${failure.kind}-${failure.filePath}-${failure.updatedAt}-${failure.addonId ?? 'unknown'}`}
                                        className="border-destructive/25 bg-destructive/5 rounded-lg border p-3"
                                    >
                                        <div className="mb-1 flex flex-wrap items-center gap-2">
                                            <Pill className="border-destructive/30 bg-destructive/10 text-destructive">
                                                {failure.kind === 'event' ? 'Event' : 'Command'}
                                            </Pill>
                                            {failure.addonId ? (
                                                <Pill className="border-border bg-muted text-foreground">
                                                    {failure.addonId}
                                                </Pill>
                                            ) : null}
                                            <span className="text-muted-foreground ml-auto text-xs">
                                                {formatTimestamp(failure.updatedAt)}
                                            </span>
                                        </div>
                                        <p className="text-destructive text-xs">{failure.message}</p>
                                        <p className="text-muted-foreground mt-2 font-mono text-[11px] break-all">
                                            {failure.filePath}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </DiagnosticsCard>
                </TabsContent>

                <TabsContent value="commandAnalytics" className="mt-0 space-y-4">
                    <div className="border-border/60 bg-background rounded-xl border p-4">
                        <div className="mb-4 flex flex-wrap items-start gap-3">
                            <div className="bg-secondary/50 text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
                                <BarChart3Icon className="size-4" />
                            </div>
                            <div>
                                <h2 className="text-foreground text-sm font-semibold">Discord command analytics</h2>
                                <p className="text-muted-foreground mt-0.5 text-xs sm:text-sm">
                                    Slash-command outcomes, latency, denial reasons, and 7d/30d rollups for the last 30
                                    days.
                                </p>
                            </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                            <DiagnosticsMetricCard
                                label="Commands"
                                value={commandOverview.total}
                                detail={`${commandOverview.uniqueCommands} unique commands`}
                            />
                            <DiagnosticsMetricCard
                                label="Success rate"
                                value={`${commandOverview.successRate}%`}
                                detail={`${commandOverview.success} succeeded`}
                                tone="text-success"
                            />
                            <DiagnosticsMetricCard
                                label="Denied / failed"
                                value={`${commandOverview.denied} / ${commandOverview.failed}`}
                                detail={`${commandOverview.timedOut} timed out`}
                                tone="text-warning"
                            />
                            <DiagnosticsMetricCard
                                label="Ack latency"
                                value={formatLatency(commandLatency.avgInteractionAckMs)}
                                detail={`P95 ${formatLatency(commandLatency.p95InteractionAckMs)}`}
                            />
                            <DiagnosticsMetricCard
                                label="Bridge roundtrip"
                                value={formatLatency(commandLatency.avgBridgeRoundtripMs)}
                                detail={`P95 ${formatLatency(commandLatency.p95BridgeRoundtripMs)}`}
                            />
                            <DiagnosticsMetricCard
                                label="Handler duration"
                                value={formatLatency(commandLatency.avgHandlerDurationMs)}
                                detail={`P95 ${formatLatency(commandLatency.p95HandlerDurationMs)}`}
                            />
                        </div>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-2">
                        <div className="border-border/60 bg-background rounded-xl border p-4">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <SectionLabel>Outcome breakdown</SectionLabel>
                                <span className="text-muted-foreground text-xs">{commandOverview.total} recorded</span>
                            </div>
                            <div className="space-y-3">
                                {commandOutcomeRows.map((row) => {
                                    const pct =
                                        commandOverview.total > 0
                                            ? Math.round((row.count / commandOverview.total) * 100)
                                            : 0;
                                    return (
                                        <div key={row.label}>
                                            <div className="mb-1 flex items-center justify-between text-sm">
                                                <div className="flex items-center gap-1.5">
                                                    <span
                                                        className={cn(
                                                            'inline-block size-2 rounded-full',
                                                            row.colorClass,
                                                        )}
                                                    />
                                                    <span>{row.label}</span>
                                                </div>
                                                <span className="text-muted-foreground tabular-nums">
                                                    {row.count} ({pct}%)
                                                </span>
                                            </div>
                                            <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                                                <div
                                                    className={cn(row.colorClass, 'h-full rounded-full')}
                                                    style={{ width: `${pct}%` }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="border-border/60 bg-background rounded-xl border p-4">
                            <SectionLabel>Rollups</SectionLabel>
                            <div className="mt-3 grid gap-3 md:grid-cols-2">
                                <DiagnosticsMiniCard title="Last 7 days">
                                    <KeyValueRow label="Commands" value={commandRollups['7d'].total} />
                                    <KeyValueRow label="Success rate" value={`${commandRollups['7d'].successRate}%`} />
                                    <KeyValueRow
                                        label="Avg ack"
                                        value={formatLatency(commandRollups['7d'].avgInteractionAckMs)}
                                        mono
                                    />
                                    <KeyValueRow
                                        label="Avg bridge"
                                        value={formatLatency(commandRollups['7d'].avgBridgeRoundtripMs)}
                                        mono
                                    />
                                    <KeyValueRow
                                        label="Avg handler"
                                        value={formatLatency(commandRollups['7d'].avgHandlerDurationMs)}
                                        mono
                                    />
                                </DiagnosticsMiniCard>
                                <DiagnosticsMiniCard title="Last 30 days">
                                    <KeyValueRow label="Commands" value={commandRollups['30d'].total} />
                                    <KeyValueRow label="Success rate" value={`${commandRollups['30d'].successRate}%`} />
                                    <KeyValueRow
                                        label="Avg ack"
                                        value={formatLatency(commandRollups['30d'].avgInteractionAckMs)}
                                        mono
                                    />
                                    <KeyValueRow
                                        label="Avg bridge"
                                        value={formatLatency(commandRollups['30d'].avgBridgeRoundtripMs)}
                                        mono
                                    />
                                    <KeyValueRow
                                        label="Avg handler"
                                        value={formatLatency(commandRollups['30d'].avgHandlerDurationMs)}
                                        mono
                                    />
                                </DiagnosticsMiniCard>
                            </div>
                        </div>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-2">
                        <div className="border-border/60 bg-background rounded-xl border p-4">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <SectionLabel>Denial reasons</SectionLabel>
                                <span className="text-muted-foreground text-xs">{commandOverview.denied} denied</span>
                            </div>
                            {commandDenialReasons.length === 0 ? (
                                <p className="text-muted-foreground text-sm">
                                    No denial events recorded in the last 30 days.
                                </p>
                            ) : (
                                <div className="space-y-3">
                                    {commandDenialReasons.map((row) => {
                                        const pct =
                                            commandOverview.denied > 0
                                                ? Math.round((row.count / commandOverview.denied) * 100)
                                                : 0;
                                        return (
                                            <div key={row.reason}>
                                                <div className="mb-1 flex justify-between text-sm">
                                                    <span className="capitalize">
                                                        {row.reason.replaceAll('_', ' ')}
                                                    </span>
                                                    <span className="text-muted-foreground tabular-nums">
                                                        {row.count} ({pct}%)
                                                    </span>
                                                </div>
                                                <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                                                    <div
                                                        className="bg-warning h-full rounded-full"
                                                        style={{ width: `${pct}%` }}
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="border-border/60 bg-background rounded-xl border p-4">
                            <SectionLabel>Daily outcomes</SectionLabel>
                            <div className="border-border/60 mt-3 overflow-x-auto rounded-lg border">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-muted/40">
                                            <th className="px-3 py-2 text-left font-medium">Date</th>
                                            <th className="px-3 py-2 text-right font-medium">Total</th>
                                            <th className="px-3 py-2 text-right font-medium">Success</th>
                                            <th className="px-3 py-2 text-right font-medium">Denied</th>
                                            <th className="px-3 py-2 text-right font-medium">Failed</th>
                                            <th className="px-3 py-2 text-right font-medium">Timed out</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {commandTimelineDays.slice(-14).map((day, index) => (
                                            <tr key={day.date} className={index % 2 === 0 ? '' : 'bg-muted/20'}>
                                                <td className="text-muted-foreground px-3 py-1.5">{day.date}</td>
                                                <td className="px-3 py-1.5 text-right tabular-nums">{day.total}</td>
                                                <td className="text-success px-3 py-1.5 text-right tabular-nums">
                                                    {day.success}
                                                </td>
                                                <td className="text-warning px-3 py-1.5 text-right tabular-nums">
                                                    {day.denied}
                                                </td>
                                                <td className="text-destructive px-3 py-1.5 text-right tabular-nums">
                                                    {day.failed}
                                                </td>
                                                <td className="px-3 py-1.5 text-right tabular-nums">{day.timedOut}</td>
                                            </tr>
                                        ))}
                                        {commandTimelineDays.length === 0 ? (
                                            <tr>
                                                <td colSpan={6} className="text-muted-foreground px-3 py-4 text-center">
                                                    No command telemetry recorded.
                                                </td>
                                            </tr>
                                        ) : null}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    <div className="border-border/60 bg-background rounded-xl border p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <SectionLabel>Command breakdown</SectionLabel>
                            <span className="text-muted-foreground text-xs">
                                Showing {Math.min(commandBreakdown.length, 8)} of {commandBreakdown.length}
                            </span>
                        </div>
                        <div className="border-border/60 overflow-x-auto rounded-lg border">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-muted/40">
                                        <th className="px-3 py-2 text-left font-medium">Command</th>
                                        <th className="px-3 py-2 text-right font-medium">Total</th>
                                        <th className="px-3 py-2 text-right font-medium">Success rate</th>
                                        <th className="px-3 py-2 text-right font-medium">Denied</th>
                                        <th className="px-3 py-2 text-right font-medium">Avg ack</th>
                                        <th className="px-3 py-2 text-right font-medium">Avg handler</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {commandBreakdown.slice(0, 8).map((row, index) => {
                                        const successRate =
                                            row.total > 0 ? Math.round((row.success / row.total) * 100) : 0;
                                        return (
                                            <tr key={row.commandName} className={index % 2 === 0 ? '' : 'bg-muted/20'}>
                                                <td className="px-3 py-2 font-medium">/{row.commandName}</td>
                                                <td className="px-3 py-2 text-right tabular-nums">{row.total}</td>
                                                <td className="text-success px-3 py-2 text-right tabular-nums">
                                                    {successRate}%
                                                </td>
                                                <td className="text-warning px-3 py-2 text-right tabular-nums">
                                                    {row.denied}
                                                </td>
                                                <td className="px-3 py-2 text-right tabular-nums">
                                                    {formatLatency(row.avgInteractionAckMs)}
                                                </td>
                                                <td className="px-3 py-2 text-right tabular-nums">
                                                    {formatLatency(row.avgHandlerDurationMs)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {commandBreakdown.length === 0 ? (
                                        <tr>
                                            <td colSpan={6} className="text-muted-foreground px-3 py-4 text-center">
                                                No command telemetry recorded.
                                            </td>
                                        </tr>
                                    ) : null}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="fxserver" className="mt-0 space-y-4">
                    <DiagnosticsCard icon={GaugeIcon} title="FXServer" subtitle="/info.json snapshot">
                        {!fxserver ? (
                            <p className="text-muted-foreground text-sm">FXServer data not available.</p>
                        ) : (
                            <>
                                {fxserver.versionMismatch ? (
                                    <div className="border-destructive/30 bg-destructive/10 mb-4 rounded-lg border p-3 text-center text-sm">
                                        <p className="text-destructive font-semibold">
                                            This version doesn&apos;t match sxPanel&apos;s version!
                                        </p>
                                        <p className="text-muted-foreground mt-2 text-xs">
                                            If you just updated FXServer, restart sxPanel. Otherwise, it means FXServer
                                            was already running before sxPanel started, and nothing is going to work
                                            properly.
                                        </p>
                                    </div>
                                ) : null}
                                {fxserver.error !== false && fxserver.error ? (
                                    <p className="text-destructive text-sm">{fxserver.error}</p>
                                ) : (
                                    <div className="space-y-0">
                                        <KeyValueRow
                                            label="Status"
                                            value={
                                                <span
                                                    className={cn(
                                                        'inline-flex rounded-md px-2 py-0.5 text-xs font-semibold',
                                                        fxserver.statusColor === 'success' &&
                                                            'bg-success/15 text-success',
                                                        fxserver.statusColor === 'warning' &&
                                                            'bg-warning/15 text-warning',
                                                        fxserver.statusColor === 'danger' &&
                                                            'bg-destructive/15 text-destructive',
                                                        fxserver.statusColor !== 'success' &&
                                                            fxserver.statusColor !== 'warning' &&
                                                            fxserver.statusColor !== 'danger' &&
                                                            'bg-muted text-muted-foreground',
                                                    )}
                                                >
                                                    {fxserver.status}
                                                </span>
                                            }
                                        />
                                        <KeyValueRow label="Version" value={fxserver.version ?? '—'} mono />
                                        <KeyValueRow label="Resources" value={fxserver.resources ?? '—'} mono />
                                        <KeyValueRow label="OneSync" value={fxserver.onesync ?? '—'} mono />
                                        <KeyValueRow label="Max clients" value={fxserver.maxClients ?? '—'} mono />
                                        <KeyValueRow
                                            label="sxPanel version"
                                            value={fxserver.txAdminVersion ?? '—'}
                                            mono
                                        />
                                    </div>
                                )}
                            </>
                        )}
                    </DiagnosticsCard>
                </TabsContent>

                <TabsContent value="processes" className="mt-0 space-y-4">
                    <DiagnosticsCard icon={CpuIcon} title="Processes" subtitle="Sorted by CPU (highest first)">
                        {!processes?.length ? (
                            <p className="text-muted-foreground text-sm">
                                Failed to retrieve process data. Check the terminal for more information (if verbosity
                                is enabled).
                            </p>
                        ) : (
                            <div className="grid gap-3 lg:grid-cols-2">
                                {sortedProcesses.map((proc) => (
                                    <ProcessRow
                                        key={proc.pid}
                                        name={proc.name}
                                        pid={proc.pid}
                                        ppid={proc.ppid}
                                        cpu={proc.cpu}
                                        memoryMb={proc.memory}
                                        cpuMax={cpuMax}
                                        memMax={memMax}
                                    />
                                ))}
                            </div>
                        )}
                    </DiagnosticsCard>
                </TabsContent>

                <TabsContent value="report" className="mt-0 space-y-4">
                    <DiagnosticsCard
                        icon={ScrollTextIcon}
                        title="Diagnostics report"
                        subtitle="Optional support bundle"
                    >
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="max-w-xl space-y-3">
                                <p className="text-sm">
                                    To receive sxPanel Support, it is recommended that you send the diagnostics data
                                    directly to the Support Team.
                                </p>
                                <div>
                                    <SectionLabel>What gets sent</SectionLabel>
                                    <ul className="text-muted-foreground mt-2 list-inside list-disc space-y-1 text-sm">
                                        {REPORT_PAYLOAD_BULLETS.map((line) => (
                                            <li key={line}>{line}</li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                className="shrink-0 self-start"
                                onClick={() => {
                                    dispatch({
                                        reportState: 'info',
                                        reportError: '',
                                        reportId: '',
                                        reportModalOpen: true,
                                    });
                                }}
                            >
                                Review details & send data
                            </Button>
                        </div>
                    </DiagnosticsCard>

                    <DiagnosticsCard
                        icon={ActivityIcon}
                        title="Snapshot metadata"
                        subtitle="Included in the report context"
                    >
                        <p className="text-muted-foreground text-sm">{data.message}</p>
                    </DiagnosticsCard>
                </TabsContent>
            </Tabs>

            <Dialog open={reportModalOpen} onOpenChange={(open) => dispatch({ reportModalOpen: open })}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Send Diagnostics Data</DialogTitle>
                        <DialogDescription>Submit diagnostics data to the support team.</DialogDescription>
                    </DialogHeader>

                    {reportState === 'info' && (
                        <div className="space-y-3 text-sm">
                            <p>
                                This <em>optional</em> feature sends a diagnostics report to the sxPanel/Cfx.re teams,
                                and may be required to diagnose a wide range of server issues. After sending the data,
                                you will receive a Report ID you can send in the support channels.
                            </p>
                            <div>
                                <strong>Which data will be sent?</strong>
                                <ul className="mt-1 list-inside list-disc space-y-0.5">
                                    <li>All diagnostics page data</li>
                                    <li>Recent sxPanel (system), live console and server log</li>
                                    <li>Environment variables</li>
                                    <li>Server performance (dashboard chart) data</li>
                                    <li>Player database statistics</li>
                                    <li>sxPanel settings (no bot token)</li>
                                    <li>List of admins (no passwords/hashes)</li>
                                    <li>List of files/folders in server data and monitor folders</li>
                                    <li>Config files in server data folder</li>
                                </ul>
                            </div>
                            <div>
                                <strong>Sensitive Information Protection:</strong>
                                <ul className="mt-1 list-inside list-disc space-y-0.5">
                                    <li>
                                        <strong>Settings:</strong> the Discord Bot Token will be removed
                                    </li>
                                    <li>
                                        <strong>Admin List:</strong> the password hashes will not be sent
                                    </li>
                                    <li>
                                        <strong>Env Vars:</strong> parameters with key, license, pass, private, secret,
                                        token in their name will be masked.
                                    </li>
                                    <li>
                                        <strong>CFG Files:</strong> known secret parameters will be masked.
                                    </li>
                                    <li>
                                        <strong>Logs:</strong> any identifiable IPv4 address in logs will be masked.
                                    </li>
                                </ul>
                            </div>
                        </div>
                    )}

                    {reportState === 'loading' && (
                        <div className="flex min-h-32 items-center justify-center">
                            <Loader2Icon className="size-8 animate-spin" />
                        </div>
                    )}

                    {reportState === 'success' && (
                        <div className="text-center">
                            <h2 className="text-xl">
                                Report ID:{' '}
                                <code className="bg-secondary rounded px-3 py-1 text-2xl tracking-widest">
                                    {reportId}
                                </code>
                            </h2>
                        </div>
                    )}

                    {reportState === 'error' && (
                        <div className="text-center">
                            <h4 className="text-destructive">{reportError}</h4>
                        </div>
                    )}

                    <DialogFooter>
                        <Button variant="secondary" onClick={() => dispatch({ reportModalOpen: false })}>
                            Close
                        </Button>
                        {reportState === 'info' && (
                            <Button variant="default" onClick={handleSendReport}>
                                Agree & Send Data
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
