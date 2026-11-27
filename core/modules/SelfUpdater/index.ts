const modulename = 'SelfUpdater';
import path from 'node:path';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import stream from 'node:stream';
import semver from 'semver';
import { z } from 'zod';
import StreamZip from 'node-stream-zip';

import { txEnv } from '@core/globalData';
import got from '@lib/got';
import consoleFactory from '@lib/console';
import quitProcess from '@lib/quitProcess';
import type {
    FxUpdateStatus,
    PanelReleaseInfo,
    PanelUpdateApplyMode,
    PanelUpdateRestartPlan,
} from '@shared/otherTypes';
const console = consoleFactory(modulename);
const pipeline = promisify(stream.pipeline);

const GITHUB_REPO = 'sxPanel/sxpanel';
//Entries that must exist in the zip for the resource to boot at all (mirrors scripts/package-monitor.js)
const REQUIRED_ENTRIES = ['fxmanifest.lua', 'entrypoint.js', 'core/index.js', 'resource/sv_main.lua'];

//Minutes-left marks at which players get a restart warning (same as the restart scheduler)
const SCHEDULE_WARNINGS = [30, 15, 10, 5, 4, 3, 2, 1];
const MAX_SCHEDULE_MINUTES = 24 * 60;
//The unauthenticated GitHub API allows 60 req/h, so don't hit it on every page poll
const RELEASE_CACHE_MS = 5 * 60_000;

const releaseSchema = z.object({
    tag_name: z.string().min(1),
    prerelease: z.boolean(),
    html_url: z.string().url(),
    draft: z.boolean(),
    assets: z.array(
        z.object({
            name: z.string(),
            browser_download_url: z.string().url(),
        }),
    ),
});
const releaseListSchema = z.array(releaseSchema);

/**
 * Module responsible for checking, downloading and installing sxPanel (monitor resource) updates.
 * The flow is: download+verify → extract to staging → (now | scheduled | manual) → swap the
 * staged files into the monitor folder once FXServer has exited → relaunch (now/scheduled only).
 * Unlike FxUpdater (which swaps the FXServer artifact), this replaces the monitor resource folder
 * that the running process itself was loaded from, so FXServer must fully exit for the new code
 * to load. A detached helper script does the swap after our PID is gone.
 */
export default class SelfUpdater {
    private _status: FxUpdateStatus = { phase: 'idle' };
    private latestRelease?: PanelReleaseInfo;
    private restartPlan: PanelUpdateRestartPlan;
    private scheduleTimer?: NodeJS.Timeout;
    private stagedVersion?: string;
    private lastCheckTs = 0;
    private readonly updateDir: string;
    private readonly archivePath: string;
    private readonly stagingDir: string;
    private readonly failureStatusPath: string;
    private readonly tokenPath: string;

    constructor() {
        const parentDir = path.dirname(txEnv.txaPath);
        this.updateDir = path.join(parentDir, 'sxpanel_update_temp');
        this.archivePath = path.join(this.updateDir, 'monitor.zip');
        this.stagingDir = path.join(parentDir, 'sxpanel_update_staging');
        this.failureStatusPath = path.join(parentDir, 'sxpanel_update_failure.txt');
        this.tokenPath = path.join(parentDir, 'sxpanel_update_token.txt');
        this.loadPersistedFailureStatus();
    }

    get status(): FxUpdateStatus {
        return this._status;
    }

    get availableUpdate(): PanelReleaseInfo | undefined {
        return this.latestRelease;
    }

    get plan(): PanelUpdateRestartPlan {
        return this.restartPlan;
    }

    get staged(): string | undefined {
        return this._status.phase === 'extracted' || this._status.phase === 'applying' ? this.stagedVersion : undefined;
    }

