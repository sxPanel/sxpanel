import React from 'react';
import { FileCopyOutlined, GpsFixedOutlined, PersonPinCircleOutlined, RestoreOutlined } from '@mui/icons-material';
import { useDialogContext } from '../../../provider/DialogProvider';
import { fetchNui } from '../../../utils/fetchNui';
import { copyToClipboard } from '../../../utils/copyToClipboard';
import { useTranslate } from 'react-polyglot';
import { useSnackbar } from 'notistack';
import { TeleportMode, useTeleportMode } from '../../../state/teleportmode.state';
import { useNuiEvent } from '@nui/src/hooks/useNuiEvent';
import { usePlayerModalContext } from '@nui/src/provider/PlayerModalProvider';

export function useTeleportActions() {
    const t = useTranslate();
    const { enqueueSnackbar } = useSnackbar();
    const { openDialog } = useDialogContext();
    const [teleportMode, setTeleportMode] = useTeleportMode();
    const { closeMenu } = usePlayerModalContext();

    const handleTeleportCoords = (autoClose = false) => {
        openDialog({
            title: t('nui_menu.page_main.teleport.coords.dialog_title'),
            description: t('nui_menu.page_main.teleport.coords.dialog_desc'),
            placeholder: '340, 480, 12',
            onSubmit: (coords: string) => {
                let [x, y, z] = Array.from(coords.matchAll(/-?\d+(?:\.\d+)?/g), (m) => parseFloat(m[0]));
                if (!Number.isFinite(x) || !Number.isFinite(y)) {
                    return enqueueSnackbar(t('nui_menu.page_main.teleport.coords.dialog_error'), { variant: 'error' });
                }
                if (!Number.isFinite(z)) {
                    z = 0;
                }

                enqueueSnackbar(t('nui_menu.page_main.teleport.generic_success'), { variant: 'success' });
                fetchNui('tpToCoords', { x, y, z }).catch(() => {});
                if (autoClose) {
                    closeMenu();
                }
            },
        });
    };
    useNuiEvent('openTeleportCoordsDialog', () => {
        handleTeleportCoords(true);
    });

    const handleTeleportBack = () => {
        fetchNui('tpBack').catch(() => {});
    };

    const handleCopyCoords = () => {
        fetchNui<{ coords: string }>('copyCurrentCoords')
            .then((data) => {
                if (!data?.coords) {
                    throw new Error('Missing current coords.');
                }

                // Parse as floats and re-format to break taint chain and ensure only numeric data
                const parts = String(data.coords)
                    .split(',')
                    .map((s) => parseFloat(s.trim()));
                if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) {
                    throw new Error('Invalid current coords.');
                }

                const safeCoords = parts.map((n) => n.toFixed(4)).join(', ');
                const wasCopied = copyToClipboard(safeCoords);
                enqueueSnackbar(t(wasCopied ? 'nui_menu.common.copied' : 'nui_menu.common.error'), {
                    variant: wasCopied ? 'success' : 'error',
                });
            })
            .catch(() => {
                enqueueSnackbar(t('nui_menu.common.error'), { variant: 'error' });
            });
    };

    return {
        teleportMode,
        menuItem: {
            title: t('nui_menu.page_main.teleport.title'),
            requiredPermission: 'players.teleport',
            isMultiAction: true,
            initialValue: teleportMode,
            actions: [
                {
                    name: t('nui_menu.page_main.teleport.waypoint.title'),
                    label: t('nui_menu.page_main.teleport.waypoint.label'),
                    value: TeleportMode.WAYPOINT,
                    icon: <PersonPinCircleOutlined />,
                    onSelect: () => {
                        setTeleportMode(TeleportMode.WAYPOINT);
                        fetchNui('tpToWaypoint', {}).catch(() => {});
                    },
                },
                {
                    name: t('nui_menu.page_main.teleport.coords.title'),
                    label: t('nui_menu.page_main.teleport.coords.label'),
                    value: TeleportMode.COORDINATES,
                    icon: <GpsFixedOutlined />,
                    onSelect: () => {
                        setTeleportMode(TeleportMode.COORDINATES);
                        handleTeleportCoords();
                    },
                },
                {
                    name: t('nui_menu.page_main.teleport.back.title'),
                    label: t('nui_menu.page_main.teleport.back.label'),
                    value: TeleportMode.PREVIOUS,
                    icon: <RestoreOutlined />,
                    onSelect: handleTeleportBack,
                },
                {
                    name: t('nui_menu.page_main.teleport.copy.title'),
                    label: t('nui_menu.page_main.teleport.copy.label'),
                    value: TeleportMode.COPY,
                    icon: <FileCopyOutlined />,
                    onSelect: handleCopyCoords,
                },
            ],
        },
    };
}
