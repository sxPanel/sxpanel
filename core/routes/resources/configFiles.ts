import fsp from 'node:fs/promises';
import path from 'node:path';
import type { ResourceConfigFileEntry } from '@shared/resourcesApiTypes';
import { RESOURCE_ZIP_SKIP_DIRECTORY_NAMES, getAllowedResourceRoots, resolveResourceDownloadPath } from './shared';

/**
 * Resource config file access.
 *
 * Everything here is deliberately conservative: the editor is reachable from
 * both the web panel and the in-game menu, so every path coming from a client
 * is treated as hostile. Files are only ever addressed as
 * (resource name, path relative to that resource's folder) and both parts are
 * re-validated on every request.
 */

/** Data-only formats: editable regardless of the file name. */
export const RESOURCE_CONFIG_DATA_EXTENSIONS = ['.cfg', '.json', '.yml', '.yaml', '.toml', '.ini'] as const;

/**
 * Script formats: only editable when the file is clearly a config file
 * (eg. `config.lua`, `sh_config.lua`, `config/client.lua`), never arbitrary code.
 */
export const RESOURCE_CONFIG_SCRIPT_EXTENSIONS = ['.lua', '.js'] as const;

/** Files that match the patterns above but are not resource configs. */
export const RESOURCE_CONFIG_DENIED_FILE_NAMES = [
    'fxmanifest.lua',
    '__resource.lua',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'jsconfig.json',
] as const;

export const MAX_RESOURCE_CONFIG_FILE_BYTES = 256 * 1024;
export const MAX_RESOURCE_CONFIG_FILES = 200;
export const MAX_RESOURCE_CONFIG_DEPTH = 4;
export const MAX_RESOURCE_CONFIG_PATH_LENGTH = 260;
const MAX_RESOURCE_CONFIG_SCANNED_DIRS = 2_000;