    /**
     * Loads any persisted updater failure status written by the detached swap script
     * (used mainly on Windows, where the process exits mid-apply).
     */
    private loadPersistedFailureStatus() {
        try {
            const persisted = fs.readFileSync(this.failureStatusPath, 'utf8').trim();
            if (!persisted.length) return;
            this._status = { phase: 'error', message: persisted };
            console.warn(`Loaded persisted self-update failure: ${persisted}`);
        } catch {
            // no persisted failure status
        }
    }

    private async clearPersistedFailureStatus() {
        await fsp.rm(this.failureStatusPath, { force: true }).catch(() => {});
    }

    /**
     * Queries GitHub for the latest sxPanel release and compares it against the running version.
     * NOTE: uses the releases list (not /releases/latest) because sxPanel is currently shipping
     * prerelease ("-Beta") tags, which GitHub's "latest" endpoint deliberately excludes.
     */
    async checkForUpdate(force = false): Promise<PanelReleaseInfo | undefined> {
        if (!force && this.latestRelease && Date.now() - this.lastCheckTs < RELEASE_CACHE_MS) {
            return this.latestRelease;
        }
        try {
            const resp = await got(`https://api.github.com/repos/${GITHUB_REPO}/releases`, {
                headers: { Accept: 'application/vnd.github+json' },
                timeout: { request: 10_000 },
            }).json();
            const releases = releaseListSchema.parse(resp).filter((r) => !r.draft);
            const latest = releases[0];
            if (!latest) return;

            const version = latest.tag_name.replace(/^v/, '');
            if (!semver.valid(version)) {
                console.verbose.warn(`Latest release tag "${latest.tag_name}" is not valid semver, skipping.`);
                return;
            }

            const zipAsset = latest.assets.find((a) => a.name === 'monitor.zip');
            const shaAsset = latest.assets.find((a) => a.name === 'monitor.zip.sha256');
            if (!zipAsset || !shaAsset) {
                console.verbose.warn(`Release ${latest.tag_name} is missing monitor.zip or its checksum, skipping.`);
                return;
            }

            this.latestRelease = {
                version,
                isPrerelease: latest.prerelease,
                isOutdated: semver.lt(txEnv.txaVersion, version),
                releaseUrl: latest.html_url,
                zipUrl: zipAsset.browser_download_url,
                shaUrl: shaAsset.browser_download_url,
            };
            this.lastCheckTs = Date.now();
            return this.latestRelease;
        } catch (error) {
            console.verbose.warn(`Failed to check for sxPanel updates: ${emsg(error)}`);
            return;
        }
    }

