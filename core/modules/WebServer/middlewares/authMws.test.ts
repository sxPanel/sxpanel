import { suite, it, expect, vi } from 'vitest';
import { intercomAuthMw } from './authMws';

// Mock the isIpAddressLocal module
vi.mock('@lib/host/isIpAddressLocal', () => ({
    isIpAddressLocal: vi.fn((ip: string) => /^(127\.|192\.168\.|10\.|::1)/.test(ip)),
}));

// Mock txCore.webServer.luaComToken
vi.stubGlobal('txCore', {
    webServer: {
        luaComToken: 'valid-lua-token-123',
    },
});

function createMockCtx(
    overrides: {
        ip?: string;
        body?: any;
    } = {},
) {
    const sentData: any[] = [];
    return {
        ctx: {
            ip: overrides.ip ?? '127.0.0.1',
            request: {
                body: overrides.body ?? {},
            },
            headers: {},
            send: vi.fn((data: any) => sentData.push(data)),
        } as any,
        sentData,
    };
}

suite('intercomAuthMw', () => {
    suite('IP validation', () => {
        it('should reject requests from non-local IPs', async () => {
            const next = vi.fn();
            const { ctx, sentData } = createMockCtx({
                ip: '8.8.8.8',
                body: { txAdminToken: 'valid-lua-token-123' },
            });

            await intercomAuthMw(ctx, next);

            expect(next).not.toHaveBeenCalled();
            expect(sentData[0]).toEqual({ error: 'invalid request origin' });
        });

        it('should allow requests from 127.0.0.1', async () => {
            const next = vi.fn();
            const { ctx } = createMockCtx({
                ip: '127.0.0.1',
                body: { txAdminToken: 'valid-lua-token-123' },
            });

            await intercomAuthMw(ctx, next);

            expect(next).toHaveBeenCalledOnce();
        });

        it('should allow requests from LAN IPs', async () => {
            const next = vi.fn();
            const { ctx } = createMockCtx({
                ip: '192.168.1.50',
                body: { txAdminToken: 'valid-lua-token-123' },
            });

            await intercomAuthMw(ctx, next);

            expect(next).toHaveBeenCalledOnce();
        });

        it('should allow requests from 10.x.x.x', async () => {
            const next = vi.fn();
            const { ctx } = createMockCtx({
                ip: '10.0.0.5',
                body: { txAdminToken: 'valid-lua-token-123' },
            });

            await intercomAuthMw(ctx, next);

            expect(next).toHaveBeenCalledOnce();
        });

        it('should allow requests from IPv6 loopback', async () => {
            const next = vi.fn();
            const { ctx } = createMockCtx({
                ip: '::1',
                body: { txAdminToken: 'valid-lua-token-123' },
            });

            await intercomAuthMw(ctx, next);

            expect(next).toHaveBeenCalledOnce();
        });
    });

    suite('token validation', () => {
        it('should reject missing token', async () => {
            const next = vi.fn();
            const { ctx, sentData } = createMockCtx({
                body: {},
            });

            await intercomAuthMw(ctx, next);

            expect(next).not.toHaveBeenCalled();
            expect(sentData[0]).toEqual({ error: 'invalid token' });
        });

        it('should reject wrong token', async () => {
            const next = vi.fn();
            const { ctx, sentData } = createMockCtx({
                body: { txAdminToken: 'wrong-token' },
            });

            await intercomAuthMw(ctx, next);

            expect(next).not.toHaveBeenCalled();
            expect(sentData[0]).toEqual({ error: 'invalid token' });
        });

        it('should reject non-string token', async () => {
            const next = vi.fn();
            const { ctx, sentData } = createMockCtx({
                body: { txAdminToken: 12345 },
            });

            await intercomAuthMw(ctx, next);

            expect(next).not.toHaveBeenCalled();
            expect(sentData[0]).toEqual({ error: 'invalid token' });
        });

        it('should accept valid token from local IP', async () => {
            const next = vi.fn();
            const { ctx } = createMockCtx({
                body: { txAdminToken: 'valid-lua-token-123' },
            });

            await intercomAuthMw(ctx, next);

            expect(next).toHaveBeenCalledOnce();
        });
    });

    suite('combined checks', () => {
        it('should check IP before token (non-local IP with valid token)', async () => {
            const next = vi.fn();
            const { ctx, sentData } = createMockCtx({
                ip: '203.0.113.1',
                body: { txAdminToken: 'valid-lua-token-123' },
            });

            await intercomAuthMw(ctx, next);

            expect(next).not.toHaveBeenCalled();
            // Should fail on IP check, not token
            expect(sentData[0]).toEqual({ error: 'invalid request origin' });
        });

        it('should check token after IP passes (local IP with bad token)', async () => {
            const next = vi.fn();
            const { ctx, sentData } = createMockCtx({
                ip: '127.0.0.1',
                body: { txAdminToken: 'bad-token' },
            });

            await intercomAuthMw(ctx, next);

            expect(next).not.toHaveBeenCalled();
            expect(sentData[0]).toEqual({ error: 'invalid token' });
        });
    });
});
