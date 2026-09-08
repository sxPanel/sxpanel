import { suite, it, expect } from 'vitest';
import { genActionID, genWhitelistRequestID, genReportID, DuplicateKeyError } from './dbUtils';

suite('dbUtils', () => {
    suite('genActionID', () => {
        it('should generate IDs with correct format for ban type', () => {
            const storage = new Set<string>();
            const id = genActionID(storage, 'ban');
            expect(id).toMatch(/^B[A-Z0-9]{3}-[A-Z0-9]{4}$/);
        });

        it('should generate IDs with correct format for warn type', () => {
            const storage = new Set<string>();
            const id = genActionID(storage, 'warn');
            expect(id).toMatch(/^W[A-Z0-9]{3}-[A-Z0-9]{4}$/);
        });

        it('should generate IDs with correct format for kick type', () => {
            const storage = new Set<string>();
            const id = genActionID(storage, 'kick');
            expect(id).toMatch(/^K[A-Z0-9]{3}-[A-Z0-9]{4}$/);
        });

        it('should generate unique IDs', () => {
            const storage = new Set<string>();
            const ids = new Set<string>();
            for (let i = 0; i < 50; i++) {
                const id = genActionID(storage, 'ban');
                ids.add(id);
                storage.add(id);
            }
            expect(ids.size).toBe(50);
        });

        it('should avoid collisions with existing IDs in storage', () => {
            const storage = new Set<string>();
            const id1 = genActionID(storage, 'ban');
            storage.add(id1);
            const id2 = genActionID(storage, 'ban');
            expect(id2).not.toBe(id1);
        });
    });

    suite('genWhitelistRequestID', () => {
        it('should generate IDs starting with R', () => {
            const storage = new Set<string>();
            const id = genWhitelistRequestID(storage);
            expect(id).toMatch(/^R[A-Z0-9]{4}$/);
        });

        it('should generate unique whitelist IDs', () => {
            const storage = new Set<string>();
            const ids = new Set<string>();
            for (let i = 0; i < 50; i++) {
                const id = genWhitelistRequestID(storage);
                ids.add(id);
                storage.add(id);
            }
            expect(ids.size).toBe(50);
        });
    });

    suite('genReportID', () => {
        it('should generate IDs with RPT- prefix', () => {
            const storage = new Set<string>();
            const id = genReportID(storage);
            expect(id).toMatch(/^RPT-[A-Z0-9]+$/);
        });
    });

    suite('DuplicateKeyError', () => {
        it('should be an instance of Error', () => {
            const err = new DuplicateKeyError('test');
            expect(err).toBeInstanceOf(Error);
            expect(err.message).toBe('test');
        });

        it('should have DUPLICATE_KEY code', () => {
            const err = new DuplicateKeyError('dup');
            expect(err.code).toBe('DUPLICATE_KEY');
        });
    });
});
