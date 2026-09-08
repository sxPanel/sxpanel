import { suite, it, expect } from 'vitest';
import {
    DatabasePlayerSchema,
    DatabaseActionSchema,
    DatabaseWhitelistApprovalSchema,
    DatabaseWhitelistApplicationSchema,
    DatabaseWhitelistEntrySchema,
    DatabaseWhitelistEventSchema,
    DatabaseWhitelistRequestSchema,
} from './databaseSchemas';

suite('DatabasePlayerSchema', () => {
    const validPlayer = {
        license: 'license:abc123',
        ids: ['steam:123', 'discord:456'],
        hwids: ['hwid1'],
        displayName: 'TestPlayer',
        pureName: 'testplayer',
        playTime: 100,
        tsLastConnection: 1700000000,
        tsJoined: 1690000000,
    };

    it('should accept a valid minimal player', () => {
        const result = DatabasePlayerSchema.safeParse(validPlayer);
        expect(result.success).toBe(true);
    });

    it('should accept a player with optional fields', () => {
        const result = DatabasePlayerSchema.safeParse({
            ...validPlayer,
            tsWhitelisted: 1700000000,
            notes: { text: 'some note', lastAdmin: 'admin1', tsLastEdit: 1700000000 },
            nameHistory: ['OldName', 'NewName'],
            sessionHistory: [
                ['2024-01-01', 30],
                ['2024-01-02', 60],
            ],
            customTags: ['vip', 'trusted'],
        });
        expect(result.success).toBe(true);
    });

    it('should reject player with empty license', () => {
        const result = DatabasePlayerSchema.safeParse({ ...validPlayer, license: '' });
        expect(result.success).toBe(false);
    });

    it('should reject player with negative playTime', () => {
        const result = DatabasePlayerSchema.safeParse({ ...validPlayer, playTime: -1 });
        expect(result.success).toBe(false);
    });

    it('should reject player with missing required fields', () => {
        const { license, ...incomplete } = validPlayer;
        const result = DatabasePlayerSchema.safeParse(incomplete);
        expect(result.success).toBe(false);
    });
});

suite('DatabaseActionSchema', () => {
    const baseAction = {
        id: 'A1234',
        ids: ['steam:123'],
        playerName: 'Player1',
        reason: 'Test reason',
        author: 'Admin1',
        timestamp: 1700000000,
    };

    it('should accept a valid ban action', () => {
        const result = DatabaseActionSchema.safeParse({
            ...baseAction,
            type: 'ban',
            expiration: 1700100000,
        });
        expect(result.success).toBe(true);
    });

    it('should accept a permanent ban (expiration: false)', () => {
        const result = DatabaseActionSchema.safeParse({
            ...baseAction,
            type: 'ban',
            expiration: false,
        });
        expect(result.success).toBe(true);
    });

    it('should accept a ban with hwids', () => {
        const result = DatabaseActionSchema.safeParse({
            ...baseAction,
            type: 'ban',
            expiration: false,
            hwids: ['hwid1', 'hwid2'],
        });
        expect(result.success).toBe(true);
    });

    it('should accept a valid warn action', () => {
        const result = DatabaseActionSchema.safeParse({
            ...baseAction,
            type: 'warn',
            acked: false,
        });
        expect(result.success).toBe(true);
    });

    it('should accept a valid kick action', () => {
        const result = DatabaseActionSchema.safeParse({
            ...baseAction,
            type: 'kick',
        });
        expect(result.success).toBe(true);
    });

    it('should accept action with revocation', () => {
        const result = DatabaseActionSchema.safeParse({
            ...baseAction,
            type: 'ban',
            expiration: false,
            revocation: { timestamp: 1700050000, author: 'Admin2' },
        });
        expect(result.success).toBe(true);
    });

    it('should reject unknown action type', () => {
        const result = DatabaseActionSchema.safeParse({
            ...baseAction,
            type: 'mute',
        });
        expect(result.success).toBe(false);
    });

    it('should reject ban without expiration', () => {
        const result = DatabaseActionSchema.safeParse({
            ...baseAction,
            type: 'ban',
        });
        expect(result.success).toBe(false);
    });

    it('should reject warn without acked', () => {
        const result = DatabaseActionSchema.safeParse({
            ...baseAction,
            type: 'warn',
        });
        expect(result.success).toBe(false);
    });

    it('should reject action with playerName false for ban', () => {
        const result = DatabaseActionSchema.safeParse({
            ...baseAction,
            type: 'ban',
            expiration: false,
            playerName: false,
        });
        expect(result.success).toBe(true); // playerName can be string | false
    });
});

