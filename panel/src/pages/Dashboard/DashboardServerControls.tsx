import { MegaphoneIcon, PowerIcon, PowerOffIcon, RotateCcwIcon, CalendarClockIcon, XCircleIcon } from 'lucide-react';
import { useAtomValue } from 'jotai';
import { txConfigStateAtom, globalStatusAtom } from '@/hooks/status';
import { TxConfigState, FxMonitorHealth } from '@shared/enums';
import { useServerControls, useServerExtraActions } from '@/layout/LeftSidebar';
import { KickAllIcon } from '@/components/KickIcons';
import { useLocale } from '@/hooks/locale';
import { dashboardCardClass, DashboardCardHeader } from './DashboardCard';
import { cn } from '@/lib/utils';

/** Small colored status pill shown in the card header. */
function ServerStatusBadge() {
    const status = useAtomValue(globalStatusAtom);
    const isRunning = status?.runner.isChildAlive ?? false;
    const isHealthy = status?.server.health === FxMonitorHealth.ONLINE;
    const label = isRunning ? (isHealthy ? 'Online' : 'Degraded') : 'Offline';
    const dotClass = isRunning && isHealthy ? 'bg-success' : isRunning ? 'bg-warning' : 'bg-muted-foreground/50';
    const textClass =
        isRunning && isHealthy ? 'text-success-inline' : isRunning ? 'text-warning-inline' : 'text-muted-foreground';
    const bgClass = isRunning && isHealthy ? 'bg-success/10' : isRunning ? 'bg-warning/10' : 'bg-secondary/50';

    return (
        <span
            className={cn(
                'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
                bgClass,
                textClass,
            )}
        >
            <span className={cn('size-1.5 shrink-0 rounded-full', dotClass, isRunning && 'animate-pulse')} />
            {label}
        </span>
    );
}

/** Primary power actions: large stop/start + restart buttons. */
function PowerControls() {
    const { isRunning, isAlive, hasControlPerm, handleControl } = useServerControls();
    const { t } = useLocale();

    return (
        <div className="flex gap-2">
            <button
                type="button"
                onClick={() => handleControl(isRunning ? 'stop' : 'start')}
                disabled={!hasControlPerm}
                className={cn(
                    'flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-40',
                    isRunning
                        ? 'border-destructive/40 bg-destructive/10 text-destructive-inline hover:bg-destructive/20'
                        : 'border-success/40 bg-success/10 text-success-inline hover:bg-success/20',
                )}
            >
                {isRunning ? <PowerOffIcon className="size-4" /> : <PowerIcon className="size-4" />}
                {isRunning ? t('panel.common.stop') : t('panel.common.start')}
            </button>
            <button
                type="button"
                onClick={() => handleControl('restart')}
                disabled={!hasControlPerm || !isAlive}
                className="border-info/40 bg-info/10 text-info-inline hover:bg-info/20 flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-40"
            >
                <RotateCcwIcon className="size-4" />
                {t('panel.common.restart')}
            </button>
        </div>
    );
}

/** Neutral secondary actions grid + next-restart status row. */
function QuickActions() {
    const {
        isChildAlive,
        nextScheduledText,
        nextScheduledClasses,
        hasAnnouncementPerm,
        hasControlPerm,
        canAdjustRestart,
        canCancelRestart,
        cancelLabel,
        adjustLabel,
        handleAnnounce,
        handleKickAll,
        handleSchedule,
        handleCancelRestart,
    } = useServerExtraActions();

    const actionBtnClass =
        'border-border/60 bg-secondary/25 text-muted-foreground hover:bg-secondary/60 hover:text-foreground flex h-9 items-center justify-center gap-1.5 rounded-lg border text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-40';

    return (
        <div className="flex flex-col gap-2.5">
            <div className="bg-secondary/25 border-border/40 flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                    <CalendarClockIcon className="size-3.5" />
                    Next restart
                </span>
                <span className={cn('font-mono text-xs font-semibold', nextScheduledClasses)}>{nextScheduledText}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
                <button
                    type="button"
                    onClick={handleAnnounce}
                    disabled={!hasAnnouncementPerm || !isChildAlive}
                    className={actionBtnClass}
                >
                    <MegaphoneIcon className="size-3.5" />
                    Announce
                </button>
                <button
                    type="button"
                    onClick={handleKickAll}
                    disabled={!hasControlPerm || !isChildAlive}
                    className={actionBtnClass}
                >
                    <KickAllIcon style={{ height: '0.85rem', width: '0.85rem', fill: 'currentcolor' }} />
                    Kick All
                </button>
                <button
                    type="button"
                    onClick={handleSchedule}
                    disabled={!canAdjustRestart}
                    className={actionBtnClass}
                    title={adjustLabel}
                >
                    <CalendarClockIcon className="size-3.5" />
                    Schedule
                </button>
                <button
                    type="button"
                    onClick={handleCancelRestart}
                    disabled={!canCancelRestart}
                    className={actionBtnClass}
                    title={cancelLabel}
                >
                    <XCircleIcon className="size-3.5" />
                    Cancel
                </button>
            </div>
        </div>
    );
}

/**
 * Dashboard-level start/stop/restart + quick schedule/announce/kick-all controls.
 * Same hooks/APIs as the sidebar & top nav controls, but with a card-native layout.
 */
export default function DashboardServerControls() {
    const txConfigState = useAtomValue(txConfigStateAtom);
    const isConfigured = txConfigState === TxConfigState.Ready;

    return (
        <div className={cn(dashboardCardClass, 'flex h-full min-h-80 flex-col')}>
            <DashboardCardHeader icon={PowerIcon} title="Server Controls">
                <ServerStatusBadge />
            </DashboardCardHeader>
            <div className="flex min-h-0 flex-1 flex-col justify-center gap-4 px-5 pb-5">
                {isConfigured ? (
                    <>
                        <PowerControls />
                        <QuickActions />
                    </>
                ) : (
                    <p className="text-muted-foreground/60 text-center text-sm">Server not configured yet.</p>
                )}
            </div>
        </div>
    );
}
