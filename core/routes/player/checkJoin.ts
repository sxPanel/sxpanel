const modulename = 'WebServer:PlayerCheckJoin';
import { GenericApiErrorResp } from '@shared/genericApiTypes';
import { DatabaseActionBanType, DatabaseActionType } from '@modules/Database/databaseTypes';
import { anyUndefined, now } from '@lib/misc';
import { filterPlayerHwids, parsePlayerIds, summarizeIdsArray } from '@lib/player/idUtils';
import type { PlayerIdsObjectType } from '@shared/otherTypes';
import xssInstancer from '@lib/xss';
import { Unit } from 'humanize-duration';
import consoleFactory from '@lib/console';
import { TimeCounter } from '@modules/Metrics/statsUtils';
import { evaluateJoin } from '@modules/Whitelist/WhitelistService';
import { getDeferralScenarioTemplate, renderDeferralCard } from '@modules/Whitelist/deferralCard';
import { templateHasVisualLayout } from '@shared/deferralCardLayout';
import { emsg } from '@shared/emsg';
import { InitializedCtx } from '@modules/WebServer/ctxTypes';
const console = consoleFactory(modulename);
const xss = xssInstancer();

//Resp Type
type AllowRespType = {
    allow: true;
};
type DenyRespType = {
    allow: false;
    reason: string;
};
type PlayerCheckJoinApiRespType = AllowRespType | DenyRespType | GenericApiErrorResp;

/**
 * Endpoint for checking a player join, which checks whitelist and bans.
 */
export default async function PlayerCheckJoin(ctx: InitializedCtx) {
    const sendTypedResp = (data: PlayerCheckJoinApiRespType) => ctx.send(data);

    //If checking not required at all
    if (!txConfig.banlist.enabled && !txConfig.whitelist.enabled) {
        return sendTypedResp({ allow: true });
    }

    //Checking request
    if (
        anyUndefined(
            ctx.request.body,
            ctx.request.body.playerName,
            ctx.request.body.playerIds,
            ctx.request.body.playerHwids,
        )
    ) {
        return sendTypedResp({ error: 'Invalid request.' });
    }
    const { playerName, playerIds, playerHwids } = ctx.request.body;

    //Validating body data
    if (typeof playerName !== 'string') return sendTypedResp({ error: 'playerName should be an string.' });
    if (!Array.isArray(playerIds)) return sendTypedResp({ error: 'playerIds should be an array.' });
    const { validIdsArray, validIdsObject } = parsePlayerIds(playerIds);
    if (validIdsArray.length < 1)
        return sendTypedResp({ error: 'Identifiers array must contain at least 1 valid identifier.' });
    if (!Array.isArray(playerHwids)) return sendTypedResp({ error: 'playerHwids should be an array.' });
    const { validHwidsArray } = filterPlayerHwids(playerHwids);

    try {
        // If ban checking enabled
        if (txConfig.banlist.enabled) {
            const checkTime = new TimeCounter();
            const result = await checkBan(validIdsArray, validIdsObject, validHwidsArray, playerName);
            txManager.txRuntime.banCheckTime.count(checkTime.stop().milliseconds);
            if (!result.allow) return sendTypedResp(result);
        }

        const pendingDeferral = txCore.addonManager?.consumePendingAddonDeferral(validIdsObject.license);
        if (pendingDeferral) {
            const reason = await renderDeferralCard({
                scenario: pendingDeferral.scenarioId,
                body: pendingDeferral.customMessage ?? '',
                playerName: pendingDeferral.playerName ?? playerName,
                license: validIdsObject.license,
                discordId: validIdsObject.discord,
                identifiers: validIdsArray,
            });
            return sendTypedResp({ allow: false, reason });
        }

        if (txConfig.whitelist.enabled) {
            const checkTime = new TimeCounter();
            const result = await evaluateJoin({
                validIdsArray,
                validIdsObject,
                validHwidsArray,
                playerName,
            });
            txManager.txRuntime.whitelistCheckTime.count(checkTime.stop().milliseconds);
            if (!result.allow) return sendTypedResp(result);
        }

        //If not blocked by ban/wl, allow join
        // return sendTypedResp({ allow: false, reason: 'APPROVED, BUT TEMP BLOCKED (DEBUG)' });
        return sendTypedResp({ allow: true });
    } catch (error) {
        const msg = `Failed to check ban/whitelist status: ${emsg(error)}`;
        console.error(msg);
        console.verbose.dir(error);
        return sendTypedResp({ error: msg });
    }
}

/**
 * Checks if the player is banned
 */
