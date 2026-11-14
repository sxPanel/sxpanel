import { ResolvablePermission } from '../state/permissions.state';
import { TxAdminActionRespType } from '@nui/src/components/PlayerModal/Tabs/DialogActionView';
import { VariantType } from 'notistack';

/**
 * Coerces a value that should be an array into one. Lua tables lose their
 * array-ness over the NUI bridge when empty (`{}` arrives as an object) and
 * nil fields are omitted entirely, so array-typed event payloads must be
 * normalized before reaching render code.
 */
export const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

export const userHasPerm = (perm: ResolvablePermission, permsState: ResolvablePermission[]): boolean => {
    const userPerms = asArray<ResolvablePermission>(permsState);
    return userPerms.includes(perm) || userPerms.includes('all_permissions');
};

export const formatDistance = (distance: number): string => {
    let unit = 'm';
    let roundedDistance = Math.round(distance);
    if (roundedDistance >= 1000) {
        roundedDistance = +(roundedDistance / 1000).toFixed(1);
        unit = 'km';
    }
    return `${roundedDistance.toLocaleString()} ${unit}`;
};

export const arrayRandom = <T>(arr: T[]): T => {
    return arr[Math.round(Math.random() * (arr.length - 1))];
};

const lookupTable: Record<string, VariantType> = {
    success: 'success',
    danger: 'error',
    warning: 'warning',
};
export const translateAlertType = (txAdminType: TxAdminActionRespType): VariantType => lookupTable[txAdminType];

/**
 * Returns whether we are in browser or in NUI
 **/
export const isBrowserEnv = (): boolean => !(window as any).invokeNative;

/**
 * Translates a timestamp into a localized date string
 */
export const tsToLocaleDate = (ts: number, dateStyle: any = 'long') => {
    return new Date(ts * 1000).toLocaleDateString((window as any).nuiSystemLanguages, { dateStyle });
};

/**
 * Translates a timestamp into a localized date time string
 */
export const tsToLocaleDateTime = (ts: number, dateStyle: any = 'long', timeStyle: any = 'medium') => {
    return new Date(ts * 1000).toLocaleString((window as any).nuiSystemLanguages, { dateStyle, timeStyle });
};
