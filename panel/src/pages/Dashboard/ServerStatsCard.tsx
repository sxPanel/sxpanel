import { GaugeIcon, Loader2Icon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { dashPerfCursorAtom, dashServerStatsAtom, dashSvRuntimeAtom, useGetDashDataAge } from './dashboardHooks';
import { cn } from '@/lib/utils';
import { dateToLocaleDateString, dateToLocaleTimeString, isDateToday, msToShortDuration } from '@/lib/dateTime';
import { globalStatusAtom } from '@/hooks/status';
import { dashboardCardClass, DashboardCardHeader } from './DashboardCard';

//NOTE: null and undefined are semantically equal here
type HostStatsDataProps = {
    uptimePct: number | null | undefined;
    medianPlayerCount: number | null | undefined;
    fxsMemory: number | null | undefined;
    nodeMemory:
        | {
              used: number;
              limit: number;
          }
        | null
        | undefined;
};

type StatTileProps = {
    label: string;
    value: React.ReactNode;
    hint?: string;
    valueClass?: string;
    className?: string;
    children?: React.ReactNode;
    title?: string;
};
function StatTile({ label, value, hint, valueClass, className, children, title }: StatTileProps) {
    return (
        <div
            className={cn(
                'bg-secondary/25 border-border/40 flex flex-col gap-1 rounded-lg border px-3 py-2.5',
                className,
            )}
            title={title}
        >
            <span className="text-muted-foreground/70 text-[11px] font-medium">{label}</span>
            <span
                className={cn(
                    'font-mono text-lg leading-tight font-semibold tabular-nums',
                    valueClass ?? 'text-foreground',
                )}
            >
                {value}
                {hint && <span className="text-muted-foreground/60 ml-1 text-xs font-normal">{hint}</span>}
            </span>
            {children}
        </div>
    );
}

/** Live total uptime — the next-restart countdown lives in the Server Controls card instead, where it's actionable. */
const UptimeTile = memo(() => {
    const status = useAtomValue(globalStatusAtom);
    const uptimeStr =
        (status && msToShortDuration(status.server.uptime, { units: ['d', 'h', 'm'], delimiter: ' ' })) || '--';
    return <StatTile label="Uptime" value={uptimeStr} />;
});

const HostStatsData = memo(({ uptimePct, medianPlayerCount, fxsMemory, nodeMemory }: HostStatsDataProps) => {
    const uptimePart = uptimePct != null ? uptimePct.toFixed(1) + '%' : '--';
    const medianPlayerPart = medianPlayerCount != null ? String(Math.ceil(medianPlayerCount)) : '--';
    const fxsPart = fxsMemory != null ? fxsMemory.toFixed(0) : '--';

    let nodePct: number | null = null;
    let nodePart = '--';
    let nodeTitle = '';
    let nodeValueClass: string | undefined;
    let nodeBarClass = 'bg-accent';
    if (nodeMemory) {
        nodePart = nodeMemory.used.toFixed(0);
        if (nodeMemory.limit > 0) {
            nodePct = Math.min(Math.ceil((nodeMemory.used / nodeMemory.limit) * 100), 100);
            nodeTitle = `${nodeMemory.used.toFixed(2)} MB / ${nodeMemory.limit} MB`;
            if (nodePct > 85) {
                nodeValueClass = 'text-destructive-inline';
                nodeBarClass = 'bg-destructive';
            } else if (nodePct > 70) {
                nodeValueClass = 'text-warning-inline';
                nodeBarClass = 'bg-warning';
            }
        } else {
            nodeTitle = `${nodeMemory.used.toFixed(2)} MB`;
        }
    }

    return (
        <div className="grid grid-cols-2 gap-2 px-5 pb-5">
            <UptimeTile />
            <StatTile label="Availability (24h)" value={uptimePart} />
            <StatTile label="Median Players (24h)" value={medianPlayerPart} />
            <StatTile label="FXServer Memory" value={fxsPart} hint="MB" />
            <StatTile
                label="Node.js Memory"
                value={nodePart}
                hint={nodePct != null ? `MB · ${nodePct}%` : 'MB'}
                valueClass={nodeValueClass}
                className="col-span-2"
                title={nodeTitle}
            >
                {nodePct != null && (
                    <div className="bg-secondary/60 mt-1 h-1.5 w-full overflow-hidden rounded-full">
                        <div
                            className={cn('h-full rounded-full transition-[width] duration-500', nodeBarClass)}
                            style={{ width: `${nodePct}%` }}
                        />
                    </div>
                )}
            </StatTile>
        </div>
    );
});

export default function ServerStatsCard() {
    const pastStatsData = useAtomValue(dashServerStatsAtom);
    const svRuntimeData = useAtomValue(dashSvRuntimeAtom);
    const perfCursorData = useAtomValue(dashPerfCursorAtom);
    const getDashDataAge = useGetDashDataAge();

    const displayData = useMemo(() => {
        //Data availability & age check
        const dataAge = getDashDataAge();
        if (!svRuntimeData || dataAge.isExpired) return null;

        if (perfCursorData && perfCursorData.snap) {
            const timeStr = dateToLocaleTimeString(perfCursorData.snap.end, '2-digit', '2-digit');
            const dateStr = dateToLocaleDateString(perfCursorData.snap.end, 'short');
            const titleTimeIndicator = isDateToday(perfCursorData.snap.end) ? timeStr : `${timeStr} - ${dateStr}`;
            return {
                fxsMemory: perfCursorData.snap.fxsMemory,
                nodeMemory:
                    svRuntimeData.nodeMemory && perfCursorData.snap.nodeMemory
                        ? {
                              used: perfCursorData.snap.nodeMemory,
                              limit: svRuntimeData.nodeMemory.limit,
                          }
                        : null,
                titleTimeIndicator: (
                    <>
                        (<span className="text-warning-inline font-mono text-xs">{titleTimeIndicator}</span>)
                    </>
                ),
            };
        } else {
            return {
                fxsMemory: svRuntimeData.fxsMemory,
                nodeMemory: svRuntimeData.nodeMemory,
                titleTimeIndicator: dataAge.isStale ? '(minutes ago)' : '(live)',
            };
        }
    }, [svRuntimeData, perfCursorData, getDashDataAge]);

    //Rendering
    let titleNode: React.ReactNode = null;
    let contentNode: React.ReactNode = null;
    if (displayData) {
        titleNode = displayData.titleTimeIndicator;
        contentNode = (
            <HostStatsData
                fxsMemory={displayData.fxsMemory}
                medianPlayerCount={pastStatsData?.medianPlayerCount}
                uptimePct={pastStatsData?.uptimePct}
                nodeMemory={displayData.nodeMemory}
            />
        );
    } else {
        contentNode = (
            <div className="flex size-full flex-col items-center justify-center">
                <Loader2Icon className="text-muted-foreground size-16 animate-spin" />
            </div>
        );
    }

    return (
        <div className={cn(dashboardCardClass, 'flex h-full min-h-80 flex-col')}>
            <DashboardCardHeader icon={GaugeIcon} title="Server Stats">
                {titleNode && <span className="text-muted-foreground text-xs">{titleNode}</span>}
            </DashboardCardHeader>
            <div className="flex min-h-0 flex-1 flex-col justify-center">{contentNode}</div>
        </div>
    );
}
