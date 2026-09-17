import { lazy, Suspense } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useGlobalMenuSheet, usePlayerlistSheet } from '@/hooks/sheets';
import { NavLink } from '@/components/MainPageLink';
import { LogoFullSquareGreen } from '@/components/Logos';
import { useSwipeGestures } from '@/hooks/useSwipeGestures';
import { SidebarNavContent, ServerStatusCard, SidebarUserButton, SidebarCollapsedCtx } from './LeftSidebar';

const PlayerlistSidebar = lazy(() =>
    import('./PlayerlistSidebar/PlayerlistSidebar').then((module) => ({ default: module.PlayerlistSidebar })),
);

/**
 * Mobile global menu — mirrors the desktop LeftSidebar (sectioned navigation,
 * server status card, account button) inside a slide-out sheet.
 */
function GlobalMenuSheet() {
    const { isSheetOpen, setIsSheetOpen } = useGlobalMenuSheet();

    return (
        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
            <SheetContent
                side="left"
                className="xs:w-80 border-border/40 bg-background flex w-full flex-col gap-0 p-0 select-none"
                onOpenAutoFocus={(e) => e.preventDefault()}
            >
                <SidebarCollapsedCtx.Provider value={false}>
                    {/* Logo row */}
                    <SheetHeader className="border-border/40 flex h-14 shrink-0 items-center justify-center border-b px-4">
                        <SheetTitle className="sr-only">Navigation</SheetTitle>
                        <NavLink
                            href="/"
                            className="flex items-center justify-center opacity-90 transition-opacity hover:opacity-100"
                        >
                            <LogoFullSquareGreen className="h-8" />
                        </NavLink>
                    </SheetHeader>

                    {/* Scrollable nav body */}
                    <ScrollArea className="flex-1">
                        <div className="flex h-full flex-col">
                            <SidebarNavContent />
                        </div>
                    </ScrollArea>

                    {/* Bottom: server status + user */}
                    <div className="border-border/40 flex shrink-0 flex-col gap-2 border-t p-3">
                        <ServerStatusCard />
                        <SidebarUserButton />
                    </div>
                </SidebarCollapsedCtx.Provider>
            </SheetContent>
        </Sheet>
    );
}

function PlayersSidebarSheet() {
    const { isSheetOpen, setIsSheetOpen } = usePlayerlistSheet();
    return (
        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
            <SheetContent side="right" className="xs:w-80 w-full p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
                <ScrollArea className="h-full">
                    <Suspense fallback={null}>
                        <PlayerlistSidebar isSheet />
                    </Suspense>
                </ScrollArea>
            </SheetContent>
        </Sheet>
    );
}

export default function MainSheets() {
    useSwipeGestures();
    return (
        <>
            <GlobalMenuSheet />
            <PlayersSidebarSheet />
        </>
    );
}