async function checkBan(
    validIdsArray: string[],
    validIdsObject: PlayerIdsObjectType,
    validHwidsArray: string[],
    playerName: string,
): Promise<AllowRespType | DenyRespType> {
    // Check active bans on matching identifiers
    const ts = now();
    const filter = (action: DatabaseActionType): action is DatabaseActionBanType => {
        return action.type === 'ban' && (!action.expiration || action.expiration > ts) && !action.revocation;
    };
    const activeBans = txCore.database.actions.findMany(validIdsArray, validHwidsArray, filter);
    if (activeBans.length) {
        const ban = activeBans[0];

        //Translation keys
        const textKeys = {
            title_permanent: txCore.translator.t('ban_messages.reject.title_permanent'),
            title_temporary: txCore.translator.t('ban_messages.reject.title_temporary'),
            label_expiration: txCore.translator.t('ban_messages.reject.label_expiration'),
            label_date: txCore.translator.t('ban_messages.reject.label_date'),
            label_author: txCore.translator.t('ban_messages.reject.label_author'),
            label_reason: txCore.translator.t('ban_messages.reject.label_reason'),
            label_id: txCore.translator.t('ban_messages.reject.label_id'),
            note_multiple_bans: txCore.translator.t('ban_messages.reject.note_multiple_bans'),
            note_diff_license: txCore.translator.t('ban_messages.reject.note_diff_license'),
        };

        //Ban data
        let title;
        let expLine = '';
        if (ban.expiration) {
            const duration = txCore.translator.tDuration((ban.expiration - ts) * 1000, {
                largest: 2,
                units: ['d', 'h', 'm'] as Unit[],
            });
            expLine = `<strong>${textKeys.label_expiration}:</strong> ${duration} <br>`;
            title = textKeys.title_temporary;
        } else {
            title = textKeys.title_permanent;
        }
        const banDate = new Date(ban.timestamp * 1000).toLocaleString(txCore.translator.canonical, {
            dateStyle: 'medium',
            timeStyle: 'medium',
        });

        //Ban author
        let authorLine = '';
        if (!txConfig.gameFeatures.hideAdminInPunishments) {
            authorLine = `<strong>${textKeys.label_author}:</strong> ${xss(ban.author)} <br>`;
        }

        //Informational notes
        let note = '';
        if (activeBans.length > 1) {
            note += `<br>${textKeys.note_multiple_bans}`;
        }
        const bannedLicense = ban.ids.find((id) => id.startsWith('license:'));
        if (bannedLicense && validIdsObject.license && bannedLicense.substring(8) !== validIdsObject.license) {
            note += `<br>${textKeys.note_diff_license}`;
        }

        const banScenario = ban.expiration ? 'ban_temporary' : 'ban_permanent';
        const banExpires = ban.expiration
            ? txCore.translator.tDuration((ban.expiration - ts) * 1000, {
                  largest: 2,
                  units: ['d', 'h', 'm'] as Unit[],
              })
            : undefined;
        const banTemplate = getDeferralScenarioTemplate(banScenario);
        const supplementalBody = [
            authorLine,
            txConfig.banlist.rejectionMessage
                ? `${txConfig.banlist.rejectionMessage.trim().replaceAll(/\n/g, '<br>')}`
                : '',
            note ? `<span style="font-style: italic;">${note}</span>` : '',
        ]
            .join('')
            .trim();
        const legacyBody = `${expLine}
            <strong>${textKeys.label_date}:</strong> ${banDate} <br>
            <strong>${textKeys.label_reason}:</strong> ${xss(ban.reason)} <br>
            <strong>${textKeys.label_id}:</strong> <codeid>${ban.id}</codeid> <br>
            ${authorLine}
            ${txConfig.banlist.rejectionMessage ? `<br>${txConfig.banlist.rejectionMessage.trim().replaceAll(/\n/g, '<br>')}` : ''}
            <span style="font-style: italic;">${note}</span>`;
        const reason = await renderDeferralCard({
            scenario: banScenario,
            title,
            body: templateHasVisualLayout(banTemplate) ? supplementalBody : legacyBody,
            banReason: ban.reason,
            banExpires,
            banId: ban.id,
            banDate,
            banAuthor: txConfig.gameFeatures.hideAdminInPunishments ? undefined : ban.author,
            license: validIdsObject.license,
            discordId: validIdsObject.discord,
            identifiers: validIdsArray,
            playerName,
        });

        //Send serverlog message
        const matchingIds = ban.ids.filter((id) => validIdsArray.includes(id));
        const matchingHwids = 'hwids' in ban && ban.hwids ? ban.hwids.filter((hw) => validHwidsArray.includes(hw)) : [];
        const combined = [...matchingIds, ...matchingHwids];
        const summarizedIds = summarizeIdsArray(combined);
        const loggerReason = `active ban (${ban.id}) for identifiers ${summarizedIds}`;
        txCore.logger.server.write([
            {
                src: 'tx',
                type: 'playerJoinDenied',
                ts,
                data: { reason: loggerReason },
            },
        ]);

        return { allow: false, reason };
    } else {
        return { allow: true };
    }
}
