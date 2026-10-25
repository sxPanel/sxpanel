import React, { memo, useEffect, useRef, useState } from 'react';
import { Box, ListItemButton, ListItemIcon, ListItemText, Typography, styled } from '@mui/material';
import { ChevronLeftRounded, ChevronRightRounded } from '@mui/icons-material';
import { useKeyboardNavigation } from '../../hooks/useKeyboardNavigation';
import { fetchNui } from '../../utils/fetchNui';
import { useTranslate } from 'react-polyglot';
import { ResolvablePermission, usePermissionsValue } from '../../state/permissions.state';
import { userHasPerm } from '../../utils/miscUtils';
import { useSnackbar } from 'notistack';
import { useTooltip } from '../../provider/TooltipProvider';

const PREFIX = 'MenuListItem';

const classes = {
    root: `${PREFIX}-root`,
    rootDisabled: `${PREFIX}-rootDisabled`,
    icon: `${PREFIX}-icon`,
    overrideText: `${PREFIX}-overrideText`,
};

const Root = styled('div')(({ theme }) => ({
    //Rows are individual raised panels (surface/border/selection styling comes
    //from the MuiListItemButton theme override); this adds the row spacing.
    marginBottom: 3,
    '&:last-of-type': {
        marginBottom: 0,
    },

    [`& .${classes.rootDisabled}`]: {
        opacity: 0.35,
    },

    [`& .${classes.icon}`]: {
        color: theme.palette.text.secondary,
        transition: 'color 120ms ease',
        flexShrink: 0,
    },

    [`& .Mui-selected .${classes.icon}`]: {
        color: theme.palette.primary.main,
    },

    [`& .Mui-selected .MuiTypography-root`]: {
        color: theme.tokens.textPrimary,
    },

    [`& .${classes.overrideText}`]: {
        color: theme.palette.text.primary,
        fontSize: 13,
        lineHeight: 1.3,
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },

    '& .MuiListItemButton-root': {
        minWidth: 0,
        minHeight: 30,
        paddingTop: 3,
        paddingBottom: 3,
        paddingRight: 8,
        gap: 6,
    },

    '& .MuiListItemText-root': {
        minWidth: 0,
        margin: 0,
    },
}));

const StatePill = styled('span', {
    shouldForwardProp: (prop) => prop !== 'active',
})<{ active: boolean }>(({ theme, active }) => ({
    flexShrink: 0,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.08em',
    lineHeight: 1,
    padding: '3px 6px',
    borderRadius: theme.tokens.radiusPill,
    color: active ? theme.tokens.success : theme.tokens.textMuted,
    backgroundColor: active ? 'rgba(1, 162, 111, 0.14)' : 'transparent',
    border: `1px solid ${active ? 'rgba(1, 162, 111, 0.45)' : theme.tokens.border}`,
}));

/** Left/right chevrons with one dot per option, the current one highlighted */
const OptionDots: React.FC<{ count: number; current: number; selected: boolean }> = ({ count, current, selected }) => (
    <Box
        display="flex"
        alignItems="center"
        flexShrink={0}
        sx={{ color: selected ? 'primary.main' : 'text.secondary', '& svg': { fontSize: 15 } }}
    >
        <ChevronLeftRounded />
        <Box display="flex" gap="3px">
            {Array.from({ length: count }, (_, i) => (
                <Box
                    key={i}
                    sx={{
                        width: i === current ? 8 : 4,
                        height: 4,
                        borderRadius: 2,
                        bgcolor: i === current ? 'currentColor' : 'rgba(161, 161, 170, 0.35)',
                        transition: 'width 120ms ease',
                    }}
                />
            ))}
        </Box>
        <ChevronRightRounded />
    </Box>
);

export interface MenuListItemProps {
    title: string;
    label: string;
    requiredPermission?: ResolvablePermission;
    icon: React.ReactElement;
    selected: boolean;
    /** When set, the row is a toggle and shows an ON/OFF pill */
    toggleState?: boolean;
    onSelect: () => void;
}

export const MenuListItem: React.FC<MenuListItemProps> = memo(
    ({ title, label, requiredPermission, icon, selected, toggleState, onSelect }) => {
        const t = useTranslate();
        const divRef = useRef<HTMLDivElement | null>(null);
        const userPerms = usePermissionsValue();
        const isUserAllowed = requiredPermission ? userHasPerm(requiredPermission, userPerms) : true;
        const { enqueueSnackbar } = useSnackbar();
        const { setTooltipText } = useTooltip();

        const handleEnter = (): void => {
            if (!selected) return;

            if (!isUserAllowed) {
                enqueueSnackbar(t('nui_menu.misc.no_perms'), {
                    variant: 'error',
                    anchorOrigin: {
                        horizontal: 'center',
                        vertical: 'bottom',
                    },
                });
                return;
            }

            fetchNui('playSound', 'enter');
            onSelect();
        };

        useEffect(() => {
            if (selected && divRef) {
                divRef.current?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest',
                    inline: 'start',
                });
            }
        }, [selected]);

        useEffect(() => {
            if (selected) {
                setTooltipText(label);
            }
        }, [selected]);

        useKeyboardNavigation({
            onEnterDown: handleEnter,
            disableOnFocused: true,
        });

        return (
            <Root ref={divRef}>
                <ListItemButton
                    onClick={() => onSelect()}
                    className={isUserAllowed ? classes.root : classes.rootDisabled}
                    dense
                    selected={selected}
                >
                    <ListItemIcon className={classes.icon}>{icon}</ListItemIcon>
                    <ListItemText
                        primary={title}
                        classes={{
                            primary: classes.overrideText,
                        }}
                    />
                    {toggleState !== undefined && (
                        <StatePill active={toggleState}>
                            {t(
                                toggleState
                                    ? 'nui_menu.page_main.toggle_state.on'
                                    : 'nui_menu.page_main.toggle_state.off',
                            )}
                        </StatePill>
                    )}
                </ListItemButton>
            </Root>
        );
    },
);

