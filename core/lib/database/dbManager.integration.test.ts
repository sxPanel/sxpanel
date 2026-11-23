/**
 * Integration tests against a real MySQL/MariaDB server. Skipped unless SXP_DB_IT=1.
 * Expects a database `fivem` reachable as fivem / 'p@ss=word' on 127.0.0.1, with the
 * fixtures from the comment at the bottom of this file.
 */
import { suite, it, expect, vi, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const enabled = process.env.SXP_DB_IT === '1';

suite.skipIf(!enabled)('dbManager (integration)', async () => {
    let db: typeof import('./dbManager');

    beforeAll(async () => {
        const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'sxp-db-'));
        fs.writeFileSync(
            path.join(dataPath, 'server.cfg'),
            [
                'endpoint_add_tcp "0.0.0.0:30120"',
                'set mysql_connection_string "mysql://wrong:wrong@127.0.0.1/nope"',
                'exec db.cfg',
            ].join('\n'),
        );
        //last one wins, through exec, key/value format with a '=' inside the password
        fs.writeFileSync(
            path.join(dataPath, 'db.cfg'),
            'set mysql_connection_string "server=127.0.0.1;database=fivem;userid=fivem;password=p@ss=word"\n',
        );
        vi.stubGlobal('txConfig', { server: { dataPath, cfgPath: 'server.cfg', startupArgs: [] } });
        db = await import('./dbManager');
    });

    it('reads the connection from server.cfg', async () => {
        const info = await db.getConnectionInfo();
        expect(info).toMatchObject({ database: 'fivem', user: 'fivem', source: 'server.cfg' });
        expect(info.serverVersion).toMatch(/\d+\.\d+/);
    });

    it('lists tables and columns', async () => {
        const tables = await db.listTables();
        expect(tables.map((t) => t.name)).toEqual(expect.arrayContaining(['users', 'nopk']));
        const cols = await db.getTableColumns('users');
        expect(cols.find((c) => c.name === 'id')).toMatchObject({ isPrimaryKey: true, isAutoIncrement: true });
        await expect(db.getTableColumns('nope`; DROP TABLE users; --')).rejects.toThrow(/not found/);
    });

    it('pages, sorts, searches and serializes values', async () => {
        const res = await db.getTableRows({ table: 'users', page: 1, pageSize: 25, orderBy: 'id', orderDir: 'asc' });
        expect(res.total).toBeGreaterThanOrEqual(3);
        const idIdx = res.columns.findIndex((c) => c.name === 'identifier');
        const moneyIdx = res.columns.findIndex((c) => c.name === 'money');
        const skinIdx = res.columns.findIndex((c) => c.name === 'skin');
        const avatarIdx = res.columns.findIndex((c) => c.name === 'avatar');
        const first = res.rows[0];
        expect(first[idIdx]).toBe('license:aaa');
        expect(first[skinIdx]).toMatchObject({ $kind: 'truncated', length: 20000 });
        expect(first[avatarIdx]).toEqual({ $kind: 'binary', bytes: 4, hex: 'deadbeef' });
        expect(res.rows[1][moneyIdx]).toBe('9007199254740993'); //no precision loss

        //LIKE wildcards are escaped
        const search = await db.getTableRows({ table: 'users', page: 1, pageSize: 25, search: 'c%_c' });
        expect(search.total).toBe(1);
        //unescaped, 'license%bbb' would match 'license:bbb'
        const wildcard = await db.getTableRows({ table: 'users', page: 1, pageSize: 25, search: 'license%bbb' });
        expect(wildcard.total).toBe(0);

        await expect(
            db.getTableRows({ table: 'users', page: 1, pageSize: 25, orderBy: 'id; DROP TABLE users' }),
        ).rejects.toThrow(/Unknown column/);
    });

    it('blocks writes in read-only mode even if the guard is bypassed', async () => {
        await expect(db.runQuery("UPDATE users SET money = 0 WHERE identifier = 'license:aaa'", true)).rejects.toThrow(
            /READ ONLY|read only/i,
        );
        await expect(db.runQuery('WITH a AS (SELECT 1) DELETE FROM users', true)).rejects.toThrow();
        const rows = await db.runQuery("SELECT money FROM users WHERE identifier = 'license:aaa'", true);
        expect(rows.rows[0][0]).toBe('5000');
        //the read-only session is not reused for writes afterwards
        const write = await db.runQuery("UPDATE users SET money = money WHERE identifier = 'license:aaa'", false);
        expect(write.affectedRows).toBe(1);
    });

    it('inserts, updates and deletes by primary key', async () => {
        await db.insertRow('users', { identifier: 'license:it', money: '42' });
        const found = await db.runQuery("SELECT id, money FROM users WHERE identifier = 'license:it'", true);
        const id = found.rows[0][0] as number;
        expect(await db.updateRow('users', { id }, { money: '43', inventory: null })).toBe(1);
        const after = await db.runQuery(`SELECT money FROM users WHERE id = ${id}`, true);
        expect(after.rows[0][0]).toBe('43');
        await expect(db.updateRow('users', { id }, { avatar: 'x' })).rejects.toThrow(/Binary/);
        await expect(db.updateRow('users', { id }, { nope: 'x' })).rejects.toThrow(/Unknown column/);
        await expect(db.updateRow('nopk', { a: 1 }, { b: 'y' })).rejects.toThrow(/no primary key/);
        expect(await db.deleteRow('users', { id })).toBe(1);
    });

    it('reports SQL errors cleanly', async () => {
        await expect(db.runQuery('SELEC 1', false)).rejects.toThrow(/SQL syntax/);
    });
});

/*
CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY, identifier VARCHAR(64) NOT NULL, money BIGINT DEFAULT 0,
  inventory JSON NULL, skin LONGTEXT NULL, avatar BLOB NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
INSERT INTO users (identifier, money, inventory, skin, avatar) VALUES
  ('license:aaa', 5000, '{"bread":2}', REPEAT('x', 20000), UNHEX('DEADBEEF')),
  ('license:bbb', 9007199254740993, NULL, 'short', NULL), ('license:c%_c', 1, NULL, NULL, NULL);
CREATE TABLE nopk (a INT, b VARCHAR(10)); INSERT INTO nopk VALUES (1,'x');
*/
