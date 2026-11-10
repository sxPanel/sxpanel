import fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockCtx } from '@core/testing/routeTestUtils';
import {
    MAX_RESOURCE_CONFIG_FILE_BYTES,
    confineResourceRoot,
    isAllowedResourceConfigFile,
    isPathInside,
    listResourceConfigFiles,
    resolveResourceConfigFile,
    resolveResourceConfigRoot,
    validateResourceConfigRelPath,
    writeResourceConfigFile,
} from './configFiles';
import { ResourcesConfigFile, ResourcesConfigFiles, ResourcesConfigSave } from './config';

let tmpRoot: string;
let dataPath: string;
let resourcesRoot: string;
let resourceRoot: string;
let outsideDir: string;

const writeFile = async (filePath: string, contents: string | Buffer = 'x') => {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, contents);
};

/** Directory link that works unprivileged on Windows (junction) and POSIX (symlink). */
const linkDir = (target: string, linkPath: string) => fsp.symlink(target, linkPath, 'junction');

/** File symlinks need elevation on Windows; returns false when they cannot be created. */
const tryLinkFile = async (target: string, linkPath: string) => {
    try {
        await fsp.symlink(target, linkPath, 'file');
        return true;
    } catch {
        return false;
    }
};

beforeEach(async () => {
    tmpRoot = await fsp.realpath(await fsp.mkdtemp(path.join(tmpdir(), 'sxp-rescfg-')));
    dataPath = path.join(tmpRoot, 'server-data');
    resourcesRoot = path.join(dataPath, 'resources');
    resourceRoot = path.join(resourcesRoot, '[core]', 'my_res');
    outsideDir = path.join(tmpRoot, 'outside');

    await writeFile(path.join(resourceRoot, 'config.lua'), 'Config = {}\n');
    await writeFile(path.join(resourceRoot, 'fxmanifest.lua'), "fx_version 'cerulean'\n");
    await writeFile(path.join(resourceRoot, 'server', 'main.lua'), 'print(1)\n');
    await writeFile(path.join(resourceRoot, 'shared', 'sh_config.lua'), 'Shared = {}\n');
    await writeFile(path.join(resourceRoot, 'config', 'client.lua'), 'Client = {}\n');
    await writeFile(path.join(resourceRoot, 'data', 'items.json'), '{}\n');
    await writeFile(path.join(resourceRoot, 'settings.cfg'), 'set a b\n');
    await writeFile(path.join(resourceRoot, 'package.json'), '{}\n');
    await writeFile(path.join(resourceRoot, 'node_modules', 'dep', 'config.json'), '{}\n');
    await writeFile(path.join(resourceRoot, '.git', 'config.json'), '{}\n');
    await writeFile(path.join(outsideDir, 'secret.cfg'), 'rcon_password hunter2\n');
    await writeFile(path.join(dataPath, 'server.cfg'), 'sv_licenseKey abc\n');

    vi.stubGlobal('txConfig', { server: { dataPath } });
    vi.stubGlobal('txCore', {
        fxResources: { resourceReport: undefined },
        fxRunner: { child: { isAlive: false }, sendCommand: vi.fn(() => false) },
    });
});

afterEach(async () => {
    vi.unstubAllGlobals();
    await fsp.rm(tmpRoot, { recursive: true, force: true });
});

describe('isPathInside', () => {
    it('accepts strict descendants only', () => {
        const parent = path.join(tmpdir(), 'res', 'foo');
        expect(isPathInside(parent, path.join(parent, 'config.lua'))).toBe(true);
        expect(isPathInside(parent, path.join(parent, 'a', 'b.json'))).toBe(true);
        expect(isPathInside(parent, path.join(parent, '..foo.cfg'))).toBe(true);
        expect(isPathInside(parent, parent)).toBe(false);
        expect(isPathInside(parent, path.dirname(parent))).toBe(false);
        expect(isPathInside(parent, `${parent}bar`)).toBe(false);
        expect(isPathInside(parent, path.join(parent, '..', 'other', 'config.lua'))).toBe(false);
    });
});

