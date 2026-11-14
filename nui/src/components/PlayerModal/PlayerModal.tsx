import {
    Box,
    CircularProgress,
    DialogTitle,
    IconButton,
    List,
    ListItemButton,
    ListItemIcon,
    ListItemText,
} from '@mui/material';
import { alpha, styled, useTheme } from '@mui/material/styles';
import { Block, Close, FlashOn, FormatListBulleted, MenuBook, Person } from '@mui/icons-material';
import { useAssociatedPlayerValue, usePlayerDetailsValue } from '../../state/playerDetails.state';
import { useTranslate } from 'react-polyglot';
import { DialogBaseView } from './Tabs/DialogBaseView';
import { PlayerModalErrorBoundary } from './ErrorHandling/PlayerModalErrorBoundary';
import { usePermissionsValue } from '../../state/permissions.state';
import { userHasPerm } from '../../utils/miscUtils';
import React from 'react';
import {
    PlayerModalTabs,
    usePlayerModalTabValue,
    useSetPlayerModalTab,
    useSetPlayerModalVisibility,
} from '@nui/src/state/playerModal.state';

const classes = {
    listItem: `PlayerModal-listItem`,
    listItemBan: `PlayerModal-listItemBan`,
};

const StyledList = styled(List)(({ theme }) => ({
    [`& .${classes.listItem}`]: {
        marginBottom: 6,
        '&.Mui-selected .MuiListItemIcon-root': {
            color: theme.palette.primary.main,
        },
        '&.Mui-selected .MuiListItemText-primary': {
            fontWeight: 600,
        },
    },

    //Danger treatment for the Ban tab, driven by the error palette
    [`& .${classes.listItemBan}`]: {
        marginBottom: 6,
        '&:hover': {
            backgroundColor: alpha(theme.palette.error.main, 0.2),
            borderColor: theme.palette.error.main,
        },
        '&.Mui-selected, &.Mui-selected:hover': {
            backgroundColor: theme.palette.error.main,
            borderColor: theme.palette.error.main,
            color: theme.palette.error.contrastText,
        },
    },
}));

const LoadingModal: React.FC = () => (
    <Box display="flex" flexGrow={1} width="100%" justifyContent="center" alignItems="center">
        <CircularProgress />
    </Box>
);

const StyledCloseButton = styled(IconButton)(({ theme }) => ({
    position: 'absolute',
    top: theme.spacing(1),
    right: theme.spacing(2),
}));

type PlayerModalProps = {
    onClose: () => void;
};
const PlayerModal: React.FC<PlayerModalProps> = ({ onClose }) => {
    const setModalOpen = useSetPlayerModalVisibility();
    const playerDetails = usePlayerDetailsValue();
    const assocPlayer = useAssociatedPlayerValue();
    const { tokens } = useTheme();

    if (!assocPlayer) return null;

    const error = playerDetails && 'error' in playerDetails ? playerDetails.error : undefined;
    const playerName =
        playerDetails && 'player' in playerDetails ? playerDetails.player.displayName : assocPlayer.displayName;

    return (
        <>
            <DialogTitle style={{ borderBottom: `1px solid ${tokens.border}`, paddingRight: 58 }}>
                <Box
                    component="span"
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        minWidth: 0,
                    }}
                >
                    <Box
                        component="span"
                        sx={{
                            flexShrink: 0,
                            fontSize: 12,
                            fontWeight: 600,
                            lineHeight: 1,
                            color: tokens.textMuted,
                            backgroundColor: tokens.surfaceRaised,
                            border: `1px solid ${tokens.border}`,
                            borderRadius: `${tokens.radiusPill}px`,
                            padding: '4px 9px',
                        }}
                    >
                        #{assocPlayer.id}
                    </Box>
                    <Box
                        component="span"
                        sx={{
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontWeight: 700,
                        }}
                    >
                        {playerName}
                    </Box>
                </Box>
                <StyledCloseButton onClick={onClose} size="large">
                    <Close />
                </StyledCloseButton>
            </DialogTitle>
            <Box display="flex" px={2} pb={2} pt={2} flexGrow={1} overflow="hidden" minWidth={0}>
                <PlayerModalErrorBoundary>
                    {error ? (
                        <>
                            <h2
                                style={{
                                    marginLeft: 'auto',
                                    marginRight: 'auto',
                                    textAlign: 'center',
                                    fontWeight: '500',
                                    maxWidth: '70%',
                                    paddingTop: '2em',
                                }}
                            >
                                {error}
                            </h2>
                        </>
                    ) : (
                        <>
                            <Box minWidth={200} pr={2} borderRight={`1px solid ${tokens.border}`}>
                                <DialogList />
                            </Box>
                            <React.Suspense fallback={<LoadingModal />}>
                                <DialogBaseView />
                            </React.Suspense>
                        </>
                    )}
                </PlayerModalErrorBoundary>
            </Box>
        </>
    );
};

interface DialogTabProps {
    title: string;
    tab: PlayerModalTabs;
    curTab: PlayerModalTabs;
    icon: React.ReactElement;
    isDisabled?: boolean;
}

const DialogTab: React.FC<DialogTabProps> = ({ isDisabled, curTab, tab, icon, title }) => {
    const setTab = useSetPlayerModalTab();

    const stylingClass = tab === PlayerModalTabs.BAN ? classes.listItemBan : classes.listItem;

    const isSelected = curTab === tab;

    return (
        <ListItemButton
            className={stylingClass}
            selected={isSelected}
            onClick={() => setTab(tab)}
            disabled={isDisabled}
            sx={{ minWidth: 0 }}
        >
            <ListItemIcon>{icon}</ListItemIcon>
            <ListItemText primary={title} sx={{ minWidth: 0 }} primaryTypographyProps={{ noWrap: true }} />
        </ListItemButton>
    );
};

const DialogList: React.FC = () => {
    const curTab = usePlayerModalTabValue();
    const t = useTranslate();
    const playerPerms = usePermissionsValue();

    return (
        <StyledList>
            <DialogTab
                title={t('nui_menu.player_modal.tabs.actions')}
                tab={PlayerModalTabs.ACTIONS}
                curTab={curTab}
                icon={<FlashOn />}
            />
            <DialogTab
                title={t('nui_menu.player_modal.tabs.info')}
                tab={PlayerModalTabs.INFO}
                curTab={curTab}
                icon={<Person />}
            />
            <DialogTab
                title={t('nui_menu.player_modal.tabs.ids')}
                tab={PlayerModalTabs.IDENTIFIERS}
                curTab={curTab}
                icon={<FormatListBulleted />}
            />
            <DialogTab
                title={t('nui_menu.player_modal.tabs.history')}
                tab={PlayerModalTabs.HISTORY}
                curTab={curTab}
                icon={<MenuBook />}
            />
            <DialogTab
                title={t('nui_menu.player_modal.tabs.ban')}
                tab={PlayerModalTabs.BAN}
                curTab={curTab}
                icon={<Block />}
                isDisabled={!userHasPerm('players.ban', playerPerms)}
            />
        </StyledList>
    );
};

export default PlayerModal;
