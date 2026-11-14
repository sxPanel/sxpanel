import React from 'react';
import { AccessibilityNewOutlined, AirlineStopsOutlined, ControlCameraOutlined, SecurityOutlined } from '@mui/icons-material';
import { fetchNui } from '../../../utils/fetchNui';
import { useTranslate } from 'react-polyglot';
import { useSnackbar } from 'notistack';
import { PlayerMode, usePlayerMode } from '../../../state/playermode.state';

export function usePlayerModeActions() {
    const t = useTranslate();
    const { enqueueSnackbar } = useSnackbar();
    const [playerMode, setPlayerMode] = usePlayerMode();

    const handlePlayermodeToggle = (targetMode: PlayerMode) => {
        if (targetMode === playerMode || targetMode === PlayerMode.DEFAULT) {
            setPlayerMode(PlayerMode.DEFAULT);
            fetchNui('playerModeChanged', PlayerMode.DEFAULT).catch(() => {});
            enqueueSnackbar(t('nui_menu.page_main.player_mode.normal.success'), {
                variant: 'success',
            });
        } else {
            setPlayerMode(targetMode);
            fetchNui('playerModeChanged', targetMode).catch(() => {});
        }
    };

    return {
        playerMode,
        menuItem: {
            title: t('nui_menu.page_main.player_mode.title'),
            isMultiAction: true,
            initialValue: playerMode,
            actions: [
                {
                    name: t('nui_menu.page_main.player_mode.noclip.title'),
                    label: t('nui_menu.page_main.player_mode.noclip.label'),
                    value: PlayerMode.NOCLIP,
                    icon: <ControlCameraOutlined />,
                    requiredPermission: 'players.noclip',
                    onSelect: () => {
                        handlePlayermodeToggle(PlayerMode.NOCLIP);
                    },
                },
                {
                    name: t('nui_menu.page_main.player_mode.godmode.title'),
                    label: t('nui_menu.page_main.player_mode.godmode.label'),
                    value: PlayerMode.GOD_MODE,
                    icon: <SecurityOutlined />,
                    requiredPermission: 'players.godmode',
                    onSelect: () => {
                        handlePlayermodeToggle(PlayerMode.GOD_MODE);
                    },
                },
                {
                    name: t('nui_menu.page_main.player_mode.superjump.title'),
                    label: t('nui_menu.page_main.player_mode.superjump.label'),
                    value: PlayerMode.SUPER_JUMP,
                    icon: <AirlineStopsOutlined />,
                    requiredPermission: 'players.superjump',
                    onSelect: () => {
                        handlePlayermodeToggle(PlayerMode.SUPER_JUMP);
                    },
                },
                {
                    name: t('nui_menu.page_main.player_mode.normal.title'),
                    label: t('nui_menu.page_main.player_mode.normal.label'),
                    value: PlayerMode.DEFAULT,
                    icon: <AccessibilityNewOutlined />,
                    onSelect: () => {
                        handlePlayermodeToggle(PlayerMode.DEFAULT);
                    },
                },
            ],
        },
    };
}
