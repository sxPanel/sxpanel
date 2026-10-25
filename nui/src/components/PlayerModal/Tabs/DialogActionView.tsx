import React, { useCallback, useEffect, useRef } from 'react';
import { alpha, styled } from '@mui/material/styles';
import { Box, ButtonBase, DialogContent, Typography } from '@mui/material';
import {
    AcUnitRounded,
    AdminPanelSettingsRounded,
    BackHandRounded,
    FavoriteRounded,
    LocalBarRounded,
    LocalFireDepartmentRounded,
    LogoutRounded,
    MailRounded,
    NearMeRounded,
    PersonPinCircleRounded,
    PetsRounded,
    UndoRounded,
    VisibilityRounded,
    WarningAmberRounded,
} from '@mui/icons-material';
import { useAssociatedPlayerValue, usePlayerDetailsValue } from '../../../state/playerDetails.state';
import { fetchWebPipe } from '../../../utils/fetchWebPipe';
import { fetchNui } from '../../../utils/fetchNui';
import { useDialogContext } from '../../../provider/DialogProvider';
import { useSnackbar } from 'notistack';
import { usePlayerModalContext } from '@nui/src/provider/PlayerModalProvider';
import { userHasPerm } from '@nui/src/utils/miscUtils';
import { useTranslate } from 'react-polyglot';
import { ResolvablePermission, usePermissionsValue } from '../../../state/permissions.state';
import { DialogLoadError } from './DialogLoadError';
import { useServerCtxValue } from '../../../state/server.state';
import { GenericApiErrorResp, GenericApiResp } from '@shared/genericApiTypes';
import { usePendingPlayerActionValue, useSetPendingPlayerAction } from '../../../state/playerModal.state';

const PREFIX = 'DialogActionView';

const classes = {
    actionGrid: `${PREFIX}-actionGrid`,
    sectionTitle: `${PREFIX}-sectionTitle`,
};

const StyledDialogContent = styled(DialogContent)(({ theme }) => ({
    [`& .${classes.actionGrid}`]: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))',
        gap: 8,
    },
    [`& .${classes.sectionTitle}`]: {
        paddingBottom: 6,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: theme.tokens.textMuted,
    },
}));

type ActionTone = 'default' | 'warning' | 'danger';

const ActionTile = styled(ButtonBase, {
    shouldForwardProp: (prop) => prop !== 'tone',
})<{ tone: ActionTone }>(({ theme, tone }) => {
    const toneColor =
        tone === 'danger'
            ? theme.palette.error.main
            : tone === 'warning'
              ? theme.palette.warning.main
              : theme.tokens.accent;
    return {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        minHeight: 64,
        padding: '10px 6px',
        borderRadius: theme.tokens.radiusRow,
        border: `1px solid ${theme.tokens.border}`,
        backgroundColor: theme.tokens.surfaceRaised,
        color: theme.tokens.textPrimary,
        fontSize: 12,
        fontWeight: 500,
        textAlign: 'center',
        lineHeight: 1.2,
        transition: 'background-color 120ms ease, border-color 120ms ease',
        '& svg': {
            fontSize: 20,
            color: toneColor,
        },
        '&:hover': {
            backgroundColor: alpha(toneColor, 0.12),
            borderColor: alpha(toneColor, 0.5),
        },
        '&.Mui-disabled': {
            opacity: 0.35,
        },
    };
});

interface ActionDef {
    label: string;
    icon: React.ReactElement;
    perm: ResolvablePermission;
    tone?: ActionTone;
    onClick: () => void;
}

interface ActionSectionDef {
    title: string;
    actions: ActionDef[];
}

export type TxAdminActionRespType = 'success' | 'warning' | 'danger';

export interface TxAdminAPIResp {
    type: TxAdminActionRespType;
    message: string;
}

