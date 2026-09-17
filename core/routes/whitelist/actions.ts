const modulename = 'WebServer:WhitelistActions';
import { GenericApiResp } from '@shared/genericApiTypes';
import { now } from '@lib/misc';
import { parsePlayerId } from '@lib/player/idUtils';
import { DatabaseWhitelistRequestsType } from '@modules/Database/databaseTypes';
import { approveWhitelistRequest, denyWhitelistRequest } from '@modules/Whitelist/requestActions';
import { dispatchWhitelistWebhooks } from '@modules/Whitelist/webhooks';
import consoleFactory from '@lib/console';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
const console = consoleFactory(modulename);

const anyUndefined = (...args: any) => [...args].some((x) => typeof x === 'undefined');

export default async function WhitelistActions(ctx: AuthedCtx) {
    if (anyUndefined(ctx.params.action)) {
        return ctx.utils.error(400, 'Invalid Request');
    }
    const { table, action } = ctx.params;
    const sendTypedResp = (data: GenericApiResp) => ctx.send(data);

    if (!ctx.admin.testPermission('players.whitelist', modulename)) {
        return sendTypedResp({ error: "You don't have permission to execute this action." });
    }

    if (table === 'approvals') {
        return sendTypedResp(await handleApprovals(ctx, action));
    } else if (table === 'requests') {
        return sendTypedResp(await handleRequests(ctx, action));
    } else {
        return sendTypedResp({ error: 'unknown table' });
    }
}

async function handleApprovals(ctx: AuthedCtx, action: any): Promise<GenericApiResp> {
    if (typeof ctx.request.body?.identifier !== 'string') {
        return { error: 'identifier not specified' };
    }
    const identifier = ctx.request.body.identifier;
    const { isIdValid, idType, idValue, idlowerCased } = parsePlayerId(identifier);
    if (!isIdValid || !idType || !idValue || !idlowerCased) {
        return { error: 'Error: the provided identifier does not seem to be valid' };
    }

    if (action === 'add') {
        let playerAvatar = null;
        let playerName = idValue.length > 8 ? `${idType}...${idValue.slice(-8)}` : `${idType}:${idValue}`;
        if (idType === 'discord') {
            try {
                const { tag, avatar } = await txCore.discordBot.resolveMemberProfile(idValue);
                playerName = tag;
                playerAvatar = avatar;
            } catch (error) {
                /* discord profile unavailable */
            }
        }
        try {
            txCore.database.whitelist.registerApproval({
                identifier: idlowerCased,
                playerName,
                playerAvatar,
                tsApproved: now(),
                approvedBy: ctx.admin.name,
            });
            txCore.database.whitelist.recordEvent({
                type: 'entry.granted',
                identifier: idlowerCased,
                adminName: ctx.admin.name,
                meta: { playerName, source: 'manual' },
            });
            dispatchWhitelistWebhooks('entry.granted', {
                identifier: idlowerCased,
                adminName: ctx.admin.name,
                meta: { playerName },
            }).catch(() => {});
            txCore.fxRunner.sendEvent('whitelistPreApproval', {
                action: 'added',
                identifier: idlowerCased,
                playerName,
                adminName: ctx.admin.name,
            });
        } catch (error) {
            return { error: `Failed to save wl approval: ${emsg(error)}` };
        }
        ctx.admin.logAction(`Added whitelist approval for ${playerName}.`, 'whitelist.approval.add');
        return { success: true };
    } else if (action === 'remove') {
        try {
            txCore.database.whitelist.removeManyApprovals({ identifier: idlowerCased });
            txCore.database.whitelist.removeManyEntries({ identifier: idlowerCased });

            if (idType === 'license') {
                const srcSymbol = Symbol('removeWhitelistApproval');
                txCore.database.players.update(idValue, { tsWhitelisted: undefined }, srcSymbol);
                txCore.database.whitelist.removeManyEntries({ license: idValue });
            }

            txCore.database.whitelist.recordEvent({
                type: 'entry.revoked',
                identifier: idlowerCased,
                adminName: ctx.admin.name,
            });
            dispatchWhitelistWebhooks('entry.revoked', {
                identifier: idlowerCased,
                adminName: ctx.admin.name,
            }).catch(() => {});
            txCore.fxRunner.sendEvent('whitelistPreApproval', {
                action: 'removed',
                identifier: idlowerCased,
                adminName: ctx.admin.name,
            });
        } catch (error) {
            return { error: `Failed to remove wl approval: ${emsg(error)}` };
        }
        ctx.admin.logAction(`Removed whitelist approval from ${idlowerCased}.`, 'whitelist.approval.remove');
        return { success: true };
    } else {
        return { error: 'unknown action' };
    }
}

async function handleRequests(ctx: AuthedCtx, action: any): Promise<GenericApiResp> {
    if (action === 'deny_all') {
        const cutoff = parseInt(ctx.request.body?.newestVisible);
        if (isNaN(cutoff)) {
            return { error: 'newestVisible not specified' };
        }

        try {
            const filter = (req: DatabaseWhitelistRequestsType) => req.tsLastAttempt <= cutoff;
            const toDeny = txCore.database.whitelist.findManyRequests(filter);
            for (const req of toDeny) {
                txCore.database.whitelist.updateApplication(req.license, {
                    status: 'denied',
                    tsDecided: now(),
                    decidedBy: ctx.admin.name,
                });
                txCore.database.whitelist.recordEvent({
                    type: 'application.denied',
                    license: req.license,
                    applicationId: req.id,
                    adminName: ctx.admin.name,
                });
            }
            txCore.fxRunner.sendEvent('whitelistRequest', {
                action: 'deniedAll',
                adminName: ctx.admin.name,
            });
        } catch (error) {
            return { error: `Failed to remove all wl request: ${emsg(error)}` };
        }
        ctx.admin.logAction('Denied all whitelist requests.', 'whitelist.request.deny_all');
        return { success: true };
    }

    const reqId = ctx.request.body?.reqId;
    if (typeof reqId !== 'string' || !reqId.length) {
        return { error: 'reqId not specified' };
    }

    if (action === 'approve') {
        const result = approveWhitelistRequest(reqId, ctx.admin.name);
        if ('error' in result) return result;
        ctx.admin.logAction(`Approved whitelist request ${reqId}.`, 'whitelist.request.approve');
        return { success: true };
    } else if (action === 'deny') {
        const result = denyWhitelistRequest(reqId, ctx.admin.name);
        if ('error' in result) return result;
        ctx.admin.logAction(`Denied whitelist request ${reqId}.`, 'whitelist.request.deny');
        return { success: true };
    } else {
        return { error: 'unknown action' };
    }
}
