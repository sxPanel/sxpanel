import { ErrorBoundary } from 'react-error-boundary';
import type { ComponentType, ReactElement } from 'react';
import { isValidElement, lazy, Suspense, useEffect } from 'react';
import { Redirect, Route as WouterRoute, Switch, useLocation } from 'wouter';
import { PageErrorFallback } from '@/components/ErrorFallback';
import GenericSpinner from '@/components/GenericSpinner';
import { useAtomValue, useSetAtom } from 'jotai';
import { contentRefreshKeyAtom, pageErrorStatusAtom, useSetPageTitle } from '@/hooks/pages';
import { navigate as setLocation } from 'wouter/use-browser-location';
import { NUI_GEN } from '@/lib/nuiGen';

const NotFound = lazy(() => import('@/pages/NotFound'));
const UnauthorizedPage = lazy(() => import('@/pages/UnauthorizedPage'));
const PlayersPage = lazy(() => import('@/pages/Players/PlayersPage'));
const HistoryPage = lazy(() => import('@/pages/History/HistoryPage'));
const BanTemplatesPage = lazy(() => import('@/pages/BanTemplates/BanTemplatesPage'));
const SystemLogPage = lazy(() => import('@/pages/SystemLogPage'));
const ActionLogPage = lazy(() => import('@/pages/ActionLog/ActionLogPage'));
const ServerLogPage = lazy(() => import('@/pages/ServerLog/ServerLogPage'));
const AddLegacyBanPage = lazy(() => import('@/pages/AddLegacyBanPage'));
const ReportsPage = lazy(() => import('@/pages/Reports/ReportsPage'));
const AnalyticsPage = lazy(() => import('@/pages/Reports/AnalyticsPage'));
const PlayerDropsPage = lazy(() => import('@/pages/PlayerDropsPage/PlayerDropsPage'));
const SettingsPage = lazy(() => import('@/pages/Settings/SettingsPage'));
const AddonsManagerPage = lazy(() => import('@/pages/AddonsManagerPage'));
const FxUpdaterPage = lazy(() => import('@/pages/FxUpdater/FxUpdaterPage'));
const SelfUpdaterPage = lazy(() => import('@/pages/SelfUpdater/SelfUpdaterPage'));
const DeployerPage = lazy(() => import('@/pages/Deployer/DeployerPage'));
const DiagnosticsPage = lazy(() => import('@/pages/Diagnostics/DiagnosticsPage'));
const CfgEditorPage = lazy(() => import('@/pages/CfgEditorPage'));
import { useAdminPerms } from '@/hooks/auth';
import { useAddonLoader, type AddonPageRoute } from '@/hooks/addons';
import { useLocale } from '@/hooks/locale';
import { isEmbeddedInNuiMenu } from '@/lib/nuiEmbed';
import { openExternalLink } from '@/lib/navigation';
import { isPanelFeatureEnabled } from '@/lib/panelFeatures';
import type { PanelFeatureKey } from '@shared/otherTypes';
import { Button } from '@/components/ui/button';
import { GlobeIcon } from 'lucide-react';

const DashboardPage = lazy(() => import('@/pages/Dashboard/DashboardPage'));
const InsightsPage = lazy(() => import('@/pages/InsightsPage/InsightsPage'));
const LiveConsolePage = lazy(() => import('@/pages/LiveConsole/LiveConsolePage'));
const AdminManagerPage = lazy(() => import('@/pages/AdminManager/AdminManagerPage'));
const ResourcesPage = lazy(() => import('@/pages/ResourcesPage/ResourcesPage'));
const WhitelistPage = lazy(() => import('@/pages/Whitelist/WhitelistPage'));
const EmbedEditorPage = lazy(() => import('@/pages/Settings/EmbedEditorPage'));
const DeferralStudioPage = lazy(() => import('@/pages/Settings/DeferralStudioPage'));
const ThemeStudioPage = lazy(() => import('@/pages/Settings/ThemeStudioPage'));
const DiscordLogRoutesEditorPage = lazy(() => import('@/pages/Settings/DiscordLogRoutesEditorPage'));
const SetupPage = lazy(() => import('@/pages/SetupPage'));
const AdvancedPage = lazy(() => import('@/pages/AdvancedPage'));
const TestingPage = lazy(() => import('@/pages/TestingPage/TestingPage'));

