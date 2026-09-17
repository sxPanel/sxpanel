import React, { useCallback, useEffect, useState } from 'react';
import { alpha, styled } from '@mui/material/styles';
import {
    Box,
    Button,
    Chip,
    FormControl,
    IconButton,
    InputLabel,
    MenuItem,
    Modal,
    Rating,
    Select,
    TextField,
    Typography,
    useTheme,
} from '@mui/material';
import { Chat, Close, Image, Send, Star } from '@mui/icons-material';
import { useNuiEvent } from '../../hooks/useNuiEvent';
import { fetchNui } from '../../utils/fetchNui';
import { asArray } from '../../utils/miscUtils';
import { useSetListenForExit } from '../../state/keys.state';
import type { MenuTokens } from '../../styles/theme';
import { useTranslate } from 'react-polyglot';
import { translateTicketError } from '../../utils/translateTicketError';

// =============================================
// Types
// =============================================

type TicketStatus = 'open' | 'inReview' | 'resolved' | 'closed';

interface TicketMessage {
    id?: string;
    author: string;
    authorType: 'player' | 'admin' | 'discord';
    content: string;
    imageUrls?: string[];
    ts: number;
}

interface PlayerTicketSummary {
    id: string;
    status: TicketStatus;
    category: string;
    descriptionPreview: string;
    messageCount: number;
    unreadCount: number;
    tsCreated: number;
    awaitingFeedback?: boolean;
}

interface PlayerTarget {
    id: number;
    name: string;
}

type View = 'menu' | 'create' | 'list' | 'detail' | 'feedback';

// =============================================
// Styles
// =============================================

const Panel = styled(Box)(({ theme }) => ({
    width: 480,
    maxWidth: 'calc(100vw - 32px)',
    maxHeight: 'calc(100vh - 40px)',
    boxSizing: 'border-box',
    background: theme.tokens.surface,
    boxShadow: theme.tokens.shadowCard,
    borderRadius: theme.tokens.radiusCard,
    border: `1px solid ${theme.tokens.border}`,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    // Content scrolls internally; panel stays visible so non-portaled Select menus aren't clipped.
    overflow: 'visible',
}));

const Header = styled(Box)(({ theme }) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '14px 18px',
    borderBottom: `1px solid ${theme.tokens.border}`,
    minWidth: 0,
}));

const Content = styled(Box)({
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    overflow: 'auto',
    padding: '16px 18px',
    boxSizing: 'border-box',
});