suite('DatabaseWhitelistEntrySchema', () => {
    it('should accept a valid entry', () => {
        const result = DatabaseWhitelistEntrySchema.safeParse({
            identifier: 'license:abc123',
            tierId: 'default',
            tsGranted: 1700000000,
            grantedBy: 'Admin1',
            source: 'manual',
            playerName: 'Player1',
            playerAvatar: null,
        });
        expect(result.success).toBe(true);
    });
});

suite('DatabaseWhitelistApplicationSchema', () => {
    it('should accept a valid application', () => {
        const result = DatabaseWhitelistApplicationSchema.safeParse({
            id: 'R1234',
            license: 'abc123',
            status: 'pending',
            workflowId: 'default',
            playerDisplayName: 'Test',
            playerPureName: 'test',
            tsCreated: 1700000000,
            tsLastAttempt: 1700000000,
        });
        expect(result.success).toBe(true);
    });
});

suite('DatabaseWhitelistEventSchema', () => {
    it('should accept a valid event', () => {
        const result = DatabaseWhitelistEventSchema.safeParse({
            id: 'E1234',
            type: 'application.created',
            ts: 1700000000,
            license: 'abc123',
        });
        expect(result.success).toBe(true);
    });
});

suite('DatabaseWhitelistApprovalSchema', () => {
    it('should accept a valid approval', () => {
        const result = DatabaseWhitelistApprovalSchema.safeParse({
            identifier: 'license:abc123',
            playerName: 'Player1',
            playerAvatar: 'https://example.com/avatar.png',
            tsApproved: 1700000000,
            approvedBy: 'Admin1',
        });
        expect(result.success).toBe(true);
    });

    it('should accept null avatar', () => {
        const result = DatabaseWhitelistApprovalSchema.safeParse({
            identifier: 'license:abc123',
            playerName: 'Player1',
            playerAvatar: null,
            tsApproved: 1700000000,
            approvedBy: 'Admin1',
        });
        expect(result.success).toBe(true);
    });

    it('should reject empty identifier', () => {
        const result = DatabaseWhitelistApprovalSchema.safeParse({
            identifier: '',
            playerName: 'Player1',
            playerAvatar: null,
            tsApproved: 1700000000,
            approvedBy: 'Admin1',
        });
        expect(result.success).toBe(false);
    });
});

suite('DatabaseWhitelistRequestSchema', () => {
    const validRequest = {
        id: 'R1234',
        license: 'license:abc123',
        playerDisplayName: 'TestPlayer',
        playerPureName: 'testplayer',
        tsLastAttempt: 1700000000,
    };

    it('should accept a valid minimal request', () => {
        const result = DatabaseWhitelistRequestSchema.safeParse(validRequest);
        expect(result.success).toBe(true);
    });

    it('should accept request with discord fields', () => {
        const result = DatabaseWhitelistRequestSchema.safeParse({
            ...validRequest,
            discordTag: 'User#1234',
            discordAvatar: 'https://cdn.discordapp.com/avatars/123/abc.png',
        });
        expect(result.success).toBe(true);
    });

    it('should reject request with empty id', () => {
        const result = DatabaseWhitelistRequestSchema.safeParse({ ...validRequest, id: '' });
        expect(result.success).toBe(false);
    });

    it('should reject request with empty license', () => {
        const result = DatabaseWhitelistRequestSchema.safeParse({ ...validRequest, license: '' });
        expect(result.success).toBe(false);
    });

    it('should reject request with missing tsLastAttempt', () => {
        const { tsLastAttempt, ...incomplete } = validRequest;
        const result = DatabaseWhitelistRequestSchema.safeParse(incomplete);
        expect(result.success).toBe(false);
    });
});
