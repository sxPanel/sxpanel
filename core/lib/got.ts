import { Readable, PassThrough } from 'node:stream';
import { Agent, fetch as undiciFetch, type Dispatcher } from 'undici';
import { txEnv, txHostConfig } from '@core/globalData';

/**
 * Minimal got-compatible wrapper around undici's fetch.
 * Exists so `core/lib/got.ts` keeps working on Node 18 (undici@6 supports it),
 * instead of depending on `got@15`/`@sindresorhus/is@8`, which hard-require
 * Node 22 and use the RegExp 'v' flag (parse-time SyntaxError below V8 11).
 *
 * Only supports the call shapes actually used in this codebase:
 *   got(url, opts).json<T>() / .text()
 *   got.get(url, opts).json<T>() / .text()
 *   await got.get(url, opts)          // resolves to a GotResponseLike (statusCode/body/headers/url)
 *   got.post(url, opts)               // awaited directly, throws on non-2xx
 *   got.stream(url, opts)             // Readable emitting 'downloadProgress'/'error'
 */

export type GotTimeoutOpts = {
    request?: number;
    lookup?: number;
    connect?: number;
    response?: number;
    send?: number;
};

export type GotRetryOpts = { limit?: number };

export interface GotOptions {
    timeout?: GotTimeoutOpts;
    retry?: GotRetryOpts;
    headers?: Record<string, string>;
    json?: unknown;
    localAddress?: string;
    maxRedirects?: number;
    followRedirect?: boolean;
    username?: string;
    password?: string;
    /** When false, non-2xx responses are returned as-is instead of throwing (mirrors got's option of the same name). */
    throwHttpErrors?: boolean;
}

/** got-style plain response object, for call sites that inspect status/body directly instead of chaining .json()/.text(). */
export interface GotResponseLike {
    statusCode: number;
    statusMessage: string;
    headers: Record<string, string>;
    url: string;
    body: string;
}

export class HTTPError extends Error {
    code?: string;
    constructor(message: string, code?: string) {
        super(message);
        this.name = 'HTTPError';
        this.code = code;
    }
}

export class TimeoutError extends Error {
    code = 'ETIMEDOUT';
    constructor(message: string) {
        super(message);
        this.name = 'TimeoutError';
    }
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_RETRY_LIMIT = 2;

//Bound to the configured outbound interface (if any); reused across calls that don't
//override `localAddress`. A fresh Agent is only created for calls that explicitly
//provide their own `localAddress` (including `undefined`, to bypass the bound one).
const boundDispatcher = txHostConfig.netInterface
    ? new Agent({ connect: { localAddress: txHostConfig.netInterface } })
    : undefined;
const unboundDispatcher = new Agent();

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const backoffMs = (attempt: number) => Math.min(250 * 2 ** attempt, 5000);

function resolveDispatcher(opts: GotOptions): Dispatcher | undefined {
    if ('localAddress' in opts) {
        return opts.localAddress ? new Agent({ connect: { localAddress: opts.localAddress } }) : unboundDispatcher;
    }
    return boundDispatcher;
}

/**
 * got exposes phase-specific timeouts (lookup/connect/response/send) that undici's
 * fetch has no equivalent for. Approximated as a single overall timeout using the
 * largest specified phase - preserves "requests still time out", not exact phase semantics.
 */
function resolveTimeoutMs(t?: GotTimeoutOpts): number {
    if (!t) return DEFAULT_TIMEOUT_MS;
    const candidates = [t.request, t.response, t.connect, t.lookup, t.send].filter(
        (v): v is number => typeof v === 'number',
    );
    return candidates.length ? Math.max(...candidates) : DEFAULT_TIMEOUT_MS;
}

function resolveRedirect(opts: GotOptions): 'follow' | 'manual' {
    return opts.maxRedirects === 0 ? 'manual' : 'follow';
}

function buildHeaders(opts: GotOptions): Record<string, string> {
    const headers: Record<string, string> = {
        'User-Agent': `txAdmin ${txEnv.txaVersion}`,
        //undici advertises 'br' over https by default; opt out so well-behaved servers never hand
        //us Brotli, keeping the embedded Node's decoder (CVE-2026-111497) out of the response path.
        'Accept-Encoding': 'gzip, deflate',
        ...(opts.headers ?? {}),
    };
    if (opts.username || opts.password) {
        const token = Buffer.from(`${opts.username ?? ''}:${opts.password ?? ''}`).toString('base64');
        headers['Authorization'] = `Basic ${token}`;
    }
    return headers;
}

function isAcceptableResponse(res: Response, redirect: 'follow' | 'manual'): boolean {
    if (redirect === 'manual' && res.status >= 300 && res.status < 400) return true;
    return res.ok;
}

/**
 * Normalizes AbortSignal-timeout aborts into our TimeoutError; passes everything else through.
 * Not checked via `instanceof Error` because the DOMException thrown by AbortSignal.timeout()
 * doesn't necessarily extend Error - only `.name` is guaranteed.
 */
function normalizeFetchError(err: unknown): unknown {
    if (err && typeof err === 'object' && (err as { name?: unknown }).name === 'TimeoutError') {
        return new TimeoutError(`Timeout awaiting request`);
    }
    return err;
}

async function fetchWithRetry(
    url: string | URL,
    buildInit: () => Record<string, any>,
    retryLimit: number,
): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retryLimit; attempt++) {
        try {
            const res = (await undiciFetch(url as any, buildInit() as any)) as unknown as Response;
            if (res.status >= 500 && attempt < retryLimit) {
                lastError = new HTTPError(`Response code ${res.status} (${res.statusText})`);
                await delay(backoffMs(attempt));
                continue;
            }
            return res;
        } catch (err) {
            lastError = normalizeFetchError(err);
            if (attempt < retryLimit) {
                await delay(backoffMs(attempt));
                continue;
            }
            throw lastError;
        }
    }
    throw lastError;
}