    /**
     * Downloads and verifies the latest monitor.zip, then extracts it to a staging directory.
     */
    async download() {
        if (this._status.phase === 'downloading') {
            throw new Error('A download is already in progress.');
        }
        if (this._status.phase === 'applying') {
            throw new Error('An update is currently being installed.');
        }
        if (this.restartPlan) {
            throw new Error('An update is already scheduled. Cancel it before downloading again.');
        }

        this._status = { phase: 'downloading', percentage: 0 };
        try {
            await this.clearPersistedFailureStatus();

            //Always re-check so we never install a release that was superseded since the page loaded
            await this.checkForUpdate(true);
            if (!this.latestRelease) {
                throw new Error('No sxPanel release available to download.');
            }
            const release = this.latestRelease;

            //Clean up any previous temp files
            await fsp.rm(this.updateDir, { recursive: true, force: true });
            await fsp.rm(this.stagingDir, { recursive: true, force: true });
            await fsp.mkdir(this.updateDir, { recursive: true });

            //Fetch the expected checksum first (tiny file)
            const shaText = await got(release.shaUrl, { timeout: { request: 10_000 } }).text();
            const expectedDigestMatch = shaText.trim().match(/^([0-9a-f]{64})/i);
            if (!expectedDigestMatch) {
                throw new Error('Could not parse expected checksum from monitor.zip.sha256.');
            }
            const expectedDigest = expectedDigestMatch[1].toLowerCase();

            //Stream download with progress
            const gotStream = got.stream(release.zipUrl, {
                timeout: {
                    request: 30 * 60 * 1000, // 30 minutes
                    lookup: 10_000,
                    connect: 10_000,
                    response: 30_000,
                },
            });
            gotStream.on('downloadProgress', (progress) => {
                this._status = {
                    phase: 'downloading',
                    percentage: Math.round(progress.percent * 100),
                };
            });
            const writeStream = fs.createWriteStream(this.archivePath);
            gotStream.on('error', (err) => {
                this._status = { phase: 'error', message: emsg(err) };
                writeStream.destroy(err);
            });
            await pipeline(gotStream, writeStream);

            //Verify checksum before touching anything else
            const actualDigest = createHash('sha256').update(fs.readFileSync(this.archivePath)).digest('hex');
            if (actualDigest !== expectedDigest) {
                throw new Error(
                    `Checksum mismatch for monitor.zip (expected ${expectedDigest}, got ${actualDigest}). Download may be corrupted.`,
                );
            }

            //Extract to staging directory
            this._status = { phase: 'extracting' };
            await fsp.mkdir(this.stagingDir, { recursive: true });
            console.warn('Extracting sxPanel update archive...');
            await this.extractZipSafe(this.archivePath, this.stagingDir);

            //Validate the expected resource structure before proceeding
            const missing: string[] = [];
            for (const entry of REQUIRED_ENTRIES) {
                const exists = await fsp
                    .access(path.join(this.stagingDir, entry))
                    .then(() => true)
                    .catch(() => false);
                if (!exists) missing.push(entry);
            }
            if (missing.length) {
                throw new Error(`Extracted update is missing required files: ${missing.join(', ')}`);
            }

            //Cleanup the archive
            await fsp.rm(this.updateDir, { recursive: true, force: true });

            this.stagedVersion = release.version;
            this._status = { phase: 'extracted' };
            console.ok(`sxPanel ${release.version} downloaded and extracted successfully.`);
        } catch (error) {
            const msg = emsg(error) ?? 'Unknown download error';
            console.error(`sxPanel update download failed: ${msg}`);
            this._status = { phase: 'error', message: msg };
            await fsp.writeFile(this.failureStatusPath, msg).catch(() => {});
            await fsp.rm(this.updateDir, { recursive: true, force: true }).catch(() => {});
            await fsp.rm(this.stagingDir, { recursive: true, force: true }).catch(() => {});
            throw error;
        }
    }

    /**
     * Entry point for installing a downloaded update. See PanelUpdateApplyMode for what each mode does.
     */
    async apply(mode: PanelUpdateApplyMode, delayMinutes?: number) {
        if (this._status.phase !== 'extracted') {
            throw new Error('No downloaded update is ready to install.');
        }

        if (mode === 'now') {
            this.clearSchedule();
            await this.applyNow();
        } else if (mode === 'scheduled') {
            if (typeof delayMinutes !== 'number' || !Number.isInteger(delayMinutes)) {
                throw new Error('A restart delay (in minutes) is required to schedule the update.');
            }
            if (delayMinutes < 1 || delayMinutes > MAX_SCHEDULE_MINUTES) {
                throw new Error(
                    `The restart must be scheduled between 1 minute and ${MAX_SCHEDULE_MINUTES / 60} hours from now.`,
                );
            }
            this.scheduleApply(delayMinutes);
        } else if (mode === 'manual') {
            this.clearSchedule();
            this.armManualInstall();
        } else {
            throw new Error('Unknown update install mode.');
        }
    }

    /**
     * Cancels a scheduled restart or a pending "on next restart" install.
     * The downloaded files stay staged, so the admin can pick another option.
     */
    cancelPlan() {
        if (!this.restartPlan) return false;
        const wasMode = this.restartPlan.mode;
        this.clearSchedule();
        this.revokeSwapToken();
        this.restartPlan = undefined;
        console.warn(`sxPanel update ${wasMode === 'scheduled' ? 'scheduled restart' : 'pending install'} cancelled.`);
        return true;
    }

