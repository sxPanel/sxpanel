import { beforeEach, expect, it, suite, vi } from 'vitest';

vi.mock('@lib/misc', () => ({
    now: () => 2_000_000_000,
}));

import TicketsDao from './tickets';
import type { DatabaseTicketType } from '@shared/ticketApiTypes';

const createMockDb = () => {
    let tickets: DatabaseTicketType[] = [];

    const ticketsCollection = {
        value: vi.fn(() => tickets),
        find: vi.fn((filter: any) => {
            const found = tickets.find((ticket) =>
                Object.entries(filter).every(([key, value]) => (ticket as any)[key] === value),
            );
            return {
                cloneDeep: vi.fn(() => ({
                    value: vi.fn(() => (found ? structuredClone(found) : undefined)),
                })),
                value: vi.fn(() => found),
            };
        }),
        filter: vi.fn((filterOrFn: any) => {
            const filtered =
                typeof filterOrFn === 'function'
                    ? tickets.filter(filterOrFn)
                    : tickets.filter((ticket) =>
                          Object.entries(filterOrFn).every(([key, value]) => (ticket as any)[key] === value),
                      );
            return {
                cloneDeep: vi.fn(() => ({
                    value: vi.fn(() => structuredClone(filtered)),
                })),
                value: vi.fn(() => filtered),
            };
        }),
        remove: vi.fn((filterOrFn: any) => {
            const removed =
                typeof filterOrFn === 'function'
                    ? tickets.filter(filterOrFn)
                    : tickets.filter((ticket) =>
                          Object.entries(filterOrFn).every(([key, value]) => (ticket as any)[key] === value),
                      );
            tickets = tickets.filter((ticket) => !removed.includes(ticket));
            return { value: vi.fn(() => removed) };
        }),
    };

    const db = {
        obj: {
            chain: {
                get: vi.fn((collection: string) => {
                    if (collection !== 'tickets') throw new Error(`Unexpected collection '${collection}'`);
                    return ticketsCollection;
                }),
            },
        },
        isReady: true,
        writeFlag: vi.fn(),
    };

    return {
        db,
        setTickets: (nextTickets: DatabaseTicketType[]) => {
            tickets = nextTickets;
        },
        getTickets: () => tickets,
    };
};

const ticketFixture: DatabaseTicketType = {
    id: 'TKT-12345',
    status: 'closed',
    category: 'player-report',
    reporter: { license: 'license:reporter', name: 'Reporter', netid: 1 },
    targets: [],
    nearbyPlayers: [],
    description: 'Test ticket',
    messages: [],
    staffNotes: [],
    activityLog: [],
    logContext: { reporter: [], targets: [], world: [] },
    tsCreated: 1,
    tsLastActivity: 1,
    tsResolved: 1,
};

const analyticsFixture = (overrides: Partial<DatabaseTicketType>): DatabaseTicketType => {
    return {
        ...structuredClone(ticketFixture),
        ...overrides,
    };
};

suite('TicketsDao', () => {
    let dao: TicketsDao;
    let mockDb: ReturnType<typeof createMockDb>;

    beforeEach(() => {
        mockDb = createMockDb();
        dao = new TicketsDao(mockDb.db as any);
        vi.clearAllMocks();
    });

    suite('delete', () => {
        it('returns false when the ticket does not exist', () => {
            expect(dao.delete('TKT-missing')).toBe(false);
            expect(mockDb.db.writeFlag).not.toHaveBeenCalled();
        });

        it('removes an existing ticket from the tickets collection', () => {
            mockDb.setTickets([structuredClone(ticketFixture)]);

            expect(dao.delete(ticketFixture.id)).toBe(true);
            expect(mockDb.getTickets()).toEqual([]);
            expect(mockDb.db.writeFlag).toHaveBeenCalled();
        });
    });

    suite('getAnalytics', () => {
        it('computes staff metrics and 7d/30d rollups from ticket activity and messages', () => {
            mockDb.setTickets([
                analyticsFixture({
                    id: 'TKT-RECENT-1',
                    status: 'resolved',
                    resolvedBy: 'Alpha',
                    tsCreated: 2_000_000_000 - 3600,
                    tsResolved: 2_000_000_000 - 1800,
                    messages: [
                        {
                            id: 'msg-1',
                            author: 'Alpha',
                            authorType: 'admin',
                            content: 'Checking in.',
                            ts: 2_000_000_000 - 3000,
                        },
                    ],
                    activityLog: [
                        { ts: 2_000_000_000 - 3300, adminName: 'Alpha', action: 'claimed' },
                        { ts: 2_000_000_000 - 1800, adminName: 'Alpha', action: 'resolved' },
                    ],
                }),
                analyticsFixture({
                    id: 'TKT-RECENT-2',
                    status: 'open',
                    tsResolved: undefined,
                    tsCreated: 2_000_000_000 - 7200,
                    messages: [
                        {
                            id: 'msg-2',
                            author: 'Bravo',
                            authorType: 'admin',
                            content: 'We are on it.',
                            ts: 2_000_000_000 - 6600,
                        },
                    ],
                    activityLog: [
                        { ts: 2_000_000_000 - 6900, adminName: 'Bravo', action: 'claimed' },
                        { ts: 2_000_000_000 - 5400, adminName: 'Bravo', action: 'resolved' },
                        { ts: 2_000_000_000 - 3600, adminName: 'Bravo', action: 'reopened' },
                    ],
                }),
                analyticsFixture({
                    id: 'TKT-OLDER-1',
                    status: 'closed',
                    resolvedBy: 'Charlie',
                    tsCreated: 2_000_000_000 - 8 * 86400,
                    tsResolved: 2_000_000_000 - 8 * 86400 + 3600,
                    messages: [
                        {
                            id: 'msg-3',
                            author: 'Charlie',
                            authorType: 'admin',
                            content: 'Reviewing.',
                            ts: 2_000_000_000 - 8 * 86400 + 1200,
                        },
                    ],
                    activityLog: [
                        { ts: 2_000_000_000 - 8 * 86400 + 600, adminName: 'Charlie', action: 'assigned' },
                        { ts: 2_000_000_000 - 8 * 86400 + 3600, adminName: 'Charlie', action: 'closed' },
                    ],
                }),
            ]);

            const analytics = dao.getAnalytics(30);

            expect(analytics.staffMetrics).toEqual({
                ticketsCreated: 3,
                claimedTickets: 3,
                respondedTickets: 3,
                resolvedTickets: 3,
                reopenedTickets: 1,
                avgTimeToClaimMs: 400000,
                avgFirstStaffResponseMs: 800000,
                avgResolutionMs: 2400000,
                reopenRate: 33,
            });
            expect(analytics.rollups['7d']).toEqual({
                ticketsCreated: 2,
                ticketsResolved: 2,
                resolutionRate: 100,
                avgTimeToClaimMs: 300000,
                avgFirstStaffResponseMs: 600000,
                avgResolutionMs: 1800000,
                reopenRate: 50,
            });
            expect(analytics.rollups['30d']).toEqual({
                ticketsCreated: 3,
                ticketsResolved: 3,
                resolutionRate: 100,
                avgTimeToClaimMs: 400000,
                avgFirstStaffResponseMs: 800000,
                avgResolutionMs: 2400000,
                reopenRate: 33,
            });
            expect(analytics.overview).toEqual({
                total: 3,
                open: 1,
                inReview: 0,
                resolved: 1,
                closed: 1,
                avgResolutionMs: 2400000,
            });
        });
    });
});
