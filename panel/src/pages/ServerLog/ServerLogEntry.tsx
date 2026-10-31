import { memo, useMemo, useRef, useState } from 'react';
import { cn, copyToClipboard } from '@/lib/utils';
import {
    LogInIcon,
    LogOutIcon,
    MessageSquareIcon,
    SkullIcon,
    SwordsIcon,
    MenuIcon,
    FlameIcon,
    TerminalIcon,
    SettingsIcon,
    CircleHelpIcon,
    CopyIcon,
    CheckIcon,
    UserIcon,
    ClockIcon,
    TagIcon,
    HashIcon,
    TextIcon,
    ExternalLinkIcon,
} from 'lucide-react';
import { useOpenPlayerModal } from '@/hooks/playerModal';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { ServerLogEvent } from './serverLogTypes';

const typeConfig: Record<string, { icon: typeof LogInIcon; color: string; borderColor: string; label: string }> = {
    playerJoining: {
        icon: LogInIcon,
        color: 'text-green-500',
        borderColor: 'border-l-green-500',
        label: 'Player Joining',
    },
    playerJoinDenied: {
        icon: LogInIcon,
        color: 'text-green-500/50',
        borderColor: 'border-l-green-500/50',
        label: 'Join Denied',
    },
    playerDropped: {
        icon: LogOutIcon,
        color: 'text-orange-400',
        borderColor: 'border-l-orange-400',
        label: 'Player Dropped',
    },
    ChatMessage: {
        icon: MessageSquareIcon,
        color: 'text-blue-400',
        borderColor: 'border-l-blue-400',
        label: 'Chat Message',
    },
    DeathNotice: { icon: SkullIcon, color: 'text-red-500', borderColor: 'border-l-red-500', label: 'Death Notice' },
    CombatDamage: {
        icon: SwordsIcon,
        color: 'text-orange-500',
        borderColor: 'border-l-orange-500',
        label: 'Combat Damage',
    },
    MenuEvent: { icon: MenuIcon, color: 'text-purple-400', borderColor: 'border-l-purple-400', label: 'Menu Event' },
    explosionEvent: {
        icon: FlameIcon,
        color: 'text-yellow-500',
        borderColor: 'border-l-yellow-500',
        label: 'Explosion',
    },
    CommandExecuted: {
        icon: TerminalIcon,
        color: 'text-cyan-400',
        borderColor: 'border-l-cyan-400',
        label: 'Command Executed',
    },
    LoggerStarted: {
        icon: SettingsIcon,
        color: 'text-muted-foreground',
        borderColor: 'border-l-muted-foreground',
        label: 'Logger Started',
    },
    DebugMessage: {
        icon: SettingsIcon,
        color: 'text-muted-foreground',
        borderColor: 'border-l-muted-foreground',
        label: 'Debug Message',
    },
};

const defaultConfig = {
    icon: CircleHelpIcon,
    color: 'text-muted-foreground',
    borderColor: 'border-l-muted-foreground',
    label: 'Unknown',
};

const timeOptions: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit' };
const fullTimeOptions: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
};

const getRelativeTime = (ts: number) => {
    const diff = Date.now() - ts;
    if (diff < 5_000) return 'just now';
    if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
};

type ServerLogEntryProps = {
    event: ServerLogEvent;
    onPlayerClick: (name: string) => void;
};

