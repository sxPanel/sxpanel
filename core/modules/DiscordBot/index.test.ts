import { afterEach, beforeEach, expect, it, suite, vi } from 'vitest';

// ============================================================================
// Mocks
//
// DiscordBot's own orchestration logic (constructor, config-update decision
// tree, lifecycle/recovery actions, diagnostics, bridge message dispatch) is
// what's under test here. Its two heavyweight collaborators - the child
// process wrapper (botProcess.ts) and the bridge WebSocket server
// (bridgeServer.ts) - are mocked with controllable fakes so we can simulate
// process/bridge lifecycle events and inbound bridge messages without
// spinning up a real child process or WebSocket server.
//
// Sibling modules that already have dedicated test coverage (moderationCommands,
// statusMessage, ticketCommandUtils, logRouting, componentsV2) are either used
// for real (componentsV2, ticketCommandUtils, discordLocale, rolePermissions -
// all pure/near-pure) or mocked away (moderationCommands) to avoid pulling in
// unrelated dependency chains (@routes/player/actions etc) for a handler this
// suite intentionally does not deep-dive into.
// ============================================================================

const mocks = vi.hoisted(() => ({
    findPlayersByIdentifier: vi.fn(),
    getDisplayPlayerCount: vi.fn(() => 0),
    getActiveWorkflow: vi.fn(),
    approveWhitelistRequest: vi.fn(),
    handleWhitelistThreadReaction: vi.fn(),
    discordTagMappingsTouchRoles: vi.fn(() => false),
    refreshPlayerDiscordTags: vi.fn(),
    handleModerationCommand: vi.fn(),
    botProcessInstances: [] as any[],
    bridgeServerInstances: [] as any[],
}));

vi.mock('@core/globalData', () => ({
    txEnv: { txaVersion: '9.9.9-test' },
    txHostConfig: { dataSubPath: (...parts: string[]) => parts.join('/') },
}));

vi.mock('@lib/player/playerFinder', () => ({
    findPlayersByIdentifier: mocks.findPlayersByIdentifier,
}));

vi.mock('@lib/fxserver/httpHealthCheck', () => ({
    getDisplayPlayerCount: mocks.getDisplayPlayerCount,
}));

vi.mock('@modules/Whitelist/WhitelistService', () => ({
    getActiveWorkflow: mocks.getActiveWorkflow,
}));

vi.mock('@modules/Whitelist/requestActions', () => ({
    approveWhitelistRequest: mocks.approveWhitelistRequest,
    handleWhitelistThreadReaction: mocks.handleWhitelistThreadReaction,
}));

vi.mock('@lib/player/playerTags', () => ({
    discordTagMappingsTouchRoles: mocks.discordTagMappingsTouchRoles,
    refreshPlayerDiscordTags: mocks.refreshPlayerDiscordTags,
}));

vi.mock('./moderationCommands', () => ({
    handleModerationCommand: mocks.handleModerationCommand,
}));

// BotProcess: controllable fake capturing the constructor's `onError`/`onExit`
// callbacks (which DiscordBot wires to its own #handleBotProcessFailure) plus
// spy-able start/stop/restart methods.
vi.mock('./botProcess', () => {
    const ctor = vi.fn().mockImplementation(function (this: any, options: any) {
        Object.assign(this, {
            options,
            isRunning: false,
            hasPendingRestart: false,
            nextRestartDelayMs: null,
            lastOutputLine: undefined,
            lastErrorLine: undefined,
            restart: vi.fn(),
            stop: vi.fn(),
            markHealthy: vi.fn(),
        });
        mocks.botProcessInstances.push(this);
    });
    return { default: ctor };
});

// BridgeServer: controllable fake capturing the constructor's
// `onAuthenticated`/`onDisconnected`/`onPushMessage`/`onRequest` callbacks so
// tests can simulate bridge traffic by invoking them directly.
vi.mock('./bridgeServer', () => {
    const ctor = vi.fn().mockImplementation(function (this: any, options: any) {
        Object.assign(this, {
            options,
            isReady: false,
            listen: vi.fn().mockResolvedValue(undefined),
            close: vi.fn().mockResolvedValue(undefined),
            send: vi.fn().mockReturnValue(true),
            request: vi.fn().mockResolvedValue(undefined),
        });
        mocks.bridgeServerInstances.push(this);
    });
    return { default: ctor };
});

vi.stubGlobal('emsg', (e: unknown) => (e instanceof Error ? e.message : String(e)));

import DiscordBot from './index';
import { DiscordBotStatus } from '@shared/enums';
import { UpdateConfigKeySet } from '@modules/ConfigStore/utils';

// ============================================================================
// txCore / txConfig / txManager stubs
// ============================================================================

