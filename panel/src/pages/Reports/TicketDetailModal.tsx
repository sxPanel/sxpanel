import { useCallback, useEffect, useReducer, useRef, type ReactElement } from 'react';
import { copyToClipboard, createDuplicateKeyResolver } from '@/lib/utils';
import { useBackendApi } from '@/hooks/fetch';
import { useAdminPerms, useAuth } from '@/hooks/auth';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useOpenConfirmDialog } from '@/hooks/dialogs';
import {
    ArchiveIcon,
    Loader2Icon,
    SendIcon,
    TicketIcon,
    MessageSquareIcon,
    ScrollTextIcon,
    InfoIcon,
    LockIcon,
    CheckCircle2Icon,
    PlayIcon,
    CircleIcon,
    XCircleIcon,
    UserCheckIcon,
    TrashIcon,
    ImageIcon,
    CopyIcon,
    ExternalLinkIcon,
} from 'lucide-react';
import { txToast } from '@/components/TxToaster';
import { ClientDateText } from '@/components/ClientDateText';
import { useOpenPlayerModal } from '@/hooks/playerModal';
import type {
    ApiGetTicketDetailResp,
    ApiTicketDeleteResp,
    ApiTicketMessageResp,
    ApiTicketStatusResp,
    ApiTicketNoteResp,
    ApiTicketClaimResp,
    ApiTicketRetentionExclusionResp,
    DatabaseTicketType,
    MessageAuthorType,
    TicketStatus,
    TicketLogEntry,
    StaffNote,
    TicketMessage,
} from '@shared/ticketApiTypes';
import { useLocale } from '@/hooks/locale';

const statusVariants: Record<TicketStatus, 'default' | 'secondary' | 'outline-solid' | 'destructive'> = {
    open: 'destructive',
    inReview: 'default',
    resolved: 'secondary',
    closed: 'outline-solid',
};

function isAllowedImageUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

type TicketDetailState = {
    ticket: DatabaseTicketType | null;
    loading: boolean;
    messageText: string;
    imageUrlInput: string;
    sendingMessage: boolean;
    changingStatus: boolean;
    claiming: boolean;
    noteText: string;
    addingNote: boolean;
    deletingNoteId: string | null;
    deletingTicket: boolean;
    updatingRetentionExclusion: boolean;
    lightboxUrl: string | null;
};

type TicketDetailAction = Partial<TicketDetailState> | ((state: TicketDetailState) => Partial<TicketDetailState>);

const initialTicketDetailState: TicketDetailState = {
    ticket: null,
    loading: true,
    messageText: '',
    imageUrlInput: '',
    sendingMessage: false,
    changingStatus: false,
    claiming: false,
    noteText: '',
    addingNote: false,
    deletingNoteId: null,
    deletingTicket: false,
    updatingRetentionExclusion: false,
    lightboxUrl: null,
};

function reduceTicketDetailState(state: TicketDetailState, action: TicketDetailAction): TicketDetailState {
    return {
        ...state,
        ...(typeof action === 'function' ? action(state) : action),
    };
}

function ticketStatusLabel(t: (key: string) => string, status: TicketStatus) {
    const keys: Record<TicketStatus, string> = {
        open: 'panel.reports.status.open',
        inReview: 'panel.reports.status.in_review',
        resolved: 'panel.reports.status.resolved',
        closed: 'panel.reports.status.closed',
    };
    return t(keys[status]);
}

function TicketActionBar({
    ticket,
    claiming,
    changingStatus,
    deletingTicket,
    canManageTickets,
    onClaim,
    onStatusChange,
    onCopyLink,
    onDelete,
}: {
    ticket: DatabaseTicketType;
    claiming: boolean;
    changingStatus: boolean;
    deletingTicket: boolean;
    canManageTickets: boolean;
    onClaim: () => void;
    onStatusChange: (status: TicketStatus) => void;
    onCopyLink: () => void;
    onDelete: () => void;
}) {
    const { t } = useLocale();
    return (
        <div className="flex items-center gap-2 border-b pb-3">
            <Button
                size="sm"
                variant={ticket.claimedBy ? 'default' : 'outline-solid'}
                onClick={onClaim}
                disabled={claiming}
            >
                {claiming ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                ) : (
                    <UserCheckIcon className="mr-1 size-3.5" />
                )}
                {ticket.claimedBy
                    ? t('panel.reports.ticket_modal.claimed_by', { name: ticket.claimedBy })
                    : t('panel.reports.ticket_modal.claim')}
            </Button>

            <Select
                value={ticket.status}
                onValueChange={(v) => onStatusChange(v as TicketStatus)}
                disabled={changingStatus}
            >
                <SelectTrigger className="w-[140px]">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="open">{t('panel.reports.status.open')}</SelectItem>
                    <SelectItem value="inReview">{t('panel.reports.status.in_review')}</SelectItem>
                    <SelectItem value="resolved">{t('panel.reports.status.resolved')}</SelectItem>
                    <SelectItem value="closed">{t('panel.reports.status.closed')}</SelectItem>
                </SelectContent>
            </Select>

            <div className="flex-1" />

            <Button size="sm" variant="ghost" onClick={onCopyLink} title={t('panel.reports.ticket_modal.copy_link')}>
                <CopyIcon className="size-3.5" />
            </Button>

            {canManageTickets && (
                <Button size="sm" variant="ghost-destructive" onClick={onDelete} disabled={deletingTicket}>
                    {deletingTicket ? (
                        <Loader2Icon className="size-3.5 animate-spin" />
                    ) : (
                        <TrashIcon className="mr-1 size-3.5" />
                    )}
                    {t('panel.reports.ticket_modal.delete')}
                </Button>
            )}
        </div>
    );
}

