import { txDevEnv } from '@core/globalData';
import Router from '@koa/router';
import KoaRateLimit from 'koa-ratelimit';

import * as routes from '@routes/index';
import { apiAuthMw, assetAuthMw, hostAuthMw, intercomAuthMw, webAuthMw } from './middlewares/authMws';
import { wrapRoute } from '@lib/wrapRoute';

/**
 * Router factory
 */
export default () => {
    const router = new Router();
    const authLimiter = KoaRateLimit({
        driver: 'memory',
        db: new Map(),
        duration: txConfig.webServer.limiterMinutes * 60 * 1000, // 15 minutes
        errorMessage: JSON.stringify({
            //Duplicated to maintain compatibility with all auth api routes
            error: `Too many attempts. Blocked for ${txConfig.webServer.limiterMinutes} minutes.`,
            errorTitle: 'Too many attempts.',
            errorMessage: `Blocked for ${txConfig.webServer.limiterMinutes} minutes.`,
        }),
        max: txConfig.webServer.limiterAttempts,
        disableHeader: true,
        id: (ctx: any) => ctx.txVars.realIP,
    });

    // TTL Map subclass for rate limiters — auto-evicts expired entries
    // Must extend Map so koa-ratelimit's `db instanceof Map` assertion passes.
    class TtlMap extends Map<string, any> {
        private _expiry = new Map<string, number>();
        constructor(private _ttlMs: number) {
            super();
            setInterval(() => {
                const now = Date.now();
                for (const [key, exp] of this._expiry) {
                    if (now > exp) this.delete(key);
                }
            }, 60_000).unref();
        }
        override get(key: string) {
            const exp = this._expiry.get(key);
            if (exp !== undefined && Date.now() > exp) {
                this.delete(key);
                return undefined;
            }
            return super.get(key);
        }
        override set(key: string, value: any) {
            this._expiry.set(key, Date.now() + this._ttlMs);
            return super.set(key, value);
        }
        override has(key: string) {
            return this.get(key) !== undefined;
        }
        override delete(key: string) {
            this._expiry.delete(key);
            return super.delete(key);
        }
        override clear() {
            this._expiry.clear();
            return super.clear();
        }
    }

    // Rate limiter for mutation endpoints (kick, ban, warn, etc.) — stricter
    const mutationLimiter = KoaRateLimit({
        driver: 'memory',
        db: new TtlMap(60_000),
        duration: 60 * 1000, // 1 minute window
        errorMessage: JSON.stringify({
            error: 'Too many requests. Please slow down.',
        }),
        max: 30,
        disableHeader: true,
        id: (ctx: any) => ctx.txVars.realIP,
    });

    // Rate limiter for read endpoints (search, logs, data) — moderate
    // All read-limited routes share a single bucket per IP, so the limit
    // must accommodate concurrent SWR revalidation across multiple pages.
    const readLimiter = KoaRateLimit({
        driver: 'memory',
        db: new TtlMap(60_000),
        duration: 60 * 1000, // 1 minute window
        errorMessage: JSON.stringify({
            error: 'Too many requests. Please slow down.',
        }),
        max: 600,
        disableHeader: true,
        id: (ctx: any) => ctx.txVars.realIP,
    });

    //Legacy Rendered Pages (kept for backwards compatibility, some still used by other routes)
    //router.get('/legacy/adminManager', webAuthMw, routes.adminManager_page);
    //router.get('/legacy/advanced', webAuthMw, routes.advanced_page);
    //router.get('/legacy/cfgEditor', webAuthMw, routes.cfgEditor_page);
    //router.get('/legacy/diagnostics', webAuthMw, routes.diagnostics_page);
    //router.get('/legacy/masterActions', webAuthMw, routes.masterActions_page);
    //router.get('/legacy/resources', webAuthMw, routes.resources);
    //router.get('/legacy/whitelist', webAuthMw, routes.whitelist_page);
    //router.get('/legacy/setup', webAuthMw, routes.setup_get);
    //router.get('/legacy/deployer', webAuthMw, routes.deployer_stepper);

    // Deferral card SVG assets (public — loaded by FiveM client during connection, no session cookie)
    router.get('/deferral-card-assets/:scenarioId/:elementId', routes.deferral_card_asset);
    router.get('/deferral-card-logo.png', routes.deferral_card_logo);

    //Authentication
    router.get('/auth/self', apiAuthMw, wrapRoute('AuthSelf', routes.auth_self));
    router.post('/auth/password', authLimiter, routes.auth_verifyPassword);
    router.post('/auth/logout', authLimiter, apiAuthMw, wrapRoute('AuthLogout', routes.auth_logout));
    router.post('/auth/addMaster/pin', authLimiter, wrapRoute('AddMasterPin', routes.auth_addMasterPin));
    router.post('/auth/addMaster/callback', authLimiter, routes.auth_addMasterCallback);
    router.post('/auth/addMaster/save', authLimiter, routes.auth_addMasterSave);
    router.get('/auth/cfxre/redirect', authLimiter, wrapRoute('CfxreRedirect', routes.auth_cfxreRedirect));
    router.post('/auth/cfxre/callback', authLimiter, routes.auth_cfxreCallback);
    router.get('/auth/discord/redirect', authLimiter, wrapRoute('DiscordRedirect', routes.auth_discordRedirect));
    router.post('/auth/discord/callback', authLimiter, routes.auth_discordCallback);
    router.post('/auth/changePassword', apiAuthMw, routes.auth_changePassword);
    router.get('/auth/getIdentifiers', apiAuthMw, wrapRoute('GetIdentifiers', routes.auth_getIdentifiers));
    router.post('/auth/changeIdentifiers', apiAuthMw, routes.auth_changeIdentifiers);

    //TOTP 2FA
    router.post('/auth/totp/setup', apiAuthMw, routes.auth_totpSetup);
    router.post('/auth/totp/confirm', apiAuthMw, routes.auth_totpConfirm);
    router.post('/auth/totp/verify', authLimiter, routes.auth_totpVerify);
    router.post('/auth/totp/disable', authLimiter, apiAuthMw, routes.auth_totpDisable);

    //Admin Manager
    router.get('/adminManager/list', apiAuthMw, routes.adminManager_list);
    router.get('/adminManager/stats', apiAuthMw, routes.adminManager_stats);
    router.get('/adminManager/adminActions', apiAuthMw, routes.adminManager_adminActions);
    router.get('/adminManager/presets', apiAuthMw, routes.adminManager_getPresets);
    router.post('/adminManager/presets', apiAuthMw, routes.adminManager_savePresets);
    router.post(
        '/adminManager/getModal/:modalType',
        apiAuthMw,
        wrapRoute('AdminGetModal', routes.adminManager_getModal),
    );
    router.post('/adminManager/:action', apiAuthMw, routes.adminManager_actions);

    //Settings
    router.get('/setup/data', apiAuthMw, routes.setup_get);
    router.post('/setup/:action', apiAuthMw, routes.setup_post);
    router.get('/deployer/data', apiAuthMw, routes.deployer_stepper);
    router.get('/deployer/status', apiAuthMw, routes.deployer_status);
    router.post('/deployer/recipe/:action', apiAuthMw, routes.deployer_actions);
    router.get('/settings/configs', apiAuthMw, wrapRoute('GetConfigs', routes.settings_getConfigs));
    router.get('/deferral/addon-meta', apiAuthMw, wrapRoute('DeferralAddonMeta', routes.deferral_addon_meta));
    router.get('/settings/localePhrases', apiAuthMw, wrapRoute('GetLocalePhrases', routes.settings_getLocalePhrases));
    router.post('/settings/configs/:card', apiAuthMw, mutationLimiter, routes.settings_saveConfigs);
    router.get('/settings/banTemplates', apiAuthMw, routes.settings_getBanTemplates);
    router.post('/settings/banTemplates', apiAuthMw, mutationLimiter, routes.settings_saveBanTemplates);
    router.get('/settings/customThemes', apiAuthMw, routes.settings_getCustomThemes);
    router.post('/settings/customThemes', apiAuthMw, mutationLimiter, routes.settings_saveCustomThemes);
    router.get('/settings/customCommands', apiAuthMw, routes.customCommands_get);
    router.post('/settings/customCommands', apiAuthMw, mutationLimiter, routes.customCommands_save);
    router.post('/settings/resetServerDataPath', apiAuthMw, mutationLimiter, routes.settings_resetServerDataPath);
    router.get('/discord/guild-roles', apiAuthMw, wrapRoute('DiscordGuildRoles', routes.discord_guildRoles));

    //Master Actions
    router.get('/masterActions/backupDatabase', apiAuthMw, routes.masterActions_getBackup);
    router.post('/masterActions/backupDatabase', apiAuthMw, routes.masterActions_getBackup);
    router.post('/masterActions/:action', apiAuthMw, mutationLimiter, routes.masterActions_actions);

    //FXServer
    router.post('/fxserver/controls', apiAuthMw, mutationLimiter, wrapRoute('FxControls', routes.fxserver_controls));
    router.post('/fxserver/commands', apiAuthMw, mutationLimiter, wrapRoute('FxCommands', routes.fxserver_commands));
    router.post('/fxserver/schedule', apiAuthMw, mutationLimiter, routes.fxserver_schedule);
    router.get('/fxserver/artifacts', apiAuthMw, routes.fxserver_updateStatus);
    router.post(
        '/fxserver/artifacts/download',
        apiAuthMw,
        wrapRoute('FxUpdateDownload', routes.fxserver_updateDownload),
    );
    router.post('/fxserver/artifacts/apply', apiAuthMw, wrapRoute('FxUpdateApply', routes.fxserver_updateApply));

    //sxPanel self-updater
    router.get('/panel/update', apiAuthMw, wrapRoute('SelfUpdateStatus', routes.selfUpdater_status));
    router.post('/panel/update/download', apiAuthMw, wrapRoute('SelfUpdateDownload', routes.selfUpdater_download));
    router.post('/panel/update/apply', apiAuthMw, wrapRoute('SelfUpdateApply', routes.selfUpdater_apply));

    //CFG Editor
    router.get('/cfgEditor/data', apiAuthMw, routes.cfgEditor_page);
    router.get('/cfgEditor/files', apiAuthMw, routes.cfgEditor_listFiles);
    router.post('/cfgEditor/save', apiAuthMw, routes.cfgEditor_save);

    //Resources
    router.get('/resources/list', apiAuthMw, wrapRoute('ResourcesList', routes.resources_list));
    router.get('/resources/download', apiAuthMw, wrapRoute('ResourcesDownload', routes.resources_download));
    router.post('/resources/download', apiAuthMw, wrapRoute('ResourcesDownload', routes.resources_download));

    //Control routes
    router.post('/intercom/:scope', intercomAuthMw, routes.intercom);

    //Diagnostic routes
    router.get('/diagnostics/data', apiAuthMw, routes.diagnostics_page);
    router.post('/diagnostics/discordBot/:action', apiAuthMw, routes.diagnostics_actions);
    router.post('/diagnostics/sendReport', apiAuthMw, routes.diagnostics_sendReport);
    router.get('/advanced/data', apiAuthMw, routes.advanced_page);
    router.post('/advanced', apiAuthMw, routes.advanced_actions);

    //Log routes
    router.get('/logs/server/partial', apiAuthMw, readLimiter, wrapRoute('ServerLogPartial', routes.serverLogPartial));
    router.get(
        '/logs/server/sessions',
        apiAuthMw,
        readLimiter,
        wrapRoute('ServerLogSessions', routes.serverLogSessions),
    );
    router.get(
        '/logs/server/session',
        apiAuthMw,
        readLimiter,
        wrapRoute('ServerLogSession', routes.serverLogSessionFile),
    );
    router.get('/logs/server/download', apiAuthMw, wrapRoute('ServerLogDownload', routes.downloadServerLog));
    router.post('/logs/server/download', apiAuthMw, wrapRoute('ServerLogDownload', routes.downloadServerLog));
    router.get('/logs/system/partial', apiAuthMw, readLimiter, wrapRoute('SystemLogPartial', routes.systemLogPartial));
    router.get(
        '/logs/system/sessions',
        apiAuthMw,
        readLimiter,
        wrapRoute('SystemLogSessions', routes.systemLogSessions),
    );
    router.get(
        '/logs/system/session',
        apiAuthMw,
        readLimiter,
        wrapRoute('SystemLogSession', routes.systemLogSessionFile),
    );
    router.get('/logs/system/download', apiAuthMw, wrapRoute('SystemLogDownload', routes.downloadSystemLog));
    router.post('/logs/system/download', apiAuthMw, wrapRoute('SystemLogDownload', routes.downloadSystemLog));
    router.get('/logs/system/:scope', apiAuthMw, wrapRoute('SystemLogScoped', routes.systemLogScoped));
    router.get('/logs/fxserver/download', apiAuthMw, wrapRoute('FxLogDownload', routes.downloadFxserverLog));
    router.post('/logs/fxserver/download', apiAuthMw, wrapRoute('FxLogDownload', routes.downloadFxserverLog));

    router.get('/perfChartData/:thread', apiAuthMw, routes.perfChart);
    router.get('/playerDropsData', apiAuthMw, routes.playerDrops);
    router.get('/insights/playerCount', apiAuthMw, routes.insights_playerCount);
    router.get('/insights/newPlayers', apiAuthMw, routes.insights_newPlayers);
    router.get('/insights/topPlayers', apiAuthMw, routes.insights_topPlayers);
    router.get('/insights/playtimeDist', apiAuthMw, routes.insights_playtimeDist);
    router.get('/insights/retention', apiAuthMw, routes.insights_retention);
    router.get('/insights/uptimeTimeline', apiAuthMw, routes.insights_uptimeTimeline);
    router.get('/insights/disconnectReasons', apiAuthMw, routes.insights_disconnectReasons);
    router.get('/insights/peakHours', apiAuthMw, routes.insights_peakHours);
    router.get('/insights/actionsTimeline', apiAuthMw, routes.insights_actionsTimeline);
    router.get('/insights/playerGrowth', apiAuthMw, routes.insights_playerGrowth);
    router.get('/insights/sessionLength', apiAuthMw, routes.insights_sessionLength);
    router.get('/insights/dailyPlayers', apiAuthMw, routes.insights_dailyPlayers);

    //History routes
    router.get('/history/stats', apiAuthMw, readLimiter, routes.history_stats);
    router.get('/history/search', apiAuthMw, readLimiter, wrapRoute('HistorySearch', routes.history_search));
    router.get('/history/action', apiAuthMw, readLimiter, routes.history_actionModal);
    router.post('/history/:action', apiAuthMw, mutationLimiter, routes.history_actions);

    //Player routes
    router.get('/player', apiAuthMw, readLimiter, routes.player_modal);
    router.get('/player/stats', apiAuthMw, readLimiter, routes.player_stats);
    router.get('/player/search', apiAuthMw, readLimiter, wrapRoute('PlayerSearch', routes.player_search));
    router.post('/player/checkJoin', intercomAuthMw, routes.player_checkJoin);
    router.post('/player/queue/join', intercomAuthMw, routes.player_queueJoin);
    router.post('/player/queue/poll', intercomAuthMw, routes.player_queuePoll);
    router.post('/player/queue/leave', intercomAuthMw, routes.player_queueLeave);
    router.post('/player/screenshot', apiAuthMw, mutationLimiter, routes.player_screenshot);
    router.post(
        '/player/liveSpectate/start',
        apiAuthMw,
        mutationLimiter,
        wrapRoute('LiveSpectateStart', routes.player_liveSpectate_start),
    );
    router.post(
        '/player/liveSpectate/stop',
        apiAuthMw,
        mutationLimiter,
        wrapRoute('LiveSpectateStop', routes.player_liveSpectate_stop),
    );
    router.post('/player/:action', apiAuthMw, mutationLimiter, routes.player_actions);
    router.get('/whitelist/:table', apiAuthMw, readLimiter, wrapRoute('WhitelistList', routes.whitelist_list));
    router.post('/whitelist/:table/:action', apiAuthMw, mutationLimiter, routes.whitelist_actions);
    router.get(
        '/whitelist/config/summary',
        apiAuthMw,
        readLimiter,
        wrapRoute('WhitelistConfig', routes.whitelist_config),
    );
    router.get(
        '/whitelist/analytics/summary',
        apiAuthMw,
        readLimiter,
        wrapRoute('WhitelistAnalytics', routes.whitelist_analytics),
    );
    router.get(
        '/whitelist/bulk/export',
        apiAuthMw,
        readLimiter,
        wrapRoute('WhitelistBulkExport', routes.whitelist_bulk),
    );
    router.post(
        '/whitelist/bulk/import',
        apiAuthMw,
        mutationLimiter,
        wrapRoute('WhitelistBulkImport', routes.whitelist_bulk),
    );

    //Report routes
    router.get('/reports/list', apiAuthMw, readLimiter, routes.reports_list);
    router.get('/reports/detail', apiAuthMw, readLimiter, routes.reports_detail);
    router.get('/reports/analytics', apiAuthMw, readLimiter, routes.reports_analytics);
    router.get('/reports/config', apiAuthMw, readLimiter, routes.reports_config);
    router.get('/reports/screenshot/:id', assetAuthMw, routes.reports_screenshot);
    router.post('/reports/message', apiAuthMw, mutationLimiter, routes.reports_message);
    router.post('/reports/status', apiAuthMw, mutationLimiter, routes.reports_status);
    router.post('/reports/claim', apiAuthMw, mutationLimiter, routes.reports_claim);
    router.post('/reports/note', apiAuthMw, mutationLimiter, routes.reports_note);
    router.post('/reports/retention-exclusion', apiAuthMw, mutationLimiter, routes.reports_retentionExclusion);
    router.delete('/reports/delete', apiAuthMw, mutationLimiter, routes.reports_delete);
    router.delete('/reports/note', apiAuthMw, mutationLimiter, routes.reports_note_delete);

    //Addon routes
    router.get('/addons/list', apiAuthMw, routes.addons_list);
    router.get('/addons/panel-manifest', apiAuthMw, routes.addons_panelManifest);
    router.get('/addons/nui-manifest', apiAuthMw, routes.addons_nuiManifest);
    router.post('/addons/:addonId/approve', apiAuthMw, mutationLimiter, routes.addons_approve);
    router.post('/addons/:addonId/revoke', apiAuthMw, mutationLimiter, routes.addons_revoke);
    router.post('/addons/:addonId/reload', apiAuthMw, mutationLimiter, routes.addons_reload);
    router.post('/addons/:addonId/stop', apiAuthMw, mutationLimiter, routes.addons_stop);
    router.post('/addons/:addonId/start', apiAuthMw, mutationLimiter, routes.addons_start);
    router.post('/addons/reload-all', apiAuthMw, mutationLimiter, routes.addons_reloadAll);
    router.get('/addons/:addonId/logs', apiAuthMw, readLimiter, routes.addons_logs);
    router.all('/addons/:addonId/api', apiAuthMw, readLimiter, routes.addons_proxy);
    router.all('/addons/:addonId/api/:addonPath(.*)', apiAuthMw, readLimiter, routes.addons_proxy);
    //Addon static file serving (panel bundles, NUI bundles & static assets)
    //SECURITY: panel & NUI bundles are same-origin, executable assets. They must
    //          only be served to authenticated admins to avoid exposing addon
    //          JS/CSS to unauthenticated visitors who could use them as part of
    //          an XSS / reconnaissance chain.
    router.get('/addons/:addonId/panel', webAuthMw, routes.addons_servePanelFile);
    router.get('/addons/:addonId/panel/:addonPath(.*)', webAuthMw, routes.addons_servePanelFile);
    router.get('/nui/addons/:addonId', assetAuthMw, routes.addons_serveNuiFile);
    router.get('/nui/addons/:addonId/:addonPath(.*)', assetAuthMw, routes.addons_serveNuiFile);
    router.get('/addons/:addonId/static/:addonPath(.*)', assetAuthMw, routes.addons_serveStaticFile);
    //Addon public routes are intentionally NOT registered on the primary panel
    //origin. Public traffic for addons with publicRoutes enabled is served by
    //AddonPublicServer on a dedicated port so that addon-controlled HTML/JS
    //cannot read admin session cookies on the panel origin.

    //Host routes
    router.get('/host/status', hostAuthMw, routes.host_status);

    // DevDebug routes — require session + master (privileged playerlist injection, etc.)
    if (txDevEnv.ENABLED) {
        router.get('/dev/:scope', apiAuthMw, wrapRoute('DevDebugGet', routes.dev_get));
        router.post('/dev/:scope', apiAuthMw, wrapRoute('DevDebugPost', routes.dev_post));
    }

    //Insights page mock
    // router.get('/insights', (ctx) => {
    //     return ctx.utils.render('main/insights', { headerTitle: 'Insights' });
    // });

    //Return router
    return router;
};