function ConsoleSystemLogPage() {
    return (
        <Suspense fallback={<PageRouteFallback />}>
            <SystemLogPage pageName="console" />
        </Suspense>
    );
}

function RedirectToDangerZone() {
    return <Redirect to="/settings#danger-zone" replace />;
}

function RedirectToDiscordEmbedStatus() {
    return <Redirect to="/settings/discord-embed/status" replace />;
}

function RedirectToDeferralCards() {
    return <Redirect to="/settings#deferral-cards" replace />;
}

function NotFoundRoute() {
    const [location] = useLocation();
    const unmatchedPath = location.startsWith('/') ? location.slice(1) : location;

    return (
        <Suspense fallback={<PageRouteFallback />}>
            <NotFound params={{ '*': unmatchedPath }} />
        </Suspense>
    );
}

function PageRouteFallback() {
    return (
        <div className="flex w-full justify-center py-16">
            <GenericSpinner />
        </div>
    );
}

function renderRoutePage(Page: ComponentType | ReactElement) {
    if (isValidElement(Page)) return Page;

    const LazyPage = Page;
    return (
        <Suspense fallback={<PageRouteFallback />}>
            <LazyPage />
        </Suspense>
    );
}

type RouteType = {
    path: string;
    titleKey: string;
    permission?: string;
    /** Optional sxPanel page toggle (Settings → sxPanel → Panel Features). Redirects to "/" when disabled. */
    featureFlag?: PanelFeatureKey;
    Page: ComponentType | ReactElement;
};

