const modulename = 'WebServer:Database';
import { z } from 'zod';
import consoleFactory from '@lib/console';
import type { AuthedCtx } from '@modules/WebServer/ctxTypes';
import {
    DbUserError,
    deleteRow,
    getConnectionInfo,
    getTableRows,
    insertRow,
    listTables,
    runQuery,
    updateRow,
} from '@lib/database/dbManager';
import { checkReadOnlyQuery, isReadStatement } from '@lib/database/sqlGuards';
import {
    DB_PAGE_SIZES,
    type DbQueryResp,
    type DbRowActionResp,
    type DbStatusResp,
    type DbTableDataResp,
    type DbTablesResp,
} from '@shared/databaseApiTypes';
const console = consoleFactory(modulename);

const VIEW_PERM = 'database.view';
const EDIT_PERM = 'database.edit';
const MAX_SQL_LENGTH = 100_000;
const MAX_LOGGED_SQL = 500;

const zTableName = z.string().min(1).max(64);
const zCell = z.union([z.string().max(1_000_000), z.number(), z.boolean(), z.null()]);
const zRowKey = z.record(z.string().max(64), z.union([z.string().max(1024), z.number(), z.null()]));

/**
 * Common checks. Returns an error message, or null if allowed.
 * NOTE: unlike most page toggles, this one is also enforced on the backend.
 */
const checkAccess = (ctx: AuthedCtx, perm: string, logDenial: boolean) => {
    if (txConfig.panelFeatures?.databasePage === false) {
        return 'The database page is disabled in Settings → Panel Features.';
    }
    const allowed = logDenial ? ctx.admin.testPermission(perm, modulename) : ctx.admin.hasPermission(perm);
    return allowed ? null : "You don't have permission to do this.";
};

const handleError = (error: unknown) => {
    if (error instanceof DbUserError) return { error: error.message };
    console.verbose.dir(error);
    return { error: 'Unexpected error while talking to the database.' };
};

const truncateSql = (sql: string) => (sql.length > MAX_LOGGED_SQL ? `${sql.slice(0, MAX_LOGGED_SQL)}…` : sql);

/**
 * GET /database/status
 */
export async function DatabaseStatus(ctx: AuthedCtx) {
    const send = (data: DbStatusResp) => ctx.send(data);
    const denied = checkAccess(ctx, VIEW_PERM, false);
    if (denied) return send({ error: denied });
    try {
        const connection = await getConnectionInfo();
        return send({ connection, canEdit: ctx.admin.hasPermission(EDIT_PERM) });
    } catch (error) {
        return send(handleError(error));
    }
}

/**
 * GET /database/tables
 */
export async function DatabaseTables(ctx: AuthedCtx) {
    const send = (data: DbTablesResp) => ctx.send(data);
    const denied = checkAccess(ctx, VIEW_PERM, false);
    if (denied) return send({ error: denied });
    try {
        return send({ tables: await listTables() });
    } catch (error) {
        return send(handleError(error));
    }
}

const tableDataSchema = z.object({
    table: zTableName,
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce
        .number()
        .int()
        .refine((n) => (DB_PAGE_SIZES as readonly number[]).includes(n))
        .default(50),
    orderBy: z.string().max(64).optional(),
    orderDir: z.enum(['asc', 'desc']).optional(),
    search: z.string().max(256).optional(),
});

/**
 * GET /database/table?table=&page=&pageSize=&orderBy=&orderDir=&search=
 */
export async function DatabaseTableData(ctx: AuthedCtx) {
    const send = (data: DbTableDataResp) => ctx.send(data);
    const denied = checkAccess(ctx, VIEW_PERM, false);
    if (denied) return send({ error: denied });

    const parsed = tableDataSchema.safeParse(ctx.query);
    if (!parsed.success) return send({ error: 'Invalid request.' });
    const opts = parsed.data;
    try {
        const data = await getTableRows({ ...opts, orderBy: opts.orderBy || undefined });
        return send({ table: opts.table, page: opts.page, pageSize: opts.pageSize, ...data });
    } catch (error) {
        return send(handleError(error));
    }
}

/**
 * POST /database/query { sql }
 * Admins with database.edit run anything; database.view only runs read statements, read-only.
 */
export async function DatabaseQuery(ctx: AuthedCtx) {
    const send = (data: DbQueryResp) => ctx.send(data);
    const denied = checkAccess(ctx, VIEW_PERM, true);
    if (denied) return send({ error: denied });

    const parsed = z.object({ sql: z.string().min(1).max(MAX_SQL_LENGTH) }).safeParse(ctx.request.body);
    if (!parsed.success) return send({ error: 'Invalid request.' });
    const sql = parsed.data.sql.trim().replace(/;\s*$/, '');

    const canEdit = ctx.admin.hasPermission(EDIT_PERM);
    if (!canEdit) {
        const check = checkReadOnlyQuery(sql);
        if (!check.ok) return send({ error: check.reason });
    }

    try {
        const result = await runQuery(sql, !canEdit);
        if (!isReadStatement(sql)) {
            ctx.admin.logAction(`Ran database query: ${truncateSql(sql)}`, 'database.query');
        }
        return send(result);
    } catch (error) {
        return send(handleError(error));
    }
}

const rowActionSchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('update'), table: zTableName, key: zRowKey, values: z.record(z.string(), zCell) }),
    z.object({ action: z.literal('delete'), table: zTableName, key: zRowKey }),
    z.object({ action: z.literal('insert'), table: zTableName, values: z.record(z.string(), zCell) }),
]);

/**
 * POST /database/row { action: 'update' | 'delete' | 'insert', table, key?, values? }
 */
export async function DatabaseRowAction(ctx: AuthedCtx) {
    const send = (data: DbRowActionResp) => ctx.send(data);
    const denied = checkAccess(ctx, EDIT_PERM, true);
    if (denied) return send({ error: denied });

    const parsed = rowActionSchema.safeParse(ctx.request.body);
    if (!parsed.success) return send({ error: 'Invalid request.' });
    const req = parsed.data;

    try {
        let affectedRows: number;
        if (req.action === 'update') {
            affectedRows = await updateRow(req.table, req.key, req.values);
            ctx.admin.logAction(
                `Edited row in \`${req.table}\` (${JSON.stringify(req.key)}): set ${Object.keys(req.values).join(', ')}`,
                'database.row.edit',
            );
        } else if (req.action === 'delete') {
            affectedRows = await deleteRow(req.table, req.key);
            ctx.admin.logAction(
                `Deleted row from \`${req.table}\` (${JSON.stringify(req.key)})`,
                'database.row.delete',
            );
        } else {
            affectedRows = await insertRow(req.table, req.values);
            ctx.admin.logAction(`Inserted row into \`${req.table}\``, 'database.row.insert');
        }
        return send({ success: true, affectedRows });
    } catch (error) {
        return send(handleError(error));
    }
}
