const modulename = 'WebServer:DiagnosticsFuncs';
import os from 'node:os';
import got from '@lib/got';
import getOsDistro from '@lib/host/getOsDistro.js';
import getHostUsage from '@lib/host/getHostUsage';
import pidUsageTree from '@lib/host/pidUsageTree.js';
import { txEnv, txHostConfig } from '@core/globalData';
import si from 'systeminformation';
import consoleFactory from '@lib/console';
import { parseFxserverVersion } from '@lib/fxserver/fxsVersionParser';
import { isHttpHealthCheckDisabled } from '@lib/fxserver/httpHealthCheck';
import { getHeapStatistics } from 'node:v8';
import bytes from 'bytes';
import { msToDuration } from './misc';
const console = consoleFactory(modulename);

//Helpers
const MEGABYTE = 1024 * 1024;
type HostStaticDataType = {
    nodeVersion: string;
    username: string;
    osDistro: string;
    cpu: {
        manufacturer: string;
        brand: string;
        speedMin: number;
        speedMax: number;
        physicalCores: number;
        cores: number;
    };
};
type HostDynamicDataType = {
    cpuUsage: number;
    memory: {
        usage: number;
        used: number;
        total: number;
    };
};
type HostDataReturnType =
    | {
          static: HostStaticDataType;
          dynamic?: HostDynamicDataType;
      }
    | { error: string };
let _hostStaticDataCache: HostStaticDataType;
let _hostStaticDataCachePromise: Promise<HostStaticDataType | null> | undefined;

/**
 * Loads and caches host static data (CPU, OS, etc.).
 */
const loadHostStaticDataCache = async (): Promise<HostStaticDataType | null> => {
    if (_hostStaticDataCache) return _hostStaticDataCache;

    //This errors out on pterodactyl egg
    let osUsername = 'unknown';
    try {
        const userInfo = os.userInfo();
        osUsername = userInfo.username;
    } catch (error) {
        /* os.userInfo() throws on Pterodactyl */
    }

    try {
        const cpuStats = await si.cpu();
        const cpuSpeed = cpuStats.speedMin ?? cpuStats.speed;

        _hostStaticDataCache = {
            nodeVersion: process.version,
            username: osUsername,
            osDistro: await getOsDistro(),
            cpu: {
                manufacturer: cpuStats.manufacturer,
                brand: cpuStats.brand,
                speedMin: cpuSpeed,
                speedMax: cpuStats.speedMax,
                physicalCores: cpuStats.physicalCores,
                cores: cpuStats.cores,
            },
        };
        return _hostStaticDataCache;
    } catch (error) {
        _hostStaticDataCachePromise = undefined;
        console.error('Error getting Host static data.');
        console.verbose.dir(error);
        return null;
    }
};

/**
 * Ensures host static data is loaded. Deduplicates concurrent callers.
 */
export const ensureHostStaticDataCache = (): Promise<HostStaticDataType | null> => {
    if (_hostStaticDataCache) return Promise.resolve(_hostStaticDataCache);
    if (!_hostStaticDataCachePromise) {
        _hostStaticDataCachePromise = loadHostStaticDataCache();
    }
    return _hostStaticDataCachePromise;
};

/**
 * Gets the Processes Data.
 * On Windows, uses Get-CimInstance for more reliable process info.
 * On Linux/macOS, uses systeminformation's process tree.
 */
