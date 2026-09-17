import { useEffect, useReducer, useRef, useState } from 'react';
import React from 'react';
import { useAuthedFetcher } from '@/hooks/fetch';
import { useCsrfToken, useAdminPerms } from '@/hooks/auth';
import type { AddonPanelDescriptor } from '@shared/addonTypes';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { getSocket, joinSocketRoom, leaveSocketRoom } from '@/lib/utils';

/**
 * Loaded addon entry module — exports from the addon's panel/index.js
 */
export interface AddonPanelModule {
    /** Maps component names to React components */
    pages?: Record<string, React.ComponentType<any>>;
    widgets?: Record<string, React.ComponentType<any>>;
    settings?: React.ComponentType<any>;
}

/**
 * A fully resolved addon with its manifest + loaded module
 */
interface LoadedAddon {
    descriptor: AddonPanelDescriptor;
    module: AddonPanelModule;
    error?: string;
}

/**
 * Resolved addon page route for the router
 */
export interface AddonPageRoute {
    addonId: string;
    path: string;
    title: string;
    sidebar?: boolean;
    permission?: string;
    Component: React.ComponentType<any>;
}

/**
 * Resolved addon widget for slot injection
 */
export interface AddonWidgetEntry {
    addonId: string;
    slot: string;
    title: string;
    defaultSize?: string;
    permission?: string;
    Component: React.ComponentType<any>;
}

type AddonLoaderState = {
    addons: LoadedAddon[];
    loading: boolean;
    error: string | null;
};

type AddonLoaderAction =
    | { type: 'loading' }
    | { type: 'loaded'; addons: LoadedAddon[] }
    | { type: 'failed'; error: string };

function addonLoaderReducer(state: AddonLoaderState, action: AddonLoaderAction): AddonLoaderState {
    switch (action.type) {
        case 'loading':
            return {
                ...state,
                loading: true,
                error: null,
            };
        case 'loaded':
            if (state.addons === action.addons && !state.loading && state.error === null) {
                return state;
            }
            return {
                ...state,
                addons: action.addons,
                loading: false,
                error: null,
            };
        case 'failed':
            return {
                ...state,
                loading: false,
                error: action.error,
            };
        default:
            return state;
    }
}

function asComponentMap(input: unknown): Record<string, React.ComponentType<any>> {
    if (!input || typeof input !== 'object') return {};
    return input as Record<string, React.ComponentType<any>>;
}

function resolveNamedComponent(
    map: Record<string, React.ComponentType<any>>,
    name: string,
): React.ComponentType<any> | undefined {
    const direct = map[name];
    if (direct) return direct;

    // Legacy addons can end up with different export casing.
    const lowerName = name.toLowerCase();
    const matchedKey = Object.keys(map).find((k) => k.toLowerCase() === lowerName);
    return matchedKey ? map[matchedKey] : undefined;
}

const RESERVED_ADDON_EXPORT_KEYS = new Set(['default', 'pages', 'widgets', 'settings']);

function collectNamedComponentExports(raw: unknown): Record<string, React.ComponentType<any>> {
    if (!raw || typeof raw !== 'object') return {};

    const map: Record<string, React.ComponentType<any>> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (RESERVED_ADDON_EXPORT_KEYS.has(key)) continue;
        if (typeof value === 'function') {
            map[key] = value as React.ComponentType<any>;
        }
    }
    return map;
}

function normalizeAddonModuleExports(raw: any): AddonPanelModule {
    const rawDefault = raw?.default;
    const namedExports = collectNamedComponentExports(raw);

    let pages = asComponentMap(
        raw?.pages ??
            rawDefault?.pages ??
            // Legacy shape: module exports page components directly
            (rawDefault && typeof rawDefault === 'object' ? rawDefault : undefined),
    );

    let widgets = asComponentMap(raw?.widgets ?? rawDefault?.widgets);

    // Starter templates and older addons may export components by name only.
    if (Object.keys(pages).length === 0 && Object.keys(namedExports).length > 0) {
        pages = { ...namedExports };
    }
    if (Object.keys(widgets).length === 0 && Object.keys(namedExports).length > 0) {
        widgets = { ...namedExports };
    }

    const settings = raw?.settings ?? rawDefault?.settings;

    return {
        pages,
        widgets,
        settings,
    };
}

const SIDEBAR_COMPAT_FROM_VERSION = '0.2.2-Beta';

type ParsedVersion = {
    major: number;
    minor: number;
    patch: number;
    pre: string;
};

function parseVersion(version: string): ParsedVersion {
    const [rawCore, rawPre = ''] = String(version || '').split('-', 2);
    const [maj = '0', min = '0', pat = '0'] = rawCore.split('.');
    return {
        major: Number.parseInt(maj, 10) || 0,
        minor: Number.parseInt(min, 10) || 0,
        patch: Number.parseInt(pat, 10) || 0,
        pre: rawPre.toLowerCase(),
    };
}

