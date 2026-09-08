import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import { ArrowDownToLineIcon, ListFilterIcon, RefreshCwIcon, RegexIcon, XIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useLocale } from '@/hooks/locale';
import {
    CONSOLE_FILTER_PRESETS,
    scanConsoleBuffer,
    splitConsoleLine,
    type ConsoleScanMatch,
} from './liveConsoleFilters';

type LiveConsoleFilterPanelProps = {
    term: Terminal;
    /** Bumped by the page whenever new console data is written. */
    bufferVersion: number;
    onClose: () => void;
};

const SCAN_DEBOUNCE_MS = 150;

export default function LiveConsoleFilterPanel({ term, bufferVersion, onClose }: LiveConsoleFilterPanelProps) {
    const { t } = useLocale();
    const [query, setQuery] = useState('');
    const [useRegex, setUseRegex] = useState(false);
    const [activePresets, setActivePresets] = useState<string[]>([]);
    const [follow, setFollow] = useState(true);
    const [matches, setMatches] = useState<ConsoleScanMatch[]>([]);
    const [truncated, setTruncated] = useState(false);
    const [regexError, setRegexError] = useState<string | undefined>(undefined);
    const [selectedLine, setSelectedLine] = useState<number | null>(null);

    const inputRef = useRef<HTMLInputElement>(null);
    const resultsRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const togglePreset = useCallback((key: string) => {
        setActivePresets((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
    }, []);

    const runScan = useCallback(() => {
        const result = scanConsoleBuffer(term, {
            query,
            activePresetKeys: activePresets,
            useRegex,
        });
        setMatches(result.matches);
        setTruncated(result.truncated);
        setRegexError(result.regexError);
    }, [term, query, activePresets, useRegex]);

    // Debounced re-scan on query / preset / buffer changes.
    useEffect(() => {
        const id = window.setTimeout(runScan, SCAN_DEBOUNCE_MS);
        return () => window.clearTimeout(id);
    }, [runScan, bufferVersion]);

    // Keep the results list pinned to the newest match while following.
    useEffect(() => {
        if (!follow || !resultsRef.current) return;
        resultsRef.current.scrollTop = resultsRef.current.scrollHeight;
    }, [matches, follow]);

    const handleResultsScroll = useCallback(() => {
        const el = resultsRef.current;
        if (!el) return;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        setFollow(atBottom);
    }, []);

    const jumpToLine = useCallback(
        (lineNo: number) => {
            term.scrollToLine(Math.max(0, lineNo - 3));
            try {
                term.selectLines(lineNo, lineNo);
            } catch {
                /* selectLines is proposed API; ignore if unavailable */
            }
            setSelectedLine(lineNo);
        },
        [term],
    );

    const hasFilter = query.trim().length > 0 || activePresets.length > 0;
    const countLabel = useMemo(() => {
        if (!hasFilter) return '';
        if (regexError) return t('panel.live_console.filter.bad_regex');
        const n = matches.length;
        const suffix = truncated ? '+' : '';
        return t('panel.live_console.filter.match_count', { count: `${n}${suffix}` });
    }, [hasFilter, regexError, matches.length, truncated, t]);

    return (
        <div
            className={cn(
                'bg-card absolute top-0 right-0 bottom-0 z-20 flex w-full flex-col border-l shadow-2xl',
                'sm:w-95',
            )}
            role="region"
            aria-label={t('panel.live_console.filter.title')}
        >
            {/* Header */}
            <div className="flex items-center gap-2 border-b px-3 py-2">
                <ListFilterIcon className="text-muted-foreground size-4 shrink-0" />
                <span className="text-sm font-semibold">{t('panel.live_console.filter.title')}</span>
                <span className="text-muted-foreground ml-auto text-xs tabular-nums">{countLabel}</span>
                <button
                    title={t('panel.live_console.filter.refresh')}
                    className="hover:bg-secondary text-muted-foreground hover:text-foreground rounded p-1"
                    onClick={runScan}
                >
                    <RefreshCwIcon className="size-4" />
                </button>
                <button
                    title={t('panel.live_console.search.close')}
                    className="hover:bg-secondary text-muted-foreground hover:text-foreground rounded p-1"
                    onClick={onClose}
                >
                    <XIcon className="size-4" />
                </button>
            </div>

            {/* Query input */}
            <div className="border-b px-3 py-2">
                <div className="relative">
                    <Input
                        ref={inputRef}
                        className="h-8 pr-8 text-sm"
                        placeholder={t('panel.live_console.filter.placeholder')}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                                e.stopPropagation();
                                if (query) setQuery('');
                                else onClose();
                            }
                        }}
                        autoCapitalize="none"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                    <button
                        title={t('panel.live_console.search.regex')}
                        className={cn(
                            'absolute top-1/2 right-1 -translate-y-1/2 rounded p-1',
                            'text-muted-foreground hover:bg-secondary hover:text-foreground',
                            useRegex && 'bg-muted-foreground text-secondary',
                        )}
                        onClick={() => setUseRegex((v) => !v)}
                    >
                        <RegexIcon className="size-4" />
                    </button>
                </div>
                {!useRegex && (
                    <p className="text-muted-foreground/70 mt-1 text-[11px]">{t('panel.live_console.filter.hint')}</p>
                )}
            </div>

            {/* Category presets */}
            <div className="flex flex-wrap gap-1 border-b px-3 py-2">
                {CONSOLE_FILTER_PRESETS.map((preset) => {
                    const active = activePresets.includes(preset.key);
                    return (
                        <button
                            key={preset.key}
                            type="button"
                            onClick={() => togglePreset(preset.key)}
                            className={cn(
                                'rounded-md border px-2 py-0.5 text-xs font-medium transition-colors',
                                active
                                    ? 'bg-secondary text-secondary-foreground border-border'
                                    : 'text-muted-foreground/60 hover:border-border border-transparent',
                            )}
                        >
                            {preset.label}
                        </button>
                    );
                })}
            </div>

            {/* Results */}
            <div
                ref={resultsRef}
                onScroll={handleResultsScroll}
                className="min-h-0 flex-1 overflow-y-auto font-mono text-xs [scrollbar-width:thin]"
            >
                {!hasFilter ? (
                    <p className="text-muted-foreground/60 px-3 py-6 text-center text-xs">
                        {t('panel.live_console.filter.empty_hint')}
                    </p>
                ) : matches.length === 0 ? (
                    <p className="text-muted-foreground/60 px-3 py-6 text-center text-xs">
                        {t('panel.live_console.filter.no_matches')}
                    </p>
                ) : (
                    matches.map((match) => {
                        const { ts, rest } = splitConsoleLine(match.text);
                        return (
                            <button
                                key={match.lineNo}
                                type="button"
                                onClick={() => jumpToLine(match.lineNo)}
                                className={cn(
                                    'hover:bg-secondary/60 flex w-full items-start gap-2 border-l-2 px-3 py-1 text-left transition-colors',
                                    selectedLine === match.lineNo
                                        ? 'border-l-primary bg-secondary/40'
                                        : 'border-l-transparent',
                                )}
                            >
                                {ts && <span className="text-muted-foreground/70 shrink-0 tabular-nums">{ts}</span>}
                                <span className="text-secondary-foreground break-all whitespace-pre-wrap">{rest}</span>
                            </button>
                        );
                    })
                )}
            </div>

            {/* Footer */}
            <div className="text-muted-foreground flex items-center gap-2 border-t px-3 py-1.5 text-xs">
                <label className="flex cursor-pointer items-center gap-1.5 select-none">
                    <input
                        type="checkbox"
                        className="accent-primary size-3.5"
                        checked={follow}
                        onChange={(e) => setFollow(e.target.checked)}
                    />
                    {t('panel.live_console.filter.follow')}
                </label>
                <button
                    className="hover:text-foreground ml-auto flex items-center gap-1"
                    onClick={() => {
                        const last = matches[matches.length - 1];
                        if (last) jumpToLine(last.lineNo);
                    }}
                    disabled={!matches.length}
                >
                    <ArrowDownToLineIcon className="size-3.5" />
                    {t('panel.live_console.filter.jump_newest')}
                </button>
            </div>
        </div>
    );
}
