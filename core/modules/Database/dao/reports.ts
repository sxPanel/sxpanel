import { DbInstance, SavePriority } from '../instance';
import { genTicketID } from '../dbUtils';
import { now } from '@lib/misc';
import { randomUUID } from 'node:crypto';
import consoleFactory from '@lib/console';
import type {
    DatabaseTicketType,
    TicketStatus,
    TicketMessage,
    TicketLogContext,
    StaffNote,
    PlayerFeedback,
    TicketPriority,
    IntercomTicketCreateReq,
    TicketActivityEntry,
    TicketAnalyticsSummary,
} from '@shared/ticketApiTypes';
const console = consoleFactory('DatabaseDao');

type AnalyticsData = TicketAnalyticsSummary;

/**
 * Data access object for the database "tickets" collection.
 */
export default class TicketsDao {
    constructor(private readonly db: DbInstance) {}

    private get dbo() {
        if (!this.db.obj || !this.db.isReady) throw new Error(`database not ready yet`);
        return this.db.obj;
    }

    private get chain() {
        if (!this.db.obj || !this.db.isReady) throw new Error(`database not ready yet`);
        return this.db.obj.chain;
    }

    /**
     * Finds a ticket by its ID. Also accepts legacy RPT- IDs (mapped to TKT-).
     */
    findOne(ticketId: string): DatabaseTicketType | null {
        if (typeof ticketId !== 'string' || !ticketId.length) throw new Error('Invalid ticketId.');
        // Accept legacy IDs (RPT-XXXXX → TKT-XXXXX)
        const normalizedId = ticketId.startsWith('RPT-') ? 'TKT-' + ticketId.slice(4) : ticketId;
        const t = this.chain.get('tickets').find({ id: normalizedId }).cloneDeep().value();
        return typeof t === 'undefined' ? null : t;
    }

    /**
     * Returns all tickets, optionally filtered by status and/or category
     */
    findAll(filter?: { status?: TicketStatus; category?: string }): DatabaseTicketType[] {
        let query = this.chain.get('tickets');
        if (filter?.status || filter?.category) {
            return query
                .filter((t: DatabaseTicketType) => {
                    if (filter.status && t.status !== filter.status) return false;
                    if (filter.category && t.category !== filter.category) return false;
                    return true;
                })
                .cloneDeep()
                .value();
        }
        return query.cloneDeep().value();
    }

    /**
     * Returns all tickets reported by a given player license
     */
    findByReporter(license: string): DatabaseTicketType[] {
        return this.chain
            .get('tickets')
            .filter((t: DatabaseTicketType) => t.reporter.license === license)
            .cloneDeep()
            .value();
    }

    /**
     * Creates a new ticket and returns its ID
     */
    create(data: IntercomTicketCreateReq, logContext: TicketLogContext): string {
        if (typeof data.description !== 'string' || !data.description.length) throw new Error('Invalid description.');

        const ticketId = genTicketID(this.dbo);
        const tsNow = now();
        const toDB: DatabaseTicketType = {
            id: ticketId,
            status: 'open',
            category: data.category,
            priority: data.priority,
            reporter: { license: data.reporter.license, name: data.reporter.name, netid: data.reporter.netid },
            targets: (data.targets ?? []).map((t) => ({ license: t.license, name: t.name, netid: t.netid })),
            description: data.description,
            screenshotUrl: undefined, // will be set after screenshot upload (if any)
            messages: [],
            staffNotes: [],
            activityLog: [],
            logContext,
            tsCreated: tsNow,
            tsLastActivity: tsNow,
        };
        this.chain.get('tickets').push(toDB).value();
        this.db.writeFlag(SavePriority.HIGH);
        return ticketId;
    }

    /**
     * Adds a message to a ticket
     */
    addMessage(ticketId: string, message: Omit<TicketMessage, 'id'>): boolean {
        // lowdb's .find(...).value() returns a live in-memory reference to the
        // stored object, so direct mutations of ticket.messages and
        // ticket.tsLastActivity are reflected in the database state immediately.
        // this.db.writeFlag(SavePriority.MEDIUM) then schedules the flush to disk.
        const ticket = this.chain.get('tickets').find({ id: ticketId }).value();
        if (!ticket) return false;

        ticket.messages.push({ ...message, id: randomUUID() });
        ticket.tsLastActivity = now();
        this.db.writeFlag(SavePriority.MEDIUM);
        return true;
    }

