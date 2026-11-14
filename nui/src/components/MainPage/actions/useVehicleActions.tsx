import React from 'react';
import { BuildOutlined, DeleteForeverOutlined, DirectionsCarOutlined, RocketLaunchOutlined } from '@mui/icons-material';
import { useDialogContext } from '../../../provider/DialogProvider';
import { fetchNui } from '../../../utils/fetchNui';
import { useTranslate } from 'react-polyglot';
import { useSnackbar } from 'notistack';
import { useServerCtxValue } from '../../../state/server.state';
import { VehicleMode, useVehicleMode } from '../../../state/vehiclemode.state';
import { useIsRedmValue } from '@nui/src/state/isRedm.state';
import { getVehicleSpawnDialogData, vehiclePlaceholderReplacer } from '@nui/src/utils/vehicleSpawnDialogHelper';
import { useNuiEvent } from '@nui/src/hooks/useNuiEvent';
import { usePlayerModalContext } from '@nui/src/provider/PlayerModalProvider';

export function useVehicleActions() {
    const t = useTranslate();
    const { enqueueSnackbar } = useSnackbar();
    const { openDialog } = useDialogContext();
    const [vehicleMode, setVehicleMode] = useVehicleMode();
    const serverCtx = useServerCtxValue();
    const isRedm = useIsRedmValue();
    const { closeMenu } = usePlayerModalContext();

    const handleSpawnVehicle = (autoClose = false) => {
        if (!serverCtx.oneSync.status) {
            return enqueueSnackbar(t('nui_menu.misc.onesync_error'), {
                variant: 'error',
            });
        }

        const dialogData = getVehicleSpawnDialogData(isRedm);
        openDialog({
            title: t('nui_menu.page_main.vehicle.spawn.dialog_title'),
            description: t('nui_menu.page_main.vehicle.spawn.dialog_desc'),
            placeholder: 'any vehicle model or ' + dialogData.shortcuts.join(', '),
            suggestions: dialogData.shortcuts,
            onSubmit: (modelName: string) => {
                modelName = vehiclePlaceholderReplacer(modelName, dialogData.shortcutsData);
                fetchNui('spawnVehicle', { model: modelName }).catch(() => {});
                if (autoClose) {
                    closeMenu();
                }
            },
        });
    };
    useNuiEvent('openSpawnVehicleDialog', () => {
        handleSpawnVehicle(true);
    });

    const handleFixVehicle = () => {
        fetchNui('fixVehicle').catch(() => {});
    };

    const handleDeleteVehicle = () => {
        if (!serverCtx.oneSync.status) {
            return enqueueSnackbar(t('nui_menu.misc.onesync_error'), {
                variant: 'error',
            });
        }
        fetchNui('deleteVehicle')
            .then(({ success }) => {
                if (success) {
                    return enqueueSnackbar(t('nui_menu.page_main.vehicle.delete.success'), {
                        variant: 'info',
                    });
                }
                enqueueSnackbar(t('nui_menu.page_main.vehicle.not_in_veh_error'), {
                    variant: 'error',
                });
            })
            .catch(() => {
                enqueueSnackbar(t('nui_menu.common.error'), { variant: 'error' });
            });
    };

    const handleBoostVehicle = () => {
        fetchNui('boostVehicle').catch(() => {});
    };

    return {
        vehicleMode,
        serverCtx,
        isRedm,
        menuItem: {
            title: t('nui_menu.page_main.vehicle.title'),
            isMultiAction: true,
            initialValue: vehicleMode,
            actions: [
                {
                    name: t('nui_menu.page_main.vehicle.spawn.title'),
                    label: t('nui_menu.page_main.vehicle.spawn.label'),
                    value: VehicleMode.SPAWN,
                    icon: <DirectionsCarOutlined />,
                    requiredPermission: 'menu.vehicle.spawn',
                    onSelect: () => {
                        setVehicleMode(VehicleMode.SPAWN);
                        handleSpawnVehicle();
                    },
                },
                {
                    name: t('nui_menu.page_main.vehicle.fix.title'),
                    label: t('nui_menu.page_main.vehicle.fix.label'),
                    value: VehicleMode.FIX,
                    icon: <BuildOutlined />,
                    requiredPermission: 'menu.vehicle.fix',
                    onSelect: () => {
                        setVehicleMode(VehicleMode.FIX);
                        handleFixVehicle();
                    },
                },
                {
                    name: t('nui_menu.page_main.vehicle.delete.title'),
                    label: t('nui_menu.page_main.vehicle.delete.label'),
                    value: VehicleMode.DELETE,
                    icon: <DeleteForeverOutlined />,
                    requiredPermission: 'menu.vehicle.delete',
                    onSelect: () => {
                        setVehicleMode(VehicleMode.DELETE);
                        handleDeleteVehicle();
                    },
                },
                {
                    name: t('nui_menu.page_main.vehicle.boost.title'),
                    label: t('nui_menu.page_main.vehicle.boost.label'),
                    value: VehicleMode.BOOST,
                    icon: <RocketLaunchOutlined />,
                    requiredPermission: 'menu.vehicle.boost',
                    onSelect: () => {
                        setVehicleMode(VehicleMode.BOOST);
                        handleBoostVehicle();
                    },
                },
            ],
        },
    };
}
