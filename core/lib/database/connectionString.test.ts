import { suite, it, expect } from 'vitest';
import { parseConnectionString } from './connectionString';

suite('parseConnectionString', () => {
    it('parses URIs', () => {
        expect(parseConnectionString('mysql://root:s3cr%40t@127.0.0.1:3307/es_extended?charset=utf8mb4')).toEqual({
            host: '127.0.0.1',
            port: 3307,
            user: 'root',
            password: 's3cr@t',
            database: 'es_extended',
        });
    });

    it('defaults the port and allows empty passwords', () => {
        expect(parseConnectionString('mysql://root@localhost/qbcore')).toMatchObject({
            port: 3306,
            password: '',
            database: 'qbcore',
        });
    });

    it('parses key/value strings with aliases', () => {
        expect(parseConnectionString('server=db.local;Port=3310;database=vrp;userid=fivem;password=a=b;')).toEqual({
            host: 'db.local',
            port: 3310,
            user: 'fivem',
            password: 'a=b',
            database: 'vrp',
        });
        expect(parseConnectionString('host=localhost;uid=root;pwd=x;db=test')).toMatchObject({
            user: 'root',
            password: 'x',
            database: 'test',
        });
    });

    it('rejects invalid input without leaking the password', () => {
        expect(() => parseConnectionString('')).toThrow('empty');
        expect(() => parseConnectionString('postgres://u:hunter2@h/db')).toThrow(/unsupported protocol/);
        expect(() => parseConnectionString('mysql://root:hunter2@localhost/')).toThrow(/no database/);
        expect(() => parseConnectionString('server=h;database=d;password=hunter2')).toThrow(/no user/);
        expect(() => parseConnectionString('mysql://u:p@h:99999/db')).toThrow(/port|URI/);
        expect(() => parseConnectionString('server=h;port=abc;database=d;user=u')).toThrow(/port/);
        try {
            parseConnectionString('mysql://root:hunter2@localhost/');
        } catch (error) {
            expect(String(error)).not.toContain('hunter2');
        }
    });
});
