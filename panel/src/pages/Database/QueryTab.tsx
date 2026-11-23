import { useCallback, useRef, useState } from 'react';
import { Loader2Icon, PlayIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LazyMonacoEditor } from '@/components/LazyMonacoEditor';
import { useLocale } from '@/hooks/locale';
import { useOpenConfirmDialog } from '@/hooks/dialogs';
import { DB_QUERY_MAX_ROWS, type DbCellValue } from '@shared/databaseApiTypes';
import { useDbApi } from './dbApi';
import DbCell from './DbCell';

type QueryResult = {
    columns: string[];
    rows: DbCellValue[][];
    truncated: boolean;
    affectedRows: number | null;
    insertId: number | null;
    durationMs: number;
};

const READ_KEYWORDS = /^\s*(select|show|describe|desc|explain)\b/i;

export default function QueryTab({ canEdit, initialSql }: { canEdit: boolean; initialSql: string }) {
    const { t } = useLocale();
    const dbApi = useDbApi();
    const openConfirmDialog = useOpenConfirmDialog();
    const editorRef = useRef<any>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [result, setResult] = useState<QueryResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const execute = useCallback(
        async (sql: string) => {
            setIsRunning(true);
            setError(null);
            const res = await dbApi.query({ data: { sql } });
            setIsRunning(false);
            if (!res.ok) {
                setResult(null);
                setError(res.error);
                return;
            }
            setResult(res.data);
        },
        [dbApi],
    );

    const run = useCallback(() => {
        const editor = editorRef.current;
        if (!editor) return;
        //run the selection if there is one, like HeidiSQL
        const selection = editor.getSelection();
        const selected = selection && !selection.isEmpty() ? editor.getModel()?.getValueInRange(selection) : null;
        const sql = (selected ?? editor.getValue()).trim();
        if (!sql) return;

        if (canEdit && !READ_KEYWORDS.test(sql.replace(/^(\s*(--[^\n]*\n|#[^\n]*\n|\/\*[\s\S]*?\*\/))*/, ''))) {
            openConfirmDialog({
                title: t('panel.database.query_confirm_title'),
                message: t('panel.database.query_confirm_message'),
                actionLabel: t('panel.database.run_query'),
                confirmBtnVariant: 'destructive',
                onConfirm: () => execute(sql),
            });
            return;
        }
        execute(sql);
    }, [canEdit, execute, openConfirmDialog, t]);

    //Keep the latest run() reachable from the Monaco keybinding registered on mount
    const runRef = useRef(run);
    runRef.current = run;

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={run} disabled={isRunning}>
                    {isRunning ? (
                        <Loader2Icon className="mr-1.5 size-4 animate-spin" />
                    ) : (
                        <PlayIcon className="mr-1.5 size-4" />
                    )}
                    {t('panel.database.run_query')}
                </Button>
                {!canEdit && (
                    <span className="text-muted-foreground text-xs">{t('panel.database.query_placeholder_hint')}</span>
                )}
            </div>

            <div className="border-border/60 bg-background relative h-52 shrink-0 overflow-hidden rounded-xl border">
                <div className="absolute inset-0">
                    <LazyMonacoEditor
                        height="100%"
                        language="sql"
                        defaultValue={initialSql}
                        onMount={(editor, monaco) => {
                            editorRef.current = editor;
                            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current());
                        }}
                        options={{
                            minimap: { enabled: false },
                            lineNumbers: 'on',
                            wordWrap: 'on',
                            scrollBeyondLastLine: false,
                            fontSize: 13,
                        }}
                    />
                </div>
            </div>

            {error && (
                <div className="border-destructive/40 bg-destructive/10 text-destructive-inline rounded-lg border p-3 font-mono text-xs whitespace-pre-wrap">
                    {error}
                </div>
            )}

            {result && (
                <>
                    <div className="text-muted-foreground flex flex-wrap gap-3 text-xs">
                        {result.affectedRows !== null ? (
                            <span>
                                {t('panel.database.query_affected', {
                                    count: result.affectedRows,
                                    ms: result.durationMs,
                                })}
                            </span>
                        ) : (
                            <span>
                                {t('panel.database.query_rows', { count: result.rows.length, ms: result.durationMs })}
                            </span>
                        )}
                        {result.insertId !== null && (
                            <span>{t('panel.database.query_insert_id', { id: result.insertId })}</span>
                        )}
                        {result.truncated && (
                            <span className="text-warning-inline">
                                {t('panel.database.query_truncated', { max: DB_QUERY_MAX_ROWS })}
                            </span>
                        )}
                    </div>
                    {result.columns.length > 0 && (
                        <div className="border-border/60 bg-background min-h-0 flex-1 overflow-auto rounded-xl border">
                            <table className="w-full text-xs">
                                <thead className="bg-secondary/60 sticky top-0 z-10 backdrop-blur">
                                    <tr>
                                        {result.columns.map((col, i) => (
                                            <th
                                                key={i}
                                                className="px-2 py-1.5 text-left font-mono font-semibold whitespace-nowrap"
                                            >
                                                {col}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {result.rows.map((row, rowIdx) => (
                                        <tr key={rowIdx} className="border-border/40 hover:bg-secondary/30 border-t">
                                            {row.map((cell, colIdx) => (
                                                <td
                                                    key={colIdx}
                                                    className="max-w-xs truncate px-2 py-1 font-mono whitespace-nowrap"
                                                >
                                                    <DbCell value={cell} />
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