const DATA_EXTENSION_SET = new Set<string>(RESOURCE_CONFIG_DATA_EXTENSIONS);
const SCRIPT_EXTENSION_SET = new Set<string>(RESOURCE_CONFIG_SCRIPT_EXTENSIONS);
const DENIED_FILE_NAME_SET = new Set<string>(RESOURCE_CONFIG_DENIED_FILE_NAMES);
const SKIPPED_DIRECTORY_SET = new Set<string>(RESOURCE_ZIP_SKIP_DIRECTORY_NAMES);
const CONFIG_SCRIPT_STEM_REGEX = /(config|cfg|settings)/i;
const CONFIG_DIRECTORY_NAMES = new Set(['config', 'configs', 'cfg', 'settings']);
//Control chars, Windows-reserved chars and `:` (drive letters / NTFS alternate data streams)
// eslint-disable-next-line no-control-regex
const FORBIDDEN_SEGMENT_CHARS_REGEX = /[\u0000-\u001f<>:"|?*]/;

export type ResourceConfigError = { ok: false; error: string; status: number };
const fail = (status: number, error: string): ResourceConfigError => ({ ok: false, error, status });

/**
 * True when `child` is strictly inside `parent`. Uses path.relative so that
 * Windows case-insensitivity and sibling prefixes (`/res/foo` vs `/res/foobar`)
 * are handled, which a string `startsWith` check gets wrong.
 */
export const isPathInside = (parent: string, child: string): boolean => {
    const relative = path.relative(parent, child);
    if (!relative || path.isAbsolute(relative)) return false;
    return relative !== '..' && !relative.startsWith(`..${path.sep}`);
};

/**
 * Whether a file (given as its path segments relative to the resource root)
 * is on the editable allowlist.
 */
export const isAllowedResourceConfigFile = (segments: string[]): boolean => {
    const fileName = segments.at(-1);
    if (!fileName) return false;
    const lowerName = fileName.toLowerCase();
    if (DENIED_FILE_NAME_SET.has(lowerName)) return false;

    const ext = path.posix.extname(lowerName);
    if (DATA_EXTENSION_SET.has(ext)) return true;
    if (!SCRIPT_EXTENSION_SET.has(ext)) return false;

    const stem = lowerName.slice(0, -ext.length);
    if (CONFIG_SCRIPT_STEM_REGEX.test(stem)) return true;
    return segments.slice(0, -1).some((dirName) => CONFIG_DIRECTORY_NAMES.has(dirName.toLowerCase()));
};

export type ResourceConfigRelPathValidation = { ok: true; relPath: string; segments: string[] } | ResourceConfigError;

/**
 * Validates a client-supplied path relative to a resource folder.
 * Purely lexical: no filesystem access.
 */
export const validateResourceConfigRelPath = (input: unknown): ResourceConfigRelPathValidation => {
    if (typeof input !== 'string' || !input.length) {
        return fail(400, 'Invalid file path.');
    }
    if (input.length > MAX_RESOURCE_CONFIG_PATH_LENGTH) {
        return fail(400, 'File path is too long.');
    }

    const unified = input.replaceAll('\\', '/');
    if (unified.startsWith('/') || path.posix.isAbsolute(unified) || path.win32.isAbsolute(input)) {
        return fail(400, 'Absolute paths are not allowed.');
    }

    const segments = unified.split('/');
    if (segments.length > MAX_RESOURCE_CONFIG_DEPTH + 1) {
        return fail(400, 'File is nested too deeply.');
    }
    for (const segment of segments) {
        if (!segment.length || segment === '.' || segment === '..') {
            return fail(400, 'Invalid file path.');
        }
        if (FORBIDDEN_SEGMENT_CHARS_REGEX.test(segment)) {
            return fail(400, 'Invalid file path.');
        }
        //Windows silently strips trailing dots/spaces, which would defeat the extension check
        if (segment.endsWith('.') || segment.endsWith(' ') || segment.startsWith(' ')) {
            return fail(400, 'Invalid file path.');
        }
    }
    if (segments.slice(0, -1).some((dirName) => SKIPPED_DIRECTORY_SET.has(dirName) || dirName.startsWith('.'))) {
        return fail(403, 'This folder cannot be edited.');
    }
    if (!isAllowedResourceConfigFile(segments)) {
        return fail(403, 'This file type cannot be edited.');
    }

    return { ok: true, relPath: segments.join('/'), segments };
};

export type ResourceConfigRootResult = { ok: true; resourceRoot: string } | ResourceConfigError;

/**
 * Canonicalizes a resource folder and makes sure it really lives inside the
 * server's resources directory, even after resolving symlinks/junctions.
 */
export const confineResourceRoot = async (
    resourceRoot: string,
    allowedRoots: string[],
): Promise<ResourceConfigRootResult> => {
    let realRoot: string;
    try {
        realRoot = await fsp.realpath(resourceRoot);
        const rootStat = await fsp.stat(realRoot);
        if (!rootStat.isDirectory()) return fail(404, 'Resource folder not found.');
    } catch {
        return fail(404, 'Resource folder not found.');
    }

    for (const allowedRoot of allowedRoots) {
        let realAllowedRoot: string;
        try {
            realAllowedRoot = await fsp.realpath(allowedRoot);
        } catch {
            continue;
        }
        if (isPathInside(realAllowedRoot, realRoot)) {
            return { ok: true, resourceRoot: realRoot };
        }
    }
    return fail(403, 'Resource folder is outside the server resources directory.');
};

/**
 * Resolves a resource name (plus the optional path hint from the resources
 * list) into its canonical, confined folder on disk.
 */
export const resolveResourceConfigRoot = async (
    resourceName: unknown,
    resourcePath?: unknown,
): Promise<ResourceConfigRootResult> => {
    if (typeof resourceName !== 'string') {
        return fail(400, 'Invalid resource name.');
    }
    //Rejects invalid names, system_resources and anything outside <dataPath>/resources
    const resolved = await resolveResourceDownloadPath(resourceName, resourcePath);
    if (!resolved.ok) {
        return fail(resolved.status, resolved.error);
    }
    return confineResourceRoot(resolved.resourceRoot, getAllowedResourceRoots());
};

export type ResourceConfigFileResult =
    { ok: true; absPath: string; relPath: string; size: number } | ResourceConfigError;

/**
 * Resolves a relative path to an existing, regular, allowlisted file inside
 * the (already canonical) resource root. Rejects traversal, absolute paths,
 * symlinks that point outside the resource, and oversized files.
 */
export const resolveResourceConfigFile = async (
    resourceRoot: string,
    relPathInput: unknown,
): Promise<ResourceConfigFileResult> => {
    const validation = validateResourceConfigRelPath(relPathInput);
    if (!validation.ok) return validation;

    const candidate = path.resolve(resourceRoot, ...validation.segments);
    if (!isPathInside(resourceRoot, candidate)) {
        return fail(403, 'File is outside the resource folder.');
    }

    let size: number;
    try {
        //lstat: a symlink as the final component is rejected outright
        const linkStat = await fsp.lstat(candidate);
        if (!linkStat.isFile()) {
            return fail(403, 'Only regular files can be edited.');
        }
        size = linkStat.size;
    } catch {
        return fail(404, 'File not found.');
    }

    //realpath: catches symlinked/junctioned parent folders escaping the resource
    let realFile: string;
    try {
        realFile = await fsp.realpath(candidate);
    } catch {
        return fail(404, 'File not found.');
    }
    if (!isPathInside(resourceRoot, realFile)) {
        return fail(403, 'File is outside the resource folder.');
    }

    if (size > MAX_RESOURCE_CONFIG_FILE_BYTES) {
        return fail(413, `File is too large to edit (max ${MAX_RESOURCE_CONFIG_FILE_BYTES / 1024} KiB).`);
    }

    return { ok: true, absPath: realFile, relPath: validation.relPath, size };
};

export type ResourceConfigListResult = { files: ResourceConfigFileEntry[]; truncated: boolean };

/**
 * Lists the editable config files of a resource. Never follows symlinks.
 */
export const listResourceConfigFiles = async (resourceRoot: string): Promise<ResourceConfigListResult> => {
    const files: ResourceConfigFileEntry[] = [];
    const queue: string[][] = [[]];
    let scannedDirs = 0;
    let truncated = false;

    scan: while (queue.length) {
        const dirSegments = queue.shift()!;
        if (++scannedDirs > MAX_RESOURCE_CONFIG_SCANNED_DIRS) {
            truncated = true;
            break;
        }

        let entries;
        try {
            entries = await fsp.readdir(path.join(resourceRoot, ...dirSegments), { withFileTypes: true });
        } catch {
            continue;
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));

        for (const entry of entries) {
            if (entry.isSymbolicLink()) continue;
            const entrySegments = [...dirSegments, entry.name];

            if (entry.isDirectory()) {
                if (SKIPPED_DIRECTORY_SET.has(entry.name) || entry.name.startsWith('.')) continue;
                if (entrySegments.length <= MAX_RESOURCE_CONFIG_DEPTH) queue.push(entrySegments);
                continue;
            }
            if (!entry.isFile()) continue;
            //Same validation the read/save routes apply, so the list never offers a file they would reject
            if (!validateResourceConfigRelPath(entrySegments.join('/')).ok) continue;

            let size: number;
            try {
                size = (await fsp.stat(path.join(resourceRoot, ...entrySegments))).size;
            } catch {
                continue;
            }
            if (files.length >= MAX_RESOURCE_CONFIG_FILES) {
                truncated = true;
                break scan;
            }
            files.push({
                path: entrySegments.join('/'),
                size,
                tooLarge: size > MAX_RESOURCE_CONFIG_FILE_BYTES,
            });
        }
    }

    return { files, truncated };
};

