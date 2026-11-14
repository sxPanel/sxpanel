const modulename = 'WebServer:ResourcesConfig';
import consoleFactory from '@lib/console';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
import { ResourceConfigFileResp, ResourceConfigFilesResp, ResourceConfigSaveResp } from '@shared/resourcesApiTypes';
import {
    MAX_RESOURCE_CONFIG_FILE_BYTES,
    listResourceConfigFiles,
    readResourceConfigFile,
    resolveResourceConfigFile,
    resolveResourceConfigRoot,
    writeResourceConfigFile,
} from './configFiles';
const console = consoleFactory(modulename);

/**
 * Editing files inside a resource is both a resource-management action and a
 * config-file write, so it requires the resource control permission on top of
 * the one that gates the server.cfg editor.
 */
export const RESOURCE_CONFIG_REQUIRED_PERMISSIONS = ['server.cfg.editor', 'commands.resources'] as const;

const PERMISSION_ERROR = "You don't have permission to edit resource config files.";

const hasConfigPermissions = (ctx: AuthedCtx, logDenial: boolean) => {
    return RESOURCE_CONFIG_REQUIRED_PERMISSIONS.every((perm) =>
        logDenial ? ctx.admin.testPermission(perm, modulename) : ctx.admin.hasPermission(perm),
    );
};

const getStringField = (source: unknown, key: string): unknown => {
    if (!source || typeof source !== 'object') return undefined;
    return (source as Record<string, unknown>)[key];
};

/**
 * GET /resources/config/files?name=<resource>&path=<resourcePath>
 * Lists the editable config files of a resource.
 */
export async function ResourcesConfigFiles(ctx: AuthedCtx) {
    const sendTypedResp = (data: ResourceConfigFilesResp) => ctx.send(data);
    if (!hasConfigPermissions(ctx, false)) {
        return sendTypedResp({ error: PERMISSION_ERROR });
    }

    const root = await resolveResourceConfigRoot(ctx.query.name, ctx.query.path);
    if (!root.ok) return sendTypedResp({ error: root.error });

    const { files, truncated } = await listResourceConfigFiles(root.resourceRoot);
    return sendTypedResp({ files, truncated, maxFileBytes: MAX_RESOURCE_CONFIG_FILE_BYTES });
}

/**
 * GET /resources/config/file?name=<resource>&path=<resourcePath>&file=<relative path>
 * Returns the contents of one config file.
 */
export async function ResourcesConfigFile(ctx: AuthedCtx) {
    const sendTypedResp = (data: ResourceConfigFileResp) => ctx.send(data);
    if (!hasConfigPermissions(ctx, false)) {
        return sendTypedResp({ error: PERMISSION_ERROR });
    }

    const root = await resolveResourceConfigRoot(ctx.query.name, ctx.query.path);
    if (!root.ok) return sendTypedResp({ error: root.error });

    const file = await resolveResourceConfigFile(root.resourceRoot, ctx.query.file);
    if (!file.ok) return sendTypedResp({ error: file.error });

    const read = await readResourceConfigFile(file.absPath);
    if (!read.ok) return sendTypedResp({ error: read.error });

    return sendTypedResp({ name: ctx.query.name as string, file: file.relPath, contents: read.contents });
}

/**
 * POST /resources/config/save { name, path?, file, contents }
 * Overwrites one existing config file, keeping a `.bkp` copy of the previous version.
 */
export async function ResourcesConfigSave(ctx: AuthedCtx) {
    const sendTypedResp = (data: ResourceConfigSaveResp) => ctx.send(data);
    if (!hasConfigPermissions(ctx, true)) {
        return sendTypedResp({ error: PERMISSION_ERROR });
    }

    const body = ctx.request.body;
    const resourceName = getStringField(body, 'name');
    const root = await resolveResourceConfigRoot(resourceName, getStringField(body, 'path'));
    if (!root.ok) return sendTypedResp({ error: root.error });

    const file = await resolveResourceConfigFile(root.resourceRoot, getStringField(body, 'file'));
    if (!file.ok) return sendTypedResp({ error: file.error });

    const write = await writeResourceConfigFile(file.absPath, getStringField(body, 'contents'));
    if (!write.ok) return sendTypedResp({ error: write.error });

    ctx.admin.logAction(`Edited config file "${file.relPath}" of resource "${resourceName}"`, 'resource.config.edit');
    console.warn(`Saved '${file.absPath}' by ${ctx.admin.name}`);
    return sendTypedResp({ success: true, file: file.relPath, backupFile: `${file.relPath}.bkp` });
}