describe('isAllowedResourceConfigFile', () => {
    it('allows data formats and config-named scripts', () => {
        expect(isAllowedResourceConfigFile(['config.lua'])).toBe(true);
        expect(isAllowedResourceConfigFile(['Config.LUA'])).toBe(true);
        expect(isAllowedResourceConfigFile(['shared', 'sh_config.lua'])).toBe(true);
        expect(isAllowedResourceConfigFile(['config', 'client.lua'])).toBe(true);
        expect(isAllowedResourceConfigFile(['settings.js'])).toBe(true);
        expect(isAllowedResourceConfigFile(['data', 'items.json'])).toBe(true);
        expect(isAllowedResourceConfigFile(['perms.cfg'])).toBe(true);
        expect(isAllowedResourceConfigFile(['locales.yml'])).toBe(true);
    });

    it('rejects arbitrary code, manifests and other file types', () => {
        expect(isAllowedResourceConfigFile(['server', 'main.lua'])).toBe(false);
        expect(isAllowedResourceConfigFile(['client.js'])).toBe(false);
        expect(isAllowedResourceConfigFile(['fxmanifest.lua'])).toBe(false);
        expect(isAllowedResourceConfigFile(['__resource.lua'])).toBe(false);
        expect(isAllowedResourceConfigFile(['package.json'])).toBe(false);
        expect(isAllowedResourceConfigFile(['config.lua.bkp'])).toBe(false);
        expect(isAllowedResourceConfigFile(['config.exe'])).toBe(false);
        expect(isAllowedResourceConfigFile(['config'])).toBe(false);
        expect(isAllowedResourceConfigFile(['stream', 'car.ytd'])).toBe(false);
        expect(isAllowedResourceConfigFile([])).toBe(false);
    });
});

describe('validateResourceConfigRelPath', () => {
    it('normalizes valid relative paths', () => {
        expect(validateResourceConfigRelPath('config.lua')).toMatchObject({ ok: true, relPath: 'config.lua' });
        expect(validateResourceConfigRelPath('shared\\sh_config.lua')).toMatchObject({
            ok: true,
            relPath: 'shared/sh_config.lua',
        });
    });

    it.each([
        ['parent traversal', '../config.lua'],
        ['nested traversal', 'shared/../../config.lua'],
        ['backslash traversal', '..\\..\\server.cfg'],
        ['deep traversal', '../../../../../../etc/passwd.cfg'],
        ['dot segment', './config.lua'],
        ['empty segment', 'shared//config.lua'],
        ['posix absolute', '/etc/config.cfg'],
        ['windows absolute', 'C:\\server-data\\server.cfg'],
        ['windows drive relative', 'C:config.cfg'],
        ['unc path', '\\\\host\\share\\config.cfg'],
        ['alternate data stream', 'config.lua:evil.lua'],
        ['null byte', 'config.lua\u0000.png'],
        ['trailing dot', 'main.lua./config.cfg'],
        ['trailing space', 'config.cfg '],
        ['empty string', ''],
    ])('rejects %s', (_label, input) => {
        expect(validateResourceConfigRelPath(input).ok).toBe(false);
    });

    it('rejects non-strings and oversized paths', () => {
        expect(validateResourceConfigRelPath(undefined).ok).toBe(false);
        expect(validateResourceConfigRelPath(['config.lua']).ok).toBe(false);
        expect(validateResourceConfigRelPath({ toString: () => 'config.lua' }).ok).toBe(false);
        expect(validateResourceConfigRelPath(`${'a'.repeat(300)}.cfg`).ok).toBe(false);
        expect(validateResourceConfigRelPath('a/b/c/d/e/config.cfg').ok).toBe(false);
    });

    it('rejects disallowed files and skipped folders', () => {
        expect(validateResourceConfigRelPath('server/main.lua')).toMatchObject({ ok: false, status: 403 });
        expect(validateResourceConfigRelPath('fxmanifest.lua')).toMatchObject({ ok: false, status: 403 });
        expect(validateResourceConfigRelPath('config.lua.bkp')).toMatchObject({ ok: false, status: 403 });
        expect(validateResourceConfigRelPath('node_modules/dep/config.json')).toMatchObject({ ok: false, status: 403 });
        expect(validateResourceConfigRelPath('.git/config.json')).toMatchObject({ ok: false, status: 403 });
    });
});