    /**
     * Adds a staff note to a ticket
     */
    addStaffNote(ticketId: string, note: Omit<StaffNote, 'id'>): boolean {
        const ticket = this.chain.get('tickets').find({ id: ticketId }).value();
        if (!ticket) return false;

        if (!ticket.staffNotes) ticket.staffNotes = [];
        ticket.staffNotes.push({ ...note, id: randomUUID() });
        ticket.tsLastActivity = now();
        this.db.writeFlag(SavePriority.MEDIUM);
        return true;
    }

    /**
     * Removes a staff note from a ticket
     */
    removeStaffNote(ticketId: string, noteId: string): boolean {
        const ticket = this.chain.get('tickets').find({ id: ticketId }).value();
        if (!ticket) return false;

        const before = ticket.staffNotes?.length ?? 0;
        ticket.staffNotes = (ticket.staffNotes ?? []).filter((n: StaffNote) => n.id !== noteId);
        if (ticket.staffNotes.length === before) return false;

        ticket.tsLastActivity = now();
        this.db.writeFlag(SavePriority.MEDIUM);
        return true;
    }

    /**
     * Adds an activity log entry to a ticket (audit trail)
     */
    addActivityEntry(ticketId: string, entry: TicketActivityEntry): boolean {
        const ticket = this.chain.get('tickets').find({ id: ticketId }).value();
        if (!ticket) return false;

        if (!ticket.activityLog) ticket.activityLog = [];
        ticket.activityLog.push(entry);
        this.db.writeFlag(SavePriority.LOW);
        return true;
    }

    /**
     * Sets the status of a ticket
     */
    setStatus(ticketId: string, status: TicketStatus, adminName?: string): boolean {
        const ticket = this.chain.get('tickets').find({ id: ticketId }).value();
        if (!ticket) return false;

        const ts = now();
        ticket.status = status;
        ticket.tsLastActivity = ts;
        if (status === 'resolved' || status === 'closed') {
            ticket.tsResolved = ts;
            ticket.resolvedBy = adminName ?? undefined;
        } else {
            ticket.tsResolved = undefined;
            ticket.resolvedBy = undefined;
        }
        this.db.writeFlag(SavePriority.MEDIUM);
        return true;
    }

    /**
     * Claims or unclaims a ticket for an admin
     */
    setClaimed(ticketId: string, adminName: string | null): boolean {
        const ticket = this.chain.get('tickets').find({ id: ticketId }).value();
        if (!ticket) return false;

        ticket.claimedBy = adminName ?? undefined;
        ticket.tsLastActivity = now();
        this.db.writeFlag(SavePriority.LOW);
        return true;
    }

    /**
     * Sets the screenshot URL for a ticket
     */
    setScreenshot(ticketId: string, url: string): boolean {
        const ticket = this.chain.get('tickets').find({ id: ticketId }).value();
        if (!ticket) return false;

        ticket.screenshotUrl = url;
        ticket.tsLastActivity = now();
        this.db.writeFlag(SavePriority.LOW);
        return true;
    }

    /**
     * Sets player feedback on a resolved/closed ticket
     */
    setFeedback(ticketId: string, feedback: PlayerFeedback): boolean {
        const ticket = this.chain.get('tickets').find({ id: ticketId }).value();
        if (!ticket) return false;

        ticket.feedback = feedback;
        this.db.writeFlag(SavePriority.LOW);
        return true;
    }

