import { useCallback, useEffect, useState } from 'react';
import {
    ArrowDownIcon,
    ArrowUpIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    Loader2Icon,
    PencilIcon,
    PlusIcon,
    RefreshCwIcon,
    Trash2Icon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { txToast } from '@/components/TxToaster';
import { useLocale } from '@/hooks/locale';
import { useOpenConfirmDialog } from '@/hooks/dialogs';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { cn } from '@/lib/utils';
import { DB_PAGE_SIZES, type DbCellValue, type DbColumnInfo } from '@shared/databaseApiTypes';
import { getRowKey, useDbApi } from './dbApi';
import DbCell from './DbCell';
import RowEditorDialog from './RowEditorDialog';

type DataState = {
    columns: DbColumnInfo[];
    rows: DbCellValue[][];
    total: number;
};

type Props = {
    table: string;
    canEdit: boolean;
    onColumnsLoaded: (columns: DbColumnInfo[]) => void;
};

export default function DataTab({ table, canEdit, onColumnsLoaded }: Props) {
    const { t } = useLocale();
    const dbApi = useDbApi();
    const openConfirmDialog = useOpenConfirmDialog();

    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState<number>(50);
    const [order, setOrder] = useState<{ col: string; dir: 'asc' | 'desc' } | null>(null);
    const [search, setSearch] = useState('');
    const debouncedSearch = useDebouncedValue(search, 400);
    const [data, setData] = useState<DataState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [editor, setEditor] = useState<{ open: boolean; row: DbCellValue[] | null }>({ open: false, row: null });

    //Reset view when switching tables
    useEffect(() => {
        setPage(1);
        setOrder(null);
        setSearch('');
        setData(null);
    }, [table]);

    useEffect(() => {
        setPage(1);
    }, [debouncedSearch, pageSize]);

    const load = useCallback(async () => {
        setIsLoading(true);
        const res = await dbApi.tableData({
            queryParams: {
                table,
                page,
                pageSize,
                orderBy: order?.col,
                orderDir: order?.dir,
                search: debouncedSearch || undefined,
            },
        });
        setIsLoading(false);
        if (!res.ok) {
            setError(res.error);
            return;
        }
        setError(null);
        setData({ columns: res.data.columns, rows: res.data.rows, total: res.data.total });
        onColumnsLoaded(res.data.columns);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [table, page, pageSize, order, debouncedSearch]);

    useEffect(() => {
        load();
    }, [load]);

    const columns = data?.columns ?? [];
    const hasPk = columns.some((c) => c.isPrimaryKey);
    const pages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

    const toggleSort = (col: string) => {
        setOrder((prev) => {
            if (!prev || prev.col !== col) return { col, dir: 'asc' };
            if (prev.dir === 'asc') return { col, dir: 'desc' };
            return null;
        });
    };

    const handleSave = async (values: Record<string, string | null>) => {
        const isInsert = editor.row === null;
        if (!isInsert && !Object.keys(values).length) {
            txToast.info(t('panel.database.no_changes'));
            return true;
        }
        let payload: Record<string, unknown>;
        if (isInsert) {
            payload = { action: 'insert', table, values };
        } else {
            const key = getRowKey(columns, editor.row!);
            if (!key) return false;
            payload = { action: 'update', table, key, values };
        }
        const res = await dbApi.row({ data: payload });
        if (!res.ok) {
            txToast.error(res.error);
            return false;
        }
        txToast.success(isInsert ? t('panel.database.inserted') : t('panel.database.saved'));
        load();
        return true;
    };

    const handleDelete = (row: DbCellValue[]) => {
        const key = getRowKey(columns, row);
        if (!key) return;
        openConfirmDialog({
            title: t('panel.database.delete_confirm_title'),
            message: t('panel.database.delete_confirm_message', { table }),
            actionLabel: t('panel.database.delete_row'),
            confirmBtnVariant: 'destructive',
            onConfirm: async () => {
                const res = await dbApi.row({ data: { action: 'delete', table, key } });
                if (!res.ok) return txToast.error(res.error);
                txToast.success(t('panel.database.deleted'));
                load();
            },
        });
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2">
                <Input
                    className="h-8 w-64 max-w-full"
                    placeholder={t('panel.database.search_rows')}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                <Button size="sm" variant="outline" onClick={() => load()} disabled={isLoading}>
                    {isLoading ? (
                        <Loader2Icon className="mr-1.5 size-4 animate-spin" />
                    ) : (
                        <RefreshCwIcon className="mr-1.5 size-4" />
                    )}
                    {t('panel.database.refresh')}
                </Button>
                {canEdit && (
                    <Button size="sm" variant="outline" onClick={() => setEditor({ open: true, row: null })}>
                        <PlusIcon className="mr-1.5 size-4" />
                        {t('panel.database.add_row')}
                    </Button>
                )}
                {canEdit && data && !hasPk && (
                    <span className="text-muted-foreground text-xs">{t('panel.database.no_pk_hint')}</span>
                )}
            </div>

            {error && (
                <div className="border-destructive/40 bg-destructive/10 text-destructive-inline rounded-lg border p-3 text-sm">
                    {error}
                </div>
            )}

            {/* Grid */}
            <div className="border-border/60 bg-background relative min-h-0 flex-1 overflow-auto rounded-xl border">
                {!data && isLoading ? (
                    <div className="text-muted-foreground flex h-40 items-center justify-center">
                        <Loader2Icon className="size-6 animate-spin" />
                    </div>
                ) : (
                    <table className="w-full text-xs">
                        <thead className="bg-secondary/60 sticky top-0 z-10 backdrop-blur">
                            <tr>
                                {canEdit && hasPk && <th className="w-16" />}
                                {columns.map((col) => (
                                    <th
                                        key={col.name}
                                        className="hover:bg-secondary cursor-pointer px-2 py-1.5 text-left font-mono font-semibold whitespace-nowrap select-none"
                                        onClick={() => toggleSort(col.name)}
                                        title={col.type}
                                    >
                                        <span className={cn(col.isPrimaryKey && 'text-warning-inline')}>
                                            {col.name}
                                        </span>
                                        {order?.col === col.name &&
                                            (order.dir === 'asc' ? (
                                                <ArrowUpIcon className="ml-1 inline size-3" />
                                            ) : (
                                                <ArrowDownIcon className="ml-1 inline size-3" />
                                            ))}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {data?.rows.map((row, rowIdx) => (
                                <tr key={rowIdx} className="border-border/40 hover:bg-secondary/30 border-t">
                                    {canEdit && hasPk && (
                                        <td className="px-1 whitespace-nowrap">
                                            <button
                                                className="text-muted-foreground hover:text-foreground p-1"
                                                title={t('panel.database.edit_row')}
                                                onClick={() => setEditor({ open: true, row })}
                                            >
                                                <PencilIcon className="size-3.5" />
                                            </button>
                                            <button
                                                className="text-muted-foreground hover:text-destructive-inline p-1"
                                                title={t('panel.database.delete_row')}
                                                onClick={() => handleDelete(row)}
                                            >
                                                <Trash2Icon className="size-3.5" />
                                            </button>
                                        </td>
                                    )}
                                    {row.map((cell, colIdx) => (
                                        <td
                                            key={colIdx}
                                            className="max-w-xs truncate px-2 py-1 font-mono whitespace-nowrap"
                                            onDoubleClick={
                                                canEdit && hasPk ? () => setEditor({ open: true, row }) : undefined
                                            }
                                        >
                                            <DbCell value={cell} />
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
                {data && !data.rows.length && (
                    <p className="text-muted-foreground p-6 text-center text-sm">{t('panel.database.no_rows')}</p>
                )}
            </div>

            {/* Pagination */}
            {data && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-muted-foreground">
                        {t('panel.database.page_info', { page, pages, total: data.total.toLocaleString() })}
                    </span>
                    <div className="flex items-center gap-2">
                        <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                            <SelectTrigger className="h-8 w-20" aria-label={t('panel.database.page_size')}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {DB_PAGE_SIZES.map((size) => (
                                    <SelectItem key={size} value={String(size)}>
                                        {size}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={page <= 1 || isLoading}
                            onClick={() => setPage((p) => p - 1)}
                            aria-label={t('panel.database.prev')}
                        >
                            <ChevronLeftIcon className="size-4" />
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={page >= pages || isLoading}
                            onClick={() => setPage((p) => p + 1)}
                            aria-label={t('panel.database.next')}
                        >
                            <ChevronRightIcon className="size-4" />
                        </Button>
                    </div>
                </div>
            )}

            <RowEditorDialog
                open={editor.open}
                onOpenChange={(open) => setEditor((prev) => ({ ...prev, open }))}
                table={table}
                columns={columns}
                row={editor.row}
                onSave={handleSave}
            />
        </div>
    );
}
