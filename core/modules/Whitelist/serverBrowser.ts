import { getDeferralScenarioTemplate } from './deferralCard';

const DEFAULT_BROWSER_INSTRUCTIONS =
    'This server uses an allowlist. Connect in-game or check the server Discord for how to apply.';

const MAX_INSTRUCTIONS_LENGTH = 512;

/**
 * Strips basic HTML from deferral templates for plain-text server browser copy.
 */
export function stripHtmlForServerBrowserInstructions(input: string): string {
    return input
        .replaceAll(/<br\s*\/?>/gi, '\n')
        .replaceAll(/<\/p>/gi, '\n')
        .replaceAll(/<[^>]+>/g, '')
        .replaceAll(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Resolves instructions shown in the FiveM/RedM server browser allowlist panel.
 */
export function resolveServerBrowserInstructions(
    serverBrowserInstructions: string | undefined,
    whitelistEnabled = txConfig.whitelist.enabled === true,
): string {
    const explicit = serverBrowserInstructions?.trim();
    if (explicit) {
        return explicit.slice(0, MAX_INSTRUCTIONS_LENGTH);
    }

    if (whitelistEnabled) {
        return DEFAULT_BROWSER_INSTRUCTIONS;
    }

    const tpl = getDeferralScenarioTemplate('whitelist_pending');
    const fromTitle = tpl.title?.trim() ? stripHtmlForServerBrowserInstructions(tpl.title) : '';
    if (fromTitle) {
        return fromTitle.slice(0, MAX_INSTRUCTIONS_LENGTH);
    }

    const body = tpl.bodyTemplate?.trim() ?? '';
    const fromDeferral = body && body !== '{customMessage}' ? stripHtmlForServerBrowserInstructions(body) : '';
    if (fromDeferral) {
        return fromDeferral.slice(0, MAX_INSTRUCTIONS_LENGTH);
    }

    return DEFAULT_BROWSER_INSTRUCTIONS;
}

export type CfxAllowlistConvarTuple = ['set', string, string];

/**
 * Native Cfx server-list convars (not txAdmin-prefixed).
 */
/** Padlock follows whitelist join enforcement (`whitelist.enabled`), not a separate toggle. */
export function isWhitelistServerBrowserPadlockEnabled(): boolean {
    return txConfig.whitelist.enabled === true;
}

export function getCfxAllowlistConvars(): CfxAllowlistConvarTuple[] {
    const appear = isWhitelistServerBrowserPadlockEnabled();
    const convars: CfxAllowlistConvarTuple[] = [['set', 'sv_appearAllowlisted', appear ? 'true' : 'false']];

    if (appear) {
        const instructions = resolveServerBrowserInstructions(txConfig.whitelist.serverBrowserInstructions);
        convars.push(['set', 'sv_allowlistInstructions', instructions]);
    } else {
        //Clear stale instructions when the whitelist is disabled at runtime
        convars.push(['set', 'sv_allowlistInstructions', '']);
    }

    return convars;
}

/**
 * Command-line spawn args for Cfx allowlist convars.
 */
export function getCfxAllowlistConvarCmdArgs(isCmdLine = false): string[] {
    const prefix = isCmdLine ? '+' : '';
    const out: string[] = [];
    for (const [setter, name, value] of getCfxAllowlistConvars()) {
        out.push(`${prefix}${setter}`, name, value);
    }
    return out;
}
