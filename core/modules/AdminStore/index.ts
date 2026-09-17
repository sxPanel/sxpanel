const modulename = 'AdminStore';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { nanoid, customAlphabet } from 'nanoid';
import { txHostConfig } from '@core/globalData';
import { createHash, timingSafeEqual } from 'node:crypto';
import { hashAdminPassword, isValidAdminPasswordHash } from '@lib/adminPassword';

// Digits only — 10^6 = 1,000,000 possibilities; CSPRNG-backed via nanoid.
const MASTER_PIN_ALPHABET = '0123456789';
const MASTER_PIN_LENGTH = 6;
const generateAddMasterPin = customAlphabet(MASTER_PIN_ALPHABET, MASTER_PIN_LENGTH);
import consoleFactory from '@lib/console';
import fatalError from '@lib/fatalError';
import { chalkInversePad } from '@lib/misc';
import { registeredPermissions as permDefs, permMigrationMap, type PermissionDefinition } from '@shared/permissions';
import {
    DISCORD_ROLE_SYNC_DATA_KEY,
    StoredAdmin,
    getAdminPasswordRevision,
    getDiscordRoleSyncData,
    type RawAdminType,
    type AdminProviders,
    type DiscordRoleSyncData,
} from './adminClasses';
const console = consoleFactory(modulename);

//NOTE: The way I'm doing versioning right now is horrible but for now it's the best I can do
//NOTE: I do not need to version every admin, just the file itself
const ADMIN_SCHEMA_VERSION = 1;

//Helpers
const migrateProviderIdentifiers = (providerName: string, providerData: any) => {
    if (providerName === 'citizenfx') {
        // data may be empty, or nameid may be invalid
        try {
            const res = /\/user\/(\d{1,8})/.exec(providerData.data.nameid);
            providerData.identifier = `fivem:${res![1]}`;
        } catch (error) {
            providerData.identifier = 'fivem:00000000';
        }
    } else if (providerName === 'discord') {
        providerData.identifier = `discord:${providerData.id}`;
    }
};

const sanitizeStringList = (value: unknown) => {
    if (!Array.isArray(value)) return [];

    return [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0))];
};

const mergeStringLists = (...lists: string[][]) => {
    const merged = new Set<string>();

    for (const list of lists) {
        for (const entry of list) {
            merged.add(entry);
        }
    }

    return [...merged];
};

const stripDiscordRoleSyncedPermissions = (permissions: string[], syncData: DiscordRoleSyncData | false) => {
    const normalizedPermissions = sanitizeStringList(permissions);
    if (!syncData) return normalizedPermissions;

    const syncedPermissions = new Set(syncData.permissions);
    return normalizedPermissions.filter((permission) => !syncedPermissions.has(permission));
};

const materializeDiscordRolePermissions = (
    permissions: string[],
    syncData: ReturnType<typeof normalizeDiscordRoleSyncData>,
) => {
    const basePermissions = sanitizeStringList(permissions);
    if (!syncData) return basePermissions;

    return mergeStringLists(basePermissions, syncData.permissions);
};

const normalizeDiscordRoleSyncData = (value: DiscordRoleSyncData | false | undefined) => {
    if (!value) return false;

    const permissions = sanitizeStringList(value.permissions);
    if (!permissions.length) {
        return false;
    }

    const presetIds = sanitizeStringList(value.presetIds);
    const roleIds = sanitizeStringList(value.roleIds);

    return {
        permissions,
        ...(presetIds.length ? { presetIds } : {}),
        ...(roleIds.length ? { roleIds } : {}),
        syncedAt: Date.now(),
    };
};

const haveSameStringSet = (left: string[], right: string[]) => {
    if (left.length !== right.length) return false;

    const rightSet = new Set(right);
    for (const entry of left) {
        if (!rightSet.has(entry)) return false;
    }

    return true;
};

const haveSameDiscordRoleSyncData = (
    left: DiscordRoleSyncData | false,
    right: ReturnType<typeof normalizeDiscordRoleSyncData>,
) => {
    if (!left && !right) return true;
    if (!left || !right) return false;

    return (
        haveSameStringSet(left.permissions, right.permissions) &&
        haveSameStringSet(left.presetIds ?? [], right.presetIds ?? []) &&
        haveSameStringSet(left.roleIds ?? [], right.roleIds ?? [])
    );
};