const createTxCoreStub = () => ({
    adminStore: {
        getAdminByProviderUID: vi.fn(),
        registeredPermissions: {
            'players.whitelist': 'Manage Whitelist',
            'players.reports': 'Manage Reports',
            'settings.write': 'Manage Settings',
        } as Record<string, string>,
        syncAdminDiscordRolePermissions: vi.fn().mockResolvedValue(undefined),
    },
    cacheStore: {
        get: vi.fn(),
        set: vi.fn(),
        delete: vi.fn(),
    },
    database: {
        botAnalytics: { recordCommandEvent: vi.fn() },
        players: { findOne: vi.fn() },
        tickets: {
            findOne: vi.fn(),
            findByDiscordThread: vi.fn(),
            findAll: vi.fn(() => []),
            getAnalytics: vi.fn(() => ({})),
            addActivityEntry: vi.fn(),
            addMessage: vi.fn(),
            setClaimed: vi.fn(),
            setStatus: vi.fn(),
            setDiscordThread: vi.fn(),
            getDiscordThreadId: vi.fn(),
        },
        whitelist: {
            registerApproval: vi.fn(),
            findManyRequests: vi.fn(() => []),
            updateApplication: vi.fn(),
        },
    },
    addonManager: {
        getDiscordBotManifest: vi.fn(() => []),
        getAddon: vi.fn(),
    },
    fxMonitor: { status: { uptime: 12345 } },
    fxPlayerlist: {
        getConnectedPlayersByDiscordId: vi.fn(() => []),
        syncPlayerTags: vi.fn(),
        onlineCount: 0,
    },
    fxRunner: { sendEvent: vi.fn() },
    logger: { system: { write: vi.fn() } },
    translator: {
        canonical: 'en-US',
        t: vi.fn((key: string) => key),
        // Return no discord_bot key so discordLocale falls back to the real
        // (English) locale strings - deterministic and avoids re-mocking the
        // whole translation layer.
        getLanguagePhrases: vi.fn(() => ({})),
    },
    webServer: {
        webSocket: {
            pushRefresh: vi.fn(),
            reCheckAdminAuths: vi.fn().mockResolvedValue(undefined),
        },
    },
});

const createTxConfigStub = () => ({
    discordBot: {
        enabled: false,
        token: '',
        guild: '',
        warningsChannel: null as string | null,
        bridgePort: 40120,
        bridgeSecret: 'test-bridge-secret',
        oauthClientSecret: '',
        logGuildOverride: null as string | null,
        logRoutes: [] as unknown[],
        rolePermissions: [] as { discordRoleIds: string[]; label?: string; permissionPresetId?: string }[],
        customCommands: [] as unknown[],
        presence: {},
    },
    gameFeatures: { reportsEnabled: true },
    general: { language: 'en', serverName: 'Test Server' },
});

const createTxManagerStub = () => ({
    txRuntime: {
        botCommands: { count: vi.fn() },
    },
});

let txCoreStub: ReturnType<typeof createTxCoreStub>;
let txConfigStub: ReturnType<typeof createTxConfigStub>;
let txManagerStub: ReturnType<typeof createTxManagerStub>;
let createdBots: DiscordBot[] = [];

/**
 * Constructs a DiscordBot and flushes its constructor's `setImmediate` auto-start
 * check before returning. This is essential: the constructor schedules a REAL
 * `setImmediate` (not a fake timer) that reads the *current* global `txConfig` at
 * fire time, not at registration time. Without flushing it here (while the config
 * is still whatever it was at construction, i.e. disabled by default), a later
 * `enableBotConfig()` call in the same test would cause that stale callback to
 * fire mid-test and race a second, uncontrolled `startBot()` call against the
 * test's own explicit one.
 */
const newBot = async () => {
    const bot = new DiscordBot();
    createdBots.push(bot);
    await flushMicrotasks();
    return bot;
};

const latestBotProcess = () => mocks.botProcessInstances.at(-1);
const latestBridgeServer = () => mocks.bridgeServerInstances.at(-1);

/** Resolves once all currently-pending microtasks (promise chains) have drained. */
const flushMicrotasks = () => new Promise<void>((resolve) => setImmediate(resolve));

const enableBotConfig = (overrides: Partial<ReturnType<typeof createTxConfigStub>['discordBot']> = {}) => {
    Object.assign(txConfigStub.discordBot, {
        enabled: true,
        token: 'test-token',
        guild: 'test-guild-id',
        ...overrides,
    });
};

/** Starts the bot and waits until the (mocked) BridgeServer has been constructed, without waiting for readiness. */
async function bootStartingBot(bot: DiscordBot) {
    enableBotConfig();
    const startPromise = bot.startBot();
    startPromise.catch(() => {});
    await flushMicrotasks();
    const bridge = latestBridgeServer();
    const botProcess = latestBotProcess();
    return { bridge, startPromise, botProcess };
}

/** Starts the bot and simulates a full `botStatus: ready` push message, resolving the startBot() promise. */
async function bootReadyBot(bot: DiscordBot, opts: { tag?: string; guildName?: string } = {}) {
    const { bridge, startPromise, botProcess } = await bootStartingBot(bot);
    bridge.isReady = true;
    await bridge.options.onPushMessage({
        type: 'botStatus',
        status: 'ready',
        tag: opts.tag ?? 'Bot#0001',
        guildName: opts.guildName ?? 'Test Guild',
    });
    const result = await startPromise;
    return { result, bridge, botProcess };
}

const stringifyReplyComponents = (reply: { components?: Record<string, unknown>[] } | undefined) => {
    return JSON.stringify(reply?.components ?? []);
};

