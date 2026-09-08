import { CalendarRangeIcon, DoorOpenIcon, ShapesIcon, TrendingDownIcon, XIcon, ZapIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { DisplayLodType } from '@/pages/PlayerDropsPage/playerDropsTypes';

export type PlayerDropsHeaderStats = {
    totalDrops: number;
    unexpectedDrops: number;
    changes: number;
};

type PlayerDropsHeaderBandProps = {
    title: string;
    windowLabel: string;
    stats?: PlayerDropsHeaderStats;
    displayLod: DisplayLodType;
    setDisplayLod: (lod: DisplayLodType) => void;
    drilldownIntervals: readonly { label: string; days: number }[];
    activeInterval: number | null;
    setIntervalRange: (days: number) => void;
    hasRange: boolean;
    resetRange: () => void;
};

/**
 * V2 header band for the Player Drops page — consolidates the three control
 * surfaces of V1 (PageHeader pills, TimelineCard lens select, and the
 * standalone drilldown toolbar) into a single band with summary stat pills
 * on top and one controls row underneath.
 */
export function PlayerDropsHeaderBand({
    title,
    windowLabel,
    stats,
    displayLod,
    setDisplayLod,
    drilldownIntervals,
    activeInterval,
    setIntervalRange,
    hasRange,
    resetRange,
}: PlayerDropsHeaderBandProps) {
    const pill = (label: string, value: number | undefined, Icon: typeof DoorOpenIcon) => (
        <div
            className={cn(
                'border-border/50 bg-secondary/40 inline-flex items-center gap-2 rounded-full border px-3 py-1.5',
                value === undefined && 'opacity-60',
            )}
        >
            <Icon className="text-muted-foreground size-3.5 shrink-0" />
            <span className="text-muted-foreground/70 text-[11px] font-semibold tracking-wider uppercase">{label}</span>
            <span className="text-foreground text-sm font-semibold tabular-nums">
                {value !== undefined ? value.toLocaleString() : '—'}
            </span>
        </div>
    );

    return (
        <div className="border-border/60 bg-background rounded-xl border">
            {/* Title + stats row */}
            <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                    <div className="bg-secondary/50 text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-xl">
                        <TrendingDownIcon className="size-5" />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-foreground text-lg font-semibold tracking-tight">{title}</h1>
                        <p className="text-muted-foreground mt-0.5 text-xs">
                            What, when, and why players left — timeline and per-window drilldown.
                        </p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {pill('Drops', stats?.totalDrops, DoorOpenIcon)}
                    {pill('Unexpected', stats?.unexpectedDrops, ZapIcon)}
                    {pill('Changes', stats?.changes, ShapesIcon)}
                </div>
            </div>

            {/* Controls row */}
            <div className="border-border/40 flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center">
                <div className="text-muted-foreground/80 inline-flex items-center gap-1.5 text-xs">
                    <CalendarRangeIcon className="size-3.5" />
                    <span className="font-medium">{windowLabel}</span>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                    {/* Lens segmented control */}
                    <div
                        role="radiogroup"
                        aria-label="Timeline resolution"
                        className="border-border/60 bg-secondary/30 inline-flex items-center rounded-full border p-0.5"
                    >
                        <LensSegment active={displayLod === 'hour'} onClick={() => setDisplayLod('hour')}>
                            Hours
                        </LensSegment>
                        <LensSegment active={displayLod === 'day'} onClick={() => setDisplayLod('day')}>
                            Days
                        </LensSegment>
                    </div>

                    {/* Drilldown interval buttons */}
                    <div
                        className="border-border/60 bg-secondary/30 inline-flex items-center gap-0.5 rounded-full border p-0.5"
                        role="group"
                        aria-label="Drilldown range"
                    >
                        {drilldownIntervals.map(({ label, days }) => (
                            <button
                                key={days}
                                type="button"
                                aria-pressed={activeInterval === days}
                                onClick={() => setIntervalRange(days)}
                                className={cn(
                                    'focus-visible:ring-ring rounded-full px-3 py-1 font-mono text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-hidden',
                                    activeInterval === days
                                        ? 'bg-primary text-primary-foreground pointer-events-none shadow-sm'
                                        : 'text-muted-foreground hover:text-foreground',
                                )}
                            >
                                {label}
                            </button>
                        ))}
                    </div>

                    {hasRange && (
                        <Button
                            size="xs"
                            variant="ghost"
                            className="text-muted-foreground hover:text-foreground h-7 gap-1 px-2 text-xs"
                            onClick={resetRange}
                        >
                            <XIcon className="size-3" />
                            Reset
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}

function LensSegment({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            role="radio"
            aria-checked={active}
            onClick={onClick}
            className={cn(
                'focus-visible:ring-ring rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-hidden',
                active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
        >
            {children}
        </button>
    );
}
