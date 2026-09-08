import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { alpha, styled } from '@mui/material/styles';
import {
    Box,
    Button,
    Chip,
    FormControl,
    IconButton,
    InputAdornment,
    InputLabel,
    MenuItem,
    Select,
    TextField,
    Tooltip,
    Typography,
    useTheme,
} from '@mui/material';
import {
    CheckCircle,
    Close,
    Inbox,
    LockOutlined,
    PlayArrow,
    RadioButtonUnchecked,
    Refresh,
    Search,
    Send,
} from '@mui/icons-material';
import { useNuiEvent } from '../../hooks/useNuiEvent';
import { fetchNui } from '../../utils/fetchNui';
import { txAdminMenuPage, usePageValue } from '../../state/page.state';
import type { MenuTokens } from '../../styles/theme';
import { useTranslate } from 'react-polyglot';
import { translateTicketError } from '../../utils/translateTicketError';

// =============================================
// Types
// =============================================

/** Allow HTTPS image URLs from any host that serve a known image file extension. */
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
function validateImageUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:') return false;
        const pathname = parsed.pathname.toLowerCase();
        return IMAGE_EXTENSIONS.some((ext) => pathname.endsWith(ext));
    } catch {
        return false;
    }
}

type TicketStatus = 'open' | 'inReview' | 'resolved' | 'closed';

interface TicketPlayerRef {
    license: string;
    name: string;
    netid: number;
}

interface TicketMessage {
    id?: string;
    author: string;
    authorType: 'player' | 'admin' | 'discord';
    content: string;
    ts: number;
    imageUrls?: string[];
}

interface TicketListItem {
    id: string;
    category: string;
    priority?: string;
    status: TicketStatus;
    reporterName: string;
    targetNames: string[];
    descriptionPreview: string;
    messageCount: number;
    unreadCount?: number;
    tsCreated: number;
    tsLastActivity: number;
    claimedBy?: string | null;
}

interface TicketDetail {
    id: string;
    category: string;
    priority?: string;
    status: TicketStatus;
    reporter: TicketPlayerRef;
    targets: TicketPlayerRef[];
    description: string;
    messages: TicketMessage[];
    tsCreated: number;
    tsResolved?: number | null;
    resolvedBy?: string | null;
    claimedBy?: string | null;
}

// =============================================
// Styles
// =============================================

const RootStyled = styled(Box)(({ theme }) => ({
    backgroundColor: theme.tokens.surface,
    border: `1px solid ${theme.tokens.border}`,
    color: theme.tokens.textPrimary,
    height: '52vh',
    minHeight: 380,
    minWidth: 0,
    boxSizing: 'border-box',
    borderRadius: theme.tokens.radiusCard,
    flex: 1,
    flexDirection: 'column',
    overflow: 'hidden',
}));

const DashboardBody = styled(Box)({
    display: 'flex',
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    gap: 0,
    '@media (max-width: 760px)': {
        flexDirection: 'column',
    },
});

const Sidebar = styled(Box)(({ theme }) => ({
    display: 'flex',
    flexDirection: 'column',
    flex: '0 0 34%',
    minWidth: 240,
    maxWidth: 300,
    minHeight: 0,
    boxSizing: 'border-box',
    borderRight: `1px solid ${theme.tokens.border}`,
    paddingRight: 12,
    '@media (max-width: 760px)': {
        flex: '0 0 auto',
        minWidth: 0,
        maxWidth: 'none',
        borderRight: 0,
        borderBottom: `1px solid ${theme.tokens.border}`,
        paddingRight: 0,
        paddingBottom: 12,
        marginBottom: 12,
    },
}));

const DetailPane = styled(Box)(({ theme }) => ({
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    paddingLeft: 16,
    backgroundColor: alpha(theme.tokens.surfaceRaised, 0.35),
    borderRadius: theme.tokens.radiusRow,
}));

const ListContainer = styled(Box)({
    flex: 1,
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    paddingRight: 2,
});

const SegmentedBar = styled(Box)(({ theme }) => ({
    display: 'flex',
    gap: 4,
    padding: 3,
    marginBottom: 10,
    minWidth: 0,
    borderRadius: theme.tokens.radiusPill,
    backgroundColor: theme.tokens.surfaceRaised,
    border: `1px solid ${theme.tokens.border}`,
}));

interface SegmentButtonProps {
    active: boolean;
}

const SegmentButton = styled(Box, {
    shouldForwardProp: (prop) => prop !== 'active',
})<SegmentButtonProps>(({ theme, active }) => ({
    flex: 1,
    minWidth: 0,
    textAlign: 'center',
    padding: '6px 8px',
    borderRadius: theme.tokens.radiusPill,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: active ? theme.tokens.accentContrast : theme.tokens.textMuted,
    backgroundColor: active ? theme.tokens.accent : 'transparent',
    transition: 'background-color 120ms ease, color 120ms ease',
    '&:hover': {
        color: active ? theme.tokens.accentContrast : theme.tokens.textPrimary,
        backgroundColor: active ? theme.tokens.accent : theme.tokens.surfaceHover,
    },
}));

