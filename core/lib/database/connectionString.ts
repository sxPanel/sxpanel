/**
 * Parsing of the `mysql_connection_string` convar, in the two formats oxmysql / mysql-async accept:
 *   - URI:        mysql://user:password@host:3306/database?charset=utf8mb4
 *   - Key/value:  server=127.0.0.1;port=3306;database=es_extended;userid=root;password=secret
 */

export type ParsedConnectionString = {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    socketPath?: string;
};

const DEFAULT_PORT = 3306;

const KV_ALIASES: Record<string, keyof ParsedConnectionString> = {
    server: 'host',
    host: 'host',
    hostname: 'host',
    'data source': 'host',
    datasource: 'host',
    port: 'port',
    database: 'database',
    db: 'database',
    'initial catalog': 'database',
    userid: 'user',
    'user id': 'user',
    uid: 'user',
    user: 'user',
    username: 'user',
    password: 'password',
    pwd: 'password',
    pass: 'password',
    socketpath: 'socketPath',
    socket: 'socketPath',
};

const parsePort = (raw: string | undefined) => {
    if (!raw) return DEFAULT_PORT;
    const port = parseInt(raw, 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`invalid port "${raw}"`);
    }
    return port;
};

const parseUri = (input: string): ParsedConnectionString => {
    let url: URL;
    try {
        url = new URL(input);
    } catch {
        throw new Error('invalid connection URI');
    }
    if (url.protocol !== 'mysql:' && url.protocol !== 'mariadb:') {
        throw new Error(`unsupported protocol "${url.protocol}"`);
    }
    const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
    const socketPath = url.searchParams.get('socketPath') ?? undefined;
    return {
        host: decodeURIComponent(url.hostname) || 'localhost',
        port: parsePort(url.port),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database,
        ...(socketPath ? { socketPath } : {}),
    };
};

const parseKeyValue = (input: string): ParsedConnectionString => {
    const result: Partial<Record<keyof ParsedConnectionString, string>> = {};
    for (const pair of input.split(';')) {
        const eqIdx = pair.indexOf('=');
        if (eqIdx === -1) continue;
        const key = pair.slice(0, eqIdx).trim().toLowerCase();
        const value = pair.slice(eqIdx + 1).trim();
        const mapped = KV_ALIASES[key];
        if (mapped) result[mapped] = value;
    }
    if (!result.host && !result.socketPath) throw new Error('missing server/host');
    return {
        host: result.host || 'localhost',
        port: parsePort(result.port),
        user: result.user ?? '',
        password: result.password ?? '',
        database: result.database ?? '',
        ...(result.socketPath ? { socketPath: result.socketPath } : {}),
    };
};

/**
 * Parses a mysql connection string. Throws with a message safe to show (never includes the password).
 */
export const parseConnectionString = (input: string): ParsedConnectionString => {
    const trimmed = input.trim();
    if (!trimmed.length) throw new Error('empty connection string');
    const parsed = /^[a-z]+:\/\//i.test(trimmed) ? parseUri(trimmed) : parseKeyValue(trimmed);
    if (!parsed.database) throw new Error('connection string has no database name');
    if (!parsed.user) throw new Error('connection string has no user');
    return parsed;
};