    /**
     * Schedules applyNow() for `delayMinutes` from now, warning players (in-game and Discord)
     * on the same countdown the restart scheduler uses.
     */
    private scheduleApply(delayMinutes: number) {
        this.clearSchedule();
        this.revokeSwapToken(); //in case it was previously set to manual
        const scheduledTs = Date.now() + delayMinutes * 60_000;
        this.restartPlan = { mode: 'scheduled', scheduledTs };
        let lastWarnedMinute: number | undefined;

        const tick = () => {
            if (this.restartPlan?.mode !== 'scheduled') return this.clearSchedule();
            const msLeft = this.restartPlan.scheduledTs - Date.now();
            if (msLeft <= 0) {
                this.clearSchedule();
                this.restartPlan = undefined;
                this.applyNow().catch(() => {
                    //error already stored in status
                });
                return;
            }

            const minsLeft = Math.ceil(msLeft / 60_000);
            if (minsLeft !== lastWarnedMinute && SCHEDULE_WARNINGS.includes(minsLeft)) {
                lastWarnedMinute = minsLeft;
                this.sendRestartWarning(minsLeft);
            }
        };
        this.scheduleTimer = setInterval(tick, 5_000);
        tick();

        const timeStr = new Date(scheduledTs).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        console.warn(`sxPanel update scheduled: FXServer will restart in ${delayMinutes} minute(s) (at ${timeStr}).`);
    }

    private clearSchedule() {
        if (this.scheduleTimer) {
            clearInterval(this.scheduleTimer);
            this.scheduleTimer = undefined;
        }
        if (this.restartPlan?.mode === 'scheduled') {
            this.restartPlan = undefined;
        }
    }

    private sendRestartWarning(minsLeft: number) {
        try {
            if (txCore.fxRunner.isIdle) return;
            const tOptions = {
                smart_count: minsLeft,
                servername: txConfig.general.serverName,
            };
            txCore.discordBot.sendAnnouncement({
                type: 'warning',
                description: {
                    key: 'restarter.schedule_warn_discord',
                    data: tOptions,
                },
            });
            txCore.fxRunner.sendEvent('scheduledRestart', {
                secondsRemaining: minsLeft * 60,
                translatedMessage: txCore.translator.t('restarter.schedule_warn', tOptions),
            });
        } catch (error) {
            console.verbose.warn(`Failed to send update restart warning: ${emsg(error)}`);
        }
    }

    /**
     * "Restart manually" mode: spawns a detached script that sits idle until this FXServer
     * process exits (however that happens), then installs the staged files into the monitor
     * folder. It does NOT relaunch FXServer — the admin starts it again themselves.
     */
    private armManualInstall() {
        const parentDir = path.dirname(txEnv.txaPath);
        const token = this.issueSwapToken();
        if (txEnv.isWindows) {
            this.spawnWindowsSwapScript(parentDir, token, 'manual');
        } else {
            this.spawnLinuxSwapScript(parentDir, token, 'manual');
        }
        this.restartPlan = { mode: 'manual' };
        console.warn(
            'sxPanel update will be installed the next time FXServer is closed. Start it again afterwards to finish.',
        );
    }

