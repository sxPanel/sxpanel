import { usePushPlayerDropEvent } from '@/pages/Dashboard/dashboardAtoms';
import { globalStatusAtom } from '@/hooks/status';
import { PlayerlistEventType, PlayerlistPlayerType, TagDefinition } from '@shared/socketioTypes';
import { atom, useSetAtom } from 'jotai';

/**
 * Atoms
 */
export const playerlistAtom = atom<PlayerlistPlayerType[]>([]);
/**
 * Whether we've received at least one `fullPlayerlist` event since connecting.
 * Used to gate the `statusCount` fallback below - once the live playerlist is
 * initialized it is immediately consistent with the rendered tiles, whereas
 * globalStatusAtom's `server.playerCount` is only re-pushed on a 5s interval
 * (see txManager.ts) and can lag behind a restart/kick-all/mass-drop for a
 * few seconds, showing a stale higher count than the (correct, empty) list.
 */
export const playerlistInitializedAtom = atom(false);
export const playerCountAtom = atom((get) => {
    const listCount = get(playerlistAtom).length;
    if (get(playerlistInitializedAtom)) return listCount;

    // Pre-initialization (e.g. right after connecting, before the first
    // fullPlayerlist snapshot arrives): fall back to the polled status count
    // so the badge doesn't flash 0 while the live list is still loading.
    const statusCount = get(globalStatusAtom)?.server.playerCount;
    if (typeof statusCount === 'number') return Math.max(listCount, statusCount);
    return listCount;
});
export const serverMutexAtom = atom<string | null>(null);
export const tagDefinitionsAtom = atom<TagDefinition[]>([]);

/**
 * Hooks
 */
export const useProcessPlayerlistEvents = () => {
    const pushPlayerDropEvent = usePushPlayerDropEvent();
    const setPlayerlist = useSetAtom(playerlistAtom);
    const setServerMutex = useSetAtom(serverMutexAtom);
    const setTagDefinitions = useSetAtom(tagDefinitionsAtom);
    const setPlayerlistInitialized = useSetAtom(playerlistInitializedAtom);

    return (events: PlayerlistEventType[]) => {
        //If there is a fullPlayerlist, skip everything before it
        const fullListIndex = events.findIndex((e) => e.type === 'fullPlayerlist');
        if (fullListIndex > 0) events = events.slice(fullListIndex);

        //Process events
        for (const event of events) {
            if (event.type === 'fullPlayerlist') {
                setPlayerlist(event.playerlist);
                setServerMutex(event.mutex);
                setPlayerlistInitialized(true);
                if (event.tagDefinitions) {
                    setTagDefinitions(event.tagDefinitions);
                }
            } else if (event.type === 'playerJoining') {
                setPlayerlist((oldList) => [...oldList, event]);
            } else if (event.type === 'playerDropped') {
                setPlayerlist((oldList) => oldList.filter((p) => p.netid !== event.netid));
                if (event.reasonCategory) pushPlayerDropEvent(event.reasonCategory);
            } else {
                console.error('Unknown playerlist event type', event);
            }
        }
    };
};

//Getter for the server mutex
// const getCurrentMutex = useAtomCallback(
//     useCallback((get) => {
//         return get(serverMutexAtom)
//     }, []),
// );
