//NOTE: don't import anything at the root of this file or it breaks the type definitions

/**
 * MARK: sxPanel stuff
 */
type RefreshConfigFunc = import('@modules/ConfigStore/').RefreshConfigFunc;
interface GenericTxModuleInstance {
    handleConfigUpdate?: RefreshConfigFunc;
    handleShutdown?: () => void;
    timers?: ReturnType<typeof setInterval>[];
    // measureMemory?: () => { [key: string]: number };
}
declare interface GenericTxModule<T> {
    new (): InstanceType<T> & GenericTxModuleInstance;
    readonly configKeysWatched?: string[];
}

declare type TxConfigs = import('@modules/ConfigStore/schema').TxConfigs;
declare const txConfig: import('utility-types').DeepReadonly<TxConfigs>;

declare type TxCoreType = import('./txAdmin').TxCoreType;
declare const txCore: TxCoreType;

declare type TxManagerType = import('./txManager').TxManagerType;
declare const txManager: TxManagerType;

declare type TxConsole = import('./lib/console').TxConsole;
declare namespace globalThis {
    interface Console extends TxConsole {}
}

/**
 * MARK: Utilities
 */
declare function emsg(e: unknown): string;

/**
 * MARK: Natives
 * Natives extracted from https://www.npmjs.com/package/@citizenfx/server
 * I prefer extracting than importing the whole package because it's
 * easier to keep track of what natives are being used.
 *
 * To use the package, add the following line to the top of the file:
 * /// <reference types="@citizenfx/server" />
 */
declare function ExecuteCommand(commandString: string): void;
declare function GetConvar(varName: string, default_: string): string;
declare function GetCurrentResourceName(): string;
declare function GetResourceMetadata(resourceName: string, metadataKey: string, index: number): string;
declare function GetResourcePath(resourceName: string): string;
declare function IsDuplicityVersion(): boolean;
declare function PrintStructuredTrace(payload: string): void;
declare function RegisterCommand(commandName: string, handler: Function, restricted: boolean): void;
declare function ScanResourceRoot(rootPath: string, callback: (data: object) => void): boolean;
//NOTE: GetPasswordHash/VerifyPasswordHash natives intentionally not declared/used - password
//      hashing is fully JS-side (argon2id via hash-wasm, bcryptjs for legacy verification) so
//      sxPanel doesn't depend on FXServer-native password hashing being available (gen8 or gen9).

/**
 * MARK: Fixes
 */

/**
 * Injected at build time by esbuild (TX_PRERELEASE_EXPIRATION define).
 * It is always a string literal, e.g. `'1714070400000'`.
 */
declare const TX_PRERELEASE_EXPIRATION: string;

/**
 * Injected at build time by esbuild/vite (TX_RELEASE_VERSION define, see scripts/build/*.ts
 * and vitest.config.ts). Used instead of GetResourceMetadata() at runtime, since that native
 * isn't reliably available across FXServer generations (gen8 vs gen9/Enhanced).
 */
declare const TX_RELEASE_VERSION: string;