beforeEach(() => {
    mocks.botProcessInstances.length = 0;
    mocks.bridgeServerInstances.length = 0;
    mocks.findPlayersByIdentifier.mockReset();
    mocks.getDisplayPlayerCount.mockReset().mockReturnValue(0);
    mocks.getActiveWorkflow.mockReset();
    mocks.approveWhitelistRequest.mockReset();
    mocks.handleWhitelistThreadReaction.mockReset();
    mocks.discordTagMappingsTouchRoles.mockReset().mockReturnValue(false);
    mocks.refreshPlayerDiscordTags.mockReset();
    mocks.handleModerationCommand.mockReset();

    txCoreStub = createTxCoreStub();
    txConfigStub = createTxConfigStub();
    txManagerStub = createTxManagerStub();
    vi.stubGlobal('txCore', txCoreStub);
    vi.stubGlobal('txConfig', txConfigStub);
    vi.stubGlobal('txManager', txManagerStub);

    createdBots = [];
});

afterEach(async () => {
    // Drain any real setImmediate/microtask chains still in flight (e.g. a
    // constructor auto-start check for a bot that was never explicitly
    // flushed) *before* the next test's beforeEach replaces the global
    // txCore/txConfig stubs out from under it.
    await flushMicrotasks();

    for (const bot of createdBots) {
        try {
            bot.handleShutdown();
        } catch {
            // best-effort cleanup of pending timers between tests
        }
    }
    createdBots = [];
    // NOTE: intentionally NOT calling vi.restoreAllMocks() here - it would
    // call .mockRestore() on the BotProcess/BridgeServer constructor mocks
    // (module-level vi.fn().mockImplementation(...) with no "original" to
    // restore to), wiping their fake implementation for every subsequent
    // test. Spies created with vi.spyOn in individual tests are restored
    // explicitly at the end of those tests instead.
});

// ============================================================================
// Constructor / initial state
// ============================================================================

suite('DiscordBot constructor & diagnostics', () => {
    it('constructs without throwing and reports a disabled initial state', async () => {
        const bot = await newBot();
        const diag = bot.getDiagnostics();

        expect(diag.enabled).toBe(false);
        expect(diag.status).toBe(DiscordBotStatus.Disabled);
        expect(diag.isClientReady).toBe(false);
        expect(diag.guildName).toBeNull();
        expect(diag.lastReadyAt).toBeNull();
        expect(diag.lastBotError).toBeNull();
        expect(diag.lastProcessFailure).toBeNull();
        expect(diag.lastRecoveryAction).toBeNull();
        expect(diag.bridge).toMatchObject({
            isConnected: false,
            connectCount: 0,
            disconnectCount: 0,
            lastAuthenticatedAt: null,
            lastDisconnectedAt: null,
        });
        expect(diag.process.isRunning).toBe(false);
        expect(diag.runtime).toEqual({ addonLoadFailures: [], addonRuntimeIssues: [], updatedAt: null });
    });

    it('wires BotProcess onError callback to record a process failure', async () => {
        const bot = await newBot();
        const botProcess = latestBotProcess();

        botProcess.options.onError({ reason: 'spawn failed: ENOENT' });

        expect(bot.getDiagnostics().lastProcessFailure).toMatchObject({ reason: 'spawn failed: ENOENT' });
    });

    it('wires BotProcess onExit callback to record a process failure', async () => {
        const bot = await newBot();
        const botProcess = latestBotProcess();

        botProcess.options.onExit({ reason: 'process exited with code 1' });

        expect(bot.getDiagnostics().lastProcessFailure).toMatchObject({ reason: 'process exited with code 1' });
    });

    it('starts the bot automatically on construction when enabled', async () => {
        enableBotConfig();
        const startBotSpy = vi.spyOn(DiscordBot.prototype, 'startBot').mockResolvedValue(undefined as any);
        try {
            await newBot();
            expect(startBotSpy).toHaveBeenCalledTimes(1);
        } finally {
            startBotSpy.mockRestore();
        }
    });

    it('does not auto-start on construction when disabled', async () => {
        const startBotSpy = vi.spyOn(DiscordBot.prototype, 'startBot');
        try {
            await newBot();
            expect(startBotSpy).not.toHaveBeenCalled();
        } finally {
            startBotSpy.mockRestore();
        }
    });
});

// ============================================================================
// status / isClientReady getters
// ============================================================================

suite('DiscordBot status getters', () => {
    it('reports Disabled when the bot is not enabled', async () => {
        const bot = await newBot();
        expect(bot.status).toBe(DiscordBotStatus.Disabled);
        expect(bot.isClientReady).toBe(false);
    });

    it('reports the last explicit status while enabled but not bridge-ready', async () => {
        const bot = await newBot();
        await bootStartingBot(bot);

        expect(bot.status).toBe(DiscordBotStatus.Starting);
        expect(bot.isClientReady).toBe(false);
    });

    it('reports Ready only once the bridge is ready and status is explicitly Ready', async () => {
        const bot = await newBot();
        const { result } = await bootReadyBot(bot, { tag: 'Bot#42', guildName: 'My Guild' });

        expect(result).toContain('Bot#42');
        expect(result).toContain('My Guild');
        expect(bot.guildName).toBe('My Guild');
        expect(bot.status).toBe(DiscordBotStatus.Ready);
        expect(bot.isClientReady).toBe(true);
    });
});

// ============================================================================
// handleConfigUpdate
// ============================================================================

