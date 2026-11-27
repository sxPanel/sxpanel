import { Button } from '@/components/ui/button';
import useWarningBar from '@/hooks/useWarningBar';
import { cn } from '@/lib/utils';
import { BellOffIcon, CloudOffIcon, DownloadCloudIcon, ExternalLinkIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DiscordIcon } from '@/components/icons/discord-icon';
import { useLocale } from '@/hooks/locale';
import { useAdminPerms } from '@/hooks/auth';
import { navigate } from 'wouter/use-browser-location';

const LOCALSTORAGE_KEY = 'tsUpdateDismissed';
const MAJOR_DISMISSAL_TIME = 12 * 60 * 60 * 1000;
const MINOR_DISMISSAL_TIME = 48 * 60 * 60 * 1000;

const getTsUpdateDismissed = () => {
    const stored = localStorage.getItem(LOCALSTORAGE_KEY);
    if (!stored) return false;
    const parsed = parseInt(stored);
    if (isNaN(parsed)) return false;
    return parsed;
};

const checkPostponeStatus = (isImportant: boolean, tsNow = Date.now()) => {
    const tsLastDismissal = getTsUpdateDismissed();
    const maxTime = isImportant ? MAJOR_DISMISSAL_TIME : MINOR_DISMISSAL_TIME;
    if (!tsLastDismissal || tsLastDismissal + maxTime < tsNow) {
        return true;
    }
    return false;
};

type WarningBarAction =
    { kind: 'navigate'; label: string; href: string } | { kind: 'external'; label: string; href: string };

type InnerWarningBarProps = {
    titleIcon: React.ReactNode;
    title: React.ReactNode;
    description: React.ReactNode;
    isImportant: boolean;
    canPostpone: boolean;
    canHidePermanently?: boolean;
    action?: WarningBarAction;
};

function InnerWarningBar({
    titleIcon,
    title,
    description,
    isImportant,
    canPostpone,
    canHidePermanently,
    action,
}: InnerWarningBarProps) {
    const { t } = useLocale();
    const [nowMs, setNowMs] = useState(() => Date.now());

    const refreshPostponeStatus = () => {
        setNowMs(Date.now());
    };

    const postponeUpdate = () => {
        localStorage.setItem(LOCALSTORAGE_KEY, Date.now().toString());
        refreshPostponeStatus();
    };

    useEffect(() => {
        const interval = setInterval(() => {
            refreshPostponeStatus();
        }, 60_000);
        return () => clearInterval(interval);
    }, []);

    return canPostpone && !checkPostponeStatus(isImportant, nowMs) ? null : canHidePermanently &&
      window.txConsts.hideFxsUpdateNotification ? null : (
        <div className="top-navbarvh fixed z-40 flex w-full justify-center">
            <div
                className={cn(
                    'h-9 w-full overflow-hidden hover:h-40 sm:w-lg sm:rounded-b-md',
                    'flex flex-col items-center justify-center p-2',
                    'group cursor-default shadow-xl transition-[height]',
                    isImportant ? 'bg-destructive text-destructive-foreground' : 'bg-info text-info-foreground',
                )}
            >
                <h2 className="text-md group-hover:font-medium">
                    {titleIcon}
                    {title}
                </h2>

                <span className="hidden text-center text-sm group-hover:block">
                    {description}
                    <div className="mt-3 flex flex-row items-center justify-center gap-3">
                        {canPostpone && (
                            <Button
                                size="xs"
                                variant="outline"
                                onClick={() => postponeUpdate()}
                                className="border-current hover:bg-white/10"
                            >
                                <BellOffIcon className="mr-1 h-[0.9rem]" /> {t('panel.shell.warning_bar.postpone')}
                            </Button>
                        )}

                        {action?.kind === 'navigate' && (
                            <Button
                                size="xs"
                                variant="outline"
                                onClick={() => navigate(action.href)}
                                className="border-current hover:bg-white/10"
                            >
                                <DownloadCloudIcon className="mr-1 h-[0.9rem]" /> {action.label}
                            </Button>
                        )}
                        {action?.kind === 'external' && (
                            <Button size="xs" variant="outline" asChild className="border-current hover:bg-white/10">
                                <a href={action.href} target="_blank" rel="noopener noreferrer">
                                    <ExternalLinkIcon className="mr-1 inline size-3.5" /> {action.label}
                                </a>
                            </Button>
                        )}

                        <Button size="xs" variant="outline" asChild className="border-current hover:bg-white/10">
                            <a href="https://discord.gg/hUM3pQeGFc" target="_blank">
                                <DiscordIcon className="mr-1 inline size-3.5" /> {t('panel.shell.header.support')}
                            </a>
                        </Button>
                    </div>
                </span>
            </div>
        </div>
    );
}

export default function WarningBar() {
    const { t } = useLocale();
    const { offlineWarning, txUpdateData, fxUpdateData } = useWarningBar();
    const { hasPerm } = useAdminPerms();
    const canManageUpdates = hasPerm('all_permissions');

    if (offlineWarning) {
        return (
            <InnerWarningBar
                titleIcon={<CloudOffIcon className="-mt-1 mr-1 inline h-[1.2rem]" />}
                title={t('panel.shell.warning_bar.socket_lost_title')}
                description={
                    <>
                        {t('panel.shell.warning_bar.socket_lost_desc')} <br />
                        {t('panel.shell.warning_bar.socket_lost_restart')}
                    </>
                }
                isImportant={true}
                canPostpone={false}
            />
        );
    } else if (txUpdateData) {
        return (
            <InnerWarningBar
                titleIcon={<DownloadCloudIcon className="-mt-1 mr-1 inline h-[1.2rem]" />}
                title={
                    txUpdateData.isImportant
                        ? t('panel.shell.warning_bar.tx_outdated_title', { version: txUpdateData.version })
                        : t('panel.shell.warning_bar.tx_patch_title', { version: txUpdateData.version })
                }
                description={
                    txUpdateData.isImportant
                        ? t('panel.shell.warning_bar.tx_outdated_desc', { version: txUpdateData.version })
                        : t('panel.shell.warning_bar.tx_patch_desc', { version: txUpdateData.version })
                }
                isImportant={txUpdateData.isImportant}
                canPostpone={true}
                action={
                    canManageUpdates
                        ? {
                              kind: 'navigate',
                              label: t('panel.shell.warning_bar.update_now'),
                              href: '/system/panel-update',
                          }
                        : {
                              kind: 'external',
                              label: t('panel.shell.warning_bar.release_notes'),
                              href: 'https://github.com/sxPanel/sxpanel/releases',
                          }
                }
            />
        );
    } else if (fxUpdateData) {
        return (
            <InnerWarningBar
                titleIcon={<DownloadCloudIcon className="-mt-1 mr-1 inline h-[1.2rem]" />}
                title={
                    fxUpdateData.isImportant
                        ? t('panel.shell.warning_bar.fx_outdated_title')
                        : t('panel.shell.warning_bar.fx_update_title')
                }
                description={t('panel.shell.warning_bar.fx_update_desc', { version: fxUpdateData.version })}
                isImportant={fxUpdateData.isImportant}
                canPostpone={true}
                canHidePermanently={true}
                action={
                    canManageUpdates
                        ? {
                              kind: 'navigate',
                              label: t('panel.shell.warning_bar.update_fxserver'),
                              href: '/system/artifacts',
                          }
                        : undefined
                }
            />
        );
    } else {
        return null;
    }
}