function preReleaseRank(pre: string): number {
    if (!pre) return 3; // stable release
    if (pre.startsWith('rc')) return 2;
    if (pre.startsWith('beta')) return 1;
    if (pre.startsWith('alpha')) return 0;
    return 1;
}

function gteVersion(version: string, target: string): boolean {
    const a = parseVersion(version);
    const b = parseVersion(target);
    if (a.major !== b.major) return a.major > b.major;
    if (a.minor !== b.minor) return a.minor > b.minor;
    if (a.patch !== b.patch) return a.patch > b.patch;
    return preReleaseRank(a.pre) >= preReleaseRank(b.pre);
}

function normalizeAddonSidebarFlag(
    _descriptor: AddonPanelDescriptor,
    page: AddonPanelDescriptor['pages'][number],
): boolean {
    if (page.sidebar) return true;

    const sidebarGroup = String(page.sidebarGroup || '').trim();
    if (sidebarGroup.length > 0) return true;

    // Compatibility layer:
    // If the running panel is 0.2.2-Beta+, migrate legacy addon navbar behavior
    // by showing addon pages in the dedicated Addons section by default.
    // This keeps older addons working without manifest updates.
    const supportsCompat = gteVersion(window.txConsts.txaVersion, SIDEBAR_COMPAT_FROM_VERSION);
    if (!supportsCompat) return false;

    return true;
}

function getAddonFallbackPage(addonId: string, pageTitle: string, error?: string): React.ComponentType<any> {
    const msg = error || 'Unknown addon panel load error.';
    return function AddonFallbackPage() {
        return React.createElement(
            'div',
            { className: 'flex w-full flex-col gap-4' },
            React.createElement(
                'div',
                { className: 'rounded-xl border border-destructive/30 bg-destructive/5 p-4' },
                React.createElement(
                    'h2',
                    { className: 'text-destructive text-lg font-semibold' },
                    'Addon page failed to load',
                ),
                React.createElement(
                    'p',
                    { className: 'text-muted-foreground mt-1 text-sm' },
                    'Addon: ',
                    React.createElement('span', { className: 'font-mono' }, addonId),
                ),
                React.createElement(
                    'p',
                    { className: 'text-muted-foreground text-sm' },
                    'Page: ',
                    React.createElement('span', { className: 'font-medium' }, pageTitle),
                ),
                React.createElement('p', { className: 'text-muted-foreground mt-3 text-sm whitespace-pre-wrap' }, msg),
            ),
        );
    };
}

function sanitizeAddonEntryUrl(entryUrl: string): string {
    const trimmed = String(entryUrl || '').trim();
    return trimmed.split('?')[0].split('#')[0] || trimmed;
}

async function fetchAddonModuleSource(entryUrl: string): Promise<{ contentType: string; text: string }> {
    const response = await fetch(entryUrl, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: {
            Accept: 'application/javascript, text/javascript, */*;q=0.8',
        },
    });

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const text = await response.text();

    if (!response.ok) {
        throw new Error(`HTTP ${response.status} while loading addon module from ${entryUrl}`);
    }

    // Auth middleware failures can return HTML logout pages with 200.
    if (contentType.includes('text/html') || /^\s*</.test(text)) {
        throw new Error(
            `Addon module request returned HTML instead of JavaScript from ${entryUrl}. ` +
                'This usually means the request failed auth/session validation.',
        );
    }

    return { contentType, text };
}

async function importAddonSource(source: string, sourceUrl: string): Promise<any> {
    // Import the fetched source through a Blob URL so the browser still parses
    // it as an ES module without relying on string evaluation.
    const blobUrl = URL.createObjectURL(
        new Blob([`${source}\n//# sourceURL=${sourceUrl}`], { type: 'text/javascript' }),
    );

    try {
        // Addon panel entries are fetched from the backend at runtime, so this import target cannot be static.
        // react-doctor-disable-next-line react-doctor/no-dynamic-import-path
        return await import(/* @vite-ignore */ blobUrl);
    } catch (error) {
        throw new Error(`Failed to evaluate fetched addon module from ${sourceUrl}: ${(error as Error).message}`);
    } finally {
        URL.revokeObjectURL(blobUrl);
    }
}

