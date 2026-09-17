import { describe, it, expect } from 'vitest';
import {
    gifDataUriToBuffer,
    isDeferralGifDataUri,
    pngDataUriToBuffer,
    isDeferralHttpImageDataUri,
    deferralCustomImageHasPreview,
    dataUriToSvgText,
    normalizeDeferralImageContent,
    normalizeDeferralSvgContent,
    readDeferralGifFile,
    sanitizeSvgMarkup,
    svgTextToDataUri,
    renderDeferralInlineSvgMarkup,
} from './deferralCardSvg';

const TINY_GIF_B64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const TINY_GIF_URI = `data:image/gif;base64,${TINY_GIF_B64}`;
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const TINY_PNG_URI = `data:image/png;base64,${TINY_PNG_B64}`;

describe('deferralCardSvg', () => {
    it('strips script tags from svg', () => {
        const raw =
            '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10"/></svg>';
        const out = sanitizeSvgMarkup(raw);
        expect(out).not.toContain('script');
        expect(out).toContain('<rect');
    });

    it('builds a data uri', () => {
        const uri = svgTextToDataUri('<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>');
        expect(uri.startsWith('data:image/svg+xml,')).toBe(true);
    });

    it('normalizes inline svg markup to data uri', () => {
        const uri = normalizeDeferralSvgContent('<svg xmlns="http://www.w3.org/2000/svg"><text>hi</text></svg>');
        expect(uri.startsWith('data:image/svg+xml,')).toBe(true);
    });

    it('embeds inline svg for deferral HTML', () => {
        const uri = svgTextToDataUri('<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>');
        const html = renderDeferralInlineSvgMarkup(uri, 'width:48px;height:48px');
        expect(html).toContain('<circle');
        expect(html).not.toContain('data:image');
    });

    it('recognizes and decodes png data uris', () => {
        expect(isDeferralHttpImageDataUri(TINY_PNG_URI)).toBe(true);
        expect(normalizeDeferralImageContent(TINY_PNG_URI)).toBe(TINY_PNG_URI);
        const buf = pngDataUriToBuffer(TINY_PNG_URI);
        expect(buf?.length).toBeGreaterThan(0);
        expect(buf?.subarray(0, 4).toString('hex')).toBe('89504e47');
    });

    it('recognizes and decodes gif data uris', () => {
        expect(isDeferralGifDataUri(TINY_GIF_URI)).toBe(true);
        expect(isDeferralHttpImageDataUri(TINY_GIF_URI)).toBe(true);
        expect(normalizeDeferralImageContent(TINY_GIF_URI)).toBe(TINY_GIF_URI);
        const buf = gifDataUriToBuffer(TINY_GIF_URI);
        expect(buf?.length).toBeGreaterThan(0);
        expect(buf?.subarray(0, 6).toString()).toBe('GIF89a');
    });

    it('strips event handlers from player-facing SVG markup', () => {
        const raw =
            '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" onload="alert(1)" onmouseover="x()" height="10"/></svg>';
        const out = sanitizeSvgMarkup(raw);
        expect(out).not.toContain('onload');
        expect(out).not.toContain('onmouseover');
        expect(out).toContain('<rect');
    });

    it('strips javascript: hrefs from player-facing SVG markup', () => {
        const raw = '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect/></a></svg>';
        const out = sanitizeSvgMarkup(raw);
        expect(out).not.toContain('javascript:');
    });

    it('rejects non-svg markup so nothing broken is embedded for the player', () => {
        expect(sanitizeSvgMarkup('<div>hi</div>')).toBe('');
        expect(sanitizeSvgMarkup('not markup at all')).toBe('');
        expect(renderDeferralInlineSvgMarkup('not-a-data-uri', 'width:10px')).toBe('');
    });

    it('injects full-size svg styling inside the container for deferral HTML', () => {
        const uri = svgTextToDataUri('<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>');
        const html = renderDeferralInlineSvgMarkup(uri, 'width:48px;height:48px');
        expect(html).toContain('<div style="width:48px;height:48px;line-height:0;overflow:hidden">');
        expect(html).toContain('<svg style="width:100%;height:100%;display:block"');
    });

    it('round-trips SVG data uris (percent and base64) back to sanitized markup', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>x</text></svg>';
        expect(dataUriToSvgText(svgTextToDataUri(svg))).toContain('<text>');
        const b64 = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
        expect(dataUriToSvgText(b64)).toContain('<text>');
    });

    it('recognizes previewable custom images for the player card', () => {
        expect(deferralCustomImageHasPreview(TINY_PNG_URI)).toBe(true);
        expect(deferralCustomImageHasPreview(TINY_GIF_URI)).toBe(true);
        expect(deferralCustomImageHasPreview(svgTextToDataUri('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(true);
        expect(deferralCustomImageHasPreview('https://example.com/logo.png')).toBe(false);
    });

    it('clamps oversized GIF frame delays so the in-game animation animates at a sane speed', async () => {
        // Minimal GIF89a: header + LSD + 2-color GCT + one GCE (delay 200cs) + image desc + trailer.
        const bytes = new Uint8Array([
            0x47,
            0x49,
            0x46,
            0x38,
            0x39,
            0x61, // GIF89a
            0x01,
            0x00,
            0x01,
            0x00,
            0x80,
            0x00,
            0x00, // LSD: 1x1, GCT(2 colors)
            0x00,
            0x00,
            0x00,
            0xff,
            0xff,
            0xff, // GCT
            0x21,
            0xf9,
            0x04,
            0x00,
            0xc8,
            0x00,
            0x00,
            0x00, // GCE: delayLo=200, delayHi=0
            0x2c,
            0x00,
            0x00,
            0x00,
            0x00,
            0x01,
            0x00,
            0x01,
            0x00,
            0x00, // Image Descriptor
            0x02,
            0x02,
            0x00, // minimal image data sub-blocks
            0x3b, // trailer
        ]);
        const file = new File([bytes], 'slow.gif', { type: 'image/gif' });
        const result = await readDeferralGifFile(file);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const normalized = new Uint8Array(Buffer.from(result.content.split(',')[1]!, 'base64'));
        // delay lives at GCE offset 23 (Lo) / 24 (Hi): 200 -> clamped to 20.
        expect(normalized[23]).toBe(20);
        expect(normalized[24]).toBe(0);
    });
});
