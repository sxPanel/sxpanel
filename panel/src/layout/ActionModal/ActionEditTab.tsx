import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { GenericApiOkResp } from '@shared/genericApiTypes';
import type { ApiChangeBanDurationReqSchema } from '@shared/historyApiSchemas';
import { useAdminPerms } from '@/hooks/auth';
import { Loader2Icon } from 'lucide-react';
import { useBackendApi } from '@/hooks/fetch';
import { useLocale } from '@/hooks/locale';

type DatabaseActionBanType = {
    id: string;
    revocation?: unknown;
};

type ActionEditTabProps = {
    action: DatabaseActionBanType;
    refreshModalData: () => void;
};

export default function ActionEditTab({ action, refreshModalData }: ActionEditTabProps) {
    const { t } = useLocale();
    const [isChangingDuration, setIsChangingDuration] = useState(false);
    const [currentDuration, setCurrentDuration] = useState('2 days');
    const [customUnits, setCustomUnits] = useState('days');
    const customMultiplierRef = useRef<HTMLInputElement>(null);
    const { hasPerm } = useAdminPerms();

    const changeDurationApi = useBackendApi<GenericApiOkResp, ApiChangeBanDurationReqSchema>({
        method: 'POST',
        path: `/history/changeBanDuration`,
    });

    const doChangeDuration = () => {
        const duration =
            currentDuration === 'custom'
                ? `${customMultiplierRef.current?.value ?? '1'} ${customUnits}`
                : currentDuration;
        setIsChangingDuration(true);
        changeDurationApi({
            data: { actionId: action.id, duration },
            toastLoadingMessage: t('panel.action_modal.edit.changing'),
            genericHandler: {
                successMsg: t('panel.action_modal.edit.success'),
            },
            success: (data) => {
                setIsChangingDuration(false);
                if ('success' in data) {
                    refreshModalData();
                }
            },
        });
    };

    const hasBanPerm = hasPerm('players.ban');
    const canPermaBan = hasPerm('players.ban.permanent');
    const isRevoked = !!action.revocation;

    return (
        <div className="mb-1 flex flex-col gap-4 px-1 md:mb-4">
            <div className="space-y-2">
                <h3 className="text-xl">{t('panel.action_modal.edit.title')}</h3>
                <p className="text-muted-foreground text-sm">{t('panel.action_modal.edit.description')}</p>
                {isRevoked ? (
                    <p className="text-warning-inline text-sm">{t('panel.action_modal.edit.revoked_warning')}</p>
                ) : (
                    <>
                        <div className="space-y-1">
                            <Label htmlFor="durationSelect" className="sr-only">
                                {t('panel.action_modal.edit.duration_label')}
                            </Label>
                            <Select
                                onValueChange={setCurrentDuration}
                                value={currentDuration}
                                disabled={isChangingDuration}
                            >
                                <SelectTrigger id="durationSelect" className="tracking-wide">
                                    <SelectValue placeholder={t('panel.action_modal.edit.select_duration')} />
                                </SelectTrigger>
                                <SelectContent className="tracking-wide">
                                    <SelectItem value="custom" className="font-bold">
                                        {t('panel.player_modal.ban.duration.custom')}
                                    </SelectItem>
                                    <SelectItem value="2 hours">
                                        {t('panel.player_modal.ban.duration.hours_2')}
                                    </SelectItem>
                                    <SelectItem value="8 hours">
                                        {t('panel.player_modal.ban.duration.hours_8')}
                                    </SelectItem>
                                    <SelectItem value="1 day">{t('panel.player_modal.ban.duration.day_1')}</SelectItem>
                                    <SelectItem value="2 days">
                                        {t('panel.player_modal.ban.duration.days_2')}
                                    </SelectItem>
                                    <SelectItem value="1 week">
                                        {t('panel.player_modal.ban.duration.week_1')}
                                    </SelectItem>
                                    <SelectItem value="2 weeks">
                                        {t('panel.player_modal.ban.duration.weeks_2')}
                                    </SelectItem>
                                    {canPermaBan && (
                                        <SelectItem value="permanent" className="font-bold">
                                            {t('panel.player_modal.ban.duration.permanent')}
                                        </SelectItem>
                                    )}
                                </SelectContent>
                            </Select>
                            <div className="flex flex-row gap-2">
                                <Input
                                    type="number"
                                    placeholder="123"
                                    min={1}
                                    max={99}
                                    disabled={currentDuration !== 'custom' || isChangingDuration}
                                    ref={customMultiplierRef}
                                />
                                <Select onValueChange={setCustomUnits} value={customUnits}>
                                    <SelectTrigger
                                        className="tracking-wide"
                                        disabled={currentDuration !== 'custom' || isChangingDuration}
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="tracking-wide">
                                        <SelectItem value="hours">
                                            {t('panel.player_modal.ban.duration.unit_hours')}
                                        </SelectItem>
                                        <SelectItem value="days">
                                            {t('panel.player_modal.ban.duration.unit_days')}
                                        </SelectItem>
                                        <SelectItem value="weeks">
                                            {t('panel.player_modal.ban.duration.unit_weeks')}
                                        </SelectItem>
                                        <SelectItem value="months">
                                            {t('panel.player_modal.ban.duration.unit_months')}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <Button
                            variant="default"
                            size="xs"
                            disabled={!hasBanPerm || isChangingDuration}
                            onClick={doChangeDuration}
                        >
                            {isChangingDuration ? (
                                <span className="flex items-center leading-relaxed">
                                    <Loader2Icon className="inline h-4 animate-spin" />{' '}
                                    {t('panel.action_modal.edit.changing_btn')}
                                </span>
                            ) : hasBanPerm ? (
                                t('panel.action_modal.edit.change_btn')
                            ) : (
                                t('panel.action_modal.edit.no_permission')
                            )}
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
}
