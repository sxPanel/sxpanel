import { BarChartHorizontalIcon, Loader2Icon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import {
    formatTickBoundary,
    getBucketColorScale,
    getBucketTicketsEstimatedTime,
    getTimeWeightedHistogram,
} from './chartingUtils';
import DebouncedResizeContainer from '@/components/DebouncedResizeContainer';
import { useAtomValue } from 'jotai';
import { dashPerfCursorAtom, dashSvRuntimeAtom, useGetDashDataAge } from './dashboardHooks';
import { color } from 'd3-color';
import { SvRtPerfThreadNamesType } from '@shared/otherTypes';
import { cn } from '@/lib/utils';
import { dateToLocaleDateString, dateToLocaleTimeString, isDateToday } from '@/lib/dateTime';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { dashboardCardClass, DashboardCardHeader } from './DashboardCard';

/**
 * Types
 */
type ThreadPerfChartDatum = {
    bucket: string | number;
    value: number;
    color: string;
    count: number;
};

type ThreadPerfChartProps = {
    data: ThreadPerfChartDatum[];
    avgColor: string | undefined;
};

/**
 * Formats a compact single-line bucket range label, e.g. "< 2 ms", "6–8 ms", "> 250 ms".
 */
const formatBucketLabel = (lower: string | number, upper: string | number, isFirst: boolean, isLast: boolean) => {
    if (isFirst) return `< ${formatTickBoundary(upper)}`;
    if (isLast || upper === '+Inf') return `> ${formatTickBoundary(lower)}`;
    if (typeof lower === 'number' && typeof upper === 'number' && upper < 1) {
        return `${Math.round(lower * 1000)}–${Math.round(upper * 1000)} ms`;
    }
    return `${formatTickBoundary(lower)}–${formatTickBoundary(upper)}`;
};

const formatPctLabel = (pct: number) => {
    if (pct === 0) return '0%';
    if (pct < 0.1) return '<0.1%';
    return pct >= 10 ? `${pct.toFixed(0)}%` : `${pct.toFixed(1)}%`;
};

/**
 * A row per tick-duration bucket: label, a thin rounded proportional bar, and the % of time spent there.
 * Rows distribute evenly over the card height so any bucket count fits without scroll or clipping.
 */
const ThreadPerfBarList = memo(({ data, avgColor }: ThreadPerfChartProps) => {
    return (
        <div className="flex size-full flex-col justify-evenly rounded-lg" style={{ backgroundColor: avgColor }}>
            {data.map((datum, index) => {
                const lower = data[index - 1]?.bucket ?? 0;
                const label = formatBucketLabel(lower, datum.bucket, index === 0, index === data.length - 1);
                const pct = datum.value * 100;
                const pctLabel = formatPctLabel(pct);
                return (
                    <div
                        key={datum.bucket}
                        className="flex min-h-0 items-center gap-2.5 px-1"
                        title={`${label}: ${pctLabel} of time (${datum.count.toLocaleString()} ticks)`}
                    >
                        <span className="text-muted-foreground w-20 shrink-0 text-right font-mono text-[10px] whitespace-nowrap">
                            {label}
                        </span>
                        <div className="bg-secondary/40 h-1.5 min-w-0 flex-1 overflow-hidden rounded-full">
                            <div
                                className="h-full rounded-full transition-[width] duration-300"
                                style={{ width: `${Math.max(pct, pct > 0 ? 1.5 : 0)}%`, backgroundColor: datum.color }}
                            />
                        </div>
                        <span className="text-foreground w-11 shrink-0 text-right font-mono text-[11px] font-semibold tabular-nums">
                            {pctLabel}
                        </span>
                    </div>
                );
            })}
        </div>
    );
});

export default function ThreadPerfCard() {
    const [chartSize, setChartSize] = useState({ width: 0, height: 0 });
    const [selectedThread, setSelectedThread] = useState<SvRtPerfThreadNamesType>('svMain');
    const svRuntimeData = useAtomValue(dashSvRuntimeAtom);
    const perfCursorData = useAtomValue(dashPerfCursorAtom);
    const getDashDataAge = useGetDashDataAge();

    const chartData = useMemo(() => {
        //Data availability & age check
        if (!svRuntimeData || getDashDataAge().isExpired) return null;

        //Data completeness check
        if (!Array.isArray(svRuntimeData.perfBoundaries) || !svRuntimeData.perfBucketCounts) {
            return 'incomplete';
        }

        const threadName = (perfCursorData ? perfCursorData.threadName : selectedThread) as SvRtPerfThreadNamesType;

        const { perfBoundaries, perfBucketCounts } = svRuntimeData;
        const { colorFunc } = getBucketColorScale(perfBoundaries, threadName);

        const threadBucketCounts = perfBucketCounts[threadName];
        if (!Array.isArray(threadBucketCounts)) return 'incomplete';
        let threadHistogram: number[];
        if (perfCursorData) {
            threadHistogram = perfCursorData.snap.weightedPerf;
        } else {
            const bucketTicketsEstimatedTime = getBucketTicketsEstimatedTime(perfBoundaries);
            threadHistogram = getTimeWeightedHistogram(threadBucketCounts, bucketTicketsEstimatedTime);
        }

        const data: ThreadPerfChartDatum[] = [];
        for (let i = 0; i < perfBoundaries.length; i++) {
            data.push({
                bucket: perfBoundaries[i],
                count: perfCursorData ? 0 : threadBucketCounts[i],
                value: threadHistogram[i],
                color: colorFunc(i),
            });
        }
        //Calculate average color with heavy transparency for background
        let avgColor: string | undefined;
        if (data.length) {
            let totalWeight = 0;
            let weightedIndex = 0;
            for (let i = 0; i < data.length; i++) {
                totalWeight += data[i].value;
                weightedIndex += data[i].value * i;
            }
            if (totalWeight > 0) {
                const avgIdx = weightedIndex / totalWeight;
                const rawColor = colorFunc(Math.round(avgIdx));
                const parsed = color(rawColor);
                if (parsed) {
                    parsed.opacity = 0.08;
                    avgColor = parsed.formatRgb().replace('rgb(', 'rgba(').replace(')', `, ${parsed.opacity})`);
                }
            }
        }
        return { threadName, data, avgColor };
    }, [svRuntimeData, perfCursorData, selectedThread]);

    const titleTimeIndicator = useMemo(() => {
        //Data availability & age check
        const dataAge = getDashDataAge();
        if (!svRuntimeData || dataAge.isExpired) return null;

        //Data completeness check
        if (!Array.isArray(svRuntimeData.perfBoundaries) || !svRuntimeData.perfBucketCounts) {
            return null;
        }

        if (perfCursorData) {
            const timeStr = dateToLocaleTimeString(perfCursorData.snap.end, '2-digit', '2-digit');
            const dateStr = dateToLocaleDateString(perfCursorData.snap.end, 'short');
            const fullStr = isDateToday(perfCursorData.snap.end) ? timeStr : `${timeStr} - ${dateStr}`;
            return (
                <>
                    (<span className="text-warning-inline font-mono text-xs">{fullStr}</span>)
                </>
            );
        } else {
            return dataAge.isStale ? '(minutes ago)' : '(last minute)';
        }
    }, [svRuntimeData, perfCursorData]);

    //Rendering
    let cursorThreadLabel;
    let contentNode: React.ReactNode = null;
    if (typeof chartData === 'object' && chartData !== null) {
        cursorThreadLabel = chartData.threadName;
        if (chartSize.width && chartSize.height) {
            contentNode = <ThreadPerfBarList data={chartData.data} avgColor={chartData.avgColor} />;
        }
    } else if (typeof chartData === 'string') {
        contentNode = (
            <div className="text-muted-foreground absolute inset-0 flex flex-col items-center justify-center text-center">
                <p className="max-w-80">
                    Data not yet available. <br />
                    The thread performance chart will appear soon after the server is online.
                </p>
            </div>
        );
    } else {
        contentNode = (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <Loader2Icon className="text-muted-foreground size-16 animate-spin" />
            </div>
        );
    }

    return (
        <div className={cn(dashboardCardClass, 'flex h-full min-h-80 flex-col')}>
            <DashboardCardHeader
                icon={BarChartHorizontalIcon}
                title={`${cursorThreadLabel ?? selectedThread} Performance`}
            >
                {titleTimeIndicator && <span className="text-muted-foreground text-xs">{titleTimeIndicator}</span>}
                <Select
                    defaultValue={selectedThread}
                    onValueChange={(value) => setSelectedThread(value as SvRtPerfThreadNamesType)}
                    disabled={!!perfCursorData}
                >
                    <SelectTrigger
                        className={cn('h-7 w-32 grow px-3 py-1 text-sm md:grow-0', !!perfCursorData && 'hidden')}
                    >
                        <SelectValue placeholder="Filter by admin" />
                    </SelectTrigger>
                    <SelectContent className="px-0">
                        <SelectItem value={'svMain'} className="cursor-pointer">
                            svMain
                        </SelectItem>
                        <SelectItem value={'svSync'} className="cursor-pointer">
                            svSync
                        </SelectItem>
                        <SelectItem value={'svNetwork'} className="cursor-pointer">
                            svNetwork
                        </SelectItem>
                    </SelectContent>
                </Select>
            </DashboardCardHeader>
            <div className="min-h-0 flex-1 px-5 pb-4">
                <DebouncedResizeContainer onDebouncedResize={setChartSize}>{contentNode}</DebouncedResizeContainer>
            </div>
        </div>
    );
}
