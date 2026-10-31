import http from 'node:http';
import { promisify } from 'node:util';
import stream from 'node:stream';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import got, { HTTPError, TimeoutError } from './got';

const pipeline = promisify(stream.pipeline);

describe('lib/got (undici wrapper)', () => {
    let server: http.Server;
    let baseUrl: string;
    let flakyFailuresLeft = 0;
    let lastPostBody: any;
    let lastAuthHeader: string | undefined;

    beforeAll(async () => {
        server = http.createServer((req, res) => {
            const url = new URL(req.url ?? '/', 'http://localhost');
            if (url.pathname === '/json') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ hello: 'world' }));
            } else if (url.pathname === '/echo-accept-encoding') {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end(req.headers['accept-encoding'] ?? '');
            } else if (url.pathname === '/text') {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('hello world');
            } else if (url.pathname === '/fail') {
                res.writeHead(500);
                res.end('server error');
            } else if (url.pathname === '/flaky') {
                if (flakyFailuresLeft > 0) {
                    flakyFailuresLeft--;
                    res.writeHead(500);
                    res.end('flaky failure');
                } else {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true }));
                }
            } else if (url.pathname === '/redirect') {
                res.writeHead(302, { Location: '/json' });
                res.end();
            } else if (url.pathname === '/stream') {
                const payload = Buffer.from('x'.repeat(10_000));
                res.writeHead(200, { 'Content-Length': String(payload.length) });
                //Write in chunks so downloadProgress fires more than once.
                let offset = 0;
                const chunkSize = 2000;
                const writeNext = () => {
                    if (offset >= payload.length) return res.end();
                    const chunk = payload.subarray(offset, offset + chunkSize);
                    offset += chunkSize;
                    res.write(chunk, () => setImmediate(writeNext));
                };
                writeNext();
            } else if (url.pathname === '/slow') {
                //Never responds within the test's timeout window.
                setTimeout(() => {
                    res.writeHead(200);
                    res.end('too late');
                }, 5000);
            } else if (url.pathname === '/post' && req.method === 'POST') {
                lastAuthHeader = req.headers['authorization'];
                let body = '';
                req.on('data', (chunk) => (body += chunk));
                req.on('end', () => {
                    lastPostBody = JSON.parse(body || '{}');
                    res.writeHead(200);
                    res.end('ok');
                });
            } else if (url.pathname === '/post-fail' && req.method === 'POST') {
                res.writeHead(400);
                res.end('bad request');
            } else {
                res.writeHead(404);
                res.end('not found');
            }
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('failed to bind test server');
        baseUrl = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    });

    it('got(url).json() parses a JSON response', async () => {
        const data = await got(`${baseUrl}/json`).json<{ hello: string }>();
        expect(data).toEqual({ hello: 'world' });
    });

    it('got(url).text() returns the raw body', async () => {
        const text = await got(`${baseUrl}/text`).text();
        expect(text).toBe('hello world');
    });

    it('got.get(url) awaited directly resolves to a GotResponseLike', async () => {
        const resp = await got.get(`${baseUrl}/json`);
        expect(resp.statusCode).toBe(200);
        expect(resp.body).toBe(JSON.stringify({ hello: 'world' }));
        expect(resp.headers['content-type']).toContain('application/json');
        expect(resp.url).toBe(`${baseUrl}/json`);
    });

    it('throws HTTPError on non-2xx by default', async () => {
        await expect(got(`${baseUrl}/fail`).text()).rejects.toThrow(HTTPError);
    });

    it('with throwHttpErrors:false, returns the response instead of throwing', async () => {
        const resp = await got.get(`${baseUrl}/fail`, { throwHttpErrors: false });
        expect(resp.statusCode).toBe(500);
        expect(resp.body).toBe('server error');
    });

    it('with maxRedirects:0, returns the 3xx response instead of following it', async () => {
        const resp = await got.get(`${baseUrl}/redirect`, { maxRedirects: 0 });
        expect(resp.statusCode).toBe(302);
        expect(resp.headers['location']).toBe('/json');
    });

    it('follows redirects by default', async () => {
        const data = await got(`${baseUrl}/redirect`).json<{ hello: string }>();
        expect(data).toEqual({ hello: 'world' });
    });

    it('retries up to retry.limit on 5xx and eventually succeeds', async () => {
        flakyFailuresLeft = 2;
        const data = await got(`${baseUrl}/flaky`, { retry: { limit: 2 } }).json<{ ok: boolean }>();
        expect(data).toEqual({ ok: true });
        expect(flakyFailuresLeft).toBe(0);
    });

    it('gives up after exhausting retry.limit', async () => {
        flakyFailuresLeft = 5;
        await expect(got(`${baseUrl}/flaky`, { retry: { limit: 1 } }).json()).rejects.toThrow();
        flakyFailuresLeft = 0;
    });

    it('throws TimeoutError when the request exceeds timeout.request', async () => {
        await expect(got(`${baseUrl}/slow`, { timeout: { request: 100 }, retry: { limit: 0 } }).text()).rejects.toThrow(
            TimeoutError,
        );
    }, 10_000);

    it('got.post sends a JSON body and resolves on 2xx', async () => {
        await got.post(`${baseUrl}/post`, { json: { foo: 'bar' } });
        expect(lastPostBody).toEqual({ foo: 'bar' });
    });

    it('got.post applies Basic Auth from username/password', async () => {
        await got.post(`${baseUrl}/post`, { json: {}, username: 'admin', password: 'secret' });
        expect(lastAuthHeader).toBe(`Basic ${Buffer.from('admin:secret').toString('base64')}`);
    });

    it('does not advertise Brotli in Accept-Encoding', async () => {
        const resp = await got.get(`${baseUrl}/echo-accept-encoding`);
        expect(resp.body).toBe('gzip, deflate');
    });

    it('got.post throws on non-2xx', async () => {
        await expect(got.post(`${baseUrl}/post-fail`, { json: {} })).rejects.toThrow(HTTPError);
    });

    it('got.stream pipes the body and emits downloadProgress', async () => {
        const chunks: Buffer[] = [];
        const progressEvents: Array<{ percent: number; transferred: number; total: number }> = [];
        const gotStream = got.stream(`${baseUrl}/stream`);
        gotStream.on('downloadProgress', (p) => progressEvents.push(p));

        const collector = new stream.Writable({
            write(chunk, _enc, cb) {
                chunks.push(chunk);
                cb();
            },
        });
        await pipeline(gotStream, collector);

        const total = Buffer.concat(chunks).length;
        expect(total).toBe(10_000);
        expect(progressEvents.length).toBeGreaterThan(0);
        expect(progressEvents.at(-1)?.percent).toBe(1);
    });

    it('got.stream destroys with an error for a failing request', async () => {
        const gotStream = got.stream(`${baseUrl}/fail`);
        const errorPromise = new Promise<Error>((resolve) => gotStream.on('error', resolve));
        gotStream.resume();
        const err = await errorPromise;
        expect(err).toBeInstanceOf(HTTPError);
    });
});
