const modulename = 'WebServer:Intercom';
import { txEnv, txHostConfig } from '@core/globalData';
import consoleFactory from '@lib/console';
import { InitializedCtx } from '@modules/WebServer/ctxTypes';
import {
    reportsCreate,
    reportsPlayerList,
    reportsPlayerMessage,
    reportsAdminList,
    reportsAdminDetail,
    reportsAdminMessage,
    reportsAdminStatus,
    ticketCreate,
    ticketPlayerList,
    ticketPlayerMessages,
    ticketPlayerMessage,
    ticketFeedbackSubmit,
    ticketAdminList,
    ticketAdminDetail,
    ticketAdminMessage,
    ticketAdminStatus,
    ticketAdminNote,
    ticketAdminClaim,
    ticketScreenshotUpload,
} from './reports';
import { resolveScreenshot } from './player/screenshot';
import { handleSpectateFrame } from './player/liveSpectate';
import { z } from 'zod';
import { reportTypes, reportStatuses, ticketStatuses, ticketPriorities } from '@shared/ticketApiTypes';
import { getDisplayPlayerCount } from '@lib/fxserver/httpHealthCheck';
import { applyPlayerTagChange } from '@lib/player/playerTags';
import got from '@lib/got';
import { resolveTelemetryPanelUrl } from '@lib/panelPublicUrl';
import { fetchFreshResourceReport, getCachedResourceReport, isValidResourceName } from './resources/shared';
import { randomUUID } from 'node:crypto';
import { getMenuActionDef } from '@shared/customCommands';
const console = consoleFactory(modulename);

const STATS_INVENTORY_REPORT_TIMEOUT_MS = 5000;
/** Reuse the resource report for telemetry instead of forcing a txaReportResources
 * round-trip (and its console print) every 5-minute stats tick - inventory composition
 * rarely changes that often. */
const STATS_INVENTORY_MAX_AGE_MS = 30 * 60 * 1000;

const isString = (val: unknown): val is string => typeof val === 'string' && val.length > 0;

const STATS_ENDPOINT = 'https://www.sxpanel.org/api/stats';

let statsInstallId: string | null = null;

type TelemetryGameName = 'fivem' | 'redm';

const resolveTelemetryGameName = (): TelemetryGameName | undefined => {
    const cached = txCore.cacheStore.get('fxsRuntime:gameName');
    if (cached === 'fivem' || cached === 'redm') return cached;

    if (txHostConfig.forceGameName === 'fivem' || txHostConfig.forceGameName === 'redm') {
        return txHostConfig.forceGameName;
    }

    const dataPath = String(txConfig.server.dataPath ?? '').toLowerCase();
    if (dataPath.includes('redm') || dataPath.includes('rdr3')) return 'redm';

    const recipe = txCore.cacheStore.get('deployer:recipe');
    if (typeof recipe === 'string' && /redm|rdr3/i.test(recipe)) return 'redm';

    return undefined;
};

const buildDashboardTelemetry = async ():
    | {
          fxsVersion?: number;
          locale?: string;
          panelUptimeSeconds?: number;
          panelUrl?: string;
          adminCount?: number;
          features?: {
              discordBot: boolean;
              banlist: boolean;
              whitelist: boolean;
              menuEnabled: boolean;
          };
          moderation?: {
              bans: number;
              warns: number;
              kicks: number;
              whitelists: number;
          };
      }
    | undefined => {
    const locale = txCore.cacheStore.get('fxsRuntime:locale');
    const adminCount = Array.isArray(txCore.adminStore.admins) ? txCore.adminStore.admins.length : 1;

    let moderation: { bans: number; warns: number; kicks: number; whitelists: number } | undefined;
    try {
        const dbStats = txCore.database.stats.getDatabaseStats();
        moderation = {
            bans: dbStats.bans,
            warns: dbStats.warns,
            kicks: dbStats.kicks,
            whitelists: dbStats.whitelists,
        };
    } catch {
        moderation = undefined;
    }

    const panelUrl = await resolveTelemetryPanelUrl();

    return {
        fxsVersion: txEnv.fxsVersion,
        ...(typeof locale === 'string' && locale.length ? { locale } : {}),
        panelUptimeSeconds: Math.round(process.uptime()),
        ...(panelUrl ? { panelUrl } : {}),
        adminCount,
        features: {
            discordBot: txConfig.discordBot.enabled,
            banlist: txConfig.banlist.enabled,
            whitelist: txConfig.whitelist.enabled,
            menuEnabled: txConfig.gameFeatures.menuEnabled,
        },
        ...(moderation ? { moderation } : {}),
    };
};

