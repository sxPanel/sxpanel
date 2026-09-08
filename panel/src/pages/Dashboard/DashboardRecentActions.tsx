import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { ClipboardListIcon } from 'lucide-react';
import { cn, getSocket, joinSocketRoom, leaveSocketRoom } from '@/lib/utils';
import type { SystemLogEntry } from '@shared/systemLogTypes';
import {
    ACTION_LOG_CATEGORY_STYLES,
    ACTION_LOG_DEFAULT_CATEGORY_STYLE,
} from '@/pages/ActionLog/actionLogCategoryStyles';
import { useAdminPerms } from '@/hooks/auth';
import { dashboardCardClass, DashboardCardHeader } from './DashboardCard';

const MAX_ENTRIES = 8;
const timeOptions: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit' };

/** Lightweight live tail of the system log, just for the dashboard widget (no filters/sessions/history). */
function useRecentActions(limit: number, enabled: boolean) {
    const [entries, setEntries] = useState<SystemLogEntry[]>([]);

    useEffect(() => {
        if (!enabled) return;
        const socket = getSocket();
        const handler = (data: SystemLogEntry | SystemLogEntry[]) => {
            const incoming = Array.isArray(data) ? data : [data];
            setEntries((prev) => [...incoming, ...prev].slice(0, limit));
        };
        (socket as any).on('systemLogData', handler);
        joinSocketRoom('systemlog');

        return () => {
            (socket as any).off('systemLogData', handler);
            leaveSocketRoom('systemlog');
        };
    }, [limit, enabled]);

    return entries;
}

function RecentActionRow({ event, onClick }: { event: SystemLogEntry; onClick: () => void }) {
    const cfg = ACTION_LOG_CATEGORY_STYLES[event.category] ?? ACTION_LOG_DEFAULT_CATEGORY_STYLE;
    const timeStr = new Date(event.ts).toLocaleTimeString(undefined, timeOptions);

    return (
        <button
            type="button"
            onClick={onClick}
            className="hover:bg-secondary/30 flex w-full items-center gap-3 px-5 py-2 text-left text-sm transition-colors"
        >
            <span className="text-muted-foreground w-16 shrink-0 font-mono text-xs tabular-nums">{timeStr}</span>
            <span className="text-foreground shrink-0 font-semibold">{event.author}</span>
            <span className="text-muted-foreground min-w-0 flex-1 truncate">{event.action}</span>
            <span
                className={cn(
                    'shrink-0 rounded-full bg-current/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide',
                    cfg.text,
                )}
            >
                {cfg.label}
            </span>
        </button>
    );
}

export default function DashboardRecentActions() {
    const { hasPerm } = useAdminPerms();
    const canViewLog = hasPerm('txadmin.log.view');
    const entries = useRecentActions(MAX_ENTRIES, canViewLog);
    const [, navigate] = useLocation();

    if (!canViewLog) return null;

    return (
        <div className={cn(dashboardCardClass, 'flex min-h-80 flex-1 flex-col')}>
            <DashboardCardHeader icon={ClipboardListIcon} title="Recent Admin Actions">
                <button
                    type="button"
                    onClick={() => navigate('/system/action-log')}
                    className="text-accent hover:text-accent/80 text-xs font-medium transition-colors"
                >
                    View log →
                </button>
            </DashboardCardHeader>
            {entries.length === 0 ? (
                <div className="text-muted-foreground flex flex-1 items-center justify-center px-5 text-center text-sm">
                    No admin actions yet.
                </div>
            ) : (
                <div className="divide-border/30 flex flex-col divide-y pb-2">
                    {entries.map((event, idx) => (
                        <RecentActionRow
                            key={`${event.ts}-${idx}`}
                            event={event}
                            onClick={() => navigate('/system/action-log')}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
