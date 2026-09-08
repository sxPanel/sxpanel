import { suite, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'node:stream';
import { SYM_SYSTEM_AUTHOR } from '@lib/symbols';
import { UpdateConfigKeySet } from '@modules/ConfigStore/utils';

//-----------------------------------------------------------------------------
// Hoisted mocks - referenced inside vi.mock() factories below.
//-----------------------------------------------------------------------------
const {
    MockProcessManager,
    mockSpawn,
    mockGetFxSpawnVariables,
    mockGetMutableConvars,
    mockGetRuntimeConvars,
    mockSetupCustomLocaleFile,
    mockChildProcessEventBlackHole,
    mockIsValidChildProcess,
    mockStringifyConsoleArgs,
    mockResolveCFGFilePath,
    mockValidateFixServerConfig,
} = vi.hoisted(() => {
    class MockProcessManager {
        static instances: MockProcessManager[] = [];
        pid: number;
        mutex: string;
        netEndpoint: string;
        isAlive = true;
        stdin: { write: ReturnType<typeof vi.fn> };
        destroy: ReturnType<typeof vi.fn>;
        onExit: ReturnType<typeof vi.fn>;
        private _exitCb: (() => void) | undefined;

        constructor(fxs: any, props: any) {
            this.pid = fxs.pid;
            this.mutex = props.mutex;
            this.netEndpoint = props.netEndpoint;
            this.stdin = { write: vi.fn(() => true) };
            this.destroy = vi.fn(() => {
                this.isAlive = false;
            });
            this.onExit = vi.fn((cb: () => void) => {
                this._exitCb = cb;
            });
            MockProcessManager.instances.push(this);
        }

        get stateInfo() {
            return {
                pid: this.pid,
                mutex: this.mutex,
                netEndpoint: this.netEndpoint,
                isAlive: this.isAlive,
            };
        }

        //Test helper: simulates the child process actually exiting
        simulateExit() {
            this.isAlive = false;
            this._exitCb?.();
        }
    }

    //Copied verbatim from ./utils so that sendCommand/sendRawCommand tests can
    //assert against realistic formatted output without depending on the real module.
    const sanitizeConsoleArgString = (arg: string) => {
        if (typeof arg !== 'string') throw new Error('unexpected type');
        return arg
            .replaceAll(/(?<!\\)"/g, '\"')
            .replaceAll(/;/g, ';')
            .replaceAll(/\n/g, ' ');
    };
    const stringifyConsoleArgs = (args: (string | number | object)[]) => {
        const cleanArgs: string[] = [];
        for (const arg of args) {
            if (typeof arg === 'string') {
                cleanArgs.push(sanitizeConsoleArgString(JSON.stringify(arg)));
            } else if (typeof arg === 'number') {
                cleanArgs.push(sanitizeConsoleArgString(JSON.stringify(arg.toString())));
            } else if (typeof arg === 'object' && arg !== null) {
                const json = JSON.stringify(arg);
                const escaped = json.replaceAll(/"/g, '\\"');
                cleanArgs.push(`"${sanitizeConsoleArgString(escaped)}"`);
            } else {
                throw new Error('arg expected to be string or object');
            }
        }
        return cleanArgs.join(' ');
    };

    //Copied verbatim from ./utils - pure type-guard, no external deps besides Readable.
    const isValidChildProcess = (p: any) => {
        if (!p) return false;
        if (typeof p.pid !== 'number') return false;
        if (!Array.isArray(p.stdio)) return false;
        if (p.stdio.length < 4) return false;
        if (!(p.stdio[3] instanceof Readable)) return false;
        return true;
    };

    return {
        MockProcessManager,
        mockSpawn: vi.fn(),
        mockGetFxSpawnVariables: vi.fn(),
        mockGetMutableConvars: vi.fn(() => []),
        mockGetRuntimeConvars: vi.fn(() => []),
        mockSetupCustomLocaleFile: vi.fn(async () => {}),
        mockChildProcessEventBlackHole: vi.fn(),
        mockIsValidChildProcess: isValidChildProcess,
        mockStringifyConsoleArgs: stringifyConsoleArgs,
        mockResolveCFGFilePath: vi.fn((cfgPath: string, dataPath: string) => `${dataPath}/${cfgPath}`),
        mockValidateFixServerConfig: vi.fn(async () => ({
            errors: undefined,
            warnings: undefined,
            connectEndpoint: '127.0.0.1:30120',
        })),
    };
});

vi.mock('node:child_process', () => ({
    spawn: mockSpawn,
}));

vi.mock('./ProcessManager', () => ({
    default: MockProcessManager,
    ChildProcessState: { Alive: 'ALIVE', Exited: 'EXITED', Destroyed: 'DESTROYED' },
}));

vi.mock('./utils', () => ({
    childProcessEventBlackHole: mockChildProcessEventBlackHole,
    getFxSpawnVariables: mockGetFxSpawnVariables,
    getMutableConvars: mockGetMutableConvars,
    getRuntimeConvars: mockGetRuntimeConvars,
    isValidChildProcess: mockIsValidChildProcess,
    mutableConvarConfigDependencies: [
        'general.*',
        'gameFeatures.*',
        'banlist.enabled',
        'whitelist.enabled',
        'whitelist.appearInServerBrowser',
        'whitelist.serverBrowserInstructions',
        'whitelist.deferralCard',
        'whitelist.deferralCards',
    ],
    setupCustomLocaleFile: mockSetupCustomLocaleFile,
    stringifyConsoleArgs: mockStringifyConsoleArgs,
}));

vi.mock('@lib/fxserver/fxsConfigHelper', () => ({
    resolveCFGFilePath: mockResolveCFGFilePath,
    validateFixServerConfig: mockValidateFixServerConfig,
}));

vi.mock('@core/globalData', () => ({
    txEnv: {
        isWindows: true,
        fxsPath: 'C:/fake/fxserver',
        txaPath: 'C:/fake/txData',
        txaVersion: '1.0.0',
    },
    txHostConfig: {
        forceQuietMode: false,
        netInterface: undefined,
        txaPort: 40120,
    },
}));

//Must come after vi.mock() calls above
import FxRunner from './index';

//-----------------------------------------------------------------------------
// Shared test helpers
//-----------------------------------------------------------------------------

/**
 * Builds a fake ChildProcess-like object that passes isValidChildProcess() and
 * has all the streams FxRunner.spawnServer() touches.
 */
const createFakeChildProcess = (pid = 1234) => {
    const stdin = new Readable({ read() {} }) as any;
    stdin.on = stdin.on.bind(stdin);
    const stdout = new Readable({ read() {} });
    (stdout as any).setEncoding = vi.fn();
    const stderr = new Readable({ read() {} });
    const fd3 = new Readable({ read() {} });
    (fd3 as any).pipe = vi.fn(() => fd3);

    return {
        pid,
        stdin,
        stdout,
        stderr,
        stdio: [stdin, stdout, stderr, fd3],
    };
};

/**
 * Directly injects a fake "alive" ProcessManager instance into a FxRunner,
 * bypassing spawnServer(), for isolated testing of methods that only care
 * about `this.proc`'s public surface (sendCommand, handleShutdown, etc).
 */
const createFakeProc = (overrides: Record<string, any> = {}) => {
    return {
        pid: 4321,
        mutex: 'FAKEMUTEX',
        netEndpoint: '127.0.0.1:30120',
        isAlive: true,
        stdin: { write: vi.fn(() => true) },
        onExit: vi.fn(),
        destroy: vi.fn(),
        stateInfo: { pid: 4321, mutex: 'FAKEMUTEX', isAlive: true },
        ...overrides,
    };
};

let txCoreMock: any;
let txConfigMock: any;

beforeEach(() => {
    vi.clearAllMocks();
    MockProcessManager.instances = [];

    vi.stubGlobal('emsg', (error: unknown) => {
        if (error instanceof Error) return error.message;
        return String(error);
    });

    txCoreMock = {
        webServer: {
            resetToken: vi.fn(),
            webSocket: {
                pushRefresh: vi.fn(),
                buffer: vi.fn(),
            },
            luaComToken: 'test-lua-token',
        },
        adminStore: {
            hasAdmins: vi.fn(() => true),
        },
        fxPlayerlist: {
            resyncAllPlayerTagsAfterConfigChange: vi.fn(async () => {}),
            handleServerClose: vi.fn(),
        },
        fxMonitor: {
            resetState: vi.fn(),
        },
        logger: {
            system: {
                rotateSessionFile: vi.fn(),
            },
            fxserver: {
                logFxserverSpawn: vi.fn(),
                writeFxsOutput: vi.fn(),
                logSystemCommand: vi.fn(),
                logAdminCommand: vi.fn(),
            },
        },
        discordBot: {
            sendAnnouncement: vi.fn(async () => {}),
        },
        translator: {
            t: vi.fn((key: string) => key),
            customLocalePath: '/fake/locale.json',
        },
        fxScheduler: {
            handleServerClose: vi.fn(),
        },
        fxResources: {
            handleServerClose: vi.fn(),
        },
        metrics: {
            svRuntime: {
                logServerClose: vi.fn(),
            },
        },
    };
    vi.stubGlobal('txCore', txCoreMock);

    txConfigMock = {
        server: {
            autoStart: false,
            quiet: false,
            dataPath: '/fake/server-data',
            cfgPath: 'server.cfg',
            shutdownNoticeDelayMs: 0,
            restartSpawnDelayMs: 0,
            startupArgs: [],
            onesync: 'on',
        },
        general: {
            serverName: 'Test Server',
            language: 'en',
        },
        gameFeatures: {
            menuEnabled: true,
        },
        banlist: { enabled: false },
        whitelist: { enabled: false },
    };
    vi.stubGlobal('txConfig', txConfigMock);

    vi.stubGlobal('txManager', {
        isShuttingDown: false,
    });

    //Default happy-path mock implementations
    mockGetFxSpawnVariables.mockReturnValue({
        bin: 'FXServer.exe',
        args: ['+exec', 'server.cfg'],
        serverName: 'Test Server',
        dataPath: '/fake/server-data',
        cfgPath: 'server.cfg',
    });
    mockSetupCustomLocaleFile.mockResolvedValue(undefined);
    mockValidateFixServerConfig.mockResolvedValue({
        errors: undefined,
        warnings: undefined,
        connectEndpoint: '127.0.0.1:30120',
    });
    mockSpawn.mockImplementation(() => createFakeChildProcess());
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

//-----------------------------------------------------------------------------
// MARK: signalSpawnBackoffRequired
//-----------------------------------------------------------------------------
suite('FxRunner > signalSpawnBackoffRequired', () => {
    it('increments the backoff delay by 5000ms per call', () => {
        const fxRunner = new FxRunner();
        expect(fxRunner.signalSpawnBackoffRequired(true)).toBe(5_000);
        expect(fxRunner.signalSpawnBackoffRequired(true)).toBe(10_000);
        expect(fxRunner.signalSpawnBackoffRequired(true)).toBe(15_000);
    });

    it('caps the backoff delay at 45000ms', () => {
        const fxRunner = new FxRunner();
        for (let i = 0; i < 20; i++) {
            fxRunner.signalSpawnBackoffRequired(true);
        }
        expect(fxRunner.signalSpawnBackoffRequired(true)).toBe(45_000);
    });

    it('resets the backoff delay to 0 when required=false', () => {
        const fxRunner = new FxRunner();
        fxRunner.signalSpawnBackoffRequired(true);
        fxRunner.signalSpawnBackoffRequired(true);
        expect(fxRunner.signalSpawnBackoffRequired(false)).toBe(0);
    });

    it('is a no-op reset when already at 0', () => {
        const fxRunner = new FxRunner();
        expect(fxRunner.signalSpawnBackoffRequired(false)).toBe(0);
    });
});

//-----------------------------------------------------------------------------
// MARK: restartSpawnDelay getter (depends on signalSpawnBackoffRequired's state)
//-----------------------------------------------------------------------------
suite('FxRunner > restartSpawnDelay getter', () => {
    it('uses the configured delay when no backoff is active', () => {
        txConfigMock.server.restartSpawnDelayMs = 5_000;
        const fxRunner = new FxRunner();
        const delay = fxRunner.restartSpawnDelay;
        expect(delay.ms).toBe(5_000);
        expect(delay.isBackoff).toBe(false);
    });

    it('uses the backoff delay when it exceeds the configured delay', () => {
        txConfigMock.server.restartSpawnDelayMs = 5_000;
        const fxRunner = new FxRunner();
        fxRunner.signalSpawnBackoffRequired(true); //5000
        fxRunner.signalSpawnBackoffRequired(true); //10000
        const delay = fxRunner.restartSpawnDelay;
        expect(delay.ms).toBe(10_000);
        expect(delay.isBackoff).toBe(true);
    });

    it('treats equal backoff/config delay as backoff', () => {
        txConfigMock.server.restartSpawnDelayMs = 0;
        const fxRunner = new FxRunner();
        const delay = fxRunner.restartSpawnDelay;
        expect(delay.ms).toBe(0);
        expect(delay.isBackoff).toBe(true);
    });
});

//-----------------------------------------------------------------------------
// MARK: isConfigured / isIdle getters
//-----------------------------------------------------------------------------
suite('FxRunner > getters', () => {
    it('isConfigured is true when dataPath and cfgPath are set', () => {
        const fxRunner = new FxRunner();
        expect(fxRunner.isConfigured).toBe(true);
    });

    it('isConfigured is false when dataPath is missing', () => {
        txConfigMock.server.dataPath = '';
        const fxRunner = new FxRunner();
        expect(fxRunner.isConfigured).toBe(false);
    });

    it('isConfigured is false when cfgPath is missing', () => {
        txConfigMock.server.cfgPath = '';
        const fxRunner = new FxRunner();
        expect(fxRunner.isConfigured).toBe(false);
    });

    it('isIdle is true when there is no process and no pending restart', () => {
        const fxRunner = new FxRunner();
        expect(fxRunner.isIdle).toBe(true);
    });

    it('isIdle is false when a process is set', () => {
        const fxRunner = new FxRunner();
        (fxRunner as any).proc = createFakeProc();
        expect(fxRunner.isIdle).toBe(false);
    });
});

//-----------------------------------------------------------------------------
// MARK: handleShutdown
//-----------------------------------------------------------------------------
suite('FxRunner > handleShutdown', () => {
    it('returns null when there is no process', () => {
        const fxRunner = new FxRunner();
        expect(fxRunner.handleShutdown()).toBeNull();
    });

    it('returns null when the process is not alive', () => {
        const fxRunner = new FxRunner();
        (fxRunner as any).proc = createFakeProc({ isAlive: false });
        expect(fxRunner.handleShutdown()).toBeNull();
    });

    it('writes the quit command and resolves when the process exits', async () => {
        const fxRunner = new FxRunner();
        const proc = createFakeProc({ isAlive: true });
        (fxRunner as any).proc = proc;

        const result = fxRunner.handleShutdown();
        expect(result).toBeInstanceOf(Promise);
        expect(proc.stdin.write).toHaveBeenCalledWith('quit "host shutting down"\n');
        expect(proc.onExit).toHaveBeenCalledTimes(1);

        //Simulate the process actually exiting
        const exitCb = proc.onExit.mock.calls[0][0];
        exitCb();

        await expect(result).resolves.toBeUndefined();
    });
});

//-----------------------------------------------------------------------------
// MARK: signalStartReady
//-----------------------------------------------------------------------------
suite('FxRunner > signalStartReady', () => {
    it('does nothing when autoStart is disabled', () => {
        txConfigMock.server.autoStart = false;
        const fxRunner = new FxRunner();
        const spawnSpy = vi.spyOn(fxRunner, 'spawnServer').mockResolvedValue({ success: true, pid: 1, mutex: 'x' });
        fxRunner.signalStartReady();
        expect(spawnSpy).not.toHaveBeenCalled();
    });

    it('warns and does nothing when the server is not configured', () => {
        txConfigMock.server.autoStart = true;
        txConfigMock.server.dataPath = '';
        const fxRunner = new FxRunner();
        const spawnSpy = vi.spyOn(fxRunner, 'spawnServer').mockResolvedValue({ success: true, pid: 1, mutex: 'x' });
        fxRunner.signalStartReady();
        expect(spawnSpy).not.toHaveBeenCalled();
    });

    it('warns and does nothing when there are no admins configured', () => {
        txConfigMock.server.autoStart = true;
        txCoreMock.adminStore.hasAdmins.mockReturnValue(false);
        const fxRunner = new FxRunner();
        const spawnSpy = vi.spyOn(fxRunner, 'spawnServer').mockResolvedValue({ success: true, pid: 1, mutex: 'x' });
        fxRunner.signalStartReady();
        expect(spawnSpy).not.toHaveBeenCalled();
    });

    it('calls spawnServer(true) when configured, autoStart, and admins exist', () => {
        txConfigMock.server.autoStart = true;
        txCoreMock.adminStore.hasAdmins.mockReturnValue(true);
        const fxRunner = new FxRunner();
        const spawnSpy = vi.spyOn(fxRunner, 'spawnServer').mockResolvedValue({ success: true, pid: 1, mutex: 'x' });
        fxRunner.signalStartReady();
        expect(spawnSpy).toHaveBeenCalledWith(true);
    });

    it('still spawns when quiet mode is enabled', () => {
        txConfigMock.server.autoStart = true;
        txConfigMock.server.quiet = true;
        txCoreMock.adminStore.hasAdmins.mockReturnValue(true);
        const fxRunner = new FxRunner();
        const spawnSpy = vi.spyOn(fxRunner, 'spawnServer').mockResolvedValue({ success: true, pid: 1, mutex: 'x' });
        fxRunner.signalStartReady();
        expect(spawnSpy).toHaveBeenCalledWith(true);
    });
});

//-----------------------------------------------------------------------------
// MARK: handleConfigUpdate
//-----------------------------------------------------------------------------
suite('FxRunner > handleConfigUpdate', () => {
    it('triggers a convar resync via getRuntimeConvars/sendCommand', async () => {
        mockGetRuntimeConvars.mockReturnValue([['set', 'txAdmin-serverName', 'NewName']]);
        const fxRunner = new FxRunner();
        const proc = createFakeProc({ isAlive: true });
        (fxRunner as any).proc = proc;

        const keySet = new UpdateConfigKeySet();
        keySet.add('general', 'serverName');
        fxRunner.handleConfigUpdate(keySet);

        await vi.waitFor(() => {
            expect(proc.stdin.write).toHaveBeenCalled();
        });
        const writtenCommand = proc.stdin.write.mock.calls[0][0] as string;
        expect(writtenCommand).toContain('set');
        expect(writtenCommand).toContain('txAdmin-serverName');
    });

    it('resyncs player tags when gameFeatures.customTags changes', () => {
        const fxRunner = new FxRunner();
        const keySet = new UpdateConfigKeySet();
        keySet.add('gameFeatures', 'customTags');
        fxRunner.handleConfigUpdate(keySet);
        expect(txCoreMock.fxPlayerlist.resyncAllPlayerTagsAfterConfigChange).toHaveBeenCalledTimes(1);
    });

    it('resyncs player tags when gameFeatures.newplayerThreshold changes', () => {
        const fxRunner = new FxRunner();
        const keySet = new UpdateConfigKeySet();
        keySet.add('gameFeatures', 'newplayerThreshold');
        fxRunner.handleConfigUpdate(keySet);
        expect(txCoreMock.fxPlayerlist.resyncAllPlayerTagsAfterConfigChange).toHaveBeenCalledTimes(1);
    });

    it('does not resync player tags for unrelated config changes', () => {
        const fxRunner = new FxRunner();
        const keySet = new UpdateConfigKeySet();
        keySet.add('general', 'serverName');
        fxRunner.handleConfigUpdate(keySet);
        expect(txCoreMock.fxPlayerlist.resyncAllPlayerTagsAfterConfigChange).not.toHaveBeenCalled();
    });
});

//-----------------------------------------------------------------------------
// MARK: sendEvent / sendCommand / writeStdinLine / sendRawCommand
//-----------------------------------------------------------------------------
suite('FxRunner > stdin command helpers', () => {
    suite('when no process is alive', () => {
        it('sendCommand returns false without throwing', () => {
            const fxRunner = new FxRunner();
            expect(fxRunner.sendCommand('txaEvent', ['test', {}], SYM_SYSTEM_AUTHOR)).toBe(false);
        });

        it('sendEvent returns false without throwing', () => {
            const fxRunner = new FxRunner();
            expect(fxRunner.sendEvent('someEvent')).toBe(false);
        });

        it('writeStdinLine returns false without throwing', () => {
            const fxRunner = new FxRunner();
            expect(fxRunner.writeStdinLine('status')).toBe(false);
        });

        it('sendRawCommand returns false without throwing', () => {
            const fxRunner = new FxRunner();
            expect(fxRunner.sendRawCommand('status', SYM_SYSTEM_AUTHOR)).toBe(false);
        });
    });

    suite('when a process is alive', () => {
        it('sendCommand writes the formatted command to stdin', () => {
            const fxRunner = new FxRunner();
            const proc = createFakeProc();
            (fxRunner as any).proc = proc;
            const result = fxRunner.sendCommand('txaEvent', ['myEvent', { a: 1 }], SYM_SYSTEM_AUTHOR);
            expect(result).toBe(true);
            expect(proc.stdin.write).toHaveBeenCalledTimes(1);
            const written = proc.stdin.write.mock.calls[0][0] as string;
            expect(written.startsWith('txaEvent ')).toBe(true);
            expect(written.endsWith('\n')).toBe(true);
        });

        it('sendCommand throws for an invalid cmdName', () => {
            const fxRunner = new FxRunner();
            (fxRunner as any).proc = createFakeProc();
            expect(() => fxRunner.sendCommand('invalid cmd', [], SYM_SYSTEM_AUTHOR)).toThrow('invalid cmdName');
        });

        it('sendCommand throws when cmdArgs is not an array', () => {
            const fxRunner = new FxRunner();
            (fxRunner as any).proc = createFakeProc();
            expect(() => fxRunner.sendCommand('foo', 'bar' as any, SYM_SYSTEM_AUTHOR)).toThrow(
                'cmdArgs is not an array',
            );
        });

        it('sendEvent delegates to sendCommand with txaEvent', () => {
            const fxRunner = new FxRunner();
            const proc = createFakeProc();
            (fxRunner as any).proc = proc;
            const result = fxRunner.sendEvent('configChanged', { foo: 'bar' });
            expect(result).toBe(true);
            const written = proc.stdin.write.mock.calls[0][0] as string;
            expect(written.startsWith('txaEvent ')).toBe(true);
        });

        it('sendEvent throws for a missing eventType', () => {
            const fxRunner = new FxRunner();
            (fxRunner as any).proc = createFakeProc();
            expect(() => fxRunner.sendEvent('')).toThrow('invalid eventType');
        });

        it('writeStdinLine writes the command with a trailing newline', () => {
            const fxRunner = new FxRunner();
            const proc = createFakeProc();
            (fxRunner as any).proc = proc;
            fxRunner.writeStdinLine('status');
            expect(proc.stdin.write).toHaveBeenCalledWith('status\n');
        });

        it('sendRawCommand logs system commands via logSystemCommand', () => {
            const fxRunner = new FxRunner();
            (fxRunner as any).proc = createFakeProc();
            fxRunner.sendRawCommand('status', SYM_SYSTEM_AUTHOR);
            expect(txCoreMock.logger.fxserver.logSystemCommand).toHaveBeenCalledWith('status');
            expect(txCoreMock.logger.fxserver.logAdminCommand).not.toHaveBeenCalled();
        });

        it('sendRawCommand logs admin commands via logAdminCommand', () => {
            const fxRunner = new FxRunner();
            (fxRunner as any).proc = createFakeProc();
            fxRunner.sendRawCommand('status', 'adminUser');
            expect(txCoreMock.logger.fxserver.logAdminCommand).toHaveBeenCalledWith('adminUser', 'status');
        });

        it('sendRawCommand throws for an empty string author', () => {
            const fxRunner = new FxRunner();
            (fxRunner as any).proc = createFakeProc();
            expect(() => fxRunner.sendRawCommand('status', '')).toThrow('Expected non-empty author');
        });
    });
});

//-----------------------------------------------------------------------------
// MARK: spawnServer
//-----------------------------------------------------------------------------
suite('FxRunner > spawnServer', () => {
    it('fails immediately when sxPanel is shutting down', async () => {
        vi.stubGlobal('txManager', { isShuttingDown: true });
        const fxRunner = new FxRunner();
        const result = await fxRunner.spawnServer();
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error).toContain('shutting down');
        expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('fails when the server has already started', async () => {
        const fxRunner = new FxRunner();
        (fxRunner as any).proc = createFakeProc();
        const result = await fxRunner.spawnServer();
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error).toContain('already started');
        expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('fails when getFxSpawnVariables throws', async () => {
        mockGetFxSpawnVariables.mockImplementation(() => {
            throw new Error('bad spawn vars');
        });
        const fxRunner = new FxRunner();
        const result = await fxRunner.spawnServer();
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error).toContain('Error setting up spawn variables');
    });

    it('fails when setupCustomLocaleFile throws', async () => {
        mockSetupCustomLocaleFile.mockRejectedValue(new Error('locale copy failed'));
        const fxRunner = new FxRunner();
        const result = await fxRunner.spawnServer();
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error).toContain('Error copying custom locale');
    });

    it('fails when the server is not configured', async () => {
        txConfigMock.server.dataPath = '';
        const fxRunner = new FxRunner();
        const result = await fxRunner.spawnServer();
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error).toContain('missing configuration');
    });

    it('fails with markdown error when cfg validation reports errors', async () => {
        mockValidateFixServerConfig.mockResolvedValue({
            errors: 'endpoint missing',
            warnings: undefined,
            connectEndpoint: null,
        });
        const fxRunner = new FxRunner();
        const result = await fxRunner.spawnServer();
        expect(result.success).toBe(false);
        if (!result.success) expect(result.md).toBe(true);
        expect(fxRunner.lastCfgErrors).toBe('endpoint missing');
    });

    it('fails with a special message when the cfg file is unreadable', async () => {
        mockValidateFixServerConfig.mockRejectedValue(new Error('file is unreadable'));
        const fxRunner = new FxRunner();
        const result = await fxRunner.spawnServer();
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.md).toBe(true);
            expect(result.error).toContain('unreadable');
        }
    });

    it('fails when spawn() returns an invalid child process', async () => {
        mockSpawn.mockReturnValue({} as any);
        const fxRunner = new FxRunner();
        const result = await fxRunner.spawnServer();
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error).toContain('Failed to run');
    });

    it('succeeds on the happy path and returns pid/mutex', async () => {
        const fxRunner = new FxRunner();
        const result = await fxRunner.spawnServer();
        expect(result.success).toBe(true);
        if (result.success) {
            expect(typeof result.pid).toBe('number');
            expect(typeof result.mutex).toBe('string');
        }
        expect(MockProcessManager.instances).toHaveLength(1);
        expect(txCoreMock.logger.fxserver.logFxserverSpawn).toHaveBeenCalled();
        expect(txCoreMock.fxMonitor.resetState).toHaveBeenCalled();
        expect(txCoreMock.logger.system.rotateSessionFile).toHaveBeenCalled();
        expect(txCoreMock.webServer.webSocket.buffer).toHaveBeenCalledWith(
            'playerlist',
            expect.objectContaining({ type: 'fullPlayerlist' }),
        );
    });

    it('passes warnings through in a successful result', async () => {
        mockValidateFixServerConfig.mockResolvedValue({
            errors: undefined,
            warnings: 'some warning',
            connectEndpoint: '127.0.0.1:30120',
        });
        const fxRunner = new FxRunner();
        const result = await fxRunner.spawnServer();
        expect(result.success).toBe(true);
        if (result.success) expect(result.warnings).toContain('some warning');
    });

    it('announces via discordBot only when shouldAnnounce is true', async () => {
        const fxRunner1 = new FxRunner();
        await fxRunner1.spawnServer(false);
        expect(txCoreMock.discordBot.sendAnnouncement).not.toHaveBeenCalled();

        const fxRunner2 = new FxRunner();
        await fxRunner2.spawnServer(true);
        expect(txCoreMock.discordBot.sendAnnouncement).toHaveBeenCalledTimes(1);
    });

    it('resets the webServer token before spawning', async () => {
        const fxRunner = new FxRunner();
        await fxRunner.spawnServer();
        expect(txCoreMock.webServer.resetToken).toHaveBeenCalled();
    });
});

//-----------------------------------------------------------------------------
// MARK: killServer
//-----------------------------------------------------------------------------
suite('FxRunner > killServer', () => {
    it('returns null immediately when there is nothing to kill', async () => {
        const fxRunner = new FxRunner();
        const result = await fxRunner.killServer('no reason', SYM_SYSTEM_AUTHOR);
        expect(result).toBeNull();
    });

    it('destroys the process, clears state, and runs cleanup (skipNoticeDelay)', async () => {
        const fxRunner = new FxRunner();
        const proc = createFakeProc({ isAlive: true });
        (fxRunner as any).proc = proc;

        const result = await fxRunner.killServer('test reason', 'adminUser', false, true);

        expect(result).toBeNull();
        expect(proc.destroy).toHaveBeenCalledTimes(1);
        expect((fxRunner as any).proc).toBeNull();
        expect(fxRunner.history).toHaveLength(1);
        expect(fxRunner.history[0].mutex).toBe('FAKEMUTEX');

        expect(txCoreMock.fxScheduler.handleServerClose).toHaveBeenCalled();
        expect(txCoreMock.fxResources.handleServerClose).toHaveBeenCalled();
        expect(txCoreMock.fxPlayerlist.handleServerClose).toHaveBeenCalledWith('FAKEMUTEX');
        expect(txCoreMock.metrics.svRuntime.logServerClose).toHaveBeenCalledWith('test reason');
        expect(txCoreMock.discordBot.sendAnnouncement).toHaveBeenCalledTimes(1);
    });

    it('does not error when killing an already-dead process', async () => {
        const fxRunner = new FxRunner();
        const proc = createFakeProc({ isAlive: false });
        (fxRunner as any).proc = proc;

        const result = await fxRunner.killServer('test', SYM_SYSTEM_AUTHOR, false, true);
        expect(result).toBeNull();
        //serverShuttingDown event should not have been sent to a dead process
        expect(proc.stdin.write).not.toHaveBeenCalled();
        expect(proc.destroy).toHaveBeenCalledTimes(1);
    });

    //NOTE: node:timers/promises is not intercepted by vi.useFakeTimers() in this
    //setup, so these tests use real (short, MIN_KILL_DELAY-bounded) timers instead.
    it('waits out the shutdown notice delay before destroying the process', async () => {
        const fxRunner = new FxRunner();
        const proc = createFakeProc({ isAlive: true });
        (fxRunner as any).proc = proc;

        const promise = fxRunner.killServer('test', SYM_SYSTEM_AUTHOR, false, false);
        //Should not have destroyed yet - the notice delay await hasn't resolved
        expect(proc.destroy).not.toHaveBeenCalled();

        const result = await promise; //resolves after MIN_KILL_DELAY (250ms)
        expect(result).toBeNull();
        expect(proc.destroy).toHaveBeenCalledTimes(1);
    });

    it('rejects a concurrent kill request while one is already in progress', async () => {
        const fxRunner = new FxRunner();
        const proc = createFakeProc({ isAlive: true });
        (fxRunner as any).proc = proc;

        //isAwaitingShutdownNoticeDelay is flipped synchronously before the notice-delay
        //await, so the guard is already active by the time this call returns a promise.
        const firstCall = fxRunner.killServer('first', SYM_SYSTEM_AUTHOR, false, false);

        const secondResult = await fxRunner.killServer('second', SYM_SYSTEM_AUTHOR, false, false);
        expect(secondResult).toContain('already in progress');

        await firstCall;
    });

    it('catches destroy() errors, resets proc, and returns a friendly message', async () => {
        const fxRunner = new FxRunner();
        const proc = createFakeProc({
            isAlive: true,
            destroy: vi.fn(() => {
                throw new Error('destroy exploded');
            }),
        });
        (fxRunner as any).proc = proc;

        const result = await fxRunner.killServer('test', SYM_SYSTEM_AUTHOR, false, true);
        expect(result).toContain("Couldn't kill the server");
        expect((fxRunner as any).proc).toBeNull();
    });
});

//-----------------------------------------------------------------------------
// MARK: restartServer
//-----------------------------------------------------------------------------
//NOTE: node:timers/promises is not intercepted by vi.useFakeTimers() in this
//setup, so these tests use real timers. Delays are kept small (driven by
//MIN_KILL_DELAY=250ms and small configured values) to keep the suite fast.
suite('FxRunner > restartServer', () => {
    it('kills before spawning again, in that order', async () => {
        const fxRunner = new FxRunner();
        const proc = createFakeProc({ isAlive: true });
        (fxRunner as any).proc = proc;

        const killSpy = vi.spyOn(fxRunner, 'killServer');
        const spawnSpy = vi.spyOn(fxRunner, 'spawnServer');

        const result = await fxRunner.restartServer('scheduled restart', SYM_SYSTEM_AUTHOR);

        expect(killSpy).toHaveBeenCalledTimes(1);
        expect(spawnSpy).toHaveBeenCalledTimes(1);
        expect(killSpy.mock.invocationCallOrder[0]).toBeLessThan(spawnSpy.mock.invocationCallOrder[0]);
        expect(result.success).toBe(true);
    });

    it('propagates a kill failure without attempting to spawn', async () => {
        const fxRunner = new FxRunner();
        const proc = createFakeProc({
            isAlive: true,
            destroy: vi.fn(() => {
                throw new Error('boom');
            }),
        });
        (fxRunner as any).proc = proc;
        const spawnSpy = vi.spyOn(fxRunner, 'spawnServer');

        const result = await fxRunner.restartServer('test', SYM_SYSTEM_AUTHOR);
        expect(result.success).toBe(false);
        expect(spawnSpy).not.toHaveBeenCalled();
    });

    it('rejects a concurrent restart request while one is already in progress', async () => {
        //Give the respawn-delay sleep a small but non-zero window (beyond the
        //~250ms MIN_KILL_DELAY) so there's time to observe isAwaitingRestartSpawnDelay.
        txConfigMock.server.restartSpawnDelayMs = 300;
        const fxRunner = new FxRunner();
        (fxRunner as any).proc = createFakeProc({ isAlive: true });

        const firstCall = fxRunner.restartServer('first', SYM_SYSTEM_AUTHOR);
        //Let killServer's notice delay (~250ms) resolve, entering the respawn-delay sleep
        await new Promise((resolve) => setTimeout(resolve, 260));

        const secondResult = await fxRunner.restartServer('second', SYM_SYSTEM_AUTHOR);
        expect(secondResult.success).toBe(false);
        if (!secondResult.success) expect(secondResult.error).toContain('already in progress');

        await firstCall;
    });
});
