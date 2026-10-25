import { atom, useAtomValue, useSetAtom } from 'jotai';

// TODO: Make an enum
export type ResolvablePermission =
    | 'all_permissions'
    | 'announcement'
    | 'manage.admins'
    | 'commands.resources'
    | 'players.playermode'
    | 'players.noclip'
    | 'players.godmode'
    | 'players.superjump'
    | 'players.teleport'
    | 'players.heal'
    | 'players.ban'
    | 'players.kick'
    | 'players.direct_message'
    | 'players.warn'
    | 'players.whitelist'
    | 'players.write'
    | 'console.view'
    | 'console.write'
    | 'control.server'
    | 'server.cfg.editor'
    | 'settings.view'
    | 'settings.write'
    | 'txadmin.log.view'
    | 'server.log.view'
    | 'menu.vehicle'
    | 'menu.vehicle.spawn'
    | 'menu.vehicle.fix'
    | 'menu.vehicle.boost'
    | 'menu.vehicle.delete'
    | 'menu.clear_area'
    | 'menu.viewids'
    | 'menu.mapblips'
    | 'menu.devtools'
    | 'menu.delete_entities'
    | 'menu.staffchat'
    | 'players.spectate'
    | 'players.troll'
    | 'players.freeze'
    | 'players.invisible'
    | 'players.disarm';

const permissionState = atom<ResolvablePermission[]>([]);

export const usePermissionsValue = () => useAtomValue(permissionState);

export const useSetPermissions = () => useSetAtom(permissionState);
