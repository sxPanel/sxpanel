/**
 * Higher-order function that wraps a route handler in try/catch.
 * Unhandled errors are logged and returned as { error } JSON.
 *
 * AppError instances preserve their message + HTTP status.
 * All other errors are masked as "Internal server error" in production.
 *
 * Usage: router.get('/path', apiAuthMw, wrapRoute('RouteName', handler));
 */
import consoleFactory from '@lib/console';
import type { InitializedCtx, AuthedCtx } from '@modules/WebServer/ctxTypes';

type AnyCtx = InitializedCtx | AuthedCtx;
type RouteHandler = (ctx: AnyCtx) => Promise<void> | void;

export function wrapRoute(routeName: string, handler: RouteHandler): RouteHandler {
    const console = consoleFactory(`WebServer:${routeName}`);

    return async (ctx: AnyCtx) => {
        try {
            await handler(ctx);
        } catch (error) {
            console.error(`Unhandled error: ${emsg(error)}`);
            console.verbose.dir(error);
            throw error;
        }
    };
}
