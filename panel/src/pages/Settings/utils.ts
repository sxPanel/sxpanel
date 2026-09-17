import { type Dispatch, type SetStateAction } from 'react';
import { dequal } from 'dequal/lite';
import { GetConfigsResp, PartialTxConfigs } from '@shared/otherTypes';

/**
 * Types
 */
export type SettingsTabInfo = {
    tabId: string; //eg. game
    tabName: string; //eg. Game
};
export type SettingsCardInfo = {
    cardId: string; //eg. game-menu
    cardName: string; //eg. Menu
    cardTitle: string; //eg. Game Menu
};

export type SettingsCardContext = SettingsTabInfo & SettingsCardInfo;

export type SettingsPageContext = {
    apiData?: GetConfigsResp;
    isReadOnly: boolean;
    isLoading: boolean;
    isSaving: boolean;
    swrError: string | undefined;
    cardPendingSave: SettingsCardContext | null;
    setCardPendingSave: Dispatch<SetStateAction<SettingsCardContext | null>>;
    saveChanges: (card: SettingsCardContext, changes: PartialTxConfigs) => Promise<void>;
    registerSaveHandler: (cardId: string, handler: () => void) => void;
    unregisterSaveHandler: (cardId: string) => void;
    triggerPendingSave: () => void;
};

export type SettingsCardProps = {
    cardCtx: SettingsCardContext;
    pageCtx: SettingsPageContext;
};

/**
 * Tabs like Game mount several settings cards at once; each runs a diff effect on every render.
 * Never clear global pending-save unless it belonged to this card, so siblings do not wipe each other.
 */
export const reconcileCardPendingSave = (
    cardCtx: SettingsCardContext,
    hasChanges: boolean,
): SetStateAction<SettingsCardContext | null> => {
    return (prev) => {
        if (hasChanges) return cardCtx;
        if (prev?.cardId === cardCtx.cardId) return null;
        return prev;
    };
};

type PageConfig = {
    scope: string;
    key: string;
    isAdvanced?: boolean;
    bakedDefault?: any;
    type: any;
};

type PageConfigs = Record<string, PageConfig>;

type InferConfigTypes<T extends PageConfigs> = {
    [K in keyof T]: any;
};

/**
 * Symbol representing the reset config action
 */
export const SYM_RESET_CONFIG = Symbol('Settings:ResetConfig');

/**
 * Helper to get the inferred type of a config object.
 */
export const getPageConfig = <T = any>(scope: string, key: string, showAdvancedState?: boolean, bakedDefault?: T) => {
    return {
        scope,
        key,
        isAdvanced: showAdvancedState,
        bakedDefault,
    } as {
        scope: string;
        key: string;
        isAdvanced: boolean;
        bakedDefault: T | undefined;
        type: T;
    };
};

/**
 * Reducer to replace a single config value in the state
 */
export const configsReducer = <T extends PageConfigs>(state: any, action: PageConfigReducerAction<any>) => {
    const typedState = state as Record<string, any>;
    const newValue =
        typeof action.configValue === 'function'
            ? action.configValue(typedState[action.configName])
            : action.configValue;
    return { ...typedState, [action.configName]: newValue } as any;
};

type PageConfigReducerActionValue<T = any> = (T | undefined) | ((prevValue: T | undefined) => T | undefined);
export type PageConfigReducerAction<T = any> = {
    configName: string;
    configValue: PageConfigReducerActionValue<T>;
};

/**
 * Helper to get an object with all the config keys set to their baked defaults
 */
export const getConfigEmptyState = <T extends PageConfigs>(pageConfigs: T): any => {
    return Object.fromEntries(Object.entries(pageConfigs).map(([k, v]) => [k, v.bakedDefault])) as InferConfigTypes<
        typeof pageConfigs
    >;
};

/**
 * Helper function to get an object with the config properties and setters
 */
