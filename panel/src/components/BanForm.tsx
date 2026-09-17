import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useClosePlayerModal } from '@/hooks/playerModal';
import { useLocale } from '@/hooks/locale';
import { ClipboardPasteIcon, ExternalLinkIcon, Loader2Icon } from 'lucide-react';
import { useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
    DropDownSelect,
    DropDownSelectContent,
    DropDownSelectItem,
    DropDownSelectTrigger,
} from '@/components/dropDownSelect';
import { banDurationToShortString, banDurationToString, cn } from '@/lib/utils';
import { Link, useLocation } from 'wouter';
import { useBanTemplates } from '@/hooks/banTemplates';
import { useAdminPerms } from '@/hooks/auth';
import { txToast } from '@/components/TxToaster';

// Consts
const reasonTruncateLength = 150;
const ADD_NEW_SELECT_OPTION = '!add-new';
const defaultDurations = ['permanent', '2 hours', '8 hours', '1 day', '2 days', '1 week', '2 weeks'];

// Types
type BanFormRespType = {
    reason: string;
    duration: string;
};
export type BanFormType = HTMLDivElement & {
    focusReason: () => void;
    clearData: () => void;
    getData: () => BanFormRespType;
};
type BanFormProps = {
    disabled?: boolean;
    onNavigateAway?: () => void;
};

type BanFormComponentProps = BanFormProps & {
    ref?: React.Ref<BanFormType>;
};

/**
 * A form to set ban reason and duration.
 */
