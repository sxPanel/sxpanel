/**
 * Types for the Database page API (core/routes/database).
 */

/** A cell as sent to the panel. Binary and oversized values are replaced by a read-only marker. */
export type DbCellValue = string | number | boolean | null | DbCellMarker;
export type DbCellMarker =
    { $kind: 'binary'; bytes: number; hex: string } | { $kind: 'truncated'; length: number; preview: string };

export const isDbCellMarker = (val: unknown): val is DbCellMarker =>
    typeof val === 'object' && val !== null && '$kind' in val;

export type DbConnectionInfo = {
    host: string;
    port: number;
    database: string;
    user: string;
    serverVersion: string;
    source: 'server.cfg' | 'startupArgs';
};

export type DbTableSummary = {
    name: string;
    engine: string | null;
    rows: number | null; //estimate from information_schema
    dataBytes: number | null;
    comment: string;
};

export type DbColumnInfo = {
    name: string;
    type: string; //full column type, eg varchar(64)
    dataType: string; //base type, eg varchar
    nullable: boolean;
    defaultValue: string | null;
    isPrimaryKey: boolean;
    isAutoIncrement: boolean;
    extra: string;
    comment: string;
};

export type DbErrorResp = { error: string };

export type DbStatusResp =
    | DbErrorResp
    | {
          connection: DbConnectionInfo;
          canEdit: boolean;
      };

export type DbTablesResp = DbErrorResp | { tables: DbTableSummary[] };

export type DbTableDataResp =
    | DbErrorResp
    | {
          table: string;
          columns: DbColumnInfo[];
          rows: DbCellValue[][];
          total: number;
          page: number;
          pageSize: number;
      };

export type DbQueryResp =
    | DbErrorResp
    | {
          columns: string[];
          rows: DbCellValue[][];
          truncated: boolean; //more rows than DB_QUERY_MAX_ROWS
          affectedRows: number | null;
          insertId: number | null;
          durationMs: number;
      };

export type DbRowActionResp = DbErrorResp | { success: true; affectedRows: number };

export type DbRowKey = Record<string, string | number | null>;

export const DB_PAGE_SIZES = [25, 50, 100, 250] as const;
export const DB_QUERY_MAX_ROWS = 1000;