suite('DiscordBot handleConfigUpdate', () => {
    it('returns false immediately when the bot is disabled', async () => {
        const bot = await newBot();
        const updated = new UpdateConfigKeySet();
        updated.add('discordBot.customCommands');

        expect(bot.handleConfigUpdate(updated)).toBe(false);
    });

    it('reloads commands (without an extra config snapshot) when customCommands changes', async () => {
        const bot = await newBot();
        const { bridge } = await bootReadyBot(bot);
        bridge.send.mockClear();

        const updated = new UpdateConfigKeySet();
        updated.add('discordBot.customCommands');
        await bot.handleConfigUpdate(updated);

        const configSnapshotSends = bridge.send.mock.calls.filter(([msg]: any) => msg.type === 'configSnapshot');
        const reloadCommandSends = bridge.send.mock.calls.filter(([msg]: any) => msg.type === 'reloadCommands');
        // updateBotStatus() always sends exactly one configSnapshot; customCommands
        // changes should NOT add a second one (that only happens for reportsEnabled).
        expect(configSnapshotSends).toHaveLength(1);
        expect(reloadCommandSends).toHaveLength(1);
    });

    it('sends an extra config snapshot and reloads commands when reportsEnabled changes', async () => {
        const bot = await newBot();
        const { bridge } = await bootReadyBot(bot);
        bridge.send.mockClear();

        const updated = new UpdateConfigKeySet();
        updated.add('gameFeatures.reportsEnabled');
        await bot.handleConfigUpdate(updated);

        const configSnapshotSends = bridge.send.mock.calls.filter(([msg]: any) => msg.type === 'configSnapshot');
        const reloadCommandSends = bridge.send.mock.calls.filter(([msg]: any) => msg.type === 'reloadCommands');
        expect(configSnapshotSends).toHaveLength(2);
        expect(reloadCommandSends).toHaveLength(1);
    });

    it('re-checks admin auths when rolePermissions changes', async () => {
        const bot = await newBot();
        await bootReadyBot(bot);

        const updated = new UpdateConfigKeySet();
        updated.add('discordBot.rolePermissions');
        await bot.handleConfigUpdate(updated);

        expect(txCoreStub.webServer.webSocket.reCheckAdminAuths).toHaveBeenCalledTimes(1);
    });

    it('invalidates the guild roles cache when the guild changes', async () => {
        const bot = await newBot();
        const { bridge } = await bootReadyBot(bot);

        bridge.request.mockResolvedValueOnce({ roles: [{ id: 'r1', name: 'Role1' }] });
        const first = await bot.listGuildRoles();
        expect(bridge.request).toHaveBeenCalledTimes(1);
        expect(first.roles).toEqual([{ id: 'r1', name: 'Role1' }]);

        // Second call within the TTL should be served from cache (no new request).
        const second = await bot.listGuildRoles();
        expect(bridge.request).toHaveBeenCalledTimes(1);
        expect(second.roles).toEqual(first.roles);

        const updated = new UpdateConfigKeySet();
        updated.add('discordBot.guild');
        await bot.handleConfigUpdate(updated);

        bridge.request.mockResolvedValueOnce({ roles: [{ id: 'r2', name: 'Role2' }] });
        const third = await bot.listGuildRoles();
        expect(bridge.request).toHaveBeenCalledTimes(2);
        expect(third.roles).toEqual([{ id: 'r2', name: 'Role2' }]);
    });
});

// ============================================================================
// handleAddonReload
// ============================================================================

suite('DiscordBot handleAddonReload', () => {
    it('returns false when the bridge is not ready', async () => {
        const bot = await newBot();
        expect(bot.handleAddonReload()).toBe(false);
    });

    it('sends a config snapshot and reload command when the bridge is ready', async () => {
        const bot = await newBot();
        const { bridge } = await bootReadyBot(bot);
        bridge.send.mockClear();

        expect(bot.handleAddonReload()).toBe(true);
        expect(bridge.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'configSnapshot' }));
        expect(bridge.send).toHaveBeenCalledWith({ type: 'reloadCommands' });
    });
});

// ============================================================================
// handleShutdown
// ============================================================================

suite('DiscordBot handleShutdown', () => {
    it('rejects a pending start, stops the process, and closes the bridge', async () => {
        const bot = await newBot();
        const { bridge, botProcess, startPromise } = await bootStartingBot(bot);

        bot.handleShutdown();

        await expect(startPromise).rejects.toThrow('Discord bot shutdown.');
        expect(botProcess.stop).toHaveBeenCalled();
        expect(bridge.close).toHaveBeenCalled();
    });
});

// ============================================================================
// attemptBotReset
// ============================================================================

suite('DiscordBot attemptBotReset', () => {
    it('stops the runtime and disables when given `false`', async () => {
        const bot = await newBot();
        await bootReadyBot(bot);

        const result = await bot.attemptBotReset(false);

        expect(result).toBe(true);
        expect(latestBotProcess().stop).toHaveBeenCalled();
        expect(latestBridgeServer().close).toHaveBeenCalled();
        expect(bot.guildName).toBeUndefined();
        expect(bot.status).toBe(DiscordBotStatus.Disabled);
    });

    it('stops the runtime when given a disabled config object', async () => {
        const bot = await newBot();
        await bootReadyBot(bot);

        const result = await bot.attemptBotReset({ enabled: false, token: '', guild: '', warningsChannel: null });

        expect(result).toBe(true);
        expect(bot.status).toBe(DiscordBotStatus.Disabled);
    });

    it('delegates to startBot when given an enabled config with valid credentials', async () => {
        const bot = await newBot();
        const resetPromise = bot.attemptBotReset({
            enabled: true,
            token: 'reset-token',
            guild: 'reset-guild',
            warningsChannel: null,
        });
        await flushMicrotasks();

        const bridge = latestBridgeServer();
        bridge.isReady = true;
        await bridge.options.onPushMessage({ type: 'botStatus', status: 'ready', tag: 'Bot#1', guildName: 'G' });
        const result = await resetPromise;

        expect(typeof result).toBe('string');
        expect(latestBotProcess().restart).toHaveBeenCalledWith(
            expect.objectContaining({ token: 'reset-token', guild: 'reset-guild' }),
        );
    });
});

