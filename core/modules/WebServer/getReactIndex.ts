import crypto from 'node:crypto';
const modulename = 'WebCtxUtils';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { PANEL_FEATURE_KEYS, type InjectedTxConsts, type PanelFeatureKey, type ThemeType } from '@shared/otherTypes';
import { txEnv, txDevEnv, txHostConfig } from '@core/globalData';
import { AuthedCtx, CtxWithVars } from './ctxTypes';
import consts from '@shared/consts';
import consoleFactory from '@lib/console';
import { getConfiguredServerIconPath } from '@lib/fxserver/fxsConfigHelper';
import { setRuntimeFile } from '@lib/fxserver/runtimeFiles';
import { AuthedAdminType, checkRequestAuth, resolveEffectiveAuthedAdmin } from './authLogic';
import { isString } from '@modules/CacheStore';
import { isPathInside } from '@modules/AddonManager/addonUtils';
import { PANEL_VAR_NAME_RE, PANEL_VAR_VALUE_RE, PANEL_VAR_FORBIDDEN_RE } from './cssVarSanitize';
const console = consoleFactory(modulename);

function htmlEscape(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function safeSerialize(obj: unknown): string {
    return JSON.stringify(obj)
        .replace(/<\/script/gi, '<\\/script')
        .replace(/<!--/g, '<\\!--')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

// NOTE: it's not possible to remove the hardcoded import of the entry point in the index.html file
// even if you set the entry point manually in the vite config.
// Therefore, it was necessary to tag it with `data-prod-only` so it can be removed in dev mode.

//Consts
const serverTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

// Cap inlined panel logo size; anything larger is skipped to avoid bloating
// the index.html response with a huge base64 blob (and to bound sync I/O).
const MAX_LOGO_BYTES = 100_000;

//Cache panel index templates separately — NUI must always use the built bundle.
let htmlFileWeb: string | undefined;
let htmlFileNui: string | undefined;

const loadPanelHtmlTemplate = async (useNuiBundles: boolean): Promise<string> => {
    const useBuiltIndex = useNuiBundles || !txDevEnv.ENABLED;
    const indexPath = useBuiltIndex
        ? path.join(txEnv.txaPath, 'panel/index.html')
        : path.join(txDevEnv.SRC_PATH!, 'panel/index.html');
    const rawHtmlFile = await fsp.readFile(indexPath, 'utf-8');
    const useDevTemplate = txDevEnv.ENABLED && !useNuiBundles;
    const stripped = useDevTemplate
        ? rawHtmlFile.replaceAll(/.+data-prod-only.+\r?\n/gm, '')
        : rawHtmlFile.replaceAll(/.+data-dev-only.+\r?\n/gm, '');
    return stripped.replaceAll(/.+data-always-remove[\s\S]*?<\/script>\r?\n/gm, '');
};

// NOTE: https://vitejs.dev/guide/backend-integration.html
const viteOrigin = txDevEnv.VITE_URL ?? 'doesnt-matter';
const devModulesScript = `<script type="module">
        import { injectIntoGlobalHook } from "${viteOrigin}/@react-refresh";
        injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => (type) => type;
        window.__vite_plugin_react_preamble_installed__ = true;
    </script>
    <script type="module" src="${viteOrigin}/@vite/client"></script>
    <script type="module" src="${viteOrigin}/src/main.tsx"></script>`;

//Built-in themes - always available, not admin-editable
export const tmpDefaultTheme = 'dark';
export const tmpDefaultThemes = ['dark', 'light'];

/**
 * Addon theme compatibility layer.
 * Reads `static/theme.json` from running addons and returns:
 *  - The addon's panel CSS inlined as a <style> tag
 *  - An additional <style> tag with CSS custom properties from theme.json
 *  - HTML attributes to apply on <html> (e.g. data-addon-themer-enabled)
 *
 * This allows theme addons to style the login page and other unauthenticated
 * views without their JS needing to run and without <link> tags (which would
 * fail the webAuthMw check on unauthenticated pages).
 */
async function getAddonThemeInjection(
    nonce: string,
): Promise<{ styleTags: string[]; htmlAttrs: string; logoDataUrl: string | undefined }> {
    const empty = { styleTags: [], htmlAttrs: '', logoDataUrl: undefined };
    try {
        const allAddons = txCore.addonManager.getAllAddons();
        for (const addon of allAddons) {
            if (addon.state !== 'running') continue;

            // Use resolveAddonStaticPath for safe path resolution
            const themePath = txCore.addonManager.resolveAddonStaticPath(addon.manifest.id, 'static', 'theme.json');
            if (!themePath) continue;

            let raw: string;
            try {
                raw = await fsp.readFile(themePath, 'utf-8');
            } catch {
                continue;
            }

            let config: any;
            try {
                config = JSON.parse(raw);
            } catch {
                continue;
            }

            if (!config || config.enabled !== true) continue;

            const panelVars = config.panel;
            if (!panelVars || typeof panelVars !== 'object') continue;

            const styleTags: string[] = [];

            // 1. Inline the addon's panel CSS file (if it has one)
            if (addon.manifest.panel?.styles) {
                try {
                    const cssPath = path.join(addon.dir, addon.manifest.panel.styles);
                    // Ensure the CSS file is inside the addon directory
                    const normalizedCss = path.resolve(cssPath);
                    const normalizedDir = path.resolve(addon.dir);
                    if (isPathInside(normalizedDir, normalizedCss)) {
                        const cssContent = (await fsp.readFile(normalizedCss, 'utf-8')).replace(
                            /<\/style/gi,
                            '<\\/style',
                        );
                        styleTags.push(`<style${nonce} data-addon-id="${addon.manifest.id}">${cssContent}</style>`);
                    }
                } catch {
                    // CSS file not found or unreadable — continue with just vars
                }
            }

            // 2. Build CSS custom property declarations from theme.json
            const cssDeclarations: string[] = [];
            for (const [name, value] of Object.entries(panelVars)) {
                if (typeof name !== 'string' || typeof value !== 'string') continue;
                const safeName = name.trim();
                if (!PANEL_VAR_NAME_RE.test(safeName)) continue;
                const safeValue = value.trim();
                if (!safeValue) continue;
                if (PANEL_VAR_FORBIDDEN_RE.test(safeValue)) continue;
                if (/[;<>{}]/.test(safeValue)) continue;
                if (!PANEL_VAR_VALUE_RE.test(safeValue)) continue;
                cssDeclarations.push(`${safeName}: ${safeValue};`);
            }

            if (cssDeclarations.length > 0) {
                styleTags.push(
                    `<style${nonce}>html[data-addon-themer-enabled='true'] {\n            ${cssDeclarations.join('\n            ')}\n        }</style>`,
                );
            }

            // 3. Resolve the panel logo as a data: URI so it works without auth
            let logoDataUrl: string | undefined;
            const logoFilename = config.branding?.panelLogo;
            if (typeof logoFilename === 'string' && logoFilename.trim()) {
                const logoPath = txCore.addonManager.resolveAddonStaticPath(
                    addon.manifest.id,
                    'static',
                    logoFilename.trim(),
                );
                if (logoPath) {
                    try {
                        const logoStat = await fsp.stat(logoPath);
                        if (logoStat.size > MAX_LOGO_BYTES) {
                            console.warn(
                                `Panel logo "${logoFilename}" is ${logoStat.size} bytes (max ${MAX_LOGO_BYTES}); skipping inline.`,
                            );
                        } else {
                            const logoBytes = await fsp.readFile(logoPath);
                            const ext = path.extname(logoFilename).toLowerCase();
                            const mimeMap: Record<string, string> = {
                                '.png': 'image/png',
                                '.jpg': 'image/jpeg',
                                '.jpeg': 'image/jpeg',
                                '.gif': 'image/gif',
                                '.svg': 'image/svg+xml',
                                '.webp': 'image/webp',
                                '.ico': 'image/x-icon',
                            };
                            const mime = mimeMap[ext];
                            if (!mime) {
                                console.warn(
                                    `Panel logo "${logoFilename}" has unsupported extension "${ext}"; skipping inline.`,
                                );
                            } else {
                                logoDataUrl = `data:${mime};base64,${logoBytes.toString('base64')}`;
                            }
                        }
                    } catch {
                        /* logo file unreadable */
                    }
                }
            }

            return {
                styleTags,
                htmlAttrs: 'data-addon-themer-enabled="true"',
                logoDataUrl,
            };
        }
    } catch (error) {
        console.verbose.warn(`Failed to generate addon theme injection: ${emsg(error)}`);
    }
    return empty;
}

const MAX_INLINE_SERVER_ICON_BYTES = 100_000;
const serverIconMimeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

const buildServerIconDataUrl = (buffer: Buffer, ext: string): string | undefined => {
    const mime = serverIconMimeMap[ext.toLowerCase()];
    if (!mime || buffer.length > MAX_INLINE_SERVER_ICON_BYTES) return undefined;
    return `data:${mime};base64,${buffer.toString('base64')}`;
};

const runtimeIconFilenameRe = /^icon-[a-f0-9]{16}\.(png|jpe?g|gif|webp|svg|ico)$/i;

const readRuntimeIconDataUrl = async (filename: string | undefined): Promise<string | undefined> => {
    if (!filename || !runtimeIconFilenameRe.test(filename)) return undefined;
    try {
        const iconPath = path.join(txEnv.txaPath, '.runtime', filename);
        const buf = await fsp.readFile(iconPath);
        const ext = path.extname(filename).toLowerCase();
        return buildServerIconDataUrl(buf, ext);
    } catch {
        return undefined;
    }
};

type ServerIconInjection = {
    filename: string | undefined;
    dataUrl: string | undefined;
};

const getConfiguredRuntimeServerIcon = async (): Promise<ServerIconInjection> => {
    const cachedIconFilename = txCore.cacheStore.getTyped('fxsRuntime:iconFilename', isString);
    if (typeof txConfig.server.cfgPath !== 'string' || typeof txConfig.server.dataPath !== 'string') {
        return {
            filename: cachedIconFilename,
            dataUrl: await readRuntimeIconDataUrl(cachedIconFilename),
        };
    }

    try {
        const configuredIconPath = await getConfiguredServerIconPath(txConfig.server.cfgPath, txConfig.server.dataPath);
        if (!configuredIconPath) {
            return {
                filename: cachedIconFilename,
                dataUrl: await readRuntimeIconDataUrl(cachedIconFilename),
            };
        }

        const iconBuffer = await fsp.readFile(configuredIconPath);
        const iconExt = path.extname(configuredIconPath).toLowerCase();
        const supportedIconExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico'];
        if (!supportedIconExts.includes(iconExt)) {
            console.verbose.warn(`Unsupported server icon format "${iconExt}" from ${configuredIconPath}`);
            return {
                filename: cachedIconFilename,
                dataUrl: await readRuntimeIconDataUrl(cachedIconFilename),
            };
        }
        const iconHash = crypto
            .createHash('shake256', { outputLength: 8 })
            .update(iconBuffer)
            .digest('hex')
            .padStart(16, '0');
        const iconFilename = `icon-${iconHash}${iconExt}`;
        const runtimeIconPath = path.join(txEnv.txaPath, '.runtime', iconFilename);
        let runtimeIconExists = true;
        try {
            await fsp.access(runtimeIconPath);
        } catch {
            runtimeIconExists = false;
        }

        if (cachedIconFilename !== iconFilename || !runtimeIconExists) {
            const saved = await setRuntimeFile(iconFilename, iconBuffer);
            if (!saved) {
                return {
                    filename: cachedIconFilename,
                    dataUrl: await readRuntimeIconDataUrl(cachedIconFilename),
                };
            }
            txCore.cacheStore.set('fxsRuntime:iconFilename', iconFilename);
        }

        return {
            filename: iconFilename,
            dataUrl: buildServerIconDataUrl(iconBuffer, iconExt),
        };
    } catch (error) {
        console.verbose.warn(`Failed to load configured server icon: ${emsg(error)}`);
        return {
            filename: cachedIconFilename,
            dataUrl: await readRuntimeIconDataUrl(cachedIconFilename),
        };
    }
};

const buildFaviconLinkTag = (iconDataUrl: string | undefined, iconFilename: string | undefined): string => {
    if (iconDataUrl) {
        return `<link rel="icon" href="${iconDataUrl.replace(/"/g, '&quot;')}" id="favicon" />`;
    }
    if (iconFilename && runtimeIconFilenameRe.test(iconFilename)) {
        return `<link rel="icon" href="/.runtime/${htmlEscape(iconFilename)}" id="favicon" />`;
    }
    return `<link rel="icon" type="image/svg+xml" href="./favicon_default.svg" id="favicon" />`;
};

//NOTE: not cached - customThemes can change at runtime via the settings API
const getCustomThemesCss = (customThemes: ThemeType[]): string | null => {
    if (!customThemes.length) return null;
    const cssThemes = [];
    for (const theme of customThemes) {
        const cssVars = [];
        for (const [name, value] of Object.entries(theme.style)) {
            cssVars.push(`--${name}: ${value};`);
        }
        cssThemes.push(`.theme-${theme.id} { ${cssVars.join(' ')} }`);
    }
    return cssThemes.join('\n');
};

/**
 * Returns the react index.html file with placeholders replaced
 */
export default async function getReactIndex(ctx: CtxWithVars | AuthedCtx) {
    const useNuiBundles = !ctx.txVars.isWebInterface;

    let htmlFile: string;
    try {
        if (useNuiBundles) {
            if (!htmlFileNui) {
                htmlFileNui = await loadPanelHtmlTemplate(true);
            }
            htmlFile = htmlFileNui;
        } else if (txDevEnv.ENABLED || !htmlFileWeb) {
            htmlFileWeb = await loadPanelHtmlTemplate(false);
            htmlFile = htmlFileWeb;
        } else {
            htmlFile = htmlFileWeb;
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code == 'ENOENT') {
            return `<h1>⚠ index.html not found:</h1><pre>You probably deleted the 'citizen/system_resources/monitor/panel/index.html' file, or the folders above it.</pre>`;
        } else {
            return `<h1>⚠ index.html load error:</h1><pre>${emsg(error)}</pre>`;
        }
    }

    //Checking if already logged in
    const authResult = checkRequestAuth(ctx.request.headers, ctx.ip, ctx.txVars.isLocalRequest, ctx.sessTools);
    let authedAdmin: AuthedAdminType | false = false;
    if (authResult.success) {
        authedAdmin = await resolveEffectiveAuthedAdmin(authResult.admin);
    }

    //Preparing vars
    const basePath = ctx.txVars.isWebInterface ? '/' : consts.nuiWebpipePath;

    //Compute addon theme injection early — the logo URL goes into txConsts
    const nonce = ctx.state.cspNonce ? ` nonce="${ctx.state.cspNonce}"` : '';
    const addonThemeResult = await getAddonThemeInjection(nonce);
    const serverIcon = await getConfiguredRuntimeServerIcon();

    const injectedConsts: InjectedTxConsts = {
        //env
        fxsVersion: txEnv.fxsVersionTag,
        fxsOutdated: txCore.updateChecker.fxsUpdateData,
        fxsIsGen9: txEnv.fxsIsGen9,
        txaVersion: txEnv.txaVersion,
        txaOutdated: txCore.updateChecker.txaUpdateData,
        serverTimezone,
        isWindows: txEnv.isWindows,
        isWebInterface: ctx.txVars.isWebInterface,
        showAdvanced: txDevEnv.ENABLED || console.isVerbose,
        hasMasterAccount: txCore.adminStore.hasAdmins(true),
        defaultTheme: tmpDefaultTheme,
        customThemes: txConfig.appearance.customThemes.map(({ id, name, isDark }) => ({ id, name, isDark })),
        providerLogo: txHostConfig.providerLogo,
        providerName: txHostConfig.providerName,
        hostConfigSource: txHostConfig.sourceName,

        //Login page info
        server: {
            name: txCore.cacheStore.getTyped('fxsRuntime:projectName', isString) ?? txConfig.general.serverName,
            game: txCore.cacheStore.getTyped('fxsRuntime:gameName', isString),
            icon: serverIcon.filename,
            iconDataUrl: serverIcon.dataUrl,
            desc: txCore.cacheStore.getTyped('fxsRuntime:projectDesc', isString),
        },
        hideFxsUpdateNotification: txConfig.general.hideFxsUpdateNotification,
        allowSelfIdentifierEdit: txConfig.general.allowSelfIdentifierEdit,
        requireAdminTwoFactor: txConfig.general.requireAdminTwoFactor,
        resourceDownloadEnabled: txConfig.general.resourceDownloadEnabled,
        discordOAuthEnabled: !!(txConfig.discordBot.oauthClientId && txConfig.discordBot.oauthClientSecret),
        reportsEnabled: txConfig.gameFeatures.reportsEnabled,
        hideReportsNav: !ctx.txVars.isWebInterface || !txConfig.gameFeatures.reportsEnabled,
        panelFeatures: Object.fromEntries(
            PANEL_FEATURE_KEYS.map((key) => [key, txConfig.panelFeatures?.[key] ?? true]),
        ) as Record<PanelFeatureKey, boolean>,

        //addon permissions
        addonPermissions: txCore.adminStore.getAddonPermissions(),

        //Addon theme compatibility
        addonThemeLogo: addonThemeResult.logoDataUrl,

        //auth
        preAuth: authedAdmin && authedAdmin.getAuthData(),
    };

    //Prepare placeholders
    const replacers: { [key: string]: string } = {};
    replacers.basePath = `<base href="${basePath}">`;
    replacers.faviconLink = buildFaviconLinkTag(serverIcon.dataUrl, serverIcon.filename);
    replacers.ogTitle = `sxPanel - ${htmlEscape(txConfig.general.serverName)}`;
    replacers.ogDescripttion = `Manage & Monitor your FiveM/RedM Server with sxPanel v${txEnv.txaVersion} atop FXServer ${txEnv.fxsVersion}`;
    replacers.txConstsInjection = `<script${nonce}>window.txConsts = ${safeSerialize(injectedConsts)};</script>`;
    // Vite HMR only works in the external browser — never inject into the in-game iframe.
    replacers.devModules = txDevEnv.ENABLED && ctx.txVars.isWebInterface ? devModulesScript : '';

    //Prepare addon head tags (CSS for approved/running addons)
    //Only CSS is injected here — JS requires React globals set up by the panel app.
    //SECURITY: addon JS/CSS runs same-origin with the panel shell. Never inject
    //          <link> tags for unauthenticated visitors (e.g. on the login page)
    //          — doing so would fetch addon-controlled CSS into every request
    //          that hits index.html, broadening the attack surface.
    //          Theme CSS is instead inlined server-side below (getAddonThemeInjection).
    const addonTags: string[] = [];
    if (authedAdmin) {
        try {
            const panelManifest = txCore.addonManager.getPanelManifest();
            for (const addon of panelManifest) {
                if (addon.stylesUrl) {
                    addonTags.push(`<link rel="stylesheet" href="${addon.stylesUrl}" data-addon-id="${addon.id}">`);
                }
            }
        } catch (error) {
            console.verbose.warn(`Failed to generate addon head tags: ${emsg(error)}`);
        }
    }

    //Addon theme compatibility: inject inlined CSS + CSS vars from theme.json
    //so theming works on the login page (addon JS doesn't run there).
    for (const tag of addonThemeResult.styleTags) {
        addonTags.push(tag);
    }
    replacers.addonHeadTags = addonTags.join('\n        ');

    const customThemesCss = getCustomThemesCss(txConfig.appearance.customThemes);
    replacers.customThemesStyle = customThemesCss ? `<style${nonce}>${customThemesCss}</style>` : '';

    //Setting data attributes for addon theming (e.g. data-addon-themer-enabled)
    replacers.htmlExtraAttrs = addonThemeResult.htmlAttrs;

    //Setting the theme class from the cookie
    //NOTE: the cookie stores the custom theme's stable id, not its (renamable) name
    const themeCookie = ctx.cookies.get('fxpAdmin-theme') ?? ctx.cookies.get('txAdmin-theme');
    if (themeCookie) {
        if (tmpDefaultThemes.includes(themeCookie)) {
            replacers.htmlClasses = themeCookie;
        } else {
            const selectedCustomTheme = txConfig.appearance.customThemes.find((theme) => theme.id === themeCookie);
            if (!selectedCustomTheme) {
                replacers.htmlClasses = tmpDefaultTheme;
            } else {
                const lightDarkSelector = selectedCustomTheme.isDark ? 'dark' : 'light';
                replacers.htmlClasses = `${lightDarkSelector} theme-${selectedCustomTheme.id}`;
            }
        }
    } else {
        replacers.htmlClasses = tmpDefaultTheme;
    }

    //Replace
    let htmlOut = htmlFile;
    for (const [placeholder, value] of Object.entries(replacers)) {
        const replacerRegex = new RegExp(`(<!--\\s*)?{{${placeholder}}}(\\s*-->)?`, 'g');
        htmlOut = htmlOut.replaceAll(replacerRegex, value);
    }

    //In-game NUI: HTML document is served via WebPipe, but <script>/<link> tags cannot
    //use the fetch-based WebPipe proxy (no custom headers). Rewriting bundles to the
    //cfx-nui resource path serves them with correct MIME types from fxmanifest files.
    if (!ctx.txVars.isWebInterface) {
        htmlOut = htmlOut.replace(/ crossorigin/g, '');
        htmlOut = htmlOut.replace(/(src|href)="\.\/([^"]+)"/g, `$1="${consts.nuiPanelAssetBase}$2"`);
    }

    return htmlOut;
}
