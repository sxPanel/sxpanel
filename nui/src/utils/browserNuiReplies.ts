/**
 * Browser-mode (`npm run browser`) stand-ins for NUI callbacks that Lua answers
 * with a separate NUI message instead of the callback response. Without these,
 * pages like Stats and the staff Reports tab sit on their loading state forever.
 *
 * Each handler receives the request body and returns the message(s) Lua would send.
 */

interface ReplyMessage {
    action: string;
    data: unknown;
}

type ReplyHandler = (body: any) => ReplyMessage[];

const now = () => Math.floor(Date.now() / 1000);
const bootTs = now() - 198000;

const mockTickets = [
    {
        id: 'TKT-1042',
        category: 'Player Report',
        priority: 'high',
        status: 'open',
        reporter: { license: 'license:mock1', name: 'Jane_Smith', netid: 3 },
        targets: [{ license: 'license:mock2', name: 'Suspect_Player', netid: 2 }],
        description: 'Suspect_Player keeps ramming people at the Legion Square garage.',
        messages: [
            {
                id: 'm1',
                author: 'Jane_Smith',
                authorType: 'player',
                content: 'Suspect_Player keeps ramming people at the Legion Square garage.',
                ts: now() - 900,
            },
            {
                id: 'm2',
                author: 'Taso',
                authorType: 'admin',
                content: 'Thanks, on my way to take a look.',
                ts: now() - 600,
            },
        ],
        tsCreated: now() - 900,
        tsLastActivity: now() - 600,
        claimedBy: null as string | null,
    },
    {
        id: 'TKT-1039',
        category: 'Bug Report',
        priority: 'medium',
        status: 'inReview',
        reporter: { license: 'license:mock3', name: 'John_Doe', netid: 1 },
        targets: [],
        description: 'My car despawned while driving on the highway.',
        messages: [
            {
                id: 'm3',
                author: 'John_Doe',
                authorType: 'player',
                content: 'My car despawned while driving on the highway.',
                ts: now() - 5400,
            },
        ],
        tsCreated: now() - 5400,
        tsLastActivity: now() - 4800,
        claimedBy: 'Taso' as string | null,
    },
    {
        id: 'TKT-1031',
        category: 'Question',
        priority: 'low',
        status: 'resolved',
        reporter: { license: 'license:mock4', name: 'Ava_Reyes', netid: 6 },
        targets: [],
        description: 'How do I join the whitelist for the police department?',
        messages: [
            {
                id: 'm4',
                author: 'Ava_Reyes',
                authorType: 'player',
                content: 'How do I join the whitelist for the police department?',
                ts: now() - 86400,
            },
            {
                id: 'm5',
                author: 'Taso',
                authorType: 'admin',
                content: 'Apply on our Discord, a recruiter will reach out.',
                ts: now() - 82800,
            },
        ],
        tsCreated: now() - 86400,
        tsLastActivity: now() - 82800,
        claimedBy: 'Taso' as string | null,
    },
];

const toListItem = (ticket: (typeof mockTickets)[number]) => ({
    id: ticket.id,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    reporterName: ticket.reporter.name,
    targetNames: ticket.targets.map((target) => target.name),
    descriptionPreview: ticket.description.slice(0, 80),
    messageCount: ticket.messages.length,
    unreadCount: 0,
    tsCreated: ticket.tsCreated,
    tsLastActivity: ticket.tsLastActivity,
    claimedBy: ticket.claimedBy,
});

const findTicket = (ticketId: unknown) => mockTickets.find((ticket) => ticket.id === ticketId);

export const browserNuiReplies: Record<string, ReplyHandler> = {
    getStats: () => [
        {
            action: 'setStats',
            data: { playerCount: 3, resourceCount: 25, uptimeSeconds: now() - bootTs },
        },
    ],
    ticketAdminList: () => [{ action: 'ticketAdminListData', data: { tickets: mockTickets.map(toListItem) } }],
    ticketAdminDetail: (body) => {
        const ticket = findTicket(body?.ticketId);
        return [{ action: 'ticketAdminDetailData', data: ticket ? { ticket } : { error: 'ticket_not_found' } }];
    },
    ticketAdminMessage: (body) => {
        const ticket = findTicket(body?.ticketId);
        if (!ticket) return [{ action: 'ticketAdminMessageResult', data: { error: 'ticket_not_found' } }];
        ticket.messages.push({
            id: `m${Date.now()}`,
            author: 'Taso',
            authorType: 'admin',
            content: String(body.content ?? ''),
            ts: now(),
        });
        ticket.tsLastActivity = now();
        return [{ action: 'ticketAdminMessageResult', data: { success: true } }];
    },
    ticketAdminStatus: (body) => {
        const ticket = findTicket(body?.ticketId);
        if (!ticket) return [{ action: 'ticketAdminStatusResult', data: { error: 'ticket_not_found' } }];
        ticket.status = body.status;
        if (body.status === 'inReview') ticket.claimedBy = 'Taso';
        ticket.tsLastActivity = now();
        return [{ action: 'ticketAdminStatusResult', data: { success: true } }];
    },
};
