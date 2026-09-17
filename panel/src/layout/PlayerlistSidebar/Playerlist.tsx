import { playerlistAtom, serverMutexAtom, tagDefinitionsAtom } from '@/hooks/playerlist';
import {
    AUTO_TAG_DEFINITIONS,
    getPrimaryPlayerTag,
    PlayerTag,
    PlayerlistPlayerType,
    TagDefinition,
} from '@shared/socketioTypes';
import { useAtomValue } from 'jotai';
import { VirtualItem, useVirtualizer } from '@tanstack/react-virtual';
import { memo, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { FilterXIcon, SlidersHorizontalIcon, XIcon } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useOpenPlayerModal } from '@/hooks/playerModal';
import InlineCode from '@/components/InlineCode';
import Avatar from '@/components/Avatar';
import { useEventListener } from 'usehooks-ts';
import Fuse from 'fuse.js';
import { useLocale } from '@/hooks/locale';

function TagColor({ color }: { color: string }) {
    return (
        <div
            className="outline-hidden focus:outline-hidden"
            style={{
                display: 'inline-block',
                backgroundColor: color,
                width: '0.375rem',
                borderRadius: '2px',
            }}
        >
            &nbsp;
        </div>
    );
}

/**
 * Builds a lookup map from tag definitions array, with auto-tag fallbacks.
 * Disabled tags are excluded.
 */
export const buildTagLookup = (
    defs: TagDefinition[],
): Record<string, { label: string; color: string; priority: number }> => {
    const lookup: Record<string, { label: string; color: string; priority: number }> = {};
    for (const auto of AUTO_TAG_DEFINITIONS) {
        lookup[auto.id] = { label: auto.label, color: auto.color, priority: auto.priority };
    }
    for (const d of defs) {
        if (d.enabled === false) {
            delete lookup[d.id];
        } else {
            lookup[d.id] = { label: d.label, color: d.color, priority: d.priority };
        }
    }
    return lookup;
};

type SortMode = 'id' | 'tag';

