import { describe, it, expect } from 'vitest';
import {
    assembleDiscordEmbedMessage,
    buildPlayerListPlaceholderDataFromPlayers,
    isValidEmbedUrl,
    playerListInlineSeparatorFallback,
    resolveEmbedColor,
    type PlainObject,
} from './processEmbed';
import { buildMockEmbedPlaceholders, type PreviewHealth } from './mockPlaceholders';
import { MOCK_PREVIEW_PLAYERS } from './mockPlayers';
import { createPreviewMsgFn } from './previewMessages';
import { discordMessageFlagIsComponentsV2 } from './componentsV2';

const buildInputs = (embedConfig: Record<string, unknown>, health: PreviewHealth = 'online') => {
    const msg = createPreviewMsgFn();
    const playerListData = buildPlayerListPlaceholderDataFromPlayers(
        embedConfig as PlainObject,
        MOCK_PREVIEW_PLAYERS,
        msg,
        1,
    );
    const placeholders = buildMockEmbedPlaceholders(
        embedConfig as PlainObject,
        {
            playerList: playerListData.playerList,
            playerListColumns: playerListData.playerListColumns.join(playerListInlineSeparatorFallback),
            playerListInline: playerListData.playerListInline,
            playerListSummary: playerListData.playerListSummary,
            playerListPage: playerListData.playerListPage,
            playerListTotalPages: playerListData.playerListTotalPages,
            playerListPageSummary: playerListData.playerListPageSummary,
        },
        health,
    );
    return { msg, playerListData, placeholders };
};

describe('processEmbed (Discord-facing output)', () => {
    it('assembles a Components V2 status embed payload with resolved placeholders', () => {
        const embedConfig = { onlineColor: '#0BA70B', buttons: [{ label: 'Connect', url: '{{serverJoinUrl}}' }] };
        const { msg, playerListData, placeholders } = buildInputs(embedConfig);

        const { messagePayload } = assembleDiscordEmbedMessage({
            embedJson: {
                title: '{{serverName}}',
                description: '{{configurableEmbedDescription}}',
                color: '{{statusColor}}',
                fields: [{ name: 'Status', value: '{{statusString}}', inline: true }],
            },
            embedConfigJson: embedConfig as PlainObject,
            placeholders,
            playerListData,
            msg,
            options: {
                previewLenient: true,
                defaultFooter: { icon_url: 'https://cdn.discordapp.com/footer.webp', text: 'sxPanel preview' },
            },
        });

        expect(messagePayload.flags).toBe(discordMessageFlagIsComponentsV2);
        const serialized = JSON.stringify(messagePayload);
        expect(serialized).not.toMatch(/\{\{/);
        expect(serialized).toContain('Los Santos Preview RP');
        expect(serialized).toContain('Online');
        // Join button resolves to a concrete cfx URL the Discord user will click.
        expect(serialized).toContain('cfx.re/join/previewcfx123');
    });

    it('throws on an invalid embed url when not preview lenient', () => {
        const embedConfig = {};
        const { msg, playerListData, placeholders } = buildInputs(embedConfig);

        expect(() =>
            assembleDiscordEmbedMessage({
                embedJson: { title: 'T', url: 'not-a-url' },
                embedConfigJson: embedConfig as PlainObject,
                placeholders,
                playerListData,
                msg,
            }),
        ).toThrow();
    });

    it('falls back to a sample join URL for an unresolvable button in preview-lenient mode', () => {
        const embedConfig = { buttons: [{ label: 'Bad', url: '{{unresolved}}' }] };
        const { msg, playerListData, placeholders } = buildInputs(embedConfig);

        const { messagePayload } = assembleDiscordEmbedMessage({
            embedJson: { title: 'T' },
            embedConfigJson: embedConfig as PlainObject,
            placeholders,
            playerListData,
            msg,
            options: { previewLenient: true },
        });

        const serialized = JSON.stringify(messagePayload);
        expect(serialized).toContain('https://cfx.re/join/previewcfx123');
        expect(serialized).not.toContain('{{unresolved}}');
    });

    it('expands a player list into column fields for the Discord message', () => {
        const embedConfig = {
            playerLineTemplate: '{{displayName}}',
            playerInlineTemplate: '{{displayName}}',
            playerColumnTemplate: '{{displayName}}',
            playerColumnCount: 3,
            playersPerColumn: 4,
            buttons: [],
        };
        const { msg, playerListData, placeholders } = buildInputs(embedConfig);

        const { messagePayload } = assembleDiscordEmbedMessage({
            embedJson: { title: 'Players', fields: [{ name: 'List', value: '{{playerListColumns}}' }] },
            embedConfigJson: embedConfig as PlainObject,
            placeholders,
            playerListData,
            msg,
            options: { expandPlayerListFields: true, previewLenient: true },
        });

        const serialized = JSON.stringify(messagePayload);
        expect(serialized).toContain('Preview Player 1');
        expect(playerListData.playerListColumns.length).toBe(3);
    });

    it('adds a player list pager row for multi-page lists', () => {
        const embedConfig = { playerColumnCount: 3, playersPerColumn: 1, buttons: [] };
        const { msg, playerListData, placeholders } = buildInputs(embedConfig);

        const { messagePayload } = assembleDiscordEmbedMessage({
            embedJson: { title: 'Players' },
            embedConfigJson: embedConfig as PlainObject,
            placeholders,
            playerListData,
            msg,
            options: { includePlayerListPager: true, previewLenient: true },
        });

        const serialized = JSON.stringify(messagePayload);
        expect(playerListData.playerListTotalPages).toBeGreaterThan(1);
        expect(serialized).toContain('sxpanel:playerList:page:');
    });

    it('resolves embed color from hex, decimal, and number forms', () => {
        const msg = createPreviewMsgFn();
        expect(resolveEmbedColor('#0BA70B', msg)).toBe(0x0ba70b);
        expect(resolveEmbedColor('0BA70B', msg)).toBe(0x0ba70b);
        expect(resolveEmbedColor('16711680', msg)).toBe(0xff0000);
        expect(resolveEmbedColor(0xff0000, msg)).toBe(0xff0000);
        expect(() => resolveEmbedColor('notacolor', msg)).toThrow();
    });

    it('validates embed urls', () => {
        expect(isValidEmbedUrl('https://x.com')).toBe(true);
        expect(isValidEmbedUrl('discord://x')).toBe(true);
        expect(isValidEmbedUrl('javascript:alert(1)')).toBe(false);
        expect(isValidEmbedUrl('not a url')).toBe(false);
    });
});