const StatCard = styled(Box)(({ theme }) => ({
    flex: 1,
    minWidth: 0,
    padding: '8px 10px',
    borderRadius: theme.tokens.radiusRow,
    border: `1px solid ${theme.tokens.border}`,
    backgroundColor: theme.tokens.surfaceRaised,
}));

const boundedTextSx = {
    minWidth: 0,
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
} as const;

const ellipsisTextSx = {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
} as const;

// =============================================
// Helpers
// =============================================

const getStatusChipColors = (
    tokens: MenuTokens,
): Record<TicketStatus, { bg: string; border: string; text: string }> => ({
    open: { bg: alpha(tokens.warning, 0.12), border: tokens.warning, text: tokens.warning },
    inReview: { bg: alpha(tokens.info, 0.12), border: tokens.info, text: tokens.info },
    resolved: { bg: alpha(tokens.success, 0.12), border: tokens.success, text: tokens.success },
    closed: { bg: alpha(tokens.textMuted, 0.12), border: tokens.textMuted, text: tokens.textMuted },
});

function formatDate(ts: number): string {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatRelativeTime(ts: number, t: (key: string, options?: Record<string, unknown>) => string): string {
    const diffSec = Math.floor(Date.now() / 1000 - ts);
    if (diffSec < 60) return t('nui_reports.just_now');
    if (diffSec < 3600) return t('nui_reports.time_minutes_ago', { count: Math.floor(diffSec / 60) });
    if (diffSec < 86400) return t('nui_reports.time_hours_ago', { count: Math.floor(diffSec / 3600) });
    return t('nui_reports.time_days_ago', { count: Math.floor(diffSec / 86400) });
}

function getStatusAccentColor(status: TicketStatus, tokens: MenuTokens): string {
    const map: Record<TicketStatus, string> = {
        open: tokens.warning,
        inReview: tokens.info,
        resolved: tokens.success,
        closed: tokens.textMuted,
    };
    return map[status];
}

// =============================================
// Status Chip
// =============================================

const StatusChip: React.FC<{ status: TicketStatus }> = ({ status }) => {
    const t = useTranslate();
    const { tokens } = useTheme();
    const statusKey =
        status === 'inReview'
            ? 'in_review'
            : status === 'open'
              ? 'open'
              : status === 'resolved'
                ? 'resolved'
                : 'closed';
    const label = t(`discord_bot.tickets.status_labels.${statusKey}`);
    const colors = getStatusChipColors(tokens)[status];
    return (
        <Chip
            label={label}
            size="small"
            variant="outlined"
            sx={{
                height: 20,
                fontSize: '0.7rem',
                color: colors.text,
                borderColor: colors.border,
                bgcolor: colors.bg,
                maxWidth: '100%',
                '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' },
            }}
        />
    );
};

// =============================================
// Detail View
// =============================================