export type ResourceConfigReadResult = { ok: true; contents: string } | ResourceConfigError;

/**
 * Reads a file previously resolved by resolveResourceConfigFile().
 */
export const readResourceConfigFile = async (absPath: string): Promise<ResourceConfigReadResult> => {
    let raw: Buffer;
    try {
        raw = await fsp.readFile(absPath);
    } catch (error) {
        return fail(500, `Failed to read file: ${(error as Error).message}`);
    }
    if (raw.length > MAX_RESOURCE_CONFIG_FILE_BYTES) {
        return fail(413, `File is too large to edit (max ${MAX_RESOURCE_CONFIG_FILE_BYTES / 1024} KiB).`);
    }
    if (raw.includes(0)) {
        return fail(415, 'This does not look like a text file.');
    }
    return { ok: true, contents: raw.toString('utf8') };
};

export type ResourceConfigWriteResult = { ok: true; backupPath: string } | ResourceConfigError;

/**
 * Overwrites a file previously resolved by resolveResourceConfigFile(),
 * keeping the previous contents in `<file>.bkp` (same convention as the
 * server.cfg editor). Existing CRLF line endings are preserved, since the
 * in-game editor always submits LF.
 */
export const writeResourceConfigFile = async (
    absPath: string,
    contentsInput: unknown,
): Promise<ResourceConfigWriteResult> => {
    if (typeof contentsInput !== 'string') {
        return fail(400, 'Invalid file contents.');
    }
    if (contentsInput.includes('\u0000')) {
        return fail(400, 'File contents must be plain text.');
    }

    let contents = contentsInput;
    try {
        const previous = await fsp.readFile(absPath, 'utf8');
        if (previous.includes('\r\n') && !contents.includes('\r\n')) {
            contents = contents.replaceAll('\n', '\r\n');
        }
    } catch (error) {
        return fail(500, `Failed to read the current file: ${(error as Error).message}`);
    }
    if (Buffer.byteLength(contents, 'utf8') > MAX_RESOURCE_CONFIG_FILE_BYTES) {
        return fail(413, `File is too large to save (max ${MAX_RESOURCE_CONFIG_FILE_BYTES / 1024} KiB).`);
    }

    //Never write the backup through a pre-planted symlink or onto a directory
    const backupPath = `${absPath}.bkp`;
    try {
        const backupStat = await fsp.lstat(backupPath);
        if (!backupStat.isFile()) {
            return fail(409, 'Cannot create the backup file: a non-regular file is in the way.');
        }
    } catch {
        //no previous backup
    }

    try {
        await fsp.copyFile(absPath, backupPath);
        await fsp.writeFile(absPath, contents, 'utf8');
    } catch (error) {
        return fail(500, `Failed to save file: ${(error as Error).message}`);
    }
    return { ok: true, backupPath };
};
