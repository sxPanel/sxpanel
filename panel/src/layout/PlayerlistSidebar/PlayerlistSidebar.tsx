import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import PlayerlistSummary from './PlayerlistSummary';
import Playerlist from './Playerlist';
import { PlayerlistCollapsedCtx } from './PlayerlistCollapsedContext';

const COLLAPSED_STORAGE_KEY = 'playerlist-collapsed';
const WIDTH_STORAGE_KEY = 'playerlist-width';
const MIN_WIDTH = 220;
const MAX_WIDTH = 480;

const readStoredWidth = (): number | null => {
    try {
        const raw = localStorage.getItem(WIDTH_STORAGE_KEY);
        if (!raw) return null;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) return null;
        return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed));
    } catch {
        return null;
    }
};

type PlayerSidebarProps = {
    isSheet?: boolean;
};
export function PlayerlistSidebar({ isSheet }: PlayerSidebarProps) {
    const [collapsed, setCollapsed] = useState(() => {
        try {
            return localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true';
        } catch {
            return false;
        }
    });
    // null = fall back to the CSS default (--tx-playerlist-width, 16rem)
    const [width, setWidth] = useState<number | null>(() => (isSheet ? null : readStoredWidth()));
    const asideRef = useRef<HTMLElement>(null);

    const toggleCollapsed = () => {
        setCollapsed((prev) => {
            const next = !prev;
            try {
                localStorage.setItem(COLLAPSED_STORAGE_KEY, String(next));
            } catch {}
            return next;
        });
    };

    // The mobile sheet is always fully expanded, regardless of the desktop collapse preference
    const isCollapsed = !isSheet && collapsed;
    const canResize = !isSheet && !isCollapsed;

    const handleResizeStart = (event: React.PointerEvent) => {
        if (!canResize || event.button !== 0) return;
        event.preventDefault();

        const startX = event.clientX;
        const startWidth = asideRef.current?.getBoundingClientRect().width ?? width ?? 256;
        const asideEl = asideRef.current;
        if (asideEl) asideEl.style.transition = 'none';
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const handleMove = (moveEvent: PointerEvent) => {
            // Dragging the left edge left grows the (right-anchored) panel, so subtract dx
            const dx = moveEvent.clientX - startX;
            const maxWidth = Math.min(MAX_WIDTH, window.innerWidth * 0.5);
            const next = Math.round(Math.min(maxWidth, Math.max(MIN_WIDTH, startWidth - dx)));
            setWidth(next);
        };
        const handleUp = () => {
            window.removeEventListener('pointermove', handleMove);
            window.removeEventListener('pointerup', handleUp);
            if (asideEl) asideEl.style.transition = '';
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            setWidth((current) => {
                if (current != null) {
                    try {
                        localStorage.setItem(WIDTH_STORAGE_KEY, String(current));
                    } catch {}
                }
                return current;
            });
        };

        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', handleUp, { once: true });
    };

    const handleResizeReset = () => {
        if (!canResize) return;
        setWidth(null);
        try {
            localStorage.removeItem(WIDTH_STORAGE_KEY);
        } catch {}
    };

    return (
        <PlayerlistCollapsedCtx.Provider value={isCollapsed}>
            <aside
                ref={asideRef}
                style={
                    canResize && width != null
                        ? ({ '--tx-playerlist-width': `${width}px` } as React.CSSProperties)
                        : undefined
                }
                className={cn(
                    'z-10 flex-col',
                    isSheet
                        ? 'flex h-screen w-full'
                        : cn(
                              'tx-sidebar shell-lg:flex relative hidden',
                              'bg-background border-border/80 rounded-xl border',
                              isCollapsed
                                  ? 'h-auto w-(--tx-playerlist-collapsed-width)'
                                  : 'min-h-contentvh w-(--tx-playerlist-width)',
                          ),
                )}
            >
                {canResize && (
                    <div
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Resize player list"
                        onPointerDown={handleResizeStart}
                        onDoubleClick={handleResizeReset}
                        title="Drag to resize, double-click to reset"
                        className="group absolute top-0 left-0 z-10 h-full w-2.5 -translate-x-1/2 cursor-col-resize touch-none select-none"
                    >
                        <div className="bg-border/0 group-hover:bg-accent/50 group-active:bg-accent mx-auto h-full w-px transition-colors" />
                    </div>
                )}
                <div
                    className={cn(
                        'shrink-0',
                        isSheet ? 'border-b p-4 pr-12' : 'border-border/40 border-b px-3 py-2.5',
                        isCollapsed && 'border-b-0 px-2',
                    )}
                >
                    <PlayerlistSummary onToggleCollapsed={isSheet ? undefined : toggleCollapsed} />
                </div>
                {!isCollapsed && (
                    <div className="flex min-h-0 flex-1 grow flex-col gap-2 overflow-hidden pb-1">
                        <Playerlist />
                    </div>
                )}
            </aside>
        </PlayerlistCollapsedCtx.Provider>
    );
}
