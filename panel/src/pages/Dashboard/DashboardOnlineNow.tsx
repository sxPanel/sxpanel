import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { useLocation } from 'wouter';
import { ShieldIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { playerlistAtom, serverMutexAtom, tagDefinitionsAtom } from '@/hooks/playerlist';
import { buildTagLookup } from '@/layout/PlayerlistSidebar/Playerlist';
import { getPrimaryPlayerTag } from '@shared/socketioTypes';
import { useOpenPlayerModal } from '@/hooks/playerModal';
import Avatar from '@/components/Avatar';
import { dashboardCardClass, DashboardCardHeader } from './DashboardCard';

const MAX_ENTRIES = 8;
const STAFF_TAG_ID = 'staff';

export default function DashboardOnlineNow() {
    const playerlist = useAtomValue(playerlistAtom);
    const serverMutex = useAtomValue(serverMutexAtom);
    const tagDefinitions = useAtomValue(tagDefinitionsAtom);
    const openPlayerModal = useOpenPlayerModal();
    const [, navigate] = useLocation();

    const tagLookup = useMemo(() => buildTagLookup(tagDefinitions), [tagDefinitions]);
    const staffPlayers = useMemo(
        () => playerlist.filter((player) => player.tags?.includes(STAFF_TAG_ID)),
        [playerlist],
    );
    const visiblePlayers = staffPlayers.slice(0, MAX_ENTRIES);
    const hiddenCount = staffPlayers.length - visiblePlayers.length;

    return (
        <div className={cn(dashboardCardClass, 'flex min-h-80 flex-1 flex-col')}>
            <DashboardCardHeader icon={ShieldIcon} title="Online Staff">
                <button
                    type="button"
                    onClick={() => navigate('/players')}
                    className="text-accent hover:text-accent/80 font-mono text-xs font-semibold transition-colors"
                >
                    {staffPlayers.length} →
                </button>
            </DashboardCardHeader>
            {visiblePlayers.length === 0 ? (
                <div className="text-muted-foreground flex flex-1 items-center justify-center px-5 text-center text-sm">
                    No staff online.
                </div>
            ) : (
                <div className="flex flex-col pb-2">
                    {visiblePlayers.map((player) => {
                        const secondaryTags = player.tags?.filter((tagId) => tagId !== STAFF_TAG_ID) ?? [];
                        const topTag = getPrimaryPlayerTag(secondaryTags, tagLookup);
                        const topTagData = topTag ? tagLookup[topTag] : undefined;
                        return (
                            <button
                                key={player.netid}
                                type="button"
                                onClick={() =>
                                    serverMutex && openPlayerModal({ mutex: serverMutex, netid: player.netid })
                                }
                                className="hover:bg-secondary/30 flex items-center gap-3 px-5 py-2.5 text-left transition-colors"
                            >
                                <Avatar username={player.displayName} className="size-9 shrink-0 rounded-lg text-xs" />
                                <div className="min-w-0 flex-1">
                                    <p className="text-foreground truncate text-sm leading-tight font-semibold">
                                        {player.displayName}
                                    </p>
                                    <p className="text-muted-foreground/70 mt-0.5 font-mono text-[11px] leading-none">
                                        #{player.netid}
                                    </p>
                                </div>
                                {topTagData && (
                                    <span
                                        className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-[0.04em]"
                                        style={{
                                            color: topTagData.color,
                                            borderColor: `${topTagData.color}46`,
                                            backgroundColor: `${topTagData.color}1a`,
                                        }}
                                    >
                                        {topTagData.label}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                    {hiddenCount > 0 && (
                        <button
                            type="button"
                            onClick={() => navigate('/players')}
                            className="text-muted-foreground/60 hover:text-foreground px-5 py-2 text-left text-xs font-medium transition-colors"
                        >
                            +{hiddenCount} more…
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