const Footer = styled(Box)(({ theme }) => ({
    padding: '12px 18px',
    borderTop: `1px solid ${theme.tokens.border}`,
    display: 'flex',
    gap: 8,
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

const useStatusMap = (): Record<TicketStatus, { label: string; color: string }> => {
    const t = useTranslate();
    const { tokens } = useTheme();
    return {
        open: { label: t('discord_bot.tickets.status_labels.open'), color: tokens.warning },
        inReview: { label: t('discord_bot.tickets.status_labels.in_review'), color: tokens.info },
        resolved: { label: t('discord_bot.tickets.status_labels.resolved'), color: tokens.success },
        closed: { label: t('discord_bot.tickets.status_labels.closed'), color: tokens.textMuted },
    };
};

function timeAgo(t: (key: string, options?: Record<string, unknown>) => string, ts: number): string {
    const tsSeconds = ts > 1e12 ? Math.floor(ts / 1000) : Math.floor(ts);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const diff = Math.max(0, nowSeconds - tsSeconds);
    if (diff < 60) return t('nui_reports.just_now');
    if (diff < 3600) return t('nui_reports.time_minutes_ago', { count: Math.floor(diff / 60) });
    if (diff < 86400) return t('nui_reports.time_hours_ago', { count: Math.floor(diff / 3600) });
    return t('nui_reports.time_days_ago', { count: Math.floor(diff / 86400) });
}

const getInputSx = (tokens: MenuTokens) => ({
    minWidth: 0,
    '& .MuiOutlinedInput-root': {
        minWidth: 0,
        color: tokens.textPrimary,
        '& fieldset': { borderColor: tokens.border },
        '&:hover fieldset': { borderColor: tokens.textMuted },
        '&.Mui-focused fieldset': { borderColor: tokens.info },
    },
    '& .MuiInputBase-input, & .MuiInputBase-inputMultiline': {
        color: tokens.textPrimary,
        minWidth: 0,
        overflowWrap: 'anywhere',
    },
    '& .MuiInputBase-input::placeholder': { color: tokens.textMuted, opacity: 1 },
    '& .MuiInputLabel-root': { color: tokens.textMuted },
    '& .MuiInputLabel-root.Mui-focused': { color: tokens.info },
    '& .MuiFormHelperText-root': { color: tokens.textMuted },
    '& .MuiSelect-icon': { color: tokens.textMuted },
    '& .MuiSelect-select': {
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
    },
});

const getMenuPaperSx = (tokens: MenuTokens) => ({
    bgcolor: tokens.surfaceRaised,
    color: tokens.textPrimary,
    border: `1px solid ${tokens.border}`,
    maxWidth: 'calc(100vw - 32px)',
    '& .MuiMenuItem-root': {
        whiteSpace: 'normal',
        overflowWrap: 'anywhere',
    },
});

/** Keep menus inside the overlay — portaled menus cause removeChild crashes on close. */
const getSelectMenuProps = (tokens: MenuTokens) => ({
    disablePortal: true,
    PaperProps: { sx: getMenuPaperSx(tokens) },
});

// =============================================
// Sub-components
// =============================================

const StatusChip: React.FC<{ status: TicketStatus; size?: 'small' | 'medium' }> = ({ status, size = 'small' }) => {
    const statusMap = useStatusMap();
    const { tokens } = useTheme();
    const { label, color } = statusMap[status] ?? { label: status, color: tokens.textMuted };
    return (
        <Chip
            label={label}
            size={size}
            variant="outlined"
            sx={{
                color,
                borderColor: color,
                fontWeight: 600,
                maxWidth: '100%',
                '& .MuiChip-label': { color, overflow: 'hidden', textOverflow: 'ellipsis' },
            }}
        />
    );
};

const MenuView: React.FC<{
    onSelect: (view: View) => void;
    ticketCount: number;
}> = ({ onSelect, ticketCount }) => {
    const t = useTranslate();
    const { tokens } = useTheme();
    return (
        <Box display="flex" flexDirection="column" gap={1.5}>
            <Typography variant="body2" sx={{ color: tokens.textMuted, mb: 1 }}>
                {t('nui_reports.menu_what')}
            </Typography>
            <Button
                variant="outlined"
                onClick={() => onSelect('create')}
                sx={{
                    justifyContent: 'flex-start',
                    textTransform: 'none',
                    py: 1.2,
                    color: tokens.textPrimary,
                    borderColor: tokens.border,
                    minWidth: 0,
                    textAlign: 'left',
                    overflowWrap: 'anywhere',
                    '&:hover': { borderColor: tokens.textMuted, bgcolor: 'rgba(255,255,255,0.04)' },
                }}
            >
                {t('nui_reports.submit_new_ticket')}
            </Button>
            <Button
                variant="outlined"
                startIcon={<Chat />}
                onClick={() => onSelect('list')}
                sx={{
                    justifyContent: 'flex-start',
                    textTransform: 'none',
                    py: 1.2,
                    color: tokens.textPrimary,
                    borderColor: tokens.border,
                    minWidth: 0,
                    textAlign: 'left',
                    overflowWrap: 'anywhere',
                    '& .MuiButton-startIcon': { flexShrink: 0 },
                    '&:hover': { borderColor: tokens.textMuted, bgcolor: 'rgba(255,255,255,0.04)' },
                }}
            >
                {ticketCount > 0
                    ? t('nui_reports.my_tickets_count', { count: ticketCount })
                    : t('nui_reports.my_tickets')}
            </Button>
        </Box>
    );
};

const CreateView: React.FC<{
    players: PlayerTarget[];
    categories: string[];
    priorityEnabled: boolean;
    onSubmit: (category: string, description: string, targetIds: number[], priority?: string) => void;
    submitting: boolean;
}> = ({ players, categories, priorityEnabled, onSubmit, submitting }) => {
    const t = useTranslate();
    const { tokens } = useTheme();
    const inputSx = getInputSx(tokens);
    const selectMenuProps = getSelectMenuProps(tokens);
    const defaultCategory = categories[0] ?? '';
    const [category, setCategory] = useState(defaultCategory);
    const [description, setDescription] = useState('');
    const [selectedTargets, setSelectedTargets] = useState<number[]>([]);
    const [priority, setPriority] = useState('');

    // Sync category when categories prop changes
    useEffect(() => {
        setCategory((prev) => (categories.includes(prev) ? prev : (categories[0] ?? '')));
    }, [categories]);

    // Detect if this category sounds like a player report
    const isPlayerCategory = /player/i.test(category);

    const handleSubmit = () => {
        if (!description.trim()) return;
        onSubmit(category, description.trim(), selectedTargets, priority || undefined);
    };

    return (
        <Box display="flex" flexDirection="column" gap={2}>
            {categories.length > 0 && (
                <FormControl size="small" fullWidth sx={inputSx}>
                    <InputLabel>{t('nui_reports.category')}</InputLabel>
                    <Select
                        value={category}
                        label={t('nui_reports.category')}
                        onChange={(e) => {
                            setCategory(e.target.value);
                            if (!/player/i.test(e.target.value)) setSelectedTargets([]);
                        }}
                        MenuProps={selectMenuProps}
                    >
                        {categories.map((cat) => (
                            <MenuItem key={cat} value={cat} sx={{ color: tokens.textPrimary, ...boundedTextSx }}>
                                {cat}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
            )}

            {isPlayerCategory && players.length > 0 && (
                <FormControl size="small" fullWidth sx={inputSx}>
                    <InputLabel>{t('nui_reports.target_players')}</InputLabel>
                    <Select
                        multiple
                        value={selectedTargets}
                        label={t('nui_reports.target_players')}
                        onChange={(e) => setSelectedTargets(e.target.value as number[])}
                        renderValue={(selected) =>
                            (selected as number[])
                                .map((id) => {
                                    const p = players.find((player) => player.id === id);
                                    return p ? p.name : `#${id}`;
                                })
                                .join(', ')
                        }
                        MenuProps={selectMenuProps}
                    >
                        {players.map((p) => (
                            <MenuItem key={p.id} value={p.id} sx={{ color: tokens.textPrimary, ...boundedTextSx }}>
                                [{p.id}] {p.name}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
            )}

            {priorityEnabled && (
                <FormControl size="small" fullWidth sx={inputSx}>
                    <InputLabel>{t('nui_reports.priority_optional')}</InputLabel>
                    <Select
                        value={priority}
                        label={t('nui_reports.priority_optional')}
                        onChange={(e) => setPriority(e.target.value)}
                        MenuProps={selectMenuProps}
                    >
                        <MenuItem value="" sx={{ color: tokens.textMuted }}>
                            {t('discord_bot.tickets.priority_labels.none')}
                        </MenuItem>
                        <MenuItem value="low" sx={{ color: tokens.textPrimary }}>
                            {t('discord_bot.tickets.priority_labels.low')}
                        </MenuItem>
                        <MenuItem value="medium" sx={{ color: tokens.textPrimary }}>
                            {t('discord_bot.tickets.priority_labels.medium')}
                        </MenuItem>
                        <MenuItem value="high" sx={{ color: tokens.textPrimary }}>
                            {t('discord_bot.tickets.priority_labels.high')}
                        </MenuItem>
                        <MenuItem value="critical" sx={{ color: tokens.error }}>
                            {t('discord_bot.tickets.priority_labels.critical')}
                        </MenuItem>
                    </Select>
                </FormControl>
            )}

            <TextField
                label={t('nui_reports.description')}
                multiline
                minRows={3}
                maxRows={6}
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, 2048))}
                placeholder={t('nui_reports.describe_issue')}
                size="small"
                fullWidth
                helperText={`${description.length}/2048`}
                sx={inputSx}
            />

            <Button
                variant="contained"
                onClick={handleSubmit}
                disabled={submitting || !description.trim()}
                sx={{
                    textTransform: 'none',
                    bgcolor: tokens.accent,
                    color: tokens.accentContrast,
                    '&:hover': { bgcolor: tokens.accent, filter: 'brightness(1.15)' },
                    '&.Mui-disabled': { bgcolor: tokens.border, color: tokens.textMuted },
                }}
            >
                {submitting ? t('nui_reports.submitting') : t('nui_reports.submit_ticket')}
            </Button>
        </Box>
    );
};
const ListView: React.FC<{
    tickets: PlayerTicketSummary[];
    onSelect: (ticket: PlayerTicketSummary) => void;
}> = ({ tickets, onSelect }) => {
    const t = useTranslate();
    const { tokens } = useTheme();
    if (tickets.length === 0) {
        return (
            <Box textAlign="center" py={4}>
                <Typography variant="body2" sx={{ color: tokens.textMuted }}>
                    {t('nui_reports.no_tickets_player')}
                </Typography>
            </Box>
        );
    }

    return (
        <Box display="flex" flexDirection="column" gap={1} minWidth={0}>
            {tickets.map((ticket) => (
                <Box
                    key={ticket.id}
                    onClick={() => onSelect(ticket)}
                    sx={{
                        p: 1.5,
                        borderRadius: 1,
                        border: `1px solid ${ticket.awaitingFeedback ? tokens.warning : tokens.border}`,
                        bgcolor: tokens.surfaceRaised,
                        cursor: 'pointer',
                        '&:hover': { bgcolor: 'rgba(255,255,255,0.04)' },
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 0.5,
                        minWidth: 0,
                    }}
                >
                    <Box display="flex" alignItems="flex-start" justifyContent="space-between" gap={1} minWidth={0}>
                        <Typography
                            variant="body2"
                            fontWeight={600}
                            sx={{ color: tokens.textPrimary, ...boundedTextSx }}
                        >
                            {ticket.category}
                        </Typography>
                        <Box
                            display="flex"
                            alignItems="center"
                            justifyContent="flex-end"
                            gap={0.5}
                            flexWrap="wrap"
                            sx={{ flexShrink: 0, maxWidth: '60%' }}
                        >
                            {ticket.unreadCount > 0 && (
                                <Chip
                                    label={t('nui_reports.unread_new', { count: ticket.unreadCount })}
                                    size="small"
                                    sx={{
                                        height: 16,
                                        fontSize: '0.65rem',
                                        bgcolor: tokens.info,
                                        color: tokens.accentContrast,
                                        maxWidth: '100%',
                                        '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' },
                                    }}
                                />
                            )}
                            <StatusChip status={ticket.status} />
                        </Box>
                    </Box>
                    <Typography variant="body2" noWrap sx={{ color: tokens.textMuted, ...ellipsisTextSx }}>
                        {ticket.descriptionPreview}
                    </Typography>
                    <Typography
                        variant="caption"
                        sx={{ color: ticket.awaitingFeedback ? tokens.warning : tokens.textMuted, ...boundedTextSx }}
                    >
                        {ticket.awaitingFeedback
                            ? t('nui_reports.rate_prompt')
                            : `${timeAgo(t, ticket.tsCreated)} · ${t('nui_reports.message_count', { smart_count: ticket.messageCount })}`}
                    </Typography>
                </Box>
            ))}
        </Box>
    );
};

const ImageLightbox: React.FC<{ url: string | null; onClose: () => void }> = ({ url, onClose }) => {
    const t = useTranslate();
    const [hasError, setHasError] = useState(false);

    // Reset error state when URL changes
    React.useEffect(() => setHasError(false), [url]);

    return (
        <Modal open={!!url} onClose={onClose} disablePortal>
            <Box
                onClick={onClose}
                sx={{
                    position: 'fixed',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    bgcolor: 'rgba(0,0,0,0.85)',
                    cursor: 'zoom-out',
                }}
            >
                {url &&
                    (hasError ? (
                        <Box
                            onClick={(e) => e.stopPropagation()}
                            sx={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: 2,
                                p: 4,
                                borderRadius: 2,
                                bgcolor: 'background.paper',
                                cursor: 'default',
                            }}
                        >
                            <Typography color="text.secondary">{t('nui_reports.image_failed_load')}</Typography>
                            <Button variant="outlined" size="small" onClick={onClose}>
                                {t('nui_reports.close')}
                            </Button>
                        </Box>
                    ) : (
                        <img
                            src={url}
                            alt={t('nui_reports.lightbox_alt')}
                            referrerPolicy="no-referrer"
                            onClick={(e) => e.stopPropagation()}
                            onError={() => setHasError(true)}
                            style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 8, cursor: 'default' }}
                        />
                    ))}
            </Box>
        </Modal>
    );
};

const DetailView: React.FC<{
    ticket: PlayerTicketSummary;
    messages: TicketMessage[];
    onSendMessage: (ticketId: string, content: string, imageUrls?: string[]) => void;
    sending: boolean;
}> = ({ ticket, messages, onSendMessage, sending }) => {
    const t = useTranslate();
    const { tokens } = useTheme();
    const inputSx = getInputSx(tokens);
    const statusMap = useStatusMap();
    const [msg, setMsg] = useState('');
    const [imageUrl, setImageUrl] = useState('');
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

    const URL_MAX = 2048;
    const canSend = (msg.trim().length > 0 || imageUrl.trim().length > 0) && imageUrl.trim().length <= URL_MAX;

    const handleSend = () => {
        if (!canSend) return;
        const urls = imageUrl.trim() ? [imageUrl.trim()] : undefined;
        onSendMessage(ticket.id, msg.trim(), urls);
        setMsg('');
        setImageUrl('');
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const isClosed = ticket.status === 'resolved' || ticket.status === 'closed';

    return (
        <Box display="flex" flexDirection="column" height="100%" minHeight={0} minWidth={0}>
            <Box mb={2} minWidth={0}>
                <Box display="flex" alignItems="center" gap={1} mb={0.5} flexWrap="wrap" minWidth={0}>
                    <Typography variant="body2" fontWeight={600} sx={{ color: tokens.textPrimary, ...boundedTextSx }}>
                        {ticket.category}
                    </Typography>
                    <StatusChip status={ticket.status} />
                </Box>
                <Typography variant="body2" sx={{ color: tokens.textMuted, ...boundedTextSx }}>
                    {ticket.descriptionPreview}
                </Typography>
            </Box>

            <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />

            <Box
                flex={1}
                minHeight={0}
                minWidth={0}
                overflow="auto"
                display="flex"
                flexDirection="column"
                gap={1}
                mb={2}
                sx={{ maxHeight: 300 }}
            >
                {messages.length === 0 ? (
                    <Typography variant="body2" sx={{ color: tokens.textMuted, textAlign: 'center', py: 2 }}>
                        {t('nui_reports.no_messages_player')}
                    </Typography>
                ) : (
                    messages.map((m, i) => (
                        <Box
                            key={m.id ?? `${m.ts}-${i}`}
                            sx={{
                                p: 1,
                                borderRadius: 1,
                                bgcolor: m.authorType === 'admin' ? alpha(tokens.info, 0.1) : 'rgba(255,255,255,0.04)',
                                borderLeft:
                                    m.authorType === 'admin' ? `3px solid ${tokens.info}` : '3px solid transparent',
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
                                    fontWeight={600}
                                    component="div"
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
                                                bgcolor: alpha(tokens.info, 0.15),
                                                maxWidth: '100%',
                                                '& .MuiChip-label': {
                                                    color: tokens.info,
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                },
                                            }}
                                        />
                                    )}
                                </Typography>
                                <Typography
                                    variant="caption"
                                    sx={{ color: tokens.textMuted, whiteSpace: 'nowrap', flexShrink: 0 }}
                                >
                                    {timeAgo(t, m.ts)}
                                </Typography>
                            </Box>
                            {m.content && (
                                <Typography
                                    variant="body2"
                                    sx={{ color: tokens.textPrimary, whiteSpace: 'pre-wrap', ...boundedTextSx }}
                                >
                                    {m.content}
                                </Typography>
                            )}
                            {m.imageUrls && m.imageUrls.length > 0 && (
                                <Box mt={0.5} display="flex" flexWrap="wrap" gap={0.5} minWidth={0}>
                                    {m.imageUrls.map((url, j) => (
                                        <img
                                            key={j}
                                            src={url}
                                            alt={t('nui_reports.attachment_alt')}
                                            loading="lazy"
                                            referrerPolicy="no-referrer"
                                            onClick={() => setLightboxUrl(url)}
                                            style={{
                                                maxHeight: 80,
                                                maxWidth: '100%',
                                                borderRadius: 4,
                                                border: `1px solid ${tokens.border}`,
                                                cursor: 'zoom-in',
                                            }}
                                        />
                                    ))}
                                </Box>
                            )}
                        </Box>
                    ))
                )}
            </Box>

            {!isClosed && (
                <Box display="flex" flexDirection="column" gap={0.75} minWidth={0}>
                    <Box display="flex" gap={1} minWidth={0}>
                        <TextField
                            size="small"
                            fullWidth
                            placeholder={t('nui_reports.type_message')}
                            value={msg}
                            onChange={(e) => setMsg(e.target.value.slice(0, 2048))}
                            onKeyDown={handleKeyDown}
                            disabled={sending}
                            sx={{ ...inputSx, flex: 1 }}
                        />
                        <IconButton
                            onClick={handleSend}
                            disabled={sending || !canSend}
                            size="small"
                            sx={{ color: tokens.info, flexShrink: 0 }}
                        >
                            <Send />
                        </IconButton>
                    </Box>
                    <Box display="flex" alignItems="center" gap={0.75} minWidth={0}>
                        <Image sx={{ fontSize: 16, color: tokens.textMuted, flexShrink: 0 }} />
                        <TextField
                            size="small"
                            fullWidth
                            placeholder={t('nui_reports.image_url_optional')}
                            value={imageUrl}
                            onChange={(e) => setImageUrl(e.target.value.slice(0, URL_MAX))}
                            disabled={sending}
                            inputProps={{ style: { fontSize: '0.75rem' }, maxLength: URL_MAX }}
                            sx={{
                                ...inputSx,
                                flex: 1,
                                '& .MuiOutlinedInput-root': { ...inputSx['& .MuiOutlinedInput-root'], py: 0.25 },
                            }}
                        />
                    </Box>
                </Box>
            )}
            {isClosed && (
                <Typography variant="body2" sx={{ color: tokens.success, textAlign: 'center', ...boundedTextSx }}>
                    {t('nui_reports.ticket_has_been', { status: statusMap[ticket.status]?.label ?? ticket.status })}
                </Typography>
            )}
        </Box>
    );
};

const FeedbackView: React.FC<{
    ticketId: string;
    onSubmit: (ticketId: string, rating: number, comment?: string) => void;
    submitting: boolean;
}> = ({ ticketId, onSubmit, submitting }) => {
    const t = useTranslate();
    const { tokens } = useTheme();
    const inputSx = getInputSx(tokens);
    const [rating, setRating] = useState<number | null>(null);
    const [comment, setComment] = useState('');

    return (
        <Box display="flex" flexDirection="column" gap={2} alignItems="center" py={2} minWidth={0}>
            <Star sx={{ fontSize: 40, color: tokens.warning }} />
            <Typography
                variant="body1"
                fontWeight={600}
                sx={{ color: tokens.textPrimary, textAlign: 'center', ...boundedTextSx }}
            >
                {t('nui_reports.feedback_title')}
            </Typography>
            <Rating size="large" value={rating} onChange={(_, val) => setRating(val)} sx={{ color: tokens.warning }} />
            <TextField
                label={t('nui_reports.comments_optional')}
                multiline
                rows={2}
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, 512))}
                fullWidth
                size="small"
                sx={inputSx}
            />
            <Button
                variant="contained"
                onClick={() => rating && onSubmit(ticketId, rating, comment || undefined)}
                disabled={!rating || submitting}
                sx={{
                    textTransform: 'none',
                    bgcolor: tokens.accent,
                    color: tokens.accentContrast,
                    '&:hover': { bgcolor: tokens.accent, filter: 'brightness(1.15)' },
                    '&.Mui-disabled': { bgcolor: tokens.border, color: tokens.textMuted },
                }}
            >
                {submitting ? t('nui_reports.submitting') : t('nui_reports.submit_feedback')}
            </Button>
        </Box>
    );
};

