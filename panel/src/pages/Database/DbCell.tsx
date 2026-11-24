import type { DbCellValue } from '@shared/databaseApiTypes';
import { isDbCellMarker } from '@shared/databaseApiTypes';
import { useLocale } from '@/hooks/locale';

const MAX_DISPLAY_CHARS = 200;

/**
 * Renders one cell of a result grid.
 */
export default function DbCell({ value }: { value: DbCellValue }) {
    const { t } = useLocale();
    if (value === null) {
        return <span className="text-muted-foreground/70 italic">{t('panel.database.null_label')}</span>;
    }
    if (isDbCellMarker(value)) {
        const label =
            value.$kind === 'binary'
                ? t('panel.database.binary_value', { bytes: value.bytes })
                : t('panel.database.truncated_value', { length: value.length });
        const title = value.$kind === 'binary' ? `0x${value.hex}` : value.preview.slice(0, 2000);
        return (
            <span className="text-muted-foreground italic" title={title}>
                {label}
            </span>
        );
    }
    const str = String(value);
    const display = str.length > MAX_DISPLAY_CHARS ? `${str.slice(0, MAX_DISPLAY_CHARS)}…` : str;
    return <span title={str.length > 40 ? str.slice(0, 2000) : undefined}>{display}</span>;
}