type PlayerlistFilterProps = {
    filterString: string;
    setFilterString: (s: string) => void;
    tagFilters: Set<PlayerTag>;
    setTagFilters: React.Dispatch<React.SetStateAction<Set<PlayerTag>>>;
    sortMode: SortMode;
    setSortMode: (s: SortMode) => void;
    tagLookup: Record<string, { label: string; color: string; priority: number }>;
};
function PlayerlistFilter({
    filterString,
    setFilterString,
    tagFilters,
    setTagFilters,
    sortMode,
    setSortMode,
    tagLookup,
}: PlayerlistFilterProps) {
    const { t } = useLocale();
    const inputRef = useRef<HTMLInputElement>(null);
    useEventListener('message', (e: TxMessageEvent) => {
        if (e.data.type === 'globalHotkey' && e.data.action === 'focusPlayerlistFilter') {
            inputRef.current?.focus();
        }
    });

    const toggleTag = (tag: PlayerTag) => {
        setTagFilters((prev) => {
            const next = new Set(prev);
            if (next.has(tag)) {
                next.delete(tag);
            } else {
                next.add(tag);
            }
            return next;
        });
    };

    const hasActiveFilters = tagFilters.size > 0;

    return (
        <div className="flex gap-2 px-2 pt-2">
            <div className="relative w-full">
                <Input
                    ref={inputRef}
                    className="h-8 pr-14"
                    placeholder={t('panel.playerlist.filter_placeholder')}
                    value={filterString}
                    onChange={(e) => setFilterString(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                            setFilterString('');
                        }
                    }}
                />
                {filterString ? (
                    <button
                        className="ring-offset-background focus-visible:ring-ring text-muted-foreground absolute inset-y-0 right-2 rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden"
                        onClick={() => setFilterString('')}
                    >
                        <XIcon />
                    </button>
                ) : (
                    <div className="text-muted-foreground pointer-events-none absolute inset-y-0 right-2 flex items-center select-none">
                        <InlineCode className="text-xs tracking-wide">ctrl+k</InlineCode>
                    </div>
                )}
            </div>
            <DropdownMenu>
                <DropdownMenuTrigger
                    disabled={!!filterString}
                    className={cn(
                        'inline-flex size-8 shrink-0 items-center justify-center rounded-md',
                        'ring-offset-background focus-visible:ring-ring transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden',
                        'bg-secondary/40 border-border/60 text-muted-foreground border',
                        'hover:bg-secondary/70 hover:text-foreground',
                        filterString && 'pointer-events-none opacity-50',
                        hasActiveFilters && 'border-accent text-accent',
                    )}
                >
                    <SlidersHorizontalIcon className="h-5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                    <DropdownMenuLabel>{t('panel.playerlist.filter_by_tag')}</DropdownMenuLabel>
                    {Object.keys(tagLookup)
                        .sort((a, b) => (tagLookup[a].priority ?? 999) - (tagLookup[b].priority ?? 999))
                        .map((tag) => (
                            <DropdownMenuCheckboxItem
                                key={tag}
                                checked={tagFilters.has(tag)}
                                onCheckedChange={() => toggleTag(tag)}
                                className="hover:bg-secondary! focus:bg-secondary! cursor-pointer hover:text-current! focus:text-current!"
                            >
                                <div className="flex min-w-full justify-around">
                                    <span className="grow pr-4">{tagLookup[tag].label}</span>
                                    <TagColor color={tagLookup[tag].color} />
                                </div>
                            </DropdownMenuCheckboxItem>
                        ))}
                    <DropdownMenuItem
                        onClick={() => setTagFilters(new Set())}
                        className="hover:bg-secondary! focus:bg-secondary! cursor-pointer hover:text-current! focus:text-current!"
                    >
                        <FilterXIcon className="mr-2 size-4" />
                        {t('panel.playerlist.clear_filter')}
                    </DropdownMenuItem>

                    <DropdownMenuSeparator />

                    <DropdownMenuLabel>{t('panel.playerlist.sort_by')}</DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
                        <DropdownMenuRadioItem
                            value="id"
                            className="hover:bg-secondary! focus:bg-secondary! cursor-pointer hover:text-current! focus:text-current!"
                        >
                            {t('panel.playerlist.join_order')}
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem
                            value="tag"
                            className="hover:bg-secondary! focus:bg-secondary! cursor-pointer hover:text-current! focus:text-current!"
                        >
                            {t('panel.playerlist.tag_priority')}
                        </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
const PlayerlistFilterMemo = memo(PlayerlistFilter);

type PlayerlistPlayerProps = {
    virtualItem: VirtualItem;
    player: PlayerlistPlayerType;
    modalOpener: (netid: number) => void;
    tagLookup: Record<string, { label: string; color: string; priority: number }>;
};
function PlayerlistPlayer({ virtualItem, player, modalOpener, tagLookup }: PlayerlistPlayerProps) {
    const topTag = getPrimaryPlayerTag(player.tags ?? [], tagLookup);
    const topTagData = topTag ? tagLookup[topTag] : undefined;

    return (
        <div
            className="hover:bg-secondary/30 focus-visible:bg-secondary/30 absolute top-0 left-0 flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors focus-visible:outline-hidden"
            style={{
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
            }}
            onClick={() => modalOpener(player.netid)}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    if (event.key === ' ') event.preventDefault();
                    modalOpener(player.netid);
                }
            }}
            role="button"
            tabIndex={0}
        >
            <Avatar username={player.displayName} className="size-7 shrink-0 rounded-md text-[10px]" />
            <div className="min-w-0 flex-1 leading-tight">
                <p className="text-foreground truncate text-sm font-semibold">{player.displayName}</p>
                <p className="text-muted-foreground/70 mt-0.5 font-mono text-[11px] leading-none">#{player.netid}</p>
            </div>
            {topTagData && (
                <span
                    className="shrink-0 truncate rounded-full border px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.04em] uppercase"
                    style={{
                        color: topTagData.color,
                        borderColor: `${topTagData.color}46`,
                        backgroundColor: `${topTagData.color}1a`,
                    }}
                >
                    {topTagData.label}
                </span>
            )}
        </div>
    );
}

