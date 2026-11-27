import { suite, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

//Mutable env shared with the mocked globalData module
const env = vi.hoisted(() => ({
    isWindows: false,
    txaVersion: '1.0.0',
    txaPath: '',
}));
vi.mock('@core/globalData', () => ({ txEnv: env, txHostConfig: { netInterface: undefined } }));
vi.mock('@lib/got', () => ({ default: vi.fn() }));

//Capture the spawned swap script instead of running it (it would wait on the test runner's PID)
const spawnCalls = vi.hoisted(() => [] as { cmd: string; args: string[] }[]);
vi.mock('node:child_process', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:child_process')>();
    return {
        ...actual,
        spawn: vi.fn((cmd: string, args: string[]) => {
            spawnCalls.push({ cmd, args });
            return { unref: () => {} };
        }),
    };
});

//Runtime globals the module touches when sending restart warnings (server idle → no-op)
vi.stubGlobal('emsg', (e: unknown) => String(e));
vi.stubGlobal('txCore', { fxRunner: { isIdle: true } });
vi.stubGlobal('txConfig', { general: { serverName: 'test' } });

const { spawn: realSpawn, spawnSync } =
    await vi.importActual<typeof import('node:child_process')>('node:child_process');
const { default: SelfUpdater } = await import('./index');

const canRunBash = process.platform !== 'win32' && spawnSync('bash', ['-c', 'true']).status === 0;

/**
 * Runs a generated swap script against a stand-in "FXServer" process, then lets it exit.
 */
const runScriptAgainstFakeServer = async (scriptPath: string, beforeExit?: () => void) => {
    const fakeServer = realSpawn('sleep', ['30'], { stdio: 'ignore' });
    const original = fs.readFileSync(scriptPath, 'utf8');
    fs.writeFileSync(scriptPath, original.replaceAll(`kill -0 ${process.pid}`, `kill -0 ${fakeServer.pid}`));
    const script = realSpawn('bash', [scriptPath], { stdio: 'ignore' });
    const scriptDone = new Promise<number | null>((resolve) => script.on('exit', resolve));

    await new Promise((r) => setTimeout(r, 1200));
    beforeExit?.();
    fakeServer.kill('SIGKILL');
    return scriptDone;
};

suite.skipIf(!canRunBash)('SelfUpdater install script (linux)', () => {
    let rootDir: string;
    let monitorDir: string;
    let stagingDir: string;
    let updater: InstanceType<typeof SelfUpdater>;

    beforeEach(() => {
        rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sxpanel-selfupdate-'));
        monitorDir = path.join(rootDir, 'monitor');
        stagingDir = path.join(rootDir, 'sxpanel_update_staging');
        fs.mkdirSync(monitorDir);
        fs.writeFileSync(path.join(monitorDir, 'version.txt'), 'old');
        fs.mkdirSync(stagingDir);
        fs.writeFileSync(path.join(stagingDir, 'version.txt'), 'new');
        env.txaPath = monitorDir;
        spawnCalls.length = 0;
        updater = new SelfUpdater();
        (updater as any)._status = { phase: 'extracted' };
    });

    afterEach(() => {
        updater.cancelPlan();
        fs.rmSync(rootDir, { recursive: true, force: true });
    });

    it('installs into the monitor folder once FXServer closes (manual restart)', async () => {
        await updater.apply('manual');
        expect(updater.plan).toEqual({ mode: 'manual' });

        const scriptPath = spawnCalls.at(-1)!.args.at(-1)!;
        expect(scriptPath).toBe(path.join(rootDir, 'sxpanel_update_manual.sh'));
        const script = fs.readFileSync(scriptPath, 'utf8');
        expect(script).not.toContain('exec '); //manual mode never relaunches FXServer

        //Still waiting while the server runs
        expect(fs.readFileSync(path.join(monitorDir, 'version.txt'), 'utf8')).toBe('old');

        const code = await runScriptAgainstFakeServer(scriptPath);
        expect(code).toBe(0);
        expect(fs.readFileSync(path.join(monitorDir, 'version.txt'), 'utf8')).toBe('new');
        expect(fs.existsSync(stagingDir)).toBe(false);
        expect(fs.existsSync(monitorDir + '.bak')).toBe(false);
        expect(fs.existsSync(path.join(rootDir, 'sxpanel_update_token.txt'))).toBe(false);
    }, 15_000);

    it('does nothing if the pending install was cancelled', async () => {
        await updater.apply('manual');
        const scriptPath = spawnCalls.at(-1)!.args.at(-1)!;

        const code = await runScriptAgainstFakeServer(scriptPath, () => updater.cancelPlan());
        expect(code).toBe(0);
        expect(updater.plan).toBeUndefined();
        expect(fs.readFileSync(path.join(monitorDir, 'version.txt'), 'utf8')).toBe('old');
        expect(fs.existsSync(stagingDir)).toBe(true);
    }, 15_000);

    it('scheduling validates the delay and can be cancelled', async () => {
        await expect(updater.apply('scheduled')).rejects.toThrow();
        await expect(updater.apply('scheduled', 0)).rejects.toThrow();
        await expect(updater.apply('scheduled', 24 * 60 + 1)).rejects.toThrow();

        const before = Date.now();
        await updater.apply('scheduled', 10);
        const plan = updater.plan;
        expect(plan?.mode).toBe('scheduled');
        if (plan?.mode !== 'scheduled') return;
        expect(plan.scheduledTs).toBeGreaterThanOrEqual(before + 10 * 60_000);
        expect(updater.cancelPlan()).toBe(true);
        expect(updater.plan).toBeUndefined();
        expect(updater.status.phase).toBe('extracted');
    });

    it('switching from manual to scheduled revokes the waiting script', async () => {
        await updater.apply('manual');
        const tokenPath = path.join(rootDir, 'sxpanel_update_token.txt');
        expect(fs.existsSync(tokenPath)).toBe(true);
        await updater.apply('scheduled', 30);
        expect(fs.existsSync(tokenPath)).toBe(false);
    });
});
