import { useMemo } from 'react';
import { UsersIcon } from 'lucide-react';
import { useAtomValue } from 'jotai';
import { playerCountAtom } from '@/hooks/playerlist';
import { dashPlayerDropAtom, dashPlayerHistoryAtom } from './dashboardHooks';
import { playerDropCategories, playerDropCategoryDefaultColor } from '@/lib/playerDropCategories';
import Sparkline from './Sparkline';
import { dashboardCardClass, DashboardCardHeader } from './DashboardCard';
import { cn } from '@/lib/utils';

/** Compact drop summary folded into the players card (replaces the old standalone pie-chart card). */
function PlayerDropsSummary() {
    const playerDropData = useAtomValue(dashPlayerDropAtom);

    const drops = useMemo(() => {
        if (!playerDropData?.summaryLast6h || !Array.isArray(playerDropData.summaryLast6h)) return null;
        const categories = [...playerDropData.summaryLast6h].sort((a, b) => b[1] - a[1]);
        const total = categories.reduce((acc, [, count]) => acc + count, 0);
        return { total, categories };
    }, [playerDropData?.summaryLast6h]);

    return (
        <div className="border-border/40 border-t pt-3">
            <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-xs font-medium">Drops (last 6h)</span>
                <span className="font-mono text-xs font-semibold tabular-nums">
                    {drops ? drops.total.toLocaleString('en-US') : '0'}
                </span>
            </div>
            {drops && drops.categories.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                    {drops.categories.map(([reason, count]) => (
                        <span key={reason} className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
                            <span
                                className="size-2 shrink-0 rounded-full"
                                style={{
                                    backgroundColor:
                                        playerDropCategories[reason]?.color ?? playerDropCategoryDefaultColor,
                                }}
                            />
                            {playerDropCategories[reason]?.label ?? reason}
                            <span className="text-foreground font-mono font-semibold tabular-nums">
                                {count.toLocaleString('en-US')}
                            </span>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

/** Compact "Players Online" card: big live count + 24h sparkline + drop summary. */
export default function DashboardPlayersCard() {
    const playerCount = useAtomValue(playerCountAtom);
    const playerHistory = useAtomValue(dashPlayerHistoryAtom);

    return (
        <div className={cn(dashboardCardClass, 'flex h-full min-h-80 flex-col')}>
            <DashboardCardHeader icon={UsersIcon} title="Players Online" />
            <div className="flex min-h-0 flex-1 flex-col justify-between gap-3 px-5 pb-4">
                <p className="text-info-inline font-mono text-4xl font-bold tabular-nums">
                    {playerCount.toLocaleString('en-US')}
                </p>
                <div className="min-h-0 flex-1">
                    {playerHistory && playerHistory.length > 1 ? (
                        <Sparkline
                            points={playerHistory.map((p) => p.players)}
                            height={96}
                            strokeClassName="text-info-inline"
                            fillArea
                        />
                    ) : (
                        <div className="text-muted-foreground/50 flex size-full items-center justify-center text-center text-xs">
                            Not enough data yet
                        </div>
                    )}
                </div>
                <PlayerDropsSummary />
            </div>
        </div>
    );
}
