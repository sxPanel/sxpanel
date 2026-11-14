/**
 * Detects which FXServer generation the NUI is currently running under, so the correct
 * NUI callback/webpipe base URL and resource name can be used.
 *
 * Gen8 (legacy FXServer) exposes the resource as `monitor` (`https://monitor`/`https://cfx-nui-monitor`).
 * Gen9 (FiveM Enhanced/cfx-server) is expected to expose it as `txadmin`
 * (`https://txadmin`/`https://cfx-nui-txadmin`) - see upstream txAdmin's `enhanced` branch.
 *
 * sxPanel's own build always names its resource `monitor` regardless of generation (see
 * scripts/build/*), so the `txadmin` origins only matter if/when that changes. Detection still
 * checks for them so origin validation (cl_main.lua) and callback URLs stay correct if it does.
 */
type NuiGenInfo = {
    resourceName: string;
    isGen9: boolean;
};

const detectNuiGen = (): NuiGenInfo => {
    try {
        const origin = window.location.origin;
        if (origin === 'https://cfx-nui-monitor' || origin === 'https://monitor' || origin === 'nui://monitor') {
            return { resourceName: 'monitor', isGen9: false };
        }
        if (origin === 'https://cfx-nui-txadmin' || origin === 'https://txadmin' || origin === 'nui://txadmin') {
            return { resourceName: 'txadmin', isGen9: true };
        }
    } catch {
        //window.location not available (eg. non-browser test environment), fall through
    }

    try {
        const nativeResName = (window as any)?.invokeNative ? (globalThis as any)?.GetParentResourceName?.() : undefined;
        if (nativeResName === 'monitor') return { resourceName: 'monitor', isGen9: false };
        if (nativeResName === 'txadmin') return { resourceName: 'txadmin', isGen9: true };
    } catch {
        //native not available, fall through
    }

    //Default: assume gen8/monitor, matching sxPanel's current always-monitor build
    return { resourceName: 'monitor', isGen9: false };
};

export const NUI_GEN = detectNuiGen();

export const NUI_CALLBACK_URL = `https://${NUI_GEN.resourceName}` as const;
export const NUI_WEBPIPE_URL = `https://${NUI_GEN.resourceName}/WebPipe` as const;
