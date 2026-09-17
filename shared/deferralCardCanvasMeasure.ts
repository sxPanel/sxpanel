import { parseDeferralButtonContent } from './deferralCardButton';
import {
    DEFERRAL_CANVAS_SNAP_GRID,
    DEFERRAL_CARD_CANVAS_WIDTH,
    DEFERRAL_CARD_PADDING,
    type DeferralCanvasElement,
} from './deferralCardCanvasSchema';
import { DEFERRAL_WATERMARK_MAX_HEIGHT_PX, DEFERRAL_WATERMARK_MAX_WIDTH_PX } from './deferralCardWatermark';

const BR_TAG_SPLIT = /<br\s*\/?>/gi;
const BR_OR_NL_SPLIT = /<br\s*\/?>|\n/gi;

/** Safe split for HTML line breaks — never throws on null/undefined/non-string. */
export function splitHtmlLines(value: unknown, mode: 'br' | 'br-or-nl' = 'br'): string[] {
    if (value == null) return [];
    const text = String(value).trim();
    if (!text) return [];
    const re = mode === 'br-or-nl' ? BR_OR_NL_SPLIT : BR_TAG_SPLIT;
    return text
        .split(re)
        .map((l) => l.trim())
        .filter(Boolean);
}

export function getCanvasContentWidth(cardWidth: number): number {
    return cardWidth - DEFERRAL_CARD_PADDING * 2;
}

export function stripHtmlForMeasure(html: string): string {
    return html
        .replaceAll(/<[^>]+>/g, '')
        .replaceAll(/\s+/g, ' ')
        .trim();
}

const WRAPPED_TEXT_CHAR_WIDTH_RATIO = 0.52;
const WRAPPED_TEXT_LINE_HEIGHT_RATIO = 1.35;

/** Estimates how many lines plain text occupies when wrapped to `maxWidthPx`. */
export function estimateWrappedTextLineCount(plainText: string, fontSize: number, maxWidthPx: number): number {
    const text = plainText.trim();
    if (!text) return 1;
    const charWidth = Math.max(4, fontSize * WRAPPED_TEXT_CHAR_WIDTH_RATIO);
    const charsPerLine = Math.max(8, Math.floor(maxWidthPx / charWidth));
    const segments = text.split(/\n/);
    let lines = 0;
    for (const segment of segments) {
        const len = segment.trim().length || 1;
        lines += Math.max(1, Math.ceil(len / charsPerLine));
    }
    return lines;
}

/** Pixel height for wrapped plain text (matches canvas `line-height:1.35`). */
export function estimateWrappedTextHeight(plainText: string, fontSize: number, maxWidthPx: number): number {
    const lineCount = estimateWrappedTextLineCount(plainText, fontSize, maxWidthPx);
    const lineHeight = fontSize * WRAPPED_TEXT_LINE_HEIGHT_RATIO;
    return lineCount * lineHeight + 4;
}

/** Tight bounding size for selection handles and layout. */
export function estimateCanvasElementSize(
    el: DeferralCanvasElement,
    cardContentWidth: number,
): { width: number; height: number } {
    if (el.width && el.height) {
        return { width: el.width, height: el.height };
    }

    const fontSize = el.style?.fontSize ?? (el.type === 'heading' ? 22 : 18);

    switch (el.type) {
        case 'logo':
            return {
                width: el.width ?? DEFERRAL_WATERMARK_MAX_WIDTH_PX,
                height: el.height ?? DEFERRAL_WATERMARK_MAX_HEIGHT_PX,
            };
        case 'custom_image':
            return { width: el.width ?? 96, height: el.height ?? 96 };
        case 'button': {
            const label = parseDeferralButtonContent(el.content).label;
            const buttonFontSize = el.style?.fontSize ?? 16;
            const w = Math.min(cardContentWidth, Math.max(120, label.length * (buttonFontSize * 0.55) + 40));
            return { width: el.width ?? w, height: el.height ?? 44 };
        }
        case 'spacer':
            return { width: 24, height: el.height ?? 16 };
        case 'divider':
            return { width: cardContentWidth, height: el.height ?? 12 };
        case 'heading': {
            const text = stripHtmlForMeasure(el.content ?? 'Title');
            const width = el.width ?? Math.min(cardContentWidth, Math.max(80, text.length * (fontSize * 0.55)));
            const height = el.height ?? estimateWrappedTextHeight(text, fontSize, width);
            return { width, height };
        }
        case 'text':
        case 'paragraph':
        case 'custom_text': {
            const text = stripHtmlForMeasure(el.content ?? '');
            const htmlLines = splitHtmlLines(el.content);
            const lineCount = Math.max(1, htmlLines.length || 1);
            const width =
                el.width ??
                Math.min(cardContentWidth, Math.max(64, Math.ceil((text.length / lineCount) * (fontSize * 0.52))));
            const height =
                el.height ??
                (htmlLines.length > 1
                    ? lineCount * (fontSize + 8) + 4
                    : estimateWrappedTextHeight(text, fontSize, width));
            return { width, height };
        }
        case 'rejection_message': {
            const htmlLines = splitHtmlLines(el.content);
            const lineCount = Math.max(1, htmlLines.length || 1);
            const width = el.width ?? cardContentWidth;
            const plain = stripHtmlForMeasure(el.content ?? 'You can appeal this ban at example.com');
            const height =
                el.height ??
                (htmlLines.length > 1
                    ? lineCount * (fontSize + 8) + 4
                    : estimateWrappedTextHeight(plain, fontSize, width));
            return { width, height };
        }
        case 'request_id':
        case 'ban_id':
        case 'ban_expires':
        case 'tier_name': {
            const lineFontSize = el.style?.fontSize ?? 18;
            const label =
                el.type === 'request_id'
                    ? 'Request ID: XXXXX'
                    : el.type === 'ban_id'
                      ? 'Ban ID: A12345'
                      : el.type === 'ban_expires'
                        ? 'Expires: in 2 days'
                        : 'Tier: Default';
            const width =
                el.width ??
                Math.min(
                    cardContentWidth,
                    Math.max(
                        el.type === 'request_id' || el.type === 'ban_id' ? 280 : 200,
                        label.length * (lineFontSize * 0.52),
                    ),
                );
            const plain = stripHtmlForMeasure(label);
            const height = el.height ?? estimateWrappedTextHeight(plain, lineFontSize, width);
            return { width, height };
        }
        case 'ban_reason': {
            const lineFontSize = el.style?.fontSize ?? 16;
            const preview = 'Reason: Example ban reason text';
            const width = el.width ?? Math.min(cardContentWidth, Math.max(200, preview.length * (lineFontSize * 0.45)));
            const height = el.height ?? estimateWrappedTextHeight(preview, lineFontSize, width);
            return { width, height };
        }
        default:
            return { width: el.width ?? 120, height: el.height ?? 24 };
    }
}

export function estimateCanvasElementHeight(el: DeferralCanvasElement, cardContentWidth?: number): number {
    const w = cardContentWidth ?? getCanvasContentWidth(DEFERRAL_CARD_CANVAS_WIDTH);
    return estimateCanvasElementSize(el, w).height;
}

export function snapDeferralCoord(value: number, grid = DEFERRAL_CANVAS_SNAP_GRID): number {
    return Math.round(value / grid) * grid;
}
