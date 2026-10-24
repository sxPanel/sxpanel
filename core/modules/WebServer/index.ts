const modulename = 'WebServer';
import crypto from 'node:crypto';
import path from 'node:path';
import HttpClass from 'node:http';

import Koa from 'koa';
import KoaBodyParser from 'koa-bodyparser';
import KoaCors from '@koa/cors';

import { Server as SocketIO } from 'socket.io';
import WebSocket from './webSocket';

import { customAlphabet } from 'nanoid';
import { nolookalikes } from 'nanoid-dictionary';

import { txDevEnv, txEnv, txHostConfig } from '@core/globalData';
import router from './router';
import consoleFactory from '@lib/console';
import topLevelMw from './middlewares/topLevelMw';
import securityHeadersMw from './middlewares/securityHeadersMw';
import ctxVarsMw from './middlewares/ctxVarsMw';
import ctxUtilsMw from './middlewares/ctxUtilsMw';
import { SessionMemoryStorage, koaSessMw, socketioSessMw } from './middlewares/sessionMws';
import checkRateLimit from './middlewares/globalRateLimiter';
import checkHttpLoad from './middlewares/httpLoadMonitor';
import cacheControlMw from './middlewares/cacheControlMw';
import fatalError from '@lib/fatalError';
import { isProxy } from 'node:util/types';
import serveStaticMw from './middlewares/serveStaticMw';
import serveRuntimeMw from './middlewares/serveRuntimeMw';
import { PANEL_STATIC_CACHE_LIMITS } from '@shared/panelStaticCacheLimits';
const console = consoleFactory(modulename);
const nanoid = customAlphabet(nolookalikes, 32);

/**
 * Module for the web server and socket.io.
 * It defines behaviors through middlewares, and instantiates the Koa app and the SocketIO server.
 */
export default class WebServer {
    public isListening = false;
    public isServing = false;
    private sessionCookieName: string;
    private legacySessionCookieName: string;
    public luaComToken: string;
    //setupKoa
    private app: Koa;
    public sessionStore: SessionMemoryStorage;
    private koaCallback: (req: any, res: any) => Promise<void>;
    //setupWebSocket
    private io: SocketIO;
    public webSocket: WebSocket;
    //setupServerCallbacks
    private httpServer?: HttpClass.Server;