/**
 * Module responsible for storing, retrieving and validating admins data.
 */
export default class AdminStore {
    readonly adminsFile: string;
    adminsFileHash: string | null = null;
    admins: RawAdminType[] | false | null = null;
    refreshRoutine: NodeJS.Timeout | null = null;
    addMasterPin: string | undefined;
    public ready: Promise<void> = Promise.resolve();

    readonly registeredPermissions: Record<string, string>;
    readonly addonPermissions: PermissionDefinition[] = [];
    readonly permMigrationMap: typeof permMigrationMap;

    readonly hardConfigs = {
        refreshInterval: 15e3,
    };

    constructor() {
        this.adminsFile = txHostConfig.dataSubPath('admins.json');

        //Permissions now centralized in @shared/permissions.ts
        this.registeredPermissions = Object.fromEntries(permDefs.map((p) => [p.id, p.label]));
        this.permMigrationMap = permMigrationMap;

        //Check if admins file exists
        let adminFileExists: boolean;
        try {
            fs.statSync(this.adminsFile);
            adminFileExists = true;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                adminFileExists = false;
            } else {
                throw new Error(`Failed to check presence of admin file with error: ${emsg(error)}`);
            }
        }

        //Printing PIN or starting loop
        if (!adminFileExists) {
            if (!txHostConfig.defaults.account) {
                this.addMasterPin = generateAddMasterPin();
                this.admins = false;
            } else {
                const { username, fivemId, password } = txHostConfig.defaults.account as {
                    username: string;
                    fivemId?: string;
                    password?: string;
                };
                this.ready = (async () => {
                    await this.createAdminsFile(
                        username,
                        fivemId ? `fivem:${fivemId}` : undefined,
                        undefined,
                        password,
                        password ? false : undefined,
                    );
                    console.ok(
                        `Created master account ${chalkInversePad(username)} with credentials provided by ${txHostConfig.sourceName}.`,
                    );
                })();
            }
        } else {
            this.ready = this.loadAdminsFile().then(() => {});
            this.setupRefreshRoutine();
        }
    }

    /**
     * Timing-safe verification of the initial-setup master PIN.
     * Normalises user input to the PIN alphabet (uppercase, strip spaces/dashes)
     * before comparing with `crypto.timingSafeEqual`.
     */
    verifyMasterPin(input: string): boolean {
        if (typeof this.addMasterPin !== 'string' || !this.addMasterPin.length) return false;
        const normalised = (typeof input === 'string' ? input : '').toUpperCase().replace(/[\s-]/g, '');
        const expectedBuf = Buffer.from(this.addMasterPin);
        const inputBuf = Buffer.from(normalised);
        if (inputBuf.length !== expectedBuf.length) {
            // Dummy compare so the length-mismatch branch burns similar CPU
            timingSafeEqual(expectedBuf, expectedBuf);
            return false;
        }
        return timingSafeEqual(inputBuf, expectedBuf);
    }

    /**
     * sets the admins file refresh routine
     */
    setupRefreshRoutine() {
        this.refreshRoutine = setInterval(() => {
            this.checkAdminsFile();
        }, this.hardConfigs.refreshInterval);
    }

    /**
     * Creates a admins.json file based on the first account
     */
    async createAdminsFile(
        username: string,
        fivemId?: string,
        discordId?: string,
        password?: string,
        isPlainTextPassword?: boolean,
    ) {
        //Sanity check
        if (this.admins !== false && this.admins !== null) throw new Error('Admins file already exists.');
        if (typeof username !== 'string' || username.length < 3) throw new Error('Invalid username parameter.');

        //Handling password
        let password_hash: string;
        let password_temporary: boolean | undefined;
        if (password) {
            password_hash = isPlainTextPassword ? await hashAdminPassword(password) : password;
        } else {
            const veryRandomString = `${username}-password-not-meant-to-be-used-${nanoid()}`;
            password_hash = await hashAdminPassword(veryRandomString);
            password_temporary = true;
        }

        //Handling third party providers
        const providers: AdminProviders = {};
        if (fivemId) {
            providers.citizenfx = {
                id: username,
                identifier: fivemId,
                data: {},
            };
        }
        if (discordId) {
            providers.discord = {
                id: discordId,
                identifier: `discord:${discordId}`,
                data: {},
            };
        }

        //Creating new admin
        const newAdmin: RawAdminType = {
            $schema: ADMIN_SCHEMA_VERSION,
            name: username,
            master: true,
            password_hash,
            password_revision: 0,
            password_temporary,
            providers,
            permissions: [],
        };
        this.admins = [newAdmin];
        this.addMasterPin = undefined;

        //Saving admin file
        try {
            const jsonData = JSON.stringify(this.admins);
            this.adminsFileHash = createHash('sha1').update(jsonData).digest('hex');
            fs.writeFileSync(this.adminsFile, jsonData, { encoding: 'utf8', flag: 'wx' });
            this.setupRefreshRoutine();
            return new StoredAdmin(newAdmin);
        } catch (error) {
            const message = `Failed to create '${this.adminsFile}' with error: ${emsg(error)}`;
            console.verbose.error(message);
            throw new Error(message);
        }
    }

    /**
     * Returns the vault master account label from admins.json.
     */
    getVaultMasterName(): string | false {
        if (!this.admins?.length) return false;
        const master = this.admins.find((user) => user.master === true);
        return master?.name ?? false;
    }

    /**
     * Returns a list of admins and permissions
     */
    getAdminsList() {
        if (!this.admins) return [];
        return this.admins.map((user) => {
            return {
                name: user.name,
                master: user.master,
                providers: Object.keys(user.providers),
                permissions: user.permissions,
            };
        });
    }

    /**
     * Returns the raw array of admins, except for the hash
     */
    getRawAdminsList() {
        if (!this.admins) return [];
        return structuredClone(this.admins);
    }

    /**
     * Returns a StoredAdmin by provider user id (ex discord id), or false
     */
    getAdminByProviderUID(uid: string): StoredAdmin | false {
        if (!this.admins) return false;
        const id = uid.trim().toLowerCase();
        if (!id.length) return false;
        const admin = this.admins.find((user) => {
            return (Object.keys(user.providers) as Array<keyof AdminProviders>).find((provider) => {
                return id === user.providers[provider]!.id.toLowerCase();
            });
        });
        return admin ? new StoredAdmin(structuredClone(admin)) : false;
    }

    /**
     * Returns an array with all identifiers of the admins (fivem/discord)
     */
    getAdminsIdentifiers() {
        if (!this.admins) return [];
        const ids: string[] = [];
        for (const admin of this.admins) {
            if (admin.providers.citizenfx) ids.push(admin.providers.citizenfx.identifier.toLowerCase());
            if (admin.providers.discord) ids.push(admin.providers.discord.identifier.toLowerCase());
        }
        return ids;
    }

    /**
     * Returns a StoredAdmin by their name, or false
     */
    getAdminByName(uname: string): StoredAdmin | false {
        if (!this.admins) return false;
        const username = uname.trim().toLowerCase();
        if (!username.length) return false;
        const admin = this.admins.find((user) => {
            return username === user.name.toLowerCase();
        });
        return admin ? new StoredAdmin(structuredClone(admin)) : false;
    }

    /**
     * Returns a StoredAdmin by game identifier, or false
     */
    getAdminByIdentifiers(identifiers: string[]): StoredAdmin | false {
        if (!this.admins) return false;
        const normalized = identifiers.map((i) => i.trim().toLowerCase()).filter((i) => i.length);
        if (!normalized.length) return false;
        const admin = this.admins.find((user) =>
            normalized.find((identifier) =>
                (Object.keys(user.providers) as Array<keyof AdminProviders>).find(
                    (provider) => identifier === user.providers[provider]!.identifier.toLowerCase(),
                ),
            ),
        );
        return admin ? new StoredAdmin(structuredClone(admin)) : false;
    }

    /**
     * Returns a list with all registered permissions (including addon permissions)
     */
    getPermissionsList() {
        const merged = { ...this.registeredPermissions };
        for (const perm of this.addonPermissions) {
            merged[perm.id] = perm.label;
        }
        return structuredClone(merged);
    }

    /**
     * Register custom admin permissions declared by an addon.
     * Permission IDs are namespaced as `addon.<addonId>.<permId>`.
     */
    registerAddonPermissions(addonId: string, perms: { id: string; label: string; description: string }[]): void {
        // Remove any existing registrations for this addon first
        this.unregisterAddonPermissions(addonId);

        for (const perm of perms) {
            const fullId = `addon.${addonId}.${perm.id}`;
            (this.addonPermissions as PermissionDefinition[]).push({
                id: fullId,
                label: perm.label,
                description: perm.description,
                category: 'addons',
                addonId,
            });
        }
    }

    /**
     * Unregister all custom admin permissions for an addon.
     */
    unregisterAddonPermissions(addonId: string): void {
        const arr = this.addonPermissions as PermissionDefinition[];
        for (let i = arr.length - 1; i >= 0; i--) {
            if (arr[i].addonId === addonId) {
                arr.splice(i, 1);
            }
        }
    }

    /**
     * Get all addon-registered permissions as PermissionDefinitions.
     */
    getAddonPermissions(): PermissionDefinition[] {
        return structuredClone(this.addonPermissions);
    }

    /**
     * Writes to storage the admins file
     */
    async writeAdminsFile() {
        const jsonData = JSON.stringify(this.admins, null, 2);
        this.adminsFileHash = createHash('sha1').update(jsonData).digest('hex');
        await fsp.writeFile(this.adminsFile, jsonData, 'utf8');
        return true;
    }

    /**
     * Checks the admins file for external modifications
     */
    async checkAdminsFile() {
        const restore = async () => {
            try {
                await this.writeAdminsFile();
                console.ok('Restored admins.json file.');
            } catch (error) {
                console.error(`Failed to restore admins.json file: ${emsg(error)}`);
                console.verbose.dir(error);
            }
        };
        try {
            const jsonData = await fsp.readFile(this.adminsFile, 'utf8');
            const inboundHash = createHash('sha1').update(jsonData).digest('hex');
            if (this.adminsFileHash !== inboundHash) {
                console.warn(
                    'The admins.json file was modified or deleted by an external source, txAdmin will try to restore it.',
                );
                restore();
            }
        } catch (error) {
            console.error(`Cannot check admins file integrity: ${emsg(error)}`);
        }
    }

    /**
     * Add a new admin to the admins file
     */
    async addAdmin(
        name: string,
        citizenfxData: { id: string; identifier: string } | undefined,
        discordData: { id: string; identifier: string } | undefined,
        password: string,
        permissions: string[],
    ) {
        if (!this.admins) throw new Error('Admins not set');

        //Check if username is already taken
        if (this.getAdminByName(name)) throw new Error('Username already taken');

        //Preparing admin
        const admin: RawAdminType = {
            $schema: ADMIN_SCHEMA_VERSION,
            name,
            master: false,
            password_hash: await hashAdminPassword(password),
            password_revision: 0,
            password_temporary: true,
            providers: {},
            permissions,
        };

        //Check if provider uid already taken and inserting into admin object
        if (citizenfxData) {
            const existingCitizenFX = this.getAdminByProviderUID(citizenfxData.id);
            if (existingCitizenFX) throw new Error('CitizenFX ID already taken');
            admin.providers.citizenfx = {
                id: citizenfxData.id,
                identifier: citizenfxData.identifier,
                data: {},
            };
        }
        if (discordData) {
            const existingDiscord = this.getAdminByProviderUID(discordData.id);
            if (existingDiscord) throw new Error('Discord ID already taken');
            admin.providers.discord = {
                id: discordData.id,
                identifier: discordData.identifier,
                data: {},
            };
        }

        //Saving admin file
        this.admins.push(admin);
        this.refreshOnlineAdmins().catch(() => {});
        try {
            return await this.writeAdminsFile();
        } catch (error) {
            throw new Error(`Failed to save admins.json with error: ${emsg(error)}`);
        }
    }

    /**
     * Edit admin and save to the admins file
     */
    async editAdmin(
        name: string,
        password: string | null,
        citizenfxData?: { id: string; identifier: string } | false,
        discordData?: { id: string; identifier: string } | false,
        permissions?: string[],
    ) {
        if (!this.admins) throw new Error('Admins not set');

        //Find admin index
        const username = name.toLowerCase();
        const adminIndex = this.admins.findIndex((user) => {
            return username === user.name.toLowerCase();
        });
        if (adminIndex === -1) throw new Error('Admin not found');

        const currentDiscordProvider = this.admins[adminIndex].providers.discord;
        const currentRoleSyncData = getDiscordRoleSyncData(this.admins[adminIndex].providers);
        let nextRoleSyncData = currentRoleSyncData;

        //Editing admin
        if (password !== null) {
            this.admins[adminIndex].password_hash = await hashAdminPassword(password);
            delete this.admins[adminIndex].password_temporary;
            this.bumpPasswordRevision(adminIndex);
        }
        if (typeof citizenfxData !== 'undefined') {
            if (!citizenfxData) {
                delete this.admins[adminIndex].providers.citizenfx;
            } else {
                this.admins[adminIndex].providers.citizenfx = {
                    id: citizenfxData.id,
                    identifier: citizenfxData.identifier,
                    data: {},
                };
            }
        }
        if (typeof discordData !== 'undefined') {
            if (!discordData) {
                delete this.admins[adminIndex].providers.discord;
                nextRoleSyncData = false;
            } else {
                const isSameDiscordProvider = currentDiscordProvider?.id.toLowerCase() === discordData.id.toLowerCase();
                this.admins[adminIndex].providers.discord = {
                    id: discordData.id,
                    identifier: discordData.identifier,
                    data:
                        isSameDiscordProvider &&
                        currentDiscordProvider?.data &&
                        typeof currentDiscordProvider.data === 'object'
                            ? structuredClone(currentDiscordProvider.data)
                            : {},
                };
                nextRoleSyncData = isSameDiscordProvider ? currentRoleSyncData : false;
            }
        }

        if (typeof permissions !== 'undefined' || currentRoleSyncData !== nextRoleSyncData) {
            const nextBasePermissions = stripDiscordRoleSyncedPermissions(
                typeof permissions !== 'undefined' ? permissions : this.admins[adminIndex].permissions,
                currentRoleSyncData,
            );
            this.admins[adminIndex].permissions = materializeDiscordRolePermissions(
                nextBasePermissions,
                nextRoleSyncData,
            );
        }

        //Prevent race condition, will allow the session to be updated before refreshing socket.io
        //sessions which will cause reauth and closing of the temp password modal on first access
        setTimeout(() => {
            this.refreshOnlineAdmins().catch(() => {});
        }, 250);

        //Saving admin file
        try {
            await this.writeAdminsFile();
            return password !== null ? this.admins[adminIndex].password_hash : true;
        } catch (error) {
            throw new Error(`Failed to save admins.json with error: ${emsg(error)}`);
        }
    }

    /**
     * Rename an admin
     */
    async renameAdmin(oldName: string, newName: string): Promise<void> {
        if (!this.admins) throw new Error('Admins not set');
        const oldLower = oldName.toLowerCase();
        const adminIndex = this.admins.findIndex((user) => oldLower === user.name.toLowerCase());
        if (adminIndex === -1) throw new Error('Admin not found');
        //Check for name collision
        const newLower = newName.toLowerCase();
        const collision = this.admins.findIndex((user) => newLower === user.name.toLowerCase());
        if (collision !== -1 && collision !== adminIndex) throw new Error('An admin with that name already exists');
        this.admins[adminIndex].name = newName;
        try {
            await this.writeAdminsFile();
        } catch (error) {
            throw new Error(`Failed to save admins.json with error: ${emsg(error)}`);
        }
    }

    /**
     * Bumps the password revision used to invalidate password-authenticated sessions.
     */
    private bumpPasswordRevision(adminIndex: number) {
        const nextRevision = getAdminPasswordRevision(this.admins[adminIndex]) + 1;
        this.admins[adminIndex].password_revision = nextRevision;
        return nextRevision;
    }

    /**
     * Updates only the password hash (used for bcrypt → Argon2 migration on login).
     */
    async updatePasswordHash(name: string, passwordHash: string) {
        if (!this.admins) throw new Error('Admins not set');
        const username = name.toLowerCase();
        const adminIndex = this.admins.findIndex((user) => username === user.name.toLowerCase());
        if (adminIndex === -1) throw new Error('Admin not found');
        this.admins[adminIndex].password_hash = passwordHash;
        // Bcrypt→Argon2 migration only: initialize revision without incrementing an existing counter.
        const passwordRevision =
            getAdminPasswordRevision(this.admins[adminIndex]) === 0
                ? (this.admins[adminIndex].password_revision = 1)
                : getAdminPasswordRevision(this.admins[adminIndex]);
        try {
            await this.writeAdminsFile();
            return { passwordHash, passwordRevision };
        } catch (error) {
            throw new Error(`Failed to save admins.json with error: ${emsg(error)}`);
        }
    }

    /**
     * Reset an admin's password to a temporary one
     */
    async resetAdminPassword(name: string, newPassword: string) {
        if (!this.admins) throw new Error('Admins not set');
        const username = name.toLowerCase();
        const adminIndex = this.admins.findIndex((user) => username === user.name.toLowerCase());
        if (adminIndex === -1) throw new Error('Admin not found');
        this.admins[adminIndex].password_hash = await hashAdminPassword(newPassword);
        this.admins[adminIndex].password_temporary = true;
        this.bumpPasswordRevision(adminIndex);
        setTimeout(() => {
            this.refreshOnlineAdmins().catch(() => {});
        }, 250);
        try {
            await this.writeAdminsFile();
        } catch (error) {
            throw new Error(`Failed to save admins.json with error: ${emsg(error)}`);
        }
    }

    async syncAdminDiscordRolePermissions(discordId: string, syncData: DiscordRoleSyncData | false) {
        if (!this.admins) throw new Error('Admins not set');

        const normalizedDiscordId = discordId.trim().toLowerCase();
        if (!normalizedDiscordId.length) return false;

        const adminIndex = this.admins.findIndex((user) => {
            return user.providers.discord?.id.toLowerCase() === normalizedDiscordId;
        });
        if (adminIndex === -1) return false;

        const providerData = this.admins[adminIndex].providers.discord?.data;
        if (!providerData || typeof providerData !== 'object') return false;

        const nextSyncData = normalizeDiscordRoleSyncData(syncData);
        const currentSyncData = getDiscordRoleSyncData(this.admins[adminIndex].providers);
        const basePermissions = stripDiscordRoleSyncedPermissions(this.admins[adminIndex].permissions, currentSyncData);
        const nextPermissions = materializeDiscordRolePermissions(basePermissions, nextSyncData);
        const permissionsChanged = !haveSameStringSet(this.admins[adminIndex].permissions, nextPermissions);

        if (haveSameDiscordRoleSyncData(currentSyncData, nextSyncData) && !permissionsChanged) {
            return false;
        }

        this.admins[adminIndex].permissions = nextPermissions;

        if (!nextSyncData) {
            delete providerData[DISCORD_ROLE_SYNC_DATA_KEY];
        } else {
            providerData[DISCORD_ROLE_SYNC_DATA_KEY] = nextSyncData;
        }

        try {
            await this.writeAdminsFile();
            this.refreshOnlineAdmins().catch(() => {});
            return true;
        } catch (error) {
            throw new Error(`Failed to save admins.json with error: ${emsg(error)}`);
        }
    }

    // ── TOTP 2FA methods (self-contained, safe to remove) ──

    /**
     * Get the raw admin record by name (for TOTP secret access)
     */
    getRawAdminByName(name: string): RawAdminType | null {
        if (!this.admins) return null;
        const username = name.toLowerCase();
        return this.admins.find((user) => username === user.name.toLowerCase()) ?? null;
    }

    /**
     * Set TOTP secret and backup codes for an admin
     */
    async setAdminTotp(name: string, secret: string, backupCodes: string[]) {
        if (!this.admins) throw new Error('Admins not set');
        const username = name.toLowerCase();
        const adminIndex = this.admins.findIndex((user) => username === user.name.toLowerCase());
        if (adminIndex === -1) throw new Error('Admin not found');
        this.admins[adminIndex].totp_secret = secret;
        this.admins[adminIndex].totp_backup_codes = backupCodes;
        try {
            await this.writeAdminsFile();
        } catch (error) {
            throw new Error(`Failed to save admins.json with error: ${emsg(error)}`);
        }
    }

    /**
     * Remove TOTP secret and backup codes from an admin
     */
    async clearAdminTotp(name: string) {
        if (!this.admins) throw new Error('Admins not set');
        const username = name.toLowerCase();
        const adminIndex = this.admins.findIndex((user) => username === user.name.toLowerCase());
        if (adminIndex === -1) throw new Error('Admin not found');
        delete this.admins[adminIndex].totp_secret;
        delete this.admins[adminIndex].totp_backup_codes;
        try {
            await this.writeAdminsFile();
        } catch (error) {
            throw new Error(`Failed to save admins.json with error: ${emsg(error)}`);
        }
    }

    /**
     * Consume a backup code (remove it after use)
     */
    async consumeBackupCode(name: string, codeIndex: number) {
        if (!this.admins) throw new Error('Admins not set');
        const username = name.toLowerCase();
        const adminIndex = this.admins.findIndex((user) => username === user.name.toLowerCase());
        if (adminIndex === -1) throw new Error('Admin not found');
        const codes = this.admins[adminIndex].totp_backup_codes;
        if (!codes || codeIndex < 0 || codeIndex >= codes.length) {
            console.warn(
                `consumeBackupCode: invalid state for admin "${username}" — codeIndex=${codeIndex}, codes.length=${codes?.length ?? 'N/A (no codes array)'}`,
            );
            return;
        }
        codes.splice(codeIndex, 1);
        try {
            await this.writeAdminsFile();
        } catch (error) {
            throw new Error(`Failed to save admins.json with error: ${emsg(error)}`);
        }
    }

    /**
     * Delete admin and save to the admins file
     */
    async deleteAdmin(name: string) {
        if (!this.admins) throw new Error('Admins not set');

        //Delete admin
        const username = name.toLowerCase();
        let found = false;
        this.admins = this.admins.filter((user) => {
            if (username !== user.name.toLowerCase()) {
                return true;
            } else {
                found = true;
                return false;
            }
        });
        if (!found) throw new Error('Admin not found');

        //Saving admin file
        this.refreshOnlineAdmins().catch(() => {});
        try {
            return await this.writeAdminsFile();
        } catch (error) {
            throw new Error(`Failed to save admins.json with error: ${emsg(error)}`);
        }
    }

    /**
     * Loads the admins.json file into the admins list
     * NOTE: The verbosity here is driving me insane.
     *       But still seems not to be enough for people that don't read the README.
     */
    async loadAdminsFile() {
        let raw: string | null = null;
        let jsonData: any[] | null = null;
        let hasMigration = false;

        const callError = (reason: string) => {
            let details: string[];
            if (reason === 'cannot read file') {
                details = ["This means the file  doesn't exist or txAdmin doesn't have permission to read it."];
            } else {
                details = [
                    'This likely means the file got somehow corrupted.',
                    'You can try restoring it or you can delete it and let txAdmin create a new one.',
                ];
            }
            fatalError.AdminStore(0, [
                ['Unable to load admins.json', reason],
                ...details,
                ['Admin File Path', this.adminsFile],
            ]);
        };

        try {
            raw = await fsp.readFile(this.adminsFile, 'utf8');
            this.adminsFileHash = createHash('sha1').update(raw).digest('hex');
        } catch (error) {
            return callError('cannot read file');
        }

        if (!raw.length) {
            return callError('empty file');
        }

        try {
            jsonData = JSON.parse(raw);
        } catch (error) {
            return callError('json parse error');
        }

        if (!Array.isArray(jsonData)) {
            return callError('not an array');
        }

        if (!jsonData.length) {
            return callError('no admins');
        }

        const structureIntegrityTest = jsonData.some((x: any) => {
            if (typeof x.name !== 'string' || x.name.length < 3) return true;
            if (typeof x.master !== 'boolean') return true;
            if (typeof x.password_hash !== 'string' || !isValidAdminPasswordHash(x.password_hash)) return true;
            if (typeof x.providers !== 'object') return true;
            const validProviderNames = ['citizenfx', 'discord'];
            const providersTest = Object.keys(x.providers).some((y) => {
                if (!validProviderNames.includes(y)) return true;
                if (typeof x.providers[y].id !== 'string' || x.providers[y].id.length < 3) return true;
                if (typeof x.providers[y].data !== 'object') return true;
                if (typeof x.providers[y].identifier === 'string') {
                    if (x.providers[y].identifier.length < 3) return true;
                } else {
                    migrateProviderIdentifiers(y, x.providers[y]);
                    hasMigration = true;
                }
            });
            if (providersTest) return true;
            if (!Array.isArray(x.permissions)) return true;
            return false;
        });
        if (structureIntegrityTest) {
            return callError('invalid data in the admins file');
        }

        const masters = jsonData.filter((x: any) => x.master);
        if (masters.length !== 1) {
            return callError('must have exactly 1 master account');
        }

        //Migrate admin stuff
        for (const admin of jsonData) {
            //Migration (tx v7.3.0)
            if (admin.$schema === undefined) {
                //adding schema version
                admin.$schema = ADMIN_SCHEMA_VERSION;
                hasMigration = true;

                //separate DM and Announcement permissions
                if (admin.permissions.includes('players.message')) {
                    hasMigration = true;
                    admin.permissions = admin.permissions.filter((perm: string) => perm !== 'players.message');
                    admin.permissions.push('players.direct_message');
                    admin.permissions.push('announcement');
                }

                //Adding the new permission, except if they have no permissions or all of them
                if (admin.permissions.length && !admin.permissions.includes('all_permissions')) {
                    admin.permissions.push('server.log.view');
                }
            }

            //Migration (tx v8.x) – split combined permissions into granular ones
            if (this.permMigrationMap) {
                for (const [oldPerm, newPerms] of Object.entries(this.permMigrationMap)) {
                    if (admin.permissions.includes(oldPerm)) {
                        admin.permissions = admin.permissions.filter((p: string) => p !== oldPerm);
                        for (const np of newPerms) {
                            if (!admin.permissions.includes(np)) {
                                admin.permissions.push(np);
                            }
                        }
                        hasMigration = true;
                    }
                }
                //players.ban used to include unban – grant players.unban to existing admins
                if (admin.permissions.includes('players.ban') && !admin.permissions.includes('players.unban')) {
                    admin.permissions.push('players.unban');
                    hasMigration = true;
                }
                //players.ban used to allow permanent bans – grant players.ban.permanent to existing admins
                //so this new restriction doesn't silently take away capability they already had
                if (admin.permissions.includes('players.ban') && !admin.permissions.includes('players.ban.permanent')) {
                    admin.permissions.push('players.ban.permanent');
                    hasMigration = true;
                }
            }
        }

        this.admins = jsonData as RawAdminType[];
        if (hasMigration) {
            try {
                await this.writeAdminsFile();
                console.ok('The admins.json file was migrated to a new version.');
            } catch (error) {
                console.error(`Failed to migrate admins.json with error: ${emsg(error)}`);
            }
        }

        return true;
    }

    /**
     * Notify game server about admin changes
     */
    async refreshOnlineAdmins() {
        //Refresh auth of all admins connected to socket.io
        txCore.webServer.webSocket.reCheckAdminAuths().catch(() => {});

        try {
            if (!Array.isArray(this.admins)) return;

            const adminIdSet = new Set(
                this.admins.reduce<string[]>((ids, adm) => {
                    const providerIds = (Object.keys(adm.providers) as Array<keyof AdminProviders>).map(
                        (pName) => adm.providers[pName]!.identifier,
                    );
                    return ids.concat(providerIds);
                }, []),
            );

            //Finding online admins
            const playerList = txCore.fxPlayerlist.getPlayerList();
            const onlineIDs = playerList
                .filter((p) => p.ids.some((i: string) => adminIdSet.has(i)))
                .map((p) => p.netid);

            txCore.fxRunner.sendEvent('adminsUpdated', onlineIDs);
        } catch (error) {
            console.verbose.error('Failed to refreshOnlineAdmins() with error:');
            console.verbose.dir(error);
        }
    }

    /**
     * Returns a random token to be used as CSRF Token.
     */
    genCsrfToken() {
        return nanoid();
    }

    /**
     * Checks if there are admins configured or not.
     * Optionally, prints the master PIN on the console.
     */
    hasAdmins(printPin = false) {
        if (Array.isArray(this.admins) && this.admins.length) {
            return true;
        } else {
            if (printPin) {
                console.warn('Use this PIN to add a new master account: ' + chalkInversePad(this.addMasterPin!));
            }
            return false;
        }
    }

    /**
     * Returns the public name to display for that particular purpose
     */
    getAdminPublicName(name: string, purpose: 'punishment' | 'message') {
        if (!name || !purpose) throw new Error('Invalid parameters');

        const replacer = txConfig.general.serverName ?? 'sxPanel';

        if (purpose === 'punishment') {
            return txConfig.gameFeatures.hideAdminInPunishments ? replacer : name;
        } else if (purpose === 'message') {
            return txConfig.gameFeatures.hideAdminInMessages ? replacer : name;
        } else {
            throw new Error(`Invalid purpose: ${purpose}`);
        }
    }
}
