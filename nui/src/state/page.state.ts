import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai';

export enum txAdminMenuPage {
    Main,
    Players,
    Stats,
    Reports,
    PlayerModalOnly,
    //Appended so the numeric values of the pages above stay stable
    Resources,
}

export interface MenuPageFlags {
    /** Reports is gated by serverCtx */
    reportsEnabled: boolean;
    /** Resources is gated by the admin's `commands.resources` permission */
    resourcesEnabled: boolean;
}

/**
 * Returns the cycleable pages, in tab order, given the enabled optional tabs.
 * Main, Players and Stats are always enabled.
 */
export const getEnabledMenuPages = ({ reportsEnabled, resourcesEnabled }: MenuPageFlags): txAdminMenuPage[] => {
    const pages = [txAdminMenuPage.Main, txAdminMenuPage.Players, txAdminMenuPage.Stats];
    if (resourcesEnabled) pages.push(txAdminMenuPage.Resources);
    if (reportsEnabled) pages.push(txAdminMenuPage.Reports);
    return pages;
};

/**
 * Returns the next page in the Tab-key cycle, skipping disabled tabs.
 */
export const getNextMenuPage = (prevPage: txAdminMenuPage, flags: MenuPageFlags): txAdminMenuPage => {
    const pages = getEnabledMenuPages(flags);
    //indexOf() is -1 for a page outside the cycle, which wraps to Main
    return pages[(pages.indexOf(prevPage) + 1) % pages.length];
};

const pageState = atom<txAdminMenuPage>(txAdminMenuPage.Main);

export const usePage = () => useAtom(pageState);

export const useSetPage = () => useSetAtom(pageState);

export const usePageValue = () => useAtomValue(pageState);
