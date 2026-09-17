#!/usr/bin/env node
/**
 * CI guard: built panel output must fit within WebServer static cache limits.
 * Mirrors core/modules/WebServer/middlewares/serveStaticMw.ts scan + whitelist rules.
 *
 * Keep MAX_FILES in sync with shared/panelStaticCacheLimits.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {typeof import('../../shared/panelStaticCacheLimits.ts').PANEL_STATIC_CACHE_LIMITS} */
const LIMITS = {
    MAX_BYTES: 75 * 1024 * 1024,
    MAX_FILES: 500,
    MAX_DEPTH: 10,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const panelOutDir = path.resolve(__dirname, '../../monitor/panel');

if (!fs.existsSync(panelOutDir)) {
    console.error(`[verify-static-cache-limit] missing output dir: ${panelOutDir}`);
    console.error('Run: npm run build -w panel');
    process.exit(1);
}

/**
 * @param {string} rootPath
 * @returns {Set<string> | null}
 */
const loadPanelManifest = (rootPath) => {
    try {
        const manifestPath = path.join(rootPath, '.vite', 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const allowed = new Set(['/index.html']);

        for (const entry of Object.values(manifest)) {
            if (entry.file) allowed.add(`/${entry.file}`);
            if (entry.css) {
                for (const cssFile of entry.css) {
                    allowed.add(`/${cssFile}`);
                }
            }
        }

        return allowed;
    } catch {
        return null;
    }
};

/**
 * @param {Set<string> | null} manifestFiles
 * @param {string} url
 */
const checkFileWhitelist = (manifestFiles, url) => {
    if (!manifestFiles) return true;
    if (manifestFiles.has(url)) return true;
    // Mirror core/modules/WebServer/middlewares/serveStaticMw.ts: hashed JS/CSS
    // not in the manifest is a stale artifact, everything else is fine.
    if (/\.(js|css)$/.test(url)) return false;
    return true;
};

/**
 * @param {string} rootPath
 * @param {Set<string> | null} manifestFiles
 */
const countCachedPanelFiles = (rootPath, manifestFiles) => {
    let fileCount = 0;
    let totalBytes = 0;
    /** @type {string[][]} */
    const foldersToScan = [[]];

    while (foldersToScan.length > 0) {
        const currFolderPath = foldersToScan.pop();
        if (currFolderPath.length > LIMITS.MAX_DEPTH) {
            throw new Error(`MAX_DEPTH: ${currFolderPath.length} > ${LIMITS.MAX_DEPTH}`);
        }

        const currentFolderAbs = path.join(rootPath, ...currFolderPath);

        for (const entry of fs.readdirSync(currentFolderAbs, { withFileTypes: true })) {
            if (entry.isDirectory()) {
                if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
                    foldersToScan.push([...currFolderPath, entry.name]);
                }
                continue;
            }

            if (!entry.isFile()) continue;

            const entryPathUrl = `/${path.posix.join(...currFolderPath, entry.name)}`;
            if (!checkFileWhitelist(manifestFiles, entryPathUrl)) continue;

            fileCount++;
            totalBytes += fs.statSync(path.join(currentFolderAbs, entry.name)).size;

            if (fileCount > LIMITS.MAX_FILES) {
                throw new Error(`MAX_FILES: ${fileCount} > ${LIMITS.MAX_FILES}`);
            }
            if (totalBytes > LIMITS.MAX_BYTES) {
                throw new Error(`MAX_BYTES: ${totalBytes} > ${LIMITS.MAX_BYTES}`);
            }
        }
    }

    return { fileCount, totalBytes };
};

try {
    const manifestFiles = loadPanelManifest(panelOutDir);
    const { fileCount, totalBytes } = countCachedPanelFiles(panelOutDir, manifestFiles);
    const totalMb = (totalBytes / 1024 / 1024).toFixed(2);

    console.log(
        `[verify-static-cache-limit] OK — ${fileCount} file(s), ${totalMb} MB raw (limit ${LIMITS.MAX_FILES} files / ${LIMITS.MAX_BYTES} bytes)`,
    );
} catch (error) {
    console.error('[verify-static-cache-limit] panel build exceeds WebServer static cache limits.');
    console.error(String(error));
    console.error('Raise shared/panelStaticCacheLimits.ts and this script, then rebuild core.');
    process.exit(1);
}
