const modulename = 'WebServer:MasterActions:Action';
import { now } from '@lib/misc';
import { GenericApiErrorResp } from '@shared/genericApiTypes';
import consoleFactory from '@lib/console';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
const console = consoleFactory(modulename);

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

const getNumberField = (value: unknown, field: string) =>
    isObjectRecord(value) && typeof value[field] === 'number' ? (value[field] as number) : null;

type RevokeWhitelistsFilter = 'all' | '30d' | '15d' | '7d';

const parseRevokeWhitelistsFilter = (body: unknown): RevokeWhitelistsFilter | null => {
    if (!isObjectRecord(body) || typeof body.filter !== 'string') return null;
    if (body.filter === 'all') return 'all';
    if (body.filter === '30d') return '30d';
    if (body.filter === '15d') return '15d';
    if (body.filter === '7d') return '7d';
    return null;
};

/**
 * Handle all the master actions... actions
 */
export default async function MasterActionsAction(ctx: AuthedCtx) {
    //Sanity check
    if (typeof ctx.params.action !== 'string') {
        return ctx.send({ error: 'Invalid Request' });
    }
    const action = ctx.params.action;

    //Check permissions
    if (!ctx.admin.testPermission('master', modulename)) {
        return ctx.send({ error: 'Only the master account has permission to view/use this page.' });
    }
    if (!ctx.txVars.isWebInterface) {
        return ctx.send({
            error: 'This functionality cannot be used by the in-game menu, please use the web version of sxPanel.',
        });
    }

    //Delegate to the specific action functions
    if (action == 'cleanDatabase') {
        return handleCleanDatabase(ctx);
    } else if (action == 'revokeWhitelists') {
        return handleRevokeWhitelists(ctx);
    } else {
        return ctx.send({ error: 'Unknown settings action.' });
    }
}

/**
 * Handle clean database request
 */
async function handleCleanDatabase(ctx: AuthedCtx) {
    //Typescript stuff
    type successResp = {
        msElapsed: number;
        playersRemoved: number;
        actionsRemoved: number;
        hwidsRemoved: number;
    };
    const sendTypedResp = (data: successResp | GenericApiErrorResp) => ctx.send(data);

    //Sanity check
    if (!isObjectRecord(ctx.request.body)) {
        return sendTypedResp({ error: 'Invalid Request' });
    }
    const playersInput = ctx.request.body.players;
    const bansInput = ctx.request.body.bans;
    const warnsInput = ctx.request.body.warns;
    const hwidsInput = ctx.request.body.hwids;
    if (
        typeof playersInput !== 'string' ||
        typeof bansInput !== 'string' ||
        typeof warnsInput !== 'string' ||
        typeof hwidsInput !== 'string'
    ) {
        return sendTypedResp({ error: 'Invalid Request' });
    }
    const players = playersInput;
    const bans = bansInput;
    const warns = warnsInput;
    const hwids = hwidsInput;
    const daySecs = 86400;
    const currTs = now();

    //Prepare filters
    let playersFilter: (item: unknown) => boolean;
    if (players === 'none') {
        playersFilter = () => false;
    } else if (players === '60d') {
        playersFilter = (item) => {
            const tsLastConnection = getNumberField(item, 'tsLastConnection');
            if (tsLastConnection === null) return false;
            const notes = isObjectRecord(item) ? item.notes : undefined;
            return tsLastConnection < currTs - 60 * daySecs && !notes;
        };
    } else if (players === '30d') {
        playersFilter = (item) => {
            const tsLastConnection = getNumberField(item, 'tsLastConnection');
            if (tsLastConnection === null) return false;
            const notes = isObjectRecord(item) ? item.notes : undefined;
            return tsLastConnection < currTs - 30 * daySecs && !notes;
        };
    } else if (players === '15d') {
        playersFilter = (item) => {
            const tsLastConnection = getNumberField(item, 'tsLastConnection');
            if (tsLastConnection === null) return false;
            const notes = isObjectRecord(item) ? item.notes : undefined;
            return tsLastConnection < currTs - 15 * daySecs && !notes;
        };
    } else {
        return sendTypedResp({ error: 'Invalid players filter type.' });
    }

    let bansFilter: (item: unknown) => boolean;
    if (bans === 'none') {
        bansFilter = () => false;
    } else if (bans === 'revoked') {
        bansFilter = (item) => isObjectRecord(item) && item.type === 'ban' && !!item.revocation;
    } else if (bans === 'revokedExpired') {
        bansFilter = (item) => {
            if (!isObjectRecord(item) || item.type !== 'ban') return false;
            const expiration = typeof item.expiration === 'number' ? item.expiration : null;
            return !!item.revocation || (expiration !== null && expiration < currTs);
        };
    } else if (bans === 'all') {
        bansFilter = (item) => isObjectRecord(item) && item.type === 'ban';
    } else {
        return sendTypedResp({ error: 'Invalid bans filter type.' });
    }

    let warnsFilter: (item: unknown) => boolean;
    if (warns === 'none') {
        warnsFilter = () => false;
    } else if (warns === 'revoked') {
        warnsFilter = (item) => isObjectRecord(item) && item.type === 'warn' && !!item.revocation;
    } else if (warns === '30d') {
        warnsFilter = (item) => {
            const timestamp = getNumberField(item, 'timestamp');
            return (
                isObjectRecord(item) && item.type === 'warn' && timestamp !== null && timestamp < currTs - 30 * daySecs
            );
        };
    } else if (warns === '15d') {
        warnsFilter = (item) => {
            const timestamp = getNumberField(item, 'timestamp');
            return (
                isObjectRecord(item) && item.type === 'warn' && timestamp !== null && timestamp < currTs - 15 * daySecs
            );
        };
    } else if (warns === '7d') {
        warnsFilter = (item) => {
            const timestamp = getNumberField(item, 'timestamp');
            return (
                isObjectRecord(item) && item.type === 'warn' && timestamp !== null && timestamp < currTs - 7 * daySecs
            );
        };
    } else if (warns === 'all') {
        warnsFilter = (item) => isObjectRecord(item) && item.type === 'warn';
    } else {
        return sendTypedResp({ error: 'Invalid warns filter type.' });
    }

    const actionsFilter = (x: unknown) => {
        return bansFilter(x) || warnsFilter(x);
    };

    let hwidsWipePlayers: boolean;
    let hwidsWipeBans: boolean;
    if (hwids === 'none') {
        hwidsWipePlayers = false;
        hwidsWipeBans = false;
    } else if (hwids === 'players') {
        hwidsWipePlayers = true;
        hwidsWipeBans = false;
    } else if (hwids === 'bans') {
        hwidsWipePlayers = false;
        hwidsWipeBans = true;
    } else if (hwids === 'all') {
        hwidsWipePlayers = true;
        hwidsWipeBans = true;
    } else {
        return sendTypedResp({ error: 'Invalid HWIDs filter type.' });
    }

    //Run db cleaner
    const tsStart = Date.now();
    let playersRemoved = 0;
    try {
        playersRemoved = txCore.database.cleanup.bulkRemove('players', playersFilter);
    } catch (error) {
        return sendTypedResp({ error: `<b>Failed to clean players with error:</b><br>${emsg(error)}` });
    }

    let actionsRemoved = 0;
    try {
        actionsRemoved = txCore.database.cleanup.bulkRemove('actions', actionsFilter);
    } catch (error) {
        return sendTypedResp({ error: `<b>Failed to clean actions with error:</b><br>${emsg(error)}` });
    }

    let hwidsRemoved = 0;
    try {
        hwidsRemoved = txCore.database.cleanup.wipeHwids(hwidsWipePlayers, hwidsWipeBans);
    } catch (error) {
        return sendTypedResp({ error: `<b>Failed to clean HWIDs with error:</b><br>${emsg(error)}` });
    }

    //Return results
    const msElapsed = Date.now() - tsStart;
    return sendTypedResp({ msElapsed, playersRemoved, actionsRemoved, hwidsRemoved });
}