const TicketDetailView: React.FC<{
    ticket: TicketDetail;
    onSendMessage: (content: string) => void;
    onStatusChange: (status: TicketStatus) => void;
    sendingMessage: boolean;
    changingStatus: boolean;
}> = ({ ticket, onSendMessage, onStatusChange, sendingMessage, changingStatus }) => {
    const t = useTranslate();
    const { tokens, palette } = useTheme();
    const [msgText, setMsgText] = useState('');

    const handleSend = () => {
        if (!msgText.trim()) return;
        onSendMessage(msgText.trim());
        setMsgText('');
    };

    const isTerminal = ticket.status === 'resolved' || ticket.status === 'closed';

    return (
        <Box
            display="flex"
            flexDirection="column"
            flex={1}
            minHeight={0}
            minWidth={0}
            p={1.5}
            color={tokens.textPrimary}
        >
            {/* Header */}
            <Box
                display="flex"
                alignItems="flex-start"
                justifyContent="space-between"
                gap={1}
                mb={1.25}
                pb={1}
                sx={{ borderBottom: `1px solid ${tokens.border}`, minWidth: 0 }}
            >
                <Box minWidth={0} flex={1}>
                    <Typography
                        variant="subtitle1"
                        fontWeight={700}
                        fontFamily="monospace"
                        sx={{ color: tokens.textPrimary, letterSpacing: '0.02em', ...boundedTextSx }}
                    >
                        {ticket.id}
                    </Typography>
                    <Box display="flex" flexWrap="wrap" gap={0.75} alignItems="center" mt={0.5} minWidth={0}>
                        <StatusChip status={ticket.status} />
                        <Chip
                            label={ticket.category}
                            size="small"
                            variant="outlined"
                            sx={{
                                height: 20,
                                fontSize: '0.7rem',
                                color: tokens.textMuted,
                                borderColor: tokens.border,
                                maxWidth: '100%',
                                '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' },
                            }}
                        />
                        {ticket.claimedBy && (
                            <Chip
                                label={t('nui_reports.claimed_by', { name: ticket.claimedBy })}
                                size="small"
                                variant="outlined"
                                sx={{
                                    height: 20,
                                    fontSize: '0.7rem',
                                    color: tokens.info,
                                    borderColor: tokens.info,
                                    maxWidth: '100%',
                                    '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' },
                                }}
                            />
                        )}
                    </Box>
                </Box>
                <Typography
                    variant="caption"
                    sx={{ color: tokens.textMuted, textAlign: 'right', whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                    {formatDate(ticket.tsCreated)}
                </Typography>
            </Box>

            {/* Info bar */}
            <Box
                mb={1}
                p={1.25}
                sx={{
                    border: `1px solid ${tokens.border}`,
                    borderRadius: `${tokens.radiusRow}px`,
                    bgcolor: tokens.surface,
                    minWidth: 0,
                }}
            >
                <Box display="flex" flexWrap="wrap" gap={1} alignItems="center" mb={0.75} minWidth={0}>
                    {ticket.priority && (
                        <Chip
                            label={t(`discord_bot.tickets.priority_labels.${ticket.priority}`)}
                            size="small"
                            variant="outlined"
                            sx={{
                                height: 18,
                                fontSize: '0.7rem',
                                maxWidth: '100%',
                                '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' },
                                color:
                                    ticket.priority === 'high'
                                        ? tokens.error
                                        : ticket.priority === 'medium'
                                          ? tokens.warning
                                          : tokens.textMuted,
                                borderColor:
                                    ticket.priority === 'high'
                                        ? tokens.error
                                        : ticket.priority === 'medium'
                                          ? tokens.warning
                                          : tokens.border,
                            }}
                        />
                    )}
                    <Typography variant="caption" sx={{ color: tokens.textMuted }}>
                        ·
                    </Typography>
                    <Typography variant="caption" sx={{ color: tokens.textMuted, ...boundedTextSx }}>
                        {t('nui_reports.by_prefix')}
                        <strong style={{ color: tokens.textPrimary }}>{ticket.reporter.name}</strong> (#
                        {ticket.reporter.netid})
                    </Typography>
                    {ticket.targets.length > 0 && (
                        <>
                            <Typography variant="caption" sx={{ color: tokens.textMuted }}>
                                →
                            </Typography>
                            <Typography variant="caption" sx={{ color: tokens.textMuted, ...boundedTextSx }}>
                                {ticket.targets.map((t) => `${t.name} (#${t.netid})`).join(', ')}
                            </Typography>
                        </>
                    )}
                </Box>
                <Typography variant="body2" sx={{ color: tokens.textPrimary, ...boundedTextSx }}>
                    {ticket.description}
                </Typography>
                <Typography
                    variant="caption"
                    sx={{ color: tokens.textMuted, ...boundedTextSx }}
                    mt={0.5}
                    display="block"
                >
                    {t('nui_reports.created_at', { date: formatDate(ticket.tsCreated) })}
                    {ticket.tsResolved ? t('nui_reports.resolved_at', { date: formatDate(ticket.tsResolved) }) : ''}
                    {ticket.resolvedBy ? t('nui_reports.resolved_by', { name: ticket.resolvedBy }) : ''}
                </Typography>
            </Box>

            {/* Messages */}
            <Box
                flex={1}
                minHeight={0}
                overflow="auto"
                display="flex"
                flexDirection="column"
                gap={0.75}
                mb={1}
                pr={0.5}
                minWidth={0}
            >
                {ticket.messages.length === 0 && (
                    <Typography variant="body2" sx={{ color: tokens.textMuted }} textAlign="center" py={2}>
                        {t('nui_reports.no_messages_admin')}
                    </Typography>
                )}

                {ticket.messages.map((m, i) => (
                    <Box
                        key={m.id ?? i}
                        sx={{
                            p: 1,
                            borderRadius: 1,
                            bgcolor: m.authorType === 'admin' ? alpha(tokens.info, 0.08) : tokens.surfaceRaised,
                            borderLeft: m.authorType === 'admin' ? `3px solid ${tokens.info}` : '3px solid transparent',
                            ml: m.authorType === 'admin' ? 2 : 0,
                            mr: m.authorType === 'admin' ? 0 : 2,
                            minWidth: 0,
                        }}
                    >
                        <Box
                            display="flex"
                            justifyContent="space-between"
                            alignItems="flex-start"
                            gap={1}
                            mb={0.25}
                            minWidth={0}
                        >
                            <Typography
                                variant="caption"
                                component="div"
                                fontWeight={600}
                                sx={{ color: tokens.textPrimary, ...boundedTextSx }}
                            >
                                {m.author}
                                {m.authorType === 'admin' && (
                                    <Chip
                                        label={t('nui_reports.staff')}
                                        size="small"
                                        sx={{
                                            ml: 0.5,
                                            height: 16,
                                            fontSize: '0.65rem',
                                            color: tokens.info,
                                            borderColor: tokens.info,
                                            bgcolor: alpha(tokens.info, 0.1),
                                            maxWidth: '100%',
                                            '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' },
                                        }}
                                        variant="outlined"
                                    />
                                )}
                            </Typography>
                            <Typography
                                variant="caption"
                                sx={{ color: tokens.textMuted, whiteSpace: 'nowrap', flexShrink: 0 }}
                            >
                                {formatDate(m.ts)}
                            </Typography>
                        </Box>
                        <Typography
                            variant="body2"
                            sx={{ color: tokens.textPrimary, whiteSpace: 'pre-wrap', ...boundedTextSx }}
                        >
                            {m.content}
                        </Typography>
                        {m.imageUrls && m.imageUrls.length > 0 && (
                            <Box display="flex" flexWrap="wrap" gap={0.5} mt={0.5} minWidth={0}>
                                {m.imageUrls.filter(validateImageUrl).map((url, idx) => (
                                    <Box
                                        key={idx}
                                        component="img"
                                        src={url}
                                        alt={t('nui_reports.attachment_alt')}
                                        sx={{
                                            maxHeight: 80,
                                            maxWidth: 120,
                                            borderRadius: 0.5,
                                            border: `1px solid ${tokens.border}`,
                                        }}
                                    />
                                ))}
                            </Box>
                        )}
                    </Box>
                ))}
            </Box>

            {/* Reply box — hidden for terminal statuses */}
            {!isTerminal && (
                <Box display="flex" gap={1} mb={1} minWidth={0}>
                    <TextField
                        size="small"
                        fullWidth
                        placeholder={t('nui_reports.type_reply')}
                        value={msgText}
                        onChange={(e) => setMsgText(e.target.value.slice(0, 512))}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                        disabled={sendingMessage}
                        sx={{
                            flex: 1,
                            minWidth: 0,
                            '& .MuiInputBase-input': { color: tokens.textPrimary },
                            '& .MuiOutlinedInput-root': {
                                '& fieldset': { borderColor: tokens.border },
                                '&:hover fieldset': { borderColor: tokens.textMuted },
                            },
                        }}
                    />
                    <IconButton
                        onClick={handleSend}
                        disabled={sendingMessage || !msgText.trim()}
                        size="small"
                        sx={{ color: tokens.info, flexShrink: 0 }}
                    >
                        <Send />
                    </IconButton>
                </Box>
            )}

            {/* Status controls */}
            <Box
                display="flex"
                alignItems="center"
                justifyContent="flex-end"
                gap={1}
                flexWrap="wrap"
                pt={1}
                sx={{
                    borderTop: `1px solid ${tokens.border}`,
                    minWidth: 0,
                    '& .MuiButton-root': { minWidth: 0, maxWidth: '100%' },
                    '& .MuiButton-startIcon': { flexShrink: 0 },
                }}
            >
                {ticket.status === 'open' && (
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<PlayArrow />}
                        onClick={() => onStatusChange('inReview')}
                        disabled={changingStatus}
                        sx={{ textTransform: 'none', color: tokens.info, borderColor: tokens.info }}
                    >
                        {t('nui_reports.start_review')}
                    </Button>
                )}
                {(ticket.status === 'open' || ticket.status === 'inReview') && (
                    <Button
                        size="small"
                        variant="contained"
                        startIcon={<CheckCircle />}
                        onClick={() => onStatusChange('resolved')}
                        disabled={changingStatus}
                        sx={{
                            textTransform: 'none',
                            bgcolor: tokens.success,
                            color: palette.success.contrastText,
                            '&:hover': { bgcolor: palette.success.dark },
                        }}
                    >
                        {t('nui_reports.resolve')}
                    </Button>
                )}
                {(ticket.status === 'open' || ticket.status === 'inReview') && (
                    <Tooltip title={t('nui_reports.close_without_resolving')}>
                        <Button
                            size="small"
                            variant="outlined"
                            startIcon={<LockOutlined />}
                            onClick={() => onStatusChange('closed')}
                            disabled={changingStatus}
                            sx={{ textTransform: 'none', color: tokens.textMuted, borderColor: tokens.border }}
                        >
                            {t('nui_reports.close')}
                        </Button>
                    </Tooltip>
                )}
                {(ticket.status === 'resolved' || ticket.status === 'closed') && (
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<RadioButtonUnchecked />}
                        onClick={() => onStatusChange('open')}
                        disabled={changingStatus}
                        sx={{ textTransform: 'none', color: tokens.textMuted, borderColor: tokens.border }}
                    >
                        {t('nui_reports.reopen')}
                    </Button>
                )}
            </Box>
        </Box>
    );
};