    /**
     * Installs the update right now:
     * 1. Stop the game server (players get the usual shutdown notice).
     * 2. Spawn a detached script that waits for our PID to die, installs the staged files into
     *    the monitor folder, then relaunches FXServer with the original command line.
     * 3. Terminate the host process so the script can proceed.
     */
    private async applyNow() {
        if (this._status.phase !== 'extracted') {
            throw new Error('No downloaded update is ready to install.');
        }

        this._status = { phase: 'applying' };
        this.restartPlan = undefined;
        const parentDir = path.dirname(txEnv.txaPath);

        try {
            await this.clearPersistedFailureStatus();

            //Stop the game server if running
            if (!txCore.fxRunner.isIdle) {
                console.warn('Stopping game server to install the sxPanel update...');
                const killError = await txCore.fxRunner.killServer('installing sxPanel update', 'sxPanel', true);
                if (killError) {
                    throw new Error(`Failed to stop game server: ${killError}`);
                }
            }

            //A fresh token also cancels any "install on next restart" watcher that may be waiting
            const token = this.issueSwapToken();
            if (txEnv.isWindows) {
                this.spawnWindowsSwapScript(parentDir, token, 'now');
            } else {
                this.spawnLinuxSwapScript(parentDir, token, 'now');
            }

            //Terminate the FXServer host process. process.exit() alone only exits the
            //embedded Node.js VM — the native host also needs to be told to quit.
            const pid = process.pid;
            setTimeout(() => {
                if (txEnv.isWindows) {
                    try {
                        ExecuteCommand('quit');
                    } catch {
                        quitProcess(0);
                    }
                } else {
                    try {
                        process.kill(pid, 'SIGTERM');
                    } catch {
                        /* already dead */
                    }
                }
                setTimeout(() => {
                    try {
                        process.kill(pid, 'SIGKILL');
                    } catch {
                        /* already dead */
                    }
                }, 5000);
            }, 1500);
        } catch (error) {
            const msg = emsg(error) ?? 'Unknown install error';
            console.error(`sxPanel update install failed: ${msg}`);
            this._status = { phase: 'error', message: msg };
            await fsp.writeFile(this.failureStatusPath, msg).catch(() => {});
            throw error;
        }
    }

    /**
     * Each swap script is bound to a random token stored on disk. A script only touches files
     * if the token still matches when it wakes up, so issuing a new token (or deleting the file)
     * cleanly cancels any script that's still waiting.
     */
    private issueSwapToken() {
        const token = randomBytes(12).toString('hex');
        fs.writeFileSync(this.tokenPath, token);
        return token;
    }

    private revokeSwapToken() {
        try {
            fs.rmSync(this.tokenPath, { force: true });
        } catch {
            /* nothing to revoke */
        }
    }

    /**
     * Windows: batch script waits for our PID to exit, replaces the monitor folder with the
     * staged files, then (mode=now) relaunches FXServer using the captured command line.
     */
    private spawnWindowsSwapScript(parentDir: string, token: string, mode: 'now' | 'manual') {
        const toWin = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '');
        const escapeBatchPath = (p: string) => {
            return toWin(p)
                .replace(/%/g, '%%')
                .replace(/([\^&<>|])/g, '^$1');
        };
        const winTxaPath = escapeBatchPath(txEnv.txaPath);
        const winStagingDir = escapeBatchPath(this.stagingDir);
        const winParentDir = escapeBatchPath(parentDir);
        const scriptPath = path.join(parentDir, `sxpanel_update_${mode}.bat`);
        const winScriptPath = escapeBatchPath(scriptPath);
        const winFailureStatusPath = escapeBatchPath(this.failureStatusPath);
        const winTokenPath = escapeBatchPath(this.tokenPath);
        const pid = process.pid;

        let restartCmd = '';
        if (mode === 'now') {
            try {
                const psOut = execSync(
                    `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`,
                    { encoding: 'utf8', timeout: 2000 },
                );
                restartCmd = psOut.trim();
            } catch {
                console.warn('Could not capture command line for auto-restart.');
            }
            if (!restartCmd.length) {
                try {
                    const quoteArg = (arg: string) => `"${arg.replace(/"/g, '""')}"`;
                    restartCmd = process.argv.map(quoteArg).join(' ');
                    console.warn('Using process.argv fallback for auto-restart command.');
                } catch {
                    // no fallback available
                }
            }
        }
        const winCwd = escapeBatchPath(process.cwd());

        //Re-reads the token file and bails out if this script was superseded/cancelled
        const tokenCheck = [
            'set "CURTOKEN="',
            'if exist "%TOKENFILE%" set /p CURTOKEN=<"%TOKENFILE%"',
            'if not "%CURTOKEN%"=="%MYTOKEN%" goto cancelled',
        ];

