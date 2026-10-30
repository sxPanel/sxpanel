import { Next } from 'koa';
import { RawKoaCtx } from '../ctxTypes';

/**
 * Returns true if a Content-Encoding header value lists Brotli in any position/casing.
 */
export const hasBrotliEncoding = (contentEncoding: string) => {
    return contentEncoding.split(',').some((coding) => coding.trim().toLowerCase() === 'br');
};

/**
 * Middleware that rejects Brotli-compressed request bodies before koa-bodyparser runs.
 * koa-bodyparser (via co-body/inflation) would otherwise feed them straight into the
 * embedded Node's Brotli decoder, which has an out-of-bounds write (CVE-2026-111497,
 * "Node2Shell") on unpatched builds. The Node runtime is shipped by FXServer and can't be
 * patched from here, and browsers never compress request bodies, so we just refuse them.
 */
const rejectBrotliBodyMw = async (ctx: RawKoaCtx, next: Next) => {
    if (hasBrotliEncoding(ctx.get('Content-Encoding'))) {
        ctx.status = 415;
        ctx.body = { error: 'Unsupported Content-Encoding.' };
        return;
    }
    await next();
};

export default rejectBrotliBodyMw;
