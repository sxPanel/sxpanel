import { suite, it, expect } from 'vitest';
import { discordMessageFlagIsComponentsV2 } from './componentsV2';
import {
    buildServerLogDiscordPayload,
    buildServerMenuDiscordPayload,
    buildSystemLogDiscordPayload,
    type DiscordLogPlayerResolver,
} from './logRouting';
import { normalizeDiscordLogRoutes } from '@shared/discordLogRoutes';

suite('normalizeDiscordLogRoutes', () => {
    it('should drop invalid routes and normalize duplicated entries', () => {
        expect(
            normalizeDiscordLogRoutes([
                {
                    key: 'system.action',
                    enabled: true,
                    channelId: ' 123456789012345678 ',
                    useEntryFilter: false,
                    entryFilter: [],
                },
                {
                    key: 'system.action',
                    enabled: false,
                    channelId: '999',
                    useEntryFilter: false,
                    entryFilter: [],
                },
                {
                    key: 'invalid.route',
                    enabled: true,
                    channelId: '123456789012345678',
                    useEntryFilter: false,
                    entryFilter: [],
                },
            ]),
        ).toEqual([
            {
                key: 'system.action',
                enabled: true,
                channelId: '123456789012345678',
                useEntryFilter: false,
                entryFilter: [],
            },
        ]);
    });

    it('should normalize legacy command filters into generic entry filters', () => {
        expect(
            normalizeDiscordLogRoutes([
                {
                    key: 'server.menu',
                    enabled: true,
                    channelId: '123456789012345678',
                    useCommandFilter: true,
                    commandFilter: ['players.noclip', 'invalid.command', 'players.noclip'],
                },
            ]),
        ).toEqual([
            {
                key: 'server.menu',
                enabled: true,
                channelId: '123456789012345678',
                useEntryFilter: true,
                entryFilter: ['players.noclip'],
            },
        ]);
    });

    it('should expand legacy config save filters into per-key config entries', () => {
        const [route] = normalizeDiscordLogRoutes([
            {
                key: 'system.config',
                enabled: true,
                channelId: '123456789012345678',
                useEntryFilter: true,
                entryFilter: ['config.save', 'auth.2fa.disable'],
            },
        ]);

        expect(route).toEqual(
            expect.objectContaining({
                key: 'system.config',
                useEntryFilter: true,
                entryFilter: expect.arrayContaining([
                    'config.general.serverName',
                    'config.discordBot.enabled',
                    'config.logger.server',
                    'auth.2fa.disable',
                ]),
            }),
        );
        expect(route.entryFilter).not.toContain('config.save');
    });
});

suite('buildSystemLogDiscordPayload', () => {
    it('should build a Discord v2 card payload for enabled system log routes', () => {
        const payload = buildSystemLogDiscordPayload(
            [
                {
                    key: 'system.action',
                    enabled: true,
                    channelId: '123456789012345678',
                    useEntryFilter: false,
                    entryFilter: [],
                },
            ],
            {
                ts: 1_700_000_000_000,
                author: 'admin',
                category: 'action',
                actionId: 'player.warn',
                action: 'Enabled noclip from the panel.',
            },
        );

        if (!payload) {
            throw new Error('Expected a system log payload.');
        }

        const textContents = JSON.stringify(payload.components);

        expect(payload).toEqual({
            channelId: '123456789012345678',
            guildId: null,
            flags: discordMessageFlagIsComponentsV2,
            components: [
                expect.objectContaining({
                    type: 17,
                    components: expect.arrayContaining([
                        expect.objectContaining({ content: expect.stringContaining('Panel Action Logs') }),
                        expect.objectContaining({ content: expect.stringContaining('Enabled noclip from the panel.') }),
                    ]),
                }),
            ],
            allowedMentions: { parse: [] },
        });
        expect(textContents.match(/<t:1700000000:F>/g)?.length ?? 0).toBe(1);
    });
});