export default function BanForm({ disabled, onNavigateAway, ref }: BanFormComponentProps) {
    const { t } = useLocale();
    const { hasPerm } = useAdminPerms();
    const canPermaBan = hasPerm('players.ban.permanent');
    const banTemplates = useBanTemplates();
    const reasonRef = useRef<HTMLInputElement>(null);
    const customMultiplierRef = useRef<HTMLInputElement>(null);
    const setLocation = useLocation()[1];
    const [currentDuration, setCurrentDuration] = useState('2 days');
    const [customUnits, setCustomUnits] = useState('days');
    const closeModal = useClosePlayerModal();

    //Exposing methods to the parent
    useImperativeHandle(ref, () => {
        return {
            getData: () => {
                return {
                    reason: reasonRef.current?.value.trim(),
                    duration:
                        currentDuration === 'custom'
                            ? `${customMultiplierRef.current?.value} ${customUnits}`
                            : currentDuration,
                };
            },
            clearData: () => {
                if (!reasonRef.current || !customMultiplierRef.current) return;
                reasonRef.current.value = '';
                customMultiplierRef.current.value = '';
                setCurrentDuration('2 days');
                setCustomUnits('days');
            },
            focusReason: () => {
                reasonRef.current?.focus();
            },
        } as BanFormType;
    }, [reasonRef, customMultiplierRef, currentDuration, customUnits]);

    const handleTemplateSelectChange = (value: string) => {
        if (value === ADD_NEW_SELECT_OPTION) {
            setLocation('/settings/ban-templates');
            onNavigateAway?.();
        } else {
            if (!banTemplates) return;
            const template = banTemplates.find((template) => template.id === value);
            if (!template) return;

            if (template.duration === 'permanent' && !canPermaBan) {
                txToast.warning(t('panel.player_modal.ban.no_permission_permanent'));
                return;
            }

            const processedDuration = banDurationToString(template.duration);
            if (defaultDurations.includes(processedDuration)) {
                setCurrentDuration(processedDuration);
            } else if (typeof template.duration === 'object') {
                setCurrentDuration('custom');
                customMultiplierRef.current!.value = template.duration.value.toString();
                setCustomUnits(template.duration.unit);
            }

            reasonRef.current!.value = template.reason;
            setTimeout(() => {
                reasonRef.current!.focus();
            }, 50);
        }
    };

    //Ban templates render optimization
    const processedTemplates = useMemo(() => {
        if (!banTemplates) return;
        return banTemplates.map((template) => {
            const duration = banDurationToShortString(template.duration);
            const reason =
                template.reason.length > reasonTruncateLength
                    ? template.reason.slice(0, reasonTruncateLength - 3) + '...'
                    : template.reason;
            return (
                <DropDownSelectItem
                    key={template.id}
                    value={template.id}
                    className="focus:bg-secondary focus:text-secondary-foreground"
                >
                    <span className="inline-block min-w-[4ch] pr-1 font-mono opacity-75">{duration}</span> {reason}
                </DropDownSelectItem>
            );
        });
    }, [banTemplates]);

    // Simplifying the jsx below
    let banTemplatesContentNode: React.ReactNode;
    if (!Array.isArray(banTemplates)) {
        banTemplatesContentNode = (
            <div className="text-secondary-foreground p-4 text-center">
                <Loader2Icon className="inline size-6 animate-spin" />
            </div>
        );
    } else {
        if (!banTemplates.length) {
            banTemplatesContentNode = (
                <div className="text-warning-inline p-4 text-center">
                    {t('panel.player_modal.ban.no_templates')} <br />
                    <Link
                        href="/settings/ban-templates"
                        className="hover:text-accent cursor-pointer underline"
                        onClick={() => {
                            closeModal();
                        }}
                    >
                        {t('panel.player_modal.ban.add_template')}
                        <ExternalLinkIcon className="mr-1 inline h-4" />
                    </Link>
                </div>
            );
        } else {
            banTemplatesContentNode = (
                <>
                    {processedTemplates}
                    <DropDownSelectItem value={ADD_NEW_SELECT_OPTION} className="text-warning-inline font-bold">
                        {t('panel.player_modal.ban.add_template')}
                        <ExternalLinkIcon className="mr-1 inline h-4" />
                    </DropDownSelectItem>
                </>
            );
        }
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3">
                <Label htmlFor="banReason">{t('panel.player_modal.ban.reason_label')}</Label>
                <div className="flex gap-1">
                    <Input
                        id="banReason"
                        ref={reasonRef}
                        placeholder={t('panel.player_modal.ban.reason_placeholder')}
                        className="w-full"
                        disabled={disabled}
                    />
                    <DropDownSelect onValueChange={handleTemplateSelectChange} disabled={disabled}>
                        <DropDownSelectTrigger className="tracking-wide">
                            <button
                                className={cn(
                                    'inline-flex size-10 shrink-0 items-center justify-center rounded-md',
                                    'ring-offset-background focus-visible:ring-ring transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden',
                                    'border bg-black/20 shadow-xs',
                                    'hover:bg-primary hover:text-primary-foreground hover:border-primary',
                                    'disabled:cursor-not-allowed disabled:opacity-50',
                                )}
                            >
                                <ClipboardPasteIcon className="size-5" />
                            </button>
                        </DropDownSelectTrigger>
                        <DropDownSelectContent
                            className="w-[calc(100vw-1rem)] tracking-wide sm:max-w-(--breakpoint-sm)"
                            align="end"
                        >
                            {banTemplatesContentNode}
                        </DropDownSelectContent>
                    </DropDownSelect>
                </div>
            </div>
            <div className="flex flex-col gap-3">
                <Label htmlFor="durationSelect">{t('panel.player_modal.ban.duration_label')}</Label>
                <div className="space-y-1">
                    <Select onValueChange={setCurrentDuration} value={currentDuration} disabled={disabled}>
                        <SelectTrigger id="durationSelect" className="tracking-wide">
                            <SelectValue placeholder={t('panel.player_modal.ban.select_duration')} />
                        </SelectTrigger>
                        <SelectContent className="tracking-wide">
                            <SelectItem value="custom" className="font-bold">
                                {t('panel.player_modal.ban.duration.custom')}
                            </SelectItem>
                            <SelectItem value="2 hours">{t('panel.player_modal.ban.duration.hours_2')}</SelectItem>
                            <SelectItem value="8 hours">{t('panel.player_modal.ban.duration.hours_8')}</SelectItem>
                            <SelectItem value="1 day">{t('panel.player_modal.ban.duration.day_1')}</SelectItem>
                            <SelectItem value="2 days">{t('panel.player_modal.ban.duration.days_2')}</SelectItem>
                            <SelectItem value="1 week">{t('panel.player_modal.ban.duration.week_1')}</SelectItem>
                            <SelectItem value="2 weeks">{t('panel.player_modal.ban.duration.weeks_2')}</SelectItem>
                            {canPermaBan && (
                                <SelectItem value="permanent" className="font-bold">
                                    {t('panel.player_modal.ban.duration.permanent')}
                                </SelectItem>
                            )}
                        </SelectContent>
                    </Select>
                    <div className="flex flex-row gap-2">
                        <Input
                            id="durationMultiplier"
                            type="number"
                            placeholder="123"
                            required
                            disabled={currentDuration !== 'custom' || disabled}
                            ref={customMultiplierRef}
                        />
                        <Select onValueChange={setCustomUnits} value={customUnits}>
                            <SelectTrigger
                                className="tracking-wide"
                                id="durationUnits"
                                disabled={currentDuration !== 'custom' || disabled}
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="tracking-wide">
                                <SelectItem value="hours">{t('panel.player_modal.ban.duration.unit_hours')}</SelectItem>
                                <SelectItem value="days">{t('panel.player_modal.ban.duration.unit_days')}</SelectItem>
                                <SelectItem value="weeks">{t('panel.player_modal.ban.duration.unit_weeks')}</SelectItem>
                                <SelectItem value="months">
                                    {t('panel.player_modal.ban.duration.unit_months')}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </div>
        </div>
    );
}
