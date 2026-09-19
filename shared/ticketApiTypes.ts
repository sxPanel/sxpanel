/**
 * Shared types for the Ticket/Report system.
 */

// ── Ticket Priority ──
export const ticketPriorities = ['low', 'medium', 'high', 'critical'] as const;
export type TicketPriority = (typeof ticketPriorities)[number];

export const ticketPriorityLabels: Record<TicketPriority, string> = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    critical: 'Critical',
};

// ── Ticket Status ──
export const ticketStatuses = ['open', 'inReview', 'resolved', 'closed'] as const;
export type TicketStatus = (typeof ticketStatuses)[number];

export const ticketStatusLabels: Record<TicketStatus, string> = {
    open: 'Open',
    inReview: 'In Review',
    resolved: 'Resolved',
    closed: 'Closed',
};

export type MessageAuthorType = 'player' | 'admin' | 'discord';

// ── Ticket message ──
export type TicketMessage = {
    id: string;
    author: string;
    authorType: MessageAuthorType;
    content: string;
    imageUrls?: string[];
    ts: number;
};

// ── Staff note ──
export type StaffNote = {
    id: string;
    authorAdminId: string;
    authorName: string;
    content: string;
    ts: number;
};

// ── Player feedback ──
export type PlayerFeedback = {
    rating: 1 | 2 | 3 | 4 | 5;
    comment?: string;
    ts: number;
};

// ── Log entry ──
export type TicketLogEntry = {
    ts: number;
    type: string;
    src: { id: string | false; name: string };
    msg: string;
};

// ── Player ref ──
export type TicketPlayerRef = {
    license: string;
    discord?: string;
    name: string;
    netid?: number;
};

// ── Log context ──
export type TicketLogContext = {
    reporter: TicketLogEntry[];
    targets: TicketLogEntry[];
    world: TicketLogEntry[];
};

// ── Activity entry (ticket audit trail) ──
export type TicketActivityEntry = {
    ts: number;
    adminName: string;
    action: string;
    details?: string;
};

// ── Core DB record ──
export type DatabaseTicketType = {
    id: string; // format: TKT-XXXXX
    status: TicketStatus;
    category: string; // free-form, from config's ticketCategories
    priority?: TicketPriority; // undefined when priority is disabled in config
    reporter: TicketPlayerRef;
    targets: TicketPlayerRef[];
    nearbyPlayers: TicketPlayerRef[]; // players near the reporter at submission time (player reports only)
    description: string; // replaces 'reason'
    screenshotUrl?: string;
    messages: TicketMessage[];
    staffNotes: StaffNote[];
    activityLog: TicketActivityEntry[];
    feedback?: PlayerFeedback;
    logContext: TicketLogContext;
    claimedBy?: string;
    excludeFromAutoDeletion?: boolean;
    resolvedBy?: string;
    discordThreadId?: string;
    tsCreated: number;
    tsLastActivity: number;
    tsResolved?: number;
};

// ── API response types ──

// GET /reports/list
export type TicketListItem = {
    id: string;
    status: TicketStatus;
    category: string;
    priority?: TicketPriority;
    reporterName: string;
    targetNames: string[];
    descriptionPreview: string;
    claimedBy?: string;
    messageCount: number;
    hasUnreadStaffNotes: boolean;
    tsCreated: number;
    tsLastActivity: number;
};
export type ApiGetTicketListResp = { tickets: TicketListItem[] } | { error: string };

// GET /reports/detail?id=xxx
export type ApiGetTicketDetailResp = { ticket: DatabaseTicketType } | { error: string };

// GET /reports/config
export type ApiGetTicketConfigResp =
    | {
          categories: string[];
          categoryDescriptions: Record<string, string>;
          priorityEnabled: boolean;
          feedbackEnabled: boolean;
      }
    | { error: string };

// POST /reports/message
export type ApiTicketMessageReq = {
    id: string;
    content: string;
    imageUrls?: string[];
};
export type ApiTicketMessageResp = { success: true } | { error: string };

// POST /reports/note
export type ApiTicketNoteReq = { id: string; content: string };
export type ApiTicketNoteDeleteReq = { id: string; noteId: string };
export type ApiTicketNoteResp = { success: true } | { error: string };

// DELETE /reports/delete
export type ApiTicketDeleteReq = { id: string };
export type ApiTicketDeleteResp = { success: true } | { error: string };

// POST /reports/retention-exclusion
export type ApiTicketRetentionExclusionReq = { id: string; excludeFromAutoDeletion: boolean };
export type ApiTicketRetentionExclusionResp = { success: true; excludeFromAutoDeletion: boolean } | { error: string };

// POST /reports/status
export type ApiTicketStatusReq = { id: string; status: TicketStatus };
export type ApiTicketStatusResp = { success: true } | { error: string };

// POST /reports/claim
export type ApiTicketClaimReq = { id: string };
export type ApiTicketClaimResp =
    | { success: true; claimedBy: string } // claim succeeded
    | { success: true; claimedBy: null } // unclaim succeeded
    | { error: string };

