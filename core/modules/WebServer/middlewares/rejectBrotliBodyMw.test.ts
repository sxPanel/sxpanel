import http from 'node:http';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { suite, it, expect, beforeAll, afterAll } from 'vitest';
import Koa from 'koa';
import KoaBodyParser from 'koa-bodyparser';
import rejectBrotliBodyMw, { hasBrotliEncoding } from './rejectBrotliBodyMw';

suite('hasBrotliEncoding', () => {
    it('detects br regardless of casing, whitespace or position', () => {
        expect(hasBrotliEncoding('br')).toBe(true);
        expect(hasBrotliEncoding('BR')).toBe(true);
        expect(hasBrotliEncoding('gzip, br')).toBe(true);
        expect(hasBrotliEncoding(' br ,gzip')).toBe(true);
    });

    it('ignores other or missing encodings', () => {
        expect(hasBrotliEncoding('')).toBe(false);
        expect(hasBrotliEncoding('gzip')).toBe(false);
        expect(hasBrotliEncoding('identity')).toBe(false);
        expect(hasBrotliEncoding('brotli-ish')).toBe(false);
    });
});

suite('rejectBrotliBodyMw (with koa-bodyparser)', () => {
    let server: http.Server;
    let port: number;
    let parsedBodies: unknown[] = [];

    beforeAll(async () => {
        const app = new Koa();
        app.use(rejectBrotliBodyMw as any);
        app.use(KoaBodyParser());
        app.use(async (ctx) => {
            parsedBodies.push(ctx.request.body);
            ctx.body = { ok: true };
        });
        server = http.createServer(app.callback());
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = (server.address() as AddressInfo).port;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    const post = (body: Buffer, headers: Record<string, string>) =>
        new Promise<{ status: number; body: string }>((resolve, reject) => {
            const req = http.request(
                {
                    host: '127.0.0.1',
                    port,
                    method: 'POST',
                    path: '/',
                    headers: { 'Content-Type': 'application/json', 'Content-Length': body.length, ...headers },
                },
                (res) => {
                    const chunks: Buffer[] = [];
                    res.on('data', (c) => chunks.push(c));
                    res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString() }));
                },
            );
            req.on('error', reject);
            req.end(body);
        });

    const json = Buffer.from(JSON.stringify({ hello: 'world' }));

    it('rejects Brotli bodies with 415 before they are decoded', async () => {
        parsedBodies = [];
        const res = await post(zlib.brotliCompressSync(json), { 'Content-Encoding': 'br' });
        expect(res.status).toBe(415);
        expect(parsedBodies).toHaveLength(0);
    });

    it('still parses uncompressed bodies', async () => {
        parsedBodies = [];
        const res = await post(json, {});
        expect(res.status).toBe(200);
        expect(parsedBodies).toEqual([{ hello: 'world' }]);
    });

    it('still parses gzip bodies', async () => {
        parsedBodies = [];
        const res = await post(zlib.gzipSync(json), { 'Content-Encoding': 'gzip' });
        expect(res.status).toBe(200);
        expect(parsedBodies).toEqual([{ hello: 'world' }]);
    });
});