function TicketTabs({
    ticket,
    isResolved,
    canManageTickets,
    messageText,
    imageUrlInput,
    sendingMessage,
    noteText,
    addingNote,
    deletingNoteId,
    updatingRetentionExclusion,
    formatDateTime,
    onScreenshotClick,
    onSendMessage,
    onMessageTextChange,
    onImageUrlInputChange,
    onImageClick,
    onAddNote,
    onNoteTextChange,
    onDeleteNote,
    onRetentionExclusionChange,
    onPlayerClick,
}: {
    ticket: DatabaseTicketType;
    isResolved: boolean;
    canManageTickets: boolean;
    messageText: string;
    imageUrlInput: string;
    sendingMessage: boolean;
    noteText: string;
    addingNote: boolean;
    deletingNoteId: string | null;
    updatingRetentionExclusion: boolean;
    formatDateTime: (ts: number) => string;
    onScreenshotClick: () => void;
    onSendMessage: () => void;
    onMessageTextChange: (value: string) => void;
    onImageUrlInputChange: (value: string) => void;
    onImageClick: (url: string) => void;
    onAddNote: () => void;
    onNoteTextChange: (value: string) => void;
    onDeleteNote: (noteId: string) => void;
    onRetentionExclusionChange: (excludeFromAutoDeletion: boolean) => void;
    onPlayerClick: (license: string) => void;
}) {
    const { t } = useLocale();
    return (
        <Tabs defaultValue="conversation" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="w-full">
                <TabsTrigger value="conversation" className="flex-1 gap-1">
                    <MessageSquareIcon className="size-3.5" />
                    {t('panel.reports.ticket_modal.tab_conversation')}
                </TabsTrigger>
                <TabsTrigger value="notes" className="flex-1 gap-1">
                    <LockIcon className="size-3.5" />
                    {t('panel.reports.ticket_modal.tab_staff_notes')}
                    {ticket.staffNotes?.length > 0 && (
                        <Badge variant="secondary" className="ml-1 px-1 text-[10px]">
                            {ticket.staffNotes.length}
                        </Badge>
                    )}
                </TabsTrigger>
                <TabsTrigger value="logs" className="flex-1 gap-1">
                    <ScrollTextIcon className="size-3.5" />
                    {t('panel.reports.ticket_modal.tab_logs')}
                </TabsTrigger>
                <TabsTrigger value="info" className="flex-1 gap-1">
                    <InfoIcon className="size-3.5" />
                    {t('panel.reports.ticket_modal.tab_info')}
                </TabsTrigger>
            </TabsList>

            <TabsContent value="conversation" className="mt-0 flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto px-1">
                    <div className="space-y-2 py-2">
                        {ticket.screenshotUrl && (
                            <div className="bg-muted/30 rounded-lg border p-2">
                                <p className="text-muted-foreground mb-1 text-xs">
                                    {t('panel.reports.ticket_modal.screenshot_label')}
                                </p>
                                <img
                                    src={ticket.screenshotUrl}
                                    alt={t('panel.reports.ticket_modal.screenshot_alt')}
                                    className="max-h-48 w-full cursor-zoom-in rounded object-contain"
                                    onClick={onScreenshotClick}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            if (event.key === ' ') event.preventDefault();
                                            onScreenshotClick();
                                        }
                                    }}
                                    role="button"
                                    tabIndex={0}
                                />
                            </div>
                        )}
                        <MessageBubble
                            author={ticket.reporter.name}
                            authorType="player"
                            content={ticket.description}
                            ts={ticket.tsCreated}
                            formatDateTime={formatDateTime}
                            isInitial
                        />
                        {ticket.messages.map((msg) => (
                            <MessageBubble
                                key={msg.id}
                                author={msg.author}
                                authorType={msg.authorType}
                                content={msg.content}
                                imageUrls={msg.imageUrls}
                                ts={msg.ts}
                                formatDateTime={formatDateTime}
                                onImageClick={onImageClick}
                            />
                        ))}
                        {ticket.messages.length === 0 && (
                            <p className="text-muted-foreground py-4 text-center text-sm">
                                {t('panel.reports.ticket_modal.no_replies')}
                            </p>
                        )}
                    </div>
                </div>

                {!isResolved && (
                    <div className="space-y-2 border-t pt-3">
                        <div className="flex gap-2">
                            <Input
                                placeholder={t('panel.reports.ticket_modal.reply_placeholder')}
                                value={messageText}
                                onChange={(e) => onMessageTextChange(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        onSendMessage();
                                    }
                                }}
                                maxLength={2048}
                            />
                            <Button
                                size="icon"
                                onClick={onSendMessage}
                                disabled={sendingMessage || (!messageText.trim() && !imageUrlInput.trim())}
                            >
                                {sendingMessage ? (
                                    <Loader2Icon className="size-4 animate-spin" />
                                ) : (
                                    <SendIcon className="size-4" />
                                )}
                            </Button>
                        </div>
                        <div className="flex items-center gap-2">
                            <ImageIcon className="text-muted-foreground size-3.5" />
                            <Input
                                placeholder={t('panel.reports.ticket_modal.image_url_placeholder')}
                                value={imageUrlInput}
                                onChange={(e) => onImageUrlInputChange(e.target.value)}
                                className="text-xs"
                            />
                        </div>
                    </div>
                )}
            </TabsContent>

            <TabsContent value="notes" className="mt-0 flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto px-1">
                    <div className="space-y-2 py-2">
                        {(ticket.staffNotes?.length ?? 0) === 0 && (
                            <p className="text-muted-foreground py-4 text-center text-sm">
                                {t('panel.reports.ticket_modal.no_staff_notes')}
                            </p>
                        )}
                        {(ticket.staffNotes ?? []).map((note) => (
                            <StaffNoteCard
                                key={note.id}
                                note={note}
                                formatDateTime={formatDateTime}
                                onDelete={() => onDeleteNote(note.id)}
                                deleting={deletingNoteId === note.id}
                            />
                        ))}
                    </div>
                </div>

                <div className="flex gap-2 border-t pt-3">
                    <Textarea
                        placeholder={t('panel.reports.ticket_modal.note_placeholder')}
                        value={noteText}
                        onChange={(e) => onNoteTextChange(e.target.value)}
                        rows={2}
                        maxLength={2048}
                        className="flex-1 resize-none text-sm"
                    />
                    <Button
                        size="icon"
                        onClick={onAddNote}
                        disabled={addingNote || !noteText.trim()}
                        className="self-end"
                    >
                        {addingNote ? <Loader2Icon className="size-4 animate-spin" /> : <SendIcon className="size-4" />}
                    </Button>
                </div>
            </TabsContent>

            <TabsContent value="logs" className="mt-0 min-h-0 flex-1">
                <div className="h-full overflow-y-auto">
                    <div className="space-y-3 py-2">
                        {(ticket.activityLog?.length ?? 0) > 0 && (
                            <ActivitySection entries={ticket.activityLog ?? []} />
                        )}
                        {ticket.logContext.reporter.length > 0 && (
                            <LogSection
                                title={t('panel.reports.ticket_modal.reporter_logs')}
                                entries={ticket.logContext.reporter}
                            />
                        )}
                        {ticket.logContext.targets.length > 0 && (
                            <LogSection
                                title={t('panel.reports.ticket_modal.target_logs')}
                                entries={ticket.logContext.targets}
                            />
                        )}
                        {ticket.logContext.world.length > 0 && (
                            <LogSection
                                title={t('panel.reports.ticket_modal.world_events')}
                                entries={ticket.logContext.world}
                            />
                        )}
                        {(ticket.activityLog?.length ?? 0) === 0 &&
                            ticket.logContext.reporter.length === 0 &&
                            ticket.logContext.targets.length === 0 &&
                            ticket.logContext.world.length === 0 && (
                                <p className="text-muted-foreground py-4 text-center text-sm">
                                    {t('panel.reports.ticket_modal.no_log_context')}
                                </p>
                            )}
                    </div>
                </div>
            </TabsContent>

            <TabsContent value="info" className="mt-0">
                <TicketInfoPanel
                    ticket={ticket}
                    canManageTickets={canManageTickets}
                    updatingRetentionExclusion={updatingRetentionExclusion}
                    formatDateTime={formatDateTime}
                    onRetentionExclusionChange={onRetentionExclusionChange}
                    onPlayerClick={onPlayerClick}
                />
            </TabsContent>
        </Tabs>
    );
}

