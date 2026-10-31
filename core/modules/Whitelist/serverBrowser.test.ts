import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    getCfxAllowlistConvars,
    resolveServerBrowserInstructions,
    stripHtmlForServerBrowserInstructions,
} from './serverBrowser';

describe('serverBrowser', () => {
    beforeEach(() => {
        vi.stubGlobal('txConfig', {
            whitelist: {
                enabled: false,
                appearInServerBrowser: true,
                serverBrowserInstructions: '',
                deferralCards: {
                    skin: { showLogo: true },
                    scenarios: {
                        whitelist_pending: {
                            title: 'Not Whitelisted',
                            bodyTemplate: 'Join <guildname>Discord</guildname> and apply.',
                            showRequestId: true,
                            showTierName: false,
                        },
                    },
                },
            },
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('strips HTML for browser instructions', () => {
        expect(stripHtmlForServerBrowserInstructions('Line one<br>Line two')).toBe('Line one\nLine two');
    });

    it('resolves instructions from deferral when whitelist is disabled and explicit is empty', () => {
        txConfig.whitelist.enabled = false;
        expect(resolveServerBrowserInstructions('', false)).toContain('whitelisted');
    });

    it('uses default instructions when whitelist is enabled and explicit is empty', () => {
        txConfig.whitelist.enabled = true;
        expect(resolveServerBrowserInstructions('', true)).toContain('allowlist');
    });

    it('emits Cfx allowlist convars when whitelist is enabled', () => {
        txConfig.whitelist.enabled = true;
        const convars = getCfxAllowlistConvars();
        expect(convars).toContainEqual(['set', 'sv_appearAllowlisted', 'true']);
        expect(convars.some((c) => c[1] === 'sv_allowlistInstructions')).toBe(true);
    });

    it('disables padlock when whitelist is disabled', () => {
        txConfig.whitelist.enabled = false;
        txConfig.whitelist.appearInServerBrowser = true;
        const convars = getCfxAllowlistConvars();
        expect(convars).toEqual([
            ['set', 'sv_appearAllowlisted', 'false'],
            ['set', 'sv_allowlistInstructions', ''],
        ]);
    });
});
