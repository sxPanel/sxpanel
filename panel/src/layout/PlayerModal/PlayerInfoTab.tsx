import DateTimeCorrected from '@/components/DateTimeCorrected';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAdminPerms } from '@/hooks/auth';
import { useBackendApi } from '@/hooks/fetch';
import { PlayerModalRefType } from '@/hooks/playerModal';
import { cn } from '@/lib/utils';
import { msToDuration, tsToLocaleDateTimeString } from '@/lib/dateTime';
import { GenericApiOkResp } from '@shared/genericApiTypes';
import { PlayerModalPlayerData } from '@shared/playerApiTypes';
import { TagDefinition, AUTO_TAG_DEFINITIONS } from '@shared/socketioTypes';
import { ShieldAlertIcon } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useLocale } from '@/hooks/locale';
import { translateApiError } from '@/lib/translateApiError';

const FALLBACK_TAG_DISPLAY: Record<string, { label: string; color: string; bg: string }> = {
    staff: { label: 'Staff', color: '#FCA5A5', bg: '#7F1D1D' },
    newplayer: { label: 'Newcomer', color: '#D9F99D', bg: '#365314' },
    problematic: { label: 'Problematic', color: '#FED7AA', bg: '#7C2D12' },
};

/**
 * Given a hex color like #EF4444, returns a dark background version and lighter text color.
 */
const deriveTagColors = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return {
        bg: `rgba(${r}, ${g}, ${b}, 0.25)`,
        color: hex,
    };
};

const buildTagDisplay = (defs: TagDefinition[]): Record<string, { label: string; color: string; bg: string }> => {
    const lookup: Record<string, { label: string; color: string; bg: string }> = { ...FALLBACK_TAG_DISPLAY };
    for (const d of defs) {
        if (d.enabled === false) {
            delete lookup[d.id];
        } else {
            const derived = deriveTagColors(d.color);
            lookup[d.id] = { label: d.label, color: derived.color, bg: derived.bg };
        }
    }
    return lookup;
};

function LogActionCounter({ type, count }: { type: 'Ban' | 'Warn'; count: number }) {
    const { t } = useLocale();
    const label =
        type === 'Ban'
            ? count === 0
                ? t('panel.player_modal.info.bans_count_zero')
                : count === 1
                  ? t('panel.player_modal.info.bans_count_one')
                  : t('panel.player_modal.info.bans_count_other', { count })
            : count === 0
              ? t('panel.player_modal.info.warns_count_zero')
              : count === 1
                ? t('panel.player_modal.info.warns_count_one')
                : t('panel.player_modal.info.warns_count_other', { count });

    return (
        <span
            className={cn(
                'inline-block h-max rounded-sm px-1 py-0.5 text-center text-xs font-semibold tracking-widest',
                count === 0
                    ? 'bg-secondary text-secondary-foreground'
                    : type === 'Ban'
                      ? 'bg-destructive text-destructive-foreground'
                      : 'bg-warning text-warning-foreground',
            )}
        >
            {label}
        </span>
    );
}

type PlayerNotesBoxProps = {
    playerRef: PlayerModalRefType;
    player: PlayerModalPlayerData;
    refreshModalData: () => void;
};

const calcTextAreaLines = (text?: string) => {
    if (!text) return 3;
    const lines = text.trim().split('\n').length + 1;
    return Math.min(Math.max(lines, 3), 16);
};

