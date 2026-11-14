import fs from 'node:fs';
import path from 'node:path';
import { rimrafSync } from 'rimraf';
import { SemVer } from 'semver';
import config from './config';

/**
 * sxPanel in ASCII
 */
export const sxPanelASCII = () => {
    //NOTE: precalculating the ascii art for efficiency
    // const figlet = require('figlet');
    // let ascii = figlet.textSync('sxPanel');
    // let b64 = Buffer.from(ascii).toString('base64');
    // console.log(b64);
    const preCalculated = `ICAgICAgICAgICAgICBfX19fICAgICAgICAgICAgICAgICAgXyAKICBfX18gX18gIF9ffCAgXyBcIF9fIF8gXyBfXyAgIF9fX3wgfAogLyBfX3xcIFwvIC98IHxfKSAvIF9gIHwgJ18gXCAvIF8gXCB8CiBcX18gXCA+ICA8IHwgIF9fLyAoX3wgfCB8IHwgfCAgX18vIHwKIHxfX18vL18vXF9cfF98ICAgXF9fLF98X3wgfF98XF9fX3xffA==`;
    return Buffer.from(preCalculated, 'base64').toString('ascii');
};

/**
 * sxPanel + license banner for bundled files
 */
export const licenseBanner = (baseDir = '.', isBundledFile = false) => {
    const licensePath = path.join(baseDir, 'LICENSE');
    const rootPrefix = isBundledFile ? '../' : '';
    const lineSep = '%'.repeat(80);
    const logoPad = ' '.repeat(18);
    const contentLines = [
        lineSep,
        ...sxPanelASCII()
            .split('\n')
            .map((x) => logoPad + x),
        lineSep,
        'Author: snipz (https://github.com/Snipzil)',
        'Repository: https://github.com/Snipzil/sxpanel',
        'sxPanel is a free open source software provided under the license below.',
        lineSep,
        ...fs.readFileSync(licensePath, 'utf8').trim().split('\n'),
        lineSep,
        'This distribution also includes third party code under their own licenses, which',
        `can be found in ${rootPrefix}THIRD-PARTY-LICENSES.txt or their respective repositories.`,
        `Attribution for non-code assets can be found at the bottom of ${rootPrefix}docs/README.md or at`,
        'the top of the respective file.',
        lineSep,
    ];
    if (isBundledFile) {
        const flattened = contentLines.join('\n * ');
        return `/*!\n * ${flattened}\n */`;
    } else {
        return contentLines.join('\n');
    }
};

export const getLocalPackageVersion = () => {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { version?: string };
    if (!packageJson.version) {
        throw new Error('package.json is missing a version field.');
    }
    return packageJson.version;
};

/**
 * Processes a fxserver path to validate it as well as the monitor folder.
 *
 * Supports Windows, Linux, and macOS hosts. The fxserver binary is detected by
 * looking for any of `FXServer.exe`, `FXServer`, or `run.sh` (the wrapper that
 * ships with the Linux artifact). When `allowMissingBin` is true (e.g. when
 * `TXDEV_NO_SPAWN` is set, such as on macOS or against a Dockerized server),
 * the binary check is skipped entirely so a bare `citizen/system_resources/...`
 * mount is enough.
 */
export const getFxsPaths = (fxserverPath: string, allowMissingBin = false) => {
    const root = path.normalize(fxserverPath);

    //Process fxserver path - try common binary names across platforms
    const binCandidates = ['FXServer.exe', 'FXServer', 'run.sh'];
    let bin: string | null = null;
    for (const candidate of binCandidates) {
        const candidatePath = path.join(root, candidate);
        if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
            bin = candidatePath;
            break;
        }
    }
    if (!bin && !allowMissingBin) {
        throw new Error(
            `No FXServer binary found in ${root}. ` +
                `Tried: ${binCandidates.join(', ')}. ` +
                `If you're targeting a remote/Dockerized server, set TXDEV_NO_SPAWN=1.`,
        );
    }

    //Process monitor path
    const monitor = path.join(root, 'citizen', 'system_resources', 'monitor');
    const monitorStat = fs.statSync(monitor);
    if (!monitorStat.isDirectory()) {
        throw new Error(`${monitor} is not a directory.`);
    }

    return { root, bin: bin ?? '', monitor };
};

