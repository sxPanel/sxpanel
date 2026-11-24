import { useEffect, useState } from 'react';
import { Loader2Icon } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { useLocale } from '@/hooks/locale';
import type { DbCellValue, DbColumnInfo } from '@shared/databaseApiTypes';
import { isDbCellMarker } from '@shared/databaseApiTypes';

type FieldState = { text: string; isNull: boolean; editable: boolean };

const LONG_TYPES = /text|json|blob/;
const BINARY_TYPES = /blob|binary/;

const toFieldState = (col: DbColumnInfo, value: DbCellValue | undefined, isInsert: boolean): FieldState => {
    const editable = !BINARY_TYPES.test(col.dataType) && !isDbCellMarker(value);
    if (isInsert) return { text: '', isNull: false, editable };
    if (value === null || value === undefined) return { text: '', isNull: true, editable };
    if (isDbCellMarker(value)) return { text: '', isNull: false, editable: false };
    return { text: String(value), isNull: false, editable };
};

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    table: string;
    columns: DbColumnInfo[];
    row: DbCellValue[] | null; //null = insert
    onSave: (values: Record<string, string | null>) => Promise<boolean>;
};

/**
 * Edits (or inserts) one row. Only changed fields are sent on update.
 */
export default function RowEditorDialog({ open, onOpenChange, table, columns, row, onSave }: Props) {
    const { t } = useLocale();
    const isInsert = row === null;
    const [fields, setFields] = useState<FieldState[]>([]);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        setFields(columns.map((col, i) => toFieldState(col, row?.[i], isInsert)));
    }, [open, columns, row, isInsert]);

    const updateField = (idx: number, patch: Partial<FieldState>) => {
        setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
    };

    const handleSave = async () => {
        const values: Record<string, string | null> = {};
        columns.forEach((col, i) => {
            const field = fields[i];
            if (!field?.editable) return;
            const newVal = field.isNull ? null : field.text;
            if (isInsert) {
                //skip empty auto-increment / defaulted columns so the database fills them
                if (newVal === '' && (col.isAutoIncrement || col.defaultValue !== null || col.nullable)) return;
                values[col.name] = newVal;
            } else {
                const original = toFieldState(col, row[i], false);
                const oldVal = original.isNull ? null : original.text;
                if (newVal !== oldVal) values[col.name] = newVal;
            }
        });
        setIsSaving(true);
        const ok = await onSave(values);
        setIsSaving(false);
        if (ok) onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>
                        {isInsert ? t('panel.database.add_row') : t('panel.database.edit_row')}{' '}
                        <span className="text-muted-foreground font-mono text-sm">{table}</span>
                    </DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-3">
                    {columns.map((col, i) => {
                        const field = fields[i];
                        if (!field) return null;
                        const isLong = LONG_TYPES.test(col.dataType) || field.text.length > 80;
                        const placeholder =
                            isInsert && col.isAutoIncrement ? t('panel.database.auto_increment_hint') : undefined;
                        return (
                            <div key={col.name} className="flex flex-col gap-1">
                                <div className="flex items-center justify-between gap-2">
                                    <label className="font-mono text-sm" htmlFor={`dbfield-${i}`}>
                                        {col.name}
                                        <span className="text-muted-foreground ml-2 text-xs">{col.type}</span>
                                        {col.isPrimaryKey && (
                                            <span className="text-warning-inline ml-1 text-xs">PK</span>
                                        )}
                                    </label>
                                    {col.nullable && field.editable && (
                                        <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
                                            <Checkbox
                                                checked={field.isNull}
                                                onCheckedChange={(v) => updateField(i, { isNull: v === true })}
                                            />
                                            {t('panel.database.null_label')}
                                        </label>
                                    )}
                                </div>
                                {!field.editable ? (
                                    <p className="text-muted-foreground text-xs italic">
                                        {t('panel.database.not_editable')}
                                    </p>
                                ) : isLong ? (
                                    <Textarea
                                        id={`dbfield-${i}`}
                                        className="min-h-20 font-mono text-xs"
                                        value={field.text}
                                        disabled={field.isNull}
                                        placeholder={placeholder}
                                        onChange={(e) => updateField(i, { text: e.target.value })}
                                    />
                                ) : (
                                    <Input
                                        id={`dbfield-${i}`}
                                        className="font-mono text-xs"
                                        value={field.text}
                                        disabled={field.isNull}
                                        placeholder={placeholder}
                                        onChange={(e) => updateField(i, { text: e.target.value })}
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
                        {t('panel.database.cancel')}
                    </Button>
                    <Button onClick={handleSave} disabled={isSaving}>
                        {isSaving && <Loader2Icon className="mr-1.5 size-4 animate-spin" />}
                        {t('panel.database.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