function PlayerNotesBox({ playerRef, player, refreshModalData }: PlayerNotesBoxProps) {
    const { t } = useLocale();
    const textAreaRef = useRef<HTMLTextAreaElement>(null);
    const [notesLogText, setNotesLogText] = useState(player.notesLog ?? '');
    const [textAreaLines, setTextAreaLines] = useState(() => calcTextAreaLines(player.notes));
    const playerNotesApi = useBackendApi<GenericApiOkResp>({
        method: 'POST',
        path: `/player/save_note`,
    });

    const doSaveNotes = () => {
        setNotesLogText(t('panel.player_modal.toasts.notes_saving'));
        playerNotesApi({
            queryParams: playerRef,
            data: {
                note: textAreaRef.current?.value.trim(),
            },
            success: (data) => {
                if ('error' in data) {
                    setNotesLogText(translateApiError(t, data.errorCode, data.error));
                } else {
                    refreshModalData();
                }
            },
        });
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && !event.shiftKey && !window.txIsMobile) {
            event.preventDefault();
            doSaveNotes();
        } else {
            setTextAreaLines(calcTextAreaLines(event.currentTarget.value));
        }
    };

    return (
        <>
            <Label htmlFor="playerNotes">
                {t('panel.player_modal.info.notes_label')} <span className="text-muted-foreground">{notesLogText}</span>
            </Label>
            <Textarea
                ref={textAreaRef}
                id="playerNotes"
                className="mt-1 w-full"
                disabled={!player.isRegistered}
                defaultValue={player.notes}
                onChange={() => setNotesLogText(t('panel.player_modal.toasts.notes_save_hint'))}
                onKeyDown={handleKeyDown}
                //1rem of padding + 1.25rem per line
                style={{ height: `${1 + 1.25 * textAreaLines}rem` }}
                placeholder={
                    player.isRegistered
                        ? t('panel.player_modal.info.notes_placeholder')
                        : t('panel.player_modal.info.notes_unregistered')
                }
            />
            {window.txIsMobile && (
                <div className="mt-2 w-full">
                    <Button
                        variant="outline"
                        size="xs"
                        onClick={doSaveNotes}
                        disabled={!player.isRegistered}
                        className="w-full"
                    >
                        {t('panel.player_modal.info.save_note')}
                    </Button>
                </div>
            )}
        </>
    );
}

type PlayerInfoTabProps = {
    playerRef: PlayerModalRefType;
    player: PlayerModalPlayerData;
    serverTime: number;
    tsFetch: number;
    setSelectedTab: (t: string) => void;
    refreshModalData: () => void;
    tagDefinitions: TagDefinition[];
};

