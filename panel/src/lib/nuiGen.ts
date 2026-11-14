/**
 * Detects which FXServer generation the panel is currently running under, when embedded
 * inside the in-game NUI menu iframe (see nuiEmbed.ts). Mirrors nui/src/utils/nuiGen.ts -
 * duplicated rather than shared because nui/ and panel/ are separate Vite bundles.
 *
 * Gen8 (legacy FXServer) exposes the resource as `monitor` (`https://monitor`/`https://cfx-nui-monitor`).
 * Gen9 (FiveM Enhanced/cfx-server) is expected to expose it as `txadmin`
 * (`https://txadmin`/`https://cfx-nui-txadmin`) - see upstream txAdmin's `enhanced` branch.
 *
 * sxPanel's own build always names its resource `monitor` regardless of generation, so the
 * `txadmin` origins only matter if/when that changes.
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
        //window.location not available, fall through
    }

    //Default: assume gen8/monitor, matching sxPanel's current always-monitor build
    return { resourceName: 'monitor', isGen9: false };
};

export const NUI_GEN = detectNuiGen();
export const NUI_WEBPIPE_BASE = `https://${NUI_GEN.resourceName}/WebPipe` as const;
export const NUI_PANEL_ASSET_BASE = `https://cfx-nui-${NUI_GEN.resourceName}/panel/` as const;