function TicketInfoPanel({
    ticket,
    canManageTickets,
    updatingRetentionExclusion,
    formatDateTime,
    onRetentionExclusionChange,
    onPlayerClick,
}: {
    ticket: DatabaseTicketType;
    canManageTickets: boolean;
    updatingRetentionExclusion: boolean;
    formatDateTime: (ts: number) => string;
    onRetentionExclusionChange: (excludeFromAutoDeletion: boolean) => void;
    onPlayerClick: (license: string) => void;
}) {
    const { t } = useLocale();
    return (
        <div className="space-y-3 py-2">
            {canManageTickets && (
                <div className="bg-muted/30 flex items-center justify-between gap-4 rounded-lg border p-3">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm font-medium">
                            <ArchiveIcon className="size-4" />
                            {t('panel.reports.ticket_modal.exclude_auto_deletion')}
                        </div>
                        <p className="text-muted-foreground text-xs">
                            {t('panel.reports.ticket_modal.exclude_auto_deletion_desc')}
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <Badge variant={ticket.excludeFromAutoDeletion ? 'secondary' : 'outline-solid'}>
                            {ticket.excludeFromAutoDeletion
                                ? t('panel.reports.ticket_modal.excluded')
                                : t('panel.reports.ticket_modal.auto_delete')}
                        </Badge>
                        <Switch
                            checked={!!ticket.excludeFromAutoDeletion}
                            onCheckedChange={onRetentionExclusionChange}
                            disabled={updatingRetentionExclusion}
                        />
                    </div>
                </div>
            )}

            <InfoRow label={t('panel.reports.ticket_modal.info_category')} value={ticket.category} />
            {ticket.priority && (
                <InfoRow label={t('panel.reports.ticket_modal.info_priority')} value={ticket.priority.toUpperCase()} />
            )}
            <InfoRow label={t('panel.reports.ticket_modal.info_status')} value={ticketStatusLabel(t, ticket.status)} />
            <InfoRow label={t('panel.reports.ticket_modal.info_created')} value={formatDateTime(ticket.tsCreated)} />
            <InfoRow
                label={t('panel.reports.ticket_modal.info_last_activity')}
                value={formatDateTime(ticket.tsLastActivity)}
            />
            {ticket.tsResolved && (
                <InfoRow
                    label={t('panel.reports.ticket_modal.info_resolved')}
                    value={formatDateTime(ticket.tsResolved)}
                />
            )}
            {ticket.resolvedBy && (
                <InfoRow label={t('panel.reports.ticket_modal.info_resolved_by')} value={ticket.resolvedBy} />
            )}
            {ticket.claimedBy && (
                <InfoRow label={t('panel.reports.ticket_modal.info_claimed_by')} value={ticket.claimedBy} />
            )}
            {ticket.feedback && (
                <InfoRow
                    label={t('panel.reports.ticket_modal.info_feedback')}
                    value={`${'*'.repeat(ticket.feedback.rating)}${'-'.repeat(5 - ticket.feedback.rating)}${ticket.feedback.comment ? ` - ${ticket.feedback.comment}` : ''}`}
                />
            )}

            <div className="pt-2">
                <h4 className="mb-2 text-sm font-medium">{t('panel.reports.ticket_modal.reporter_heading')}</h4>
                <button
                    className="text-primary cursor-pointer text-sm hover:underline"
                    onClick={() => onPlayerClick(ticket.reporter.license)}
                >
                    {ticket.reporter.name}
                    {ticket.reporter.netid && ` (#${ticket.reporter.netid})`}
                </button>
                {ticket.reporter.discord && (
                    <p className="text-muted-foreground text-xs">
                        {t('panel.reports.ticket_modal.discord_id_label')}: {formatDiscordId(ticket.reporter.discord)}
                    </p>
                )}
            </div>

            {ticket.targets.length > 0 && (
                <div className="pt-1">
                    <h4 className="mb-2 text-sm font-medium">{t('panel.reports.ticket_modal.targets_heading')}</h4>
                    <div className="space-y-1">
                        {ticket.targets.map((target) => (
                            <div key={target.license}>
                                <button
                                    className="text-primary block cursor-pointer text-sm hover:underline"
                                    onClick={() => onPlayerClick(target.license)}
                                >
                                    {target.name}
                                    {target.netid && ` (#${target.netid})`}
                                </button>
                                {target.discord && (
                                    <p className="text-muted-foreground text-xs">
                                        {t('panel.reports.ticket_modal.discord_id_label')}:{' '}
                                        {formatDiscordId(target.discord)}
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {(ticket.nearbyPlayers ?? []).length > 0 && (
                <div className="pt-1">
                    <h4 className="mb-2 text-sm font-medium">
                        {t('panel.reports.ticket_modal.nearby_players_heading')}
                    </h4>
                    <p className="text-muted-foreground mb-2 text-xs">
                        {t('panel.reports.ticket_modal.nearby_players_desc')}
                    </p>
                    <div className="space-y-1">
                        {(ticket.nearbyPlayers ?? []).map((nearbyPlayer) => (
                            <div key={nearbyPlayer.license}>
                                <button
                                    className="text-primary block cursor-pointer text-sm hover:underline"
                                    onClick={() => onPlayerClick(nearbyPlayer.license)}
                                >
                                    {nearbyPlayer.name}
                                    {nearbyPlayer.netid && ` (#${nearbyPlayer.netid})`}
                                </button>
                                {nearbyPlayer.discord && (
                                    <p className="text-muted-foreground text-xs">
                                        {t('panel.reports.ticket_modal.discord_id_label')}:{' '}
                                        {formatDiscordId(nearbyPlayer.discord)}
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * Strips the "discord:" prefix from a stored discord identifier for display.
 */
function formatDiscordId(discordId: string) {
    return discordId.startsWith('discord:') ? discordId.slice('discord:'.length) : discordId;
}

function TicketLightbox({ url, onClose }: { url: string | null; onClose: () => void }) {
    const { t } = useLocale();
    if (!url) return null;

    return (
        <Dialog open onOpenChange={onClose}>
            <DialogContent className="flex max-h-[95vh] max-w-5xl items-center justify-center bg-black/90 p-2">
                <img
                    src={url}
                    alt={t('panel.reports.ticket_modal.lightbox_alt')}
                    referrerPolicy="no-referrer"
                    className="max-h-[90vh] max-w-full rounded object-contain"
                    onError={onClose}
                />
            </DialogContent>
        </Dialog>
    );
}

export default function TicketDetailModal({
    ticketId,
    open,
    onOpenChange,
}: {
    ticketId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const [state, dispatch] = useReducer(reduceTicketDetailState, initialTicketDetailState);
    const {
        ticket,
        loading,
        messageText,
        imageUrlInput,
        sendingMessage,
        changingStatus,
        claiming,
        noteText,
        addingNote,
        deletingNoteId,
        deletingTicket,
        updatingRetentionExclusion,
        lightboxUrl,
    } = state;
    const surrogateRef = useRef<HTMLDivElement>(null);
    const openPlayerModal = useOpenPlayerModal();
    const openConfirmDialog = useOpenConfirmDialog();
    const { hasPerm } = useAdminPerms();
    const { authData } = useAuth();
    const { t } = useLocale();

    const detailApi = useBackendApi<ApiGetTicketDetailResp>({
        method: 'GET',
        path: '/reports/detail',
        abortOnUnmount: true,
    });
    const messageApi = useBackendApi<ApiTicketMessageResp>({ method: 'POST', path: '/reports/message' });
    const statusApi = useBackendApi<ApiTicketStatusResp>({ method: 'POST', path: '/reports/status' });
    const claimApi = useBackendApi<ApiTicketClaimResp>({ method: 'POST', path: '/reports/claim' });
    const noteApi = useBackendApi<ApiTicketNoteResp>({ method: 'POST', path: '/reports/note' });
    const noteDeleteApi = useBackendApi<ApiTicketNoteResp>({ method: 'DELETE', path: '/reports/note' });
    const deleteApi = useBackendApi<ApiTicketDeleteResp>({ method: 'DELETE', path: '/reports/delete' });
    const retentionExclusionApi = useBackendApi<ApiTicketRetentionExclusionResp>({
        method: 'POST',
        path: '/reports/retention-exclusion',
    });

    // Tracks the latest in-flight fetchTicket invocation so callbacks from
    // stale requests (e.g. modal closed / ticketId changed) are ignored.
    const fetchSeqRef = useRef(0);

    const fetchTicket = useCallback(() => {
        const seq = ++fetchSeqRef.current;
        dispatch({ loading: true });
        detailApi({
            queryParams: { id: ticketId },
            success: (data) => {
                if (seq !== fetchSeqRef.current) return;
                if ('ticket' in data) dispatch({ ticket: data.ticket });
            },
            error: (msg) => {
                if (seq !== fetchSeqRef.current) return;
                txToast.error(msg);
            },
            finally: () => {
                if (seq !== fetchSeqRef.current) return;
                dispatch({ loading: false });
            },
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ticketId]);

    useEffect(() => {
        if (open) fetchTicket();
        return () => {
            // Invalidate any in-flight request so its callbacks become no-ops
            // when the modal closes or the ticket changes.
            fetchSeqRef.current++;
        };
    }, [open, ticketId]);

    const handleSendMessage = () => {
        const hasContent = messageText.trim().length > 0;
        const hasImage = imageUrlInput.trim().length > 0;
        if (!hasContent && !hasImage) return;
        dispatch({ sendingMessage: true });
        const imageUrls = imageUrlInput.trim() ? [imageUrlInput.trim()] : undefined;
        messageApi({
            data: { id: ticketId, content: messageText.trim(), imageUrls },
            success: () => {
                dispatch({ messageText: '', imageUrlInput: '' });
                fetchTicket();
            },
            error: (msg) => txToast.error(msg),
            finally: () => dispatch({ sendingMessage: false }),
        });
    };

    const handleStatusChange = (status: TicketStatus) => {
        dispatch({ changingStatus: true });
        statusApi({
            data: { id: ticketId, status },
            success: () => fetchTicket(),
            error: (msg) => txToast.error(msg),
            finally: () => dispatch({ changingStatus: false }),
        });
    };

    const handleClaim = () => {
        dispatch({ claiming: true });
        claimApi({
            data: { id: ticketId },
            success: () => fetchTicket(),
            error: (msg) => txToast.error(msg),
            finally: () => dispatch({ claiming: false }),
        });
    };

    const handleAddNote = () => {
        if (!noteText.trim()) return;
        dispatch({ addingNote: true });
        noteApi({
            data: { id: ticketId, content: noteText.trim() },
            success: () => {
                dispatch({ noteText: '' });
                fetchTicket();
            },
            error: (msg) => txToast.error(msg),
            finally: () => dispatch({ addingNote: false }),
        });
    };

    const handleDeleteNote = (noteId: string) => {
        dispatch({ deletingNoteId: noteId });
        noteDeleteApi({
            data: { id: ticketId, noteId },
            success: () => fetchTicket(),
            error: (msg) => txToast.error(msg),
            finally: () => dispatch({ deletingNoteId: null }),
        });
    };

    const handleDeleteTicket = () => {
        dispatch({ deletingTicket: true });
        deleteApi({
            data: { id: ticketId },
            success: () => {
                txToast.success(t('panel.reports.ticket_modal.deleted_toast'));
                onOpenChange(false);
            },
            error: (msg) => txToast.error(msg),
            finally: () => dispatch({ deletingTicket: false }),
        });
    };

    const handleRetentionExclusionChange = (excludeFromAutoDeletion: boolean) => {
        dispatch({ updatingRetentionExclusion: true });
        retentionExclusionApi({
            data: { id: ticketId, excludeFromAutoDeletion },
            success: () => {
                const tsNow = Math.floor(Date.now() / 1000);
                dispatch((current) => ({
                    ticket: current.ticket
                        ? {
                              ...current.ticket,
                              excludeFromAutoDeletion,
                              tsLastActivity: tsNow,
                              activityLog: [
                                  ...(current.ticket.activityLog ?? []),
                                  {
                                      ts: tsNow,
                                      adminName:
                                          authData && typeof authData === 'object' ? authData.name : 'current admin',
                                      action: excludeFromAutoDeletion
                                          ? 'auto_delete_excluded'
                                          : 'auto_delete_reenabled',
                                  },
                              ],
                          }
                        : current.ticket,
                }));
                txToast.success(
                    excludeFromAutoDeletion
                        ? t('panel.reports.ticket_modal.excluded_toast')
                        : t('panel.reports.ticket_modal.reenabled_toast'),
                );
            },
            error: (msg) => txToast.error(msg),
            finally: () => dispatch({ updatingRetentionExclusion: false }),
        });
    };

    const formatDateTime = (ts: number) => {
        const d = new Date(ts * 1000);
        return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    const handlePlayerClick = (license: string) => {
        onOpenChange(false);
        openPlayerModal({ license });
    };

    const copyTicketLink = () => {
        const url = `${window.location.origin}/reports?ticket=${ticketId}`;
        copyToClipboard(url, surrogateRef.current ?? (document.body as unknown as HTMLDivElement)).then(
            () => txToast.success(t('panel.reports.ticket_modal.link_copied')),
            () => txToast.error(t('panel.reports.ticket_modal.link_copy_failed')),
        );
    };

    const isResolved = ticket?.status === 'resolved' || ticket?.status === 'closed';
    const canManageTickets = hasPerm('manage_tickets');

    const confirmDeleteTicket = () => {
        openConfirmDialog({
            title: t('panel.reports.ticket_modal.delete_title'),
            message: t('panel.reports.ticket_modal.delete_message', { id: ticketId }),
            actionLabel: t('panel.reports.ticket_modal.delete_action'),
            confirmBtnVariant: 'destructive',
            onConfirm: handleDeleteTicket,
        });
    };

    return (
        <>
            <div
                ref={surrogateRef}
                style={{ position: 'fixed', top: 0, left: 0, width: 0, height: 0, overflow: 'hidden' }}
                aria-hidden
            />
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="flex max-h-[88vh] max-w-2xl flex-col overflow-hidden">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <TicketIcon className="size-5" />
                            {t('panel.reports.ticket_modal.title', { id: ticketId })}
                            {ticket && (
                                <Badge variant={statusVariants[ticket.status]} className="ml-1">
                                    {ticketStatusLabel(t, ticket.status)}
                                </Badge>
                            )}
                        </DialogTitle>
                    </DialogHeader>

                    {ticket && (
                        <TicketActionBar
                            ticket={ticket}
                            claiming={claiming}
                            changingStatus={changingStatus}
                            deletingTicket={deletingTicket}
                            canManageTickets={canManageTickets}
                            onClaim={handleClaim}
                            onStatusChange={handleStatusChange}
                            onCopyLink={copyTicketLink}
                            onDelete={confirmDeleteTicket}
                        />
                    )}

                    {loading ? (
                        <div className="flex justify-center py-8">
                            <Loader2Icon className="text-muted-foreground size-6 animate-spin" />
                        </div>
                    ) : !ticket ? (
                        <p className="text-destructive py-8 text-center">{t('panel.reports.ticket_modal.not_found')}</p>
                    ) : (
                        <TicketTabs
                            ticket={ticket}
                            isResolved={isResolved}
                            canManageTickets={canManageTickets}
                            messageText={messageText}
                            imageUrlInput={imageUrlInput}
                            sendingMessage={sendingMessage}
                            noteText={noteText}
                            addingNote={addingNote}
                            deletingNoteId={deletingNoteId}
                            updatingRetentionExclusion={updatingRetentionExclusion}
                            formatDateTime={formatDateTime}
                            onScreenshotClick={() => dispatch({ lightboxUrl: ticket.screenshotUrl! })}
                            onSendMessage={handleSendMessage}
                            onMessageTextChange={(messageText) => dispatch({ messageText })}
                            onImageUrlInputChange={(imageUrlInput) => dispatch({ imageUrlInput })}
                            onImageClick={(lightboxUrl) => dispatch({ lightboxUrl })}
                            onAddNote={handleAddNote}
                            onNoteTextChange={(noteText) => dispatch({ noteText })}
                            onDeleteNote={handleDeleteNote}
                            onRetentionExclusionChange={handleRetentionExclusionChange}
                            onPlayerClick={handlePlayerClick}
                        />
                    )}
                </DialogContent>
            </Dialog>

            <TicketLightbox url={lightboxUrl} onClose={() => dispatch({ lightboxUrl: null })} />
        </>
    );
}

// Sub-components

function MessageBubble({
    author,
    authorType,
    content,
    imageUrls,
    ts,
    formatDateTime,
    isInitial = false,
    onImageClick,
}: {
    author: string;
    authorType: MessageAuthorType;
    content: string;
    imageUrls?: string[];
    ts: number;
    formatDateTime: (ts: number) => string;
    isInitial?: boolean;
    onImageClick?: (url: string) => void;
}) {
    const { t } = useLocale();
    const getImageKey = createDuplicateKeyResolver();

    return (
        <div
            className={`rounded-lg p-3 ${
                authorType === 'admin' ? 'bg-primary/10 border-primary/20 ml-4 border' : 'bg-muted/50 mr-4'
            } ${isInitial ? 'border-2' : ''}`}
        >
            <div className="mb-1 flex items-center gap-2">
                <span className="text-sm font-medium">{author}</span>
                <Badge variant="outline" className="px-1 py-0 text-[10px]">
                    {isInitial ? t('panel.reports.ticket_modal.badge_original') : authorType}
                </Badge>
                <span className="text-muted-foreground text-xs">{formatDateTime(ts)}</span>
            </div>
            {content && content.trim().length > 0 && <p className="text-sm whitespace-pre-wrap">{content}</p>}
            {imageUrls && imageUrls.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                    {imageUrls.reduce<ReactElement[]>((images, url) => {
                        if (!isAllowedImageUrl(url)) {
                            return images;
                        }

                        const attachmentNumber = images.length + 1;
                        images.push(
                            <img
                                key={getImageKey(url)}
                                src={url}
                                alt={t('panel.reports.ticket_modal.attachment_alt', { number: attachmentNumber })}
                                referrerPolicy="no-referrer"
                                className="max-h-32 cursor-zoom-in rounded border object-contain"
                                onClick={() => onImageClick?.(url)}
                                onKeyDown={(event) => {
                                    if ((event.key === 'Enter' || event.key === ' ') && onImageClick) {
                                        if (event.key === ' ') event.preventDefault();
                                        onImageClick(url);
                                    }
                                }}
                                onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                }}
                                role="button"
                                tabIndex={0}
                            />,
                        );

                        return images;
                    }, [])}
                </div>
            )}
        </div>
    );
}

function StaffNoteCard({
    note,
    formatDateTime,
    onDelete,
    deleting,
}: {
    note: StaffNote;
    formatDateTime: (ts: number) => string;
    onDelete: () => void;
    deleting: boolean;
}) {
    return (
        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3">
            <div className="mb-1 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <LockIcon className="size-3 text-yellow-500" />
                    <span className="text-sm font-medium">{note.authorName}</span>
                    <span className="text-muted-foreground text-xs">{formatDateTime(note.ts)}</span>
                </div>
                <Button
                    size="icon"
                    variant="ghost"
                    className="text-destructive size-6"
                    onClick={onDelete}
                    disabled={deleting}
                >
                    {deleting ? <Loader2Icon className="size-3.5 animate-spin" /> : <TrashIcon className="size-3.5" />}
                </Button>
            </div>
            <p className="text-sm whitespace-pre-wrap">{note.content}</p>
        </div>
    );
}

function LogSection({ title, entries }: { title: string; entries: TicketLogEntry[] }) {
    return (
        <div>
            <h4 className="text-muted-foreground mb-1.5 text-xs font-medium">{title}</h4>
            <div className="bg-muted/30 space-y-0.5 rounded-lg border p-2">
                {entries.map((entry) => {
                    return (
                        <div
                            key={`${entry.ts}-${entry.type}-${entry.src.id || entry.src.name}-${entry.msg}`}
                            className="flex gap-2 font-mono text-xs"
                        >
                            <ClientDateText
                                className="text-muted-foreground shrink-0"
                                timestamp={entry.ts * 1000}
                                formatter={(date) =>
                                    date.toLocaleTimeString([], {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        second: '2-digit',
                                    })
                                }
                            />
                            <span className="text-muted-foreground shrink-0">[{entry.type}]</span>
                            {entry.src.name && <span className="text-foreground/70 shrink-0">{entry.src.name}</span>}
                            <span className="truncate">{entry.msg}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function ActivitySection({ entries }: { entries: DatabaseTicketType['activityLog'] }) {
    const { t } = useLocale();
    return (
        <div>
            <h4 className="text-muted-foreground mb-1.5 text-xs font-medium">
                {t('panel.reports.ticket_modal.activity_heading')}
            </h4>
            <div className="bg-muted/30 space-y-0.5 rounded-lg border p-2">
                {entries.map((entry) => {
                    const actionLabel = entry.action.replace(/_/g, ' ');
                    return (
                        <div
                            key={`${entry.ts}-${entry.adminName}-${entry.action}-${entry.details ?? ''}`}
                            className="flex gap-2 font-mono text-xs"
                        >
                            <ClientDateText
                                className="text-muted-foreground shrink-0"
                                timestamp={entry.ts * 1000}
                                formatter={(date) =>
                                    date.toLocaleTimeString([], {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        second: '2-digit',
                                    })
                                }
                            />
                            <span className="text-muted-foreground shrink-0">[activity]</span>
                            <span className="text-foreground/70 shrink-0">{entry.adminName}</span>
                            <span className="truncate">
                                {entry.details ? `${actionLabel}: ${entry.details}` : actionLabel}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function InfoRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center gap-2">
            <span className="text-muted-foreground min-w-[120px] text-sm">{label}:</span>
            <span className="text-sm">{value}</span>
        </div>
    );
}