// ============================================================================
// restartRuntime / reloadRuntimeAddons / resyncRuntime + recovery actions
// ============================================================================

suite('DiscordBot recovery actions', () => {
    it('restartRuntime throws and records a failed action when the bot is disabled', async () => {
        const bot = await newBot();
        await expect(bot.restartRuntime()).rejects.toThrow('Discord bot is disabled.');

        expect(bot.getDiagnostics().lastRecoveryAction).toMatchObject({
            action: 'restartRuntime',
            source: 'manual',
            ok: false,
        });
    });

    it('restartRuntime succeeds and records an ok action with the default manual source', async () => {
        const bot = await newBot();
        enableBotConfig();
        const restartPromise = bot.restartRuntime();
        await flushMicrotasks();

        const bridge = latestBridgeServer();
        bridge.isReady = true;
        await bridge.options.onPushMessage({ type: 'botStatus', status: 'ready', tag: 'Bot#1', guildName: 'G' });
        const message = await restartPromise;

        expect(typeof message).toBe('string');
        expect(bot.getDiagnostics().lastRecoveryAction).toMatchObject({
            action: 'restartRuntime',
            source: 'manual',
            ok: true,
        });
    });

    it('restartRuntime records the automatic source when passed explicitly', async () => {
        const bot = await newBot();
        enableBotConfig();
        const restartPromise = bot.restartRuntime('automatic');
        await flushMicrotasks();

        const bridge = latestBridgeServer();
        bridge.isReady = true;
        await bridge.options.onPushMessage({ type: 'botStatus', status: 'ready', tag: 'Bot#1', guildName: 'G' });
        await restartPromise;

        expect(bot.getDiagnostics().lastRecoveryAction).toMatchObject({
            action: 'restartRuntime',
            source: 'automatic',
            ok: true,
        });
    });

    it('reloadRuntimeAddons throws and records a failed action when the bridge is not connected', async () => {
        const bot = await newBot();
        await expect(bot.reloadRuntimeAddons()).rejects.toThrow('Discord bridge is not connected.');

        expect(bot.getDiagnostics().lastRecoveryAction).toMatchObject({ action: 'reloadAddons', ok: false });
    });

    it('reloadRuntimeAddons succeeds and records an ok action when the bridge is ready', async () => {
        const bot = await newBot();
        const { bridge } = await bootReadyBot(bot);
        bridge.send.mockClear();

        const message = await bot.reloadRuntimeAddons();

        expect(typeof message).toBe('string');
        expect(bridge.send).toHaveBeenCalledWith({ type: 'reloadCommands' });
        expect(bot.getDiagnostics().lastRecoveryAction).toMatchObject({ action: 'reloadAddons', ok: true });
    });

    it('resyncRuntime throws when the bridge is not connected', async () => {
        const bot = await newBot();
        await expect(bot.resyncRuntime()).rejects.toThrow('Discord bridge is not connected.');
        expect(bot.getDiagnostics().lastRecoveryAction).toMatchObject({ action: 'resyncRuntime', ok: false });
    });

    it('resyncRuntime succeeds when the bridge is ready', async () => {
        const bot = await newBot();
        await bootReadyBot(bot);

        const message = await bot.resyncRuntime();

        expect(typeof message).toBe('string');
        expect(bot.getDiagnostics().lastRecoveryAction).toMatchObject({ action: 'resyncRuntime', ok: true });
    });
});

// ============================================================================
// applyRuntimeDiagnostics / refreshWsStatus
// ============================================================================

suite('DiscordBot diagnostics reporting', () => {
    it('normalizes addon diagnostics payloads, filling in defaults for missing fields', async () => {
        const bot = await newBot();

        bot.applyRuntimeDiagnostics({
            addonLoadFailures: [{ kind: 'event', filePath: '/addons/a.js', message: 'boom' } as any],
            addonRuntimeIssues: [
                { addonId: 'addon-1', interactionType: 'button', handlerId: 'h1', message: 'oops' } as any,
            ],
        });

        const diag = bot.getDiagnostics();
        expect(diag.runtime.addonLoadFailures[0]).toMatchObject({
            kind: 'event',
            filePath: '/addons/a.js',
            message: 'boom',
            addonId: null,
        });
        expect(diag.runtime.addonLoadFailures[0].updatedAt).toEqual(expect.any(Number));

        expect(diag.runtime.addonRuntimeIssues[0]).toMatchObject({
            addonId: 'addon-1',
            phase: 'execute',
            count: 1,
            filePath: null,
        });
        expect(diag.runtime.updatedAt).toEqual(expect.any(Number));
    });

    it('only pushes a websocket refresh when the status actually changes', async () => {
        const bot = await newBot();
        txCoreStub.webServer.webSocket.pushRefresh.mockClear();

        bot.refreshWsStatus();
        expect(txCoreStub.webServer.webSocket.pushRefresh).not.toHaveBeenCalled();

        // startBot() flips lastExplicitStatus to Starting synchronously, which
        // should trigger exactly one refresh push.
        enableBotConfig();
        const startPromise = bot.startBot();
        startPromise.catch(() => {});
        await flushMicrotasks();

        expect(txCoreStub.webServer.webSocket.pushRefresh).toHaveBeenCalledWith('status');
        expect(txCoreStub.webServer.webSocket.pushRefresh).toHaveBeenCalledTimes(1);

        txCoreStub.webServer.webSocket.pushRefresh.mockClear();
        bot.refreshWsStatus();
        expect(txCoreStub.webServer.webSocket.pushRefresh).not.toHaveBeenCalled();
    });
});

