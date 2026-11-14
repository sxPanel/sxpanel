import { useEffect } from 'react';
import { fetchWebPipe } from '../utils/fetchWebPipe';
import { useIsMenuVisibleValue } from '../state/visibility.state';
import { NUI_WEBPIPE_URL } from '../utils/nuiGen';

interface AddonNuiDescriptor {
    id: string;
    name: string;
    version: string;
    entryUrl: string;
    stylesUrl: string | null;
    pages: unknown[];
}

// Singleton guard — load once per NUI lifecycle
let loaded = false;
let loadPromise: Promise<void> | null = null;

/**
 * Convert a relative addon path to a WebPipe HTTP URL.
 * FiveM resolves `files {}` globs at resource start, before server scripts
 * run, so dynamically-synced addon files aren't reachable via `nui://`.
 * Routing through the WebPipe lets CEF fetch them from the HTTP server
 * (which reads directly from the addon source directory).
 */
const WEBPIPE_PATH = NUI_WEBPIPE_URL;
function toResourceUrl(relativePath: string): string {
    return `${WEBPIPE_PATH}/${relativePath}`;
}

const getSafeAddonApiPath = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed.startsWith('/addons/')) return null;
    if (trimmed.includes('..')) return null;
    if (!/^[a-zA-Z0-9_./?=&%-]+$/.test(trimmed)) return null;
    return trimmed;
};

const getSafeAddonResourcePath = (addonId: string, value: string | null | undefined) => {
    if (!value || typeof value !== 'string') return null;
    const trimmed = value.trim().replace(/^\/+/, '');
    if (!trimmed) return null;
    if (/^[a-z]+:/i.test(trimmed)) return null;
    if (trimmed.includes('..')) return null;
    if (!/^[a-zA-Z0-9_./-]+$/.test(trimmed)) return null;
    const allowedPrefixes = [`addons/${addonId}/`, `nui/addons/${addonId}/`];
    if (!allowedPrefixes.some((prefix) => trimmed.startsWith(prefix))) return null;
    return trimmed;
};

async function loadNuiAddons(): Promise<void> {
    try {
        const resp = await fetchWebPipe<{ addons: AddonNuiDescriptor[] }>('/addons/nui-manifest');
        const addons = resp && Array.isArray(resp.addons) ? resp.addons : [];
        if (!addons.length) return;

        // Expose a minimal API for NUI addon scripts
        (window as any).txNuiAddonApi = {
            /** Get a URL to an addon's static asset (e.g. images, SVGs) */
            getStaticUrl: (addonId: string, filePath: string) => toResourceUrl(`addons/${addonId}/static/${filePath}`),
            /** Make an authenticated request to an addon API route via WebPipe */
            fetch: async (path: string, opts?: { method?: string; data?: unknown }) => {
                const safePath = getSafeAddonApiPath(path);
                if (!safePath) {
                    throw new Error('Invalid addon API path');
                }
                return fetchWebPipe(safePath as any, {
                    method: opts?.method as any,
                    data: opts?.data,
                });
            },
        };

        for (const addon of addons) {
            try {
                const appendScript = () => {
                    const safeEntryPath = getSafeAddonResourcePath(addon.id, addon.entryUrl);
                    if (!safeEntryPath) return;
                    const script = document.createElement('script');
                    script.src = toResourceUrl(safeEntryPath);
                    script.async = false;
                    script.dataset.addonId = addon.id;
                    script.onerror = () =>
                        console.error(
                            `[NuiAddonLoader] Failed to load script for addon ${addon.id}: ${addon.entryUrl}`,
                        );
                    document.head.appendChild(script);
                };

                const safeStylesPath = getSafeAddonResourcePath(addon.id, addon.stylesUrl);
                if (safeStylesPath) {
                    const link = document.createElement('link');
                    link.rel = 'stylesheet';
                    link.href = toResourceUrl(safeStylesPath);
                    link.dataset.addonId = addon.id;
                    link.onload = appendScript;
                    link.onerror = () => {
                        console.error(
                            `[NuiAddonLoader] Failed to load stylesheet for addon ${addon.id}: ${addon.stylesUrl}`,
                        );
                        appendScript();
                    };
                    document.head.appendChild(link);
                } else {
                    appendScript();
                }
            } catch (err) {
                console.error(`[NuiAddonLoader] Failed to load addon ${addon.id}:`, err);
            }
        }
    } catch (err) {
        console.error('[NuiAddonLoader] Failed to fetch NUI addon manifest:', err);
    }
}

/**
 * Hook that loads NUI addons when the menu first becomes visible.
 * The WebPipe rejects requests while the menu is hidden, so we
 * wait for the first visibility event before fetching the manifest.
 *
 * NUI hot-reload is handled server-side via `ensure monitor`, which
 * destroys and recreates the entire NUI browser — no client-side
 * reload logic needed.
 */
export function useNuiAddonLoader() {
    const isMenuVisible = useIsMenuVisibleValue();

    useEffect(() => {
        if (!isMenuVisible || loaded) return;
        if (!loadPromise) {
            loadPromise = loadNuiAddons()
                .then(() => {
                    loaded = true;
                })
                .catch((err) => {
                    console.error('[NuiAddonLoader] addon load failed, will retry on next menu open:', err);
                    loadPromise = null;
                });
        }
    }, [isMenuVisible]);
}