interface MenuListItemMultiAction {
    name?: string | React.ReactElement;
    label: string;
    value: string | number | boolean;
    icon?: React.ReactElement;
    requiredPermission?: ResolvablePermission;
    /** When set, the option is a toggle and shows an ON/OFF pill while it is the current option */
    isActive?: boolean;
    onSelect: () => void;
}

export interface MenuListItemMultiProps {
    title: string;
    requiredPermission?: ResolvablePermission;
    initialValue?: MenuListItemMultiAction;
    selected: boolean;
    icon: React.ReactElement;
    actions: MenuListItemMultiAction[];
}

export const MenuListItemMulti: React.FC<MenuListItemMultiProps> = memo(
    ({ selected, title, actions, icon, initialValue, requiredPermission }) => {
        const t = useTranslate();
        const [curState, setCurState] = useState(0);
        const userPerms = usePermissionsValue();
        const { enqueueSnackbar } = useSnackbar();
        const { setTooltipText } = useTooltip();

        // Row-level permission: if set and user lacks it AND no per-action perms exist, grey out entire row
        // If actions have individual permissions, the row is accessible if user has ANY action's permission
        const hasAnyActionPerm = actions.some((action) => {
            if (action.requiredPermission) {
                return userHasPerm(action.requiredPermission, userPerms);
            }
            return true;
        });
        const isRowAllowed = requiredPermission
            ? userHasPerm(requiredPermission, userPerms) || hasAnyActionPerm
            : hasAnyActionPerm;

        // Per-action permission check for the currently selected action
        const currentAction = actions[curState];
        const isCurrentActionAllowed = currentAction?.requiredPermission
            ? userHasPerm(currentAction.requiredPermission, userPerms)
            : isRowAllowed;

        const compMounted = useRef(false);

        const divRef = useRef<HTMLDivElement | null>(null);

        const showNotAllowedAlert = () => {
            enqueueSnackbar(t('nui_menu.misc.no_perms'), {
                variant: 'error',
                anchorOrigin: {
                    horizontal: 'center',
                    vertical: 'bottom',
                },
            });
        };

        useEffect(() => {
            if (selected && divRef) {
                divRef.current?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest',
                    inline: 'start',
                });
            }
        }, [selected]);

        // Mount/unmount detection
        // We will only run this hook after initial mount
        // and not on unmount.
        // NOTE: This hook does not work if actions prop are dynamic
        useEffect(() => {
            if (!compMounted.current) {
                compMounted.current = true;
                // We will set the initial value of the item based on the passed initial value
                const index = actions.findIndex((a) => a.value === initialValue?.value);
                setCurState(index > -1 ? index : 0);
            }
        }, [curState]);

        useEffect(() => {
            if (actions[curState]?.label && selected) {
                setTooltipText(actions[curState]?.label);
            }
        }, [curState, selected]);

        const handleLeftArrow = () => {
            if (!selected) return;

            fetchNui('playSound', 'move').catch();
            const nextEstimatedItem = curState - 1;
            const nextItem = nextEstimatedItem < 0 ? actions.length - 1 : nextEstimatedItem;
            setCurState(nextItem);
        };

        const handleRightArrow = () => {
            if (!selected) return;

            fetchNui('playSound', 'move');
            const nextEstimatedItem = curState + 1;
            const nextItem = nextEstimatedItem >= actions.length ? 0 : nextEstimatedItem;
            setCurState(nextItem);
        };

        const handleEnter = () => {
            if (!selected) return;
            if (!isCurrentActionAllowed) return showNotAllowedAlert();

            fetchNui('playSound', 'enter').catch();
            actions[curState].onSelect();
        };

        useKeyboardNavigation({
            onRightDown: handleRightArrow,
            onLeftDown: handleLeftArrow,
            onEnterDown: handleEnter,
            disableOnFocused: true,
        });

        return (
            <Root ref={divRef}>
                <ListItemButton
                    className={isRowAllowed ? classes.root : classes.rootDisabled}
                    dense
                    selected={selected}
                    onClick={() => {
                        if (!isCurrentActionAllowed) return showNotAllowedAlert();
                        currentAction?.onSelect();
                    }}
                >
                    <ListItemIcon className={classes.icon}>{currentAction?.icon ?? icon}</ListItemIcon>
                    <ListItemText
                        primary={
                            <>
                                {title}:&nbsp;
                                <Typography
                                    component="span"
                                    color={selected ? 'text.primary' : 'text.secondary'}
                                    sx={{
                                        fontSize: 13,
                                        fontWeight: selected ? 600 : 400,
                                        opacity: isCurrentActionAllowed ? 1 : 0.4,
                                    }}
                                >
                                    {currentAction?.name ?? '???'}
                                </Typography>
                            </>
                        }
                        classes={{
                            primary: classes.overrideText,
                        }}
                    />
                    {currentAction?.isActive !== undefined && (
                        <StatePill active={currentAction.isActive}>
                            {t(
                                currentAction.isActive
                                    ? 'nui_menu.page_main.toggle_state.on'
                                    : 'nui_menu.page_main.toggle_state.off',
                            )}
                        </StatePill>
                    )}
                    <OptionDots count={actions.length} current={curState} selected={selected} />
                </ListItemButton>
            </Root>
        );
    },
);
