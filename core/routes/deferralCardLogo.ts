import type { InitializedCtx } from '@modules/WebServer/ctxTypes';
import { loadDeferralWatermarkPng } from '@lib/deferralWatermark';

/** Serves the sxPanel watermark as PNG (FiveM cannot render SVG in img tags). */
export default async function deferralCardLogo(ctx: InitializedCtx) {
    const png = loadDeferralWatermarkPng();
    if (!png?.length) {
        ctx.status = 404;
        return;
    }
    ctx.type = 'image/png';
    ctx.set('Cache-Control', 'public, max-age=86400');
    ctx.body = png;
}