const sendStatsToFxApi = async () => {
    if (!txConfig.general.enableTelemetry) return;
    if (!statsInstallId) {
        statsInstallId = txCore.cacheStore.get('stats:installId') as string | null;
        if (!statsInstallId) {
            statsInstallId = randomUUID();
            txCore.cacheStore.set('stats:installId', statsInstallId);
        }
    }

    const playerCount = getDisplayPlayerCount();
    const maxClients = txCore.cacheStore.get('fxsRuntime:maxClients') as number | null;

    let dbStats = { players: 0, playTime: 0 };
    try {
        dbStats = txCore.database.stats.getDatabaseStats();
    } catch {
        // database not ready yet
    }

    const projectName = txCore.cacheStore.get('fxsRuntime:projectName') as string | undefined;
    const gameName = resolveTelemetryGameName();
    const cfxId = txCore.cacheStore.getTyped('fxsRuntime:cfxId', isString) ?? undefined;
    const dashboard = await buildDashboardTelemetry();

    if (txCore.fxRunner.child?.isAlive && !getCachedResourceReport(STATS_INVENTORY_MAX_AGE_MS)) {
        const reportResult = await fetchFreshResourceReport(STATS_INVENTORY_REPORT_TIMEOUT_MS);
        if (!reportResult.ok) {
            console.verbose.warn('Stats inventory refresh skipped', { reason: reportResult.error });
        }
    }

    const inventory = buildTelemetryInventory();

    const payload: Record<string, unknown> = {
        installId: statsInstallId,
        version: txEnv.txaVersion,
        timestamp: Date.now(),
        server: {
            os: process.platform,
            name: txConfig.general.serverName,
            playerSlots: maxClients ?? 0,
            currentPlayers: playerCount,
            ...(projectName ? { projectName } : {}),
            ...(gameName ? { gameName } : {}),
            ...(cfxId ? { cfxId } : {}),
        },
        stats: {
            totalUniquePlayers: dbStats.players,
            totalPlayTimeSeconds: dbStats.playTime,
        },
        ...(inventory ? { inventory } : {}),
        ...(dashboard ? { dashboard } : {}),
    };

    try {
        await got.post(STATS_ENDPOINT, {
            json: payload,
            timeout: { send: 5000, response: 30_000 },
            retry: { limit: 0 },
        });
    } catch (error) {
        console.verbose.warn('Failed to send stats to sxpanel.org', { error: (error as Error).message });
    }
};

