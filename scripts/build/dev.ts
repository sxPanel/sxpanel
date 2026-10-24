import fs from 'node:fs';
import path from 'node:path';
import chokidar from 'chokidar';
import { debounce } from 'lodash-es';
import esbuild, { BuildOptions } from 'esbuild';
import {
    copyBotRuntimeDependencies,
    copyStaticFiles,
    getDefaultAddonWatchPaths,
    getFxsPaths,
    getPublishVersion,
} from './utils';
import config from './config';
import { parseTxDevEnv } from '../../shared/txDevEnv';
import { TxAdminRunner } from './TxAdminRunner';
process.loadEnvFile();

//Reset terminal
process.stdout.write('.\n'.repeat(40) + '\x1B[2J\x1B[H');

//Load the env vars, and check for the required ones
const txDevEnv = parseTxDevEnv();
if (!txDevEnv.FXSERVER_PATH || !txDevEnv.VITE_URL) {
    console.error(`Missing 'TXDEV_FXSERVER_PATH' and/or 'TXDEV_VITE_URL' env variables.`);
    console.error(
        'See docs/CONTRIBUTING.md, shared/txDevEnv.ts, and https://github.com/Snipzil/sxPanel-Docs/tree/main for setup.',
    );
    process.exit(1);
}

//Auto-enable NO_SPAWN on platforms where FXServer can't run natively (macOS).
//Users on Windows/Linux can still opt-in explicitly via TXDEV_NO_SPAWN=1, e.g.
//when targeting a remote / Dockerized FXServer.
const noSpawn = txDevEnv.NO_SPAWN || process.platform === 'darwin';
if (noSpawn) {
    if (process.platform === 'darwin' && !txDevEnv.NO_SPAWN) {
        console.log('[BUILDER] Detected macOS host - running in watch-only mode (no FXServer spawn).');
    } else {
        console.log('[BUILDER] TXDEV_NO_SPAWN set - running in watch-only mode (no FXServer spawn).');
    }
}

//Setup
const { txVersion, preReleaseExpiration } = getPublishVersion(true);
let fxsPaths: ReturnType<typeof getFxsPaths>;
try {
    fxsPaths = getFxsPaths(txDevEnv.FXSERVER_PATH!, noSpawn);
} catch (error) {
    console.error('[BUILDER] Could not extract/validate the fxserver and monitor paths.');
    console.error(error);
    process.exit(1);
}
console.log(`[BUILDER] Starting sxPanel Dev Builder for ${fxsPaths.root}`);

//Sync target path and start chokidar
//We don't really care about the path, just remove everything and copy again
copyStaticFiles(fxsPaths.monitor, txVersion, 'init');
copyBotRuntimeDependencies(fxsPaths.monitor);
const debouncedCopier = debounce((eventName) => {
    try {
        copyStaticFiles(fxsPaths.monitor, txVersion, eventName);
    } catch (error) {
        console.error(`[COPIER] Unhandled error during sync: ${(error as Error).message}`);
    }
}, config.debouncerInterval);
const staticWatchPaths = [...config.copy, ...getDefaultAddonWatchPaths()];
const staticWatcher = chokidar.watch(staticWatchPaths, {
    awaitWriteFinish: {
        stabilityThreshold: 150,
        pollInterval: 50,
    },
    usePolling: process.platform === 'win32',
    interval: 250,
    persistent: true,
    ignoreInitial: true,
});
staticWatcher.on('add', () => {
    debouncedCopier('add');
});
staticWatcher.on('change', () => {
    debouncedCopier('change');
});
staticWatcher.on('unlink', () => {
    debouncedCopier('unlink');
});
//yarn.installed Needs to be older than the package.json
fs.writeFileSync(path.join(fxsPaths.monitor, '.yarn.installed'), '');
fs.writeFileSync(path.join(fxsPaths.monitor, 'package.json'), '{"type":"commonjs"}');

//Create txAdmin process runner
const txInstance = new TxAdminRunner(fxsPaths.root, fxsPaths.bin, txDevEnv);

//Listens on stdin for the key 'r'
process.stdin.on('data', (data) => {
    const cmd = data.toString().toLowerCase().trim();
    if (cmd === 'r' || cmd === 'rr') {
        if (noSpawn) {
            console.log('[BUILDER] Watch-only mode: restart your FXServer manually.');
            return;
        }
        txInstance.removeRebootPause();
        console.log(`[BUILDER] Restarting due to stdin request.`);
        txInstance.killServer();
        txInstance.spawnServer();
    } else if (cmd === 'p' || cmd === 'pause') {
        if (noSpawn) return;
        txInstance.toggleRebootPause();
    } else if (cmd === 'cls' || cmd === 'clear') {
        console.clear();
    }
});

//Transpile & bundle
//NOTE: "result" is {errors[], warnings[], stop()}
console.log('[BUILDER] Setting up esbuild.');
const buildOptions: BuildOptions = {
    //no minify, no banner
    entryPoints: ['./core'],
    bundle: true,
    sourcemap: 'linked',
    outfile: path.join(fxsPaths.monitor, 'core', 'index.js'),
    platform: 'node',
    target: 'node18',
    format: 'cjs', //typescript builds to esm and esbuild converts it to cjs
    charset: 'utf8',
    inject: [path.join('scripts', 'build', 'importMetaUrlShim.js')],
    define: { TX_PRERELEASE_EXPIRATION: preReleaseExpiration, 'import.meta.url': 'import_meta_url' },
};
const plugins: BuildOptions['plugins'] = [
    {
        name: 'fxsRestarter',
        setup(build) {
            build.onStart(() => {
                console.log(`[BUILDER] Build started.`);
                if (!noSpawn) txInstance.killServer();
            });
            build.onEnd(({ errors }) => {
                if (errors.length) {
                    console.log(`[BUILDER] Failed with errors.`);
                } else {
                    console.log('[BUILDER] Finished build.');
                    if (!noSpawn) txInstance.spawnServer();
                }
            });
        },
    },
];

try {
    const esbuildCtx = await esbuild.context({ ...buildOptions, plugins });
    await esbuildCtx.watch();
} catch (error) {
    console.log('[BUILDER] Something went very wrong.');
    process.exit(1);
}
