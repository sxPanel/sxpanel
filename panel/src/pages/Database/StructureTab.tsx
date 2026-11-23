import { useLocale } from '@/hooks/locale';
import type { DbColumnInfo } from '@shared/databaseApiTypes';

export default function StructureTab({ columns }: { columns: DbColumnInfo[] }) {
    const { t } = useLocale();
    const headers = [
        t('panel.database.col_name'),
        t('panel.database.col_type'),
        t('panel.database.col_nullable'),
        t('panel.database.col_default'),
        t('panel.database.col_key'),
        t('panel.database.col_extra'),
        t('panel.database.col_comment'),
    ];
    return (
        <div className="border-border/60 bg-background overflow-auto rounded-xl border">
            <table className="w-full text-xs">
                <thead className="bg-secondary/60">
                    <tr>
                        {headers.map((h) => (
                            <th key={h} className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                                {h}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {columns.map((col) => (
                        <tr key={col.name} className="border-border/40 border-t">
                            <td className="px-2 py-1 font-mono">{col.name}</td>
                            <td className="px-2 py-1 font-mono">{col.type}</td>
                            <td className="px-2 py-1">
                                {col.nullable ? t('panel.database.yes') : t('panel.database.no')}
                            </td>
                            <td className="px-2 py-1 font-mono">
                                {col.defaultValue ?? (
                                    <span className="text-muted-foreground/70 italic">
                                        {t('panel.database.null_label')}
                                    </span>
                                )}
                            </td>
                            <td className="text-warning-inline px-2 py-1">{col.isPrimaryKey ? 'PRIMARY' : ''}</td>
                            <td className="px-2 py-1 font-mono">{col.extra}</td>
                            <td className="text-muted-foreground px-2 py-1">{col.comment}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
