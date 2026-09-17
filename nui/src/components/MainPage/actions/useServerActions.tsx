import React from 'react';
import { PowerSettingsNew, RestartAlt } from '@mui/icons-material';
import { useDialogContext } from '../../../provider/DialogProvider';
import { fetchNui } from '../../../utils/fetchNui';
import { useTranslate } from 'react-polyglot';
import { useSnackbar } from 'notistack';

export function useServerActions() {
    const t = useTranslate();
    const { enqueueSnackbar } = useSnackbar();
    const { openDialog } = useDialogContext();

    const handleRestartServer = () => {
        openDialog({
            title: t('nui_menu.page_main.server_controls.restart.dialog_title'),
            description: t('nui_menu.page_main.server_controls.restart.dialog_desc'),
            placeholder: t('nui_menu.page_main.server_controls.restart.dialog_placeholder'),
            onSubmit: (input: string) => {
                if (input.trim().toUpperCase() !== 'RESTART') {
                    return enqueueSnackbar(t('nui_menu.page_main.server_controls.restart.dialog_error'), {
                        variant: 'error',
                    });
                }
                enqueueSnackbar(t('nui_menu.page_main.server_controls.restart.dialog_success'), {
                    variant: 'warning',
                });
                fetchNui('restartServer');
            },
        });
    };

    const handleStopServer = () => {
        openDialog({
            title: t('nui_menu.page_main.server_controls.stop.dialog_title'),
            description: t('nui_menu.page_main.server_controls.stop.dialog_desc'),
            placeholder: t('nui_menu.page_main.server_controls.stop.dialog_placeholder'),
            onSubmit: (input: string) => {
                if (input.trim().toUpperCase() !== 'STOP') {
                    return enqueueSnackbar(t('nui_menu.page_main.server_controls.stop.dialog_error'), {
                        variant: 'error',
                    });
                }
                enqueueSnackbar(t('nui_menu.page_main.server_controls.stop.dialog_success'), {
                    variant: 'warning',
                });
                fetchNui('stopServer');
            },
        });
    };

    return {
        menuItems: [
            {
                title: t('nui_menu.page_main.server_controls.restart.title'),
                label: t('nui_menu.page_main.server_controls.restart.label'),
                requiredPermission: 'control.server' as const,
                icon: <RestartAlt />,
                onSelect: handleRestartServer,
            },
            {
                title: t('nui_menu.page_main.server_controls.stop.title'),
                label: t('nui_menu.page_main.server_controls.stop.label'),
                requiredPermission: 'control.server' as const,
                icon: <PowerSettingsNew />,
                onSelect: handleStopServer,
            },
        ],
    };
}
