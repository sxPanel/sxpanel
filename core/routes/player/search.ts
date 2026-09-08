const modulename = 'WebServer:PlayersTableSearch';
import { PlayersTablePlayerType, PlayersTableSearchResp } from '@shared/playerApiTypes';
import { DatabaseActionType, DatabasePlayerType } from '@modules/Database/databaseTypes';
import { now } from '@lib/misc';
import consoleFactory from '@lib/console';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
import cleanPlayerName from '@shared/cleanPlayerName';
import { chain as createChain } from 'lodash-es';
import Fuse from 'fuse.js';
import { parseLaxIdsArrayInput } from '@lib/player/idUtils';
import { TimeCounter } from '@modules/Metrics/statsUtils';
import { getDisabledAutoTagIds, getValidCustomTagIds } from '@lib/player/playerTags';
const console = consoleFactory(modulename);

//Helpers
const DEFAULT_LIMIT = 100; //cant override it for now
const ALLOWED_SORTINGS = ['playTime', 'tsJoined', 'tsLastConnection'] as const;
type PlayerSortingKey = (typeof ALLOWED_SORTINGS)[number];
const isAllowedPlayerSorting = (k: string): k is PlayerSortingKey =>
    (ALLOWED_SORTINGS as readonly string[]).includes(k);
const SIMPLE_FILTERS = ['isAdmin', 'isOnline', 'isWhitelisted', 'hasNote'];
const ACTION_FILTERS = ['isBanned', 'hasPreviousBan'];

/**
 * Returns the players stats for the Players page table
 */