    constructor() {
        //Generate cookie key & luaComToken
        const pathHash = crypto.createHash('shake256', { outputLength: 6 }).update(txEnv.profilePath).digest('hex');
        this.sessionCookieName = `fxp:${pathHash}`;
        this.legacySessionCookieName = `tx:${pathHash}`;
        this.luaComToken = nanoid();

        // ===================
        // Setting up Koa
        // ===================
        this.app = new Koa();
        // Cookie signing key — 32 bytes (256 bits) of CSPRNG output, freshly
        // generated on every process start. Rotating on restart intentionally
        // invalidates old signed cookies; any attempt to forge a cookie signature
        // would need to brute-force the full 256-bit key.
        this.app.keys = [crypto.randomBytes(32).toString('base64url')];

        // Koa `ctx.ip` / secure / host: opt-in via `txConfig.webServer.trustProxy`.
        // When enabled, terminate TLS and sanitize X-Forwarded-* only at a trusted edge.
        if (txConfig.webServer.trustProxy) {
            this.app.proxy = true;
            const hops = txConfig.webServer.proxyTrustedHops;
            if (typeof hops === 'number' && hops > 0) {
                this.app.maxIpsCount = hops;
            }
        }

        //Setting up app
        this.app.on('error', (error, ctx) => {
            if (
                !(
                    error.code?.startsWith('HPE_') ||
                    error.code?.startsWith('ECONN') ||
                    error.code === 'EPIPE' ||
                    error.code === 'ECANCELED'
                )
            ) {
                console.error(`Probably harmless error on ${ctx.path}`);
                console.dir(error);
            }
        });

        //CORS in dev mode — restricted to localhost dev servers (Vite, etc.)
        //instead of reflecting arbitrary Origin headers. Cookies are not
        //exposed cross-origin (credentials=false).
        if (txDevEnv.ENABLED) {
            const devOriginAllowlist = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
            this.app.use(
                KoaCors({
                    origin: (ctx) => {
                        const requestOrigin = ctx.get('Origin');
                        return devOriginAllowlist.test(requestOrigin) ? requestOrigin : '';
                    },
                    credentials: false,
                }),
            );
        }

        //Setting up timeout/error/no-output/413
        this.app.use(topLevelMw);

        //Setting up security headers
        this.app.use(securityHeadersMw);

        //Setting up additional middlewares:
        this.app.use(serveRuntimeMw);
        this.app.use(
            serveStaticMw({
                noCaching: txDevEnv.ENABLED,
                cacheMaxAge: 30 * 60, //30 minutes
                // Scan limits guard in-memory cache size (raw+gzip+brotli per file).
                // Current prod build: ~309 files, ~5.6MB raw — see panel/scripts/verify-static-cache-limit.mjs
                limits: PANEL_STATIC_CACHE_LIMITS,
                roots: [
                    txDevEnv.ENABLED ? path.join(txDevEnv.SRC_PATH, 'panel/public') : path.join(txEnv.txaPath, 'panel'),
                ],
                onReady: () => {
                    this.isServing = true;
                },
            }),
        );

        this.app.use(
            KoaBodyParser({
                // Heavy bodies can cause v8 mem exhaustion during a POST DDoS.
                // Deferral card configs with rasterized custom_image data URLs can exceed 2mb.
                jsonLimit: '8mb',
            }),
        );

        //Custom stuff
        const persistPath = txConfig.webServer.persistSessions
            ? txEnv.profileSubPath('data', 'sessions.json')
            : undefined;
        this.sessionStore = new SessionMemoryStorage(undefined, persistPath);
        this.app.use(cacheControlMw);
        this.app.use(koaSessMw(this.sessionCookieName, this.sessionStore, this.legacySessionCookieName));
        this.app.use(ctxVarsMw);
        this.app.use(ctxUtilsMw);

        //Setting up routes
        const txRouter = router();
        this.app.use(txRouter.routes());
        this.app.use(txRouter.allowedMethods());
        this.app.use(async (ctx) => {
            if (typeof ctx._matchedRoute === 'undefined') {
                if (ctx.path.startsWith('/legacy')) {
                    ctx.status = 404;
                    console.verbose.warn(`Request 404 error: ${ctx.path}`);
                    return ctx.send('Not found.');
                } else if (ctx.path.endsWith('.map')) {
                    ctx.status = 404;
                    return ctx.send('Not found.');
                } else {
                    return ctx.utils.serveReactIndex();
                }
            }
        });
        this.koaCallback = this.app.callback();

        // ===================
        // Setting up SocketIO
        // ===================
        this.io = new SocketIO(HttpClass.createServer(), { serveClient: false });
        this.io.use(
            socketioSessMw(
                this.sessionCookieName,
                this.sessionStore,
                this.app.keys as string[],
                this.legacySessionCookieName,
            ),
        );
        this.webSocket = new WebSocket(this.io);
        //@ts-expect-error handleConnection expects extended socket type
        this.io.on('connection', this.webSocket.handleConnection.bind(this.webSocket));

        // ===================
        // Setting up Callbacks
        // ===================
        this.setupServerCallbacks();
    }

