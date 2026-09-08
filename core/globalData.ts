import os from 'node:os';
import path from 'node:path';
import slash from 'slash';

import consoleFactory, { setConsoleEnvData } from '@lib/console';
import { addLocalIpAddress } from '@lib/host/isIpAddressLocal';
import { parseFxserverVersion } from '@lib/fxserver/fxsVersionParser';
import { parseTxDevEnv, TxDevEnvType } from '@shared/txDevEnv';
import { Overwrite } from 'utility-types';
import fatalError from '@lib/fatalError';
import { getNativeVars } from './boot/getNativeVars';
import { getHostVars } from './boot/getHostVars';
import consts from '@shared/consts';
const console = consoleFactory();

/**
 * MARK: GETTING VARIABLES
 */
//Get OSType
const osTypeVar = os.type();
const isVitestRuntime = typeof process.env.VITEST === 'string';
let isWindows;
if (osTypeVar === 'Windows_NT') {
    isWindows = true;
} else if (osTypeVar === 'Linux') {
    isWindows = false;
} else if (isVitestRuntime) {
    // Allow tests to import globalData on non-production platforms (e.g. macOS dev machines).
    isWindows = false;
} else {
    fatalError.GlobalData(0, `OS type not supported: ${osTypeVar}`);
}

/**
 * MARK: HELPERS
 */
const cleanPath = (x: string) => slash(path.normalize(x));

/**
 * MARK: DEV ENV
 */
type TxDevEnvEnabledType = Overwrite<
    TxDevEnvType,
    {
        ENABLED: true;
        SRC_PATH: string; //required in core/webserver, core/getReactIndex.ts
        VITE_URL: string; //required in core/getReactIndex.ts
    }
>;
type TxDevEnvDisabledType = Overwrite<
    TxDevEnvType,
    {
        ENABLED: false;
        SRC_PATH: undefined;
        VITE_URL: undefined;
    }
>;
let _txDevEnv: TxDevEnvEnabledType | TxDevEnvDisabledType;
const devVars = parseTxDevEnv();
if (devVars.ENABLED) {
    console.debug('Starting sxPanel in DEV mode.');
    if (!devVars.SRC_PATH || !devVars.VITE_URL) {
        fatalError.GlobalData(8, 'Missing TXDEV_VITE_URL and/or TXDEV_SRC_PATH env variables.');
    }
    _txDevEnv = devVars as TxDevEnvEnabledType;
} else {
    _txDevEnv = {
        ...devVars,
        SRC_PATH: undefined,
        VITE_URL: undefined,
    } as TxDevEnvDisabledType;
}

/**
 * MARK: CHECK HOST VARS
 */
const nativeVars = getNativeVars();

//Getting fxserver version
//4380 = GetVehicleType was exposed server-side
//4548 = more or less when node v16 was added
//4574 = add missing PRINT_STRUCTURED_TRACE declaration
//4574 = add resource field to PRINT_STRUCTURED_TRACE
//5894 = CREATE_VEHICLE_SERVER_SETTER
//6185 = added ScanResourceRoot (not yet in use)
//6508 = unhandledRejection is now handlable, we need this due to discord.js's bug
//8495 = changed prometheus::Histogram::BucketBoundaries
//9423 = feat(server): add more infos to playerDropped event
//9655 = Fixed ScanResourceRoot + latent events
const minFxsVersion = 5894;
const fxsVerParsed = parseFxserverVersion(nativeVars.fxsVersion);
const fxsVersion = fxsVerParsed.valid ? fxsVerParsed.build : 99999;
if (!fxsVerParsed.valid) {
    console.error('It looks like you are running a custom build of fxserver.');
    console.error('And because of that, there is no guarantee that sxPanel will work properly.');
    console.error(`Convar: ${nativeVars.fxsVersion}`);
    console.error(`Parsed Build: ${fxsVerParsed.build}`);
    console.error(`Parsed Branch: ${fxsVerParsed.branch}`);
    console.error(`Parsed Platform: ${fxsVerParsed.platform}`);
} else if (fxsVerParsed.build < minFxsVersion) {
    fatalError.GlobalData(2, [
        'This version of FXServer is too outdated and NOT compatible with sxPanel',
        ['Current FXServer version', fxsVerParsed.build.toString()],
        ['Minimum required version', minFxsVersion.toString()],
        'Please update your FXServer to a newer version.',
    ]);
} else if (fxsVerParsed.branch !== 'master') {
    console.warn(`You are running a custom branch of FXServer: ${fxsVerParsed.branch}`);
}

