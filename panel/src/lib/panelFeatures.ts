import type { PanelFeatureKey } from '@shared/otherTypes';

/**
 * Whether an optional sxPanel page is enabled. Toggled from Settings → sxPanel →
 * Panel Features (config scope `panelFeatures`), injected once at page load via
 * `window.txConsts.panelFeatures`. A missing/undefined key means enabled, so a
 * stale txConsts never hides a page unexpectedly.
 *
 * NOTE: consumers (sidebar, top-nav, router) only read this on render, so a change
 * needs a full page reload to take effect — the Panel Features card prompts for one.
 */
export const isPanelFeatureEnabled = (key: PanelFeatureKey): boolean => window.txConsts.panelFeatures?.[key] !== false;