// =============================================
// Main Ticket Page
// =============================================

export const ReportPage: React.FC = () => {
    const t = useTranslate();
    const { tokens } = useTheme();
    const [isOpen, setIsOpen] = useState(false);
    const [view, setView] = useState<View>('menu');
    const [players, setPlayers] = useState<PlayerTarget[]>([]);
    const [categories, setCategories] = useState<string[]>([]);
    const [priorityEnabled, setPriorityEnabled] = useState(false);
    const [tickets, setTickets] = useState<PlayerTicketSummary[]>([]);
    const [selectedTicket, setSelectedTicket] = useState<PlayerTicketSummary | null>(null);
    const [ticketMessages, setTicketMessages] = useState<TicketMessage[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [sendingMessage, setSendingMessage] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const setListenForExit = useSetListenForExit();

    const handleClose = useCallback(() => {
        (document.activeElement as HTMLElement | null)?.blur?.();
        setIsOpen(false);
        setView('menu');
        setSelectedTicket(null);
        setTicketMessages([]);
        setErrorMessage(null);
        setListenForExit(true);
        fetchNui('ticketClose').catch(() => {});
    }, [setListenForExit]);

    // Listen for open event from Lua
    useNuiEvent<{
        players: PlayerTarget[];
        tickets?: PlayerTicketSummary[];
        categories: string[];
        priorityEnabled: boolean;
        /** Browser-dev only — Lua never sends this. */
        initialView?: View;
    }>('openTicketUI', (data) => {
        //Normalize Lua-bridge payloads: empty tables arrive as `{}`, nil fields are omitted
        setPlayers(asArray(data.players));
        setCategories(asArray(data.categories));
        setPriorityEnabled(data.priorityEnabled ?? false);
        if (data.tickets) setTickets(asArray(data.tickets));
        setIsOpen(true);
        setView(data.initialView ?? 'menu');
        setListenForExit(false);
    });

    // Browser-dev helper (see window.menuDebug.closeReportUI)
    useNuiEvent('closeTicketUI', () => {
        handleClose();
    });

    // Listen for ticket list updates
    useNuiEvent<{ tickets?: PlayerTicketSummary[]; error?: string }>('ticketMyList', (data) => {
        if (data.tickets) {
            const ticketList = asArray<PlayerTicketSummary>(data.tickets);
            setTickets(ticketList);
            if (selectedTicket) {
                const updated = ticketList.find((t) => t.id === selectedTicket.id);
                if (updated) setSelectedTicket(updated);
            }
        }
    });

    // Listen for ticket creation result
    useNuiEvent<{ success?: boolean; ticketId?: string; error?: string }>('ticketCreateResult', (data) => {
        setSubmitting(false);
        if (data.success) {
            setErrorMessage(null);
            fetchNui('ticketFetchMine').catch(() => {});
            setView('list');
        } else if (data.error) {
            setErrorMessage(translateTicketError(t, data.error) ?? data.error);
        }
    });

    // Listen for message send result
    useNuiEvent<{ success?: boolean; error?: string }>('ticketMessageResult', (data) => {
        setSendingMessage(false);
        if (data.success) {
            setErrorMessage(null);
            fetchNui('ticketFetchMine').catch(() => {});
            if (selectedTicket) {
                fetchNui('ticketFetchMessages', { ticketId: selectedTicket.id }).catch(() => {});
            }
        } else if (data.error) {
            setErrorMessage(translateTicketError(t, data.error) ?? data.error);
        }
    });

    // Listen for full message list (fetched on ticket open)
    useNuiEvent<{ messages?: TicketMessage[]; error?: string }>('ticketMessages', (data) => {
        if (data.messages) setTicketMessages(asArray(data.messages));
    });

    // Listen for a real-time message push (from admin panel, in-game admin, or Discord)
    useNuiEvent<{ ticketId: string; message: TicketMessage }>('ticketNewMessage', (data) => {
        if (selectedTicket?.id === data.ticketId) {
            setTicketMessages((prev) => [...prev, data.message]);
        }
    });

    // ESC to close
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (view === 'feedback') {
                    setView('list');
                    setSelectedTicket(null);
                } else if (view === 'detail') {
                    setView('list');
                    setSelectedTicket(null);
                    setTicketMessages([]);
                } else if (view === 'create' || view === 'list') {
                    setView('menu');
                } else {
                    handleClose();
                }
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [isOpen, view, handleClose]);

    const handleSubmit = (category: string, description: string, targetIds: number[], priority?: string) => {
        setSubmitting(true);
        setErrorMessage(null);
        fetchNui('ticketSubmit', { category, description, targetIds, priority }).catch((err) => {
            setSubmitting(false);
            setErrorMessage(
                t('nui_reports.failed_submit_ticket', {
                    message: (err as Error).message || t('nui_menu.misc.unknown_error'),
                }),
            );
        });
    };

    const handleSendMessage = (ticketId: string, content: string, imageUrls?: string[]) => {
        setSendingMessage(true);
        setErrorMessage(null);
        fetchNui('ticketSendMessage', { ticketId, content, imageUrls }).catch((err) => {
            setSendingMessage(false);
            setErrorMessage(
                t('nui_reports.failed_send_message', {
                    message: (err as Error).message || t('nui_menu.misc.unknown_error'),
                }),
            );
        });
    };

    const handleViewList = () => {
        setView('list');
        fetchNui('ticketFetchMine').catch(() => {});
    };

    const handleSelectTicket = (ticket: PlayerTicketSummary) => {
        setSelectedTicket(ticket);
        setTicketMessages([]);
        if (ticket.awaitingFeedback) {
            setView('feedback');
        } else {
            setView('detail');
            fetchNui('ticketFetchMessages', { ticketId: ticket.id }).catch(() => {});
        }
    };

    const handleFeedbackSubmit = (ticketId: string, rating: number, comment?: string) => {
        setSubmitting(true);
        fetchNui('ticketFeedback', { ticketId, rating, comment })
            .then(() => {
                setView('list');
                setSelectedTicket(null);
                fetchNui('ticketFetchMine').catch(() => {});
            })
            .catch((err) => {
                console.error('Failed to submit ticket feedback:', err);
                setErrorMessage((err as Error)?.message || t('nui_reports.failed_submit_feedback'));
            })
            .finally(() => {
                setSubmitting(false);
            });
    };

    const getTitle = (): string => {
        switch (view) {
            case 'menu':
                return t('nui_reports.title_menu');
            case 'create':
                return t('nui_reports.title_create');
            case 'list':
                return t('nui_reports.title_list');
            case 'detail':
                return t('nui_reports.title_detail');
            case 'feedback':
                return t('nui_reports.title_feedback');
        }
    };

    const handleBack = () => {
        setErrorMessage(null);
        if (view === 'feedback' || view === 'detail') {
            setView('list');
            setSelectedTicket(null);
            setTicketMessages([]);
        } else if (view === 'create' || view === 'list') {
            setView('menu');
        }
    };

    return (
        <Modal
            open={isOpen}
            onClose={handleClose}
            disablePortal
            keepMounted
            hideBackdrop
            disableEscapeKeyDown
            aria-labelledby="ticket-dialog-title"
            sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1200,
                color: tokens.textPrimary,
                boxSizing: 'border-box',
            }}
        >
            <Panel role="dialog" aria-modal="true" aria-labelledby="ticket-dialog-title">
                <Header>
                    <Box display="flex" alignItems="center" gap={1} minWidth={0} flex={1}>
                        {view !== 'menu' && (
                            <Button
                                size="small"
                                onClick={handleBack}
                                sx={{
                                    minWidth: 0,
                                    textTransform: 'none',
                                    mr: 0.5,
                                    color: tokens.textMuted,
                                    flexShrink: 0,
                                }}
                            >
                                {t('nui_reports.back')}
                            </Button>
                        )}
                        <Typography
                            id="ticket-dialog-title"
                            variant="subtitle1"
                            fontWeight={600}
                            noWrap
                            sx={{ color: tokens.textPrimary, ...ellipsisTextSx }}
                        >
                            {getTitle()}
                        </Typography>
                    </Box>
                    <IconButton size="small" onClick={handleClose} sx={{ color: tokens.textMuted, flexShrink: 0 }}>
                        <Close fontSize="small" />
                    </IconButton>
                </Header>

                <Content>
                    {errorMessage && (
                        <Box
                            role="alert"
                            sx={{ px: 2, py: 1, mb: 1, bgcolor: alpha(tokens.error, 0.15), borderRadius: 1 }}
                        >
                            <Typography variant="body2" sx={{ color: tokens.error, ...boundedTextSx }}>
                                {errorMessage}
                            </Typography>
                        </Box>
                    )}
                    {view === 'menu' && (
                        <MenuView
                            onSelect={(v) => {
                                if (v === 'list') handleViewList();
                                else setView(v);
                            }}
                            ticketCount={tickets.length}
                        />
                    )}
                    {view === 'create' && (
                        <CreateView
                            players={players}
                            categories={categories}
                            priorityEnabled={priorityEnabled}
                            onSubmit={handleSubmit}
                            submitting={submitting}
                        />
                    )}
                    {view === 'list' && <ListView tickets={tickets} onSelect={handleSelectTicket} />}
                    {view === 'detail' && selectedTicket && (
                        <DetailView
                            ticket={selectedTicket}
                            messages={ticketMessages}
                            onSendMessage={handleSendMessage}
                            sending={sendingMessage}
                        />
                    )}
                    {view === 'feedback' && selectedTicket && (
                        <FeedbackView
                            ticketId={selectedTicket.id}
                            onSubmit={handleFeedbackSubmit}
                            submitting={submitting}
                        />
                    )}
                </Content>
            </Panel>
        </Modal>
    );
};