const buildTelemetryInventory = ():
    | {
          total: number;
          started: number;
          stopped: number;
          labels: string[];
          entries: { name: string; status: 'started' | 'stopped' }[];
      }
    | undefined => {
    const report = txCore.fxResources.resourceReport;
    if (!report?.resources || !Array.isArray(report.resources)) {
        return undefined;
    }

    const entries = report.resources
        .filter((r: { name?: string }) => r?.name && isValidResourceName(r.name))
        .map((entry: { name: string; status?: string }) => {
            const status = entry.status === 'started' ? 'started' : 'stopped';
            return { name: entry.name, status };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

    if (!entries.length) return undefined;

    let started = 0;
    let stopped = 0;
    for (const entry of entries) {
        if (entry.status === 'started') {
            started++;
        } else {
            stopped++;
        }
    }

    const capped = entries.slice(0, 200);

    return {
        total: entries.length,
        started,
        stopped,
        labels: capped.map((entry) => entry.name),
        entries: capped,
    };
};

// Send stats every 5 minutes
setInterval(sendStatsToFxApi, 5 * 60 * 1000);
// Also send once shortly after boot (30s delay to let DB init)
setTimeout(sendStatsToFxApi, 30 * 1000);

// Base schema with txAdminToken that all intercom requests include
const baseIntercomSchema = {
    txAdminToken: z.string(),
};

// Validation schemas for intercom scopes
const monitorSchema = z.object(baseIntercomSchema).strict();

const resourcesSchema = z
    .object({
        ...baseIntercomSchema,
        resources: z.array(z.any()), // Resource objects with metadata
    })
    .strict();

const reportPlayerRefSchema = z.object({
    license: z.string(),
    name: z.string(),
    netid: z.number(),
});

const reportCreateSchema = z
    .object({
        ...baseIntercomSchema,
        type: z.enum(reportTypes),
        reporter: reportPlayerRefSchema,
        targets: z.array(reportPlayerRefSchema).optional(),
        reason: z.string(),
    })
    .strict();

const reportPlayerListSchema = z
    .object({
        ...baseIntercomSchema,
        playerLicense: z.string(),
    })
    .strict();

const reportPlayerMessageSchema = z
    .object({
        ...baseIntercomSchema,
        reportId: z.string(),
        playerLicense: z.string(),
        content: z.string(),
    })
    .strict();

const screenshotResultSchema = z
    .object({
        ...baseIntercomSchema,
        requestId: z.string(),
        fileName: z.string().optional(),
        error: z.string().optional(),
    })
    .strict();

const spectateFrameSchema = z
    .object({
        ...baseIntercomSchema,
        sessionId: z.string(),
        frameData: z.string(),
    })
    .strict();

const statsSchema = z
    .object({
        ...baseIntercomSchema,
    })
    .strict();

const customCommandsSchema = z.object(baseIntercomSchema).strict();

const playerTagSchema = z
    .object({
        ...baseIntercomSchema,
        action: z.enum(['add', 'remove']),
        netId: z.number().int().positive(),
        tagId: z.string().min(1).max(32),
    })
    .strict();

const reportAdminListSchema = z
    .object({
        ...baseIntercomSchema,
        adminName: z.string(),
    })
    .strict();

const reportAdminDetailSchema = z
    .object({
        ...baseIntercomSchema,
        adminName: z.string(),
        reportId: z.string(),
    })
    .strict();

const reportAdminMessageSchema = z
    .object({
        ...baseIntercomSchema,
        adminName: z.string(),
        reportId: z.string(),
        content: z.string().max(2048),
    })
    .strict();

const reportAdminStatusSchema = z
    .object({
        ...baseIntercomSchema,
        adminName: z.string(),
        reportId: z.string(),
        status: z.enum(reportStatuses),
    })
    .strict();

// ── New ticket intercom schemas ──────────────────────────────────────────────

const ticketPlayerRefSchema = z.object({
    license: z.string(),
    name: z.string(),
    netid: z.number().optional(),
});

const ticketCreateSchema = z
    .object({
        ...baseIntercomSchema,
        reporter: z.object({ license: z.string(), name: z.string(), netid: z.number() }),
        targets: z.array(ticketPlayerRefSchema).optional(),
        category: z.string().min(1).max(64),
        priority: z.enum(ticketPriorities).optional(),
        description: z.string().min(1).max(4000),
        imageUrls: z.array(z.string().url()).max(3).optional(),
        screenshotData: z.string().optional(),
    })
    .strict();

const ticketPlayerListSchema = z
    .object({
        ...baseIntercomSchema,
        playerLicense: z.string(),
    })
    .strict();

const ticketPlayerMessagesSchema = z
    .object({
        ...baseIntercomSchema,
        ticketId: z.string(),
        playerLicense: z.string(),
    })
    .strict();

const ticketPlayerMessageSchema = z
    .object({
        ...baseIntercomSchema,
        ticketId: z.string(),
        playerLicense: z.string(),
        content: z.string().max(2048),
        imageUrls: z.array(z.string().url()).max(3).optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
        const hasContent = data.content.trim().length > 0;
        const hasImages = Array.isArray(data.imageUrls) && data.imageUrls.length > 0;
        if (!hasContent && !hasImages) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Either content or imageUrls is required',
                path: ['content'],
            });
        }
    });

