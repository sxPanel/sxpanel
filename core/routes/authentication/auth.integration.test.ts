import { suite, it, expect, vi } from 'vitest';
import AuthVerifyPassword from './verifyPassword';
import AuthLogout from './logout';
import AuthSelf from './self';
import { StoredAdmin } from '@modules/AdminStore/adminClasses';

// Mock admin
const mockAdminRaw = {
    $schema: 1,
    name: 'admin',
    master: true,
    password_hash: '$2b$11$K3HwDzkoUfhU6.W.tScfhOLEtR5uNc9qpQ685emtERx3dZ7fmgXCy',
    providers: {},
    permissions: ['all_permissions'],
};
const storedAdmin = new StoredAdmin(mockAdminRaw);
const totpAdmin = new StoredAdmin({
    ...mockAdminRaw,
    name: 'totpadmin',
    totp_secret: 'JBSWY3DPEHPK3PXP',
});

vi.stubGlobal('txEnv', {
    txaVersion: '0.3.1-Alpha-01',
});

vi.stubGlobal('txCore', {
    adminStore: {
        hasAdmins: vi.fn(() => true),
        getAdminByName: vi.fn((name: string) => {
            if (name === 'admin') return storedAdmin;
            if (name === 'totpadmin') return totpAdmin;
            return null;
        }),
        genCsrfToken: vi.fn(() => 'csrf-token-gen'),
        updatePasswordHash: vi.fn(async (_name: string, hash: string) => ({
            passwordHash: hash,
            passwordRevision: 1,
        })),
    },
    cacheStore: { get: vi.fn(() => undefined) },
    logger: {
        system: { write: vi.fn() },
    },
});
vi.stubGlobal('txManager', {
    txRuntime: {
        loginOrigins: { count: vi.fn() },
        loginMethods: { count: vi.fn() },
    },
});
// Mock for InitializedCtx
function createInitCtx(
    overrides: {
        body?: any;
        query?: Record<string, string>;
        ip?: string;
    } = {},
) {
    const sentData: any[] = [];
    const sessData: { auth?: any } = {};
    const ctx = {
        request: {
            body: overrides.body ?? {},
            query: overrides.query ?? {},
        },
        ip: overrides.ip ?? '127.0.0.1',
        txVars: { hostType: 'localhost' },
        send: vi.fn((data: any) => sentData.push(data)),
        utils: {
            error: vi.fn((status: number, msg: string) => sentData.push({ error: msg, status })),
        },
        getBody: vi.fn((schema: any) => {
            try {
                return schema.parse(overrides.body);
            } catch {
                sentData.push({ error: 'Validation failed' });
                return undefined;
            }
        }),
        sessTools: {
            get: vi.fn(() => sessData),
            set: vi.fn((data: any) => Object.assign(sessData, data)),
            regenerate: vi.fn((data: any) => Object.assign(sessData, data)),
            destroy: vi.fn(),
        },
        admin: {
            name: 'admin',
            getAuthData: vi.fn(() => ({
                name: 'admin',
                permissions: ['all_permissions'],
                isMaster: true,
                isTempPassword: false,
                csrfToken: 'csrf',
                totpEnabled: false,
            })),
        },
    };
    return { ctx: ctx as any, sentData, sessData };
}

suite('AuthVerifyPassword', () => {
    it('should reject when no admins are set up', async () => {
        (txCore.adminStore.hasAdmins as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
        const { ctx, sentData } = createInitCtx({ body: { username: 'admin', password: 'teste123' } });
        await AuthVerifyPassword(ctx);
        expect(sentData[0]).toMatchObject({ error: 'no_admins_setup' });
    });

    it('should reject wrong username', async () => {
        const { ctx, sentData } = createInitCtx({ body: { username: 'nonexistent', password: 'teste123' } });
        await AuthVerifyPassword(ctx);
        expect(sentData[0]).toMatchObject({ error: expect.stringContaining('Wrong') });
    });

    it('should reject wrong password', async () => {
        const { ctx, sentData } = createInitCtx({ body: { username: 'admin', password: 'wrongpass' } });
        await AuthVerifyPassword(ctx);
        expect(sentData[0]).toMatchObject({ error: expect.stringContaining('Wrong') });
    });

    it('should succeed with correct credentials', async () => {
        const { ctx, sentData } = createInitCtx({ body: { username: 'admin', password: 'teste123' } });
        await AuthVerifyPassword(ctx);
        expect(sentData[0]).toMatchObject({ name: 'admin', isMaster: true });
        expect(ctx.sessTools.regenerate).toHaveBeenCalled();
        expect(txCore.logger.system.write).toHaveBeenCalledWith(
            'admin',
            expect.stringContaining('logged in'),
            'login',
            expect.objectContaining({ actionId: 'login.password' }),
        );
    });

    it('should require TOTP for 2FA-enabled admin', async () => {
        const { ctx, sentData } = createInitCtx({ body: { username: 'totpadmin', password: 'teste123' } });
        await AuthVerifyPassword(ctx);
        expect(sentData[0]).toMatchObject({ totp_required: true });
        expect(ctx.sessTools.regenerate).toHaveBeenCalledWith(
            expect.objectContaining({ auth: expect.objectContaining({ type: 'pending_2fa' }) }),
        );
    });

    it('should prompt version refresh on UI version mismatch', async () => {
        const { ctx, sentData } = createInitCtx({
            body: { username: 'admin', password: 'teste123' },
            query: { uiVersion: '0.0.9' },
        });
        await AuthVerifyPassword(ctx);
        expect(sentData[0]).toMatchObject({ error: 'refreshToUpdate' });
    });
});

suite('AuthLogout', () => {
    it('should destroy session and return logout: true', async () => {
        const { ctx, sentData } = createInitCtx();
        await AuthLogout(ctx);
        expect(ctx.sessTools.destroy).toHaveBeenCalledOnce();
        expect(sentData[0]).toEqual({ logout: true });
    });
});

suite('AuthSelf', () => {
    it('should return admin auth data', async () => {
        const { ctx, sentData } = createInitCtx();
        await AuthSelf(ctx);
        expect(ctx.send).toHaveBeenCalledOnce();
        expect(sentData[0]).toMatchObject({ name: 'admin' });
    });
});
