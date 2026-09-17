import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, List, styled } from '@mui/material';
import { MenuListItem, MenuListItemMulti } from './MenuListItem';
import { ExpandMore } from '@mui/icons-material';
import { useKeyboardNavigation } from '../../hooks/useKeyboardNavigation';
import { fetchNui } from '../../utils/fetchNui';
import { useIsMenuVisibleValue } from '../../state/visibility.state';
import { usePlayerModeActions } from './actions/usePlayerModeActions';
import { useTeleportActions } from './actions/useTeleportActions';
import { useVehicleActions } from './actions/useVehicleActions';
import { useHealActions } from './actions/useHealActions';
import { useMiscActions } from './actions/useMiscActions';
import { useServerActions } from './actions/useServerActions';

const fadeHeight = 16;
// Sized to comfortably fit all default main-page rows (Player Mode, Teleport,
// Vehicle, Heal, Announcement, Reset World Area, Toggles) without scrolling.
// This is a ceiling, not a fixed height, so it only kicks in (with scroll +
// fades) if more rows are added later or labels wrap to extra lines.
const listHeight = 280;

interface ListWrapperProps {
    fadeTop: boolean;
    fadeBottom: boolean;
}

//The card is translucent glass, so overflow is hinted by masking the list
//content itself (overlay gradients would stack on the surface and read as
//dark bands over the blur).
const ListWrapper = styled(Box, {
    shouldForwardProp: (prop) => prop !== 'fadeTop' && prop !== 'fadeBottom',
})<ListWrapperProps>(({ fadeTop, fadeBottom }) => {
    const top = fadeTop ? `transparent 0, black ${fadeHeight}px` : 'black 0';
    const bottom = fadeBottom ? `black calc(100% - ${fadeHeight}px), transparent 100%` : 'black 100%';
    const mask = `linear-gradient(to bottom, ${top}, ${bottom})`;
    return {
        position: 'relative',
        maxHeight: listHeight,
        overflow: 'hidden',
        maskImage: mask,
        WebkitMaskImage: mask,
    };
});

const BoxIcon = styled(Box)(({ theme }) => ({
    color: theme.palette.text.secondary,
    marginTop: 0,
    display: 'flex',
    justifyContent: 'center',
    '& svg': {
        fontSize: 18,
    },
}));

const StyledList = styled(List)({
    maxHeight: listHeight,
    overflow: 'auto',
    // MUI's List defaults to 8px top/bottom padding, which was silently
    // eating into the row-height savings below and keeping the list just
    // tall enough to still need a scroll. Strip it so the cap above is the
    // only thing governing height.
    padding: 0,
    '&::-webkit-scrollbar': {
        display: 'none',
    },
});

interface SectionLabelProps {
    first: boolean;
}

//Non-interactive group heading — deliberately not part of menuListItems, so
//arrow-key navigation and curSelected indexing skip straight over it.
const SectionLabel = styled(Box, {
    shouldForwardProp: (prop) => prop !== 'first',
})<SectionLabelProps>(({ theme, first }) => ({
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: theme.tokens.textMuted,
    padding: first ? '2px 4px 6px' : '10px 4px 6px',
    marginTop: first ? 0 : 4,
    borderTop: first ? 'none' : `1px solid ${theme.tokens.border}`,
}));

export const MainPageList: React.FC = () => {
    const [curSelected, setCurSelected] = useState(0);
    const menuVisible = useIsMenuVisibleValue();

    const { playerMode, menuItem: playerModeItem } = usePlayerModeActions();
    const { teleportMode, menuItem: teleportItem } = useTeleportActions();
    const { vehicleMode, serverCtx, isRedm, menuItem: vehicleItem } = useVehicleActions();
    const { healMode, menuItem: healItem } = useHealActions();
    const { menuItems: miscItems } = useMiscActions();
    const { menuItems: serverItems } = useServerActions();

    //useMiscActions returns [announcement, clearArea, toggles] in that order
    const [announcementItem, clearAreaItem, toggleMultiItem] = miscItems;

    useEffect(() => {
        if (!menuVisible) setCurSelected(0);
    }, [menuVisible]);

    const groups: { label: string; items: any[] }[] = useMemo(
        () => [
            { label: 'Player', items: [playerModeItem, healItem] },
            { label: 'World', items: [teleportItem, vehicleItem, clearAreaItem] },
            { label: 'Server', items: [announcementItem, toggleMultiItem, ...serverItems] },
        ],
        [
            playerModeItem,
            healItem,
            teleportItem,
            vehicleItem,
            clearAreaItem,
            announcementItem,
            toggleMultiItem,
            serverItems,
        ],
    );

    const menuListItems = useMemo(() => groups.flatMap((group) => group.items), [groups]);

    //=============================================
    const handleArrowDown = useCallback(() => {
        const next = curSelected + 1;
        fetchNui('playSound', 'move').catch();
        setCurSelected(next >= menuListItems.length ? 0 : next);
    }, [curSelected, menuListItems.length]);

    const handleArrowUp = useCallback(() => {
        const next = curSelected - 1;
        fetchNui('playSound', 'move').catch();
        setCurSelected(next < 0 ? menuListItems.length - 1 : next);
    }, [curSelected, menuListItems.length]);

    useKeyboardNavigation({
        onDownDown: handleArrowDown,
        onUpDown: handleArrowUp,
        disableOnFocused: true,
    });

    const showTopFade = curSelected > 1;
    const showBottomFade = curSelected < menuListItems.length - 2;

    let runningIndex = 0;

    return (
        <Box sx={{ pointerEvents: 'none' }}>
            <ListWrapper fadeTop={showTopFade} fadeBottom={showBottomFade}>
                <StyledList sx={{ pointerEvents: 'auto' }}>
                    {groups.map((group, groupIndex) => (
                        <React.Fragment key={group.label}>
                            <SectionLabel first={groupIndex === 0}>{group.label}</SectionLabel>
                            {group.items.map((item) => {
                                const index = runningIndex++;
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
            </ListWrapper>
            <BoxIcon display="flex" justifyContent="center">
                <ExpandMore />
            </BoxIcon>
        </Box>
    );
};
