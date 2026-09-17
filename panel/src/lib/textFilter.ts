/**
 * Shared free-text filter parsing used by the Live Console filter panel and the
 * Server Log search box.
 *
 * Query syntax:
 *   - space separated terms  -> all must match (AND)          `player command`
 *   - "quoted phrase"        -> literal substring, still AND   `"ran command"`
 *   - -term / -"phrase"      -> must NOT match (exclude)       `player -bot`
 *
 * Everything is matched case-insensitively.
 */

export type ParsedFilterQuery = {
    include: string[];
    phrases: string[];
    exclude: string[];
    isEmpty: boolean;
};

const TOKEN_RE = /-?"[^"]*"|-?[^\s]+/g;

export function parseFilterQuery(raw: string): ParsedFilterQuery {
    const include: string[] = [];
    const phrases: string[] = [];
    const exclude: string[] = [];

    const tokens = raw.match(TOKEN_RE) ?? [];
    for (const rawToken of tokens) {
        let token = rawToken;
        let negated = false;
        if (token.length > 1 && token[0] === '-') {
            negated = true;
            token = token.slice(1);
        }
        const quoted = token.length >= 2 && token[0] === '"' && token[token.length - 1] === '"';
        if (quoted) token = token.slice(1, -1);
        token = token.toLowerCase().trim();
        if (!token) continue;

        if (negated) exclude.push(token);
        else if (quoted) phrases.push(token);
        else include.push(token);
    }

    return {
        include,
        phrases,
        exclude,
        isEmpty: !include.length && !phrases.length && !exclude.length,
    };
}

/** Tests an already-lowercased haystack against a parsed query. */
export function matchesFilterQuery(haystackLower: string, query: ParsedFilterQuery): boolean {
    for (const term of query.exclude) {
        if (haystackLower.includes(term)) return false;
    }
    for (const term of query.include) {
        if (!haystackLower.includes(term)) return false;
    }
    for (const term of query.phrases) {
        if (!haystackLower.includes(term)) return false;
    }
    return true;
}
