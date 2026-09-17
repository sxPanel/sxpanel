import { useState } from 'react';
import { AdminListItem, AdminStatsEntry } from '@shared/adminApiTypes';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import Avatar from '@/components/Avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DiscordIcon } from '@/components/icons/discord-icon';
import { PencilIcon, TrashIcon, ShieldCheckIcon, RotateCcwIcon, BarChart3Icon, CrownIcon } from 'lucide-react';
import AdminStatsDialog from './AdminStatsDialog';

function CardActionButton({
    label,
    icon,
    onClick,
    destructive,
}: {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    destructive?: boolean;
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label={label}
                    className={cn(
                        'text-muted-foreground/70 hover:text-foreground size-7 shrink-0',
                        destructive && 'hover:text-destructive hover:bg-destructive/10',
                    )}
                    onClick={(e) => {
                        e.stopPropagation();
                        onClick();
                    }}
                >
                    {icon}
                </Button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

type AdminListCardBaseProps = {
    admin: AdminListItem;
    stats?: AdminStatsEntry;
    actionsRank?: number;
    canManage: boolean;
    onEdit: () => void;
    onDelete: () => void;
    onResetPassword: () => void;
};

type AdminListCardProps =
    | (AdminListCardBaseProps & {
          selectMode: true;
          isSelected: boolean;
          onToggleSelect: () => void;
      })
    | (AdminListCardBaseProps & {
          selectMode?: false;
          isSelected?: never;
          onToggleSelect?: never;
      });

export default function AdminListCard({
    admin,
    stats,
    actionsRank,
    canManage,
    onEdit,
    onDelete,
    onResetPassword,
    selectMode,
    isSelected,
    onToggleSelect,
}: AdminListCardProps) {
    const [showStats, setShowStats] = useState(false);
    const displayPermissions = admin.effectivePermissions ?? admin.permissions;

    const permLabel = admin.isMaster
        ? 'Master Account'
        : displayPermissions.includes('all_permissions')
          ? 'All Permissions'
          : `${displayPermissions.length} permission${displayPermissions.length !== 1 ? 's' : ''}`;

    const showManageActions = canManage && !admin.isYou && !admin.isMaster;
    const showActions = !selectMode;
    const canSelect = !!selectMode && !admin.isMaster && !admin.isYou;
    const selectableCardProps = canSelect
        ? {
              onClick: onToggleSelect,
              tabIndex: 0,
              role: 'button' as const,
              'aria-pressed': !!isSelected,
              onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                      if (e.key === ' ') e.preventDefault();
                      onToggleSelect();
                  }
              },
          }
        : {};

    return (
        <div
            className={cn(
                'bg-card border-border/60 group relative flex flex-col gap-3 rounded-xl border px-4 pt-4 pb-3 shadow-sm transition-all',
                'hover:border-border hover:shadow-md',
                selectMode && canSelect && 'cursor-pointer',
                selectMode && !canSelect && 'opacity-60',
                isSelected && 'ring-primary/70 border-primary/60 ring-2',
            )}
            {...selectableCardProps}
        >
            {/* ── Top row: avatar + name + linked identities ── */}
            <div className="flex items-start gap-3">
                {/* Selection checkbox (replaces online dot indicator) */}
                {selectMode && (
                    <div className="flex h-11 items-center">
                        {canSelect ? (
                            <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => onToggleSelect()}
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`Select ${admin.name}`}
                            />
                        ) : (
                            <div className="w-4" />
                        )}
                    </div>
                )}

                {/* Avatar tile */}
                <div className="relative shrink-0">
                    <Avatar username={admin.name} className="size-11 rounded-lg text-sm font-bold" />
                    {!selectMode && (
                        <span
                            className={cn(
                                'border-card absolute -right-1 -bottom-1 size-3 rounded-full border-2',
                                admin.isOnline ? 'bg-success' : 'bg-muted-foreground/40',
                            )}
                            title={admin.isOnline ? 'Online (in-game)' : 'Offline'}
                        />
                    )}
                </div>

                {/* Name + meta */}
                <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-sm font-semibold">{admin.name}</span>
                        {admin.isMaster && (
                            <CrownIcon
                                className="size-3.5 shrink-0 text-amber-400/80"
                                role="img"
                                aria-label="Master account"
                            />
                        )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        {admin.isYou && (
                            <span className="bg-primary/15 text-primary rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase">
                                You
                            </span>
                        )}
                        <span className="text-muted-foreground/70 inline-flex items-center gap-1 text-[11px]">
                            <ShieldCheckIcon className="size-3" aria-hidden="true" />
                            {permLabel}
                        </span>
                    </div>
                </div>

                {/* Linked identities */}
                {(admin.hasCitizenFx || admin.hasDiscord) && (
                    <div className="flex shrink-0 items-center gap-1.5">
                        {admin.hasCitizenFx && (
                            <span
                                title="Cfx.re account linked"
                                aria-label="Cfx.re account linked"
                                className="border-border/50 bg-background/40 flex size-8 items-center justify-center rounded-md border text-sm leading-none font-bold text-[#F40552]"
                            >
                                cfx
                            </span>
                        )}
                        {admin.hasDiscord && (
                            <span
                                title="Discord account linked"
                                aria-label="Discord account linked"
                                className="border-border/50 bg-background/40 flex size-8 items-center justify-center rounded-md border text-[#5865F2]"
                            >
                                <DiscordIcon className="size-5" />
                            </span>
                        )}
                    </div>
                )}
            </div>

            {/* ── Actions ── */}
            {showActions && (
                <div className="border-border/40 mt-auto flex items-center gap-1 border-t pt-2.5">
                    <CardActionButton
                        label="Stats"
                        icon={<BarChart3Icon className="size-4" />}
                        onClick={() => setShowStats(true)}
                    />
                    {showManageActions && (
                        <>
                            <CardActionButton label="Edit" icon={<PencilIcon className="size-4" />} onClick={onEdit} />
                            <CardActionButton
                                label="Reset Password"
                                icon={<RotateCcwIcon className="size-4" />}
                                onClick={onResetPassword}
                            />
                            <div className="flex-1" />
                            <CardActionButton
                                label="Delete"
                                icon={<TrashIcon className="size-4" />}
                                onClick={onDelete}
                                destructive
                            />
                        </>
                    )}
                </div>
            )}

            {/* Stats modal */}
            <AdminStatsDialog
                open={showStats}
                onOpenChange={setShowStats}
                adminName={admin.name}
                stats={stats}
                actionsRank={actionsRank}
            />
        </div>
    );
}
