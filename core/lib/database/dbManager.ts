import mysql from 'mysql2/promise';
import type { Pool, PoolConnection, FieldPacket, ResultSetHeader } from 'mysql2/promise';
import { parseRecursiveConfig, resolveCFGFilePath } from '@lib/fxserver/fxsConfigHelper';
import { parseConnectionString, type ParsedConnectionString } from './connectionString';
import type { DbCellValue, DbColumnInfo, DbConnectionInfo, DbRowKey, DbTableSummary } from '@shared/databaseApiTypes';
import { DB_QUERY_MAX_ROWS } from '@shared/databaseApiTypes';

const CONVAR_NAME = 'mysql_connection_string';
const RESOLVE_CACHE_MS = 30_000;
const QUERY_TIMEOUT_MS = 30_000;
const MAX_CELL_CHARS = 16_384;
const MAX_BINARY_PREVIEW_BYTES = 64;

/** Error with a message that is safe to send to the panel. */
export class DbUserError extends Error {}

type ResolvedConnection = { raw: string; parsed: ParsedConnectionString; source: DbConnectionInfo['source'] };

let resolvedCache: { at: number; value: ResolvedConnection } | null = null;
let pool: Pool | null = null;
let poolKey: string | null = null;
let serverVersion = '';

//=============================================================
//== Connection
//=============================================================
const findInStartupArgs = (): string | null => {
    const args = txConfig.server.startupArgs ?? [];
    let found: string | null = null;
    for (let i = 0; i < args.length - 2; i++) {
        if (/^\+sets?r?$/i.test(args[i]) && args[i + 1].toLowerCase() === CONVAR_NAME) {
            found = args[i + 2];
        }
    }
    return found;
};

const findInServerCfg = async (): Promise<string | null> => {
    if (!txConfig.server.dataPath || !txConfig.server.cfgPath) return null;
    const cfgAbsolutePath = resolveCFGFilePath(txConfig.server.cfgPath, txConfig.server.dataPath);
    const commands = await parseRecursiveConfig(null, cfgAbsolutePath, txConfig.server.dataPath);
    let found: string | null = null;
    for (const cmd of commands) {
        if (!('isConvarSetterFor' in cmd)) continue;
        const value = cmd.isConvarSetterFor(CONVAR_NAME);
        if (typeof value === 'string') found = value; //last one wins, like the server
    }
    return found;
};

const resolveConnection = async (): Promise<ResolvedConnection> => {
    if (resolvedCache && Date.now() - resolvedCache.at < RESOLVE_CACHE_MS) {
        return resolvedCache.value;
    }
    let raw = findInStartupArgs();
    let source: DbConnectionInfo['source'] = 'startupArgs';
    if (!raw) {
        try {
            raw = await findInServerCfg();
        } catch (error) {
            throw new DbUserError(`Could not read server.cfg: ${(error as Error).message}`);
        }
        source = 'server.cfg';
    }
    if (!raw) {
        throw new DbUserError(
            `No "${CONVAR_NAME}" found in your server.cfg. Add it (the same one oxmysql uses) to use the database page.`,
        );
    }
    let parsed: ParsedConnectionString;
    try {
        parsed = parseConnectionString(raw);
    } catch (error) {
        throw new DbUserError(`Invalid ${CONVAR_NAME}: ${(error as Error).message}`);
    }
    const value = { raw, parsed, source };
    resolvedCache = { at: Date.now(), value };
    return value;
};

const getPool = async () => {
    const conn = await resolveConnection();
    if (pool && poolKey === conn.raw) return { pool, conn };

    if (pool) {
        pool.end().catch(() => {});
        pool = null;
    }
    const { parsed } = conn;
    pool = mysql.createPool({
        host: parsed.host,
        port: parsed.port,
        user: parsed.user,
        password: parsed.password,
        database: parsed.database,
        ...(parsed.socketPath ? { socketPath: parsed.socketPath } : {}),
        connectionLimit: 3,
        maxIdle: 1,
        idleTimeout: 60_000,
        connectTimeout: 10_000,
        multipleStatements: false,
        dateStrings: true,
        supportBigNumbers: true,
        bigNumberStrings: true,
        charset: 'utf8mb4',
    });
    poolKey = conn.raw;
    serverVersion = '';
    return { pool, conn };
};

