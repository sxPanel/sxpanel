import { useCallback, useEffect } from 'react';
import ThreadPerfCard from './ThreadPerfCard';
import FullPerfCard from './FullPerfCard';
import DashboardPlayersCard from './DashboardPlayersCard';
import DashboardServerControls from './DashboardServerControls';
import DashboardMiniConsole from './DashboardMiniConsole';
import DashboardRecentActions from './DashboardRecentActions';
import DashboardOnlineNow from './DashboardOnlineNow';
import { useSetDashboardData } from './dashboardHooks';
import { getSocket, joinSocketRoom, leaveSocketRoom } from '@/lib/utils';
import ServerStatsCard from './ServerStatsCard';
import { useAtomValue } from 'jotai';
import { txConfigStateAtom } from '@/hooks/status';
import { useLocation } from 'wouter';
import { TxConfigState } from '@shared/enums';
import ModalCentralMessage from '@/components/ModalCentralMessage';
import GenericSpinner from '@/components/GenericSpinner';
import { useAddonWidgets } from '@/hooks/addons';
import { ErrorBoundary } from 'react-error-boundary';
import { createMockDashboardEvent } from './devMockData';
import { isDevMockStatusOptInEnabled } from '@/lib/devFlags';

function DashboardPageInner() {
    const setDashboardData = useSetDashboardData();
    const dashboardWidgets = useAddonWidgets('dashboard.main');
    const sidebarWidgets = useAddonWidgets('dashboard.sidebar');
    const applyDashboardData = useCallback(
        (nextData: any) => {
            setDashboardData(nextData);
        },
        [setDashboardData],
    );

    //Running on mount only
    useEffect(() => {
        const isDevMockMode = import.meta.env.DEV && isDevMockStatusOptInEnabled();
        if (isDevMockMode) {
            applyDashboardData(createMockDashboardEvent());
            const mockInterval = setInterval(() => {
                applyDashboardData(createMockDashboardEvent());
            }, 4_000);

            return () => {
                clearInterval(mockInterval);
            };
        }

        const socket = getSocket();

        const dashboardHandler = (data: any) => {
            applyDashboardData(data);
        };

        socket.on('dashboard', dashboardHandler);
        joinSocketRoom('dashboard');

        return () => {
            socket.off('dashboard', dashboardHandler);
            leaveSocketRoom('dashboard');
        };
    }, [applyDashboardData]);

    return (
        <div className="flex min-h-full w-full min-w-0 flex-1 flex-col gap-4">
            {/* Server status & controls: health, players, and stats side-by-side with start/stop/restart + scheduling */}
            <div className="flex w-full flex-col items-stretch gap-4 sm:flex-row">
                <div className="min-w-0 overflow-hidden sm:flex-1">
                    <DashboardServerControls />
                </div>
                <div className="min-w-0 overflow-hidden sm:flex-1">
                    <DashboardPlayersCard />
                </div>
                <div className="min-w-0 overflow-hidden sm:flex-1">
                    <ServerStatsCard />
                </div>
            </div>
            <DashboardMiniConsole />
            {/* Performance analytics: per-thread tick histogram beside the main timeline chart */}
            <div className="flex w-full flex-col items-stretch gap-4 xl:flex-row">
                <div className="min-w-0 overflow-hidden xl:w-96 xl:shrink-0">
                    <ThreadPerfCard />
                </div>
                <div className="flex min-w-0 flex-1 overflow-hidden">
                    <FullPerfCard />
                </div>
            </div>
            <div className="flex w-full flex-1 flex-col gap-4 lg:flex-row">
                <DashboardRecentActions />
                <DashboardOnlineNow />
            </div>
            {dashboardWidgets.length > 0 && (
                <div className="flex w-full flex-col gap-4 lg:flex-row lg:flex-wrap">
                    {dashboardWidgets.map((w) => (
                        <ErrorBoundary
                            key={`${w.addonId}-${w.title}`}
                            fallback={
                                <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-xl border p-4 text-sm">
                                    Addon widget error: {w.title}
                                </div>
                            }
                        >
                            <div
                                className={
                                    w.defaultSize === 'full'
                                        ? 'w-full'
                                        : w.defaultSize === 'quarter'
                                          ? 'min-w-0 flex-1'
                                          : 'min-w-0 flex-1 lg:flex-[2]'
                                }
                            >
                                <w.Component />
                            </div>
                        </ErrorBoundary>
                    ))}
                </div>
            )}
            {sidebarWidgets.length > 0 && (
                <div className="flex w-full flex-col gap-4 lg:flex-row lg:flex-wrap">
                    {sidebarWidgets.map((w) => (
                        <ErrorBoundary
                            key={`${w.addonId}-${w.title}`}
                            fallback={
                                <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-xl border p-4 text-sm">
                                    Addon widget error: {w.title}
                                </div>
                            }
                        >
                            <w.Component />
                        </ErrorBoundary>
                    ))}
                </div>
            )}

            {/* TODO: maybe convert in top server warning */}
            {/* <div className="mx-auto max-w-4xl w-full sm:w-auto sm:min-w-md relative overflow-hidden z-40 p-3 pr-10 flex items-center justify-between space-x-4 rounded-xl border shadow-lg transition-all text-black/75 dark:text-white/90 border-warning/70 bg-warning-hint animate-toastbar-enter opacity-50 hover:opacity-100">
                <div className="shrink-0 flex flex-col gap-2 items-center">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-warning stroke-warning animate-toastbar-icon">
                        <circle cx="12" cy="12" r="10"></circle>
                        <path d="M12 16v-4"></path>
                        <path d="M12 8h.01"></path>
                    </svg>
                </div>
                <div className="grow">
                    <span className="block whitespace-pre-line">
                        <b>This update changes how the performance chart show its data.</b> <br />
                        Now the histogram (colors) are based on the time spent on each bucket instead of the number of ticks. And the bucket boundaries (ms) may have changed to have a better resolution at lower tick times.
                    </span>
                </div>
            </div> */}
        </div>
    );
}

export default function DashboardPage() {
    const txConfigState = useAtomValue(txConfigStateAtom);
    const setLocation = useLocation()[1];

    useEffect(() => {
        if (txConfigState === TxConfigState.Setup) {
            setLocation('/server/setup');
        } else if (txConfigState === TxConfigState.Deployer) {
            setLocation('/server/deployer');
        }
    }, [txConfigState, setLocation]);

    if (txConfigState === TxConfigState.Setup || txConfigState === TxConfigState.Deployer) {
        return (
            <div className="flex size-full min-h-[12rem] items-center justify-center">
                <GenericSpinner msg="Loading…" />
            </div>
        );
    } else if (txConfigState !== TxConfigState.Ready) {
        return (
            <div className="size-full">
                <ModalCentralMessage>
                    <GenericSpinner msg={`Unknown Config State: ${String(txConfigState)}`} />
                </ModalCentralMessage>
            </div>
        );
    } else {
        return <DashboardPageInner />;
    }
}