const allRoutes: RouteType[] = [
    //Global Routes
    {
        path: '/players',
        titleKey: 'panel.routes.players',
        Page: PlayersPage,
    },
    {
        path: '/history',
        titleKey: 'panel.routes.history',
        featureFlag: 'historyPage',
        Page: HistoryPage,
    },
    {
        path: '/reports',
        titleKey: 'panel.routes.reports',
        permission: 'players.reports',
        Page: ReportsPage,
    },
    {
        path: '/reports/analytics',
        titleKey: 'panel.routes.report_analytics',
        permission: 'players.reports',
        featureFlag: 'reportAnalyticsPage',
        Page: AnalyticsPage,
    },
    {
        path: '/insights',
        titleKey: 'panel.routes.insights',
        featureFlag: 'insightsPage',
        Page: InsightsPage,
    },
    {
        path: '/server/player-drops',
        titleKey: 'panel.routes.player_drops',
        featureFlag: 'playerDropsPage',
        Page: PlayerDropsPage,
    },
    {
        path: '/whitelist',
        titleKey: 'panel.routes.whitelist',
        featureFlag: 'whitelistPage',
        Page: WhitelistPage,
    },
    {
        path: '/admins',
        titleKey: 'panel.routes.admins',
        permission: 'manage.admins',
        Page: AdminManagerPage,
    },
    {
        path: '/settings',
        titleKey: 'panel.routes.settings',
        permission: 'settings.view',
        Page: SettingsPage,
    },
    {
        path: '/addons',
        titleKey: 'panel.routes.addons',
        permission: 'all_permissions',
        featureFlag: 'addonsPage',
        Page: AddonsManagerPage,
    },
    {
        // Legacy route — destructive actions moved to /settings#danger-zone.
        // Kept so old bookmarks/links keep working; the page just redirects.
        path: '/system/master-actions',
        titleKey: 'panel.routes.master_actions',
        Page: RedirectToDangerZone,
    },
    {
        path: '/system/diagnostics',
        titleKey: 'panel.routes.diagnostics',
        Page: DiagnosticsPage,
    },
    {
        path: '/system/artifacts',
        titleKey: 'panel.routes.artifacts',
        permission: 'all_permissions',
        Page: FxUpdaterPage,
    },
    {
        path: '/system/panel-update',
        titleKey: 'panel.routes.panel_update',
        permission: 'all_permissions',
        Page: SelfUpdaterPage,
    },
    {
        path: '/system/console-log',
        titleKey: 'panel.routes.console_log',
        permission: 'txadmin.log.view',
        featureFlag: 'consoleLogPage',
        Page: ConsoleSystemLogPage,
    },
    {
        path: '/system/action-log',
        titleKey: 'panel.routes.action_log',
        permission: 'txadmin.log.view',
        featureFlag: 'actionLogPage',
        Page: ActionLogPage,
    },

    //Server Routes
    {
        path: '/',
        titleKey: 'panel.routes.dashboard',
        Page: DashboardPage,
    },
    {
        path: '/server/console',
        titleKey: 'panel.routes.live_console',
        permission: 'console.view',
        Page: LiveConsolePage,
    },
    {
        path: '/server/resources',
        titleKey: 'panel.routes.resources',
        featureFlag: 'resourcesPage',
        Page: ResourcesPage,
    },
    {
        path: '/server/server-log',
        titleKey: 'panel.routes.server_log',
        permission: 'server.log.view',
        featureFlag: 'serverLogPage',
        Page: ServerLogPage,
    },
    {
        path: '/server/cfg-editor',
        titleKey: 'panel.routes.cfg_editor',
        permission: 'server.cfg.editor',
        featureFlag: 'cfgEditorPage',
        Page: CfgEditorPage,
    },
    {
        path: '/server/setup',
        titleKey: 'panel.routes.server_setup',
        permission: 'master',
        Page: SetupPage,
    },
    {
        path: '/server/deployer',
        titleKey: 'panel.routes.server_deployer',
        permission: 'master',
        Page: DeployerPage,
    },
    {
        path: '/advanced',
        titleKey: 'panel.routes.advanced',
        permission: 'all_permissions',
        Page: AdvancedPage,
    },

    //No nav routes
    {
        path: '/settings/ban-templates',
        titleKey: 'panel.routes.ban_templates',
        //NOTE: content is readonly for unauthorized accounts
        Page: BanTemplatesPage,
    },
    {
        path: '/settings/embed-editor',
        titleKey: 'panel.routes.embed_editor',
        permission: 'settings.write',
        Page: RedirectToDiscordEmbedStatus,
    },
    {
        path: '/settings/discord-embed/:variant',
        titleKey: 'panel.routes.embed_editor',
        permission: 'settings.write',
        Page: EmbedEditorPage,
    },
    {
        path: '/settings/deferral-studio',
        titleKey: 'panel.routes.deferral_studio',
        permission: 'settings.write',
        Page: DeferralStudioPage,
    },
    {
        path: '/settings/theme-studio/:themeId',
        titleKey: 'panel.routes.theme_studio',
        permission: 'settings.write',
        Page: ThemeStudioPage,
    },
    {
        path: '/settings/deferral-editor/:scenarioId',
        titleKey: 'panel.routes.deferral_editor',
        permission: 'settings.write',
        Page: RedirectToDeferralCards,
    },
    {
        path: '/settings/discord-logs',
        titleKey: 'panel.routes.discord_logs',
        permission: 'settings.write',
        Page: DiscordLogRoutesEditorPage,
    },
    {
        path: '/ban-identifiers',
        titleKey: 'panel.routes.ban_identifiers',
        Page: AddLegacyBanPage,
    },
];

//Routes that cannot run inside the in-game menu iframe (need a full browser/OAuth)
const nuiBlockedRoutePaths = ['/server/setup', '/server/deployer'];

function NuiBlockedRoutePage({ pageName, routePath }: { pageName: string; routePath: string }) {
    const { t } = useLocale();

    const handleOpenInBrowser = () => {
        openExternalLink(`https://${NUI_GEN.resourceName}${routePath}`);
    };

    return (
        <div className="flex w-full items-center justify-center">
            <div className="border-border/50 bg-card/60 flex max-w-md flex-col items-center gap-3 rounded-xl border p-8 text-center">
                <GlobeIcon className="text-muted-foreground size-10" />
                <h2 className="text-foreground text-lg font-semibold">
                    {t('panel.nui_embed.blocked_route_title', { page: pageName })}
                </h2>
                <p className="text-muted-foreground text-sm">{t('panel.nui_embed.blocked_route_desc')}</p>
                <Button type="button" variant="secondary" onClick={handleOpenInBrowser}>
                    {t('panel.nui_embed.blocked_route_open_browser')}
                </Button>
            </div>
        </div>
    );
}

