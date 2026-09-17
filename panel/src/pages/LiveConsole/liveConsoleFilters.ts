import type { Terminal } from '@xterm/xterm';
import { parseFilterQuery, matchesFilterQuery } from '@/lib/textFilter';

/**
 * Category presets for the Live Console filter panel. Each preset is a regex
 * tested against the raw (rendered) buffer line text. When one or more presets
 * are active a line must match at least one of them (OR) on top of the
 * free-text query.
 */
export type ConsoleFilterPreset = {
    key: string;
    label: string;
    pattern: RegExp;
};

export const CONSOLE_FILTER_PRESETS: ConsoleFilterPreset[] = [
    {
        key: 'errors',
        label: 'Errors',
        pattern: /error|exception|fail(?:ed|ure)?|fatal|traceback|stack trace|unhandled|\berr\b/i,
    },
    {
        key: 'warnings',
        label: 'Warnings',
        pattern: /warn(?:ing)?|deprecat|\bcaution\b/i,
    },
    {
        key: 'commands',
        label: 'Commands',
        pattern: /executing command|\bcommand\b|txaevent|commandexecuted|\bcmd\b|console:\s*execute|\/[a-z0-9_]+\b/i,
    },
    {
        key: 'players',
        label: 'Players',
        pattern:
            /player|deferral|connecting|\bjoined\b|dropped|disconnect|identifier|license[0-9]?:|steam:|discord:|fivem:|\bnetid\b/i,
    },
    {
        key: 'chat',
        label: 'Chat',
        pattern: /chat(?:message)?|\[chat\]|\bsay\b/i,
    },
    {
        key: 'resources',
        label: 'Resources',
        pattern: /\bresource\b|\bensure\b|started resource|stopping resource|script:[a-z]/i,
    },
];

const PRESET_BY_KEY = new Map(CONSOLE_FILTER_PRESETS.map((p) => [p.key, p]));

export type ConsoleScanMatch = {
    /** Absolute line index within the terminal buffer (for `term.scrollToLine`). */
    lineNo: number;
    /** Rendered line text, trailing whitespace trimmed. */
    text: string;
};

export type ConsoleScanOptions = {
    query: string;
    activePresetKeys: string[];
    useRegex: boolean;
    limit?: number;
};

export type ConsoleScanResult = {
    matches: ConsoleScanMatch[];
    /** Lines scanned. */
    scanned: number;
    /** True when `limit` was hit and results were truncated. */
    truncated: boolean;
    /** Set when regex mode is on and the pattern failed to compile. */
    regexError?: string;
};

const DEFAULT_LIMIT = 1000;

/**
 * Walks the whole xterm buffer (scrollback included) and collects every line
 * that matches the given query + active category presets.
 */
export function scanConsoleBuffer(term: Terminal, opts: ConsoleScanOptions): ConsoleScanResult {
    const limit = opts.limit ?? DEFAULT_LIMIT;
    const buf = term.buffer.active;
    const total = buf.length;
    const matches: ConsoleScanMatch[] = [];

    const presets = opts.activePresetKeys.map((k) => PRESET_BY_KEY.get(k)).filter((p): p is ConsoleFilterPreset => !!p);

    const trimmedQuery = opts.query.trim();
    let compiledRegex: RegExp | null = null;
    let regexError: string | undefined;
    if (opts.useRegex && trimmedQuery) {
        try {
            compiledRegex = new RegExp(trimmedQuery, 'i');
        } catch (err) {
            regexError = err instanceof Error ? err.message : String(err);
        }
    }
    const parsed = opts.useRegex ? null : parseFilterQuery(opts.query);
    const hasTextFilter = compiledRegex !== null || (parsed !== null && !parsed.isEmpty);

    // Nothing to filter by -> no results (panel shows a hint instead of the whole buffer).
    if (!hasTextFilter && !presets.length) {
        return { matches, scanned: total, truncated: false, regexError };
    }
    if (opts.useRegex && trimmedQuery && !compiledRegex) {
        return { matches, scanned: total, truncated: false, regexError };
    }

    let truncated = false;
    for (let i = 0; i < total; i++) {
        const line = buf.getLine(i);
        if (!line) continue;
        const text = line.translateToString(true);
        if (!text) continue;

        if (presets.length) {
            let anyPreset = false;
            for (const preset of presets) {
                if (preset.pattern.test(text)) {
                    anyPreset = true;
                    break;
                }
            }
            if (!anyPreset) continue;
        }

        if (compiledRegex) {
            if (!compiledRegex.test(text)) continue;
        } else if (parsed && !parsed.isEmpty) {
            if (!matchesFilterQuery(text.toLowerCase(), parsed)) continue;
        }

        matches.push({ lineNo: i, text });
        if (matches.length >= limit) {
            truncated = true;
            break;
        }
    }

    return { matches, scanned: total, truncated, regexError };
}

const TS_PREFIX_RE = /^(\d{1,2}:\d{2}:\d{2}(?:\s?[AP]M)?)\s+(.*)$/i;

/** Splits a rendered buffer line into its leading timestamp and the rest. */
export function splitConsoleLine(text: string): { ts: string | null; rest: string } {
    const match = text.match(TS_PREFIX_RE);
    if (!match) return { ts: null, rest: text };
    return { ts: match[1], rest: match[2] };
}