const wrapDbError = (error: unknown): never => {
    if (error instanceof DbUserError) throw error;
    const err = error as { code?: string; sqlMessage?: string; message?: string };
    //mysql2 errors don't include the password, but keep host details out of generic failures too
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') {
        throw new DbUserError(`Could not connect to the database server (${err.code}).`);
    }
    if (err.code === 'ER_ACCESS_DENIED_ERROR') {
        throw new DbUserError('Access denied: check the user and password in mysql_connection_string.');
    }
    if (err.code === 'PROTOCOL_SEQUENCE_TIMEOUT') {
        throw new DbUserError(`Query timed out after ${QUERY_TIMEOUT_MS / 1000}s.`);
    }
    throw new DbUserError(err.sqlMessage ?? err.message ?? 'Unknown database error.');
};

/** Clears cached connection info, used after errors so a fixed server.cfg is picked up. */
export const resetDbConnection = () => {
    resolvedCache = null;
};

export const getConnectionInfo = async (): Promise<DbConnectionInfo> => {
    try {
        const { pool, conn } = await getPool();
        if (!serverVersion) {
            const [rows] = await pool.query<any[]>({ sql: 'SELECT VERSION() AS v', timeout: QUERY_TIMEOUT_MS });
            serverVersion = String(rows[0]?.v ?? '');
        }
        return {
            host: conn.parsed.socketPath ?? conn.parsed.host,
            port: conn.parsed.port,
            database: conn.parsed.database,
            user: conn.parsed.user,
            serverVersion,
            source: conn.source,
        };
    } catch (error) {
        resetDbConnection();
        return wrapDbError(error);
    }
};

//=============================================================
//== Value serialization
//=============================================================
export const serializeCell = (value: unknown): DbCellValue => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return value.toString();
    if (Buffer.isBuffer(value)) {
        return {
            $kind: 'binary',
            bytes: value.length,
            hex: value.subarray(0, MAX_BINARY_PREVIEW_BYTES).toString('hex'),
        };
    }
    const str = typeof value === 'string' ? value : JSON.stringify(value); //JSON columns arrive parsed
    if (str.length > MAX_CELL_CHARS) {
        return { $kind: 'truncated', length: str.length, preview: str.slice(0, MAX_CELL_CHARS) };
    }
    return str;
};

//=============================================================
//== Schema
//=============================================================
export const listTables = async (): Promise<DbTableSummary[]> => {
    try {
        const { pool } = await getPool();
        const [rows] = await pool.query<any[]>({
            sql: `SELECT TABLE_NAME AS name, ENGINE AS engine, TABLE_ROWS AS tableRows,
                    DATA_LENGTH AS dataBytes, TABLE_COMMENT AS comment
                FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE()
                ORDER BY TABLE_NAME`,
            timeout: QUERY_TIMEOUT_MS,
        });
        return rows.map((r) => ({
            name: String(r.name),
            engine: r.engine ?? null,
            rows: r.tableRows === null ? null : Number(r.tableRows),
            dataBytes: r.dataBytes === null ? null : Number(r.dataBytes),
            comment: String(r.comment ?? ''),
        }));
    } catch (error) {
        return wrapDbError(error);
    }
};

export const getTableColumns = async (table: string): Promise<DbColumnInfo[]> => {
    try {
        const { pool } = await getPool();
        const [rows] = await pool.query<any[]>({
            sql: `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, DATA_TYPE AS dataType, IS_NULLABLE AS nullable,
                    COLUMN_DEFAULT AS defaultValue, COLUMN_KEY AS columnKey, EXTRA AS extra, COLUMN_COMMENT AS comment
                FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
                ORDER BY ORDINAL_POSITION`,
            values: [table],
            timeout: QUERY_TIMEOUT_MS,
        });
        if (!rows.length) throw new DbUserError(`Table "${table}" not found.`);
        return rows.map((r) => ({
            name: String(r.name),
            type: String(r.type),
            dataType: String(r.dataType).toLowerCase(),
            nullable: r.nullable === 'YES',
            defaultValue: r.defaultValue === null ? null : String(r.defaultValue),
            isPrimaryKey: r.columnKey === 'PRI',
            isAutoIncrement: String(r.extra).toLowerCase().includes('auto_increment'),
            extra: String(r.extra ?? ''),
            comment: String(r.comment ?? ''),
        }));
    } catch (error) {
        return wrapDbError(error);
    }
};