export default function Playerlist() {
    const { t } = useLocale();
    const playerlist = useAtomValue(playerlistAtom);
    const serverMutex = useAtomValue(serverMutexAtom);
    const tagDefinitions = useAtomValue(tagDefinitionsAtom);
    const openPlayerModal = useOpenPlayerModal();
    const scrollRef = useRef<HTMLDivElement>(null);
    const [filterString, setFilterString] = useState('');
    const [tagFilters, setTagFilters] = useState<Set<PlayerTag>>(new Set());
    const [sortMode, setSortMode] = useState<SortMode>('id');

    const tagLookup = useMemo(() => buildTagLookup(tagDefinitions), [tagDefinitions]);

    // Build Fuse index (recreated when playerlist changes)
    const fuse = useMemo(
        () =>
            new Fuse(playerlist, {
                keys: ['pureName', 'displayName'],
                threshold: 0.4,
                includeScore: true,
            }),
        [playerlist],
    );

    // Debounced filter string (250ms)
    const [debouncedFilter, setDebouncedFilter] = useState('');
    useMemo(() => {
        const timer = setTimeout(() => setDebouncedFilter(filterString), 250);
        return () => clearTimeout(timer);
    }, [filterString]);

    const filteredPlayerlist = useMemo(() => {
        let result: PlayerlistPlayerType[];

        // Text search with Fuse.js
        if (debouncedFilter.trim()) {
            // Check if filter is a numeric ID
            const numFilter = debouncedFilter.trim();
            if (/^\d+$/.test(numFilter)) {
                // Exact ID prefix match first, then fuzzy name
                const idMatches = playerlist.filter((p) => p.netid.toString().startsWith(numFilter));
                const fuseMatches = fuse.search(debouncedFilter).map((r) => r.item);
                const seen = new Set(idMatches.map((p) => p.netid));
                result = [...idMatches, ...fuseMatches.filter((p) => !seen.has(p.netid))];
            } else {
                result = fuse.search(debouncedFilter).map((r) => r.item);
            }
        } else {
            result = [...playerlist];
        }

        // Tag filtering (show players that have ANY of the selected tags)
        if (tagFilters.size > 0) {
            result = result.filter((p) => (p.tags ?? []).some((t) => tagFilters.has(t)));
        }

        // Sorting
        if (sortMode === 'tag' && !debouncedFilter.trim()) {
            result.sort((a, b) => {
                const aTag = getPrimaryPlayerTag(a.tags ?? [], tagLookup);
                const bTag = getPrimaryPlayerTag(b.tags ?? [], tagLookup);
                const aPriority = aTag ? (tagLookup[aTag]?.priority ?? 999) : 999;
                const bPriority = bTag ? (tagLookup[bTag]?.priority ?? 999) : 999;
                if (aPriority !== bPriority) return aPriority - bPriority;
                return a.netid - b.netid;
            });
        }

        return result;
    }, [playerlist, debouncedFilter, fuse, tagFilters, sortMode, tagLookup]);

    // The virtualizer
    const rowVirtualizer = useVirtualizer({
        isScrollingResetDelay: 0,
        count: filteredPlayerlist.length,
        getScrollElement: () => (scrollRef.current as HTMLDivElement)?.getElementsByTagName('div')[0],
        estimateSize: () => 44,
        overscan: 15,
    });
    const virtualItems = rowVirtualizer.getVirtualItems();

    const modalOpener = (netid: number) => {
        if (!serverMutex) return;
        openPlayerModal({ mutex: serverMutex, netid });
    };

    const isFiltered = filteredPlayerlist.length !== playerlist.length;

    return (
        <>
            <PlayerlistFilterMemo
                filterString={filterString}
                setFilterString={setFilterString}
                tagFilters={tagFilters}
                setTagFilters={setTagFilters}
                sortMode={sortMode}
                setSortMode={setSortMode}
                tagLookup={tagLookup}
            />

            <div
                className={cn(
                    'text-warning-inline px-3 py-1.5 text-center text-xs tracking-wide italic',
                    isFiltered && virtualItems.length ? 'block' : 'hidden',
                )}
            >
                {t('panel.playerlist.showing_count', {
                    shown: filteredPlayerlist.length,
                    total: playerlist.length,
                })}
            </div>
            <div
                className={cn(
                    'text-muted-foreground px-4 py-8 text-center tracking-wide italic',
                    virtualItems.length ? 'hidden' : 'block',
                )}
            >
                {playerlist.length && (filterString || tagFilters.size) ? (
                    <p>
                        {t('panel.playerlist.no_players_filtered')}
                        <span className="block text-xs opacity-75">{t('panel.playerlist.clear_filter_hint')}</span>
                    </p>
                ) : (
                    <p>
                        {t('panel.playerlist.no_players_online')}
                        <span className="block text-xs opacity-75">{t('panel.playerlist.invite_friends_hint')}</span>
                    </p>
                )}
            </div>

            <ScrollArea className="h-full select-none" ref={scrollRef}>
                <div
                    style={{
                        height: `${rowVirtualizer.getTotalSize()}px`,
                        width: '100%',
                        position: 'relative',
                    }}
                >
                    {virtualItems.map((virtualItem) => (
                        <PlayerlistPlayer
                            key={virtualItem.key}
                            virtualItem={virtualItem}
                            player={filteredPlayerlist[virtualItem.index]}
                            modalOpener={modalOpener}
                            tagLookup={tagLookup}
                        />
                    ))}
                </div>
            </ScrollArea>
        </>
    );
}
