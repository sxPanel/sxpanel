/**
 * Static checks for queries run by admins without the `database.edit` permission.
 * These are one layer only: read-only queries also run inside a READ ONLY transaction
 * on a session set to read-only, which is what actually blocks writes.
 */

const READ_ONLY_KEYWORDS = new Set(['select', 'show', 'describe', 'desc', 'explain', 'with']);

/**
 * Removes leading whitespace and comments (`-- x`, `# x`, `/* x *\/`).
 */
export const stripLeadingComments = (sql: string) => {
    let rest = sql;
    while (true) {
        const trimmed = rest.trimStart();
        if (trimmed.startsWith('--') || trimmed.startsWith('#')) {
            const nl = trimmed.indexOf('\n');
            rest = nl === -1 ? '' : trimmed.slice(nl + 1);
        } else if (trimmed.startsWith('/*')) {
            const end = trimmed.indexOf('*/', 2);
            rest = end === -1 ? '' : trimmed.slice(end + 2);
        } else {
            return trimmed;
        }
    }
};

export type ReadOnlyCheck = { ok: true } | { ok: false; reason: string };

/**
 * Checks that a query is a single read statement.
 */
export const checkReadOnlyQuery = (sql: string): ReadOnlyCheck => {
    // MySQL/MariaDB executable comments run their contents
    if (/\/\*\s*M?!/i.test(sql)) {
        return { ok: false, reason: 'Executable comments (/*! ... */) are not allowed in read-only mode.' };
    }
    if (/\binto\s+(outfile|dumpfile)\b/i.test(sql)) {
        return { ok: false, reason: 'INTO OUTFILE / DUMPFILE is not allowed in read-only mode.' };
    }
    const body = stripLeadingComments(sql);
    const keyword = body.match(/^[a-z]+/i)?.[0]?.toLowerCase();
    if (!keyword) {
        return { ok: false, reason: 'Empty query.' };
    }
    if (!READ_ONLY_KEYWORDS.has(keyword)) {
        return {
            ok: false,
            reason: `"${keyword.toUpperCase()}" statements need the "Edit Database" permission.`,
        };
    }
    return { ok: true };
};

/**
 * Whether a query is a plain read, used to decide if it should be written to the action log.
 */
export const isReadStatement = (sql: string) => {
    const keyword = stripLeadingComments(sql)
        .match(/^[a-z]+/i)?.[0]
        ?.toLowerCase();
    return keyword !== undefined && READ_ONLY_KEYWORDS.has(keyword) && keyword !== 'with';
};