// ============================================================================
// startBot
// ============================================================================

suite('DiscordBot startBot', () => {
    it('throws when enabled but the token is missing', async () => {
        const bot = await newBot();
        expect(() => bot.startBot({ enabled: true, token: '', guild: 'gid', warningsChannel: null })).toThrow(
            'Discord bot enabled while token is not set.',
        );
    });

    it('throws when enabled but the guild is missing', async () => {
        const bot = await newBot();
        expect(() => bot.startBot({ enabled: true, token: 'tok', guild: '', warningsChannel: null })).toThrow(
            'Discord bot enabled while guild id is not set.',
        );
    });

    it('is a no-op when the bot config is disabled', async () => {
        const bot = await newBot();
        const result = bot.startBot({ enabled: false, token: '', guild: '', warningsChannel: null });

        expect(result).toBeUndefined();
        expect(mocks.bridgeServerInstances).toHaveLength(0);
    });

    it('constructs the bridge server with the configured port/secret and restarts the process', async () => {
        const bot = await newBot();
        enableBotConfig({ bridgePort: 55555, bridgeSecret: 'shh' });

        const { bridge, botProcess } = await bootStartingBot(bot);

        expect(bridge.options).toMatchObject({ port: 55555, secret: 'shh' });
        expect(botProcess.restart).toHaveBeenCalledWith({
            token: 'test-token',
            guild: 'test-guild-id',
            bridgePort: 55555,
            secret: 'shh',
        });
    });

    it('rejects and stops the process when the bot reports an error before becoming ready', async () => {
        const bot = await newBot();
        const { bridge, botProcess, startPromise } = await bootStartingBot(bot);
        bridge.isReady = true;

        await bridge.options.onPushMessage({
            type: 'botStatus',
            status: 'error',
            message: 'invalid token',
            code: 'TOKEN_INVALID',
        });

        await expect(startPromise).rejects.toThrow('invalid token');
        expect(botProcess.stop).toHaveBeenCalled();
        expect(bot.status).toBe(DiscordBotStatus.Error);
        expect(bot.getDiagnostics().lastBotError).toMatchObject({ code: 'TOKEN_INVALID', message: 'invalid token' });
    });
});

// ============================================================================
// Bridge push message dispatch
// ============================================================================

suite('DiscordBot bridge push message dispatch', () => {
    it('counts command usage via txManager', async () => {
        const bot = await newBot();
        const { bridge } = await bootStartingBot(bot);

        await bridge.options.onPushMessage({ type: 'botCommandUsage', commandName: 'ping' });

        expect(txManagerStub.txRuntime.botCommands.count).toHaveBeenCalledWith('ping');
    });

    it('records well-formed command telemetry events and ignores malformed ones', async () => {
        const bot = await newBot();
        const { bridge } = await bootStartingBot(bot);

        const validEvent = { id: 'evt1', ts: 123, commandName: 'ping', outcome: 'success' };
        await bridge.options.onPushMessage({ type: 'botCommandTelemetry', payload: validEvent });
        expect(txCoreStub.database.botAnalytics.recordCommandEvent).toHaveBeenCalledWith(validEvent);

        txCoreStub.database.botAnalytics.recordCommandEvent.mockClear();
        await bridge.options.onPushMessage({ type: 'botCommandTelemetry', payload: { id: 'evt2' } });
        expect(txCoreStub.database.botAnalytics.recordCommandEvent).not.toHaveBeenCalled();
    });

    it('applies runtime diagnostics pushed from the bot process', async () => {
        const bot = await newBot();
        const { bridge } = await bootStartingBot(bot);

        await bridge.options.onPushMessage({
            type: 'botDiagnostics',
            payload: { addonLoadFailures: [], addonRuntimeIssues: [], updatedAt: 555 },
        });

        expect(bot.getDiagnostics().runtime.updatedAt).toBe(555);
    });

    it('stops the process and rejects a pending start on process failure mid-startup', async () => {
        const bot = await newBot();
        const { botProcess, startPromise } = await bootStartingBot(bot);

        botProcess.options.onExit({ reason: 'crashed unexpectedly' });

        await expect(startPromise).rejects.toThrow('crashed unexpectedly');
        expect(botProcess.stop).toHaveBeenCalled();
    });
});

// ============================================================================
// Admin <-> Discord role sync (syncAdminDiscordRoleChange push message)
// ============================================================================

