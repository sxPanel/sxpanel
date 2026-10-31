import { beforeEach, suite, it, expect, vi } from 'vitest';
import SaveSettingsConfigs from './saveConfigs';
import { createMockCtx } from '../../testing/routeTestUtils';

vi.mock('@core/globalData', () => ({
    txEnv: {
        isWindows: true,
    },
    txHostConfig: {
        netInterface: undefined,
    },
}));

suite('settings/saveConfigs', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        vi.stubGlobal('txConfig', {
            gameFeatures: {
                combatLogEnabled: false,
                combatLogDamageSummaries: true,
                combatLogEngagementWindow: 10,
            },
            discordBot: {
                enabled: true,
                token: 'discord-bot-token',
                guild: '123456789012345678',
                warningsChannel: null,
                logGuildOverride: null,
                embedJson: '{"embeds":[]}',
                embedConfigJson: '{}',
                playerListEmbedJson: '{"embeds":[]}',
                playerListEmbedConfigJson: '{}',
            },
        });

        vi.stubGlobal('txCore', {
            configStore: {
                saveConfigs: vi.fn(() => ({
                    hasMatch: vi.fn(() => false),
                })),
                getStoredConfig: vi.fn(() => ({})),
                getChangelog: vi.fn(() => []),
            },
            discordBot: {
                attemptBotReset: vi.fn(async () => 'Discord bot restarted.'),
            },
            webServer: {
                webSocket: {
                    pushRefresh: vi.fn(),
                },
            },
        });
    });

    it('should preserve the current bot state when saving discord log routes', async () => {
        const warningsChannel = '987654321098765432';
        const { ctx, sentData } = createMockCtx({
            permissions: ['settings.write'],
            params: { card: 'discord-bot' },
            body: {
                resetKeys: [],
                changes: {
                    discordBot: {
                        logRoutes: [
                            {
                                key: 'system.action',
                                enabled: true,
                                channelId: '999999999999999999',
                                useEntryFilter: false,
                                entryFilter: [],
                            },
                        ],
                        warningsChannel,
                        logGuildOverride: null,
                    },
                },
            },
        });

        await SaveSettingsConfigs(ctx);

        expect((globalThis as any).txCore.discordBot.attemptBotReset).toHaveBeenCalledWith({
            enabled: true,
            token: 'discord-bot-token',
            guild: '123456789012345678',
            warningsChannel,
        });
        expect((globalThis as any).txCore.configStore.saveConfigs).toHaveBeenCalledWith(
            {
                discordBot: {
                    logRoutes: [
                        {
                            key: 'system.action',
                            enabled: true,
                            channelId: '999999999999999999',
                            useEntryFilter: false,
                            entryFilter: [],
                        },
                    ],
                    warningsChannel,
                    logGuildOverride: null,
                },
            },
            'testadmin',
        );
        expect(sentData[0]).toMatchObject({
            type: 'success',
            title: 'FXServer Settings Saved!',
        });
    });

    it('should reject combat log changes from non-master admins on any card', async () => {
        for (const card of ['game', 'general']) {
            const { ctx, sentData } = createMockCtx({
                permissions: ['settings.write'],
                params: { card },
                body: {
                    resetKeys: [],
                    changes: { gameFeatures: { combatLogEnabled: true } },
                },
            });
            ctx.admin.isMaster = false;

            await SaveSettingsConfigs(ctx);

            expect(sentData[0]).toMatchObject({
                type: 'error',
                msg: 'Only the master admin can change the Combat Log settings.',
            });
        }
        expect((globalThis as any).txCore.configStore.saveConfigs).not.toHaveBeenCalled();
    });

    it('should allow non-master admins to save cards that carry unchanged combat log values', async () => {
        const { ctx } = createMockCtx({
            permissions: ['settings.write'],
            params: { card: 'game' },
            body: {
                resetKeys: [],
                changes: {
                    gameFeatures: { combatLogEnabled: false, combatLogEngagementWindow: 10, menuAlignRight: true },
                },
            },
        });
        ctx.admin.isMaster = false;

        await SaveSettingsConfigs(ctx);

        expect((globalThis as any).txCore.configStore.saveConfigs).toHaveBeenCalled();
    });

    it('should reject combat log resets from non-master admins', async () => {
        (globalThis as any).txConfig.gameFeatures.combatLogEngagementWindow = 30;
        const { ctx, sentData } = createMockCtx({
            permissions: ['settings.write'],
            params: { card: 'game' },
            body: {
                resetKeys: ['gameFeatures.combatLogEngagementWindow'],
                changes: {},
            },
        });
        ctx.admin.isMaster = false;

        await SaveSettingsConfigs(ctx);

        expect(sentData[0]).toMatchObject({ type: 'error' });
        expect((globalThis as any).txCore.configStore.saveConfigs).not.toHaveBeenCalled();
    });

    it('should allow the master admin to change combat log settings', async () => {
        const { ctx } = createMockCtx({
            permissions: ['settings.write'],
            params: { card: 'game' },
            body: {
                resetKeys: [],
                changes: { gameFeatures: { combatLogEnabled: true, combatLogEngagementWindow: 15 } },
            },
        });
        ctx.admin.isMaster = true;

        await SaveSettingsConfigs(ctx);

        expect((globalThis as any).txCore.configStore.saveConfigs).toHaveBeenCalledWith(
            { gameFeatures: { combatLogEnabled: true, combatLogEngagementWindow: 15 } },
            'testadmin',
        );
    });
});
