import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderDeferralCard } from './deferralCard';
import {
    DEFAULT_DEFERRAL_CARDS_CONFIG,
    DEFERRAL_CARD_WATERMARK_PATH,
    deferralCardAssetPath,
} from '@shared/deferralCardTypes';
import { templateWithCanvas } from '@shared/deferralCardCanvas';
import { extractPngBufferFromLogoSvg } from '@shared/deferralCardLogo';
import { txHostConfig } from '@core/globalData';

const REPO_ROOT = path.join(__dirname, '../../..');
const LOGO_SVG_PATH = path.join(REPO_ROOT, 'panel/public/logo.svg');

vi.mock('@core/globalData', async () => {
    const nodePath = await import('node:path');
    const repoRoot = nodePath.join(__dirname, '../../..');
    return {
        txHostConfig: {
            txaUrl: 'https://panel.example.com',
            txaPort: 40120,
            netInterface: null,
        },
        txDevEnv: { ENABLED: true, SRC_PATH: repoRoot },
        txEnv: { txaPath: repoRoot },
    };
});

describe('renderDeferralCard', () => {
    beforeEach(() => {
        vi.stubGlobal('txConfig', {
            whitelist: {
                deferralCards: DEFAULT_DEFERRAL_CARDS_CONFIG,
            },
        });
        vi.stubGlobal('txCore', {
            discordBot: { guildName: 'Test Guild' },
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('renders whitelist pending with request id', async () => {
        const html = await renderDeferralCard({
            scenario: 'whitelist_pending',
            title: 'You are not whitelisted to join this server.',
            body: '',
            requestId: 'R99999',
            tierName: 'VIP',
        });
        expect(html).toContain('R99999');
        expect(html).toContain('You are not whitelisted to join this server.');
    });

    it('uses ban scenario template', async () => {
        const html = await renderDeferralCard({
            scenario: 'ban_permanent',
            title: 'You have been permanently banned from this server.',
            body: '<strong>Reason:</strong> test',
        });
        expect(html).toContain('You have been permanently banned from this server.');
        expect(html).toContain('test');
    });

    it('substitutes studio preview ban text and serves PNG custom images over HTTP', async () => {
        const png =
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        const tpl = templateWithCanvas(DEFAULT_DEFERRAL_CARDS_CONFIG.scenarios.ban_temporary, {
            width: 520,
            height: 180,
            elements: [
                {
                    id: 'e-img',
                    type: 'custom_image',
                    content: png,
                    x: 400,
                    y: 0,
                    enabled: true,
                    width: 40,
                    height: 40,
                },
                {
                    id: 'e-exp',
                    type: 'text',
                    content: '<strong>Expires:</strong> in 2 days',
                    x: 0,
                    y: 40,
                    enabled: true,
                },
                {
                    id: 'e-reason',
                    type: 'text',
                    content: '<strong>Reason:</strong> Example ban',
                    x: 0,
                    y: 72,
                    enabled: true,
                },
                { id: 'e-bid', type: 'ban_id', x: 0, y: 104, enabled: true },
            ],
        });
        vi.stubGlobal('txConfig', {
            whitelist: {
                deferralCards: {
                    ...DEFAULT_DEFERRAL_CARDS_CONFIG,
                    scenarios: {
                        ...DEFAULT_DEFERRAL_CARDS_CONFIG.scenarios,
                        ban_temporary: tpl,
                    },
                },
            },
        });
        const html = await renderDeferralCard({
            scenario: 'ban_temporary',
            title: 'Banned',
            body: '',
            banExpires: 'in 1 hour',
            banReason: 'Actual reason',
            banId: 'ACT-1',
        });
        expect(html).toContain('in 1 hour');
        expect(html).toContain('Actual reason');
        expect(html).toContain('ACT-1');
        expect(html).not.toContain('in 2 days');
        expect(html).not.toContain('Example ban');
        expect(html).toContain('ACT-1');
        expect(html).toContain('letter-spacing: 2px');
        expect(html).toContain(`https://panel.example.com${deferralCardAssetPath('ban_temporary', 'e-img')}`);
        expect(html).not.toContain('data:image/png;base64,');
        expect(html).not.toContain('<codeid>');
    });

    it('extracts embedded PNG from logo.svg (data:img/png)', () => {
        const svg = fs.readFileSync(LOGO_SVG_PATH, 'utf8');
        const png = extractPngBufferFromLogoSvg(svg);
        expect(png?.length).toBeGreaterThan(100);
        expect(png?.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    });

    it('uses sxPanel logo from panel host, not txAdmin CDN', async () => {
        const html = await renderDeferralCard({
            scenario: 'ban_permanent',
            title: 'Banned',
            body: 'test',
        });
        expect(html).toContain(`https://panel.example.com${DEFERRAL_CARD_WATERMARK_PATH}`);
        expect(html).not.toContain('/logo.svg');
        expect(html).not.toContain('forum-cfx-re.akamaized.net');
    });

    it('inlines the watermark as a data URI when no public panel URL is configured', async () => {
        const originalUrl = txHostConfig.txaUrl;
        (txHostConfig as { txaUrl?: string }).txaUrl = undefined;
        try {
            const html = await renderDeferralCard({
                scenario: 'ban_permanent',
                title: 'Banned',
                body: 'test',
            });
            expect(html).toContain('src="data:image/png;base64,');
            expect(html).not.toContain('127.0.0.1');
            expect(html).not.toContain(DEFERRAL_CARD_WATERMARK_PATH);
        } finally {
            (txHostConfig as { txaUrl?: string }).txaUrl = originalUrl;
        }
    });

    it('pins watermark logo to bottom-right at txAdmin size and opacity', async () => {
        const html = await renderDeferralCard({
            scenario: 'ban_permanent',
            title: 'You have been permanently banned from this server.',
            body: 'test',
        });
        expect(html).toContain('width:88px');
        expect(html).toContain('opacity:0.45');
        expect(html).toContain('object-fit:contain');
        expect(html).not.toContain('right:15px');
    });
});