suite('DiscordBot admin Discord role sync', () => {
    it('does nothing when no role ids actually changed', async () => {
        const bot = await newBot();
        const { bridge } = await bootStartingBot(bot);

        await bridge.options.onPushMessage({
            type: 'syncAdminDiscordRoleChange',
            uid: 'user-1',
            addedRoleIds: [],
            removedRoleIds: [],
        });

        expect(txCoreStub.adminStore.syncAdminDiscordRolePermissions).not.toHaveBeenCalled();
        expect(mocks.discordTagMappingsTouchRoles).not.toHaveBeenCalled();
    });

    it('refreshes and syncs player Discord tags when a tag-mapped role changes', async () => {
        mocks.discordTagMappingsTouchRoles.mockReturnValue(true);
        mocks.refreshPlayerDiscordTags.mockResolvedValue(true);
        const player = { isRegistered: true, netid: 7 };
        txCoreStub.fxPlayerlist.getConnectedPlayersByDiscordId.mockReturnValue([player]);

        const bot = await newBot();
        const { bridge } = await bootStartingBot(bot);

        await bridge.options.onPushMessage({
            type: 'syncAdminDiscordRoleChange',
            uid: 'user-1',
            addedRoleIds: ['role-x'],
            removedRoleIds: [],
        });

        expect(mocks.refreshPlayerDiscordTags).toHaveBeenCalledWith(player);
        expect(txCoreStub.fxPlayerlist.syncPlayerTags).toHaveBeenCalledWith(7);
    });

    it('resolves member roles and syncs admin permissions for a linked admin with a mapped role', async () => {
        txConfigStub.discordBot.rolePermissions = [
            { discordRoleIds: ['role-1'], label: 'VIP', permissionPresetId: 'preset-vip' },
        ];
        txCoreStub.adminStore.getAdminByProviderUID.mockReturnValue({
            name: 'Admin',
            permissions: [],
            isMaster: false,
            providers: { discord: { id: 'user-1', identifier: 'user-1', data: {} } },
        });

        const bot = await newBot();
        const { bridge } = await bootStartingBot(bot);
        bridge.isReady = true; // resolveMemberRoles() requires the bridge to be ready
        bridge.request.mockResolvedValueOnce({ isMember: true, memberRoles: ['role-1'] });

        await bridge.options.onPushMessage({
            type: 'syncAdminDiscordRoleChange',
            uid: 'user-1',
            addedRoleIds: ['role-1'],
            removedRoleIds: [],
        });

        expect(bridge.request).toHaveBeenCalledWith('resolveMemberRoles', { uid: 'user-1' });
        expect(txCoreStub.adminStore.syncAdminDiscordRolePermissions).toHaveBeenCalledTimes(1);
        expect(txCoreStub.adminStore.syncAdminDiscordRolePermissions.mock.calls[0][0]).toBe('user-1');
    });
});

// ============================================================================
// Bridge request dispatch
// ============================================================================