// =============================================
// Sidebar list item
// =============================================

const TicketSidebarItem: React.FC<{
    ticket: TicketListItem;
    selected: boolean;
    isArchive: boolean;
    onSelect: (ticketId: string) => void;
}> = ({ ticket, selected, isArchive, onSelect }) => {
    const t = useTranslate();
    const { tokens } = useTheme();
    const statusColor = getStatusAccentColor(ticket.status, tokens);
    const participantLabel =
        ticket.targetNames.length > 0
            ? `${ticket.reporterName} \u2192 ${ticket.targetNames.join(', ')}`
            : ticket.reporterName;

    return (
        <Box
            onClick={() => onSelect(ticket.id)}
            sx={{
                position: 'relative',
                pl: 1.75,
                py: 1.1,
                pr: 1,
                borderRadius: `${tokens.radiusRow}px`,
                border: `1px solid ${selected ? tokens.accentBorder : tokens.border}`,
                bgcolor: selected ? tokens.accentTint : tokens.surfaceRaised,
                cursor: 'pointer',
                transition: 'background-color 120ms ease, border-color 120ms ease',
                '&:hover': {
                    bgcolor: selected ? tokens.accentTint : tokens.surfaceHover,
                    borderColor: selected ? tokens.accentBorder : tokens.borderStrong,
                },
                '&::before': {
                    content: '""',
                    position: 'absolute',
                    left: 6,
                    top: 10,
                    bottom: 10,
                    width: 3,
                    borderRadius: 2,
                    bgcolor: statusColor,
                },
                minWidth: 0,
            }}
        >
            <Box display="flex" alignItems="center" justifyContent="space-between" gap={0.5} mb={0.35} minWidth={0}>
                <Typography
                    variant="caption"
                    fontFamily="monospace"
                    fontWeight={700}
                    sx={{ color: tokens.textPrimary, fontSize: '0.72rem', ...ellipsisTextSx }}
                >
                    {ticket.id}
                </Typography>
                <Typography
                    variant="caption"
                    sx={{ color: tokens.textMuted, fontSize: '0.68rem', whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                    {formatRelativeTime(ticket.tsLastActivity, t)}
                </Typography>
            </Box>

            <Box display="flex" alignItems="center" gap={0.5} mb={0.35} flexWrap="wrap" minWidth={0}>
                <StatusChip status={ticket.status} />
                {(ticket.unreadCount ?? 0) > 0 && (
                    <Chip
                        label={t('nui_reports.unread_new', { count: ticket.unreadCount })}
                        size="small"
                        sx={{
                            height: 18,
                            fontSize: '0.65rem',
                            bgcolor: tokens.info,
                            color: tokens.accentContrast,
                            maxWidth: '100%',
                            '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' },
                        }}
                    />
                )}
            </Box>

            <Typography
                variant="body2"
                fontWeight={600}
                noWrap
                sx={{ color: tokens.textPrimary, fontSize: '0.82rem', ...ellipsisTextSx, width: '100%' }}
                title={participantLabel}
            >
                {participantLabel}
            </Typography>

            <Typography
                variant="caption"
                sx={{
                    color: tokens.textMuted,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word',
                    mt: 0.25,
                    lineHeight: 1.35,
                }}
            >
                {ticket.descriptionPreview ?? ''}
            </Typography>

            <Box display="flex" alignItems="center" justifyContent="space-between" gap={0.75} mt={0.5} minWidth={0}>
                <Chip
                    label={ticket.category}
                    size="small"
                    variant="outlined"
                    sx={{
                        height: 18,
                        fontSize: '0.65rem',
                        color: tokens.textMuted,
                        borderColor: tokens.border,
                        minWidth: 0,
                        maxWidth: '55%',
                        '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' },
                    }}
                />
                <Box display="flex" gap={0.75} alignItems="center" justifyContent="flex-end" minWidth={0}>
                    {ticket.messageCount > 0 && (
                        <Typography
                            variant="caption"
                            sx={{ color: tokens.textMuted, fontSize: '0.68rem', whiteSpace: 'nowrap', flexShrink: 0 }}
                        >
                            {t('nui_reports.message_count_short', { smart_count: ticket.messageCount })}
                        </Typography>
                    )}
                    {isArchive && (
                        <Typography
                            variant="caption"
                            sx={{ color: tokens.textMuted, fontSize: '0.68rem', whiteSpace: 'nowrap', flexShrink: 0 }}
                        >
                            {formatDate(ticket.tsCreated)}
                        </Typography>
                    )}
                    {ticket.claimedBy && (
                        <Typography
                            variant="caption"
                            sx={{ color: tokens.info, fontSize: '0.68rem', ...ellipsisTextSx }}
                        >
                            {ticket.claimedBy}
                        </Typography>
                    )}
                </Box>
            </Box>
        </Box>
    );
};

