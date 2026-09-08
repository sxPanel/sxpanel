import { cn } from '@/lib/utils';
import { createContext, use, useState } from 'react';
import { useLocation, useRoute } from 'wouter';
import MainPageLink from '@/components/MainPageLink';
import { useAdminPerms, useAuth } from '@/hooks/auth';
import { serverNameAtom, fxRunnerStateAtom, txConfigStateAtom, useGlobalStatus } from '@/hooks/status';
import { playerCountAtom } from '@/hooks/playerlist';
import { useAtomValue } from 'jotai';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
    SlidersHorizontalIcon,
    PowerIcon,
    PowerOffIcon,
    RotateCcwIcon,
    KeyRoundIcon,
    LogOutIcon,
    ChevronDownIcon,
    ChevronUpIcon,
    MegaphoneIcon,
    BlocksIcon,
    WrenchIcon,
    XCircleIcon,
} from 'lucide-react';
import { TxConfigState } from '@shared/enums';
import { useOpenConfirmDialog, useOpenPromptDialog, useAccountModal } from '@/hooks/dialogs';
import { ApiTimeout, useBackendApi } from '@/hooks/fetch';
import { useCloseAllSheets } from '@/hooks/sheets';
import { useAddonLoader } from '@/hooks/addons';
import { useLocale } from '@/hooks/locale';
import { SIDEBAR_SECTIONS } from './sidebarConfig';
import { isPanelFeatureEnabled } from '@/lib/panelFeatures';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DiscordIcon } from '@/components/icons/discord-icon';
import { openExternalLink } from '@/lib/navigation';
import Avatar from '@/components/Avatar';
import { txToast } from '@/components/TxToaster';
import { msToShortDuration } from '@/lib/dateTime';
import { KickAllIcon } from '@/components/KickIcons';

// ─── Collapse context ─────────────────────────────────────────────────────────
const SidebarCollapsedCtx = createContext(false);
const useCollapsed = () => use(SidebarCollapsedCtx);

// ─── Sidebar nav item ────────────────────────────────────────────────────────
type SidebarNavItemProps = {
    href: string;
    icon: React.ElementType;
    label: string;
    disabled?: boolean;
};