//The build-number check above is about game-native availability, and custom/unparseable
//builds bypass it entirely. JS runtime capability is a separate, orthogonal concern - checked
//directly via process.versions.node (the actual embedded Node) rather than a guessed build
//number, so this stays correct regardless of which FXServer build ships which Node version.
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (Number.isNaN(nodeMajor) || nodeMajor < 18) {
    fatalError.GlobalData(9, [
        'This FXServer build ships a JS runtime too old to run sxPanel.',
        ['Current FXServer version', String(fxsVerParsed.build ?? nativeVars.fxsVersion)],
        ['Node version', process.versions.node],
        ['Minimum required Node version', '18'],
        'Please update your FXServer to a newer version.',
    ]);
}

//Getting sxPanel version
if (!nativeVars.txaResourceVersion) {
    fatalError.GlobalData(3, [
        'sxPanel version not set or in the wrong format.',
        ['Detected version', nativeVars.txaResourceVersion],
    ]);
}
const txaVersion = nativeVars.txaResourceVersion;

//Get sxPanel Resource Path
if (!nativeVars.txaResourcePath) {
    fatalError.GlobalData(4, ['Could not resolve sxPanel resource path.', ['Convar', nativeVars.txaResourcePath]]);
}
const txaPath = cleanPath(nativeVars.txaResourcePath);

//Get citizen Root
if (!nativeVars.fxsCitizenRoot) {
    fatalError.GlobalData(5, ['citizen_root convar not set', ['Convar', nativeVars.fxsCitizenRoot]]);
}
const fxsPath = cleanPath(nativeVars.fxsCitizenRoot as string);

//Check if server is inside WinRar's temp folder
if (isWindows && /Temp[\\/]+Rar\$/i.test(fxsPath)) {
    fatalError.GlobalData(12, [
        'It looks like you ran FXServer inside WinRAR without extracting it first.',
        'Please extract the server files to a proper folder before running it.',
        ['Server path', fxsPath.replace(/\\/g, '/').replace(/\/$/, '')],
    ]);
}

//Setting the variables in console without it having to importing from here (circular dependency)
setConsoleEnvData(txaVersion, txaPath, _txDevEnv.ENABLED, _txDevEnv.VERBOSE);

/**
 * MARK: TXDATA & PROFILE
 */
const hostVars = getHostVars();
//Setting data path
let hasCustomDataPath = false;
let dataPath = cleanPath(path.join(fxsPath, isWindows ? '..' : '../../../', 'txData'));
if (hostVars.DATA_PATH) {
    hasCustomDataPath = true;
    dataPath = cleanPath(hostVars.DATA_PATH);
}

//Check paths for non-ASCII characters
//NOTE: Non-ASCII in one of those paths (don't know which) will make NodeJS crash due to a bug in v8 (or something)
//      when running localization methods like Date.toLocaleString().
//      There was also an issue with the slash() lib and with the +exec on FXServer
const nonASCIIRegex = /[^\x00-\x80]+/;
if (nonASCIIRegex.test(fxsPath) || nonASCIIRegex.test(dataPath)) {
    fatalError.GlobalData(7, [
        'Due to environmental restrictions, your paths CANNOT contain non-ASCII characters.',
        'Example of non-ASCII characters: çâýå, ρέθ, ñäé, ēļæ, глж, เซิร์, 警告.',
        'Please make sure FXServer is not in a path contaning those characters.',
        `If on windows, we suggest you moving the artifact to "C:/fivemserver/${fxsVersion}/".`,
        ['FXServer path', fxsPath],
        ['txData path', dataPath],
    ]);
}

//Profile - not available as env var
let profileVar = nativeVars.txAdminProfile;
if (profileVar) {
    profileVar = profileVar.replace(/[^a-z0-9._-]/gi, '');
    if (profileVar.endsWith('.base')) {
        fatalError.GlobalData(13, [
            ['Invalid server profile name', profileVar],
            'Profile names cannot end with ".base".',
            'It looks like you are trying to point to a server folder instead of a profile.',
        ]);
    }
    if (!profileVar.length) {
        fatalError.GlobalData(14, [
            'Invalid server profile name.',
            'If you are using Google Translator on the instructions page,',
            'make sure there are no additional spaces in your command.',
        ]);
    }
}
const profileName = profileVar ?? 'default';
const profilePath = cleanPath(path.join(dataPath, profileName));

//No default, no convar/zap cfg
const txaUrl = hostVars.TXA_URL;

//sxPanel port
const txaPort = hostVars.TXA_PORT ?? 40120;

//fxserver port
const fxsPort = hostVars.FXS_PORT;

//Forced interface
const netInterface = hostVars.INTERFACE;
if (netInterface) {
    addLocalIpAddress(netInterface);
}

/**
 * MARK: GENERAL
 */
const forceGameName = hostVars.GAME_NAME;
const hostApiToken = hostVars.API_TOKEN;
const forceMaxClients = hostVars.MAX_SLOTS;
const forceQuietMode = hostVars.QUIET_MODE ?? false;
const artifactCustomDownloadEnabled = hostVars.ARTIFACT_CUSTOM_DOWNLOAD ?? true;