const ticketFeedbackSubmitSchema = z
    .object({
        ...baseIntercomSchema,
        ticketId: z.string(),
        reporterLicense: z.string(),
        rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
        comment: z.string().max(500).optional(),
    })
    .strict();

const ticketAdminListSchema = z
    .object({
        ...baseIntercomSchema,
        adminName: z.string(),
    })
    .strict();

const ticketAdminDetailSchema = z
    .object({
        ...baseIntercomSchema,
        adminName: z.string(),
        ticketId: z.string(),
    })
    .strict();

const ticketAdminMessageSchema = z
    .object({
        ...baseIntercomSchema,
        adminName: z.string(),
        ticketId: z.string(),
        content: z.string().max(2048),
        imageUrls: z.array(z.string().url()).max(3).optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
        const hasContent = data.content.trim().length > 0;
        const hasImages = Array.isArray(data.imageUrls) && data.imageUrls.length > 0;
        if (!hasContent && !hasImages) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Either content or imageUrls is required',
                path: ['content'],
            });
        }
    });

const ticketAdminStatusSchema = z
    .object({
        ...baseIntercomSchema,
        adminName: z.string(),
        ticketId: z.string(),
        status: z.enum(ticketStatuses),
    })
    .strict();

const ticketAdminNoteSchema = z
    .object({
        ...baseIntercomSchema,
        adminName: z.string(),
        ticketId: z.string(),
        content: z.string().min(1).max(2048),
    })
    .strict();

const ticketAdminClaimSchema = z
    .object({
        ...baseIntercomSchema,
        adminName: z.string(),
        ticketId: z.string(),
    })
    .strict();

const ticketScreenshotUploadSchema = z
    .object({
        ...baseIntercomSchema,
        ticketId: z.string(),
        screenshotData: z.string(),
    })
    .strict();

// Map of scope names to their validation schemas
const scopeValidators = {
    monitor: monitorSchema,
    customCommands: customCommandsSchema,
    resources: resourcesSchema,
    // Legacy report scopes (kept for backward compat with older Lua resources)
    reportCreate: reportCreateSchema,
    reportPlayerList: reportPlayerListSchema,
    reportPlayerMessage: reportPlayerMessageSchema,
    reportAdminList: reportAdminListSchema,
    reportAdminDetail: reportAdminDetailSchema,
    reportAdminMessage: reportAdminMessageSchema,
    reportAdminStatus: reportAdminStatusSchema,
    // New ticket scopes
    ticketCreate: ticketCreateSchema,
    ticketPlayerList: ticketPlayerListSchema,
    ticketPlayerMessages: ticketPlayerMessagesSchema,
    ticketPlayerMessage: ticketPlayerMessageSchema,
    ticketFeedbackSubmit: ticketFeedbackSubmitSchema,
    ticketAdminList: ticketAdminListSchema,
    ticketAdminDetail: ticketAdminDetailSchema,
    ticketAdminMessage: ticketAdminMessageSchema,
    ticketAdminStatus: ticketAdminStatusSchema,
    ticketAdminNote: ticketAdminNoteSchema,
    ticketAdminClaim: ticketAdminClaimSchema,
    ticketScreenshotUpload: ticketScreenshotUploadSchema,
    screenshotResult: screenshotResultSchema,
    spectateFrame: spectateFrameSchema,
    stats: statsSchema,
    playerTag: playerTagSchema,
} as const;

type IntercomScope = keyof typeof scopeValidators;
type ScopeData<S extends IntercomScope> = z.infer<(typeof scopeValidators)[S]>;

/**
 * Validates the request body against the schema for the given scope
 * @param scope - The intercom scope
 * @param body - The request body to validate
 * @returns An object with success boolean and either data or error
 */
const validateScopeData = <S extends IntercomScope>(
    scope: S,
    body: unknown,
): { success: true; data: ScopeData<S> } | { success: false; error: string } => {
    const schema = scopeValidators[scope];

    const result = schema.safeParse(body);
    if (!result.success) {
        const errorDetails = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: `Validation failed: ${errorDetails}` };
    }

    return { success: true, data: result.data as ScopeData<S> };
};

