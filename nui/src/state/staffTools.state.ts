import { atom, useAtomValue, useSetAtom } from 'jotai';
import { PlayerMode } from './playermode.state';

/**
 * Active staff toggles, mirrored from Lua (cl_base.lua `SetStaffStatus`).
 * This is the source of truth for the status strip, since most toggles
 * can also be changed through keybinds and chat commands.
 */
export interface StaffStatus {
    playerMode: PlayerMode;
    invisible: boolean;
    playerIds: boolean;
    mapBlips: boolean;
    coordsHud: boolean;
    inspector: boolean;
}

export const defaultStaffStatus: StaffStatus = {
    playerMode: PlayerMode.DEFAULT,
    invisible: false,
    playerIds: false,
    mapBlips: false,
    coordsHud: false,
    inspector: false,
};

const staffStatusState = atom<StaffStatus>(defaultStaffStatus);
export const useStaffStatusValue = () => useAtomValue(staffStatusState);
export const useSetStaffStatus = () => useSetAtom(staffStatusState);

export interface CoordsHudData {
    x: number;
    y: number;
    z: number;
    heading: number;
}

const coordsHudState = atom<CoordsHudData | false>(false);
export const useCoordsHudValue = () => useAtomValue(coordsHudState);
export const useSetCoordsHud = () => useSetAtom(coordsHudState);

export interface InspectorTarget {
    entityType: 'ped' | 'vehicle' | 'object';
    model: number;
    modelHex: string;
    archetype: string | false;
    handle: number;
    netId: number | false;
    owner: number | false;
    playerId: number | false;
    health: number;
    maxHealth: number;
    coords: { x: number; y: number; z: number };
    heading: number;
    distance: number;
    canDelete: boolean;
}

/** `false` = inspector off, `{ target: false }` = inspector on but not aiming at anything */
export type InspectorData = { target: InspectorTarget | false } | false;

const inspectorState = atom<InspectorData>(false);
export const useInspectorValue = () => useAtomValue(inspectorState);
export const useSetInspector = () => useSetAtom(inspectorState);
