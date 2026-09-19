import { expect, it, suite } from 'vitest';
import { discordMessageFlagIsComponentsV2 } from './componentsV2';
import {
    buildTicketActionRows,
    buildTicketQueueSummaryEmbed,
    buildTicketSummaryEmbed,
    buildTicketSummaryMessagePayload,
    normalizeTicketCommandTicketId,
} from './ticketCommandUtils';
import type { DatabaseTicketType } from '@shared/ticketApiTypes';

const ticketFixture: DatabaseTicketType = {
    id: 'TKT-12345',
    status: 'inReview',
    category: 'Player Report',
    priority: 'high',
    reporter: { license: 'license:reporter', name: 'Reporter_Name', netid: 42 },
    targets: [{ license: 'license:target', name: 'Target User', netid: 7 }],
    nearbyPlayers: [],
    description: 'This is a test ticket description.',
    screenshotUrl: '/reports/screenshot/example.png',
    messages: [{ id: 'm1', author: 'Admin', authorType: 'admin', content: 'hello', ts: 100 }],
    staffNotes: [{ id: 'n1', authorAdminId: 'admin', authorName: 'Admin', content: 'note', ts: 101 }],
    activityLog: [],
    logContext: { reporter: [], targets: [], world: [] },
    claimedBy: 'Moderator One',
    tsCreated: 1_700_000_000,
    tsLastActivity: 1_700_000_300,
    tsResolved: 1_700_000_600,
    resolvedBy: 'Moderator One',
    discordThreadId: '123',
};

suite('ticketCommandUtils', () => {
    it('normalizes ticket ids for command inputs', () => {
        expect(normalizeTicketCommandTicketId('  tkt-12345  ')).toBe('TKT-12345');
        expect(normalizeTicketCommandTicketId('')).toBeNull();
        expect(normalizeTicketCommandTicketId(undefined)).toBeNull();
    });

    it('builds a ticket summary embed with core triage fields', () => {
        const embed = buildTicketSummaryEmbed(ticketFixture, { note: 'Claim updated.' });

        expect(embed.title).toContain('TKT-12345');
        expect(embed.description).toContain('Claim updated.');
        expect(embed.description).toContain('This is a test ticket description.');
        expect(embed.fields).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'Status', value: 'In Review' }),
                expect.objectContaining({ name: 'Priority', value: 'High' }),
                expect.objectContaining({ name: 'Claimed By', value: 'Moderator One' }),
                expect.objectContaining({ name: 'Reporter', value: 'Reporter\\_Name (#42)' }),
            ]),
        );
    });

    it('builds a queue summary embed with counts and active tickets', () => {
        const embed = buildTicketQueueSummaryEmbed(
            {
                overview: {
                    total: 8,
                    open: 3,
                    inReview: 2,
                    resolved: 2,
                    closed: 1,
                    avgResolutionMs: 120_000,
                },
                byPriority: [
                    { priority: 'critical', count: 1 },
                    { priority: 'high', count: 2 },
                ],
            },
            [ticketFixture],
        );

        expect(embed.title).toBe('Report Queue Summary');
        expect(embed.fields).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'Queue', value: expect.stringContaining('Open: **3**') }),
                expect.objectContaining({ name: 'Priority Mix', value: expect.stringContaining('Critical: **1**') }),
                expect.objectContaining({ name: 'Active Tickets', value: expect.stringContaining('`TKT-12345`') }),
            ]),
        );
    });

    it('builds ticket action rows that reflect ticket status', () => {
        const activeRow = buildTicketActionRows(ticketFixture.id, 'inReview')[0];
        const resolvedRow = buildTicketActionRows(ticketFixture.id, 'resolved')[0];
        const activeResolve = activeRow.components.find((component) => component.custom_id.includes(':resolve:'));
        const activeReopen = activeRow.components.find((component) => component.custom_id.includes(':reopen:'));
        const resolvedResolve = resolvedRow.components.find((component) => component.custom_id.includes(':resolve:'));
        const resolvedReopen = resolvedRow.components.find((component) => component.custom_id.includes(':reopen:'));

        expect(activeResolve?.disabled).not.toBe(true);
        expect(activeReopen?.disabled).toBe(true);
        expect(resolvedResolve?.disabled).toBe(true);
        expect(resolvedReopen?.disabled).not.toBe(true);
    });

    it('builds a ticket summary message payload with triage buttons', () => {
        const payload = buildTicketSummaryMessagePayload(ticketFixture, { note: 'Updated from Discord.' });
        const componentPayload = JSON.stringify(payload.components);
        const container = payload.components?.[0] as {
            type: number;
            components: Array<{
                type: number;
                components?: Record<string, unknown>[];
            }>;
        };
        const actionRow = container.components.find((component) => component.type === 1) as {
            components: Record<string, unknown>[];
        };

        expect(payload.flags).toBe(discordMessageFlagIsComponentsV2);
        expect(payload.embeds).toBeUndefined();
        expect(componentPayload).toContain('Updated from Discord.');
        expect(container.type).toBe(17);
        expect(actionRow.components).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ custom_id: 'sxpanel:ticket:summary:TKT-12345', label: 'Refresh' }),
                expect.objectContaining({ custom_id: 'sxpanel:ticket:assign:TKT-12345', label: 'Assign' }),
            ]),
        );
    });
});
