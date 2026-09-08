import { useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { useEventListener } from 'usehooks-ts';
import { cn } from '@/lib/utils';
import { NavLink } from '@/components/MainPageLink';
import { LogoFullSquareGreen } from '@/components/Logos';
import type { LucideIcon } from 'lucide-react';
import { SIDEBAR_SECTIONS } from './sidebarConfig';
import { isPanelFeatureEnabled } from '@/lib/panelFeatures';
import { useServerControls } from './LeftSidebar';
import { useAdminPerms } from '@/hooks/auth';
import { useAddonLoader } from '@/hooks/addons';
import { useLocale } from '@/hooks/locale';
import { AuthedHeaderFragment, IconButton, ServerIdentity } from './Header';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import {
    SearchIcon,
    BlocksIcon,
    ChevronDownIcon,
    WrenchIcon,
    PowerIcon,
    PowerOffIcon,
    RotateCcwIcon,
} from 'lucide-react';

type TopNavItem = { href: string; icon: LucideIcon; label: string };
type FlatNavItem = TopNavItem & { sectionLabel: string };

// ─── Quick page-jump flyout ────────────────────────────────────────────────
function TopNavQuickJump({ items }: { items: FlatNavItem[] }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [, navigate] = useLocation();
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEventListener('mousedown', (e) => {
        if (!open) return;
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
            setOpen(false);
        }
    });

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return items;
        return items.filter(
            (item) => item.label.toLowerCase().includes(q) || item.sectionLabel.toLowerCase().includes(q),
        );
    }, [items, query]);

    const openMenu = () => {
        setOpen(true);
        setQuery('');
        requestAnimationFrame(() => inputRef.current?.focus());
    };

    const goTo = (href: string) => {
        setOpen(false);
        navigate(href);
    };

    return (
        <div ref={containerRef} className="relative">
            <IconButton
                label="Jump to page"
                icon={<SearchIcon />}
                onClick={() => (open ? setOpen(false) : openMenu())}
            />
            {open && (
                <div className="bg-popover text-popover-foreground border-border/60 absolute top-full right-0 z-50 mt-2 w-72 rounded-lg border p-2 shadow-lg">
                    <Input
                        ref={inputRef}
                        placeholder="Jump to a page…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') setOpen(false);
                            if (e.key === 'Enter' && filtered[0]) goTo(filtered[0].href);
                        }}
                        className="h-8"
                    />
                    <div className="mt-2 max-h-72 overflow-y-auto">
                        {filtered.length === 0 && (
                            <p className="text-muted-foreground px-2 py-3 text-center text-xs">No matching pages</p>
                        )}
                        {filtered.map((item) => (
                            <button
                                key={item.href}
                                type="button"
                                onClick={() => goTo(item.href)}
                                className="hover:bg-secondary/60 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
                            >
                                <item.icon className="text-muted-foreground size-3.5 shrink-0" />
                                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                                <span className="text-muted-foreground/50 shrink-0 text-[10px]">
                                    {item.sectionLabel}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Server power controls (horizontal, sized to match the other header buttons) ─
function TopNavServerControls() {
    const { isConfigured, isRunning, isAlive, hasControlPerm, handleControl } = useServerControls();
    const { t } = useLocale();
    if (!isConfigured) return null;

    return (
        <div className="flex items-center gap-1.5">
            <Tooltip>
                <TooltipTrigger
                    type="button"
                    onClick={() => handleControl(isRunning ? 'stop' : 'start')}
                    disabled={!hasControlPerm}
                    className={cn(
                        'inline-flex size-9 items-center justify-center rounded-lg border transition-colors disabled:pointer-events-none disabled:opacity-40',
                        isRunning
                            ? 'border-destructive/40 bg-destructive/10 text-destructive-inline hover:bg-destructive/20'
                            : 'border-success/40 bg-success/10 text-success-inline hover:bg-success/20',
                    )}
                >
                    {isRunning ? <PowerOffIcon className="size-4" /> : <PowerIcon className="size-4" />}
                </TooltipTrigger>
                <TooltipContent side="bottom">
                    {isRunning ? t('panel.sidebar.stop_server') : t('panel.sidebar.start_server')}
                </TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger
                    type="button"
                    onClick={() => handleControl('restart')}
                    disabled={!hasControlPerm || !isAlive}
                    className="border-info/40 bg-info/10 text-info-inline hover:bg-info/20 inline-flex size-9 items-center justify-center rounded-lg border transition-colors disabled:pointer-events-none disabled:opacity-40"
                >
                    <RotateCcwIcon className="size-4" />
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('panel.sidebar.restart_server')}</TooltipContent>
            </Tooltip>
        </div>
    );
}

// ─── Single nav tab (section) ───────────────────────────────────────────────
function TopNavSection({ label, items }: { label: string; items: TopNavItem[] }) {
    const [location, navigate] = useLocation();
    const hrefs = items.map((item) => item.href);
    // Match active state against any href in this section
    const sectionIsActive = hrefs.some((href) => (href === '/' ? location === '/' : location.startsWith(href)));

    const tabClass = cn(
        'flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors select-none',
        sectionIsActive
            ? 'bg-accent/10 text-accent'
            : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40',
    );

    if (items.length === 1) {
        return (
            <NavLink href={items[0].href} className={tabClass}>
                {label}
            </NavLink>
        );
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger className={cn(tabClass, 'outline-hidden')}>
                {label}
                <ChevronDownIcon className="size-3.5 opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
                {items.map((item) => (
                    <DropdownMenuItem
                        key={item.href}
                        className="cursor-pointer gap-2"
                        onClick={() => navigate(item.href)}
                    >
                        <item.icon className="text-muted-foreground size-4" />
                        {item.label}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

// ─── Main export ────────────────────────────────────────────────────────────
export default function TopNav() {
    const { hasPerm } = useAdminPerms();
    const { pages: addonPages } = useAddonLoader();
    const { t } = useLocale();

    // Addon pages are appended to the "addons" section, matching LeftSidebar's SidebarNavContent behavior
    const addonSectionItems: TopNavItem[] = addonPages
        .filter((page) => !page.permission || hasPerm(page.permission))
        .map((page) => ({ href: page.path, icon: BlocksIcon, label: page.title }));

    const visibleSections = SIDEBAR_SECTIONS.map((section) => {
        const staticItems: TopNavItem[] = section.items
            .filter((item) => !(window.txConsts.hideReportsNav && item.href.startsWith('/reports')))
            .filter((item) => !item.featureFlag || isPanelFeatureEnabled(item.featureFlag))
            .filter((item) => !item.permission || hasPerm(item.permission))
            .map((item) => ({ href: item.href, icon: item.icon, label: t(item.labelKey) }));
        const items =
            section.sectionKey === 'panel.sidebar.section.addons'
                ? [...staticItems, ...addonSectionItems]
                : section.sectionKey === 'panel.sidebar.section.system' &&
                    import.meta.env.DEV &&
                    hasPerm('all_permissions')
                  ? [...staticItems, { href: '/advanced', icon: WrenchIcon, label: t('panel.sidebar.item.advanced') }]
                  : staticItems;
        return { sectionKey: section.sectionKey, label: t(section.sectionKey), items };
    }).filter((section) => section.items.length > 0);

    const flatItems: FlatNavItem[] = visibleSections.flatMap((section) =>
        section.items.map((item) => ({ ...item, sectionLabel: section.label })),
    );

    return (
        <header className="tx-shell-desktop-topnav border-border/40 bg-background h-14 shrink-0 border-b">
            <div className="flex h-14 items-center gap-1 px-3 sm:px-4">
                <NavLink
                    href="/"
                    className="mr-2 flex shrink-0 items-center opacity-90 transition-opacity hover:opacity-100"
                >
                    <LogoFullSquareGreen className="h-7" />
                </NavLink>

                <div className="mr-3 shrink-0">
                    <ServerIdentity />
                </div>

                <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {visibleSections.map((section) => (
                        <TopNavSection key={section.sectionKey} label={section.label} items={section.items} />
                    ))}
                </nav>

                <div className="ml-2 flex shrink-0 items-center gap-1.5">
                    <TopNavServerControls />
                    <div className="bg-border/60 mx-1 h-6 w-px" />
                    <TopNavQuickJump items={flatItems} />
                    <AuthedHeaderFragment />
                </div>
            </div>
        </header>
    );
}
