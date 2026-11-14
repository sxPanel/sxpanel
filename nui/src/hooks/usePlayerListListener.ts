import { useEffect } from 'react';
import { txAdminMenuPage, usePageValue } from '../state/page.state';
import { useNuiEvent } from './useNuiEvent';
import { useSetPlayersState } from '../state/players.state';
import { fetchNui } from '../utils/fetchNui';
import cleanPlayerName from '@shared/cleanPlayerName';
import { debugLog } from '../utils/debugLog';
import type { PlayerTag } from '@shared/socketioTypes';

export enum VehicleStatus {
    Unknown = 'unknown',
    Walking = 'walking',
    Driving = 'driving',
    Flying = 'flying', //planes or heli
    Boat = 'boating',
    Biking = 'biking',
}

export interface PlayerData {
    /**
     * Players server ID
     **/
    id: number;
    /**
     * Player's display name
     **/
    displayName: string;
    /**
     * Player's name in its pure form, used for searching
     */
    pureName: string;
    /**
     * Player's vehicle status
     **/
    vType: VehicleStatus;
    /**
     * Distance in units between admin and player
     * Unknown distance due to client culling scope is passed as -1
     **/
    dist: number;
    /**
     * A non-normalized player health value
     * Integer between 0-100 or -1 if information is not available
     **/
    health: number;
    /**
     * If this player is an admin
     **/
    admin: boolean;
    /**
     * Player tags from the shared tag system
     **/
    tags: PlayerTag[];
}

export type LuaPlayerData = Omit<PlayerData, 'displayName' | 'pureName'> & { name: string };

const isResolvedPlayerName = (name: string) => name !== 'Unknown' && name !== 'unknown';

/**
 * Collapses duplicate net IDs that can appear when Lua table keys mix numbers and strings.
 * Prefers the row with a resolved display name and richer health/distance data.
 */
export const dedupePlayerListById = (playerList: PlayerData[]): PlayerData[] => {
    const deduped = new Map<number, PlayerData>();

    for (const player of playerList) {
        const id = player.id;
        if (typeof id !== 'number' || id <= 0) continue;

        const existing = deduped.get(id);
        if (!existing) {
            deduped.set(id, player);
            continue;
        }

        const existingResolved = isResolvedPlayerName(existing.displayName);
        const candidateResolved = isResolvedPlayerName(player.displayName);
        if (!existingResolved && candidateResolved) {
            deduped.set(id, player);
            continue;
        }
        if (existingResolved && !candidateResolved) {
            continue;
        }

        const existingHasHealth = existing.health > 0;
        const candidateHasHealth = player.health > 0;
        if (!existingHasHealth && candidateHasHealth) {
            deduped.set(id, player);
            continue;
        }

        const existingHasDistance = existing.dist >= 0;
        const candidateHasDistance = player.dist >= 0;
        if (!existingHasDistance && candidateHasDistance) {
            deduped.set(id, player);
        }
    }

    return Array.from(deduped.values());
};

export const usePlayerListListener = () => {
    const curPage = usePageValue();
    const setPlayerList = useSetPlayersState();

    useNuiEvent<LuaPlayerData[]>('setPlayerList', (playerList) => {
        //Empty Lua tables arrive as `{}` objects over the NUI bridge
        if (!Array.isArray(playerList)) {
            setPlayerList([]);
            return;
        }
        const newPlayerList = playerList.map((player) => {
            let displayName = 'Unknown';
            let pureName = 'unknown';
            try {
                const res = cleanPlayerName(player.name);
                displayName = res.displayName;
                pureName = res.pureName;
            } catch (error) {
                debugLog('cleanPlayerName', error);
            }
            return {
                id: player.id,
                displayName,
                pureName,
                vType: player.vType,
                dist: player.dist,
                health: player.health,
                admin: player.admin,
                tags: Array.isArray(player.tags) ? player.tags : [],
            } satisfies PlayerData;
        });
        setPlayerList(dedupePlayerListById(newPlayerList));
    });

    useEffect(() => {
        // Since our player list is never technically unmounted,
        // we target page changes as our interval entrance technique
        if (curPage !== txAdminMenuPage.Players) return;

        // Getting detailed playerlist
        fetchNui('signalPlayersPageOpen', {}, { mockResp: {} }).catch();

        // Getting detailed playerlist every 5 seconds
        const updaterInterval = window.setInterval(() => {
            fetchNui('signalPlayersPageOpen', {}, { mockResp: {} }).catch();
        }, 5000);

        return () => {
            window.clearInterval(updaterInterval);
        };
    }, [curPage]);
};
