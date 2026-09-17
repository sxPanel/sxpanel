import { z } from 'zod';
import { typeDefinedConfig } from './utils';
import { SYM_FIXER_DEFAULT } from '@lib/symbols';

/**
 * sxPanel page-visibility toggles. Each flag controls whether an optional panel page
 * is reachable: when disabled the page is hidden from every nav surface and its route
 * redirects to the dashboard (see panel/src/lib/panelFeatures.ts and the nav/route
 * consumers). Enforcement is client-side only - the backend API routes are unchanged.
 *
 * All default to `true` (enabled). A missing key is treated as enabled by consumers,
 * so stale `window.txConsts` never hides a page unexpectedly.
 *
 * NOTE: the Reports page itself stays governed by `gameFeatures.reportsEnabled`
 * (which has deeper backend wiring); the "Panel Features" settings tab surfaces that
 * same field alongside these.
 */

const pageFlag = (name: string) =>
    typeDefinedConfig({
        name,
        default: true,
        validator: z.boolean(),
        fixer: SYM_FIXER_DEFAULT,
    });

const whitelistPage = pageFlag('Whitelist Page Enabled');
const historyPage = pageFlag('History Page Enabled');
const insightsPage = pageFlag('Insights Page Enabled');
const playerDropsPage = pageFlag('Player Drops Page Enabled');
const reportAnalyticsPage = pageFlag('Report Analytics Page Enabled');
const resourcesPage = pageFlag('Resources Page Enabled');
const cfgEditorPage = pageFlag('CFG Editor Page Enabled');
const serverLogPage = pageFlag('Server Log Page Enabled');
const actionLogPage = pageFlag('Action Log Page Enabled');
const consoleLogPage = pageFlag('Console Log Page Enabled');
const addonsPage = pageFlag('Addons Page Enabled');

export default {
    whitelistPage,
    historyPage,
    insightsPage,
    playerDropsPage,
    reportAnalyticsPage,
    resourcesPage,
    cfgEditorPage,
    serverLogPage,
    actionLogPage,
    consoleLogPage,
    addonsPage,
} as const;