function RouteContent({ route }: { route: RouteType }) {
    const { hasPerm } = useAdminPerms();
    const setPageTitle = useSetPageTitle();
    const { t } = useLocale();
    const pageTitle = t(route.titleKey);

    useEffect(() => {
        setPageTitle(pageTitle);
    }, [pageTitle, setPageTitle]);

    if (route.path.startsWith('/reports') && !window.txConsts.reportsEnabled) {
        return <Redirect to="/" replace />;
    }

    if (route.featureFlag && !isPanelFeatureEnabled(route.featureFlag)) {
        return <Redirect to="/" replace />;
    }

    if (isEmbeddedInNuiMenu() && nuiBlockedRoutePaths.includes(route.path)) {
        return <NuiBlockedRoutePage pageName={pageTitle} routePath={route.path} />;
    }

    if (route.permission && !hasPerm(route.permission)) {
        return (
            <Suspense fallback={<PageRouteFallback />}>
                <UnauthorizedPage pageName={pageTitle} permission={route.permission} />
            </Suspense>
        );
    }

    return renderRoutePage(route.Page);
}

function Route(route: RouteType) {
    return (
        <WouterRoute path={route.path}>
            <RouteContent route={route} />
        </WouterRoute>
    );
}

function AddonRouteContent({ route }: { route: AddonPageRoute }) {
    const { hasPerm } = useAdminPerms();
    const setPageTitle = useSetPageTitle();

    useEffect(() => {
        setPageTitle(route.title);
    }, [route.title, setPageTitle]);

    if (route.permission && !hasPerm(route.permission)) {
        return (
            <Suspense fallback={<PageRouteFallback />}>
                <UnauthorizedPage pageName={route.title} permission={route.permission} />
            </Suspense>
        );
    }
    return (
        <div className="relative w-full flex-1">
            <div className="absolute inset-0 overflow-auto">
                <route.Component />
            </div>
        </div>
    );
}

function MainRouterInner() {
    const { pages: addonPages, loading: addonsLoading } = useAddonLoader();

    return (
        <Switch>
            {allRoutes.map((route) => (
                <Route key={route.path} {...route} />
            ))}

            {/* Addon Routes - WouterRoute must be the direct Switch child
                so that Switch can read props.path for matching. */}
            {addonPages.map((route) => (
                <WouterRoute key={route.path} path={route.path}>
                    <AddonRouteContent route={route} />
                </WouterRoute>
            ))}

            {/* While addons are loading, don't show NotFound for addon paths */}
            {addonsLoading && <WouterRoute path="/addon/:rest*">{null}</WouterRoute>}

            {/* Other Routes - they need to set the title manually */}
            {import.meta.env.DEV && (
                <WouterRoute path="/test">
                    <Suspense fallback={<PageRouteFallback />}>
                        <TestingPage />
                    </Suspense>
                </WouterRoute>
            )}
            <WouterRoute>
                <NotFoundRoute />
            </WouterRoute>
        </Switch>
    );
}

export default function MainRouter() {
    const setPageErrorStatus = useSetAtom(pageErrorStatusAtom);
    const contentRefreshKey = useAtomValue(contentRefreshKeyAtom);

    return (
        <ErrorBoundary
            key={contentRefreshKey}
            FallbackComponent={PageErrorFallback}
            onError={() => {
                console.log('Page ErrorBoundary caught an error');
                setPageErrorStatus(true);
            }}
            onReset={() => {
                console.log('Page ErrorBoundary reset');
                setLocation('/');
                setPageErrorStatus(false);
            }}
        >
            <MainRouterInner />
        </ErrorBoundary>
    );
}
