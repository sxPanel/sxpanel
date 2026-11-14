import { describe, expect, it } from 'vitest';
import {
    hashAdminPassword,
    isArgon2Hash,
    isLegacyBcryptHash,
    migrateLegacyPasswordHash,
    verifyAdminPassword,
} from './adminPassword';

//NOTE: this is a real bcrypt hash (not a native/mock) for the plaintext 'teste123'
const bcryptHash = '$2b$11$K3HwDzkoUfhU6.W.tScfhOLEtR5uNc9qpQ685emtERx3dZ7fmgXCy';

describe('adminPassword', () => {
    it('detects legacy bcrypt hashes', () => {
        expect(isLegacyBcryptHash('$2b$11$abcdefghijklmnopqrstuv')).toBe(true);
        expect(isArgon2Hash('$2b$11$abcdefghijklmnopqrstuv')).toBe(false);
    });

    it('verifies legacy bcrypt via bcryptjs', async () => {
        expect(await verifyAdminPassword('teste123', bcryptHash)).toBe(true);
        expect(await verifyAdminPassword('wrong', bcryptHash)).toBe(false);
    });

    it('hashes and verifies argon2 passwords', async () => {
        const hash = await hashAdminPassword('SecurePass1!');
        expect(isArgon2Hash(hash)).toBe(true);
        expect(await verifyAdminPassword('SecurePass1!', hash)).toBe(true);
        expect(await verifyAdminPassword('wrong', hash)).toBe(false);
    });

    it('migrates legacy bcrypt to argon2', async () => {
        const migrated = await migrateLegacyPasswordHash('teste123', bcryptHash);
        expect(migrated).toBeTruthy();
        expect(isArgon2Hash(migrated!)).toBe(true);
        expect(await verifyAdminPassword('teste123', migrated!)).toBe(true);
    });
});