    /**
     * Handler for all HTTP requests
     * Note: i gave up on typing these
     */
    httpCallbackHandler(req: any, res: any) {
        //Calls the appropriate callback
        try {
            // console.debug(`HTTP ${req.method} ${req.url}`);
            if (!checkHttpLoad()) {
                res.statusCode = 503;
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.setHeader('Connection', 'close');
                res.end('Service Unavailable');
                return;
            }
            if (!checkRateLimit(req?.socket?.remoteAddress)) {
                res.statusCode = 429;
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.setHeader('Connection', 'close');
                res.end('Too Many Requests');
                return;
            }

            //CVE-2026-111497 mitigation (upstream txAdmin 1db5eb0)
            //Reject inbound encoded bodies before Koa/Socket.IO decodes them.
            //NOTE: only affects request decompression, response compression is unchanged.
            const contentEncoding = req.headers['content-encoding'];
            if (contentEncoding !== undefined) {
                if (typeof contentEncoding !== 'string' || contentEncoding.trim().toLowerCase() !== 'identity') {
                    res.statusCode = 415;
                    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                    res.setHeader('Accept-Encoding', 'identity');
                    res.end('Unsupported Content-Encoding');
                    return;
                }
                //Downstream parsers must also recognize case/whitespace variants
                req.headers['content-encoding'] = 'identity';
            }

            if (req.url.startsWith('/socket.io')) {
                (this.io.engine as any).handleRequest(req, res);
            } else {
                this.koaCallback(req, res);
            }
        } catch (error) {
            /* top-level handler, errors logged by framework */
        }
    }
    setupServerCallbacks() {
        //Just in case i want to re-execute this function
        this.isListening = false;

        //HTTP Server
        try {
            const listenErrorHandler = (error: any) => {
                if (error.code !== 'EADDRINUSE') return;
                fatalError.WebServer(0, [
                    `Failed to start HTTP server, port ${error.port} is already in use.`,
                    'Maybe you already have another sxPanel running in this port.',
                    'If you want to run multiple sxPanel instances, check the documentation for the port convar.',
                    'You can also try restarting the host machine.',
                ]);
            };
            this.httpServer = HttpClass.createServer(this.httpCallbackHandler.bind(this));
            // this.httpServer = HttpClass.createServer((req, res) => {
            //     // const reqSize = parseInt(req.headers['content-length'] || '0');
            //     // if (req.method === 'POST' && reqSize > 0) {
            //     //     console.debug(chalk.yellow(bytes(reqSize)), `HTTP ${req.method} ${req.url}`);
            //     // }

            //     this.httpCallbackHandler(req, res);
            //     // if(checkRateLimit(req?.socket?.remoteAddress)){
            //     //     this.httpCallbackHandler(req, res);
            //     // }else {
            //     //     req.destroy();
            //     // }
            // });
            this.httpServer.on('error', listenErrorHandler);

            const netInterface = txHostConfig.netInterface ?? '0.0.0.0';
            if (txHostConfig.netInterface) {
                console.warn(`Starting with interface ${txHostConfig.netInterface}.`);
                console.warn("If the HTTP server doesn't start, this is probably the reason.");
            }

            this.httpServer.listen(txHostConfig.txaPort, netInterface, async () => {
                //Sanity check on globals, to _guarantee_ all routes will have access to them
                if (!txCore || isProxy(txCore) || !txConfig || !txManager) {
                    console.dir({
                        txCore: Boolean(txCore),
                        txCoreType: isProxy(txCore) ? 'proxy' : 'not proxy',
                        txConfig: Boolean(txConfig),
                        txManager: Boolean(txManager),
                    });
                    fatalError.WebServer(2, [
                        'The HTTP server started before the globals were ready.',
                        'This error should NEVER happen.',
                        'Please report it to the developers.',
                    ]);
                }
                if (txHostConfig.netInterface) {
                    console.ok(`Listening on ${netInterface}.`);
                }
                this.isListening = true;
            });
        } catch (error) {
            fatalError.WebServer(1, 'Failed to start HTTP server.', error);
        }
    }

    /**
     * handler for the shutdown event
     */
    public handleShutdown() {
        this.sessionStore.handleShutdown();
        return this.webSocket.handleShutdown();
    }

    /**
     * Resetting lua comms token - called by fxRunner on spawnServer()
     */
    resetToken() {
        this.luaComToken = nanoid();
        console.verbose.debug('Resetting luaComToken.');
    }
}