/**
 * Handle clean database request
 */
async function handleRevokeWhitelists(ctx: AuthedCtx) {
    //Typescript stuff
    type successResp = {
        msElapsed: number;
        cntRemoved: number;
    };
    const sendTypedResp = (data: successResp | GenericApiErrorResp) => ctx.send(data);

    //Sanity check
    const filterInput = parseRevokeWhitelistsFilter(ctx.request.body);
    if (!filterInput) {
        return sendTypedResp({ error: 'Invalid Request' });
    }
    const daySecs = 86400;
    const currTs = now();

    let filterFunc: (item: unknown) => boolean;
    if (filterInput === 'all') {
        filterFunc = () => true;
    } else if (filterInput === '30d') {
        filterFunc = (item) => {
            const tsLastConnection = getNumberField(item, 'tsLastConnection');
            return tsLastConnection !== null && tsLastConnection < currTs - 30 * daySecs;
        };
    } else if (filterInput === '15d') {
        filterFunc = (item) => {
            const tsLastConnection = getNumberField(item, 'tsLastConnection');
            return tsLastConnection !== null && tsLastConnection < currTs - 15 * daySecs;
        };
    } else if (filterInput === '7d') {
        filterFunc = (item) => {
            const tsLastConnection = getNumberField(item, 'tsLastConnection');
            return tsLastConnection !== null && tsLastConnection < currTs - 7 * daySecs;
        };
    } else {
        return sendTypedResp({ error: 'Invalid whitelists filter type.' });
    }

    try {
        const tsStart = Date.now();
        const cntRemoved = txCore.database.players.bulkRevokeWhitelist(filterFunc);
        const msElapsed = Date.now() - tsStart;
        return sendTypedResp({ msElapsed, cntRemoved });
    } catch (error) {
        return sendTypedResp({ error: `<b>Failed to clean players with error:</b><br>${emsg(error)}` });
    }
}
