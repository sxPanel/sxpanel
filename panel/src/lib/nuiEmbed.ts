import { isCefPanelEmbed } from '@/cef-compat/runtime';
import { NUI_PANEL_ASSET_BASE } from '@/lib/nuiGen';

/**
 * Helpers for when the panel SPA runs embedded inside the in-game NUI menu
 * (the "Panel" tab hosts it in a persistent iframe loaded through WebPipe).
 *
 * Counterpart: nui/src/components/PanelPage/PanelPage.tsx
 * @see panel/src/cef-compat/index.ts
 */

/** Messages sent from the embedded panel to the NUI parent window. */
export type PanelToParentMessage = { type: 'panelReady' } | { type: 'keyPassthrough'; key: 'Escape' | 'Tab' };

/**
 * Returns true when the panel is running in NUI mode inside the menu iframe.
 */
export const isEmbeddedInNuiMenu = (): boolean => isCefPanelEmbed();

/**
 * Resolves a panel public asset path for the current runtime.
 *
 * In NUI mode the HTML document is served via WebPipe but static bundles load from
 * `cfx-nui-monitor/panel/`. Absolute paths like `/logo.svg` would resolve outside
 * that tree and 404 — prefix with the NUI panel asset base instead.
 */
export const resolvePanelAssetUrl = (assetPath: string): string => {
    const normalized = assetPath.replace(/^\//, '');
    if (window.txConsts.isWebInterface) {
        return `/${normalized}`;
    }
    return `${NUI_PANEL_ASSET_BASE}${normalized}`;
};

/**
 * Posts a message to the NUI parent window.
 * NOTE: CEF reports nui:// parent origins inconsistently across versions, so
 * the target origin is '*'. The payload never carries sensitive data.
 */
export const postToNuiParent = (msg: PanelToParentMessage): void => {
    window.parent.postMessage(msg, '*');
};

const isEditableElement = (el: Element | null): boolean => {
    if (!el) return false;
    const tagName = el.tagName;
    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return true;
    return el instanceof HTMLElement && el.isContentEditable;
};

/**
 * Marks the document as running inside the menu iframe and applies viewport
 * constraints so layout matches a normal browser tab at the iframe's size.
 *
 * CEF resolves `100vh` to the monitor height, not the iframe — without this
 * the sidebar/footer detach and a document-level scrollbar appears.
 */
export const installNuiEmbedViewport = (): void => {
    document.documentElement.setAttribute('data-tx-nui-embed', '');
    document.documentElement.style.height = '100%';
    document.body.style.height = '100%';
    document.body.style.overflow = 'hidden';
};

/**
 * Forwards Escape and Tab keydowns to the NUI parent so the menu can close
 * itself or cycle tabs while focus is inside the iframe. Without this, the
 * parent's key listeners go deaf once the admin clicks inside the panel.
 */
export const installNuiEmbedKeyBridge = (): void => {
    document.addEventListener('keydown', (e: KeyboardEvent) => {
        // Respect consumers that already handled the key (e.g. Radix dialogs closing on Escape)
        if (e.defaultPrevented) return;

        if (e.code === 'Escape') {
            e.preventDefault();
            postToNuiParent({ type: 'keyPassthrough', key: 'Escape' });
        } else if (e.code === 'Tab') {
            if (isEditableElement(document.activeElement)) return;
            e.preventDefault();
            postToNuiParent({ type: 'keyPassthrough', key: 'Tab' });
        }
    });
};