//=============================================================
//== Table data
//=============================================================
type TableDataOpts = {
    table: string;
    page: number;
    pageSize: number;
    orderBy?: string;
    orderDir?: 'asc' | 'desc';
    search?: string;
};

export const getTableRows = async (opts: TableDataOpts) => {
    const columns = await getTableColumns(opts.table);
    const columnNames = new Set(columns.map((c) => c.name));
    const tableId = mysql.escapeId(opts.table);

    const where: string[] = [];
    const values: unknown[] = [];
    if (opts.search?.length) {
        const searchable = columns.filter((c) => !/blob|binary|geometry|point|polygon/.test(c.dataType));
        if (searchable.length) {
            where.push(`(${searchable.map((c) => `CAST(${mysql.escapeId(c.name)} AS CHAR) LIKE ?`).join(' OR ')})`);
            const pattern = `%${opts.search.replace(/[\\%_]/g, '\\$&')}%`;
            values.push(...searchable.map(() => pattern));
        }
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    let orderSql = '';
    if (opts.orderBy) {
        if (!columnNames.has(opts.orderBy)) throw new DbUserError(`Unknown column "${opts.orderBy}".`);
        orderSql = `ORDER BY ${mysql.escapeId(opts.orderBy)} ${opts.orderDir === 'desc' ? 'DESC' : 'ASC'}`;
    }

    try {
        const { pool } = await getPool();
        const [countRows] = await pool.query<any[]>({
            sql: `SELECT COUNT(*) AS total FROM ${tableId} ${whereSql}`,
            values,
            timeout: QUERY_TIMEOUT_MS,
        });
        const [rows] = await pool.query<any[]>({
            sql: `SELECT * FROM ${tableId} ${whereSql} ${orderSql} LIMIT ? OFFSET ?`,
            values: [...values, opts.pageSize, (opts.page - 1) * opts.pageSize],
            rowsAsArray: true,
            timeout: QUERY_TIMEOUT_MS,
        });
        return {
            columns,
            rows: (rows as unknown[][]).map((row) => row.map(serializeCell)),
            total: Number(countRows[0]?.total ?? 0),
        };
    } catch (error) {
        return wrapDbError(error);
    }
};

//=============================================================
//== Free queries
//=============================================================
/**
 * Runs one statement. In read-only mode it runs inside a READ ONLY transaction on a
 * read-only session that is always rolled back (callers must also run checkReadOnlyQuery).
 */
export const runQuery = async (sql: string, readOnly: boolean) => {
    let conn: PoolConnection | undefined;
    const start = performance.now();
    try {
        const { pool } = await getPool();
        conn = await pool.getConnection();
        if (readOnly) {
            await conn.query('SET SESSION TRANSACTION READ ONLY');
            await conn.query('START TRANSACTION READ ONLY');
        }
        const [result, fields] = (await conn.query({ sql, rowsAsArray: true, timeout: QUERY_TIMEOUT_MS })) as [
            unknown,
            FieldPacket[] | undefined,
        ];
        const durationMs = Math.round(performance.now() - start);

        if (Array.isArray(result)) {
            const rows = result as unknown[][];
            return {
                columns: (fields ?? []).map((f) => f.name),
                rows: rows.slice(0, DB_QUERY_MAX_ROWS).map((row) => row.map(serializeCell)),
                truncated: rows.length > DB_QUERY_MAX_ROWS,
                affectedRows: null,
                insertId: null,
                durationMs,
            };
        }
        const header = result as ResultSetHeader;
        return {
            columns: [],
            rows: [],
            truncated: false,
            affectedRows: header.affectedRows ?? 0,
            insertId: header.insertId || null,
            durationMs,
        };
    } catch (error) {
        return wrapDbError(error);
    } finally {
        if (conn) {
            if (readOnly) {
                //never return a read-only session to the pool
                await conn.query('ROLLBACK').catch(() => {});
                conn.destroy();
            } else {
                conn.release();
            }
        }
    }
};

//=============================================================
//== Row editing
//=============================================================
const buildKeyWhere = (columns: DbColumnInfo[], key: DbRowKey) => {
    const pkColumns = columns.filter((c) => c.isPrimaryKey);
    if (!pkColumns.length) {
        throw new DbUserError('This table has no primary key, so rows can only be changed with SQL queries.');
    }
    const parts: string[] = [];
    const values: unknown[] = [];
    for (const col of pkColumns) {
        if (!(col.name in key)) throw new DbUserError(`Missing primary key column "${col.name}".`);
        const val = key[col.name];
        if (val === null) {
            parts.push(`${mysql.escapeId(col.name)} IS NULL`);
        } else {
            parts.push(`${mysql.escapeId(col.name)} = ?`);
            values.push(val);
        }
    }
    return { sql: parts.join(' AND '), values };
};

const validateValues = (columns: DbColumnInfo[], values: Record<string, unknown>) => {
    const byName = new Map(columns.map((c) => [c.name, c]));
    const entries = Object.entries(values);
    if (!entries.length) throw new DbUserError('No values to save.');
    for (const [name, val] of entries) {
        const col = byName.get(name);
        if (!col) throw new DbUserError(`Unknown column "${name}".`);
        if (/blob|binary/.test(col.dataType)) throw new DbUserError(`Binary column "${name}" can't be edited here.`);
        if (val !== null && typeof val !== 'string' && typeof val !== 'number' && typeof val !== 'boolean') {
            throw new DbUserError(`Invalid value for "${name}".`);
        }
    }
    return entries;
};

export const updateRow = async (table: string, key: DbRowKey, changes: Record<string, unknown>) => {
    const columns = await getTableColumns(table);
    const entries = validateValues(columns, changes);
    const where = buildKeyWhere(columns, key);
    try {
        const { pool } = await getPool();
        const [result] = await pool.query<ResultSetHeader>({
            sql: `UPDATE ${mysql.escapeId(table)} SET ${entries.map(([c]) => `${mysql.escapeId(c)} = ?`).join(', ')} WHERE ${where.sql} LIMIT 1`,
            values: [...entries.map(([, v]) => v), ...where.values],
            timeout: QUERY_TIMEOUT_MS,
        });
        return result.affectedRows;
    } catch (error) {
        return wrapDbError(error);
    }
};

export const deleteRow = async (table: string, key: DbRowKey) => {
    const columns = await getTableColumns(table);
    const where = buildKeyWhere(columns, key);
    try {
        const { pool } = await getPool();
        const [result] = await pool.query<ResultSetHeader>({
            sql: `DELETE FROM ${mysql.escapeId(table)} WHERE ${where.sql} LIMIT 1`,
            values: where.values,
            timeout: QUERY_TIMEOUT_MS,
        });
        return result.affectedRows;
    } catch (error) {
        return wrapDbError(error);
    }
};

export const insertRow = async (table: string, values: Record<string, unknown>) => {
    const columns = await getTableColumns(table);
    const entries = validateValues(columns, values);
    try {
        const { pool } = await getPool();
        const [result] = await pool.query<ResultSetHeader>({
            sql: `INSERT INTO ${mysql.escapeId(table)} (${entries.map(([c]) => mysql.escapeId(c)).join(', ')}) VALUES (${entries.map(() => '?').join(', ')})`,
            values: entries.map(([, v]) => v),
            timeout: QUERY_TIMEOUT_MS,
        });
        return result.affectedRows;
    } catch (error) {
        return wrapDbError(error);
    }
};
