import { useState, useRef } from 'react';
import { cn, submitAuthedDownload } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCsrfToken } from '@/hooks/auth';
import {
    RadioIcon,
    PauseIcon,
    SearchIcon,
    XIcon,
    Volume2Icon,
    VolumeXIcon,
    ClockIcon,
    DownloadIcon,
    CheckCheckIcon,
    XCircleIcon,
    LogInIcon,
    LogOutIcon,
    MessageSquareIcon,
    SkullIcon,
    MenuIcon,
    FlameIcon,
    TerminalIcon,
    SettingsIcon,
    UserIcon,
    HistoryIcon,
} from 'lucide-react';
import type { EventFilterKey, EventFiltersState } from './serverLogTypes';
import { EVENT_FILTERS } from './serverLogTypes';
import type { SessionFile } from './useServerLog';

const iconMap: Record<string, typeof LogInIcon> = {
    LogIn: LogInIcon,
    LogOut: LogOutIcon,
    MessageSquare: MessageSquareIcon,
    Skull: SkullIcon,
    Menu: MenuIcon,
    Flame: FlameIcon,
    Terminal: TerminalIcon,
    Settings: SettingsIcon,
};

type ServerLogToolbarProps = {
    isLive: boolean;
    isConnected: boolean;
    filters: EventFiltersState;
    eventCounts: Record<EventFilterKey, number>;
    searchText: string;
    playerFilter: string | null;
    playerCommandsOnly: boolean;
    soundEnabled: boolean;
    sessions: SessionFile[];
    activeSession: string | null;
    toggleLive: () => void;
    goLive: () => void;
    loadSession: (fileName: string) => void;
    toggleFilter: (key: EventFilterKey) => void;
    setAllFilters: (enabled: boolean) => void;
    setSearchText: (text: string) => void;
    setPlayerFilter: (name: string | null) => void;
    togglePlayerCommandsOnly: () => void;
    toggleSound: () => void;
    jumpToTime: (ts: number) => void;
};