describe('confineResourceRoot / resolveResourceConfigRoot', () => {
    it('resolves a resource by name inside the resources directory', async () => {
        const result = await resolveResourceConfigRoot('my_res');
        expect(result).toEqual({ ok: true, resourceRoot });
    });

    it('accepts a matching path hint and ignores a hostile one', async () => {
        expect(await resolveResourceConfigRoot('my_res', resourceRoot)).toEqual({ ok: true, resourceRoot });
        //A hint outside <dataPath>/resources is discarded; lookup falls back to the name
        expect(await resolveResourceConfigRoot('my_res', outsideDir)).toEqual({ ok: true, resourceRoot });
        expect(await resolveResourceConfigRoot('my_res', path.join(resourcesRoot, '..'))).toEqual({
            ok: true,
            resourceRoot,
        });
    });

    it('rejects invalid and unknown resource names', async () => {
        expect((await resolveResourceConfigRoot('../outside')).ok).toBe(false);
        expect((await resolveResourceConfigRoot('..')).ok).toBe(false);
        expect((await resolveResourceConfigRoot('')).ok).toBe(false);
        expect((await resolveResourceConfigRoot(undefined)).ok).toBe(false);
        expect((await resolveResourceConfigRoot(['my_res'])).ok).toBe(false);
        expect((await resolveResourceConfigRoot('does_not_exist')).ok).toBe(false);
    });

    it('rejects a resource folder that is a link to outside the resources directory', async () => {
        await linkDir(outsideDir, path.join(resourcesRoot, 'linked_res'));
        expect(await confineResourceRoot(path.join(resourcesRoot, 'linked_res'), [resourcesRoot])).toMatchObject({
            ok: false,
            status: 403,
        });
        expect((await resolveResourceConfigRoot('linked_res')).ok).toBe(false);
    });

    it('rejects the resources directory itself and missing folders', async () => {
        expect((await confineResourceRoot(resourcesRoot, [resourcesRoot])).ok).toBe(false);
        expect(await confineResourceRoot(path.join(resourcesRoot, 'nope'), [resourcesRoot])).toMatchObject({
            ok: false,
            status: 404,
        });
        expect((await confineResourceRoot(resourceRoot, [])).ok).toBe(false);
    });
});

describe('resolveResourceConfigFile', () => {
    it('resolves allowlisted files inside the resource', async () => {
        expect(await resolveResourceConfigFile(resourceRoot, 'config.lua')).toMatchObject({
            ok: true,
            absPath: path.join(resourceRoot, 'config.lua'),
            relPath: 'config.lua',
        });
        expect(await resolveResourceConfigFile(resourceRoot, 'data\\items.json')).toMatchObject({
            ok: true,
            relPath: 'data/items.json',
        });
    });

    it('rejects traversal out of the resource folder', async () => {
        for (const attempt of [
            '../../../server.cfg',
            '..\\..\\..\\server.cfg',
            '../other_res/config.lua',
            path.join(dataPath, 'server.cfg'),
            path.join(outsideDir, 'secret.cfg'),
        ]) {
            const result = await resolveResourceConfigFile(resourceRoot, attempt);
            expect(result.ok, attempt).toBe(false);
        }
    });

    it('rejects missing files, directories and disallowed files', async () => {
        expect(await resolveResourceConfigFile(resourceRoot, 'missing.cfg')).toMatchObject({ ok: false, status: 404 });
        await fsp.mkdir(path.join(resourceRoot, 'folder.cfg'));
        expect(await resolveResourceConfigFile(resourceRoot, 'folder.cfg')).toMatchObject({ ok: false, status: 403 });
        expect(await resolveResourceConfigFile(resourceRoot, 'server/main.lua')).toMatchObject({
            ok: false,
            status: 403,
        });
    });

    it('rejects files reached through a linked folder that escapes the resource', async () => {
        await linkDir(outsideDir, path.join(resourceRoot, 'linked'));
        expect(await resolveResourceConfigFile(resourceRoot, 'linked/secret.cfg')).toMatchObject({
            ok: false,
            status: 403,
        });
    });

    it('rejects symlinked files', async () => {
        const linkPath = path.join(resourceRoot, 'linked.cfg');
        if (!(await tryLinkFile(path.join(outsideDir, 'secret.cfg'), linkPath))) return;
        expect(await resolveResourceConfigFile(resourceRoot, 'linked.cfg')).toMatchObject({ ok: false, status: 403 });
    });

    it('rejects oversized files', async () => {
        await writeFile(path.join(resourceRoot, 'huge.json'), Buffer.alloc(MAX_RESOURCE_CONFIG_FILE_BYTES + 1, 0x20));
        expect(await resolveResourceConfigFile(resourceRoot, 'huge.json')).toMatchObject({ ok: false, status: 413 });
    });
});