suite('buildServerMenuDiscordPayload', () => {
    it('should build a Discord v2 card payload with username, permission, location, and time fields', () => {
        const payload = buildServerMenuDiscordPayload(
            [
                {
                    key: 'server.menu',
                    enabled: true,
                    channelId: '123456789012345678',
                    useEntryFilter: true,
                    entryFilter: ['players.noclip'],
                },
            ],
            {
                type: 'MenuEvent',
                data: {
                    action: 'playerModeChanged',
                    commandId: 'players.noclip',
                    permissionId: 'players.noclip',
                    location: { x: 1.25, y: 2.5, z: 3.75 },
                    message: 'enabled noclip',
                },
            },
            {
                ts: 1_700_000_000_000,
                src: { id: '12', name: 'AdminUser' },
                msg: 'enabled noclip',
            },
        );

        if (!payload) {
            throw new Error('Expected a server menu log payload.');
        }

        const textContents = JSON.stringify(payload.components);

        expect(payload).toEqual({
            channelId: '123456789012345678',
            guildId: null,
            flags: discordMessageFlagIsComponentsV2,
            components: [
                expect.objectContaining({
                    type: 17,
                    components: expect.arrayContaining([
                        expect.objectContaining({ content: expect.stringContaining('Admin Command Logs') }),
                        expect.objectContaining({ content: expect.stringContaining('enabled noclip') }),
                        expect.objectContaining({ content: expect.stringContaining('Username') }),
                        expect.objectContaining({ content: expect.stringContaining('AdminUser') }),
                        expect.objectContaining({ content: expect.stringContaining('NoClip') }),
                        expect.objectContaining({ content: expect.stringContaining('X: 1.25, Y: 2.50, Z: 3.75') }),
                    ]),
                }),
            ],
            allowedMentions: { parse: [] },
        });
        expect(textContents.match(/<t:1700000000:F>/g)?.length ?? 0).toBe(1);
    });

    it('should skip menu logs that are not selected in the advanced command filter', () => {
        expect(
            buildServerMenuDiscordPayload(
                [
                    {
                        key: 'server.menu',
                        enabled: true,
                        channelId: '123456789012345678',
                        useEntryFilter: true,
                        entryFilter: ['players.godmode'],
                    },
                ],
                {
                    type: 'MenuEvent',
                    data: {
                        action: 'playerModeChanged',
                        commandId: 'players.noclip',
                        message: 'enabled noclip',
                    },
                },
                {
                    ts: 1_700_000_000_000,
                    src: { id: '12', name: 'AdminUser' },
                    msg: 'enabled noclip',
                },
            ),
        ).toBe(false);
    });

    it('should skip system logs that are not selected in the advanced entry filter', () => {
        expect(
            buildSystemLogDiscordPayload(
                [
                    {
                        key: 'system.action',
                        enabled: true,
                        channelId: '123456789012345678',
                        useEntryFilter: true,
                        entryFilter: ['ticket.create'],
                    },
                ],
                {
                    ts: 1_700_000_000_000,
                    author: 'admin',
                    category: 'action',
                    actionId: 'player.warn',
                    action: 'Warned a player.',
                },
            ),
        ).toBe(false);
    });
});

