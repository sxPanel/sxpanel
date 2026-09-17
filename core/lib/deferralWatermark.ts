import fs from 'node:fs';
import path from 'node:path';
import { txDevEnv, txEnv } from '@core/globalData';
import { extractPngBufferFromLogoSvg } from '@shared/deferralCardLogo';

let cachedPng: Buffer | null | undefined;

function getLogoSvgPath(): string {
    if (txDevEnv.ENABLED) {
        return path.join(txDevEnv.SRC_PATH, 'panel', 'public', 'logo.svg');
    }
    return path.join(txEnv.txaPath, 'panel', 'logo.svg');
}

/** sxPanel watermark PNG bytes, extracted from logo.svg (cached; null when unavailable). */
export function loadDeferralWatermarkPng(): Buffer | null {
    if (cachedPng !== undefined) return cachedPng;
    try {
        const svg = fs.readFileSync(getLogoSvgPath(), 'utf8');
        cachedPng = extractPngBufferFromLogoSvg(svg);
    } catch {
        cachedPng = null;
    }
    return cachedPng;
}

/**
 * Self-contained watermark src for deferral cards.
 * FiveM clients cannot reach the panel's loopback HTTP endpoint when no public
 * TXHOST_TXA_URL / interface is configured, so the HTTP watermark 404s in-game
 * (custom images already fall back to inline data URIs in that case — match them).
 */
export function getDeferralWatermarkDataUri(): string | null {
    const png = loadDeferralWatermarkPng();
    if (!png?.length) return null;
    return `data:image/png;base64,${png.toString('base64')}`;
}