export default function PlayerInfoTab({
    playerRef,
    player,
    serverTime,
    tsFetch,
    setSelectedTab,
    refreshModalData,
    tagDefinitions,
}: PlayerInfoTabProps) {
    const { t } = useLocale();
    const { hasPerm } = useAdminPerms();
    const tagDisplay = useMemo(() => buildTagDisplay(tagDefinitions ?? []), [tagDefinitions]);
    const autoTagIds = useMemo(() => new Set(AUTO_TAG_DEFINITIONS.map((t) => t.id)), []);
    const customTagDefs = useMemo(
        () => (tagDefinitions ?? []).filter((t) => !autoTagIds.has(t.id)),
        [tagDefinitions, autoTagIds],
    );
    const discordManagedTagIds = useMemo(
        () =>
            new Set(
                (tagDefinitions ?? [])
                    .filter((def) => !autoTagIds.has(def.id) && (def.discordRoleIds?.length ?? 0) > 0)
                    .map((def) => def.id),
            ),
        [tagDefinitions, autoTagIds],
    );
    const manualCustomTagDefs = useMemo(
        () => customTagDefs.filter((def) => !discordManagedTagIds.has(def.id)),
        [customTagDefs, discordManagedTagIds],
    );
    const playerWhitelistApi = useBackendApi<GenericApiOkResp>({
        method: 'POST',
        path: `/player/whitelist`,
    });
    const playerTagApi = useBackendApi<GenericApiOkResp>({
        method: 'POST',
        path: `/player/set_tag`,
    });

    const handleToggleTag = (tagId: string, currentlyHas: boolean) => {
        playerTagApi({
            queryParams: playerRef,
            data: { tagId, status: !currentlyHas },
            toastLoadingMessage: t('panel.player_modal.toasts.tag_updating'),
            genericHandler: { successMsg: t('panel.player_modal.toasts.tag_updated') },
            success: (data) => {
                if ('success' in data) {
                    refreshModalData();
                }
            },
        });
    };

    const sessionTimeText = !player.sessionTime
        ? '--'
        : msToDuration(player.sessionTime * 60_000, { units: ['h', 'm'] });
    const lastConnectionText = !player.tsLastConnection ? (
        '--'
    ) : (
        <DateTimeCorrected
            className="cursor-help opacity-75"
            serverTime={serverTime}
            tsObject={player.tsLastConnection}
            tsFetch={tsFetch}
            isDateOnly
        />
    );
    const playTimeText = !player.playTime ? '--' : msToDuration(player.playTime * 60_000, { units: ['d', 'h', 'm'] });
    const joinDateText = !player.tsJoined ? (
        '--'
    ) : (
        <DateTimeCorrected
            className="cursor-help opacity-75"
            serverTime={serverTime}
            tsObject={player.tsJoined}
            tsFetch={tsFetch}
            isDateOnly
        />
    );
    const whitelistedText = !player.tsWhitelisted ? (
        t('panel.player_modal.info.not_yet')
    ) : (
        <DateTimeCorrected
            className="cursor-help opacity-75"
            serverTime={serverTime}
            tsObject={player.tsWhitelisted}
            tsFetch={tsFetch}
            isDateOnly
        />
    );
    const banCount = player.actionHistory.filter((a) => a.type === 'ban' && !a.revokedAt).length;
    const warnCount = player.actionHistory.filter((a) => a.type === 'warn' && !a.revokedAt).length;

    const handleWhitelistClick = () => {
        playerWhitelistApi({
            queryParams: playerRef,
            data: {
                status: !player.tsWhitelisted,
            },
            toastLoadingMessage: t('panel.player_modal.toasts.whitelist_updating'),
            genericHandler: {
                successMsg: t('panel.player_modal.toasts.whitelist_changed'),
            },
            success: (data, toastId) => {
                if ('success' in data) {
                    refreshModalData();
                }
            },
        });
    };

    const playerBannedText: string | undefined = useMemo(() => {
        if (!player || !serverTime) return;
        let banExpiration;
        for (const action of player.actionHistory) {
            if (action.type !== 'ban' || action.revokedAt) continue;
            if (action.exp) {
                if (action.exp >= serverTime) {
                    banExpiration = Math.max(banExpiration ?? 0, action.exp);
                }
            } else {
                return t('panel.player_modal.info.banned_permanent');
            }
        }

        if (banExpiration !== undefined) {
            const str = tsToLocaleDateTimeString(banExpiration, 'short', 'short');
            return t('panel.player_modal.info.banned_until', { date: str });
        }
    }, [player, serverTime, t]);

    return (
        <div className="p-1">
            {playerBannedText ? (
                <div className="border-warning/70 bg-warning-hint mb-1 flex w-full items-center justify-between gap-x-4 rounded-lg border p-2 pr-3 text-white/90 shadow-lg transition-all">
                    <div className="flex shrink-0 flex-col items-center gap-2">
                        <ShieldAlertIcon className="text-warning size-5" />
                    </div>
                    <div className="grow text-sm font-medium">{playerBannedText}</div>
                </div>
            ) : null}
            {player.tags?.length > 0 && (
                <div className="mb-1 flex flex-wrap gap-1.5">
                    {player.tags.map((tag) => {
                        const cfg = tagDisplay[tag];
                        if (!cfg) return null;
                        return (
                            <span
                                key={tag}
                                className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold tracking-wide"
                                style={{
                                    backgroundColor: cfg.bg,
                                    color: cfg.color,
                                }}
                            >
                                {cfg.label}
                                {discordManagedTagIds.has(tag) ? (
                                    <span className="text-muted-foreground ml-1 text-[10px] font-normal uppercase">
                                        Discord
                                    </span>
                                ) : null}
                            </span>
                        );
                    })}
                </div>
            )}
            <dl className="pb-2">
                {player.isConnected && (
                    <div className="grid grid-cols-3 gap-4 px-0 py-0.5">
                        <dt className="text-muted-foreground text-sm leading-6 font-medium">
                            {t('panel.player_modal.info.session_time')}
                        </dt>
                        <dd className="col-span-2 mt-0 text-sm leading-6">{sessionTimeText}</dd>
                    </div>
                )}
                <div className="grid grid-cols-3 gap-4 px-0 py-0.5">
                    <dt className="text-muted-foreground text-sm leading-6 font-medium">
                        {t('panel.player_modal.info.play_time')}
                    </dt>
                    <dd className="col-span-2 mt-0 text-sm leading-6">{playTimeText}</dd>
                </div>
                <div className="grid grid-cols-3 gap-4 px-0 py-0.5">
                    <dt className="text-muted-foreground text-sm leading-6 font-medium">
                        {t('panel.player_modal.info.join_date')}
                    </dt>
                    <dd className="col-span-2 mt-0 text-sm leading-6">{joinDateText}</dd>
                </div>
                {!player.isConnected && (
                    <div className="grid grid-cols-3 gap-4 px-0 py-0.5">
                        <dt className="text-muted-foreground text-sm leading-6 font-medium">
                            {t('panel.player_modal.info.last_connection')}
                        </dt>
                        <dd className="col-span-2 mt-0 text-sm leading-6">{lastConnectionText}</dd>
                    </div>
                )}

                <div className="grid grid-cols-3 gap-4 px-0 py-0.5">
                    <dt className="text-muted-foreground text-sm leading-6 font-medium">
                        {t('panel.player_modal.info.id_whitelisted')}
                    </dt>
                    <dd className="mt-0 text-sm leading-6">{whitelistedText}</dd>
                    <dd className="text-right">
                        <Button
                            variant="outline"
                            size="inline"
                            style={{ minWidth: '8.25ch' }}
                            onClick={handleWhitelistClick}
                            disabled={!hasPerm('players.whitelist')}
                        >
                            {player.tsWhitelisted ? t('panel.common.remove') : t('panel.player_modal.info.add_wl')}
                        </Button>
                    </dd>
                </div>
                <div className="grid grid-cols-3 gap-4 px-0 py-0.5">
                    <dt className="text-muted-foreground text-sm leading-6 font-medium">
                        {t('panel.player_modal.info.sanctions')}
                    </dt>
                    <dd className="mt-0 flex flex-wrap gap-2 text-sm leading-6">
                        <LogActionCounter type="Ban" count={banCount} />
                        <LogActionCounter type="Warn" count={warnCount} />
                    </dd>
                    <dd className="text-right">
                        <Button
                            variant="outline"
                            size="inline"
                            style={{ minWidth: '8.25ch' }}
                            onClick={() => {
                                setSelectedTab('History');
                            }}
                        >
                            {t('panel.common.view')}
                        </Button>
                    </dd>
                </div>
                {customTagDefs.length > 0 && hasPerm('players.write') && manualCustomTagDefs.length > 0 && (
                    <div className="grid grid-cols-3 gap-4 px-0 py-0.5">
                        <dt className="text-muted-foreground text-sm leading-6 font-medium">
                            {t('panel.player_modal.info.custom_tags')}
                        </dt>
                        <dd className="col-span-2 mt-0 text-right text-sm leading-6">
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="inline" style={{ minWidth: '8.25ch' }}>
                                        {t('panel.common.edit')}
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuLabel className="text-xs">
                                        {t('panel.player_modal.info.custom_tags')}
                                    </DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    {manualCustomTagDefs.map((def) => {
                                        const hasTag = player.tags?.includes(def.id) ?? false;
                                        return (
                                            <DropdownMenuCheckboxItem
                                                key={def.id}
                                                checked={hasTag}
                                                onCheckedChange={() => handleToggleTag(def.id, hasTag)}
                                            >
                                                <span
                                                    className="mr-1.5 inline-block size-2.5 rounded-full"
                                                    style={{ backgroundColor: def.color }}
                                                />
                                                {def.label}
                                            </DropdownMenuCheckboxItem>
                                        );
                                    })}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </dd>
                    </div>
                )}
            </dl>

            <PlayerNotesBox player={player} playerRef={playerRef} refreshModalData={refreshModalData} />
        </div>
    );
}