async function performRequest(url: string | URL, opts: GotOptions, method: 'GET' | 'POST'): Promise<Response> {
    const timeoutMs = resolveTimeoutMs(opts.timeout);
    const dispatcher = resolveDispatcher(opts);
    const redirect = resolveRedirect(opts);
    const retryLimit = opts.retry ? (opts.retry.limit ?? DEFAULT_RETRY_LIMIT) : DEFAULT_RETRY_LIMIT;
    const headers = buildHeaders(opts);
    if (opts.json !== undefined) {
        headers['Content-Type'] = 'application/json';
    }

    const buildInit = () => ({
        method,
        headers,
        redirect,
        dispatcher,
        signal: AbortSignal.timeout(timeoutMs),
        ...(opts.json !== undefined ? { body: JSON.stringify(opts.json) } : {}),
    });

    const res = await fetchWithRetry(url, buildInit, retryLimit);
    if (opts.throwHttpErrors !== false && !isAcceptableResponse(res, redirect)) {
        throw new HTTPError(`Response code ${res.status} (${res.statusText})`);
    }
    return res;
}

async function toResponseLike(url: string | URL, opts: GotOptions): Promise<GotResponseLike> {
    const res = await performRequest(url, opts, 'GET');
    const body = await res.text();
    return {
        statusCode: res.status,
        statusMessage: res.statusText,
        headers: Object.fromEntries(res.headers.entries()),
        url: res.url,
        body,
    };
}

type GotChainablePromise = Promise<GotResponseLike> & {
    json<T = any>(): Promise<T>;
    text(): Promise<string>;
};

/**
 * Returns a Promise that resolves to a got-style response object (for call sites that
 * `await got.get(...)` directly and inspect `.statusCode`/`.body`), while also exposing
 * `.json()`/`.text()` convenience methods (for call sites that chain them). Only fetches
 * once regardless of which access pattern is used, since both derive from the same
 * memoized underlying request.
 */
function chainableFor(url: string | URL, opts: GotOptions): GotChainablePromise {
    let cached: Promise<GotResponseLike> | undefined;
    const load = () => (cached ??= toResponseLike(url, opts));

    const promise = load() as GotChainablePromise;
    promise.json = async <T = any>(): Promise<T> => {
        const r = await load();
        return JSON.parse(r.body) as T;
    };
    promise.text = async (): Promise<string> => {
        const r = await load();
        return r.body;
    };
    return promise;
}

function got(url: string | URL, opts: GotOptions = {}): GotChainablePromise {
    return chainableFor(url, opts);
}

got.get = (url: string | URL, opts: GotOptions = {}): GotChainablePromise => chainableFor(url, opts);

got.post = async (url: string | URL, opts: GotOptions = {}): Promise<void> => {
    await performRequest(url, opts, 'POST');
};

got.stream = (url: string | URL, opts: GotOptions = {}): PassThrough => {
    const output = new PassThrough();
    void (async () => {
        try {
            const res = await performRequest(url, opts, 'GET');
            if (!res.body) throw new Error('Response has no body');
            const total = Number(res.headers.get('content-length')) || 0;
            let received = 0;
            const nodeStream = Readable.fromWeb(res.body as any);
            nodeStream.on('data', (chunk: Buffer) => {
                received += chunk.length;
                if (total > 0) {
                    output.emit('downloadProgress', { percent: received / total, transferred: received, total });
                }
            });
            nodeStream.on('error', (err) => output.destroy(err));
            nodeStream.pipe(output);
        } catch (err) {
            output.destroy(err instanceof Error ? err : new Error(String(err)));
        }
    })();
    return output;
};

export default got;