describe('listResourceConfigFiles', () => {
    it('lists only allowlisted files and never follows links', async () => {
        await linkDir(outsideDir, path.join(resourceRoot, 'linked'));
        await writeFile(path.join(resourceRoot, 'huge.json'), Buffer.alloc(MAX_RESOURCE_CONFIG_FILE_BYTES + 1, 0x20));

        const { files, truncated } = await listResourceConfigFiles(resourceRoot);
        expect(truncated).toBe(false);
        expect(files.map((f) => f.path).sort()).toEqual([
            'config.lua',
            'config/client.lua',
            'data/items.json',
            'huge.json',
            'settings.cfg',
            'shared/sh_config.lua',
        ]);
        expect(files.find((f) => f.path === 'huge.json')?.tooLarge).toBe(true);
        expect(files.find((f) => f.path === 'config.lua')?.tooLarge).toBe(false);
    });
});

describe('writeResourceConfigFile', () => {
    it('overwrites the file and keeps a backup of the previous contents', async () => {
        const target = path.join(resourceRoot, 'config.lua');
        const result = await writeResourceConfigFile(target, 'Config = { a = 1 }\n');
        expect(result).toEqual({ ok: true, backupPath: `${target}.bkp` });
        expect(await fsp.readFile(target, 'utf8')).toBe('Config = { a = 1 }\n');
        expect(await fsp.readFile(`${target}.bkp`, 'utf8')).toBe('Config = {}\n');
    });

    it('preserves CRLF line endings when the editor submits LF', async () => {
        const target = path.join(resourceRoot, 'settings.cfg');
        await fsp.writeFile(target, 'set a b\r\nset c d\r\n');
        await writeResourceConfigFile(target, 'set a 1\nset c 2\n');
        expect(await fsp.readFile(target, 'utf8')).toBe('set a 1\r\nset c 2\r\n');
    });

    it('rejects non-text and oversized contents without touching the file', async () => {
        const target = path.join(resourceRoot, 'config.lua');
        expect((await writeResourceConfigFile(target, undefined)).ok).toBe(false);
        expect((await writeResourceConfigFile(target, { length: 1 })).ok).toBe(false);
        expect((await writeResourceConfigFile(target, 'a\u0000b')).ok).toBe(false);
        expect(await writeResourceConfigFile(target, 'a'.repeat(MAX_RESOURCE_CONFIG_FILE_BYTES + 1))).toMatchObject({
            ok: false,
            status: 413,
        });
        expect(await fsp.readFile(target, 'utf8')).toBe('Config = {}\n');
    });

    it('refuses to write the backup through a link', async () => {
        const target = path.join(resourceRoot, 'config.lua');
        await linkDir(outsideDir, `${target}.bkp`);
        expect(await writeResourceConfigFile(target, 'Config = { a = 1 }\n')).toMatchObject({ ok: false, status: 409 });
        expect(await fsp.readFile(target, 'utf8')).toBe('Config = {}\n');
    });
});

