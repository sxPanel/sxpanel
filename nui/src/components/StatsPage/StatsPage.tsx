import React, { useCallback, useEffect, useState } from 'react';
import { Box, IconButton, styled, Typography, useTheme } from '@mui/material';
import { AccessTimeOutlined, ExtensionOutlined, GroupsOutlined, HubOutlined, Refresh } from '@mui/icons-material';
import { txAdminMenuPage, usePageValue } from '@nui/src/state/page.state';
import { useServerCtxValue } from '@nui/src/state/server.state';
import { useNuiEvent } from '@nui/src/hooks/useNuiEvent';
import { fetchNui } from '@nui/src/utils/fetchNui';
import { useTranslate } from 'react-polyglot';

const RootStyled = styled(Box)(({ theme }) => ({
    backgroundColor: theme.tokens.surface,
    boxShadow: theme.tokens.shadowCard,
    border: `1px solid ${theme.tokens.border}`,
    height: 'fit-content',
    minWidth: 0,
    boxSizing: 'border-box',
    overflow: 'hidden',
    borderRadius: theme.tokens.radiusCard,
    flexDirection: 'column',
}));

const TileGrid = styled(Box)({
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 10,
});

const Tile = styled(Box)(({ theme }) => ({
    padding: '14px 16px',
    borderRadius: theme.tokens.radiusRow,
    border: `1px solid ${theme.tokens.border}`,
    backgroundColor: theme.tokens.surfaceRaised,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    minWidth: 0,
}));

const TileIconBadge = styled(Box)(({ theme }) => ({
    width: 28,
    height: 28,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.tokens.surfaceHover,
    color: theme.tokens.accent,
    '& svg': { fontSize: 16 },
}));

const tileLabelSx = {
    fontWeight: 700,
    fontSize: '0.68rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
};

interface StatsSnapshot {
    playerCount: number;
    resourceCount: number;
    uptimeSeconds: number;
}

function formatUptime(totalSeconds: number): string {
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

const REFRESH_INTERVAL_MS = 10000;

export const StatsPage: React.FC<{ visible: boolean }> = ({ visible }) => {
    const t = useTranslate();
    const theme = useTheme();
    const curPage = usePageValue();
    const serverCtx = useServerCtxValue();
    const [stats, setStats] = useState<StatsSnapshot | null>(null);
    const [loading, setLoading] = useState(false);
    const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

    const handleRefresh = useCallback(() => {
        setLoading(true);
        fetchNui('getStats').catch(() => setLoading(false));
    }, []);

    useNuiEvent<StatsSnapshot>('setStats', (data) => {
        setStats(data);
        setLoading(false);
        setHasLoadedOnce(true);
    });

    useEffect(() => {
        if (curPage !== txAdminMenuPage.Stats) return;
        handleRefresh();
        const interval = setInterval(handleRefresh, REFRESH_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [curPage, handleRefresh]);

    const oneSyncLabel = serverCtx.oneSync.status ? (serverCtx.oneSync.type ?? 'on').toUpperCase() : 'OFF';

    return (
        <RootStyled mt={2} mb={10} pt={2} px={2} display={visible ? 'flex' : 'none'}>
            <Box display="flex" alignItems="center" justifyContent="space-between" gap={1} mb={1.5} minWidth={0}>
                <Typography
                    variant="subtitle1"
                    fontWeight={700}
                    sx={{ color: theme.tokens.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                    {serverCtx.projectName || t('nui_stats.title')}
                </Typography>
                <IconButton
                    size="small"
                    onClick={handleRefresh}
                    disabled={loading}
                    title={t('nui_stats.refresh')}
                    sx={{ color: theme.tokens.textMuted, flexShrink: 0 }}
                >
                    <Refresh fontSize="small" />
                </IconButton>
            </Box>

            {!hasLoadedOnce && loading ? (
                <Box textAlign="center" py={4}>
                    <Typography variant="body2" sx={{ color: theme.tokens.textMuted }}>
                        {t('nui_stats.loading')}
                    </Typography>
                </Box>
            ) : (
                <TileGrid mb={1}>
                    <Tile>
                        <TileIconBadge>
                            <GroupsOutlined />
                        </TileIconBadge>
                        <Typography variant="caption" sx={{ color: theme.tokens.textMuted, ...tileLabelSx }}>
                            {t('nui_stats.players_online')}
                        </Typography>
                        <Typography variant="h6" fontWeight={700} sx={{ color: theme.tokens.textPrimary, lineHeight: 1.2 }}>
                            {stats ? `${stats.playerCount} / ${serverCtx.maxClients}` : '—'}
                        </Typography>
                    </Tile>
                    <Tile>
                        <TileIconBadge>
                            <HubOutlined />
                        </TileIconBadge>
                        <Typography variant="caption" sx={{ color: theme.tokens.textMuted, ...tileLabelSx }}>
                            {t('nui_stats.onesync')}
                        </Typography>
                        <Typography variant="h6" fontWeight={700} sx={{ color: theme.tokens.textPrimary, lineHeight: 1.2 }}>
                            {oneSyncLabel}
                        </Typography>
                    </Tile>
                    <Tile>
                        <TileIconBadge>
                            <ExtensionOutlined />
                        </TileIconBadge>
                        <Typography variant="caption" sx={{ color: theme.tokens.textMuted, ...tileLabelSx }}>
                            {t('nui_stats.resources')}
                        </Typography>
                        <Typography variant="h6" fontWeight={700} sx={{ color: theme.tokens.textPrimary, lineHeight: 1.2 }}>
                            {stats ? stats.resourceCount : '—'}
                        </Typography>
                    </Tile>
                    <Tile>
                        <TileIconBadge>
                            <AccessTimeOutlined />
                        </TileIconBadge>
                        <Typography variant="caption" sx={{ color: theme.tokens.textMuted, ...tileLabelSx }}>
                            {t('nui_stats.uptime')}
                        </Typography>
                        <Typography variant="h6" fontWeight={700} sx={{ color: theme.tokens.textPrimary, lineHeight: 1.2 }}>
                            {stats ? formatUptime(stats.uptimeSeconds) : '—'}
                        </Typography>
                    </Tile>
                </TileGrid>
            )}
        </RootStyled>
    );
};