// GET /reports/analytics
export type TicketAnalyticsSummary = {
    overview: {
        total: number;
        open: number;
        inReview: number;
        resolved: number;
        closed: number;
        avgResolutionMs: number;
    };
    byCategory: { category: string; count: number }[];
    byPriority: { priority: TicketPriority; count: number }[];
    timelineDays: { date: string; created: number; resolved: number }[];
    leaderboard: { adminName: string; resolved: number; avgResolutionMs: number }[];
    staffMetrics: {
        ticketsCreated: number;
        claimedTickets: number;
        respondedTickets: number;
        resolvedTickets: number;
        reopenedTickets: number;
        avgTimeToClaimMs: number;
        avgFirstStaffResponseMs: number;
        avgResolutionMs: number;
        reopenRate: number;
    };
    rollups: {
        '7d': {
            ticketsCreated: number;
            ticketsResolved: number;
            resolutionRate: number;
            avgTimeToClaimMs: number;
            avgFirstStaffResponseMs: number;
            avgResolutionMs: number;
            reopenRate: number;
        };
        '30d': {
            ticketsCreated: number;
            ticketsResolved: number;
            resolutionRate: number;
            avgTimeToClaimMs: number;
            avgFirstStaffResponseMs: number;
            avgResolutionMs: number;
            reopenRate: number;
        };
    };
};

export type ApiGetAnalyticsResp = TicketAnalyticsSummary | { error: string };

// ── NUI-facing intercom types (player) ──

export type IntercomTicketCreateReq = {
    reporter: { name: string; license: string; discord?: string; netid: number };
    targets: TicketPlayerRef[];
    nearbyPlayers?: TicketPlayerRef[];
    category: string;
    priority?: TicketPriority;
    description: string;
    imageUrls?: string[];
    screenshotData?: string;
};

export type IntercomFeedbackReq = {
    ticketId: string;
    reporterLicense: string;
    rating: 1 | 2 | 3 | 4 | 5;
    comment?: string;
};

export type PlayerTicketSummary = {
    id: string;
    status: TicketStatus;
    category: string;
    descriptionPreview: string;
    messageCount: number;
    unreadCount: number;
    tsCreated: number;
    awaitingFeedback?: boolean;
};

export type ApiGetPlayerTicketsResp = { tickets: PlayerTicketSummary[] } | { error: string };

// ── Intercom ticket create response ──
export type ApiCreateTicketResp = { ticketId: string } | { error: string };

// ── Backwards compat aliases (deprecated) ──
/** @deprecated Use TicketPlayerRef */
export type ReportPlayerRef = TicketPlayerRef;
/** @deprecated Use TicketLogEntry */
export type ReportLogEntry = TicketLogEntry;
/** @deprecated Use TicketMessage */
export type ReportMessage = TicketMessage;
/** @deprecated Use TicketStatus */
export type ReportStatus = TicketStatus;
/** @deprecated Use ticketStatuses */
export const reportStatuses = ticketStatuses;
/**
 * @deprecated Use {@link TicketPriority} instead.
 *
 * Legacy report-type discriminator. The previous model classified reports by
 * *category* (`'playerReport' | 'bugReport' | 'question'`) and this alias is
 * intentionally widened to `string` so old call sites still type-check, but it
 * NO LONGER carries the original literal-union semantics. New code must
 * classify tickets by *priority* via {@link TicketPriority} (`'low' | 'medium'
 * | 'high' | 'critical'`) and route categorisation through the dedicated
 * `category` field on `DatabaseTicketType`.
 *
 * Migration mapping (suggested defaults):
 *   - `'playerReport'` → priority `'high'`,   category `'player-report'`
 *   - `'bugReport'`    → priority `'medium'`, category `'bug-report'`
 *   - `'question'`     → priority `'low'`,    category `'question'`
 */
export type ReportType = string;
/**
 * @deprecated Use {@link ticketPriorities} instead.
 *
 * Legacy report-type values. These are the ORIGINAL category strings — they
 * are *not* aligned with {@link ticketPriorities} (`['low','medium','high',
 * 'critical']`) and must not be used as priorities. Kept here only so existing
 * consumers that imported `reportTypes` continue to compile. See {@link
 * ReportType} above for the migration mapping.
 */
export const reportTypes = ['playerReport', 'bugReport', 'question'] as const;
/** @deprecated Use DatabaseTicketType */
export type DatabaseReportType = DatabaseTicketType;
// Legacy list/detail aliases
/** @deprecated Use TicketListItem instead */
export type ReportListItem = TicketListItem;
/** @deprecated Use ApiGetTicketListResp instead */
export type ApiGetReportsListResp = ApiGetTicketListResp;
/** @deprecated Use ApiGetTicketDetailResp instead */
export type ApiGetReportDetailResp = ApiGetTicketDetailResp;
/** @deprecated Use ApiTicketMessageResp instead */
export type ApiReportMessageResp = ApiTicketMessageResp;
/** @deprecated Use ApiTicketStatusResp instead */
export type ApiReportStatusResp = ApiTicketStatusResp;
/** @deprecated Use PlayerTicketSummary instead */
export type PlayerReportSummary = PlayerTicketSummary;
/** @deprecated Use ApiGetPlayerTicketsResp instead */
export type ApiGetPlayerReportsResp = ApiGetPlayerTicketsResp;
/** @deprecated Use IntercomTicketCreateReq instead */
export type ApiCreateReportReq = IntercomTicketCreateReq;
/** @deprecated Use ApiCreateTicketResp instead */
export type ApiCreateReportResp = ApiCreateTicketResp;
/** @deprecated Use ApiTicketMessageReq instead */
export type ApiReportMessageReq = ApiTicketMessageReq;
/** @deprecated Use ApiTicketStatusReq instead */
export type ApiReportStatusReq = ApiTicketStatusReq;
