import { useEventListener } from 'usehooks-ts';
import { lazy, Suspense, useEffect } from 'react';
import MainRouter from './MainRouter';
import { useAuth, useExpireAuthData } from '../hooks/auth';
import { Header } from './Header';
import MainSheets from './MainSheets';
import WarningBar from './WarningBar';
import AddonWarningBar from './AddonWarningBar';
import TxToaster from '@/components/TxToaster';
import { useOpenAccountModal } from '@/hooks/dialogs';
import { playerModalUrlParam, useOpenPlayerModal } from '@/hooks/playerModal';
import { useLocation } from 'wouter';
import { navigate as setLocation } from 'wouter/use-browser-location';
import { isValidRedirectPath } from '@/lib/redirectValidation';
import MainSocket from './MainSocket';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useToggleTheme } from '@/hooks/theme';
import { hotkeyEventListener } from '@/lib/hotkeyEventListener';
import { actionModalUrlParam, useOpenActionModal } from '@/hooks/actionModal';
import TopNav from './TopNav';
import { useAtomValue } from 'jotai';
import { pageHeaderAtom } from '@/hooks/pages';
import { useDynamicScale } from '@/hooks/useDynamicScale';
import { cn } from '@/lib/utils';
import { useShellViewportStyles } from '@/hooks/useShellViewportStyles';
import { isEmbeddedInNuiMenu, postToNuiParent } from '@/lib/nuiEmbed';

const AccountDialog = lazy(() => import('@/components/AccountDialog'));
const PlayerModal = lazy(() => import('./PlayerModal/PlayerModal'));
const ActionModal = lazy(() => import('./ActionModal/ActionModal'));
const OnboardingOverlay = lazy(() => import('./OnboardingOverlay'));
const PlayerlistSidebar = lazy(() =>
    import('./PlayerlistSidebar/PlayerlistSidebar').then((module) => ({ default: module.PlayerlistSidebar })),
);
const WelcomeAfterInstallHost = lazy(() => import('@/components/tutorial/WelcomeAfterInstallHost'));
const FullInstallTourHost = lazy(() => import('@/components/tutorial/FullInstallTourHost'));
const PostInstallTourHost = lazy(() => import('@/components/tutorial/PostInstallTourHost'));
const ConfirmDialog = lazy(() => import('@/components/ConfirmDialog'));
const PromptDialog = lazy(() => import('@/components/PromptDialog'));