const DialogActionView: React.FC = () => {
    const { openDialog } = useDialogContext();
    const playerDetails = usePlayerDetailsValue();
    const assocPlayer = useAssociatedPlayerValue();
    const { enqueueSnackbar } = useSnackbar();
    const t = useTranslate();
    const serverCtx = useServerCtxValue();
    const playerPerms = usePermissionsValue();
    const { closeMenu, showNoPerms } = usePlayerModalContext();
    const pendingAction = usePendingPlayerActionValue();
    const setPendingAction = useSetPendingPlayerAction();

    const handleKickRef = useRef<() => void>(() => {});
    const handleWarnRef = useRef<() => void>(() => {});

    // Auto-trigger kick/warn dialog when opened via /kick or /warn command
    useEffect(() => {
        if (!pendingAction) return;
        if ('error' in playerDetails) {
            enqueueSnackbar(`Cannot ${pendingAction}: failed to load player details`, { variant: 'error' });
            setPendingAction(null);
            return;
        }
        if (pendingAction === 'kick') {
            handleKickRef.current();
        } else if (pendingAction === 'warn') {
            handleWarnRef.current();
        }
        setPendingAction(null);
    }, [pendingAction, setPendingAction, playerDetails, enqueueSnackbar]);

    if ('error' in playerDetails) return <DialogLoadError />;

    //Helper
    const handleGenericApiResponse = (result: GenericApiResp, successMessageKey: string) => {
        if ('success' in result && result.success === true) {
            enqueueSnackbar(t(`nui_menu.player_modal.actions.${successMessageKey}`), {
                variant: 'success',
            });
        } else {
            enqueueSnackbar((result as GenericApiErrorResp).error ?? t('nui_menu.misc.unknown_error'), {
                variant: 'error',
            });
        }
    };

    //Moderation
    const handleDM = () => {
        if (!userHasPerm('players.direct_message', playerPerms)) return showNoPerms('Direct Message');

        openDialog({
            title: `${t('nui_menu.player_modal.actions.moderation.dm_dialog.title')} ${assocPlayer.displayName}`,
            description: t('nui_menu.player_modal.actions.moderation.dm_dialog.description'),
            placeholder: t('nui_menu.player_modal.actions.moderation.dm_dialog.placeholder'),
            onSubmit: async (message: string) => {
                try {
                    const result = await fetchWebPipe<GenericApiResp>(
                        `/player/message?mutex=current&netid=${assocPlayer.id}`,
                        {
                            method: 'POST',
                            data: { message: message.trim() },
                        },
                    );
                    handleGenericApiResponse(result, 'moderation.dm_dialog.success');
                } catch (error) {
                    enqueueSnackbar((error as Error).message, { variant: 'error' });
                }
            },
        });
    };

    const handleWarn = useCallback(() => {
        if (!userHasPerm('players.warn', playerPerms)) return showNoPerms('Warn');

        openDialog({
            title: `${t('nui_menu.player_modal.actions.moderation.warn_dialog.title')} ${assocPlayer.displayName}`,
            description: t('nui_menu.player_modal.actions.moderation.warn_dialog.description'),
            placeholder: t('nui_menu.player_modal.actions.moderation.warn_dialog.placeholder'),
            onSubmit: async (reason: string) => {
                try {
                    const result = await fetchWebPipe<GenericApiResp>(
                        `/player/warn?mutex=current&netid=${assocPlayer.id}`,
                        {
                            method: 'POST',
                            data: { reason: reason.trim() },
                        },
                    );
                    handleGenericApiResponse(result, 'moderation.warn_dialog.success');
                } catch (error) {
                    enqueueSnackbar((error as Error).message, { variant: 'error' });
                }
            },
        });
    }, [playerPerms, showNoPerms, openDialog, assocPlayer, t, enqueueSnackbar]);
    handleWarnRef.current = handleWarn;

    const handleKick = useCallback(() => {
        if (!userHasPerm('players.kick', playerPerms)) return showNoPerms('Kick');

        openDialog({
            title: `${t('nui_menu.player_modal.actions.moderation.kick_dialog.title')} ${assocPlayer.displayName}`,
            description: t('nui_menu.player_modal.actions.moderation.kick_dialog.description'),
            placeholder: t('nui_menu.player_modal.actions.moderation.kick_dialog.placeholder'),
            onSubmit: async (reason: string) => {
                try {
                    const result = await fetchWebPipe<GenericApiResp>(
                        `/player/kick?mutex=current&netid=${assocPlayer.id}`,
                        {
                            method: 'POST',
                            data: { reason: reason.trim() },
                        },
                    );
                    handleGenericApiResponse(result, 'moderation.kick_dialog.success');
                } catch (error) {
                    enqueueSnackbar((error as Error).message, { variant: 'error' });
                }
            },
        });
    }, [playerPerms, showNoPerms, openDialog, assocPlayer, t, enqueueSnackbar]);
    handleKickRef.current = handleKick;

    const handleSetAdmin = () => {
        if (!userHasPerm('manage.admins', playerPerms)) {
            return showNoPerms('Manage Admins');
        }
        enqueueSnackbar(t('nui_menu.player_modal.actions.moderation.options.set_admin') + ': use the panel', {
            variant: 'info',
        });
    };

    //Interaction
    const handleHeal = async () => {
        if (!userHasPerm('players.heal', playerPerms)) return showNoPerms('Heal');

        try {
            const result = await fetchWebPipe<GenericApiResp>(`/player/heal?mutex=current&netid=${assocPlayer.id}`, {
                method: 'POST',
                data: {},
            });
            handleGenericApiResponse(result, 'interaction.notifications.heal_player');
        } catch (error) {
            enqueueSnackbar((error as Error).message, { variant: 'error' });
        }
    };

    const handleGoTo = () => {
        if (!userHasPerm('players.teleport', playerPerms)) return showNoPerms('Teleport');

        // Only works with onesync because server needs to know the player's coords
        if (!serverCtx.oneSync.status) {
            return enqueueSnackbar(t('nui_menu.misc.onesync_error'), {
                variant: 'error',
            });
        }

        closeMenu();
        fetchNui('tpToPlayer', { id: assocPlayer.id });
        enqueueSnackbar(t('nui_menu.player_modal.actions.interaction.notifications.tp_player'), { variant: 'success' });
    };

    const handleBring = () => {
        if (!userHasPerm('players.teleport', playerPerms)) return showNoPerms('Teleport');

        // Only works with onesync because server needs to know the player's coords
        if (!serverCtx.oneSync.status) {
            return enqueueSnackbar(t('nui_menu.misc.onesync_error'), {
                variant: 'error',
            });
        }

        closeMenu();
        fetchNui('summonPlayer', { id: assocPlayer.id });
        enqueueSnackbar(t('nui_menu.player_modal.actions.interaction.notifications.bring_player'), {
            variant: 'success',
        });
    };

    const handleSpectate = () => {
        if (!userHasPerm('players.spectate', playerPerms)) return showNoPerms('Spectate');

        closeMenu();
        fetchNui('spectatePlayer', { id: assocPlayer.id });
    };

    const handleFreeze = () => {
        if (!userHasPerm('players.freeze', playerPerms)) return showNoPerms('Freeze');
        fetchNui('togglePlayerFreeze', { id: assocPlayer.id });
    };

    //Troll
    const handleDrunk = () => {
        if (!userHasPerm('players.troll', playerPerms)) return showNoPerms('Troll');
        fetchNui('drunkEffectPlayer', { id: assocPlayer.id });
        enqueueSnackbar(t('nui_menu.player_modal.actions.command_sent'));
    };

    const handleSetOnFire = () => {
        if (!userHasPerm('players.troll', playerPerms)) return showNoPerms('Troll');
        fetchNui('setOnFire', { id: assocPlayer.id });
        enqueueSnackbar(t('nui_menu.player_modal.actions.command_sent'));
    };

    const handleWildAttack = () => {
        if (!userHasPerm('players.troll', playerPerms)) return showNoPerms('Troll');
        fetchNui('wildAttack', { id: assocPlayer.id });
        enqueueSnackbar(t('nui_menu.player_modal.actions.command_sent'));
    };

    //Staff
    const handleReturn = () => {
        if (!userHasPerm('players.teleport', playerPerms)) return showNoPerms('Teleport');
        fetchNui('returnPlayer', { id: assocPlayer.id });
    };

    const handleDisarm = () => {
        if (!userHasPerm('players.disarm', playerPerms)) return showNoPerms('Disarm');
        fetchNui('disarmPlayer', { id: assocPlayer.id });
    };

    const sections: ActionSectionDef[] = [
        {
            title: t('nui_menu.player_modal.actions.moderation.title'),
            actions: [
                {
                    label: t('nui_menu.player_modal.actions.moderation.options.dm'),
                    icon: <MailRounded />,
                    perm: 'players.direct_message',
                    onClick: handleDM,
                },
                {
                    label: t('nui_menu.player_modal.actions.moderation.options.warn'),
                    icon: <WarningAmberRounded />,
                    perm: 'players.warn',
                    tone: 'warning',
                    onClick: handleWarn,
                },
                {
                    label: t('nui_menu.player_modal.actions.moderation.options.kick'),
                    icon: <LogoutRounded />,
                    perm: 'players.kick',
                    tone: 'danger',
                    onClick: handleKick,
                },
                {
                    label: t('nui_menu.player_modal.actions.moderation.options.set_admin'),
                    icon: <AdminPanelSettingsRounded />,
                    perm: 'manage.admins',
                    onClick: handleSetAdmin,
                },
            ],
        },
        {
            title: t('nui_menu.player_modal.actions.interaction.title'),
            actions: [
                {
                    label: t('nui_menu.player_modal.actions.interaction.options.heal'),
                    icon: <FavoriteRounded />,
                    perm: 'players.heal',
                    onClick: handleHeal,
                },
                {
                    label: t('nui_menu.player_modal.actions.interaction.options.go_to'),
                    icon: <NearMeRounded />,
                    perm: 'players.teleport',
                    onClick: handleGoTo,
                },
                {
                    label: t('nui_menu.player_modal.actions.interaction.options.bring'),
                    icon: <PersonPinCircleRounded />,
                    perm: 'players.teleport',
                    onClick: handleBring,
                },
                {
                    label: t('nui_menu.player_modal.actions.interaction.options.spectate'),
                    icon: <VisibilityRounded />,
                    perm: 'players.spectate',
                    onClick: handleSpectate,
                },
            ],
        },
        {
            title: t('nui_menu.player_modal.actions.staff.title'),
            actions: [
                {
                    label: t('nui_menu.player_modal.actions.staff.options.return'),
                    icon: <UndoRounded />,
                    perm: 'players.teleport',
                    onClick: handleReturn,
                },
                {
                    label: t('nui_menu.player_modal.actions.interaction.options.toggle_freeze'),
                    icon: <AcUnitRounded />,
                    perm: 'players.freeze',
                    onClick: handleFreeze,
                },
                {
                    label: t('nui_menu.player_modal.actions.staff.options.disarm'),
                    icon: <BackHandRounded />,
                    perm: 'players.disarm',
                    tone: 'warning',
                    onClick: handleDisarm,
                },
            ],
        },
        {
            title: t('nui_menu.player_modal.actions.troll.title'),
            actions: [
                {
                    label: t('nui_menu.player_modal.actions.troll.options.drunk'),
                    icon: <LocalBarRounded />,
                    perm: 'players.troll',
                    tone: 'danger',
                    onClick: handleDrunk,
                },
                {
                    label: t('nui_menu.player_modal.actions.troll.options.fire'),
                    icon: <LocalFireDepartmentRounded />,
                    perm: 'players.troll',
                    tone: 'danger',
                    onClick: handleSetOnFire,
                },
                {
                    label: t('nui_menu.player_modal.actions.troll.options.wild_attack'),
                    icon: <PetsRounded />,
                    perm: 'players.troll',
                    tone: 'danger',
                    onClick: handleWildAttack,
                },
            ],
        },
    ];

    return (
        <StyledDialogContent>
            <Box pb={1}>
                <Typography variant="h6">{t('nui_menu.player_modal.actions.title')}</Typography>
            </Box>
            {sections.map((section) => (
                <Box key={section.title} pb={1.5}>
                    <Typography className={classes.sectionTitle}>{section.title}</Typography>
                    <Box className={classes.actionGrid}>
                        {section.actions.map((action) => (
                            <ActionTile
                                key={action.label}
                                tone={action.tone ?? 'default'}
                                onClick={action.onClick}
                                disabled={!userHasPerm(action.perm, playerPerms)}
                            >
                                {action.icon}
                                <span>{action.label}</span>
                            </ActionTile>
                        ))}
                    </Box>
                </Box>
            ))}
        </StyledDialogContent>
    );
};

export default DialogActionView;