        const batLines = [
            '@echo off',
            'title sxPanel Update',
            `set "FAILFILE=${winFailureStatusPath}"`,
            `set "TOKENFILE=${winTokenPath}"`,
            `set "MYTOKEN=${token}"`,
            'echo ============================================',
            'echo   sxPanel Update',
            'echo ============================================',
            'echo.',
        ];

        if (mode === 'manual') {
            batLines.push(
                'echo The update is downloaded and ready to install.',
                'echo It will be installed as soon as FXServer is closed.',
                'echo Leave this window open.',
                'echo.',
                ':waitpidloop',
                ...tokenCheck,
                `tasklist /FI "PID eq ${pid}" 2>NUL | find /I "${pid}" >NUL`,
                'if errorlevel 1 goto waitpiddone',
                'timeout /t 3 /nobreak >nul',
                'goto waitpidloop',
                ':waitpiddone',
                'echo FXServer closed. Installing update - please wait before starting it again...',
            );
        } else {
            batLines.push(
                `echo Waiting for FXServer (PID ${pid}) to shut down...`,
                'set waitretries=0',
                ':waitpidloop',
                `tasklist /FI "PID eq ${pid}" 2>NUL | find /I "${pid}" >NUL`,
                'if errorlevel 1 goto waitpiddone',
                'set /a waitretries+=1',
                'if %waitretries% GEQ 20 (',
                `    set "FAIL_REASON=Could not stop FXServer process ${pid} in time."`,
                '    goto updatefailed',
                ')',
                `echo Process ${pid} still alive, forcing shutdown... attempt %waitretries%`,
                `taskkill /F /PID ${pid} >NUL 2>&1`,
                'timeout /t 1 /nobreak >nul',
                'goto waitpidloop',
                ':waitpiddone',
                'echo FXServer stopped.',
            );
        }

        batLines.push(
            ...tokenCheck,
            'if exist "%FAILFILE%" del /f /q "%FAILFILE%" >NUL 2>&1',
            'echo.',
            'echo Removing old sxPanel files...',
            'set retries=0',
            ':deleteloop',
            `rmdir /s /q "${winTxaPath}" 2>NUL`,
            `if exist "${winTxaPath}" (`,
            '    set /a retries+=1',
            '    if %retries% GEQ 15 (',
            '        echo WARNING: Could not fully delete the old sxPanel folder. Copying over it instead.',
            '        goto inplacecopy',
            '    )',
            '    echo Waiting for the folder to be released... attempt %retries%',
            '    timeout /t 2 /nobreak >nul',
            '    goto deleteloop',
            ')',
            'echo Installing new files...',
            `move "${winStagingDir}" "${winTxaPath}" >NUL`,
            'if not errorlevel 1 goto updatesuccess',
            'echo WARNING: Could not move the new files into place. Copying them instead...',
            ':inplacecopy',
            `robocopy "${winStagingDir}" "${winTxaPath}" /E /MOVE /R:5 /W:2 /NFL /NDL /NJH /NJS /NP >NUL`,
            'if %ERRORLEVEL% GEQ 8 (',
            '    set "FAIL_REASON=Failed to copy the new sxPanel files into the monitor folder."',
            '    goto updatefailed',
            ')',
            `if exist "${winStagingDir}" rmdir /s /q "${winStagingDir}"`,
            ':updatesuccess',
            'echo.',
            'echo sxPanel update installed successfully!',
            'if exist "%FAILFILE%" del /f /q "%FAILFILE%" >NUL 2>&1',
            'if exist "%TOKENFILE%" del /f /q "%TOKENFILE%" >NUL 2>&1',
            'goto restartfx',
            ':updatefailed',
            'echo.',
            'echo ERROR: %FAIL_REASON%',
            '> "%FAILFILE%" echo %FAIL_REASON%',
            'if exist "%TOKENFILE%" del /f /q "%TOKENFILE%" >NUL 2>&1',
            'echo Starting FXServer with the current files...',
        );

