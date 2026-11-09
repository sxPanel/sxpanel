import { canWriteToPath, getPathFiles } from '@lib/fs';

//File created up to v7.3.2
const EMPTY_FILE_NAME = '.empty';

/**
 * Perform deployer local target path permission/emptiness checking.
 */
export const validateTargetPath = async (deployPath: string) => {
    const canCreateFolder = await canWriteToPath(deployPath);
    if (!canCreateFolder) {
        throw new Error('Path is not writable due to missing permissions or invalid path.');
    }
    try {
        const pathFiles = await getPathFiles(deployPath);
        if (pathFiles.some((x) => x.name !== EMPTY_FILE_NAME)) {
            throw new Error('This folder already exists and is not empty!');
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return true as const;
};

/**
 * Makes sure a server.cfg of a recipe that requires Steam identifiers sets sv_enforceSteamAuth.
 * Since 2026-11-04 Steam identifiers come from the Steam account linked to the player's Cfx.re account,
 * steam_webApiKey has no effect anymore, and sv_enforceSteamAuth (FXServer 38004+) is what requires them.
 * If the recipe already sets the convar (to any value), the config is left untouched.
 */
export const ensureSteamAuthEnforced = (serverCfg: string) => {
    if (/^[ \t]*(?:set[sr]?[ \t]+)?["']?sv_enforceSteamAuth\b/im.test(serverCfg)) {
        return serverCfg;
    }
    const eol = serverCfg.includes('\r\n') ? '\r\n' : '\n';
    return [
        serverCfg.trimEnd(),
        '',
        '# Deployer Note: this recipe requires Steam identifiers (needs FXServer 38004 or newer).',
        'set sv_enforceSteamAuth true',
        '',
    ].join(eol);
};

/**
 * Create a template recipe file
 */
export const makeTemplateRecipe = (serverName: string, author: string) =>
    [
        `name: ${serverName}`,
        `author: ${author}`,
        '',
        "# This is just a placeholder, please don't use it!",
        'tasks: ',
        '    - action: waste_time',
        '      seconds: 5',
        '    - action: waste_time',
        '      seconds: 5',
    ].join('\n');
