import { suite, it, expect } from 'vitest';
import { checkReadOnlyQuery, isReadStatement, stripLeadingComments } from './sqlGuards';

suite('stripLeadingComments', () => {
    it('removes leading comments of every style', () => {
        expect(stripLeadingComments('  -- hi\n# yo\n/* block */ SELECT 1')).toBe('SELECT 1');
        expect(stripLeadingComments('/* unterminated')).toBe('');
    });
});

suite('checkReadOnlyQuery', () => {
    it('allows reads', () => {
        for (const sql of [
            'SELECT * FROM users',
            ' select 1',
            'SHOW TABLES',
            'DESCRIBE users',
            'desc users',
            'EXPLAIN SELECT 1',
            'WITH a AS (SELECT 1) SELECT * FROM a',
            '-- note\nSELECT 1',
        ]) {
            expect(checkReadOnlyQuery(sql)).toEqual({ ok: true });
        }
    });

    it('blocks writes and DDL', () => {
        for (const sql of [
            'UPDATE users SET money = 1',
            'DELETE FROM users',
            'DROP TABLE users',
            'INSERT INTO a VALUES (1)',
            'TRUNCATE users',
            '/* SELECT */ DROP TABLE x',
            'CALL proc()',
            'SET GLOBAL x = 1',
            '',
        ]) {
            expect(checkReadOnlyQuery(sql).ok).toBe(false);
        }
    });

    it('blocks executable comments and file writes', () => {
        expect(checkReadOnlyQuery('/*!50000 DROP TABLE x */ SELECT 1').ok).toBe(false);
        expect(checkReadOnlyQuery('SELECT 1 /*M! , 2 */').ok).toBe(false);
        expect(checkReadOnlyQuery("SELECT * FROM users INTO OUTFILE '/tmp/x'").ok).toBe(false);
        expect(checkReadOnlyQuery("SELECT 1 INTO  DUMPFILE '/tmp/x'").ok).toBe(false);
    });
});

suite('isReadStatement', () => {
    it('classifies statements for audit logging', () => {
        expect(isReadStatement('SELECT 1')).toBe(true);
        expect(isReadStatement('UPDATE x SET y = 1')).toBe(false);
        expect(isReadStatement('WITH a AS (SELECT 1) DELETE FROM b')).toBe(false);
    });
});
