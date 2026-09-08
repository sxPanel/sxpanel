import {
    DEFERRAL_CANVAS_SNAP_GRID,
    DEFERRAL_CARD_PADDING,
    type DeferralCanvasElement,
} from './deferralCardCanvasSchema';
import {
    DEFERRAL_TXADMIN_WATERMARK_HEIGHT_PX,
    DEFERRAL_TXADMIN_WATERMARK_WIDTH_PX,
    DEFERRAL_WATERMARK_INSET_PX,
} from './deferralCardWatermark';
import { estimateCanvasElementSize, getCanvasContentWidth, snapDeferralCoord } from './deferralCardCanvasMeasure';

const CANVAS_STACK_GAP_PX = 6;

export function resolveDeferralLogoPlacement(
    el: Pick<DeferralCanvasElement, 'x' | 'y' | 'width' | 'height'> | undefined,
    contentWidth: number,
    contentHeight: number,
): { x: number; y: number; width: number; height: number } {
    const width =
        el?.width && el.width > DEFERRAL_TXADMIN_WATERMARK_WIDTH_PX + 4
            ? el.width
            : DEFERRAL_TXADMIN_WATERMARK_WIDTH_PX;
    const height =
        el?.height && el.height > DEFERRAL_TXADMIN_WATERMARK_HEIGHT_PX + 4
            ? el.height
            : DEFERRAL_TXADMIN_WATERMARK_HEIGHT_PX;
    const defaultX = Math.max(0, contentWidth - width - DEFERRAL_WATERMARK_INSET_PX);
    const defaultY = Math.max(0, contentHeight - height - DEFERRAL_WATERMARK_INSET_PX);
    const pinnedBottomRight = (el?.x ?? 0) === 0 && (el?.y ?? 0) === 0;
    const legacyMisplaced = el?.x === 0 && (el?.y ?? 0) >= defaultY - DEFERRAL_CANVAS_SNAP_GRID;
    if (pinnedBottomRight || legacyMisplaced) {
        return { x: defaultX, y: defaultY, width, height };
    }
    const x = Math.min(contentWidth - width, Math.max(0, el?.x ?? defaultX));
    const y = Math.min(contentHeight - height, Math.max(0, el?.y ?? defaultY));
    return { x, y, width, height };
}

/**
 * Stacks canvas elements vertically using measured heights so absolute-positioned
 * txAdmin-style lines do not overlap in studio or in-game render.
 */
export function reflowStackedCanvasElements(
    elements: DeferralCanvasElement[],
    cardWidth: number,
    cardHeight: number,
): DeferralCanvasElement[] {
    const contentWidth = getCanvasContentWidth(cardWidth);
    const contentHeight = cardHeight - DEFERRAL_CARD_PADDING * 2;
    const logoEl = elements.find((e) => e.type === 'logo');
    const stackable = elements
        .filter((e) => e.type !== 'logo' && e.enabled !== false)
        .sort((a, b) => a.y - b.y || a.x - b.x);

    let y = 0;
    const reflowed: DeferralCanvasElement[] = [];

    for (const el of stackable) {
        const sized = estimateCanvasElementSize(el, contentWidth);
        const placed: DeferralCanvasElement = {
            ...el,
            x: snapDeferralCoord(el.x),
            y: snapDeferralCoord(y),
            width: el.width ?? sized.width,
            height: el.height ?? sized.height,
        };
        reflowed.push(placed);
        y += (placed.height ?? sized.height) + CANVAS_STACK_GAP_PX;
    }

    if (logoEl) {
        const placed = resolveDeferralLogoPlacement(
            {
                ...logoEl,
                width: logoEl.width ?? DEFERRAL_TXADMIN_WATERMARK_WIDTH_PX,
                height: logoEl.height ?? DEFERRAL_TXADMIN_WATERMARK_HEIGHT_PX,
            },
            contentWidth,
            Math.max(contentHeight, y + DEFERRAL_TXADMIN_WATERMARK_HEIGHT_PX),
        );
        reflowed.push({
            ...logoEl,
            x: placed.x,
            y: placed.y,
            width: placed.width,
            height: placed.height,
        });
    }

    return reflowed;
}