// =============================================
// Main Tickets Tab (Admin View)
// =============================================

export const ReportsTab: React.FC<{ visible: boolean }> = ({ visible }) => {
    const t = useTranslate();
    const { tokens } = useTheme();
    const curPage = usePageValue();

    // List state
    const [tickets, setTickets] = useState<TicketListItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [showArchive, setShowArchive] = useState(false);

    // Detail state
    const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
    const [ticketDetail, setTicketDetail] = useState<TicketDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [sendingMessage, setSendingMessage] = useState(false);
    const [changingStatus, setChangingStatus] = useState(false);
    const [ticketError, setTicketError] = useState<string | null>(null);

    // Notification state
    const [notification, setNotification] = useState<{ ticketId: string; reporterName: string } | null>(null);

    const handleRefresh = useCallback(() => {
        setLoading(true);
        fetchNui('ticketAdminList').catch((err) => {
            setLoading(false);
            setTicketError(
                t('nui_reports.failed_fetch_tickets', {
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
        });
    }, [t]);

    // Fetch when tab becomes visible
    useEffect(() => {
        if (curPage !== txAdminMenuPage.Reports) return;
        handleRefresh();
    }, [curPage, handleRefresh]);

    // Listen for admin ticket list
    useNuiEvent<{ tickets?: TicketListItem[]; error?: string }>('ticketAdminListData', (data) => {
        setLoading(false);
        if (data.error) {
            setTicketError(translateTicketError(t, data.error) ?? data.error);
            return;
        }
        setTicketError(null);
        if (data.tickets) setTickets(data.tickets);
    });

    // Listen for admin ticket detail
    useNuiEvent<{ ticket?: TicketDetail; error?: string }>('ticketAdminDetailData', (data) => {
        setDetailLoading(false);
        if (data.error) {
            setTicketError(translateTicketError(t, data.error) ?? data.error);
            return;
        }
        setTicketError(null);
        if (data.ticket) setTicketDetail(data.ticket);
    });

    // Listen for admin message result
    useNuiEvent<{ success?: boolean; error?: string }>('ticketAdminMessageResult', (data) => {
        setSendingMessage(false);
        if (data.error) {
            setTicketError(translateTicketError(t, data.error) ?? data.error);
            return;
        }
        setTicketError(null);
        if (data.success && selectedTicketId) {
            setDetailLoading(true);
            fetchNui('ticketAdminDetail', { ticketId: selectedTicketId }).catch(() => setDetailLoading(false));
        }
    });

    // Listen for admin status result
    useNuiEvent<{ success?: boolean; error?: string }>('ticketAdminStatusResult', (data) => {
        setChangingStatus(false);
        if (data.error) {
            setTicketError(translateTicketError(t, data.error) ?? data.error);
            return;
        }
        setTicketError(null);
        if (data.success && selectedTicketId) {
            setDetailLoading(true);
            fetchNui('ticketAdminDetail', { ticketId: selectedTicketId }).catch(() => setDetailLoading(false));
            fetchNui('ticketAdminList').catch(() => {});
        }
    });

    // Listen for new ticket notifications
    useNuiEvent<{ ticketId: string; reporterName: string }>('ticketNotification', (data) => {
        setNotification(data);
    });

    const handleOpenDetail = useCallback((ticketId: string) => {
        setSelectedTicketId(ticketId);
        setTicketDetail(null);
        setDetailLoading(true);
        fetchNui('ticketAdminDetail', { ticketId }).catch(() => setDetailLoading(false));
    }, []);

    const handleSendMessage = (content: string) => {
        if (!selectedTicketId) return;
        setSendingMessage(true);
        fetchNui('ticketAdminMessage', { ticketId: selectedTicketId, content }).catch(() => setSendingMessage(false));
    };

    const handleStatusChange = (status: TicketStatus) => {
        if (!selectedTicketId) return;
        setChangingStatus(true);
        fetchNui('ticketAdminStatus', { ticketId: selectedTicketId, status }).catch(() => setChangingStatus(false));
    };

    // Filter logic — archive = resolved + closed, active = open + inReview
    const activeTickets = useMemo(
        () => tickets.filter((t) => t.status === 'open' || t.status === 'inReview'),
        [tickets],
    );
    const archivedTickets = useMemo(
        () => tickets.filter((t) => t.status === 'resolved' || t.status === 'closed'),
        [tickets],
    );
    const baseList = showArchive ? archivedTickets : activeTickets;

    const filtered = useMemo(() => {
        return baseList.filter((t) => {
            if (!showArchive && statusFilter !== 'all' && t.status !== statusFilter) return false;
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                return (
                    t.id.toLowerCase().includes(q) ||
                    t.category.toLowerCase().includes(q) ||
                    t.reporterName.toLowerCase().includes(q) ||
                    t.descriptionPreview.toLowerCase().includes(q) ||
                    t.targetNames.some((name) => name.toLowerCase().includes(q))
                );
            }
            return true;
        });
    }, [baseList, showArchive, statusFilter, searchQuery]);

    const openCount = tickets.filter((t) => t.status === 'open').length;
    const inReviewCount = tickets.filter((t) => t.status === 'inReview').length;

    const handleListTabChange = (archive: boolean) => {
        setShowArchive(archive);
        setStatusFilter('all');
        const nextList = archive ? archivedTickets : activeTickets;
        if (nextList.length > 0) {
            handleOpenDetail(nextList[0].id);
        } else {
            setSelectedTicketId(null);
            setTicketDetail(null);
        }
    };

    // Auto-select the first ticket when the list loads or filters change
    useEffect(() => {
        if (!visible || loading) return;
        if (filtered.length === 0) {
            if (selectedTicketId !== null) {
                setSelectedTicketId(null);
                setTicketDetail(null);
            }
            return;
        }
        if (!selectedTicketId || !filtered.some((t) => t.id === selectedTicketId)) {
            handleOpenDetail(filtered[0].id);
        }
    }, [visible, loading, filtered, selectedTicketId, handleOpenDetail]);

    return (
        <RootStyled mt={2} mb={10} pt={2} px={2} display={visible ? 'flex' : 'none'}>
            {/* Error banner */}
            {ticketError && (
                <Box
                    sx={{
                        backgroundColor: alpha(tokens.error, 0.13),
                        border: `1px solid ${tokens.error}`,
                        borderRadius: 1,
                        px: 2,
                        py: 1,
                        mb: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 1,
                        minWidth: 0,
                    }}
                >
                    <Typography variant="body2" sx={{ color: tokens.error, ...boundedTextSx }}>
                        {ticketError}
                    </Typography>
                    <IconButton
                        size="small"
                        onClick={() => setTicketError(null)}
                        sx={{ color: tokens.error, flexShrink: 0 }}
                    >
                        &times;
                    </IconButton>
                </Box>
            )}

            {/* New ticket notification banner */}
            {notification && (
                <Box
                    sx={{
                        backgroundColor: alpha(tokens.info, 0.13),
                        border: `1px solid ${tokens.info}`,
                        borderRadius: 1,
                        px: 2,
                        py: 0.75,
                        mb: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 1,
                        minWidth: 0,
                        cursor: 'pointer',
                    }}
                    onClick={() => {
                        handleOpenDetail(notification.ticketId);
                        setNotification(null);
                    }}
                >
                    <Typography variant="body2" sx={{ color: tokens.info, ...boundedTextSx }}>
                        {t('nui_reports.new_ticket_click', { name: notification.reporterName })}
                    </Typography>
                    <IconButton
                        size="small"
                        onClick={(e) => {
                            e.stopPropagation();
                            setNotification(null);
                        }}
                        sx={{ color: tokens.info, flexShrink: 0 }}
                    >
                        <Close fontSize="small" />
                    </IconButton>
                </Box>
            )}

            {/* Dashboard header */}
            <Box
                display="flex"
                alignItems="center"
                justifyContent="space-between"
                gap={1}
                mb={1.25}
                flexShrink={0}
                minWidth={0}
            >
                <Typography variant="subtitle1" fontWeight={700} sx={{ color: tokens.textPrimary, ...ellipsisTextSx }}>
                    {t('nui_reports.title_tickets')}
                </Typography>
                <IconButton
                    size="small"
                    onClick={handleRefresh}
                    disabled={loading}
                    title={t('nui_reports.refresh')}
                    sx={{ color: tokens.textMuted, flexShrink: 0 }}
                >
                    <Refresh fontSize="small" />
                </IconButton>
            </Box>

            <Box display="flex" gap={1} mb={1.25} flexShrink={0} minWidth={0}>
                <StatCard>
                    <Typography
                        variant="caption"
                        sx={{ color: tokens.warning, fontWeight: 700, fontSize: '0.68rem', ...ellipsisTextSx }}
                    >
                        {t('nui_reports.stat_open')}
                    </Typography>
                    <Typography variant="h6" fontWeight={700} sx={{ color: tokens.textPrimary, lineHeight: 1.2 }}>
                        {openCount}
                    </Typography>
                </StatCard>
                <StatCard>
                    <Typography
                        variant="caption"
                        sx={{ color: tokens.info, fontWeight: 700, fontSize: '0.68rem', ...ellipsisTextSx }}
                    >
                        {t('nui_reports.stat_in_review')}
                    </Typography>
                    <Typography variant="h6" fontWeight={700} sx={{ color: tokens.textPrimary, lineHeight: 1.2 }}>
                        {inReviewCount}
                    </Typography>
                </StatCard>
                <StatCard>
                    <Typography
                        variant="caption"
                        sx={{ color: tokens.textMuted, fontWeight: 700, fontSize: '0.68rem', ...ellipsisTextSx }}
                    >
                        {t('nui_reports.stat_archived')}
                    </Typography>
                    <Typography variant="h6" fontWeight={700} sx={{ color: tokens.textPrimary, lineHeight: 1.2 }}>
                        {archivedTickets.length}
                    </Typography>
                </StatCard>
            </Box>

            <DashboardBody>
                {/* Sidebar — ticket list */}
                <Sidebar>
                    <SegmentedBar>
                        <SegmentButton active={!showArchive} onClick={() => handleListTabChange(false)}>
                            {t('nui_reports.tab_active')} ({activeTickets.length})
                        </SegmentButton>
                        <SegmentButton active={showArchive} onClick={() => handleListTabChange(true)}>
                            {t('nui_reports.tab_archive')} ({archivedTickets.length})
                        </SegmentButton>
                    </SegmentedBar>

                    <Box display="flex" gap={1} mb={1} flexShrink={0} minWidth={0}>
                        <TextField
                            size="small"
                            placeholder={t('nui_reports.search_tickets')}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            sx={{
                                flex: 1,
                                minWidth: 0,
                                '& .MuiInputBase-input': { color: tokens.textPrimary, fontSize: '0.82rem' },
                                '& .MuiInputBase-input::placeholder': { color: tokens.textMuted, opacity: 1 },
                                '& .MuiOutlinedInput-root': {
                                    '& fieldset': { borderColor: tokens.border },
                                    '&:hover fieldset': { borderColor: tokens.textMuted },
                                },
                            }}
                            InputProps={{
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <Search fontSize="small" sx={{ color: tokens.textMuted }} />
                                    </InputAdornment>
                                ),
                            }}
                        />
                        {!showArchive && (
                            <FormControl size="small" sx={{ minWidth: 96, flexShrink: 0 }}>
                                <InputLabel sx={{ color: tokens.textMuted, fontSize: '0.82rem' }}>
                                    {t('nui_reports.status')}
                                </InputLabel>
                                <Select
                                    value={statusFilter}
                                    label={t('nui_reports.status')}
                                    onChange={(e) => setStatusFilter(e.target.value)}
                                    MenuProps={{ disablePortal: true }}
                                    sx={{
                                        color: tokens.textPrimary,
                                        fontSize: '0.82rem',
                                        maxWidth: 120,
                                        '& .MuiOutlinedInput-notchedOutline': { borderColor: tokens.border },
                                        '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: tokens.textMuted },
                                        '& .MuiSvgIcon-root': { color: tokens.textMuted },
                                    }}
                                >
                                    <MenuItem value="all" sx={boundedTextSx}>
                                        {t('nui_reports.all')}
                                    </MenuItem>
                                    <MenuItem value="open" sx={boundedTextSx}>
                                        {t('discord_bot.tickets.status_labels.open')}
                                    </MenuItem>
                                    <MenuItem value="inReview" sx={boundedTextSx}>
                                        {t('discord_bot.tickets.status_labels.in_review')}
                                    </MenuItem>
                                </Select>
                            </FormControl>
                        )}
                    </Box>

                    <ListContainer>
                        {loading ? (
                            <Box textAlign="center" py={4}>
                                <Typography variant="body2" sx={{ color: tokens.textMuted, ...boundedTextSx }}>
                                    {t('nui_reports.loading_tickets')}
                                </Typography>
                            </Box>
                        ) : filtered.length === 0 ? (
                            <Box textAlign="center" py={4} px={1}>
                                <Inbox sx={{ color: tokens.textMuted, fontSize: 28, mb: 1 }} />
                                <Typography variant="body2" sx={{ color: tokens.textMuted, ...boundedTextSx }}>
                                    {baseList.length === 0
                                        ? showArchive
                                            ? t('nui_reports.no_archived_tickets')
                                            : t('nui_reports.no_open_tickets')
                                        : t('nui_reports.no_matches')}
                                </Typography>
                            </Box>
                        ) : (
                            filtered.map((ticket) => (
                                <TicketSidebarItem
                                    key={ticket.id}
                                    ticket={ticket}
                                    selected={selectedTicketId === ticket.id}
                                    isArchive={showArchive}
                                    onSelect={handleOpenDetail}
                                />
                            ))
                        )}
                    </ListContainer>
                </Sidebar>

                {/* Detail pane */}
                <DetailPane>
                    {selectedTicketId === null ? (
                        <Box
                            display="flex"
                            flexDirection="column"
                            alignItems="center"
                            justifyContent="center"
                            flex={1}
                            gap={1}
                            px={2}
                            minWidth={0}
                        >
                            <Inbox sx={{ color: tokens.textMuted, fontSize: 40, opacity: 0.5 }} />
                            <Typography
                                variant="body2"
                                sx={{ color: tokens.textMuted, textAlign: 'center', ...boundedTextSx }}
                            >
                                {t('nui_reports.select_ticket_hint')}
                            </Typography>
                        </Box>
                    ) : detailLoading || !ticketDetail ? (
                        <Box display="flex" justifyContent="center" alignItems="center" flex={1} minWidth={0}>
                            <Typography variant="body2" sx={{ color: tokens.textMuted, ...boundedTextSx }}>
                                {t('nui_reports.loading_ticket')}
                            </Typography>
                        </Box>
                    ) : (
                        <TicketDetailView
                            ticket={ticketDetail}
                            onSendMessage={handleSendMessage}
                            onStatusChange={handleStatusChange}
                            sendingMessage={sendingMessage}
                            changingStatus={changingStatus}
                        />
                    )}
                </DetailPane>
            </DashboardBody>
        </RootStyled>
    );
};