        if (restartCmd) {
            const restartScriptPath = path.join(parentDir, 'sxpanel_restart_cmd.cmd');
            const winRestartScript = escapeBatchPath(restartScriptPath);
            fs.writeFileSync(restartScriptPath, `@echo off\r\ncd /d "${winCwd}"\r\n${restartCmd}\r\n`);
            batLines.push(
                ':restartfx',
                'echo Restarting FXServer...',
                'echo.',
                `start "FXServer" cmd.exe /c "${winRestartScript}"`,
                'timeout /t 3 /nobreak >nul',
                `del "${winRestartScript}"`,
                'goto done',
            );
        } else if (mode === 'manual') {
            batLines.push(':restartfx', 'echo You can now start FXServer again.', 'timeout /t 15', 'goto done');
        } else {
            batLines.push(
                ':restartfx',
                'echo Could not determine the FXServer start command automatically.',
                'echo Please start FXServer again manually.',
                'pause',
                'goto done',
            );
        }
        batLines.push(':cancelled', ':done', 'del "%~f0"');

        fs.writeFileSync(scriptPath, batLines.join('\r\n'));

        //The manual watcher can sit around for hours, so keep its window minimized
        const startFlags = mode === 'manual' ? '/min ' : '';
        const child = spawn('cmd.exe', ['/c', `start "sxPanel Update" ${startFlags}cmd.exe /c "${winScriptPath}"`], {
            detached: true,
            stdio: 'ignore',
            cwd: winParentDir,
            shell: true,
        });
        child.unref();
        console.ok(mode === 'now' ? 'Update script started. Restarting FXServer...' : 'Update script armed.');
    }

    /**
     * Linux: detached bash script waits for our PID to exit, moves the staged files into place
     * of the monitor folder, then (mode=now) relaunches FXServer.
     */
    private spawnLinuxSwapScript(parentDir: string, token: string, mode: 'now' | 'manual') {
        const pid = process.pid;
        const escapeSh = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

        let restartCmd = '';
        if (mode === 'now') {
            try {
                const cmdlineRaw = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
                const cmdArgs = cmdlineRaw.split('\0').filter(Boolean);
                restartCmd = cmdArgs.map((a) => escapeSh(a)).join(' ');
            } catch {
                console.warn('Could not capture command line for auto-restart.');
            }
        }

        const scriptPath = path.join(parentDir, `sxpanel_update_${mode}.sh`);
        const logPath = path.join(parentDir, 'sxpanel_update.log');
        const shTxaPath = escapeSh(txEnv.txaPath);
        const shStagingDir = escapeSh(this.stagingDir);
        const shTxaPathBak = escapeSh(txEnv.txaPath + '.bak');
        const shFailurePath = escapeSh(this.failureStatusPath);

        const shLines = [
            '#!/bin/bash',
            '# sxPanel Update Script',
            '',
            'trap "" HUP',
            '',
            `LOGFILE=${escapeSh(logPath)}`,
            `TOKENFILE=${escapeSh(this.tokenPath)}`,
            `MYTOKEN=${escapeSh(token)}`,
            'log() { echo "[sxPanel Update] $*" | tee -a "$LOGFILE"; }',
            'token_ok() { [ "$(cat "$TOKENFILE" 2>/dev/null)" = "$MYTOKEN" ]; }',
            'fail() { log "ERROR: $*"; echo "$*" > ' + shFailurePath + '; rm -f "$TOKENFILE"; }',
            '',
            mode === 'manual'
                ? 'log "Update ready. It will be installed as soon as FXServer is closed."'
                : `log "Waiting for FXServer (PID ${pid}) to shut down..."`,
            `while kill -0 ${pid} 2>/dev/null; do`,
            '    token_ok || exit 0',
            '    sleep 1',
            'done',
            'token_ok || exit 0',
            'log "FXServer stopped. Installing sxPanel update..."',
            '',
            `if [ -d ${shTxaPath} ]; then`,
            `    rm -rf ${shTxaPathBak} 2>/dev/null`,
            `    mv ${shTxaPath} ${shTxaPathBak} || { fail "Failed to back up the current sxPanel files."; exit 1; }`,
            'fi',
            `if mv ${shStagingDir} ${shTxaPath}; then`,
            `    rm -rf ${shTxaPathBak} 2>/dev/null || true`,
            `    rm -f ${shFailurePath} "$TOKENFILE"`,
            '    log "sxPanel update installed successfully!"',
            'else',
            '    fail "Failed to move the new sxPanel files into the monitor folder."',
            `    if [ -d ${shTxaPathBak} ]; then`,
            `        mv ${shTxaPathBak} ${shTxaPath}`,
            '        log "Rolled back to the previous sxPanel files."',
            '    fi',
            'fi',
        ];

        if (restartCmd) {
            const cwd = process.cwd();
            shLines.push(
                '',
                'log "Restarting FXServer..."',
                `rm -f ${escapeSh(scriptPath)}`,
                `cd ${escapeSh(cwd)}`,
                `exec ${restartCmd}`,
            );
        } else if (mode === 'manual') {
            shLines.push('', 'log "You can now start FXServer again."', `rm -f ${escapeSh(scriptPath)}`);
        } else {
            shLines.push('', 'log "Could not determine the FXServer start command. Please start it again manually."');
        }

        fs.writeFileSync(scriptPath, shLines.join('\n') + '\n', { mode: 0o755 });
        let spawnCmd: string;
        let spawnArgs: string[];
        try {
            execSync('which setsid', { stdio: 'ignore' });
            spawnCmd = 'setsid';
            spawnArgs = ['bash', scriptPath];
        } catch {
            spawnCmd = 'bash';
            spawnArgs = [scriptPath];
        }
        const child = spawn(spawnCmd, spawnArgs, {
            detached: true,
            //the manual watcher may outlive our console, so don't tie it to our stdio
            stdio: mode === 'now' ? ['ignore', 'inherit', 'inherit'] : 'ignore',
            cwd: parentDir,
        });
        child.unref();
        console.ok(mode === 'now' ? 'Update script started. Restarting FXServer...' : 'Update script armed.');
    }

    /**
     * Resets the updater state (e.g. after an error).
     */
    async reset() {
        this.clearSchedule();
        this.revokeSwapToken();
        this.restartPlan = undefined;
        this.stagedVersion = undefined;
        await fsp.rm(this.updateDir, { recursive: true, force: true }).catch(() => {});
        await fsp.rm(this.stagingDir, { recursive: true, force: true }).catch(() => {});
        await this.clearPersistedFailureStatus();
        this._status = { phase: 'idle' };
    }

    /**
     * Extracts a ZIP archive into `destDir`, validating every entry resolves inside `destDir`
     * before writing (no zip-slip).
     */
    private async extractZipSafe(srcPath: string, destDir: string): Promise<void> {
        const destResolved = path.resolve(destDir);
        const allowedPrefix = destResolved + path.sep;
        const zip = new StreamZip.async({ file: srcPath });
        try {
            const entries = await zip.entries();
            for (const entryName of Object.keys(entries)) {
                if (path.isAbsolute(entryName) || /^[a-zA-Z]:/.test(entryName) || entryName.includes('\0')) {
                    throw new Error(`Archive entry has unsafe name: ${entryName}`);
                }
                const resolved = path.resolve(destResolved, entryName);
                if (resolved !== destResolved && !resolved.startsWith(allowedPrefix)) {
                    throw new Error(`Archive entry escapes staging directory: ${entryName}`);
                }
            }
            await zip.extract(null, destResolved);
        } finally {
            await zip.close();
        }
    }
}