describe('resource config routes', () => {
    const allPerms = ['server.cfg.editor', 'commands.resources'];

    it.each([
        ['no permissions', []],
        ['only resource control', ['commands.resources']],
        ['only the cfg editor', ['server.cfg.editor']],
        ['unrelated permissions', ['players.ban', 'console.write', 'commands.resources.download']],
    ])('denies every route with %s', async (_label, permissions) => {
        const target = path.join(resourceRoot, 'config.lua');

        const list = createMockCtx({ query: { name: 'my_res' }, permissions });
        await ResourcesConfigFiles(list.ctx);
        expect(list.sentData).toEqual([{ error: expect.stringContaining('permission') }]);

        const read = createMockCtx({ query: { name: 'my_res', file: 'config.lua' }, permissions });
        await ResourcesConfigFile(read.ctx);
        expect(read.sentData).toEqual([{ error: expect.stringContaining('permission') }]);

        const save = createMockCtx({
            body: { name: 'my_res', file: 'config.lua', contents: 'pwned' },
            permissions,
        });
        await ResourcesConfigSave(save.ctx);
        expect(save.sentData).toEqual([{ error: expect.stringContaining('permission') }]);
        expect(save.ctx.admin.logAction).not.toHaveBeenCalled();
        expect(await fsp.readFile(target, 'utf8')).toBe('Config = {}\n');
        await expect(fsp.access(`${target}.bkp`)).rejects.toThrow();
    });

    it('lists, reads and saves with both permissions, and logs the edit', async () => {
        const list = createMockCtx({ query: { name: 'my_res' }, permissions: allPerms });
        await ResourcesConfigFiles(list.ctx);
        expect(list.sentData[0].files.map((f: { path: string }) => f.path)).toContain('config.lua');
        expect(list.sentData[0].maxFileBytes).toBe(MAX_RESOURCE_CONFIG_FILE_BYTES);

        const read = createMockCtx({ query: { name: 'my_res', file: 'config.lua' }, permissions: allPerms });
        await ResourcesConfigFile(read.ctx);
        expect(read.sentData).toEqual([{ name: 'my_res', file: 'config.lua', contents: 'Config = {}\n' }]);

        const save = createMockCtx({
            body: { name: 'my_res', path: resourceRoot, file: 'config.lua', contents: 'Config = { a = 1 }\n' },
            permissions: allPerms,
        });
        await ResourcesConfigSave(save.ctx);
        expect(save.sentData).toEqual([{ success: true, file: 'config.lua', backupFile: 'config.lua.bkp' }]);
        expect(save.ctx.admin.logAction).toHaveBeenCalledWith(
            'Edited config file "config.lua" of resource "my_res"',
            'resource.config.edit',
        );
        expect(await fsp.readFile(path.join(resourceRoot, 'config.lua'), 'utf8')).toBe('Config = { a = 1 }\n');
    });

    it('rejects traversal attempts through the routes even with full permissions', async () => {
        const serverCfg = path.join(dataPath, 'server.cfg');
        const attempts = [
            { name: 'my_res', file: '../../../server.cfg' },
            { name: 'my_res', file: serverCfg },
            { name: 'my_res', file: 'server/main.lua' },
            { name: '..', file: 'server.cfg' },
            { name: '../..', file: 'server.cfg' },
            { name: 'my_res', path: dataPath, file: 'server.cfg' },
            { name: 'outside', path: outsideDir, file: 'secret.cfg' },
        ];
        for (const attempt of attempts) {
            const read = createMockCtx({ query: attempt as Record<string, string>, permissions: allPerms });
            await ResourcesConfigFile(read.ctx);
            expect(read.sentData, JSON.stringify(attempt)).toEqual([{ error: expect.any(String) }]);

            const save = createMockCtx({ body: { ...attempt, contents: 'pwned' }, permissions: allPerms });
            await ResourcesConfigSave(save.ctx);
            expect(save.sentData, JSON.stringify(attempt)).toEqual([{ error: expect.any(String) }]);
            expect(save.ctx.admin.logAction).not.toHaveBeenCalled();
        }
        expect(await fsp.readFile(serverCfg, 'utf8')).toBe('sv_licenseKey abc\n');
        expect(await fsp.readFile(path.join(outsideDir, 'secret.cfg'), 'utf8')).toBe('rcon_password hunter2\n');
    });

    it('rejects malformed save bodies', async () => {
        for (const body of [undefined, null, 'x', { name: 'my_res' }, { name: 'my_res', file: 'config.lua' }]) {
            const save = createMockCtx({ permissions: allPerms });
            save.ctx.request.body = body;
            await ResourcesConfigSave(save.ctx);
            expect(save.sentData).toEqual([{ error: expect.any(String) }]);
        }
        expect(await fsp.readFile(path.join(resourceRoot, 'config.lua'), 'utf8')).toBe('Config = {}\n');
    });
});
