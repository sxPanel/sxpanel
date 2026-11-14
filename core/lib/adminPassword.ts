import { randomBytes } from 'node:crypto';
import { argon2id, argon2Verify } from 'hash-wasm';
import bcrypt from 'bcryptjs';

const ARGON2_PARAMS = {
    parallelism: 1,
    iterations: 3,
    memorySize: 65536,
    hashLength: 32,
    outputType: 'encoded' as const,
};

export const isLegacyBcryptHash = (hash: string) => hash.startsWith('$2');
export const isArgon2Hash = (hash: string) => hash.startsWith('$argon2');

export const isValidAdminPasswordHash = (hash: string) => isLegacyBcryptHash(hash) || isArgon2Hash(hash);

/**
 * Hashes a plaintext admin password with Argon2id.
 */
export async function hashAdminPassword(password: string): Promise<string> {
    return argon2id({
        password,
        salt: randomBytes(16),
        ...ARGON2_PARAMS,
    });
}

/**
 * Verifies a plaintext password against a bcrypt (legacy) or Argon2 hash.
 * NOTE: legacy bcrypt verification is done via bcryptjs (pure JS) rather than the FXServer
 * VerifyPasswordHash native, since native availability isn't guaranteed across FXServer
 * generations (gen8 vs gen9/Enhanced).
 */
export async function verifyAdminPassword(password: string, hash: string): Promise<boolean> {
    if (!isValidAdminPasswordHash(hash)) return false;

    if (isLegacyBcryptHash(hash)) {
        return bcrypt.compare(password, hash);
    }

    try {
        return await argon2Verify({ password, hash });
    } catch {
        return false;
    }
}

/**
 * Re-hashes a legacy bcrypt password to Argon2id after a successful login verification.
 * Returns the new hash, or null if migration was not needed.
 */
export async function migrateLegacyPasswordHash(password: string, currentHash: string): Promise<string | null> {
    if (!isLegacyBcryptHash(currentHash)) return null;
    return hashAdminPassword(password);
}