const ServerLogEntry = memo(function ServerLogEntry({ event, onPlayerClick }: ServerLogEntryProps) {
    const cfg = typeConfig[event.type] ?? defaultConfig;
    const Icon = cfg.icon;
    const [modalOpen, setModalOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const surrogateRef = useRef<HTMLDivElement>(null);

    const openPlayerModal = useOpenPlayerModal();

    const absoluteTime = useMemo(() => new Date(event.ts).toLocaleTimeString(undefined, timeOptions), [event.ts]);

    const fullTime = useMemo(() => new Date(event.ts).toLocaleString(undefined, fullTimeOptions), [event.ts]);

    const handleSourceClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (event.src.id) {
            const [mutex, netidStr] = String(event.src.id).split('#', 2);
            const netid = parseInt(netidStr, 10);
            if (mutex && !isNaN(netid)) {
                openPlayerModal({ mutex, netid });
                return;
            }
        }
        onPlayerClick(event.src.name);
    };

    const handleCopy = () => {
        const text = `[${fullTime}] [${cfg.label}] ${event.src.name}: ${event.msg}`;
        copyToClipboard(text, surrogateRef.current ?? (document.body as unknown as HTMLDivElement)).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    };

    const handleOpenPlayer = () => {
        if (!event.src.id) return;
        const [mutex, netidStr] = String(event.src.id).split('#', 2);
        const netid = parseInt(netidStr, 10);
        if (mutex && !isNaN(netid)) {
            setModalOpen(false);
            openPlayerModal({ mutex, netid });
        }
    };

    const sourceId = event.src.id ? String(event.src.id) : null;
    const [mutex, netidStr] = sourceId?.split('#', 2) ?? [null, null];

    return (
        <>
            <div
                ref={surrogateRef}
                className={cn(
                    'hover:bg-secondary/30 flex cursor-pointer items-start gap-2 border-l-2 px-3 py-1.5 text-sm transition-colors',
                    cfg.borderColor,
                )}
                onClick={() => setModalOpen(true)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        if (e.key === ' ') e.preventDefault();
                        setModalOpen(true);
                    }
                }}
                role="button"
                tabIndex={0}
            >
                <Icon className={cn('mt-0.5 size-3.5 shrink-0', cfg.color)} />

                <span
                    className="text-muted-foreground mt-px w-18 shrink-0 text-xs tabular-nums"
                    title={getRelativeTime(event.ts)}
                >
                    {absoluteTime}
                </span>

                {event.src.id ? (
                    <button
                        type="button"
                        className="text-primary shrink-0 text-left font-semibold hover:underline"
                        onClick={handleSourceClick}
                    >
                        {event.src.name}
                    </button>
                ) : (
                    <span className="text-muted-foreground shrink-0 font-semibold">{event.src.name}</span>
                )}

                <span className="text-secondary-foreground min-w-0 wrap-break-word">{event.msg}</span>
            </div>

            <Dialog open={modalOpen} onOpenChange={setModalOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Icon className={cn('size-5', cfg.color)} />
                            <span className={cfg.color}>{cfg.label}</span>
                        </DialogTitle>
                        <DialogDescription>
                            {fullTime} ({getRelativeTime(event.ts)})
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3 text-sm">
                        {/* Source */}
                        <div className="flex items-start gap-2">
                            <UserIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                            <div>
                                <p className="text-muted-foreground text-xs font-medium">Source</p>
                                <p className="font-semibold">{event.src.name || '—'}</p>
                            </div>
                        </div>

                        {/* Player ID */}
                        {sourceId && (
                            <div className="flex items-start gap-2">
                                <HashIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                                <div>
                                    <p className="text-muted-foreground text-xs font-medium">Identifier</p>
                                    {mutex && netidStr ? (
                                        <p>
                                            <span className="font-mono text-xs">{mutex}</span>{' '}
                                            <span className="text-muted-foreground">(Net ID: {netidStr})</span>
                                        </p>
                                    ) : (
                                        <p className="font-mono text-xs">{sourceId}</p>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Timestamp */}
                        <div className="flex items-start gap-2">
                            <ClockIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                            <div>
                                <p className="text-muted-foreground text-xs font-medium">Timestamp</p>
                                <p>{fullTime}</p>
                                <p className="text-muted-foreground text-xs">
                                    {getRelativeTime(event.ts)} &middot; Unix: {event.ts}
                                </p>
                            </div>
                        </div>

                        {/* Event Type */}
                        <div className="flex items-start gap-2">
                            <TagIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                            <div>
                                <p className="text-muted-foreground text-xs font-medium">Event Type</p>
                                <p>
                                    <span className={cfg.color}>{cfg.label}</span>{' '}
                                    <span className="text-muted-foreground font-mono text-xs">({event.type})</span>
                                </p>
                            </div>
                        </div>

                        {/* Message */}
                        {event.msg && (
                            <div className="flex items-start gap-2">
                                <TextIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                                <div className="min-w-0">
                                    <p className="text-muted-foreground text-xs font-medium">Message</p>
                                    <p className="wrap-break-word whitespace-pre-wrap">{event.msg}</p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 border-t pt-2">
                        <Button variant="secondary" size="xs" onClick={handleCopy} className="gap-1.5">
                            {copied ? (
                                <>
                                    <CheckIcon className="size-3.5 text-green-500" /> Copied
                                </>
                            ) : (
                                <>
                                    <CopyIcon className="size-3.5" /> Copy
                                </>
                            )}
                        </Button>
                        {event.src.id && (
                            <Button variant="secondary" size="xs" onClick={handleOpenPlayer} className="gap-1.5">
                                <ExternalLinkIcon className="size-3.5" /> View Player
                            </Button>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
});

export default ServerLogEntry;

// ── Grouped/collapsed events ──
type GroupedJoinLeaveProps = {
    events: ServerLogEvent[];
    type: 'join' | 'leave';
};

export const GroupedJoinLeave = memo(function GroupedJoinLeave({ events, type }: GroupedJoinLeaveProps) {
    const cfg = type === 'join' ? typeConfig.playerJoining : typeConfig.playerDropped;
    const Icon = cfg.icon;
    const label = type === 'join' ? 'joined' : 'left';

    const names = events.map((e) => e.src.name);
    const display =
        names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;

    const absoluteTime = useMemo(
        () => (events.length ? new Date(events[0].ts).toLocaleTimeString(undefined, timeOptions) : ''),
        [events.length, events[0]?.ts],
    );

    return (
        <div
            className={cn(
                'hover:bg-muted/50 flex items-start gap-2 border-l-2 px-3 py-1.5 text-sm transition-colors',
                cfg.borderColor,
            )}
        >
            <Icon className={cn('mt-0.5 size-3.5 shrink-0', cfg.color)} />
            <span
                className="text-muted-foreground mt-px w-18 shrink-0 cursor-default text-xs tabular-nums"
                title={getRelativeTime(events[0].ts)}
            >
                {absoluteTime}
            </span>
            <span className="text-secondary-foreground">
                <span className="font-semibold">{events.length} players</span> {label}: {display}
            </span>
        </div>
    );
});
