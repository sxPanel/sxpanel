/**
 * Resolves a usable Node.js executable for child processes (Discord bot, addon
 * fork workers) on FXServer/cfx-server Linux artifacts where `process.execPath`
 * is often the musl loader, not `node`, and `node` may be absent from PATH.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const EMBEDDED_NODE_DIR_NAMES = ['node22', 'node20', 'node16', 'node'] as const;

//The directory scans below run synchronously, potentially during boot with the event
//loop blocked. If they escape the artifact tree (eg into a drive root or a dev folder
//full of repos) they can take many minutes on an HDD, freezing boot with no output.
const SCAN_IGNORED_DIR_NAMES = new Set(['node_modules', '.git', 'txdata', 'cache', 'server-data', 'resources']);
const SCAN_MAX_READDIRS = 3000;

const isFilesystemRoot = (dirPath: string): boolean => {
    const resolved = path.resolve(dirPath);
    return path.parse(resolved).root === resolved;
};

export type FxChildNodeRuntimeResolution = {
    childExecPath?: string;
    childExecArgvPrefix: string[];
    candidateCount: number;
    candidateSample: string[];
    cfxRoot?: string;
    hostExecPath: string;
    resolvedChildLabel?: string;
    resolvedViaMuslLoader: boolean;
    suggestedBotNodePath?: string;
};

let memoized: FxChildNodeRuntimeResolution | undefined;
let computed = false;

export function getEnvValueWithLegacy(primaryName: string, legacyName: string): string | undefined {
    const primaryValue = process.env[primaryName];
    if (typeof primaryValue === 'string' && primaryValue.length) return primaryValue;

    const legacyValue = process.env[legacyName];
    if (typeof legacyValue === 'string' && legacyValue.length) return legacyValue;

    return undefined;
}

export function isHostProcessExecPathNodeLike(): boolean {
    const execBase = path.basename(process.execPath).toLowerCase();
    return execBase === 'node' || execBase === 'node.exe' || execBase.startsWith('node');
}

function getCitizenRoot(): string | undefined {
    try {
        // Loaded lazily so early boot callers do not depend on globalData init order.
        const { txEnv } = require('@core/globalData') as typeof import('@core/globalData');
        const root = txEnv?.fxsPath;
        return typeof root === 'string' && root.length ? path.resolve(root) : undefined;
    } catch {
        return undefined;
    }
}

function buildEmbeddedNodeCandidatePaths(root: string): string[] {
    const v8NodeBins = EMBEDDED_NODE_DIR_NAMES.map((dir) =>
        path.join(root, 'citizen', 'scripting', 'v8', dir, 'bin', 'node'),
    );
    const optV8NodeBins = EMBEDDED_NODE_DIR_NAMES.map((dir) =>
        path.join(root, 'opt', 'cfx-server', 'citizen', 'scripting', 'v8', dir, 'bin', 'node'),
    );

    return [
        path.join(root, 'usr', 'bin', 'node'),
        path.join(root, 'usr', 'lib', 'v8', 'node'),
        path.join(root, 'usr', 'lib', 'v8', 'bin', 'node'),
        ...v8NodeBins,
        ...optV8NodeBins,
    ];
}

function pickSuggestedBotNodePath(cfxRoots: string[]): string | undefined {
    for (const root of cfxRoots) {
        for (const dir of EMBEDDED_NODE_DIR_NAMES) {
            const direct = path.join(root, 'citizen', 'scripting', 'v8', dir, 'bin', 'node');
            if (fs.existsSync(direct)) return direct;

            const nested = path.join(root, 'opt', 'cfx-server', 'citizen', 'scripting', 'v8', dir, 'bin', 'node');
            if (fs.existsSync(nested)) return nested;
        }
    }

    return undefined;
}

export function formatFxChildNodeResolutionDiagnostics(r: FxChildNodeRuntimeResolution): string {
    if (r.childExecPath) {
        const label = r.resolvedChildLabel ?? r.childExecPath;
        const via = r.resolvedViaMuslLoader ? ' (via musl loader)' : '';
        return `Resolved Node child runtime: ${label}${via}`;
    }

    const hint = r.suggestedBotNodePath
        ? ` Set SXPANEL_BOT_NODE_PATH=${r.suggestedBotNodePath}. Legacy FXPANEL_BOT_NODE_PATH is also accepted.`
        : '';
    return (
        `No executable Node binary found (candidates=${r.candidateCount}, ` +
        `sample=[${r.candidateSample.join(', ')}], cfxRoot=${r.cfxRoot ?? 'unknown'}).${hint}`
    );
}

function computeFxChildNodeRuntimeResolution(): FxChildNodeRuntimeResolution {
    const execBase = path.basename(process.execPath).toLowerCase();
    const isMuslLoaderExec = execBase.startsWith('ld-musl');

    const candidateSet = new Set<string>();
    const execDir = path.dirname(process.execPath);
    const cfxRootSet = new Set<string>();
    const addCfxRoot = (root: string | undefined) => {
        if (!root) return;
        cfxRootSet.add(path.resolve(root));
    };

    addCfxRoot(execDir);
    addCfxRoot(path.resolve(execDir, '..'));
    addCfxRoot(path.resolve(execDir, '..', '..'));

    const citizenRoot = getCitizenRoot();
    if (citizenRoot) {
        addCfxRoot(citizenRoot);
        addCfxRoot(path.resolve(citizenRoot, '..'));
        addCfxRoot(path.resolve(citizenRoot, '../..'));
        addCfxRoot(path.resolve(citizenRoot, '../../..'));
    }

    const resolvedExecPathAbs = path.resolve(process.execPath);
    const lowerExecPath = resolvedExecPathAbs.toLowerCase();
    const markerWithSep = `${path.sep}cfx-server${path.sep}`;
    const markerTail = `${path.sep}cfx-server`;
    const markerIdx = lowerExecPath.lastIndexOf(markerWithSep);
    if (markerIdx !== -1) {
        addCfxRoot(resolvedExecPathAbs.slice(0, markerIdx + markerWithSep.length - 1));
    } else if (lowerExecPath.endsWith(markerTail)) {
        addCfxRoot(resolvedExecPathAbs);
    }

    const cfxRoots = [...cfxRootSet];
    const cfxLibPathSet = new Set(
        cfxRoots.map(
            (root) =>
                `${path.join(root, 'usr', 'lib', 'v8')}:${path.join(root, 'lib')}:${path.join(root, 'usr', 'lib')}`,
        ),
    );
    if (citizenRoot) {
        const alpineRoot = path.resolve(citizenRoot, '../..');
        cfxLibPathSet.add(
            `${path.join(alpineRoot, 'usr', 'lib', 'v8')}:${path.join(alpineRoot, 'lib')}:${path.join(alpineRoot, 'usr', 'lib')}`,
        );
    }
    const cfxLibPaths = [...cfxLibPathSet];
    const nodeNameRegex = /^node(?:\d+)?(?:\.exe)?$/i;

    //Shared across all scans so the total sync fs work per resolution is bounded.
    let remainingReaddirs = SCAN_MAX_READDIRS;
    const shouldDescendInto = (dirName: string) => !SCAN_IGNORED_DIR_NAMES.has(dirName.toLowerCase());

    const collectNodeBins = (root: string, maxDepth: number): string[] => {
        if (isFilesystemRoot(root) || !fs.existsSync(root)) return [];
        const out: string[] = [];
        const queue: Array<[string, number]> = [[root, 0]];

        while (queue.length && remainingReaddirs > 0) {
            remainingReaddirs--;
            const [dir, depth] = queue.shift()!;
            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                continue;
            }

            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (depth < maxDepth && shouldDescendInto(entry.name)) queue.push([fullPath, depth + 1]);
                    continue;
                }

                if (!(entry.isFile() || entry.isSymbolicLink())) continue;
                if (nodeNameRegex.test(entry.name)) {
                    out.push(fullPath);
                }
            }
        }

        return out;
    };

    const collectExecutableBins = (root: string, maxDepth: number, maxFiles: number): string[] => {
        if (isFilesystemRoot(root) || !fs.existsSync(root)) return [];
        const out: string[] = [];
        const queue: Array<[string, number]> = [[root, 0]];

        while (queue.length && out.length < maxFiles && remainingReaddirs > 0) {
            remainingReaddirs--;
            const [dir, depth] = queue.shift()!;
            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                continue;
            }

            for (const entry of entries) {
                if (out.length >= maxFiles) break;
                const fullPath = path.join(dir, entry.name);

                if (entry.isDirectory()) {
                    if (depth < maxDepth && shouldDescendInto(entry.name)) queue.push([fullPath, depth + 1]);
                    continue;
                }

                if (!(entry.isFile() || entry.isSymbolicLink())) continue;

                try {
                    const st = fs.statSync(fullPath);
                    if ((st.mode & 0o111) !== 0) {
                        out.push(fullPath);
                    }
                } catch {
                    // Ignore unreadable/broken entries.
                }
            }
        }

        return out;
    };

    const envNodeExecPath = process.env.npm_node_execpath ?? process.env.NODE;
    const explicitBot = getEnvValueWithLegacy('SXPANEL_BOT_NODE_PATH', 'FXPANEL_BOT_NODE_PATH');
    const explicitAddon = getEnvValueWithLegacy('SXPANEL_ADDON_NODE_PATH', 'FXPANEL_ADDON_NODE_PATH');
    for (const p of [explicitBot, explicitAddon]) {
        if (typeof p === 'string' && p.length) {
            candidateSet.add(p);
        }
    }
    if (typeof envNodeExecPath === 'string' && envNodeExecPath.length) {
        candidateSet.add(envNodeExecPath);
    }

    if (process.argv0 && path.isAbsolute(process.argv0)) {
        candidateSet.add(process.argv0);
    }

    const siblingNode = path.join(path.dirname(process.execPath), process.platform === 'win32' ? 'node.exe' : 'node');
    if (fs.existsSync(siblingNode)) {
        candidateSet.add(siblingNode);
    }

    const cfxNodeCandidates = cfxRoots.flatMap((root) => buildEmbeddedNodeCandidatePaths(root));
    for (const candidate of cfxNodeCandidates) {
        if (fs.existsSync(candidate)) {
            candidateSet.add(candidate);
        }
    }

    //Deep-scanning the bare roots is a Linux-artifact concern (embedded alpine tree with
    //node at unpredictable paths). Windows artifacts never ship a standalone node binary,
    //and the bare roots may be ancestors of the artifact dir (eg a folder full of repos),
    //so scanning them on Windows is all cost and no benefit.
    const bareRootScanTargets = process.platform === 'win32' ? [] : cfxRoots;
    const cfxNodeSearchRoots = [
        ...cfxRoots.flatMap((root) => [
            path.join(root, 'usr', 'lib', 'v8'),
            path.join(root, 'citizen', 'scripting', 'v8'),
            path.join(root, 'opt', 'cfx-server', 'citizen', 'scripting', 'v8'),
        ]),
        ...bareRootScanTargets,
    ];
    for (const root of cfxNodeSearchRoots) {
        for (const candidate of collectNodeBins(root, 7)) {
            candidateSet.add(candidate);
        }
    }

    const cfxExecSearchRoots = cfxRoots.flatMap((root) => [
        path.join(root, 'usr', 'bin'),
        path.join(root, 'usr', 'lib', 'v8'),
        path.join(root, 'citizen', 'scripting'),
        path.join(root, 'opt', 'cfx-server', 'citizen', 'scripting'),
    ]);
    for (const root of cfxExecSearchRoots) {
        for (const candidate of collectExecutableBins(root, 6, 300)) {
            candidateSet.add(candidate);
        }
    }

    const lookupCmd = process.platform === 'win32' ? 'where' : 'which';
    const nodeInPath = spawnSync(lookupCmd, ['node'], { stdio: 'ignore' });
    if (!nodeInPath.error && nodeInPath.status === 0) {
        candidateSet.add('node');
    }

    const candidates = [...candidateSet];
    const looksLikeNodeVersion = (text: string) => /^v\d+\.\d+\.\d+$/m.test(text.trim());

    const canExecuteDirect = (candidate: string) => {
        const check = spawnSync(candidate, ['--version'], {
            stdio: 'pipe',
            encoding: 'utf8',
            timeout: 1500,
            killSignal: 'SIGKILL',
        });
        if (check.error || check.status !== 0) return false;
        const outText = `${check.stdout ?? ''}\n${check.stderr ?? ''}`;
        return looksLikeNodeVersion(outText);
    };

    const canExecuteViaMuslLoader = (candidate: string): string[] | null => {
        if (!isMuslLoaderExec) return null;
        for (const cfxLibPath of cfxLibPaths) {
            const check = spawnSync(process.execPath, ['--library-path', cfxLibPath, '--', candidate, '--version'], {
                stdio: 'pipe',
                encoding: 'utf8',
                timeout: 1500,
                killSignal: 'SIGKILL',
            });
            if (check.error || check.status !== 0) continue;
            const outText = `${check.stdout ?? ''}\n${check.stderr ?? ''}`;
            if (looksLikeNodeVersion(outText)) {
                return ['--library-path', cfxLibPath, '--', candidate];
            }
        }
        return null;
    };

    let resolvedExecPath: string | undefined;
    let resolvedExecPrefix: string[] = [];
    let resolvedChildLabel: string | undefined;
    let resolvedViaMuslLoader = false;
    for (const candidate of candidates) {
        if (canExecuteDirect(candidate)) {
            resolvedExecPath = candidate;
            resolvedChildLabel = candidate;
            break;
        }

        const muslExecPrefix = canExecuteViaMuslLoader(candidate);
        if (muslExecPrefix) {
            resolvedExecPath = process.execPath;
            resolvedExecPrefix = muslExecPrefix;
            resolvedChildLabel = muslExecPrefix[3];
            resolvedViaMuslLoader = true;
            break;
        }
    }

    return {
        childExecPath: resolvedExecPath,
        childExecArgvPrefix: resolvedExecPrefix,
        candidateCount: candidates.length,
        candidateSample: candidates.slice(0, 10),
        cfxRoot: cfxRoots.slice(0, 4).join(' | '),
        hostExecPath: process.execPath,
        resolvedChildLabel,
        resolvedViaMuslLoader,
        suggestedBotNodePath: pickSuggestedBotNodePath(cfxRoots),
    };
}

/**
 * One-shot resolution for non-Node host execPath (musl loader, FXServer.exe, …).
 * Safe to call from addon fork setup and Discord bot spawn.
 */
export function getFxChildNodeRuntimeResolution(): FxChildNodeRuntimeResolution {
    if (!computed) {
        computed = true;
        memoized = computeFxChildNodeRuntimeResolution();
    }
    return memoized!;
}

/**
 * Returns `{ file, args }` for `child_process.spawn` to run a Node script.
 * Uses the same runtime as addon child processes when the host is not a Node binary.
 *
 * @returns `null` when no Node binary could be resolved (caller should not retry blindly).
 */
export function resolveFxChildNodeSpawn(scriptArgv: string[]): { file: string; args: string[] } | null {
    if (isHostProcessExecPathNodeLike()) {
        return { file: process.execPath, args: [...scriptArgv] };
    }

    const r = getFxChildNodeRuntimeResolution();
    if (!r.childExecPath) {
        return null;
    }

    return {
        file: r.childExecPath,
        args: [...r.childExecArgvPrefix, ...scriptArgv],
    };
}
