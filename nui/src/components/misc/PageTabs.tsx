import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { Box, ButtonBase, styled } from '@mui/material';
import {
    ExtensionOutlined,
    FlagOutlined,
    GroupsOutlined,
    HomeOutlined,
    QueryStatsOutlined,
} from '@mui/icons-material';
import { getEnabledMenuPages, getNextMenuPage, txAdminMenuPage, usePage } from '../../state/page.state';
import { useKey } from '../../hooks/useKey';
import { useTabDisabledValue } from '../../state/keys.state';
import { useIsMenuVisibleValue } from '../../state/visibility.state';
import { useServerCtxValue } from '../../state/server.state';
import { usePermissionsValue } from '../../state/permissions.state';
import { userHasPerm } from '../../utils/miscUtils';

interface BarRootProps {
    //When the Main card is showing directly below, the tab strip fuses into
    //it as one continuous panel (flat shared edge, no gap/second shadow) —
    //deliberately not the classic "floating pill above a separate card" shape.
    fused: boolean;
}

const BarRoot = styled(Box, {
    shouldForwardProp: (prop) => prop !== 'fused',
})<BarRootProps>(({ theme, fused }) => ({
    display: 'flex',
    gap: 4,
    padding: 4,
    width: '100%',
    boxSizing: 'border-box',
    backgroundColor: theme.tokens.surface,
    boxShadow: theme.tokens.shadowCard,
    border: `1px solid ${theme.tokens.border}`,
    borderBottom: fused ? 'none' : `1px solid ${theme.tokens.border}`,
    borderRadius: fused ? `${theme.tokens.radiusRow + 2}px ${theme.tokens.radiusRow + 2}px 0 0` : theme.tokens.radiusRow + 2,
    userSelect: 'none',
}));

interface SegmentProps {
    active: boolean;
    //Five tabs only fit the fixed-width bar with tighter spacing
    compact: boolean;
}

const Segment = styled(ButtonBase, {
    shouldForwardProp: (prop) => prop !== 'active' && prop !== 'compact',
})<SegmentProps>(({ theme, active, compact }) => ({
    flex: 1,
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: compact ? 3 : 6,
    padding: '7px 0',
    letterSpacing: compact ? 0 : '0.04em',
    borderRadius: theme.tokens.radiusRow,
    color: active ? theme.tokens.accentContrast : theme.tokens.textMuted,
    background: active ? theme.tokens.accentGradient : 'transparent',
    boxShadow: active ? theme.tokens.accentGlow : 'none',
    transition: 'color 120ms ease, background 120ms ease, box-shadow 120ms ease',
    '&:hover': {
        background: active ? theme.tokens.accentGradient : theme.tokens.surfaceHover,
        color: active ? theme.tokens.accentContrast : theme.tokens.textPrimary,
    },
    '& svg': {
        fontSize: 15,
    },
}));

const SegmentLabel = styled('span')({
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 'inherit',
    lineHeight: 1,
});

interface PageSegmentDef {
    page: txAdminMenuPage;
    label: string;
    icon: React.ReactNode;
}

/**
 * Segmented tab strip above the menu card. Fuses flush with the Main card
 * (shared border, no gap) so the two read as one panel; on Players/Reports
 * it stands alone above the wider page. Keeps the same page value semantics
 * and Tab-key cycle as the old MUI Tabs strip it replaced.
 */
export const PageTabs: React.FC = () => {
    const [page, setPage] = usePage();
    const tabDisabled = useTabDisabledValue();
    const visible = useIsMenuVisibleValue();
    const serverCtx = useServerCtxValue();

    const reportsEnabled = serverCtx.reportsEnabled;
    //Only decides whether the tab is shown; core re-checks the permission on every request
    const resourcesEnabled = userHasPerm('commands.resources', usePermissionsValue());
    const isPageEnabled = getEnabledMenuPages({ reportsEnabled, resourcesEnabled }).includes(page);
    const activePage = isPageEnabled ? page : txAdminMenuPage.Main;

    useEffect(() => {
        if (!isPageEnabled) {
            setPage(txAdminMenuPage.Main);
        }
    }, [isPageEnabled, setPage]);

    const handleTabPress = useCallback(() => {
        if (tabDisabled || !visible) return;
        setPage((prevState) => getNextMenuPage(prevState, { reportsEnabled, resourcesEnabled }));
    }, [tabDisabled, visible, setPage, reportsEnabled, resourcesEnabled]);

    useKey(serverCtx.switchPageKey, handleTabPress);

    const segments: PageSegmentDef[] = [
        { page: txAdminMenuPage.Main, label: 'Main', icon: <HomeOutlined /> },
        { page: txAdminMenuPage.Players, label: 'Players', icon: <GroupsOutlined /> },
        { page: txAdminMenuPage.Stats, label: 'Stats', icon: <QueryStatsOutlined /> },
    ];
    if (resourcesEnabled) {
        segments.push({ page: txAdminMenuPage.Resources, label: 'Resources', icon: <ExtensionOutlined /> });
    }
    if (reportsEnabled) {
        segments.push({ page: txAdminMenuPage.Reports, label: 'Reports', icon: <FlagOutlined /> });
    }
    const barRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const barEl = barRef.current;
        if (!barEl) return;

        const syncTabBarHeight = () => {
            const height = Math.ceil(barEl.getBoundingClientRect().height);
            document.documentElement.style.setProperty('--menu-tabbar-height', `${height}px`);
        };

        syncTabBarHeight();

        const resizeObserver = new ResizeObserver(syncTabBarHeight);
        resizeObserver.observe(barEl);
        return () => resizeObserver.disconnect();
    }, [segments.length]);

    return (
        <BarRoot ref={barRef} fused={activePage === txAdminMenuPage.Main}>
            {segments.map((segment) => (
                <Segment
                    key={segment.page}
                    active={activePage === segment.page}
                    compact={segments.length > 4}
                    onClick={() => setPage(segment.page)}
                    tabIndex={-1}
                    disableRipple
                    aria-label={segment.label}
                >
                    {segment.icon}
                    <SegmentLabel>{segment.label}</SegmentLabel>
                </Segment>
            ))}
        </BarRoot>
    );
};