const INTERCOM_REPORTS_PERM = 'players.reports';

/**
 * Binds intercom `adminName` to a real admin with reports permission.
 * Prevents callers with only `luaComToken` from impersonating arbitrary admins.
 */
const resolveIntercomAdminName = (adminName: string): { ok: true; name: string } | { ok: false; error: string } => {
    const stored = txCore.adminStore.getAdminByName(adminName);
    if (!stored) {
        console.warn(`Intercom rejected unknown adminName: ${adminName}`);
        return { ok: false, error: 'Invalid admin.' };
    }
    const authed = stored.getAuthed();
    if (!authed.hasPermission(INTERCOM_REPORTS_PERM)) {
        console.warn(`Intercom rejected admin without ${INTERCOM_REPORTS_PERM}: ${adminName}`);
        return { ok: false, error: 'Permission denied.' };
    }
    return { ok: true, name: authed.name };
};

/**
 * Intercommunications endpoint
 * @param {object} ctx
 */
export default async function Intercom(ctx: InitializedCtx) {
    //Sanity check
    const params = ctx.params as Record<string, string>;
    if (typeof params.scope !== 'string' || ctx.request.body === undefined) {
        return ctx.utils.error(400, 'Invalid Request');
    }
    const scope = params.scope;

    // Validate scope name
    if (!(scope in scopeValidators)) {
        return ctx.send({
            type: 'danger',
            message: 'Unknown intercom scope.',
        });
    }
    const validScope = scope as IntercomScope;

    // Validates the body for a specific scope and masks the token.
    // Called with a literal scope string inside each case so TypeScript can infer the
    // correct data type for that scope rather than the full union.
    const validateBody = <S extends IntercomScope>(
        s: S,
    ): { ok: true; data: ScopeData<S> } | { ok: false; errorMsg: string } => {
        const result = validateScopeData(s, ctx.request.body);
        if (!result.success) {
            console.verbose.warn(`Intercom validation failed for scope '${s}': ${result.error}`);
            return { ok: false, errorMsg: result.error };
        }
        // Intentionally overwrite the raw token string with `true` before passing data to
        // downstream handlers. The token has already been validated; masking it here
        // prevents accidental logging or forwarding of the secret value.
        (result.data as Record<string, unknown>).txAdminToken = true;
        return { ok: true, data: result.data };
    };

    const requireIntercomAdmin = (adminName: string) => {
        const resolved = resolveIntercomAdminName(adminName);
        if (!resolved.ok) return { error: resolved.error } as const;
        return { adminName: resolved.name } as const;
    };

    //Delegate to the specific scope functions
    switch (validScope) {
        case 'monitor': {
            const v = validateBody('monitor');
            if (!v.ok) return ctx.utils.error(400, v.errorMsg);
            try {
                txCore.fxMonitor.handleHeartBeat('http');
                return ctx.send(txManager.txRuntime.currHbData);
            } catch (error) {
                return ctx.send({ txAdminVersion: txEnv.txaVersion, success: false });
            }
        }
        case 'stats': {
            const v = validateBody('stats');
            if (!v.ok) return ctx.utils.error(400, v.errorMsg);
            sendStatsToFxApi();
            return ctx.send({ success: true });
        }
        case 'resources': {
            const v = validateBody('resources');
            if (!v.ok) return ctx.utils.error(400, v.errorMsg);
            txCore.fxResources.tmpUpdateResourceList(v.data.resources);
            return ctx.send({ txAdminVersion: txEnv.txaVersion, success: true });
        }
        case 'reportCreate': {
            const v = validateBody('reportCreate');
            if (!v.ok) return ctx.utils.error(400, v.errorMsg);
            return ctx.send(await reportsCreate(v.data));
        }
        case 'reportPlayerList': {
            const v = validateBody('reportPlayerList');
            if (!v.ok) return ctx.utils.error(400, v.errorMsg);
            return ctx.send(reportsPlayerList(v.data.playerLicense));
        }
        case 'reportPlayerMessage': {
            const v = validateBody('reportPlayerMessage');
            if (!v.ok) return ctx.utils.error(400, v.errorMsg);
            return ctx.send(reportsPlayerMessage(v.data.reportId, v.data.playerLicense, v.data.content));
        }
        case 'reportAdminList': {
            const v = validateBody('reportAdminList');
            if (!v.ok) return ctx.utils.error(400, v.errorMsg);
            const admin = requireIntercomAdmin(v.data.adminName);
            if ('error' in admin) return ctx.send({ error: admin.error });
            return ctx.send(reportsAdminList());
        }
        case 'reportAdminDetail': {
            const v = validateBody('reportAdminDetail');
            if (!v.ok) return ctx.utils.error(400, v.errorMsg);
            const admin = requireIntercomAdmin(v.data.adminName);
            if ('error' in admin) return ctx.send({ error: admin.error });
            return ctx.send(reportsAdminDetail(v.data.reportId));
        }
        case 'reportAdminMessage': {
            const v = validateBody('reportAdminMessage');
            if (!v.ok) return ctx.utils.error(400, v.errorMsg);
            const admin = requireIntercomAdmin(v.data.adminName);
            if ('error' in admin) return ctx.send({ error: admin.error });
            return ctx.send(reportsAdminMessage(v.data.reportId, admin.adminName, v.data.content));
        }
        case 'reportAdminStatus': {
            const v = validateBody('reportAdminStatus');
            if (!v.ok) return ctx.utils.error(400, v.errorMsg);
            const admin = requireIntercomAdmin(v.data.adminName);
            if ('error' in admin) return ctx.send({ error: admin.error });
            return ctx.send(reportsAdminStatus(v.data.reportId, v.data.status, admin.adminName));
        }
        case 'ticketCreate': {
            const v = validateBody('ticketCreate');
            if (!v.ok) return ctx.utils.error(400, v.errorMsg);
            const { reporter, targets, category, priority, description, imageUrls, screenshotData } = v.data;
            return ctx.send(
                await ticketCreate({
                    reporter,
                    targets: targets ?? [],
                    category,
                    priority,
                    description,
                    imageUrls,
                    screenshotData,
                }),
            );
        }
        case 'ticketPlayerList': {
            const v = validateBody('ticketPlayerList');
            if (!v.ok) return ctx.utils.error(400, v.errorMsg);
            return ctx.send(ticketPlayerList(v.data.playerLicense));
        }
        case 'ticketPlayerMessages': {
            const v = validateBody('ticketPlayerMessages');
            if (!v.ok) return ctx.utils.error(400, v.errorMsg);
            return ctx.send(ticketPlayerMessages(v.data.ticketId, v.data.playerLicense));
        }
        case 'ticketPlayerMessage': {
            const v = validateBody('ticketPlayerMessage');
            if (!v.ok) return ctx.utils.error(400, v.errorMsg);
            return ctx.send(
                ticketPlayerMessage(v.data.ticketId, v.data.playerLicense, v.data.content, v.data.imageUrls),
            );
        }
        case 'ticketFeedbackSubmit': {
            const v = validateBody('ticketFeedbackSubmit');
            if (!v.ok) return ctx.utils.error(400, v.errorMsg);
            return ctx.send(ticketFeedbackSubmit(v.data));
        }
        case 'ticketAdminList': {
            const v = validateBody('ticketAdminList');
            if (!v.ok) return ctx.utils.error(400, v.errorMsg);
            const admin = requireIntercomAdmin(v.data.adminName);
            if ('error' in admin) return ctx.send({ error: admin.error });
            return ctx.send(ticketAdminList());
        }
        case 'ticketAdminDetail': {
            const v = validateBody('ticketAdminDetail');
            if (!v.ok) return ctx.utils.error(400, v.errorMsg);
            const admin = requireIntercomAdmin(v.data.adminName);
            if ('error' in admin) return ctx.send({ error: admin.error });
            return ctx.send(ticketAdminDetail(v.data.ticketId));
        }
        case 'ticketAdminMessage': {
            const v = validateBody('ticketAdminMessage');
            if (!v.ok) return ctx.utils.error(400, v.errorMsg);
            const admin = requireIntercomAdmin(v.data.adminName);
            if ('error' in admin) return ctx.send({ error: admin.error });
            return ctx.send(ticketAdminMessage(v.data.ticketId, admin.adminName, v.data.content, v.data.imageUrls));
        }
        case 'ticketAdminStatus': {
            const v = validateBody('ticketAdminStatus');
            if (!v.ok) return ctx.utils.error(400, v.errorMsg);
            const admin = requireIntercomAdmin(v.data.adminName);
            if ('error' in admin) return ctx.send({ error: admin.error });
            return ctx.send(ticketAdminStatus(v.data.ticketId, v.data.status, admin.adminName));
        }
        case 'ticketAdminNote': {
            const v = validateBody('ticketAdminNote');
            if (!v.ok) return ctx.utils.error(400, v.errorMsg);
            const admin = requireIntercomAdmin(v.data.adminName);
            if ('error' in admin) return ctx.send({ error: admin.error });
            return ctx.send(ticketAdminNote(v.data.ticketId, admin.adminName, v.data.content));
        }
        case 'ticketAdminClaim': {
            const v = validateBody('ticketAdminClaim');
            if (!v.ok) return ctx.utils.error(400, v.errorMsg);
            const admin = requireIntercomAdmin(v.data.adminName);
            if ('error' in admin) return ctx.send({ error: admin.error });
            return ctx.send(ticketAdminClaim(v.data.ticketId, admin.adminName));
        }
        case 'ticketScreenshotUpload': {
            const v = validateBody('ticketScreenshotUpload');
            if (!v.ok) return ctx.utils.error(400, v.errorMsg);
            return ctx.send(await ticketScreenshotUpload(v.data.ticketId, v.data.screenshotData));
        }
        case 'screenshotResult': {
            const v = validateBody('screenshotResult');
            if (!v.ok) return ctx.utils.error(400, v.errorMsg);
            resolveScreenshot(v.data.requestId, v.data.fileName, v.data.error);
            return ctx.send({ success: true });
        }
        case 'spectateFrame': {
            const v = validateBody('spectateFrame');
            if (!v.ok) return ctx.utils.error(400, v.errorMsg);
            console.verbose.log(
                `[spectate] Intercom frame received: session=${v.data.sessionId}, len=${v.data.frameData.length}`,
            );
            handleSpectateFrame(v.data.sessionId, v.data.frameData);
            return ctx.send({ success: true });
        }
        case 'playerTag': {
            const v = validateBody('playerTag');
            if (!v.ok) return ctx.utils.error(400, v.errorMsg);
            try {
                applyPlayerTagChange(v.data.netId, v.data.tagId, v.data.action === 'add');
                return ctx.send({ success: true });
            } catch (error) {
                const message = emsg(error);
                console.warn(`Intercom playerTag failed (netId=${v.data.netId}, tag=${v.data.tagId}): ${message}`);
                return ctx.send({ success: false, error: message });
            }
        }
        case 'customCommands': {
            const v = validateBody('customCommands');
            if (!v.ok) return ctx.utils.error(400, v.errorMsg);
            //Only the enabled ones are relevant to the game server
            //The chat suggestion params are attached here so the resource doesn't need its own catalog
            const commands = txConfig.gameFeatures.customCommands
                .filter((cmd) => cmd.enabled)
                .map((cmd) => ({
                    ...cmd,
                    params:
                        cmd.action.type === 'menuAction'
                            ? (getMenuActionDef(cmd.action.actionId)?.args ?? []).map(({ name, help }) => ({
                                  name,
                                  help,
                              }))
                            : [],
                }));
            return ctx.send({ success: true, commands });
        }
        default: {
            // All keys of scopeValidators are handled above; this is a compile-time exhaustiveness guard.
            const _exhaustive: never = validScope;
            throw new Error(`Unhandled intercom scope: ${_exhaustive}`);
        }
    }
}
