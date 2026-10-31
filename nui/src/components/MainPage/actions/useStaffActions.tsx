import React from 'react';
import { CarCrash, ForumRounded, GpsFixed, ImageSearch, VisibilityOff } from '@mui/icons-material';
import { useDialogContext } from '../../../provider/DialogProvider';
import { fetchNui } from '../../../utils/fetchNui';
import { useTranslate } from 'react-polyglot';
import { useSnackbar } from 'notistack';
import { useNuiEvent } from '@nui/src/hooks/useNuiEvent';
import { usePlayerModalContext } from '@nui/src/provider/PlayerModalProvider';
import { useServerCtxValue } from '@nui/src/state/server.state';
import { useStaffStatusValue } from '@nui/src/state/staffTools.state';

export function useStaffActions() {
    const t = useTranslate();
    const { enqueueSnackbar } = useSnackbar();
    const { openDialog } = useDialogContext();
    const { closeMenu } = usePlayerModalContext();
    const serverCtx = useServerCtxValue();
    const staffStatus = useStaffStatusValue();

    const handleCleanupVehicles = (autoClose = false) => {
        if (!serverCtx.oneSync.status) {
            return enqueueSnackbar(t('nui_menu.misc.onesync_error'), { variant: 'error' });
        }
        openDialog({
            title: t('nui_menu.page_main.cleanup_vehicles.title'),
            description: t('nui_menu.page_main.cleanup_vehicles.dialog_desc'),
            placeholder: '50',
            suggestions: ['25', '50', '150'],
            onSubmit: (input) => {
                const radius = parseInt(input, 10);
                if (isNaN(radius) || radius < 1 || radius > 300) {
                    return enqueueSnackbar(t('nui_menu.page_main.cleanup_vehicles.dialog_error'), {
                        variant: 'error',
                    });
                }
                fetchNui('cleanupVehicles', { radius });
                if (autoClose) closeMenu();
            },
        });
    };
    useNuiEvent('openCleanupVehiclesDialog', () => {
        handleCleanupVehicles(true);
    });

    const handleStaffChat = (autoClose = false) => {
        openDialog({
            title: t('nui_menu.page_main.staff_chat.title'),
            description: t('nui_menu.page_main.staff_chat.dialog_desc'),
            placeholder: t('nui_menu.page_main.staff_chat.dialog_placeholder'),
            onSubmit: (message) => {
                fetchNui('sendStaffChat', { message: message.trim() });
                if (autoClose) closeMenu();
            },
        });
    };
    useNuiEvent('openStaffChatDialog', () => {
        handleStaffChat(true);
    });

    return {
        invisibleItem: {
            title: t('nui_menu.page_main.invisible.title'),
            label: t('nui_menu.page_main.invisible.label'),
            requiredPermission: 'players.invisible',
            icon: <VisibilityOff />,
            toggleState: staffStatus.invisible,
            onSelect: () => fetchNui('toggleInvisible'),
        },
        cleanupVehiclesItem: {
            title: t('nui_menu.page_main.cleanup_vehicles.title'),
            label: t('nui_menu.page_main.cleanup_vehicles.label'),
            requiredPermission: 'menu.delete_entities',
            icon: <CarCrash />,
            onSelect: () => handleCleanupVehicles(),
        },
        devToolsItem: {
            title: t('nui_menu.page_main.dev_tools.title'),
            isMultiAction: true,
            icon: <GpsFixed />,
            actions: [
                {
                    name: t('nui_menu.page_main.dev_tools.coords_hud'),
                    label: t('nui_menu.page_main.dev_tools.coords_hud_label'),
                    value: 'coords',
                    icon: <GpsFixed />,
                    requiredPermission: 'menu.devtools',
                    isActive: staffStatus.coordsHud,
                    onSelect: () => fetchNui('toggleDevTool', 'coords'),
                },
                {
                    name: t('nui_menu.page_main.dev_tools.inspector'),
                    label: t('nui_menu.page_main.dev_tools.inspector_label'),
                    value: 'inspector',
                    icon: <ImageSearch />,
                    requiredPermission: 'menu.devtools',
                    isActive: staffStatus.inspector,
                    onSelect: () => fetchNui('toggleDevTool', 'inspector'),
                },
            ],
        },
        staffChatItem: {
            title: t('nui_menu.page_main.staff_chat.title'),
            label: t('nui_menu.page_main.staff_chat.label'),
            requiredPermission: 'menu.staffchat',
            icon: <ForumRounded />,
            onSelect: () => handleStaffChat(),
        },
    };
}