export const getProcessesData = async () => {
    type ProcDataType = {
        pid: number;
        ppid: number | string;
        name: string;
        cpu: number;
        memory: number;
        order: number;
    };
    const procList: ProcDataType[] = [];
    try {
        const txProcessId = process.pid;

        if (txEnv.isWindows) {
            // Use Get-CimInstance for more reliable Windows process data
            const { execSync } = await import('node:child_process');
            const psOutput = execSync(
                `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, WorkingSetSize, Name | ConvertTo-Json -Compress"`,
                { encoding: 'utf8', timeout: 10_000 },
            );
            const parsed = JSON.parse(psOutput);
            const procs = Array.isArray(parsed) ? parsed : [parsed];

            // Collect all PIDs from the direct query, then BFS for descendants
            const targetPids = new Set<number>([txProcessId]);
            let changed = true;
            while (changed) {
                changed = false;
                for (const proc of procs) {
                    if (!targetPids.has(proc.ProcessId) && targetPids.has(proc.ParentProcessId)) {
                        targetPids.add(proc.ProcessId);
                        changed = true;
                    }
                }
            }

            for (const proc of procs) {
                if (!targetPids.has(proc.ProcessId)) continue;
                const memBytes = proc.WorkingSetSize ?? 0;
                let procName: string;
                let order = Date.now();
                if (proc.ProcessId === txProcessId) {
                    procName = 'sxPanel (inside FXserver)';
                    order = 0;
                } else if (memBytes <= 10 * MEGABYTE) {
                    procName = 'FXServer MiniDump';
                } else {
                    procName = 'FXServer';
                }

                procList.push({
                    pid: proc.ProcessId,
                    ppid: proc.ParentProcessId === txProcessId ? `${txProcessId} (sxPanel)` : proc.ParentProcessId,
                    name: procName,
                    cpu: 0, // CIM doesn't provide instantaneous CPU %; would need a second sample
                    memory: memBytes / MEGABYTE,
                    order,
                });
            }
        } else {
            // Linux/macOS: use systeminformation via pidUsageTree
            const processes = await pidUsageTree(txProcessId);

            //NOTE: Cleaning invalid processes that might show up in Linux
            Object.keys(processes).forEach((pid) => {
                if (processes[pid] === null) delete processes[pid];
            });

            //Foreach PID
            Object.keys(processes).forEach((pid) => {
                const curr = processes[pid];
                const currPidInt = parseInt(pid);

                //Define name and order
                let procName;
                let order = curr.timestamp || 1;
                if (currPidInt === txProcessId) {
                    procName = 'sxPanel (inside FXserver)';
                    order = 0;
                } else if (curr.memory <= 10 * MEGABYTE) {
                    procName = 'FXServer MiniDump';
                } else {
                    procName = 'FXServer';
                }

                procList.push({
                    pid: currPidInt,
                    ppid: curr.ppid === txProcessId ? `${txProcessId} (sxPanel)` : curr.ppid,
                    name: procName,
                    cpu: curr.cpu,
                    memory: curr.memory / MEGABYTE,
                    order: order,
                });
            });
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            console.error('Failed to get processes tree usage data.');
            console.error('This is probably because a required system command is not available.');
        } else {
            console.error('Error getting processes tree usage data.');
            console.verbose.dir(error);
        }
    }

    //Sort procList array
    procList.sort((a, b) => a.order - b.order);

    return procList;
};

/**
 * Gets the FXServer Data.
 */
export const getFXServerData = async () => {
    //Check runner child state
    const childState = txCore.fxRunner.child;
    if (!childState?.isAlive) {
        return { error: 'Server Offline' };
    }
    if (!childState?.netEndpoint) {
        return { error: 'Server has no network endpoint' };
    }

    if (isHttpHealthCheckDisabled()) {
        return {
            error: false,
            statusColor: 'success',
            status: ' ONLINE ',
            version: 'HTTP health check disabled',
        };
    }

    //Preparing request
    const url = `http://${childState.netEndpoint}/info.json`;
    const requestOptions = {
        maxRedirects: 0,
        timeout: { request: 1500 },
        retry: { limit: 0 },
    };

    //Making HTTP Request
    let infoData: Record<string, any>;
    try {
        infoData = await got.get(url, requestOptions).json();
    } catch (error) {
        console.warn('Failed to get FXServer information.');
        console.verbose.dir(error);
        return {
            error: 'Failed to retrieve FXServer data. <br>The server must be online for this operation. <br>Check the terminal for more information (if verbosity is enabled)',
        };
    }

    //Processing result
    try {
        const ver = parseFxserverVersion(infoData.server);
        return {
            error: false,
            statusColor: 'success',
            status: ' ONLINE ',
            version: ver.valid ? `${ver.platform}:${ver.branch}:${ver.build}` : `${ver.platform ?? 'unknown'}:INVALID`,
            versionMismatch: ver.build !== txEnv.fxsVersion,
            resources: infoData.resources.length,
            onesync: infoData.vars && infoData.vars.onesync_enabled === 'true' ? 'enabled' : 'disabled',
            maxClients: infoData.vars && infoData.vars.sv_maxClients ? infoData.vars.sv_maxClients : '--',
            txAdminVersion: infoData.vars && infoData.vars['sxPanel-version'] ? infoData.vars['sxPanel-version'] : '--',
        };
    } catch (error) {
        console.warn('Failed to process FXServer information.');
        console.verbose.dir(error);
        return {
            error: 'Failed to process FXServer data. <br>Check the terminal for more information (if verbosity is enabled)',
        };
    }
};

