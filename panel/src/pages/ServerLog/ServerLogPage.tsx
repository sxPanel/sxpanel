import { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import { Loader2Icon, ArrowDownIcon, FilterXIcon, RadioTowerIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useLocale } from '@/hooks/locale';
import useServerLog from '@/pages/ServerLog/useServerLog';
import ServerLogToolbar from '@/pages/ServerLog/ServerLogToolbar';
import ServerLogEntry, { GroupedJoinLeave } from '@/pages/ServerLog/ServerLogEntry';
import { ServerLogHeaderBand } from './ServerLogHeaderBand';
import { groupEvents } from './serverLogDisplayItems';

/**
 * Server Log V2 — redesign goals over V1:
 * - V2 header band (icon tile + description + connection/event stat pills)
 *   replacing the hoisted PageHeader, matching Players/History V2.
 * - Page shell constrained like other V2 pages (`min-w-96`), card always
 *   `rounded-xl` instead of only at the md breakpoint.
 * - Fixes the scroll-to-bottom FAB anchoring (the card now has `relative`)
 *   and labels it for screen readers.
 * - Richer empty/connecting states with icons instead of bare text.
 */
export default function ServerLogPage() {
    const { t } = useLocale();
    const log = useServerLog();
    const scrollRef = useRef<HTMLDivElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const sentinelRef = useRef<HTMLDivElement>(null);
    const [showScrollBtn, setShowScrollBtn] = useState(false);
    const userAtBottom = useRef(true);

    // ── Auto-scroll when live and new events arrive ──
    useEffect(() => {
        if (log.isLive && userAtBottom.current && bottomRef.current) {
            bottomRef.current.scrollIntoView({ behavior: 'instant' });
        }
    }, [log.events.length, log.isLive]);

    // ── Track if user is at bottom ──
    const handleScroll = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
        const atBottom = gap < 50;
        userAtBottom.current = atBottom;
        setShowScrollBtn(!atBottom);
    }, []);

    // ── Infinite scroll: load older when sentinel becomes visible ──
    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    log.loadOlder();
                }
            },
            { root: scrollRef.current, threshold: 0.1 },
        );

        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [log.loadOlder]);

    // ── Grouped display items ──
    const displayItems = useMemo(() => groupEvents(log.events), [log.events]);

    const handlePlayerClick = useCallback(
        (name: string) => {
            log.setPlayerFilter(name);
        },
        [log.setPlayerFilter],
    );

    const handleClearFilters = useCallback(() => {
        log.setAllFilters(true);
        log.setSearchText('');
        log.setPlayerFilter(null);
    }, [log.setAllFilters, log.setSearchText, log.setPlayerFilter]);

    const scrollToBottom = () => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        userAtBottom.current = true;
    };

    return (
        <div className="h-contentvh flex w-full min-w-96 flex-col">
            <ServerLogHeaderBand
                title={t('panel.routes.server_log')}
                isLive={log.isLive}
                isConnected={log.isConnected}
                totalEvents={log.allEventsCount}
                eventCounts={log.eventCounts}
                activeSession={log.activeSession}
            />

            <TooltipProvider delayDuration={300}>
                <div className="bg-background border-border/60 relative flex w-full flex-1 flex-col overflow-hidden rounded-xl border">
                    <ServerLogToolbar
                        isLive={log.isLive}
                        isConnected={log.isConnected}
                        filters={log.filters}
                        eventCounts={log.eventCounts}
                        searchText={log.searchText}
                        playerFilter={log.playerFilter}
                        playerCommandsOnly={log.playerCommandsOnly}
                        soundEnabled={log.soundEnabled}
                        sessions={log.sessions}
                        activeSession={log.activeSession}
                        toggleLive={log.toggleLive}
                        goLive={log.goLive}
                        loadSession={log.loadSession}
                        toggleFilter={log.toggleFilter}
                        setAllFilters={log.setAllFilters}
                        setSearchText={log.setSearchText}
                        setPlayerFilter={log.setPlayerFilter}
                        togglePlayerCommandsOnly={log.togglePlayerCommandsOnly}
                        toggleSound={log.toggleSound}
                        jumpToTime={log.jumpToTime}
                    />

                    {/* Scrollable log area */}
                    <div ref={scrollRef} className="flex-1 overflow-y-auto" onScroll={handleScroll}>
                        {/* Sentinel for loading older events */}
                        <div ref={sentinelRef} className="h-1" />

                        {/* Loading older indicator */}
                        {log.isLoadingOlder && (
                            <div className="text-muted-foreground flex items-center justify-center gap-2 py-3 text-sm">
                                <Loader2Icon className="size-4 animate-spin" />
                                Loading older events…
                            </div>
                        )}

                        {/* Loading session indicator */}
                        {log.isLoadingSession && (
                            <div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
                                <Loader2Icon className="size-4 animate-spin" />
                                Loading session…
                            </div>
                        )}

                        {/* No older data indicator */}
                        {!log.hasOlderData && (
                            <div className="text-muted-foreground/70 py-2 text-center text-xs tracking-wider uppercase">
                                Beginning of log
                            </div>
                        )}

                        {/* Log entries */}
                        {displayItems.length > 0 ? (
                            <div className="divide-border/50 divide-y">
                                {displayItems.map((item) => {
                                    if (item.kind === 'group') {
                                        return (
                                            <GroupedJoinLeave
                                                key={`g-${item.type}-${item.events[0].ts}-${item.events[item.events.length - 1]?.ts ?? item.events[0].ts}-${item.events.length}`}
                                                events={item.events}
                                                type={item.type}
                                            />
                                        );
                                    }
                                    return (
                                        <ServerLogEntry
                                            key={`${item.event.ts}-${item.event.type}-${item.event.src.id || item.event.src.name}-${item.event.msg}`}
                                            event={item.event}
                                            onPlayerClick={handlePlayerClick}
                                        />
                                    );
                                })}
                            </div>
                        ) : log.allEventsCount > 0 ? (
                            <div className="text-muted-foreground flex flex-col items-center justify-center gap-3 py-16">
                                <div className="bg-muted flex size-12 items-center justify-center rounded-xl">
                                    <FilterXIcon className="size-6" />
                                </div>
                                <p className="text-sm font-medium">No events match your filters</p>
                                <Button variant="outline" size="sm" onClick={handleClearFilters}>
                                    Clear all filters
                                </Button>
                            </div>
                        ) : (
                            <div className="text-muted-foreground flex flex-col items-center justify-center gap-3 py-16">
                                <div className="bg-muted flex size-12 items-center justify-center rounded-xl">
                                    <RadioTowerIcon className="size-6" />
                                </div>
                                <p className="text-sm font-medium">
                                    {log.isConnected ? 'Waiting for events…' : 'Connecting…'}
                                </p>
                                <p className="text-muted-foreground/70 max-w-xs text-center text-xs">
                                    {log.isConnected
                                        ? 'New server activity will appear here as it happens.'
                                        : 'Establishing a live connection to the server log stream.'}
                                </p>
                            </div>
                        )}

                        {/* Bottom anchor */}
                        <div ref={bottomRef} />
                    </div>

                    {/* Scroll-to-bottom button */}
                    {showScrollBtn && log.events.length > 20 && (
                        <div className="absolute right-4 bottom-4">
                            <Button
                                variant="secondary"
                                size="icon"
                                className="size-8 rounded-full shadow-lg"
                                aria-label="Scroll to latest events"
                                onClick={scrollToBottom}
                            >
                                <ArrowDownIcon className="size-4" />
                            </Button>
                        </div>
                    )}
                </div>
            </TooltipProvider>
        </div>
    );
}
