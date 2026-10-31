import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, List, styled } from '@mui/material';
import { useTranslate } from 'react-polyglot';
import { MenuListItem, MenuListItemMulti } from './MenuListItem';
import { useKeyboardNavigation } from '../../hooks/useKeyboardNavigation';
import { fetchNui } from '../../utils/fetchNui';
import { useIsMenuVisibleValue } from '../../state/visibility.state';
import { usePlayerModeActions } from './actions/usePlayerModeActions';
import { useTeleportActions } from './actions/useTeleportActions';
import { useVehicleActions } from './actions/useVehicleActions';
import { useHealActions } from './actions/useHealActions';
import { useMiscActions } from './actions/useMiscActions';
import { useServerActions } from './actions/useServerActions';
import { useStaffActions } from './actions/useStaffActions';

const fadeHeight = 18;
// Fill the screen height (minus the tab bar, card header and hint footer),
// capped so the card does not become a wall on tall resolutions.
const listMaxHeight = 'min(540px, calc(100vh - var(--menu-tabbar-height, 52px) - 200px))';

const ListWrapper = styled(Box)({
    position: 'relative',
    overflow: 'hidden',
});

const Fade = styled(Box)(({ theme }) => ({
    position: 'absolute',
    left: 0,
    right: 0,
    height: fadeHeight,
    pointerEvents: 'none',
    zIndex: 2,
    transition: 'opacity 120ms ease',
    '&[data-edge="top"]': {
        top: 0,
        backgroundImage: `linear-gradient(to bottom, ${theme.tokens.surface}, transparent)`,
    },
    '&[data-edge="bottom"]': {
        bottom: 0,
        backgroundImage: `linear-gradient(to top, ${theme.tokens.surface}, transparent)`,
    },
}));

const StyledList = styled(List)({
    maxHeight: listMaxHeight,
    overflow: 'auto',
    padding: 0,
    '&::-webkit-scrollbar': {
        display: 'none',
    },
});

const SectionHeader = styled('li')(({ theme }) => ({
    listStyle: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 2px 4px',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: theme.tokens.textMuted,
    '&:first-of-type': {
        paddingTop: 2,
    },
    '&::after': {
        content: '""',
        flex: 1,
        height: 1,
        backgroundColor: theme.tokens.border,
    },
}));

type MenuItemDef = Record<string, any>;

interface MenuSection {
    key: string;
    items: MenuItemDef[];
}

export const MainPageList: React.FC = () => {
    const t = useTranslate();
    const [curSelected, setCurSelected] = useState(0);
    const [fades, setFades] = useState({ top: false, bottom: false });
    const listRef = useRef<HTMLUListElement | null>(null);
    const menuVisible = useIsMenuVisibleValue();

    const { menuItem: playerModeItem } = usePlayerModeActions();
    const { menuItem: teleportItem } = useTeleportActions();
    const { menuItem: vehicleItem } = useVehicleActions();
    const { menuItem: healItem } = useHealActions();
    const { announcementItem, clearAreaItem, togglesItem } = useMiscActions();
    const { invisibleItem, cleanupVehiclesItem, devToolsItem, staffChatItem } = useStaffActions();
    const { menuItems: serverItems } = useServerActions();

    useEffect(() => {
        if (!menuVisible) setCurSelected(0);
    }, [menuVisible]);

    const sections: MenuSection[] = useMemo(
        () => [
            { key: 'self', items: [playerModeItem, invisibleItem, healItem] },
            { key: 'teleport', items: [teleportItem] },
            { key: 'vehicle', items: [vehicleItem, cleanupVehiclesItem] },
            { key: 'world', items: [clearAreaItem, togglesItem] },
            { key: 'staff', items: [staffChatItem, announcementItem, devToolsItem] },
            { key: 'server', items: serverItems },
        ],
        [
            playerModeItem,
            invisibleItem,
            healItem,
            teleportItem,
            vehicleItem,
            cleanupVehiclesItem,
            clearAreaItem,
            togglesItem,
            staffChatItem,
            announcementItem,
            devToolsItem,
            serverItems,
        ],
    );
    const itemCount = sections.reduce((acc, section) => acc + section.items.length, 0);

    //=============================================
    const handleArrowDown = useCallback(() => {
        const next = curSelected + 1;
        fetchNui('playSound', 'move').catch();
        setCurSelected(next >= itemCount ? 0 : next);
    }, [curSelected, itemCount]);

    const handleArrowUp = useCallback(() => {
        const next = curSelected - 1;
        fetchNui('playSound', 'move').catch();
        setCurSelected(next < 0 ? itemCount - 1 : next);
    }, [curSelected, itemCount]);

    useKeyboardNavigation({
        onDownDown: handleArrowDown,
        onUpDown: handleArrowUp,
        disableOnFocused: true,
    });

    // Show the edge fades only when there is more content in that direction
    const updateFades = useCallback(() => {
        const el = listRef.current;
        if (!el) return;
        const top = el.scrollTop > 2;
        const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
        setFades((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
    }, []);
    useEffect(() => {
        updateFades();
        window.addEventListener('resize', updateFades);
        return () => window.removeEventListener('resize', updateFades);
    }, [updateFades, itemCount]);

    let flatIndex = 0;
    return (
        <Box sx={{ pointerEvents: 'none' }}>
            <ListWrapper>
                <StyledList ref={listRef} onScroll={updateFades} sx={{ pointerEvents: 'auto' }}>
                    {sections.map((section) => (
                        <React.Fragment key={section.key}>
                            <SectionHeader>{t(`nui_menu.page_main.sections.${section.key}`)}</SectionHeader>
                            {section.items.map((item) => {
                                const index = flatIndex++;
                                return 'isMultiAction' in item && item.isMultiAction ? (
                                    // @ts-ignore
                                    <MenuListItemMulti key={index} selected={curSelected === index} {...item} />
                                ) : (
                                    // @ts-ignore
                                    <MenuListItem key={index} selected={curSelected === index} {...item} />
                                );
                            })}
                        </React.Fragment>
                    ))}
                </StyledList>
                <Fade data-edge="top" style={{ opacity: fades.top ? 1 : 0 }} />
                <Fade data-edge="bottom" style={{ opacity: fades.bottom ? 1 : 0 }} />
            </ListWrapper>
        </Box>
    );
};