/**
 * Gets the Host Data.
 */
export const getHostData = async (): Promise<HostDataReturnType> => {
    const staticData = await ensureHostStaticDataCache();
    if (!staticData) {
        return {
            error: 'Failed to retrieve host static data. <br>Check the terminal for more information (if verbosity is enabled)',
        };
    }

    //Get dynamic info (mem/cpu usage) and prepare output
    try {
        const stats = await Promise.race([
            getHostUsage(),
            new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2500)),
        ]);
        if (stats) {
            return {
                static: _hostStaticDataCache,
                dynamic: {
                    cpuUsage: stats.cpu.usage,
                    memory: {
                        usage: stats.memory.usage,
                        used: stats.memory.used,
                        total: stats.memory.total,
                    },
                },
            };
        } else {
            return {
                static: _hostStaticDataCache,
            };
        }
    } catch (error) {
        console.error('Error getting Host dynamic data.');
        console.verbose.dir(error);
        return {
            error: 'Failed to retrieve host dynamic data. <br>Check the terminal for more information (if verbosity is enabled)',
        };
    }
};

/**
 * Gets the Host Static Data from cache.
 */
export const getHostStaticData = (): HostStaticDataType => {
    if (!_hostStaticDataCache) {
        throw new Error(`hostStaticDataCache not yet ready`);
    }
    return _hostStaticDataCache;
};

/**
 * Gets sxPanel Data
 */
export const getTxAdminData = async () => {
    const stats = txManager.txRuntime; //shortcut
    const memoryUsage = getHeapStatistics();

    let hostApiTokenState = 'not configured';
    if (txHostConfig.hostApiToken === 'disabled') {
        hostApiTokenState = 'disabled';
    } else if (txHostConfig.hostApiToken) {
        hostApiTokenState = 'configured';
    }

    const defaultFlags = Object.entries(txHostConfig.defaults)
        .filter(([k, v]) => Boolean(v))
        .map(([k, v]) => k);
    return {
        //Stats
        uptime: msToDuration(process.uptime() * 1000),
        databaseFileSize: bytes(txCore.database.fileSize),
        txHostConfig: {
            ...txHostConfig,
            dataSubPath: undefined,
            hostApiToken: hostApiTokenState,
            defaults: defaultFlags,
        },
        txEnv: {
            ...txEnv,
            profileSubPath: undefined,
        },
        monitor: {
            hbFails: {
                http: stats.monitorStats.healthIssues.http,
                fd3: stats.monitorStats.healthIssues.fd3,
            },
            restarts: {
                bootTimeout: stats.monitorStats.restartReasons.bootTimeout,
                close: stats.monitorStats.restartReasons.close,
                heartBeat: stats.monitorStats.restartReasons.heartBeat,
                healthCheck: stats.monitorStats.restartReasons.healthCheck,
                both: stats.monitorStats.restartReasons.both,
            },
        },
        performance: {
            banCheck: stats.banCheckTime.resultSummary('ms').summary,
            whitelistCheck: stats.whitelistCheckTime.resultSummary('ms').summary,
            playersTableSearch: stats.playersTableSearchTime.resultSummary('ms').summary,
            historyTableSearch: stats.historyTableSearchTime.resultSummary('ms').summary,
            databaseSave: stats.databaseSaveTime.resultSummary('ms').summary,
            perfCollection: stats.perfCollectionTime.resultSummary('ms').summary,
        },
        logger: {
            storageSize: (await txCore.logger.getStorageSize()).total,
            statusAdmin: txCore.logger.system.getUsageStats(),
            statusFXServer: txCore.logger.fxserver.getUsageStats(),
            statusServer: txCore.logger.server.getUsageStats(),
        },
        memoryUsage: {
            heap_used: bytes(memoryUsage.used_heap_size),
            heap_limit: bytes(memoryUsage.heap_size_limit),
            heap_pct:
                memoryUsage.heap_size_limit > 0
                    ? ((memoryUsage.used_heap_size / memoryUsage.heap_size_limit) * 100).toFixed(2)
                    : 0,
            physical: bytes(memoryUsage.total_physical_size),
            peak_malloced: bytes(memoryUsage.peak_malloced_memory),
        },
    };
};