    /**
     * Computes analytics data from the tickets store
     */
    getAnalytics(windowDays = 30): AnalyticsData {
        const allTickets: DatabaseTicketType[] = this.chain.get('tickets').cloneDeep().value();
        const tsNow = now();

        const overview = {
            total: allTickets.length,
            open: 0,
            inReview: 0,
            resolved: 0,
            closed: 0,
            avgResolutionMs: 0,
        };

        const catMap = new Map<string, number>();
        const priMap = new Map<TicketPriority, number>();
        const leaderMap = new Map<string, { resolved: number; totalMs: number }>();

        // Timeline: date string → { created, resolved }
        const timelineMap = new Map<string, { created: number; resolved: number }>();
        // Seed last N days
        for (let i = windowDays - 1; i >= 0; i--) {
            const d = new Date((tsNow - i * 86400) * 1000);
            const key = d.toISOString().slice(0, 10);
            timelineMap.set(key, { created: 0, resolved: 0 });
        }

        let totalResolutionMs = 0;
        let resolvedCount = 0;

        for (const t of allTickets) {
            // Overview counts
            if (t.status === 'open') overview.open++;
            else if (t.status === 'inReview') overview.inReview++;
            else if (t.status === 'resolved') overview.resolved++;
            else if (t.status === 'closed') overview.closed++;

            // Category
            catMap.set(t.category, (catMap.get(t.category) ?? 0) + 1);

            // Priority
            if (t.priority) {
                priMap.set(t.priority, (priMap.get(t.priority) ?? 0) + 1);
            }

            // Timeline (created)
            const createdKey = new Date(t.tsCreated * 1000).toISOString().slice(0, 10);
            const createdEntry = timelineMap.get(createdKey);
            if (createdEntry) createdEntry.created++;

            // Timeline (resolved) + leaderboard
            if ((t.status === 'resolved' || t.status === 'closed') && t.tsResolved) {
                const resolvedKey = new Date(t.tsResolved * 1000).toISOString().slice(0, 10);
                const resolvedEntry = timelineMap.get(resolvedKey);
                if (resolvedEntry) resolvedEntry.resolved++;

                const resMs = (t.tsResolved - t.tsCreated) * 1000;
                if (resMs >= 0) {
                    totalResolutionMs += resMs;
                    resolvedCount++;
                }

                // Leaderboard
                if (t.resolvedBy) {
                    const entry = leaderMap.get(t.resolvedBy) ?? { resolved: 0, totalMs: 0 };
                    entry.resolved++;
                    if (resMs >= 0) entry.totalMs += resMs;
                    leaderMap.set(t.resolvedBy, entry);
                }
            }
        }

        overview.avgResolutionMs = resolvedCount > 0 ? Math.round(totalResolutionMs / resolvedCount) : 0;

        const byCategory = Array.from(catMap.entries()).map(([category, count]) => ({ category, count }));
        const byPriority = Array.from(priMap.entries()).map(([priority, count]) => ({ priority, count }));
        const timelineDays = Array.from(timelineMap.entries()).map(([date, v]) => ({ date, ...v }));
        const leaderboard = Array.from(leaderMap.entries())
            .map(([adminName, v]) => ({
                adminName,
                resolved: v.resolved,
                avgResolutionMs: v.resolved > 0 ? Math.round(v.totalMs / v.resolved) : 0,
            }))
            .sort((a, b) => b.resolved - a.resolved);

        return { overview, byCategory, byPriority, timelineDays, leaderboard };
    }

    /**
     * Returns the Discord thread ID for the given ticket, or null if none exists
     */
    getDiscordThreadId(ticketId: string): string | null {
        const ticket = this.findOne(ticketId);
        return ticket?.discordThreadId ?? null;
    }

    /**
     * Finds a ticket by its linked Discord thread ID (reverse lookup)
     */
    findByDiscordThread(threadId: string): DatabaseTicketType | null {
        const t = this.chain
            .get('tickets')
            .find((ticket: DatabaseTicketType) => ticket.discordThreadId === threadId)
            .cloneDeep()
            .value();
        return typeof t === 'undefined' ? null : t;
    }

    /**
     * Removes resolved/closed tickets older than the retention period
     */
    removeExpiredResolved(retentionDays: number): number {
        const cutoff = now() - retentionDays * 86400;
        const removed = this.chain
            .get('tickets')
            .remove(
                (t: DatabaseTicketType) =>
                    (t.status === 'resolved' || t.status === 'closed') &&
                    t.tsResolved !== undefined &&
                    t.tsResolved < cutoff,
            )
            .value();
        if (removed.length > 0) {
            this.db.writeFlag(SavePriority.LOW);
        }
        return removed.length;
    }

    /**
     * Sets the Discord thread ID for a ticket after thread creation
     */
    setDiscordThread(ticketId: string, threadId: string): boolean {
        const ticket = this.chain.get('tickets').find({ id: ticketId }).value();
        if (!ticket) return false;

        ticket.discordThreadId = threadId;
        this.db.writeFlag(SavePriority.LOW);
        return true;
    }
}

// ── Backwards compat alias ──
export { TicketsDao as ReportsDao };