async function importAddonEntry(entryUrl: string): Promise<any> {
    const sanitized = sanitizeAddonEntryUrl(entryUrl) || entryUrl;

    // Prefer fetch + Blob module import over direct dynamic import(). In dev mode the panel JS is
    // served by Vite on a different port than the backend. Dynamic import()
    // resolves relative URLs against the Vite module origin, which doesn't
    // have the session cookie context — the backend returns an HTML logout page
    // and the browser rejects it as a non-JS MIME type. fetch() always resolves
    // against the document origin (the backend), sends credentials correctly,
    // and lets us evaluate the fetched source as a real module.
    try {
        const { text } = await fetchAddonModuleSource(sanitized);
        return await importAddonSource(text, sanitized);
    } catch (error) {
        throw new Error(
            `Failed to load addon module from ${sanitized}. ` +
                'sxPanel panel addons must ship a bundled ESM entry file (for example panel/index.js) ' +
                `that can be fetched and evaluated directly. ${(error as Error).message}`,
        );
    }
}

// Singleton state so we don't re-fetch on every mount
let cachedAddons: LoadedAddon[] | null = null;
let loadPromise: Promise<LoadedAddon[]> | null = null;
let cacheGeneration = 0;
const addonReloadSubscribers = new Set<() => void>();
const loadedAddonStyleUrls = new Set<string>();
// Module-level token updated by the hook so the txAddonApi getter always returns the live value
let currentCsrfToken: string | null = null;

function ensureAddonPanelStyleLoaded(addonId: string, stylesUrl: string | null | undefined): void {
    const href = String(stylesUrl || '').trim();
    if (!href || loadedAddonStyleUrls.has(href)) return;

    let alreadyLinked = false;
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        alreadyLinked = !!document.querySelector(`link[rel="stylesheet"][href="${CSS.escape(href)}"]`);
    } else {
        const links = document.querySelectorAll('link[rel="stylesheet"]');
        for (const el of Array.from(links)) {
            if (el.getAttribute('href') === href || (el as HTMLLinkElement).href === href) {
                alreadyLinked = true;
                break;
            }
        }
    }
    if (alreadyLinked) {
        loadedAddonStyleUrls.add(href);
        return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.addonId = addonId;
    document.head.appendChild(link);
    loadedAddonStyleUrls.add(href);
}

/**
 * Hook to get loaded panel addons.
 * Fetches the manifest and dynamically imports addon entry scripts.
 * Returns { addons, pages, widgets, loading, error }.
 */