const getConfigAccessor = <T = any>(
    cardId: string,
    configName: string,
    configData: PageConfig,
    apiData: GetConfigsResp | undefined,
    dispatch: React.Dispatch<PageConfigReducerAction>,
) => {
    const getApiValues = () => {
        const storedValue = apiData?.storedConfigs?.[configData.scope]?.[configData.key] as T | undefined;
        const defaultValue = apiData?.defaultConfigs?.[configData.scope]?.[configData.key] as T | undefined;
        const initialValue = storedValue !== undefined && storedValue !== null ? storedValue : defaultValue;
        return {
            storedValue,
            defaultValue,
            initialValue: initialValue as Exclude<T, null> | undefined,
        };
    };

    //Setting initial data
    const apiDataValues = getApiValues();
    if (apiData) {
        dispatch({ configName, configValue: apiDataValues.initialValue });
    }
    return {
        scope: configData.scope,
        key: configData.key,
        isAdvanced: configData.isAdvanced ?? false,
        eid: `tab-${cardId}:config:${configData.key}`,
        defaultValue: apiDataValues.defaultValue,
        initialValue: apiDataValues.initialValue,
        state: {
            set: (configValue: PageConfigReducerActionValue<T>) => dispatch({ configName, configValue }),
            discard: () => dispatch({ configName, configValue: getApiValues().initialValue }),
            default: () => dispatch({ configName, configValue: getApiValues().defaultValue }),
        },
        hasChanged: (currVal: unknown) => {
            return apiData !== undefined && !dequal(currVal, getApiValues().initialValue);
        },
    } satisfies ConfigValueAccessor;
};

type ConfigValueAccessor = {
    scope: string;
    key: string;
    isAdvanced: boolean;
    eid: string;
    defaultValue: any;
    initialValue: any;
    state: {
        set: (value: any) => void;
        discard: () => void;
        default: () => void;
    };
    hasChanged: (currVal: unknown) => boolean;
};

/**
 * Helper function to get an object with all the config accessors
 */
export const getConfigAccessors = <T extends PageConfigs>(
    cardId: string,
    pageConfigs: T,
    apiData: GetConfigsResp | undefined,
    dispatch: React.Dispatch<PageConfigReducerAction>,
): Record<string, ConfigValueAccessor> => {
    return Object.fromEntries(
        Object.entries(pageConfigs).map(([configName, configData]) => [
            configName,
            getConfigAccessor(cardId, configName, configData, apiData, dispatch),
        ]),
    ) as Record<string, ConfigValueAccessor>;
};

/**
 * Helper function to diff the current value against the stored value and return a PartialTxConfigs object
 */
export const getConfigDiff = (
    configs: Record<string, ConfigValueAccessor>,
    states: Record<string, any>,
    overwrites: Record<string, any>,
    includeAdvanced: boolean,
) => {
    const localConfigs: any = {};
    const changedConfigs: any = {};
    let hasChanges = false;
    console.groupCollapsed('Settings Diffing:');
    for (const [configName, config] of Object.entries(configs)) {
        if (config.isAdvanced && !includeAdvanced) continue; //config is hidden
        let newVal =
            configName in overwrites //overwrites take precedence - even undefined!
                ? overwrites[configName]
                : states[configName];
        if (newVal === undefined) {
            newVal = SYM_RESET_CONFIG; //NOTE: this is to make sure undefined is not treated as null
        }
        if (typeof newVal === 'string') newVal = newVal.trim();
        localConfigs[config.scope] ??= {};
        localConfigs[config.scope][config.key] = newVal;

        const hasChanged = config.hasChanged(newVal);
        if (hasChanged) {
            hasChanges = true;
            changedConfigs[config.scope] ??= {};
            changedConfigs[config.scope][config.key] = newVal;
        }
    }
    console.groupEnd();

    return {
        hasChanges,
        localConfigs: localConfigs as PartialTxConfigs,
        changedConfigs: changedConfigs as PartialTxConfigs, //NOTE: not being used
    };
};