export default async function PlayerSearch(ctx: AuthedCtx) {
    //Sanity check
    if (typeof ctx.query === 'undefined') {
        return ctx.utils.error(400, 'Invalid Request');
    }
    const { searchValue, searchType, filters, sortingKey, sortingDesc, offsetParam, offsetLicense } = ctx.query;
    const sendTypedResp = (data: PlayersTableSearchResp) => ctx.send(data);
    const searchTime = new TimeCounter();
    const adminsIdentifiers = txCore.adminStore.getAdminsIdentifiers();
    const onlinePlayersLicenses = txCore.fxPlayerlist.getOnlinePlayersLicenses();
    const dbo = txCore.database.getDboRef();
    let chain = dbo.chain.get('players').clone(); //shallow clone to avoid sorting the original

    //sort the players by the sortingKey/sortingDesc
    const parsedSortingDesc = sortingDesc === 'true';
    if (typeof sortingKey !== 'string' || !isAllowedPlayerSorting(sortingKey)) {
        return sendTypedResp({ error: 'Invalid sorting key' });
    }
    chain = chain.sort((a, b) => {
        return parsedSortingDesc ? b[sortingKey] - a[sortingKey] : a[sortingKey] - b[sortingKey];
    });

    //filter the players by the simple filters (lightweight)
    let requestedActionFilters = new Set<string>();
    if (typeof filters === 'string' && filters.length) {
        const allRequestedFilters = filters.split(',');
        const validRequestedFilters = new Set(allRequestedFilters.filter((x) => SIMPLE_FILTERS.includes(x)));
        requestedActionFilters = new Set(allRequestedFilters.filter((x) => ACTION_FILTERS.includes(x)));
        if (validRequestedFilters.size) {
            const playerFilterFunctions = {
                isAdmin: (p: DatabasePlayerType) => p.ids.some((id) => adminsIdentifiers.includes(id)),
                isOnline: (p: DatabasePlayerType) => onlinePlayersLicenses.has(p.license),
                isWhitelisted: (p: DatabasePlayerType) => p.tsWhitelisted,
                hasNote: (p: DatabasePlayerType) => p.notes,
            };
            chain = chain.filter((p) => {
                for (const filterName of validRequestedFilters) {
                    if (!playerFilterFunctions[filterName as keyof typeof playerFilterFunctions](p)) {
                        return false;
                    }
                }
                return true;
            });
        }
    }

    //offset the players by the offsetParam/offsetLicense
    if (offsetParam !== undefined && offsetLicense !== undefined) {
        const parsedOffsetParam = parseInt(offsetParam as string);
        if (isNaN(parsedOffsetParam) || typeof offsetLicense !== 'string' || !offsetLicense.length) {
            return sendTypedResp({ error: 'Invalid offsetParam or offsetLicense' });
        }
        chain = chain.takeRightWhile((p) => {
            return p.license !== offsetLicense && parsedSortingDesc
                ? p[sortingKey] <= parsedOffsetParam
                : p[sortingKey] >= parsedOffsetParam;
        });
    }

    // filter the players by the searchValue/searchType (VERY HEAVY!)
    if (typeof searchType === 'string') {
        if (typeof searchValue !== 'string' || !searchValue.length) {
            return sendTypedResp({ error: 'Invalid searchValue' });
        }

        if (searchType === 'playerName') {
            //Searching by player name
            const { pureName } = cleanPlayerName(searchValue);
            if (pureName === 'emptyname') {
                return sendTypedResp({ error: 'This player name is unsearchable (pureName is empty).' });
            }
            const players = chain.value();
            const fuse = new Fuse(players, {
                isCaseSensitive: true, //maybe that's an optimization?!
                keys: ['pureName'],
                threshold: 0.3,
            });
            const filtered = fuse.search(pureName).map((x) => x.item);
            chain = createChain(filtered);
        } else if (searchType === 'playerNotes') {
            //Searching by player notes
            const players = chain.value();
            const fuse = new Fuse(players, {
                keys: ['notes.text'],
                threshold: 0.3,
            });
            const filtered = fuse.search(searchValue).map((x) => x.item);
            chain = createChain(filtered);
        } else if (searchType === 'playerIds') {
            //Searching by player identifiers
            const { validIds, validHwids, invalids } = parseLaxIdsArrayInput(searchValue);
            if (invalids.length) {
                return sendTypedResp({
                    error: `Invalid identifiers (${invalids.join(',')}). Prefix any identifier with their type, like 'fivem:123456' instead of just '123456'.`,
                });
            }
            if (!validIds.length && !validHwids.length) {
                return sendTypedResp({ error: `No valid identifiers found.` });
            }
            chain = chain.filter((p) => {
                if (validIds.length && !validIds.some((id) => p.ids.includes(id))) {
                    return false;
                }
                if (validHwids.length && !validHwids.some((hwid) => p.hwids.includes(hwid))) {
                    return false;
                }
                return true;
            });
        } else {
            return sendTypedResp({ error: 'Unknown searchType' });
        }
    }

    //reduce actions table to get info on currently filtered players
    type PlayerActionInfo = {
        isBanned: boolean;
        hasAnyBan: boolean;
        warnCount: number;
        banCount: number;
    };
    const currTs = now();
    const allActions = dbo.chain.get('actions').value() as DatabaseActionType[];
    const idToActionIndices = new Map<string, number[]>();
    for (let i = 0; i < allActions.length; i++) {
        for (const id of allActions[i].ids) {
            let arr = idToActionIndices.get(id);
            if (!arr) {
                arr = [];
                idToActionIndices.set(id, arr);
            }
            arr.push(i);
        }
    }
    const actionInfoCache = new Map<string, PlayerActionInfo>();
    const getPlayerActionInfo = (player: DatabasePlayerType): PlayerActionInfo => {
        const cached = actionInfoCache.get(player.license);
        if (cached) return cached;
        const seenIndices = new Set<number>();
        let isBanned = false;
        let hasAnyBan = false;
        let warnCount = 0;
        let banCount = 0;
        for (const id of player.ids) {
            const indices = idToActionIndices.get(id);
            if (!indices) continue;
            for (const idx of indices) {
                if (seenIndices.has(idx)) continue;
                seenIndices.add(idx);
                const action = allActions[idx];
                if (action.type === 'ban') {
                    hasAnyBan = true;
                    if (!action.revocation) {
                        banCount++;
                        if (action.expiration === false || action.expiration > currTs) {
                            isBanned = true;
                        }
                    }
                } else if (action.type === 'warn' && !action.revocation) {
                    warnCount++;
                }
            }
        }
        const info: PlayerActionInfo = { isBanned, hasAnyBan, warnCount, banCount };
        actionInfoCache.set(player.license, info);
        return info;
    };

    //filter players by isBanned & hasPreviousBan
    if (requestedActionFilters.size) {
        chain = chain.filter((p) => {
            const info = getPlayerActionInfo(p);
            if (requestedActionFilters.has('isBanned') && !info.isBanned) return false;
            if (requestedActionFilters.has('hasPreviousBan') && !info.hasAnyBan) return false;
            return true;
        });
    }

    //filter players by the limit - taking 1 more to check if we reached the end
    chain = chain.take(DEFAULT_LIMIT + 1);
    const players = chain.value();
    const hasReachedEnd = players.length <= DEFAULT_LIMIT;
    const disabledAutoTags = getDisabledAutoTagIds();
    const processedPlayers: PlayersTablePlayerType[] = players.slice(0, DEFAULT_LIMIT).map((p) => {
        const isAdmin = p.ids.some((id) => adminsIdentifiers.includes(id));
        const actionInfo = getPlayerActionInfo(p);
        const tags: string[] = [];
        if (!disabledAutoTags.has('staff') && isAdmin) tags.push('staff');
        const threshold = txConfig.gameFeatures.newplayerThreshold;
        if (!disabledAutoTags.has('newplayer') && threshold > 0 && p.playTime < threshold) tags.push('newplayer');
        if (!disabledAutoTags.has('problematic') && (actionInfo.banCount > 0 || actionInfo.warnCount > 0))
            tags.push('problematic');
        if (p.customTags?.length) {
            const validIds = getValidCustomTagIds();
            for (const ct of p.customTags) {
                if (validIds.has(ct)) tags.push(ct);
            }
        }
        return {
            license: p.license,
            displayName: p.displayName,
            playTime: p.playTime,
            tsJoined: p.tsJoined,
            tsLastConnection: p.tsLastConnection,
            notes: p.notes ? p.notes.text : undefined,
            tags,

            isAdmin,
            isOnline: onlinePlayersLicenses.has(p.license),
            isWhitelisted: p.tsWhitelisted ? true : false,
            isBanned: actionInfo.isBanned,
            warnCount: actionInfo.warnCount,
            banCount: actionInfo.banCount,
        };
    });

    txManager.txRuntime.playersTableSearchTime.count(searchTime.stop().milliseconds);
    return sendTypedResp({
        players: processedPlayers,
        hasReachedEnd,
    });
}