/**
 * Extracts the version from the GITHUB_REF env var and detects if pre-release
 * NOTE: to run locally: `GITHUB_REF="refs/tags/v9.9.9" npm run build`
 */
export const getPublishVersion = (isOptional: boolean) => {
    const workflowRef = process.env.GITHUB_REF;
    try {
        if (!workflowRef) {
            if (isOptional) {
                const txVersion = new SemVer(getLocalPackageVersion()).version;
                return {
                    txVersion,
                    isPreRelease: /beta|alpha|rc/i.test(txVersion),
                    preReleaseExpiration: '0',
                };
            } else {
                throw new Error('No --tag found.');
            }
        }
        const refRemoved = workflowRef.replace(/^(refs\/tags\/)?v/, '');
        const parsedVersion = new SemVer(refRemoved);
        const isPreRelease = parsedVersion.prerelease.length > 0;
        const potentialExpiration = new Date().setUTCHours(24 * config.preReleaseExpirationDays, 0, 0, 0);
        console.log(`sxPanel version ${parsedVersion.version}.`);
        return {
            txVersion: parsedVersion.version,
            isPreRelease,
            preReleaseExpiration: process.env.TX_NO_EXPIRATION
                ? '0'
                : isPreRelease
                  ? potentialExpiration.toString()
                  : '0',
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Version setup failed: ' + message);
        process.exit(1);
    }
};

export const replaceFxmanifestVersion = (fxManifestContent: string, txVersion: string) => {
    const nextContent = fxManifestContent.replace(/^version\s+['"][^'"]+['"]$/m, `version '${txVersion}'`);
    if (nextContent === fxManifestContent) {
        throw new Error('Could not find a fxmanifest version line to replace.');
    }
    return nextContent;
};

/**
 * Formats a lua table of strings for fxmanifest script sections.
 */
const formatLuaSection = (name: string, scripts: string[]) => {
    const items = scripts.map((s) => `    '${s}',`).join('\n');
    return `${name}({\n${items}\n})`;
};

/**
 * Edits the ./monitor/fxmanifest.lua to include the txAdmin version
 * and auto-generate script lists from the resource directory.
 *
 * NOTE: repo-owned scripts (resource/) are globbed from the repo working tree,
 * not from targetPath — the copy step wipes and repopulates targetPath, so a
 * concurrent or partially-failed copy (e.g. EBUSY from a running FXServer on
 * Windows) would make a targetPath glob silently produce a truncated manifest.
 * Addons are still globbed from targetPath because default addons can be
 * copied in from outside the repo.
 */
const setupDistFxmanifest = (targetPath: string, txVersion: string) => {
    const fxManifestPath = path.join(targetPath, 'fxmanifest.lua');
    let fxManifestContent = fs.readFileSync(fxManifestPath, 'utf8');
    fxManifestContent = replaceFxmanifestVersion(fxManifestContent, txVersion);

    // Auto-generate script lists using fs.globSync (Node 22+)
    const repoPath = process.cwd();
    const findScripts = (pattern: string, cwd: string = repoPath) =>
        fs
            .globSync(pattern, { cwd })
            .map((f) => f.replaceAll('\\', '/'))
            .sort();

    const sharedScripts = findScripts('resource/shared*.lua');

    // Server scripts: entrypoint.js first, then sv_main.lua, then rest sorted
    const serverLuaScripts = findScripts('resource/**/sv_*.lua');
    const addonServerScripts = findScripts('addons/**/resource/sv_*.lua', targetPath);
    if (!serverLuaScripts.includes('resource/sv_main.lua')) {
        throw new Error('fxmanifest generation: resource/sv_main.lua missing from glob results — refusing to write a broken manifest.');
    }
    const svMainIdx = serverLuaScripts.findIndex((f) => f === 'resource/sv_main.lua');
    if (svMainIdx > 0) {
        const [svMain] = serverLuaScripts.splice(svMainIdx, 1);
        serverLuaScripts.unshift(svMain);
    }
    const serverScripts = ['entrypoint.js', ...serverLuaScripts, ...addonServerScripts];

    // Client scripts: cl_* scripts first, then vendor scripts
    // cl_main.lua must load first (defines RegisterSecureNuiCallback, etc.)
    // cl_ptfx.lua must load before cl_player_mode.lua
    // vendor scripts must be ordered: utils → config → main → camera
    const clientLuaScripts = findScripts('resource/**/cl_*.lua');
    if (!clientLuaScripts.includes('resource/cl_main.lua')) {
        throw new Error('fxmanifest generation: resource/cl_main.lua missing from glob results — refusing to write a broken manifest.');
    }
    const clMainIdx = clientLuaScripts.findIndex((f) => f === 'resource/cl_main.lua');
    if (clMainIdx > 0) {
        const [clMain] = clientLuaScripts.splice(clMainIdx, 1);
        clientLuaScripts.unshift(clMain);
    }
    const vendorOrder = ['utils.lua', 'config.lua', 'main.lua', 'camera.lua'];
    const vendorScripts = findScripts('resource/menu/vendor/**/*.lua').sort((a, b) => {
        const aName = a.split('/').pop() ?? '';
        const bName = b.split('/').pop() ?? '';
        const aIdx = vendorOrder.indexOf(aName);
        const bIdx = vendorOrder.indexOf(bName);
        return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
    });
    const addonClientScripts = findScripts('addons/**/resource/cl_*.lua', targetPath);
    const clientScripts = [...clientLuaScripts, ...addonClientScripts, ...vendorScripts];
    const ptfxIdx = clientScripts.findIndex((f) => f.includes('cl_ptfx.lua'));
    const playerModeIdx = clientScripts.findIndex((f) => f.includes('cl_player_mode.lua'));
    if (ptfxIdx > playerModeIdx && playerModeIdx >= 0) {
        const [ptfx] = clientScripts.splice(ptfxIdx, 1);
        clientScripts.splice(playerModeIdx, 0, ptfx);
    }

    // Replace script sections in manifest
    const sectionRegex = (name: string) => new RegExp(`${name}\\(\\{[\\s\\S]*?\\}\\)`);
    fxManifestContent = fxManifestContent.replace(
        sectionRegex('shared_scripts'),
        formatLuaSection('shared_scripts', sharedScripts),
    );
    fxManifestContent = fxManifestContent.replace(
        sectionRegex('server_scripts'),
        formatLuaSection('server_scripts', serverScripts),
    );
    fxManifestContent = fxManifestContent.replace(
        sectionRegex('client_scripts'),
        formatLuaSection('client_scripts', clientScripts),
    );

    fs.writeFileSync(fxManifestPath, fxManifestContent);
};

export const shouldCopyStaticEntry = (sourcePath: string) => path.basename(sourcePath) !== '.git';

export const shouldSyncStaticContents = (_srcPath: string, _eventName: string) => {
    // Dev sync includes addons/ so edits under repo addons/ reach TXDEV_FXSERVER_PATH/monitor.
    return true;
};

/**
 * Dev hot-reload keeps FXServer running while addon files change. Wiping monitor/addons/
 * before copy causes EBUSY on Windows when the server holds handles. Merge-copy instead.
 */
export const shouldWipeCopyDestination = (srcPath: string, eventName: string) => {
    if (srcPath === 'addons/') {
        return eventName === 'publish';
    }
    return true;
};

export const clearCopyDestination = (srcPath: string, destPath: string) => {
    if (!fs.existsSync(destPath)) {
        return;
    }

    const srcStat = fs.lstatSync(srcPath);
    const destStat = fs.lstatSync(destPath);
    if (srcStat.isDirectory() && destStat.isDirectory()) {
        for (const entryName of fs.readdirSync(destPath)) {
            rimrafSync(path.join(destPath, entryName));
        }
        return;
    }

    rimrafSync(destPath);
};

const resolveIfExists = (targetPath: string) => {
    if (!fs.existsSync(targetPath)) return undefined;

    try {
        return fs.realpathSync(targetPath);
    } catch {
        return path.resolve(targetPath);
    }
};

export const copyDirectoryIfDifferent = (srcPath: string, destPath: string) => {
    const resolvedSource = resolveIfExists(srcPath) ?? path.resolve(srcPath);
    const resolvedDestination = resolveIfExists(destPath);
    if (resolvedDestination && resolvedSource === resolvedDestination) {
        return false;
    }

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    if (fs.existsSync(destPath)) {
        fs.rmSync(destPath, { recursive: true, force: true });
    }
    fs.cpSync(srcPath, destPath, { recursive: true, force: true });
    return true;
};

export const getDefaultAddonWatchPaths = () => {
    return (config.defaultAddons ?? []).map((addon) => addon.source).filter((sourcePath) => fs.existsSync(sourcePath));
};

export const copyDefaultAddons = (targetPath: string, eventName: string) => {
    let failures = 0;

    for (const addon of config.defaultAddons ?? []) {
        if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(addon.id)) {
            failures++;
            console.error(`[COPIER] Invalid default addon id: ${addon.id}`);
            continue;
        }

        const srcPath = path.normalize(addon.source);
        if (!fs.existsSync(srcPath)) {
            continue;
        }

        const destPath = path.join(targetPath, 'addons', addon.id);
        const resolvedSource = resolveIfExists(srcPath) ?? path.resolve(srcPath);
        const resolvedDestination = resolveIfExists(destPath);
        if (resolvedDestination && resolvedSource === resolvedDestination) {
            continue;
        }

        try {
            if (!fs.statSync(srcPath).isDirectory()) {
                throw new Error('source is not a directory');
            }
            if (!fs.existsSync(path.join(srcPath, 'addon.json'))) {
                throw new Error('source is missing addon.json');
            }

            if (eventName === 'init' || eventName === 'publish') {
                clearCopyDestination(srcPath, destPath);
            } else {
                fs.mkdirSync(destPath, { recursive: true });
            }
            fs.cpSync(srcPath, destPath, { recursive: true, force: true, filter: shouldCopyStaticEntry });
            console.log(`[COPIER] Mirrored default addon ${addon.id} from ${srcPath}.`);
        } catch (error) {
            failures++;
            console.error(
                `[COPIER] Failed to copy default addon ${addon.id} ${srcPath} -> ${destPath}: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    return failures;
};

const readJsonFile = <T>(filePath: string): T => {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
};

const resolveInstalledPackageDir = (packageName: string, fromDir: string) => {
    let currentDir = path.resolve(fromDir);

    while (true) {
        const packageJsonPath = path.join(currentDir, 'node_modules', packageName, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
            const packageJson = readJsonFile<{ name?: string }>(packageJsonPath);
            if (packageJson.name === packageName) {
                return path.dirname(packageJsonPath);
            }
        }

        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            throw new Error(`Could not resolve installed package directory for ${packageName} from ${fromDir}.`);
        }
        currentDir = parentDir;
    }
};

const getPackageDependencyNames = (packageDir: string) => {
    const packageJson = readJsonFile<{
        dependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
    }>(path.join(packageDir, 'package.json'));

    const names = [...Object.keys(packageJson.dependencies ?? {})];
    for (const optionalName of Object.keys(packageJson.optionalDependencies ?? {})) {
        try {
            resolveInstalledPackageDir(optionalName, packageDir);
            names.push(optionalName);
        } catch {
            // Platform-specific optional native bindings (e.g. resvg) are not all installed.
        }
    }
    return [...new Set(names)];
};

type PackageSeed = {
    packageName: string;
    fromDir: string;
};

export const copyInstalledPackageTree = (monitorPath: string, seeds: PackageSeed[], label: string) => {
    const monitorNodeModulesDir = path.join(monitorPath, 'node_modules');
    const rootNodeModulesDir = path.resolve('.', 'node_modules');
    const pendingPackages = [...seeds];
    const copiedPackageDirs = new Set<string>();

    fs.mkdirSync(monitorNodeModulesDir, { recursive: true });

    while (pendingPackages.length > 0) {
        const pending = pendingPackages.shift();
        if (!pending) continue;

        let sourceDir: string;
        try {
            sourceDir = resolveInstalledPackageDir(pending.packageName, pending.fromDir);
        } catch {
            continue;
        }
        const resolvedSourceDir = resolveIfExists(sourceDir) ?? path.resolve(sourceDir);
        if (copiedPackageDirs.has(resolvedSourceDir)) continue;

        const relativePackageDir = path.relative(rootNodeModulesDir, resolvedSourceDir);
        if (relativePackageDir.startsWith('..')) {
            throw new Error(`${label} dependency ${pending.packageName} resolved outside root node_modules.`);
        }

        copyDirectoryIfDifferent(resolvedSourceDir, path.join(monitorNodeModulesDir, relativePackageDir));
        copiedPackageDirs.add(resolvedSourceDir);

        for (const dependencyName of getPackageDependencyNames(resolvedSourceDir)) {
            pendingPackages.push({
                packageName: dependencyName,
                fromDir: resolvedSourceDir,
            });
        }
    }
};

export const copyBotRuntimeDependencies = (monitorPath: string) => {
    const botPackageJson = readJsonFile<{
        dependencies?: Record<string, string>;
    }>(path.join('.', 'bot', 'package.json'));
    const pendingPackages = Object.keys(botPackageJson.dependencies ?? {}).map((packageName) => ({
        packageName,
        fromDir: path.resolve('.', 'bot'),
    }));

    copyInstalledPackageTree(monitorPath, pendingPackages, 'Bot');
    copyDirectoryIfDifferent('./addon-sdk', path.join(monitorPath, 'node_modules', 'addon-sdk'));
};

/**
 * Sync the files from local path to target path.
 * This function tried to remove the files before copying new ones,
 * therefore, first make sure the path is correct.
 * NOTE: each change, it resets the entire target path.
 */
export const copyStaticFiles = (targetPath: string, txVersion: string, eventName: string) => {
    console.log(`[COPIER][${eventName}] Syncing ${targetPath}.`);
    let failures = 0;
    for (const srcPath of config.copy) {
        const destPath = path.join(targetPath, srcPath);
        if (!shouldSyncStaticContents(srcPath, eventName)) {
            fs.mkdirSync(destPath, { recursive: true });
            continue;
        }

        if (shouldWipeCopyDestination(srcPath, eventName)) {
            try {
                clearCopyDestination(srcPath, destPath);
            } catch (error) {
                console.warn(
                    `[COPIER] Failed to remove ${destPath}: ${error instanceof Error ? error.message : String(error)}, copying over existing files.`,
                );
            }
        } else {
            fs.mkdirSync(destPath, { recursive: true });
        }
        try {
            fs.cpSync(srcPath, destPath, { recursive: true, force: true, filter: shouldCopyStaticEntry });
        } catch (error) {
            failures++;
            console.error(
                `[COPIER] Failed to copy ${srcPath} → ${destPath}: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }
    failures += copyDefaultAddons(targetPath, eventName);
    try {
        setupDistFxmanifest(targetPath, txVersion);
    } catch (error) {
        failures++;
        console.error(`[COPIER] Failed to setup fxmanifest: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (failures) {
        console.warn(`[COPIER] Completed with ${failures} error(s).`);
    }
};
