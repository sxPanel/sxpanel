import { useCallback, useMemo } from 'react';
import { useBackendApi, ApiTimeout } from '@/hooks/fetch';
import type {
    DbQueryResp,
    DbRowActionResp,
    DbStatusResp,
    DbTableDataResp,
    DbTablesResp,
    DbCellValue,
    DbColumnInfo,
    DbRowKey,
} from '@shared/databaseApiTypes';
import { isDbCellMarker } from '@shared/databaseApiTypes';

type Ok<T> = Exclude<T, { error: string }>;
export type DbResult<T> = { ok: true; data: Ok<T> } | { ok: false; error: string };

/**
 * Wraps a useBackendApi call into a promise of { ok, data | error }.
 */
const useDbCall = <Resp extends object, Req extends object = object>(method: 'GET' | 'POST', path: string) => {
    const api = useBackendApi<Resp, Req>({ method, path });
    return useCallback(
        (opts: { queryParams?: Record<string, string | number | undefined>; data?: Req; timeout?: ApiTimeout }) =>
            new Promise<DbResult<Resp>>((resolve) => {
                api({
                    ...opts,
                    timeout: opts.timeout ?? ApiTimeout.REALLY_LONG,
                    success: (data) => {
                        if (data && 'error' in data && typeof (data as any).error === 'string') {
                            resolve({ ok: false, error: (data as any).error });
                        } else {
                            resolve({ ok: true, data: data as Ok<Resp> });
                        }
                    },
                    error: (msg) => resolve({ ok: false, error: msg }),
                });
            }),
        [api],
    );
};

export const useDbApi = () => {
    const status = useDbCall<DbStatusResp>('GET', '/database/status');
    const tables = useDbCall<DbTablesResp>('GET', '/database/tables');
    const tableData = useDbCall<DbTableDataResp>('GET', '/database/table');
    const query = useDbCall<DbQueryResp, { sql: string }>('POST', '/database/query');
    const row = useDbCall<DbRowActionResp, Record<string, unknown>>('POST', '/database/row');
    return useMemo(() => ({ status, tables, tableData, query, row }), [status, tables, tableData, query, row]);
};

/**
 * Builds the primary key of a row, or null if the table has none.
 */
export const getRowKey = (columns: DbColumnInfo[], row: DbCellValue[]): DbRowKey | null => {
    const key: DbRowKey = {};
    let hasPk = false;
    for (let i = 0; i < columns.length; i++) {
        if (!columns[i].isPrimaryKey) continue;
        const val = row[i];
        if (isDbCellMarker(val) || typeof val === 'boolean') return null;
        key[columns[i].name] = val;
        hasPk = true;
    }
    return hasPk ? key : null;
};