suite('DiscordBot bridge request dispatch', () => {
    it('builds a sanitized config snapshot for the configSnapshot request', async () => {
        const bot = await newBot();
        const { bridge } = await bootStartingBot(bot);

        mocks.getDisplayPlayerCount.mockReturnValue(11);
        txCoreStub.cacheStore.get.mockImplementation((key: string) =>
            key === 'fxsRuntime:maxClients' ? 48 : undefined,
        );
        txCoreStub.addonManager.getDiscordBotManifest.mockReturnValue([{ id: 'addon1' }] as any);

        const response: any = await bridge.options.onRequest({ type: 'configSnapshot', requestId: 'r1' });

        expect(response.playerCount).toBe(11);
        expect(response.maxPlayers).toBe(48);
        expect(response.serverName).toBe('Test Server');
        expect(response.discordBotAddons).toEqual([{ id: 'addon1' }]);
        expect(response.discordBot.token).toBeUndefined();
        expect(response.discordBot.bridgeSecret).toBeUndefined();
        expect(response.telemetry).toMatchObject({ outcome: 'success', requestType: 'configSnapshot' });
    });

    it('denies playerLookup when the requester cannot be resolved', async () => {
        const bot = await newBot();
        const { bridge } = await bootStartingBot(bot);

        const response: any = await bridge.options.onRequest({
            type: 'playerLookup',
            searchId: 'license:x',
            adminView: true,
            requesterId: null,
        });

        expect(response.telemetry).toMatchObject({ outcome: 'denied', denialReason: 'invalid_request' });
        expect(mocks.findPlayersByIdentifier).not.toHaveBeenCalled();
    });

    it('grants a permissionCheck for a linked admin with the required permission', async () => {
        const bot = await newBot();
        const { bridge } = await bootStartingBot(bot);
        txCoreStub.adminStore.getAdminByProviderUID.mockReturnValue({
            name: 'Admin',
            permissions: ['players.reports'],
            isMaster: false,
            providers: {},
        });

        const response: any = await bridge.options.onRequest({
            type: 'permissionCheck',
            requesterId: '123',
            requiredPermission: 'players.reports',
        });

        expect(response.granted).toBe(true);
        expect(response.telemetry.outcome).toBe('success');
    });

    it('denies a permissionCheck for a linked admin missing the required permission', async () => {
        const bot = await newBot();
        const { bridge } = await bootStartingBot(bot);
        txCoreStub.adminStore.getAdminByProviderUID.mockReturnValue({
            name: 'Admin',
            permissions: [],
            isMaster: false,
            providers: {},
        });

        const response: any = await bridge.options.onRequest({
            type: 'permissionCheck',
            requesterId: '123',
            requiredPermission: 'players.reports',
        });

        expect(response.granted).toBe(false);
        expect(response.telemetry).toMatchObject({ outcome: 'denied', denialReason: 'missing_permissions' });
    });

    it('registers a whitelist member approval for a linked admin', async () => {
        const bot = await newBot();
        const { bridge } = await bootStartingBot(bot);
        txCoreStub.adminStore.getAdminByProviderUID.mockReturnValue({
            name: 'Admin',
            permissions: ['players.whitelist'],
            isMaster: false,
            providers: {},
        });

        const response: any = await bridge.options.onRequest({
            type: 'whitelistCommand',
            subcommand: 'member',
            requesterId: '123',
            identifier: 'license:abc',
            playerName: 'Test Player',
            playerAvatar: 'http://example.com/a.png',
        });

        expect(txCoreStub.database.whitelist.registerApproval).toHaveBeenCalledWith(
            expect.objectContaining({ identifier: 'license:abc', playerName: 'Test Player', approvedBy: 'Admin' }),
        );
        expect(txCoreStub.fxRunner.sendEvent).toHaveBeenCalledWith(
            'whitelistPreApproval',
            expect.objectContaining({ action: 'added', playerName: 'Test Player' }),
        );
        expect(txCoreStub.logger.system.write).toHaveBeenCalledWith(
            'Admin',
            expect.stringContaining('Test Player'),
            'action',
            expect.objectContaining({ actionId: 'whitelist.approval.add' }),
        );
        expect(stringifyReplyComponents(response.reply)).toContain('Added whitelist approval for Test Player');
    });

    it('denies whitelistCommand for a requester without a linked sxPanel account', async () => {
        const bot = await newBot();
        const { bridge } = await bootStartingBot(bot);
        txCoreStub.adminStore.getAdminByProviderUID.mockReturnValue(undefined);

        const response: any = await bridge.options.onRequest({
            type: 'whitelistCommand',
            subcommand: 'member',
            requesterId: '999',
            identifier: 'license:abc',
            playerName: 'Someone',
        });

        expect(response.telemetry).toMatchObject({ outcome: 'denied', denialReason: 'unlinked_account' });
        expect(txCoreStub.database.whitelist.registerApproval).not.toHaveBeenCalled();
    });

    it('denies a ticketCommand summary for an unknown ticket id', async () => {
        const bot = await newBot();
        const { bridge } = await bootStartingBot(bot);
        txCoreStub.adminStore.getAdminByProviderUID.mockReturnValue({
            name: 'Admin',
            permissions: ['players.reports'],
            isMaster: false,
            providers: {},
        });
        txCoreStub.database.tickets.findOne.mockReturnValue(undefined);

        const response: any = await bridge.options.onRequest({
            type: 'ticketCommand',
            subcommand: 'summary',
            requesterId: '1',
            ticketId: 'r00001',
        });

        expect(response.telemetry).toMatchObject({ outcome: 'denied', denialReason: 'invalid_target' });
    });

    it('denies ticketCommand entirely when reports are disabled', async () => {
        const bot = await newBot();
        const { bridge } = await bootStartingBot(bot);
        txConfigStub.gameFeatures.reportsEnabled = false;
        txCoreStub.adminStore.getAdminByProviderUID.mockReturnValue({
            name: 'Admin',
            permissions: ['players.reports'],
            isMaster: false,
            providers: {},
        });

        const response: any = await bridge.options.onRequest({
            type: 'ticketCommand',
            subcommand: 'summary',
            requesterId: '1',
        });

        expect(response.telemetry).toMatchObject({ outcome: 'denied', denialReason: 'feature_disabled' });
    });

    it('saves a persistent embed location for an authorized admin', async () => {
        const bot = await newBot();
        const { bridge } = await bootStartingBot(bot);
        txCoreStub.adminStore.getAdminByProviderUID.mockReturnValue({
            name: 'Admin',
            permissions: ['settings.write'],
            isMaster: false,
            providers: {},
        });

        const response: any = await bridge.options.onRequest({
            type: 'persistentEmbedCommand',
            action: 'saveLocation',
            target: 'status',
            channelId: 'c1',
            messageId: 'm1',
            requesterId: '1',
        });

        expect(txCoreStub.cacheStore.set).toHaveBeenCalledWith('discord:status:channelId', 'c1');
        expect(txCoreStub.cacheStore.set).toHaveBeenCalledWith('discord:status:messageId', 'm1');
        expect(txCoreStub.logger.system.write).toHaveBeenCalledWith(
            'Admin',
            'Status embed saved.',
            'action',
            expect.objectContaining({ actionId: 'embed.status.save' }),
        );
        expect(response.ok).toBe(true);
    });

    it('denies an unknown persistentEmbedCommand action', async () => {
        const bot = await newBot();
        const { bridge } = await bootStartingBot(bot);
        txCoreStub.adminStore.getAdminByProviderUID.mockReturnValue({
            name: 'Admin',
            permissions: ['settings.write'],
            isMaster: false,
            providers: {},
        });

        const response: any = await bridge.options.onRequest({
            type: 'persistentEmbedCommand',
            action: 'bogus',
            target: 'status',
            requesterId: '1',
        });

        expect(response.telemetry).toMatchObject({ outcome: 'denied', denialReason: 'invalid_request' });
    });
});