export default function ServerLogToolbar({
    isLive,
    isConnected,
    filters,
    eventCounts,
    searchText,
    playerFilter,
    playerCommandsOnly,
    soundEnabled,
    sessions,
    activeSession,
    toggleLive,
    goLive,
    loadSession,
    toggleFilter,
    setAllFilters,
    setSearchText,
    setPlayerFilter,
    togglePlayerCommandsOnly,
    toggleSound,
    jumpToTime,
}: ServerLogToolbarProps) {
    const [showJumpInput, setShowJumpInput] = useState(false);
    const jumpInputRef = useRef<HTMLInputElement>(null);
    const csrfToken = useCsrfToken();

    const handleJump = () => {
        if (!jumpInputRef.current?.value) return;
        const ts = new Date(jumpInputRef.current.value).getTime();
        if (isNaN(ts)) return;
        jumpToTime(ts);
        setShowJumpInput(false);
    };

    const allEnabled = Object.values(filters).every(Boolean);
    const noneEnabled = Object.values(filters).every((v) => !v);

    return (
        <div className="bg-card sticky top-0 z-10 space-y-2 border-b px-4 py-2">
            {/* Row 1: Controls */}
            <div className="flex flex-wrap items-center gap-2">
                {/* Live/Pause toggle */}
                {isLive ? (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="default" size="xs" onClick={toggleLive} className="gap-1.5">
                                <RadioIcon className="size-3.5" />
                                <span>Live</span>
                                {isConnected && (
                                    <span className="relative flex size-2">
                                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                                        <span className="relative inline-flex size-2 rounded-full bg-green-500" />
                                    </span>
                                )}
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Click to pause live updates</TooltipContent>
                    </Tooltip>
                ) : (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="outline" size="xs" onClick={goLive} className="gap-1.5">
                                <PauseIcon className="size-3.5" />
                                <span>Paused</span>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Click to resume live updates</TooltipContent>
                    </Tooltip>
                )}

                {/* Session picker */}
                {sessions.length > 0 && (
                    <Select
                        value={activeSession ?? '__live__'}
                        onValueChange={(val) => {
                            if (val === '__live__') {
                                goLive();
                            } else {
                                loadSession(val);
                            }
                        }}
                    >
                        <SelectTrigger className="h-7 w-auto min-w-36 gap-1 text-xs">
                            <HistoryIcon className="size-3.5 shrink-0" />
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__live__">Current Session</SelectItem>
                            {sessions.map((s) => (
                                <SelectItem key={s.name} value={s.name}>
                                    <span>{s.ts}</span>
                                    <span className="text-muted-foreground ml-1.5">({s.size})</span>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}

                {/* Separator */}
                <div className="bg-border h-5 w-px" />

                {/* Search */}
                <div className="relative max-w-xs min-w-40 flex-1">
                    <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
                    <Input
                        placeholder="Search — e.g. player command"
                        title={'Space-separated terms must all match. Use -word to exclude, "quoted phrase" for exact.'}
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        className="h-7 pr-7 pl-8 text-sm"
                    />
                    {searchText && (
                        <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
                            onClick={() => setSearchText('')}
                        >
                            <XIcon className="size-3.5" />
                        </button>
                    )}
                </div>

                {/* Player filter */}
                {playerFilter && (
                    <div className="flex items-center gap-1">
                        <Badge
                            variant="secondary"
                            className="hover:bg-destructive/20 cursor-pointer gap-1"
                            onClick={() => setPlayerFilter(null)}
                        >
                            <UserIcon className="size-3" />
                            {playerFilter}
                            <XIcon className="size-3" />
                        </Badge>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    onClick={togglePlayerCommandsOnly}
                                    className={cn(
                                        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors',
                                        playerCommandsOnly
                                            ? 'bg-secondary text-secondary-foreground border-border'
                                            : 'text-muted-foreground/60 hover:border-border border-transparent',
                                    )}
                                >
                                    <TerminalIcon className={cn('size-3', playerCommandsOnly && 'text-cyan-400')} />
                                    Commands only
                                </button>
                            </TooltipTrigger>
                            <TooltipContent>
                                Show only the commands this player ran (ignores the category chips)
                            </TooltipContent>
                        </Tooltip>
                    </div>
                )}

                {/* Spacer */}
                <div className="flex-1" />

                {/* Jump to time */}
                {showJumpInput ? (
                    <div className="flex items-center gap-1">
                        <Input ref={jumpInputRef} type="datetime-local" className="h-7 w-48 text-xs" />
                        <Button size="xs" variant="default" onClick={handleJump}>
                            Jump
                        </Button>
                        <Button size="xs" variant="ghost" onClick={() => setShowJumpInput(false)}>
                            <XIcon className="size-3.5" />
                        </Button>
                    </div>
                ) : (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" size="xs" onClick={() => setShowJumpInput(true)}>
                                <ClockIcon className="size-3.5" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Jump to time</TooltipContent>
                    </Tooltip>
                )}

                {/* Sound toggle */}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant={soundEnabled ? 'secondary' : 'ghost'} size="xs" onClick={toggleSound}>
                            {soundEnabled ? <Volume2Icon className="size-3.5" /> : <VolumeXIcon className="size-3.5" />}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                        {soundEnabled ? 'Mute sound alerts (deaths & explosions)' : 'Enable sound alerts'}
                    </TooltipContent>
                </Tooltip>

                {/* Download */}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="xs"
                            disabled={!csrfToken}
                            onClick={() => submitAuthedDownload('/logs/server/download', csrfToken)}
                        >
                            <DownloadIcon className="size-3.5" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Download log</TooltipContent>
                </Tooltip>
            </div>

            {/* Row 2: Filter chips */}
            <div className="flex flex-wrap items-center gap-1.5">
                {EVENT_FILTERS.map((filter) => {
                    const Icon = iconMap[filter.icon];
                    const active = filters[filter.key];
                    const count = eventCounts[filter.key];
                    return (
                        <button
                            key={filter.key}
                            type="button"
                            onClick={() => toggleFilter(filter.key)}
                            className={cn(
                                'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors',
                                active
                                    ? 'bg-secondary text-secondary-foreground border-border'
                                    : 'text-muted-foreground/50 hover:border-border border-transparent bg-transparent',
                            )}
                        >
                            {Icon && <Icon className={cn('size-3', active ? filter.color : '')} />}
                            <span>{filter.label}</span>
                            <span
                                className={cn(
                                    'ml-0.5 text-[10px] tabular-nums',
                                    active ? 'text-muted-foreground' : 'text-muted-foreground/40',
                                )}
                            >
                                {count}
                            </span>
                        </button>
                    );
                })}

                <div className="bg-border mx-0.5 h-4 w-px" />

                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            type="button"
                            onClick={() => setAllFilters(!allEnabled)}
                            className="text-muted-foreground hover:text-foreground p-0.5 transition-colors"
                        >
                            {allEnabled || noneEnabled ? (
                                <CheckCheckIcon className="size-3.5" />
                            ) : (
                                <XCircleIcon className="size-3.5" />
                            )}
                        </button>
                    </TooltipTrigger>
                    <TooltipContent>{allEnabled ? 'Deselect all filters' : 'Select all filters'}</TooltipContent>
                </Tooltip>
            </div>
        </div>
    );
}
