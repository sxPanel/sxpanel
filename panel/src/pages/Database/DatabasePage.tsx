import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangleIcon, DatabaseIcon, Loader2Icon, RefreshCwIcon, TableIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLocale } from '@/hooks/locale';
import { cn } from '@/lib/utils';
import type { DbColumnInfo, DbConnectionInfo, DbTableSummary } from '@shared/databaseApiTypes';
import { useDbApi } from './dbApi';
import DataTab from './DataTab';
import StructureTab from './StructureTab';
import QueryTab from './QueryTab';

const formatBytes = (bytes: number | null) => {
    if (bytes === null) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
};

/**
 * Database browser (HeidiSQL-style) for the server's own database,
 * using the mysql_connection_string from server.cfg.
 */
export default function DatabasePage() {
    const { t } = useLocale();
    const dbApi = useDbApi();
    const [connection, setConnection] = useState<DbConnectionInfo | null>(null);
    const [canEdit, setCanEdit] = useState(false);
    const [tables, setTables] = useState<DbTableSummary[] | null>(null);
    const [fatalError, setFatalError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [tableFilter, setTableFilter] = useState('');
    const [selected, setSelected] = useState<string | null>(null);
    const [tab, setTab] = useState('data');
    const [columns, setColumns] = useState<DbColumnInfo[]>([]);

    const loadAll = useCallback(async () => {
        setIsLoading(true);
        const status = await dbApi.status({});
        if (!status.ok) {
            setFatalError(status.error);
            setIsLoading(false);
            return;
        }
        setConnection(status.data.connection);
        setCanEdit(status.data.canEdit);
        const tablesRes = await dbApi.tables({});
        setIsLoading(false);
        if (!tablesRes.ok) {
            setFatalError(tablesRes.error);
            return;
        }
        setFatalError(null);
        setTables(tablesRes.data.tables);
    }, [dbApi]);

    useEffect(() => {
        loadAll();
    }, [loadAll]);

    const filteredTables = useMemo(() => {
        if (!tables) return [];
        const filter = tableFilter.trim().toLowerCase();
        return filter ? tables.filter((tb) => tb.name.toLowerCase().includes(filter)) : tables;
    }, [tables, tableFilter]);

    const selectTable = (name: string) => {
        setSelected(name);
        setColumns([]);
        if (tab === 'query') setTab('data');
    };

    const hint = connection
        ? t('panel.database.connection_hint', {
              user: connection.user,
              host: connection.host,
              port: connection.port,
              database: connection.database,
              version: connection.serverVersion,
          })
        : null;

    return (
        <div className="h-contentvh flex w-full min-w-96 flex-col gap-3 px-2 md:px-0">
            {/* Header band */}
            <div className="border-border/60 bg-background shrink-0 rounded-xl border">
                <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="bg-secondary/50 text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-xl">
                            <DatabaseIcon className="size-5" />
                        </div>
                        <div className="min-w-0">
                            <h1 className="text-foreground flex items-center gap-2 text-lg font-semibold tracking-tight">
                                {t('panel.database.title')}
                                {connection && !canEdit && (
                                    <span className="bg-secondary text-muted-foreground rounded-md px-1.5 py-0.5 text-xs font-medium">
                                        {t('panel.database.read_only_badge')}
                                    </span>
                                )}
                            </h1>
                            {hint && <p className="text-muted-foreground mt-0.5 truncate font-mono text-xs">{hint}</p>}
                        </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={loadAll} disabled={isLoading}>
                        {isLoading ? (
                            <Loader2Icon className="mr-1.5 size-4 animate-spin" />
                        ) : (
                            <RefreshCwIcon className="mr-1.5 size-4" />
                        )}
                        {t('panel.database.refresh')}
                    </Button>
                </div>
            </div>

            {fatalError ? (
                <div
                    className="border-destructive/40 bg-destructive/10 flex items-center justify-center gap-2 rounded-xl border p-6 text-center"
                    role="alert"
                >
                    <AlertTriangleIcon className="text-destructive-inline size-5 shrink-0" />
                    <span className="text-destructive-inline text-sm">{fatalError}</span>
                </div>
            ) : !tables && isLoading ? (
                <div className="text-muted-foreground flex min-h-96 items-center justify-center">
                    <Loader2Icon className="size-8 animate-spin" />
                </div>
            ) : (
                <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row">
                    {/* Table list */}
                    <aside className="border-border/60 bg-background flex max-h-64 shrink-0 flex-col rounded-xl border md:max-h-none md:w-64">
                        <div className="border-border/60 border-b p-2">
                            <Input
                                className="h-8"
                                placeholder={t('panel.database.search_tables')}
                                value={tableFilter}
                                onChange={(e) => setTableFilter(e.target.value)}
                            />
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto p-1">
                            {filteredTables.map((tb) => (
                                <button
                                    key={tb.name}
                                    onClick={() => selectTable(tb.name)}
                                    className={cn(
                                        'hover:bg-secondary/60 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                                        selected === tb.name && 'bg-secondary text-foreground',
                                    )}
                                    title={tb.comment || undefined}
                                >
                                    <TableIcon className="text-muted-foreground size-3.5 shrink-0" />
                                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{tb.name}</span>
                                    <span className="text-muted-foreground shrink-0 text-[10px]">
                                        {tb.rows !== null
                                            ? t('panel.database.rows_estimate', { count: tb.rows.toLocaleString() })
                                            : formatBytes(tb.dataBytes)}
                                    </span>
                                </button>
                            ))}
                            {!filteredTables.length && (
                                <p className="text-muted-foreground p-3 text-center text-xs">
                                    {t('panel.database.no_tables')}
                                </p>
                            )}
                        </div>
                    </aside>

                    {/* Main area */}
                    <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 min-w-0 flex-1 flex-col">
                        <TabsList className="w-fit shrink-0">
                            <TabsTrigger value="data" disabled={!selected}>
                                {t('panel.database.tab_data')}
                            </TabsTrigger>
                            <TabsTrigger value="structure" disabled={!selected}>
                                {t('panel.database.tab_structure')}
                            </TabsTrigger>
                            <TabsTrigger value="query">{t('panel.database.tab_query')}</TabsTrigger>
                        </TabsList>

                        {!selected && tab !== 'query' ? (
                            <div className="border-border/60 text-muted-foreground mt-2 flex flex-1 items-center justify-center rounded-xl border border-dashed p-8 text-sm">
                                {t('panel.database.select_table')}
                            </div>
                        ) : (
                            <>
                                <TabsContent value="data" className="mt-2 flex min-h-0 flex-1 flex-col">
                                    {selected && (
                                        <DataTab table={selected} canEdit={canEdit} onColumnsLoaded={setColumns} />
                                    )}
                                </TabsContent>
                                <TabsContent value="structure" className="mt-2 min-h-0 flex-1 overflow-auto">
                                    <StructureTab columns={columns} />
                                </TabsContent>
                            </>
                        )}
                        <TabsContent
                            value="query"
                            forceMount
                            className="mt-2 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
                        >
                            <QueryTab
                                canEdit={canEdit}
                                initialSql={selected ? `SELECT * FROM \`${selected}\` LIMIT 100;` : 'SHOW TABLES;'}
                            />
                        </TabsContent>
                    </Tabs>
                </div>
            )}
        </div>
    );
}