export function useAddonLoader() {
    const fetcher = useAuthedFetcher();
    const csrfToken = useCsrfToken();
    const [reloadGeneration, setReloadGeneration] = useState(cacheGeneration);
    const [state, dispatch] = useReducer(addonLoaderReducer, {
        addons: cachedAddons ?? [],
        loading: !cachedAddons,
        error: null,
    });
    const mountedRef = useRef(true);
    const { addons, loading, error } = state;

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    // Keep the module-level token in sync so the txAddonApi getter is never stale
    useEffect(() => {
        currentCsrfToken = csrfToken ?? null;
    }, [csrfToken]);

    useEffect(() => {
        const bumpReload = () => setReloadGeneration(cacheGeneration);
        addonReloadSubscribers.add(bumpReload);
        return () => {
            addonReloadSubscribers.delete(bumpReload);
        };
    }, []);

    useEffect(() => {
        const socket = getSocket();
        const handleAddonReload = () => {
            resetAddonCache();
        };
        socket.on('addonReloaded', handleAddonReload);
        return () => {
            socket.off('addonReloaded', handleAddonReload);
        };
    }, []);

    useEffect(() => {
        if (cachedAddons && reloadGeneration === cacheGeneration) {
            dispatch({ type: 'loaded', addons: cachedAddons });
            return;
        }

        if (loadPromise) {
            loadPromise.then((result) => {
                if (mountedRef.current) {
                    dispatch({ type: 'loaded', addons: result });
                }
            });
            return;
        }

        if (mountedRef.current) {
            dispatch({ type: 'loading' });
        }
        loadPromise = (async () => {
            try {
                const resp = await fetcher<{ addons: AddonPanelDescriptor[] }>('/addons/panel-manifest');
                if (!resp.addons || !Array.isArray(resp.addons) || resp.addons.length === 0) {
                    cachedAddons = [];
                    return [];
                }

                // Expose React and API helpers as globals so addon scripts can use them
                (window as any).React = React;
                (window as any).txAddonApi = {
                    ...(window as any).txAddonApi,
                    get csrfToken() {
                        return currentCsrfToken;
                    },
                    getHeaders: () => ({
                        'Content-Type': 'application/json',
                        'X-TxAdmin-CsrfToken': currentCsrfToken ?? '',
                    }),
                    ui: {
                        DropdownMenuItem,
                        DropdownMenuSeparator,
                    },
                    socket: {
                        get: getSocket,
                        joinRoom: joinSocketRoom,
                        leaveRoom: leaveSocketRoom,
                    },
                };

                const loaded = await Promise.all(
                    resp.addons.map(async (descriptor) => {
                        try {
                            ensureAddonPanelStyleLoaded(descriptor.id, descriptor.stylesUrl);

                            const entryUrl = descriptor.entryUrl;
                            if (!entryUrl) {
                                throw new Error(`Addon ${descriptor.id} missing panel entryUrl in manifest payload.`);
                            }

                            // Load the bundled addon entry module from the backend.
                            const mod = await importAddonEntry(entryUrl);
                            const normalized = normalizeAddonModuleExports(mod);

                            return {
                                descriptor,
                                module: {
                                    pages: normalized.pages ?? {},
                                    widgets: normalized.widgets ?? {},
                                    settings: descriptor.settingsComponent
                                        ? (resolveNamedComponent(
                                              normalized.widgets ?? {},
                                              descriptor.settingsComponent,
                                          ) ??
                                          resolveNamedComponent(normalized.pages ?? {}, descriptor.settingsComponent) ??
                                          normalized.settings ??
                                          mod?.[descriptor.settingsComponent])
                                        : undefined,
                                },
                            } satisfies LoadedAddon;
                        } catch (err) {
                            console.error(`[AddonLoader] Failed to load addon ${descriptor.id}:`, err);
                            return {
                                descriptor,
                                module: { pages: {}, widgets: {} },
                                error: (err as Error).message,
                            } satisfies LoadedAddon;
                        }
                    }),
                );

                cachedAddons = loaded;
                cacheGeneration = reloadGeneration;
                return loaded;
            } catch (err) {
                console.error('[AddonLoader] Failed to fetch addon manifest:', err);
                if (mountedRef.current) {
                    dispatch({ type: 'failed', error: (err as Error).message });
                }
                cachedAddons = [];
                cacheGeneration = reloadGeneration;
                return [];
            } finally {
                loadPromise = null;
            }
        })();

        loadPromise.then((result) => {
            if (mountedRef.current) {
                dispatch({ type: 'loaded', addons: result });
            }
        });
    }, [fetcher, reloadGeneration]);

    // Resolve pages from all loaded addons
    const pages: AddonPageRoute[] = [];
    for (const addon of addons) {
        if (!addon.descriptor.pages) continue;
        const addonId = addon.descriptor.id;
        for (const page of addon.descriptor.pages) {
            const Component =
                resolveNamedComponent(addon.module.pages ?? {}, page.component) ??
                getAddonFallbackPage(
                    addonId,
                    page.title,
                    addon.error ??
                        `Component "${page.component}" was not exported from the addon panel entry ` +
                            `(expected pages.${page.component}, default.pages.${page.component}, or a matching named export).`,
                );
            pages.push({
                addonId,
                path: `/addon/${addonId}${page.path}`,
                title: page.title,
                sidebar: normalizeAddonSidebarFlag(addon.descriptor, page),
                permission: page.permission,
                Component,
            });
        }
    }

    // Resolve widgets from all loaded addons
    const widgets: AddonWidgetEntry[] = [];
    for (const addon of addons) {
        if (!addon.descriptor.widgets) continue;
        for (const widget of addon.descriptor.widgets) {
            const Component = resolveNamedComponent(addon.module.widgets ?? {}, widget.component);
            if (!Component) continue;
            widgets.push({
                addonId: addon.descriptor.id,
                slot: widget.slot,
                title: widget.title,
                defaultSize: widget.defaultSize,
                permission: widget.permission,
                Component,
            });
        }
    }

    return { addons, pages, widgets, loading, error };
}

/**
 * Get widgets for a specific slot (filtered by permission).
 */
export function useAddonWidgets(slot: string): AddonWidgetEntry[] {
    const { widgets } = useAddonLoader();
    const { hasPerm } = useAdminPerms();
    return widgets.filter((w) => w.slot === slot && (!w.permission || hasPerm(w.permission)));
}

/**
 * Get widgets matching a slot prefix (filtered by permission).
 */
export function useAddonWidgetsByPrefix(prefix: string): AddonWidgetEntry[] {
    const { widgets } = useAddonLoader();
    const { hasPerm } = useAdminPerms();
    return widgets.filter((w) => w.slot.startsWith(prefix) && (!w.permission || hasPerm(w.permission)));
}

/**
 * Get the settings component for a specific addon, if it has one.
 */
export function useAddonSettings(addonId: string): React.ComponentType<any> | undefined {
    const { addons } = useAddonLoader();
    const addon = addons.find((a) => a.descriptor.id === addonId);
    return addon?.module.settings;
}

/**
 * Reset the addon cache (e.g. after addon approval/revocation).
 */
export function resetAddonCache() {
    cachedAddons = null;
    loadPromise = null;
    cacheGeneration += 1;
    for (const notify of addonReloadSubscribers) {
        notify();
    }
}
