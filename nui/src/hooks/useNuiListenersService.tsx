import { useSetIsMenuVisible } from '../state/visibility.state';
import { txAdminMenuPage, useSetPage } from '../state/page.state';
import { useNuiEvent } from './useNuiEvent';
import { ResolvablePermission, useSetPermissions } from '../state/permissions.state';
import { asArray } from '../utils/miscUtils';

import { ServerCtx, useSetServerCtx } from '../state/server.state';

// Passive Message Event Listeners & Handlers for global state
// Array fields are normalized because empty Lua tables arrive as `{}` objects.
export const useNuiListenerService = () => {
    const setVisible = useSetIsMenuVisible();
    const setMenuPage = useSetPage();
    const setPermsState = useSetPermissions();
    const setServerCtxState = useSetServerCtx();

    useNuiEvent<boolean>('setDebugMode', (debugMode) => {
        (window as any).__MenuDebugMode = debugMode;
    });
    useNuiEvent<boolean>('setVisible', (val) => {
        setVisible(val);
    });
    useNuiEvent<ResolvablePermission[]>('setPermissions', (perms) => {
        setPermsState(asArray<ResolvablePermission>(perms));
    });
    useNuiEvent<ServerCtx>('setServerCtx', (ctx) => {
        setServerCtxState({
            ...ctx,
            tagDefinitions: asArray(ctx.tagDefinitions),
        });
    });
    useNuiEvent<txAdminMenuPage>('setMenuPage', setMenuPage);
};