/**
 * MARK: PROVIDER
 */
const providerName = hostVars.PROVIDER_NAME;
const providerLogo = hostVars.PROVIDER_LOGO;

/**
 * MARK: DEFAULTS
 */
const defaultDbHost = hostVars.DEFAULT_DBHOST;
const defaultDbPort = hostVars.DEFAULT_DBPORT;
const defaultDbUser = hostVars.DEFAULT_DBUSER;
const defaultDbPass = hostVars.DEFAULT_DBPASS;
const defaultDbName = hostVars.DEFAULT_DBNAME;

//Default Master Account
type DefaultMasterAccount =
    | {
          username: string;
          fivemId?: string;
          password?: string;
      }
    | {
          username: string;
          password: string;
      }
    | undefined;
let defaultMasterAccount: DefaultMasterAccount;
const bcryptRegex = /^\$2[aby]\$[0-9]{2}\$[A-Za-z0-9./]{53}$/;
if (hostVars.DEFAULT_ACCOUNT) {
    let [username, fivemId, password] = hostVars.DEFAULT_ACCOUNT.split(':') as (string | undefined)[];
    if (username === '') username = undefined;
    if (fivemId === '') fivemId = undefined;
    if (password === '') password = undefined;

    const errArr: [string, any][] = [
        ['Username', username],
        ['FiveM ID', fivemId],
        ['Password', password],
    ];
    if (!username || !consts.regexValidFivemUsername.test(username)) {
        fatalError.GlobalData(21, [
            'Invalid default account username.',
            'It should be a valid FiveM username.',
            ...errArr,
        ]);
    }
    if (fivemId && !consts.validIdentifierParts.fivem.test(fivemId)) {
        fatalError.GlobalData(22, [
            'Invalid default account FiveM ID.',
            'It should match the number in the fivem:0000000 game identifier.',
            ...errArr,
        ]);
    }
    if (password && !bcryptRegex.test(password)) {
        fatalError.GlobalData(23, ['Invalid default account password.', 'Expected bcrypt hash.', ...errArr]);
    }
    if (!fivemId && !password) {
        fatalError.GlobalData(24, [
            'Invalid default account.',
            'Expected at least the FiveM ID or password to be present.',
            ...errArr,
        ]);
    }
    defaultMasterAccount = {
        username,
        fivemId,
        password,
    };
}

//Default cfx key
const defaultCfxKey = hostVars.DEFAULT_CFXKEY;

/**
 * MARK: FINAL SETUP
 */
const isPterodactyl = !isWindows && process.env?.TXADMIN_ENABLE === '1';

//FXServer Display Version
let fxsVersionTag = fxsVersion.toString();
if (fxsVerParsed.branch && fxsVerParsed.branch !== 'master') {
    fxsVersionTag += '-ft';
}
if (isPterodactyl) {
    fxsVersionTag += '/Ptero';
} else if (isWindows && fxsVerParsed.platform === 'windows') {
    fxsVersionTag += '/Win';
} else if (!isWindows && fxsVerParsed.platform === 'linux') {
    fxsVersionTag += '/Lin';
} else {
    fxsVersionTag += '/Unk';
}

/**
 * MARK: Exports
 */
export const txDevEnv = Object.freeze(_txDevEnv);

export const txEnv = Object.freeze({
    //Calculated
    isWindows,

    //Natives
    fxsVersionTag,
    fxsVersion,
    minFxsVersion,
    txaVersion,
    txaPath,
    fxsPath,

    //ConVar
    profileName,
    profilePath,
    profileSubPath: (...parts: string[]) => path.join(profilePath, ...parts),
});

export const txHostConfig = Object.freeze({
    //General
    dataPath,
    dataSubPath: (...parts: string[]) => path.join(dataPath, ...parts),
    hasCustomDataPath,
    forceGameName,
    forceMaxClients,
    forceQuietMode,
    artifactCustomDownloadEnabled,
    hostApiToken,

    //Networking
    txaUrl,
    txaPort,
    fxsPort,
    netInterface,

    //Provider
    providerName,
    providerLogo,
    sourceName: providerName ?? 'Host Config',

    //Defaults
    defaults: {
        account: defaultMasterAccount,
        cfxKey: defaultCfxKey,
        dbHost: defaultDbHost,
        dbPort: defaultDbPort,
        dbUser: defaultDbUser,
        dbPass: defaultDbPass,
        dbName: defaultDbName,
    },
});

//DEBUG
// console.dir(txEnv, { compact: true });
// console.dir(txDevEnv, { compact: true });
// console.dir(txHostConfig, { compact: true });

/**
 * MARK: Global Utilities
 */
import { emsg } from '@shared/emsg';
(globalThis as any).emsg = emsg;
