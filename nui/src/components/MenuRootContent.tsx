import React from 'react';
import { Box, Collapse, styled, Typography, useTheme } from '@mui/material';
import { useTranslate } from 'react-polyglot';
import { txAdminMenuPage, usePageValue } from '@nui/src/state/page.state';
import { MainPageList } from '@nui/src/components/MainPage/MainPageList';
import { useServerCtxValue } from '@nui/src/state/server.state';
import { useDebounce } from '@nui/src/hooks/useDebouce';
import { StaffStatus, useStaffStatusValue } from '@nui/src/state/staffTools.state';
import { PlayerMode } from '@nui/src/state/playermode.state';

const StyledRoot = styled(Box)(({ theme }) => ({
    height: 'fit-content',
    backgroundColor: theme.tokens.surface,
    width: '100%',
    boxSizing: 'border-box',
    borderRadius: theme.tokens.radiusCard,
    border: `1px solid ${theme.tokens.border}`,
    display: 'flex',
    flexDirection: 'column',
    userSelect: 'none',
}));

const HeaderRow = styled(Box)({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 24,
});

const StatusStrip = styled(Box)({
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
    minHeight: 20,
    alignItems: 'center',
});

const StatusChip = styled('span')(({ theme }) => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 10,
    fontWeight: 600,
    lineHeight: 1,
    padding: '4px 7px',
    borderRadius: theme.tokens.radiusPill,
    color: theme.tokens.textPrimary,
    backgroundColor: theme.tokens.accentTint,
    border: `1px solid ${theme.tokens.accentBorder}`,
    '&::before': {
        content: '""',
        width: 5,
        height: 5,
        borderRadius: '50%',
        backgroundColor: theme.tokens.success,
        boxShadow: `0 0 6px ${theme.tokens.success}`,
    },
}));

const Footer = styled(Box)(({ theme }) => ({
    display: 'flex',
    justifyContent: 'space-between',
    gap: 6,
    marginTop: 8,
    paddingTop: 8,
    borderTop: `1px solid ${theme.tokens.border}`,
}));

const Hint = styled('span')(({ theme }) => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 10,
    color: theme.tokens.textMuted,
    whiteSpace: 'nowrap',
}));

const Kbd = styled('span')(({ theme }) => ({
    fontSize: 9,
    fontWeight: 700,
    lineHeight: 1,
    padding: '2px 4px',
    borderRadius: 4,
    color: theme.tokens.textPrimary,
    backgroundColor: theme.tokens.surfaceHover,
    border: `1px solid ${theme.tokens.borderStrong}`,
}));

const playerModeStatusKeys: Partial<Record<PlayerMode, string>> = {
    [PlayerMode.NOCLIP]: 'noclip',
    [PlayerMode.GOD_MODE]: 'godmode',
    [PlayerMode.SUPER_JUMP]: 'superjump',
};

const toggleStatusKeys: [keyof StaffStatus, string][] = [
    ['invisible', 'invisible'],
    ['playerIds', 'player_ids'],
    ['mapBlips', 'map_blips'],
    ['coordsHud', 'coords_hud'],
    ['inspector', 'inspector'],
];

/** Chips for every staff mode/tool currently active */
const ActiveStatusStrip: React.FC = () => {
    const t = useTranslate();
    const status = useStaffStatusValue();

    const activeKeys: string[] = [];
    const modeKey = playerModeStatusKeys[status.playerMode];
    if (modeKey) activeKeys.push(modeKey);
    for (const [statusKey, localeKey] of toggleStatusKeys) {
        if (status[statusKey]) activeKeys.push(localeKey);
    }

    return (
        <StatusStrip>
            {activeKeys.length ? (
                activeKeys.map((key) => <StatusChip key={key}>{t(`nui_menu.page_main.status.${key}`)}</StatusChip>)
            ) : (
                <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                    {t('nui_menu.page_main.status.none')}
                </Typography>
            )}
        </StatusStrip>
    );
};

/**
 * The menu card: wordmark header, active modes strip, the Main page list and
 * the keyboard hints. The page tab bar lives outside this card as a detached
 * pill bar (see MenuRoot). The whole card is only shown on the Main page.
 */
export const MenuRootContent: React.FC = React.memo(() => {
    const t = useTranslate();
    const serverCtx = useServerCtxValue();
    const curPage = usePageValue();
    const theme = useTheme();

    // Hack to prevent collapse transition from breaking
    // In some cases, i.e, when setting target player from playerModal
    // Collapse transition can break due to multiple page updates within a short
    // time frame
    const debouncedCurPage = useDebounce(curPage, 50);

    return (
        <Collapse in={debouncedCurPage === txAdminMenuPage.Main} mountOnEnter>
            <StyledRoot px={1.5} pt={1.25} pb={1}>
                <HeaderRow mb={0.75}>
                    <img
                        src="images/sxPanel.png"
                        alt="sxPanel"
                        style={{ height: 16, width: 'auto', display: 'block' }}
                    />
                    <Typography
                        style={{
                            fontWeight: 500,
                            fontSize: 11,
                            color: theme.tokens.textMuted,
                        }}
                    >
                        v{serverCtx.sxPanelVersion}
                    </Typography>
                </HeaderRow>
                <ActiveStatusStrip />
                <MainPageList />
                <Footer>
                    <Hint>
                        <Kbd>↑↓</Kbd>
                        {t('nui_menu.page_main.hints.navigate')}
                    </Hint>
                    <Hint>
                        <Kbd>←→</Kbd>
                        {t('nui_menu.page_main.hints.options')}
                    </Hint>
                    <Hint>
                        <Kbd>↵</Kbd>
                        {t('nui_menu.page_main.hints.select')}
                    </Hint>
                    <Hint>
                        <Kbd>{serverCtx.switchPageKey}</Kbd>
                        {t('nui_menu.page_main.hints.pages')}
                    </Hint>
                </Footer>
            </StyledRoot>
        </Collapse>
    );
});