suite('buildServerLogDiscordPayload', () => {
    const channelId = '123456789012345678';
    const players: Record<number, { displayName: string; discordId: string | null }> = {
        1: { displayName: 'Shooter', discordId: '111111111111111111' },
        2: { displayName: 'Target_Guy', discordId: null },
    };
    const resolvePlayer: DiscordLogPlayerResolver = (netid) => {
        const player = players[netid];
        return player ? { netid, ...player } : undefined;
    };
    const route = (key: string, entryFilter?: string[]) => [
        {
            key,
            enabled: true,
            channelId,
            useEntryFilter: !!entryFilter,
            entryFilter: entryFilter ?? [],
        },
    ];
    //Joins every text display content, so assertions don't depend on JSON escaping
    const getText = (payload: unknown) => {
        if (!payload) throw new Error('Expected a payload.');
        const contents: string[] = [];
        const walk = (node: unknown) => {
            if (!node || typeof node !== 'object') return;
            const obj = node as Record<string, unknown>;
            if (typeof obj.content === 'string') contents.push(obj.content);
            if (Array.isArray(obj.components)) obj.components.forEach(walk);
        };
        (payload as { components: unknown[] }).components.forEach(walk);
        return contents.join('\n');
    };

    it('should build a kill card with combat stats and a non-pinging Discord mention', () => {
        const payload = buildServerLogDiscordPayload(
            route('server.combat'),
            {
                type: 'DeathNotice',
                src: 2,
                data: {
                    cause: 'Pistol',
                    killer: 1,
                    combat: { hits: 4, headshots: 1, damage: 87, distance: 23.4, weapons: ['Pistol', 'Knife'] },
                },
            },
            { ts: 1_700_000_000_000, src: { id: 'abc', name: 'Target_Guy' }, msg: 'died from Pistol by Shooter' },
            resolvePlayer,
        );

        const text = getText(payload);
        expect(payload).toMatchObject({ channelId, allowedMentions: { parse: [] } });
        expect(text).toContain('Player Kill');
        expect(text).toContain('Shooter (#1) • <@111111111111111111>');
        expect(text).toContain('Target\\_Guy (#2)');
        expect(text).toContain('**Hits:** 4');
        expect(text).toContain('**Headshots:** 1');
        expect(text).toContain('**Distance:** 23.4m');
        expect(text).toContain('**Weapons Used:** Pistol, Knife');
        expect(text).toContain('<t:1700000000:F>');
    });

    it('should classify deaths without a killer as other deaths and respect the entry filter', () => {
        const rawEvent = { type: 'DeathNotice', src: 2, data: { cause: 'suicide (Falling)', killer: false } };
        const logEntry = { ts: 1_700_000_000_000, src: { id: 'abc', name: 'Target_Guy' }, msg: 'died from x' };

        expect(
            getText(buildServerLogDiscordPayload(route('server.combat'), rawEvent, logEntry, resolvePlayer)),
        ).toContain('Player Death');
        expect(
            buildServerLogDiscordPayload(route('server.combat', ['combat.kill']), rawEvent, logEntry, resolvePlayer),
        ).toBe(false);
    });

    it('should build damage summary cards and reject invalid combat data', () => {
        const logEntry = { ts: 1_700_000_000_000, src: { id: 'abc', name: 'Shooter' }, msg: 'damaged Target_Guy' };
        const text = getText(
            buildServerLogDiscordPayload(
                route('server.combat'),
                { type: 'CombatDamage', src: 1, data: { victim: 2, hits: 2, damage: 40, weapon: 'SMG' } },
                logEntry,
                resolvePlayer,
            ),
        );
        expect(text).toContain('Combat Damage');
        expect(text).toContain('**Weapon:** SMG');

        expect(
            buildServerLogDiscordPayload(
                route('server.combat'),
                { type: 'CombatDamage', src: 1, data: { hits: 2 } },
                logEntry,
                resolvePlayer,
            ),
        ).toBe(false);
    });

    it('should route joins, leaves, and denied joins to the connection route', () => {
        const logEntry = { ts: 1_700_000_000_000, src: { id: 'abc', name: 'Shooter' }, msg: 'disconnected (Exiting)' };
        const leave = getText(
            buildServerLogDiscordPayload(
                route('server.connection'),
                { type: 'playerDropped', src: 1, data: { reason: 'Exiting' } },
                logEntry,
                resolvePlayer,
            ),
        );
        expect(leave).toContain('Player Left');
        expect(leave).toContain('**Reason:** Exiting');

        expect(
            buildServerLogDiscordPayload(
                route('server.connection', ['player.join']),
                { type: 'playerDropped', src: 1, data: { reason: 'Exiting' } },
                logEntry,
                resolvePlayer,
            ),
        ).toBe(false);
    });

    it('should escape markdown and neutralize mentions in chat messages', () => {
        const text = getText(
            buildServerLogDiscordPayload(
                route('server.chat'),
                { type: 'ChatMessage', src: 1, data: { author: 'Shooter', text: '^1hey **@everyone**' } },
                { ts: 1_700_000_000_000, src: { id: 'abc', name: 'Shooter' }, msg: 'said' },
                resolvePlayer,
            ),
        );
        expect(text).toContain('Chat Message');
        expect(text).not.toContain('@everyone');
        expect(text).not.toContain('^1');
        expect(text).toContain('hey \\*\\*@​everyone\\*\\*');
    });

    it('should skip events for disabled routes and unknown types', () => {
        const logEntry = { ts: 1, src: { id: 'abc', name: 'Shooter' }, msg: 'x' };
        expect(
            buildServerLogDiscordPayload(
                [{ key: 'server.chat', enabled: false, channelId, useEntryFilter: false, entryFilter: [] }],
                { type: 'ChatMessage', src: 1, data: { text: 'hi' } },
                logEntry,
            ),
        ).toBe(false);
        expect(buildServerLogDiscordPayload(route('server.chat'), { type: 'explosionEvent' }, logEntry)).toBe(false);
    });
});
