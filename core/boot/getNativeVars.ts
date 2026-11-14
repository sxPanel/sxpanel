import { randomBytes } from 'node:crypto';

//Helper function to get convars WITHOUT a fallback value.
//Sentinel must be unpredictable — if a convar can be crafted to equal the
//sentinel, the getter will falsely report it as unset.
//NOTE: the GetConvar native is not reliably callable on FXServer gen9 (FiveM Enhanced) at this
//      point in boot - guarded here instead of crashing, since ConVar-based config is gen8-only
//      either way (see globalData.ts for how gen9 resolves version/resource name/path instead).
const undefinedKey = 'UNDEFINED:CONVAR:' + randomBytes(16).toString('base64url');
const getConvarString = (convarName: string) => {
    if (typeof GetConvar !== 'function') return undefined;
    const cvar = GetConvar(convarName, undefinedKey);
    return cvar !== undefinedKey ? cvar.trim() : undefined;
};

//Deprecated ConVars and their TXHOST_* replacements
const deprecatedConvars: Record<string, string> = {
    txDataPath: 'TXHOST_DATA_PATH',
    txAdminPort: 'TXHOST_TXA_PORT',
    txAdminInterface: 'TXHOST_INTERFACE',
};

/**
 * Native variables that are required for the boot process.
 * This file is not supposed to validate or default any of the values.
 */
export const getNativeVars = () => {
    let anyWarnSent = false;

    //FXServer
    const fxsVersion = getConvarString('version');
    const fxsCitizenRoot = getConvarString('citizen_root');

    //Profile Convar - with warning
    const txAdminProfile = getConvarString('serverProfile');
    if (txAdminProfile) {
        console.warn(`WARNING: The 'serverProfile' ConVar is deprecated and will be removed in a future update.`);
        console.warn(`         To create multiple servers, set up a different TXHOST_DATA_PATH instead.`);
        anyWarnSent = true;
    }

    //Check for deprecated ConVars that are no longer used
    for (const [convarName, envVarName] of Object.entries(deprecatedConvars)) {
        if (getConvarString(convarName) !== undefined) {
            console.warn(`WARNING: The '${convarName}' ConVar has been deprecated and is no longer used by sxPanel.`);
            console.warn(`         Please use the '${envVarName}' environment variable instead.`);
            anyWarnSent = true;
        }
    }

    if (anyWarnSent) {
        console.warn(`WARNING: For more information: https://aka.cfx.re/txadmin-env-config`);
    }

    return {
        fxsVersion,
        fxsCitizenRoot,
        txAdminProfile,
    };
};