export default function MainShell() {
    const { authData } = useAuth();
    const expireSession = useExpireAuthData();
    const openAccountModal = useOpenAccountModal();
    const openPlayerModal = useOpenPlayerModal();
    const openActionModal = useOpenActionModal();
    const toggleTheme = useToggleTheme();
    const { scaledViewportMode } = useShellViewportStyles();
    const isCompactScaledViewport = scaledViewportMode === 'compact';

    // Expose modal openers so addons can call them directly
    (window as any).txAddonApi = (window as any).txAddonApi || {};
    (window as any).txAddonApi.openPlayerModal = openPlayerModal;

    //Listener for messages from child iframes (legacy routes) or other sources
    useEventListener('message', (e: TxMessageEvent) => {
        if (e.origin !== window.location.origin) return;

        if (e.data.type === 'logoutNotice') {
            expireSession('child iframe', 'got logoutNotice');
        } else if (e.data.type === 'openAccountModal') {
            openAccountModal();
        } else if (e.data.type === 'openPlayerModal') {
            openPlayerModal(e.data.ref);
        } else if (e.data.type === 'navigateToPage') {
            if (!isValidRedirectPath(e.data.href)) return;
            setLocation(e.data.href);
        } else if (e.data.type === 'globalHotkey' && e.data.action === 'toggleLightMode') {
            toggleTheme();
        }
    });

    useEffect(() => {
        if (!authData) return;
        if (authData.isTempPassword) {
            openAccountModal('password');
            return;
        }
        if (window.txConsts.requireAdminTwoFactor && !authData.totpEnabled) {
            openAccountModal('security');
        }
    }, [authData, openAccountModal]);

    //auto open the player or action modals
    useEffect(() => {
        const pageUrl = new URL(window.location.toString());
        const playerModalRef = pageUrl.searchParams.get(playerModalUrlParam);
        const actionModalRef = pageUrl.searchParams.get(actionModalUrlParam);
        if (!playerModalRef && !actionModalRef) return;

        if (playerModalRef) {
            if (playerModalRef.includes('#')) {
                const [mutex, rawNetid] = playerModalRef.split('#');
                const netid = parseInt(rawNetid, 10);
                if (mutex.length && rawNetid.length && !isNaN(netid)) {
                    openPlayerModal({ mutex, netid });
                }
            } else if (playerModalRef.length) {
                openPlayerModal({ license: playerModalRef });
            }
        } else if (actionModalRef && actionModalRef.length) {
            openActionModal(actionModalRef);
        }

        //Remove the query params
        pageUrl.searchParams.delete(playerModalUrlParam);
        pageUrl.searchParams.delete(actionModalUrlParam);
        window.history.replaceState({}, '', pageUrl);
    }, []);

    const isNuiEmbed = isEmbeddedInNuiMenu();

    useEffect(() => {
        const densityMode = isCompactScaledViewport ? 'compact' : 'default';
        document.documentElement.dataset.txShellDensity = densityMode;

        return () => {
            delete document.documentElement.dataset.txShellDensity;
        };
    }, [isCompactScaledViewport]);

    //Listens to hotkeys (doesn't work if the focus is on an iframe)
    useEventListener('keydown', hotkeyEventListener);

    //Tell the in-game menu host the shell is interactive (clears its loading state)
    useEffect(() => {
        if (!isEmbeddedInNuiMenu()) return;
        postToNuiParent({ type: 'panelReady' });
    }, []);

    const [location] = useLocation();
    const isImmersiveEditorRoute =
        location.startsWith('/settings/deferral-studio') ||
        location.startsWith('/settings/deferral-editor') ||
        location.startsWith('/settings/discord-embed');
    const pageHeader = useAtomValue(pageHeaderAtom);
    const { containerRef, contentRef } = useDynamicScale<HTMLDivElement, HTMLDivElement>({
        maxScale: 0.94,
        // Never zoom-scale inside the menu iframe — must match the browser 1:1.
        enabled: !isImmersiveEditorRoute && isCompactScaledViewport && !isNuiEmbed,
    });

    useEffect(() => {
        if (isImmersiveEditorRoute) {
            document.documentElement.dataset.txImmersiveEditor = '';
        } else {
            delete document.documentElement.dataset.txImmersiveEditor;
        }
        return () => {
            delete document.documentElement.dataset.txImmersiveEditor;
        };
    }, [isImmersiveEditorRoute]);

    return (
        <>
            <TooltipProvider delayDuration={300} disableHoverableContent={true}>
                {/* Full-height column layout: top nav (desktop) / header (mobile), then scrollable content */}
                <div
                    className={cn(
                        'tx-shell-root flex flex-col overflow-hidden',
                        isNuiEmbed ? 'h-full min-h-0' : 'h-screen',
                    )}
                >
                    {/* Desktop top nav (shown at >= lg, hidden on mobile where the header takes over) */}
                    {!isImmersiveEditorRoute ? <TopNav /> : null}
                    {/* Mobile top header (shown on < lg, hidden on desktop where the top nav takes over) */}
                    {!isImmersiveEditorRoute ? <Header /> : null}

                    {/* Scrollable page area (auto-scaled to fit; scroll is a fallback if we hit the minimum zoom) */}
                    <div
                        ref={containerRef}
                        className={cn(
                            'flex flex-1',
                            isImmersiveEditorRoute ? 'min-h-0 overflow-hidden' : 'overflow-auto',
                        )}
                    >
                        <div
                            ref={contentRef}
                            className={cn(
                                'flex w-full flex-col',
                                isImmersiveEditorRoute
                                    ? 'max-h-contentvh h-full min-h-0 max-w-none px-3 py-2 md:px-4 md:py-3'
                                    : cn(
                                          'min-h-full w-full max-w-none px-3 pt-(--page-pt) pb-(--page-pb) md:px-5 2xl:px-8',
                                      ),
                            )}
                        >
                            {pageHeader}
                            {/*
                                No min-h-0 here: pages that use a fixed h-contentvh/max-h-contentvh
                                box are unaffected (their height is a definite var(), not derived from
                                this row), but pages that flow naturally taller than one screen (e.g.
                                the dashboard with many cards) need this row's automatic min-height to
                                grow with that content so the playerlist sidebar (min-h-contentvh)
                                stretches to match instead of being capped at one screen while the
                                main column overflows past it.
                            */}
                            <div className="flex w-full flex-1 flex-row gap-4">
                                <main className="flex min-w-0 flex-1">
                                    <MainRouter />
                                </main>
                                {window.txConsts.isWebInterface && !isImmersiveEditorRoute ? (
                                    <Suspense fallback={null}>
                                        <PlayerlistSidebar />
                                    </Suspense>
                                ) : null}
                            </div>
                        </div>
                    </div>
                </div>

                <MainSheets />
                <WarningBar />
                <AddonWarningBar />
                <Suspense fallback={null}>
                    <ConfirmDialog />
                </Suspense>
                <Suspense fallback={null}>
                    <PromptDialog />
                </Suspense>
                <TxToaster />
                <Suspense fallback={null}>
                    <AccountDialog />
                </Suspense>
                <Suspense fallback={null}>
                    <PlayerModal />
                </Suspense>
                <Suspense fallback={null}>
                    <ActionModal />
                </Suspense>
                <MainSocket />
                <Suspense fallback={null}>
                    <OnboardingOverlay />
                </Suspense>
                <Suspense fallback={null}>
                    <WelcomeAfterInstallHost />
                </Suspense>
                <Suspense fallback={null}>
                    <FullInstallTourHost />
                </Suspense>
                <Suspense fallback={null}>
                    <PostInstallTourHost />
                </Suspense>
                {/* <BreakpointDebugger /> */}
            </TooltipProvider>
        </>
    );
}