function SidebarNavItem({ href, icon: Icon, label, disabled }: SidebarNavItemProps) {
    const [isActive] = useRoute(href);
    const [, navigate] = useLocation();
    const collapsed = useCollapsed();

    if (disabled) {
        return (
            <Tooltip>
                <TooltipTrigger
                    type="button"
                    aria-disabled="true"
                    className={cn(
                        'text-muted-foreground flex w-full cursor-not-allowed items-center rounded-md text-sm opacity-35 select-none',
                        collapsed ? 'justify-center py-2' : 'gap-3 px-3 py-2',
                    )}
                >
                    <Icon className="size-4 shrink-0" />
                    {!collapsed && <span>{label}</span>}
                </TooltipTrigger>
                <TooltipContent side="right" className="text-destructive-inline text-center">
                    {collapsed && <p className="mb-1 font-semibold">{label}</p>}
                    You do not have permission <br />
                    to access this page.
                </TooltipContent>
            </Tooltip>
        );
    }

    if (collapsed) {
        const handleCollapsedClick = (event: React.MouseEvent<HTMLButtonElement>) => {
            if (event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
            event.preventDefault();
            navigate(href);
        };

        return (
            <Tooltip>
                <TooltipTrigger
                    type="button"
                    onClick={handleCollapsedClick}
                    className={cn(
                        'flex w-full justify-center rounded-md py-2 transition-colors',
                        isActive
                            ? 'bg-accent/10 text-accent'
                            : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40',
                    )}
                >
                    <Icon className="size-4 shrink-0" />
                </TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
            </Tooltip>
        );
    }

    return (
        <MainPageLink
            href={href}
            isActive={isActive}
            className={cn(
                'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors select-none',
                isActive
                    ? 'bg-accent/10 text-accent font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40',
            )}
        >
            <Icon className="size-4 shrink-0" />
            <span className="flex-1 leading-none">{label}</span>
            {isActive && <span className="bg-accent size-1.5 shrink-0 rounded-full" />}
        </MainPageLink>
    );
}

// ─── Section group ───────────────────────────────────────────────────────────
function SidebarSection({ label, children }: { label: string; children: React.ReactNode }) {
    const collapsed = useCollapsed();
    return (
        <div className="flex flex-col gap-0.5">
            {collapsed ? (
                <div className="bg-border/40 mx-auto mt-3 h-px w-6" />
            ) : (
                <p className="text-muted-foreground/40 px-3 pt-3 pb-1 text-[10px] font-semibold tracking-[0.1em] uppercase select-none">
                    {label}
                </p>
            )}
            {children}
        </div>
    );
}

const validateSidebarScheduleInput = (input: string) => {
    if (input.startsWith('+')) {
        const minutes = parseInt(input.substring(1));
        if (isNaN(minutes) || minutes < 1 || minutes >= 1440) {
            return false;
        }
    } else {
        const [hours, minutes] = input.split(':', 2).map((x) => parseInt(x));
        if (
            typeof hours === 'undefined' ||
            isNaN(hours) ||
            hours < 0 ||
            hours > 23 ||
            typeof minutes === 'undefined' ||
            isNaN(minutes) ||
            minutes < 0 ||
            minutes > 59
        ) {
            return false;
        }
    }
    return true;
};

// ─── Server control actions (shared by the mobile sheet and the TopNav) ──────
export function useServerControls() {
    const txConfigState = useAtomValue(txConfigStateAtom);
    const fxRunnerState = useAtomValue(fxRunnerStateAtom);
    const openConfirmDialog = useOpenConfirmDialog();
    const closeAllSheets = useCloseAllSheets();
    const { hasPerm } = useAdminPerms();
    const { t } = useLocale();
    const fxsControlApi = useBackendApi({
        method: 'POST',
        path: '/fxserver/controls',
    });

    const handleControl = (action: 'start' | 'stop' | 'restart') => {
        const labels = {
            start: t('panel.sidebar.starting_server'),
            stop: t('panel.sidebar.stopping_server'),
            restart: t('panel.sidebar.restarting_server'),
        };
        const callApi = () => {
            closeAllSheets();
            fxsControlApi({ data: { action }, toastLoadingMessage: `${labels[action]}...`, timeout: ApiTimeout.LONG });
        };
        if (action === 'start') {
            callApi();
        } else {
            openConfirmDialog({
                title: labels[action],
                message: action === 'stop' ? t('panel.sidebar.confirm_stop') : t('panel.sidebar.confirm_restart'),
                onConfirm: callApi,
            });
        }
    };

    return {
        isConfigured: txConfigState === TxConfigState.Ready,
        isRunning: !fxRunnerState.isIdle,
        isAlive: fxRunnerState.isChildAlive,
        hasControlPerm: hasPerm('control.server'),
        handleControl,
    };
}

// ─── Sidebar server controls (labeled buttons) ───────────────────────────────
function SidebarServerControls() {
    const { isConfigured, isRunning, isAlive, hasControlPerm, handleControl } = useServerControls();
    const collapsed = useCollapsed();
    const { t } = useLocale();

    if (!isConfigured) {
        if (collapsed) return null;
        return (
            <p className="text-muted-foreground/50 text-center text-xs">{t('panel.sidebar.server_not_configured')}</p>
        );
    }

    if (collapsed) {
        return (
            <div className="flex flex-col items-center gap-1">
                <Tooltip>
                    <TooltipTrigger
                        type="button"
                        onClick={() => handleControl(isRunning ? 'stop' : 'start')}
                        disabled={!hasControlPerm}
                        className={cn(
                            'flex size-8 items-center justify-center rounded-md border text-xs transition-colors disabled:pointer-events-none disabled:opacity-40',
                            isRunning
                                ? 'border-destructive/40 bg-destructive/10 text-destructive-inline hover:bg-destructive/20'
                                : 'border-success/40 bg-success/10 text-success-inline hover:bg-success/20',
                        )}
                    >
                        {isRunning ? <PowerOffIcon className="size-3.5" /> : <PowerIcon className="size-3.5" />}
                    </TooltipTrigger>
                    <TooltipContent side="right">
                        {isRunning ? t('panel.sidebar.stop_server') : t('panel.sidebar.start_server')}
                    </TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger
                        type="button"
                        onClick={() => handleControl('restart')}
                        disabled={!hasControlPerm || !isAlive}
                        className="border-info/40 bg-info/10 text-info-inline hover:bg-info/20 flex size-8 items-center justify-center rounded-md border transition-colors disabled:pointer-events-none disabled:opacity-40"
                    >
                        <RotateCcwIcon className="size-3.5" />
                    </TooltipTrigger>
                    <TooltipContent side="right">{t('panel.sidebar.restart_server')}</TooltipContent>
                </Tooltip>
            </div>
        );
    }

    return (
        <div className="flex gap-1.5">
            <button
                onClick={() => handleControl(isRunning ? 'stop' : 'start')}
                disabled={!hasControlPerm}
                className={cn(
                    'flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-40',
                    isRunning
                        ? 'border-destructive/40 bg-destructive/10 text-destructive-inline hover:bg-destructive/20'
                        : 'border-success/40 bg-success/10 text-success-inline hover:bg-success/20',
                )}
                title={isRunning ? t('panel.sidebar.stop_server') : t('panel.sidebar.start_server')}
            >
                {isRunning ? <PowerOffIcon className="size-3.5" /> : <PowerIcon className="size-3.5" />}
                {isRunning ? t('panel.common.stop') : t('panel.common.start')}
            </button>

            <button
                onClick={() => handleControl('restart')}
                disabled={!hasControlPerm || !isAlive}
                className="border-info/40 bg-info/10 text-info-inline hover:bg-info/20 flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-40"
                title={t('panel.sidebar.restart_server')}
            >
                <RotateCcwIcon className="size-3.5" />
                {t('panel.common.restart')}
            </button>
        </div>
    );
}

// ─── Announce/kick-all/schedule/cancel actions (shared by the sidebar and TopNav/Dashboard) ──
export function useServerExtraActions() {
    const fxRunnerState = useAtomValue(fxRunnerStateAtom);
    const status = useGlobalStatus();
    const { hasPerm } = useAdminPerms();
    const openPromptDialog = useOpenPromptDialog();
    const closeAllSheets = useCloseAllSheets();
    const { t } = useLocale();
    const schedulerApi = useBackendApi({
        method: 'POST',
        path: '/fxserver/schedule',
    });
    const fxsCommandsApi = useBackendApi({
        method: 'POST',
        path: '/fxserver/commands',
    });

    let nextScheduledText = t('panel.common.none');
    let nextScheduledClasses = 'text-muted-foreground/75';
    let disableAddEditBtn = false;
    let isRestartSkipped = false;
    const nextRelativeMs = status?.scheduler.nextRelativeMs;
    const hasScheduledRestart = typeof nextRelativeMs === 'number';
    if (hasScheduledRestart && status) {
        const relativeTime = msToShortDuration(nextRelativeMs, { units: ['h', 'm'], delimiter: ' ' });
        const isLessThanMinute = nextRelativeMs < 60_000;
        if (status.scheduler.nextSkip) {
            nextScheduledClasses = 'text-muted-foreground line-through';
            isRestartSkipped = true;
            nextScheduledText = t('panel.common.skipped');
        } else {
            if (isLessThanMinute) {
                disableAddEditBtn = true;
                nextScheduledText = t('panel.common.now');
            } else {
                nextScheduledText = relativeTime;
            }
            nextScheduledClasses = status.scheduler.nextIsTemp ? 'text-info-inline' : 'text-warning-inline';
        }
    }

    const onScheduleSubmit = (input: string) => {
        closeAllSheets();
        if (input.includes(',')) {
            txToast.error(
                {
                    title: t('panel.sidebar.invalid_schedule_title'),
                    msg: t('panel.sidebar.invalid_schedule_msg'),
                },
                { duration: 9000 },
            );
            return;
        }
        if (!validateSidebarScheduleInput(input)) {
            txToast.error(t('panel.sidebar.invalid_schedule_time', { input }));
            return;
        }
        schedulerApi({
            data: { action: 'setNextTempSchedule', parameter: input },
            toastLoadingMessage: t('panel.sidebar.scheduling_restart'),
        });
    };

    const handleSchedule = () => {
        openPromptDialog({
            suggestions: ['+5', '+10', '+15', '+30'],
            title: t('panel.sidebar.schedule_restart_title'),
            message: t('panel.sidebar.schedule_restart_message'),
            placeholder: t('panel.sidebar.schedule_restart_placeholder'),
            required: true,
            submitLabel: hasScheduledRestart ? t('panel.common.edit') : t('panel.common.schedule'),
            onSubmit: onScheduleSubmit,
        });
    };

    const handleCancelRestart = () => {
        closeAllSheets();
        schedulerApi({
            data: { action: 'setNextSkip', parameter: true },
            toastLoadingMessage: t('panel.sidebar.cancelling_restart'),
        });
    };

    const handleAnnounce = () => {
        if (!fxRunnerState.isChildAlive) return;
        openPromptDialog({
            title: t('panel.sidebar.send_announcement_title'),
            message: t('panel.sidebar.send_announcement_message'),
            placeholder: t('panel.sidebar.announcement_placeholder'),
            submitLabel: t('panel.common.send'),
            required: true,
            onSubmit: (input) => {
                closeAllSheets();
                fxsCommandsApi({
                    data: { action: 'admin_broadcast', parameter: input },
                    toastLoadingMessage: t('panel.sidebar.sending_announcement'),
                });
            },
        });
    };

    const handleKickAll = () => {
        if (!fxRunnerState.isChildAlive) return;
        openPromptDialog({
            title: t('panel.sidebar.kick_all_title'),
            message: t('panel.sidebar.kick_all_message'),
            placeholder: t('panel.sidebar.kick_reason_placeholder'),
            submitLabel: t('panel.common.send'),
            onSubmit: (input) => {
                closeAllSheets();
                fxsCommandsApi({
                    data: { action: 'kick_all', parameter: input },
                    toastLoadingMessage: t('panel.sidebar.kicking_players'),
                });
            },
        });
    };

    const hasControlPerm = hasPerm('control.server');
    const hasAnnouncementPerm = hasPerm('announcement');
    const canAdjustRestart = hasControlPerm && !disableAddEditBtn;
    const canCancelRestart = hasControlPerm && hasScheduledRestart && !disableAddEditBtn && !isRestartSkipped;
    const cancelLabel = !hasScheduledRestart
        ? t('panel.shell.sidebar.no_restart_to_cancel')
        : isRestartSkipped
          ? t('panel.shell.sidebar.restart_already_cancelled')
          : t('panel.shell.sidebar.cancel_next_restart');
    const adjustLabel = hasScheduledRestart
        ? t('panel.shell.sidebar.adjust_restart_time')
        : t('panel.shell.sidebar.set_restart_time');

    return {
        isChildAlive: fxRunnerState.isChildAlive,
        nextScheduledText,
        nextScheduledClasses,
        hasAnnouncementPerm,
        hasControlPerm,
        canAdjustRestart,
        canCancelRestart,
        cancelLabel,
        adjustLabel,
        handleAnnounce,
        handleKickAll,
        handleSchedule,
        handleCancelRestart,
    };
}

// ─── Sidebar quick-actions (compact icon grid) ───────────────────────────────
function SidebarServerExtraActions() {
    const {
        isChildAlive,
        nextScheduledText,
        nextScheduledClasses,
        hasAnnouncementPerm,
        hasControlPerm,
        canAdjustRestart,
        canCancelRestart,
        cancelLabel,
        adjustLabel,
        handleAnnounce,
        handleKickAll,
        handleSchedule,
        handleCancelRestart,
    } = useServerExtraActions();
    const { t } = useLocale();
    const iconBtnClass =
        'flex size-8 items-center justify-center rounded-md border border-border/50 bg-background/35 text-muted-foreground transition-colors hover:bg-secondary/55 hover:text-foreground disabled:pointer-events-none disabled:opacity-40';

    return (
        <div className="border-border/40 mt-2 rounded-lg border bg-black/10 p-2.5">
            <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="text-muted-foreground/75 text-[10px] font-semibold whitespace-nowrap">
                    {t('panel.shell.sidebar.quick_actions')}
                </p>
                <span
                    className={cn(
                        'border-border/50 bg-background/30 flex h-7 items-center justify-center rounded-md border px-1.5 text-[10px] font-semibold whitespace-nowrap',
                        nextScheduledClasses,
                    )}
                >
                    {nextScheduledText}
                </span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
                <Tooltip>
                    <TooltipTrigger
                        type="button"
                        onClick={handleAnnounce}
                        className={cn(iconBtnClass, 'border-primary/35 text-primary')}
                        disabled={!hasAnnouncementPerm || !isChildAlive}
                        aria-label={t('panel.shell.sidebar.send_announcement')}
                    >
                        <MegaphoneIcon className="size-3.5" />
                    </TooltipTrigger>
                    <TooltipContent side="top">{t('panel.shell.sidebar.send_announcement')}</TooltipContent>
                </Tooltip>

                <Tooltip>
                    <TooltipTrigger
                        type="button"
                        onClick={handleKickAll}
                        className={cn(iconBtnClass, 'border-warning/35 text-warning-inline')}
                        disabled={!hasControlPerm || !isChildAlive}
                        aria-label={t('panel.shell.sidebar.kick_all_players')}
                    >
                        <KickAllIcon style={{ height: '0.9rem', width: '0.9rem', fill: 'currentcolor' }} />
                    </TooltipTrigger>
                    <TooltipContent side="top">{t('panel.shell.sidebar.kick_all_players')}</TooltipContent>
                </Tooltip>

                <Tooltip>
                    <TooltipTrigger
                        type="button"
                        onClick={handleSchedule}
                        className={cn(iconBtnClass, 'border-info/35 text-info-inline')}
                        disabled={!canAdjustRestart}
                        aria-label={adjustLabel}
                    >
                        <SlidersHorizontalIcon className="size-3.5" />
                    </TooltipTrigger>
                    <TooltipContent side="top">{adjustLabel}</TooltipContent>
                </Tooltip>

                <Tooltip>
                    <TooltipTrigger
                        type="button"
                        onClick={handleCancelRestart}
                        className={cn(
                            iconBtnClass,
                            'border-destructive/35 text-destructive-inline hover:bg-destructive/10',
                        )}
                        disabled={!canCancelRestart}
                        aria-label={cancelLabel}
                    >
                        <XCircleIcon className="size-3.5" />
                    </TooltipTrigger>
                    <TooltipContent side="top">{cancelLabel}</TooltipContent>
                </Tooltip>
            </div>
        </div>
    );
}

// ─── Bottom server status card ────────────────────────────────────────────────
function ServerStatusCard() {
    const serverName = useAtomValue(serverNameAtom);
    const playerCount = useAtomValue(playerCountAtom);
    const fxRunnerState = useAtomValue(fxRunnerStateAtom);
    const txConfigState = useAtomValue(txConfigStateAtom);
    const isOnline = fxRunnerState.isChildAlive;
    const collapsed = useCollapsed();
    const [showExtraActions, setShowExtraActions] = useState(false);

    if (collapsed) {
        return (
            <div className="flex flex-col items-center gap-2">
                <Tooltip>
                    <TooltipTrigger
                        type="button"
                        aria-label="Server status"
                        className={cn(
                            'size-2 rounded-full',
                            isOnline ? 'bg-success animate-pulse' : 'bg-muted-foreground/40',
                        )}
                    />
                    <TooltipContent side="right">
                        <p className="font-semibold">{serverName}</p>
                        <p className="text-muted-foreground text-xs">
                            {playerCount} {playerCount === 1 ? 'player' : 'players'} online
                        </p>
                    </TooltipContent>
                </Tooltip>
                <SidebarServerControls />
            </div>
        );
    }

    return (
        <div className="border-border/50 bg-card/60 rounded-xl border p-3">
            {/* Server name + indicator */}
            <div className="mb-2.5 flex items-start gap-2">
                <span
                    className={cn(
                        'mt-1 size-2 shrink-0 rounded-full',
                        isOnline ? 'bg-success animate-pulse' : 'bg-muted-foreground/40',
                    )}
                />
                <div className="min-w-0">
                    <p className="text-foreground truncate text-sm leading-tight font-semibold">{serverName}</p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                        {playerCount} {playerCount === 1 ? 'player' : 'players'} online
                    </p>
                </div>
            </div>
            <SidebarServerControls />
            {txConfigState === TxConfigState.Ready && (
                <>
                    <button
                        type="button"
                        onClick={() => setShowExtraActions((v) => !v)}
                        className="border-border/40 bg-background/30 text-muted-foreground hover:bg-secondary/40 hover:text-foreground mt-2 flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-[11px] transition-colors"
                        aria-expanded={showExtraActions}
                    >
                        <span>{showExtraActions ? 'Hide extra actions' : 'More actions'}</span>
                        {showExtraActions ? (
                            <ChevronUpIcon className="size-3.5" />
                        ) : (
                            <ChevronDownIcon className="size-3.5" />
                        )}
                    </button>
                    {showExtraActions && <SidebarServerExtraActions />}
                </>
            )}
        </div>
    );
}

// ─── User account dropdown ────────────────────────────────────────────────────
function SidebarUserButton() {
    const { authData, logout } = useAuth();
    const { setAccountModalOpen } = useAccountModal();
    const collapsed = useCollapsed();
    if (!authData) return null;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                className={cn(
                    'hover:bg-secondary/40 flex w-full items-center rounded-md text-sm transition-colors focus:outline-none',
                    collapsed ? 'justify-center px-0 py-1.5' : 'gap-2.5 px-2 py-2',
                )}
            >
                <Avatar
                    className="size-7 shrink-0 rounded-md text-xs"
                    username={authData.name}
                    profilePicture={authData.profilePicture}
                />
                {!collapsed && (
                    <span className="text-foreground flex-1 truncate text-left text-sm leading-none font-medium">
                        {authData.name}
                    </span>
                )}
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align={collapsed ? 'center' : 'start'} className="w-52">
                <DropdownMenuItem className="cursor-pointer" onClick={() => setAccountModalOpen(true)}>
                    <KeyRoundIcon className="mr-2 size-4" />
                    Your Account
                </DropdownMenuItem>
                <DropdownMenuItem
                    className="cursor-pointer"
                    onClick={() => openExternalLink('https://discord.gg/hUM3pQeGFc')}
                >
                    <DiscordIcon className="mr-2 size-3.5" />
                    Support
                </DropdownMenuItem>
                {window.txConsts.isWebInterface && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="cursor-pointer" onClick={() => logout()}>
                            <LogOutIcon className="mr-2 size-4" />
                            Logout
                        </DropdownMenuItem>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

// ─── Reusable navigation body (used by the mobile nav sheet, see MainSheets.tsx) ────────
export function SidebarNavContent() {
    const { hasPerm } = useAdminPerms();
    const { pages: addonPages } = useAddonLoader();
    const collapsed = useCollapsed();
    const { t } = useLocale();

    return (
        <nav
            className={cn(
                'flex flex-1 flex-col overflow-y-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
                collapsed ? 'px-1' : 'px-2',
            )}
        >
            {SIDEBAR_SECTIONS.map((section) => {
                const visibleItems = section.items
                    .filter((item) => !(window.txConsts.hideReportsNav && item.href.startsWith('/reports')))
                    .filter((item) => !item.featureFlag || isPanelFeatureEnabled(item.featureFlag));
                const isAddons = section.sectionKey === 'panel.sidebar.section.addons';
                const isSystemDev = import.meta.env.DEV && section.sectionKey === 'panel.sidebar.section.system';
                if (!visibleItems.length && !(isAddons && addonPages.length) && !isSystemDev) return null;
                return (
                    <SidebarSection key={section.sectionKey} label={t(section.sectionKey)}>
                        {visibleItems.map((item) => (
                            <SidebarNavItem
                                key={item.href}
                                href={item.href}
                                icon={item.icon}
                                label={t(item.labelKey)}
                                disabled={item.permission ? !hasPerm(item.permission) : false}
                            />
                        ))}
                        {isAddons &&
                            addonPages.map((page) => (
                                <SidebarNavItem
                                    key={page.path}
                                    href={page.path}
                                    icon={BlocksIcon}
                                    label={page.title}
                                    disabled={page.permission ? !hasPerm(page.permission) : false}
                                />
                            ))}
                        {isSystemDev && (
                            <SidebarNavItem
                                href="/advanced"
                                icon={WrenchIcon}
                                label={t('panel.sidebar.item.advanced')}
                                disabled={!hasPerm('all_permissions')}
                            />
                        )}
                    </SidebarSection>
                );
            })}
        </nav>
    );
}

// Re-export so the mobile sheet (and TopNav) can use the same bottom controls.
// SidebarServerExtraActions is also re-exported so the Dashboard page can surface the same
// quick schedule/announce/kick-all actions without duplicating the logic.
export { ServerStatusCard, SidebarServerControls, SidebarServerExtraActions, SidebarUserButton, SidebarCollapsedCtx };
