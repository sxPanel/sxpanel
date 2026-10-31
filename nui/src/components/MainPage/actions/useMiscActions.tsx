import React from 'react';
import { Announcement, CenterFocusWeak, Groups, Map } from '@mui/icons-material';
import { useDialogContext } from '../../../provider/DialogProvider';
import { fetchNui } from '../../../utils/fetchNui';
import { useTranslate } from 'react-polyglot';
import { useSnackbar } from 'notistack';
import { useIsRedmValue } from '@nui/src/state/isRedm.state';
import { useStaffStatusValue } from '@nui/src/state/staffTools.state';
import { useNuiEvent } from '@nui/src/hooks/useNuiEvent';
import { usePlayerModalContext } from '@nui/src/provider/PlayerModalProvider';

export function useMiscActions() {
    const t = useTranslate();
    const { enqueueSnackbar } = useSnackbar();
    const { openDialog } = useDialogContext();
    const isRedm = useIsRedmValue();
    const staffStatus = useStaffStatusValue();
    const { closeMenu } = usePlayerModalContext();

    const handleAnnounceMessage = () => {
        openDialog({
            title: t('nui_menu.page_main.announcement.title'),
            description: t('nui_menu.page_main.announcement.dialog_desc'),
            placeholder: t('nui_menu.page_main.announcement.dialog_placeholder'),
            onSubmit: (message: string) => {
                enqueueSnackbar(t('nui_menu.page_main.announcement.dialog_success'), {
                    variant: 'success',
                });
                fetchNui('sendAnnouncement', { message });
            },
        });
    };

    const handleClearArea = (autoClose = false) => {
        if (isRedm) {
            return enqueueSnackbar(t('nui_menu.misc.redm_not_available'), { variant: 'error' });
        }
        openDialog({
            title: t('nui_menu.page_main.clear_area.title'),
            description: t('nui_menu.page_main.clear_area.dialog_desc'),
            placeholder: '300',
            suggestions: ['50', '150', '300'],
            onSubmit: (msg) => {
                const parsedRadius = parseInt(msg);

                if (isNaN(parsedRadius) || parsedRadius > 300 || parsedRadius < 0) {
                    return enqueueSnackbar(t('nui_menu.page_main.clear_area.dialog_error'), { variant: 'error' });
                }

                fetchNui('clearArea', parsedRadius);
                if (autoClose) {
                    closeMenu();
                }
            },
        });
    };
    useNuiEvent('openClearAreaDialog', () => {
        handleClearArea(true);
    });

    const handleTogglePlayerIds = () => {
        fetchNui('togglePlayerIDs');
    };

    const handleToggleMapBlips = () => {
        fetchNui('toggleMapBlips');
    };

    return {
        announcementItem: {
            title: t('nui_menu.page_main.announcement.title'),
            label: t('nui_menu.page_main.announcement.label'),
            requiredPermission: 'announcement',
            icon: <Announcement />,
            onSelect: handleAnnounceMessage,
        },
        clearAreaItem: {
            title: t('nui_menu.page_main.clear_area.title'),
            label: t('nui_menu.page_main.clear_area.label'),
            requiredPermission: 'menu.clear_area',
            icon: <CenterFocusWeak />,
            onSelect: handleClearArea,
        },
        togglesItem: {
            title: t('nui_menu.page_main.toggles.title'),
            isMultiAction: true,
            icon: <Groups />,
            actions: [
                {
                    name: t('nui_menu.page_main.toggles.player_ids'),
                    label: t('nui_menu.page_main.player_ids.label'),
                    value: 'playerIds',
                    icon: <Groups />,
                    requiredPermission: 'menu.viewids',
                    isActive: staffStatus.playerIds,
                    onSelect: handleTogglePlayerIds,
                },
                {
                    name: t('nui_menu.page_main.toggles.map_blips'),
                    label: t('nui_menu.page_main.map_blips.label'),
                    value: 'mapBlips',
                    icon: <Map />,
                    requiredPermission: 'menu.mapblips',
                    isActive: staffStatus.mapBlips,
                    onSelect: handleToggleMapBlips,
                },
            ],
        },
    };
}
