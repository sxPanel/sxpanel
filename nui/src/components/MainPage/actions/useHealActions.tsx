import React from 'react';
import { CenterFocusWeakOutlined, FavoriteOutlined, LocalHospitalOutlined } from '@mui/icons-material';
import { useDialogContext } from '../../../provider/DialogProvider';
import { fetchNui } from '../../../utils/fetchNui';
import { useTranslate } from 'react-polyglot';
import { useSnackbar } from 'notistack';
import { HealMode, useHealMode } from '../../../state/healmode.state';

export function useHealActions() {
    const t = useTranslate();
    const { enqueueSnackbar } = useSnackbar();
    const { openDialog } = useDialogContext();
    const [healMode, setHealMode] = useHealMode();

    const handleHealMyself = () => {
        fetchNui('healMyself').catch(() => {});
    };

    const handleHealAllPlayers = () => {
        fetchNui('healAllPlayers').catch(() => {});
        enqueueSnackbar(t('nui_menu.page_main.heal.everyone.success'), {
            variant: 'info',
        });
    };

    const handleHealRadius = () => {
        openDialog({
            title: t('nui_menu.page_main.heal.radius.dialog_title'),
            description: t('nui_menu.page_main.heal.radius.dialog_desc'),
            placeholder: '25',
            suggestions: ['10', '25', '50'],
            onSubmit: (msg) => {
                const parsedRadius = parseInt(msg, 10);

                if (isNaN(parsedRadius) || parsedRadius > 500 || parsedRadius < 1) {
                    return enqueueSnackbar(t('nui_menu.page_main.heal.radius.dialog_error'), { variant: 'error' });
                }

                fetchNui('healRadius', { radius: parsedRadius }).catch(() => {});
                enqueueSnackbar(t('nui_menu.page_main.heal.radius.success'), {
                    variant: 'info',
                });
            },
        });
    };

    return {
        healMode,
        menuItem: {
            title: t('nui_menu.page_main.heal.title'),
            requiredPermission: 'players.heal',
            isMultiAction: true,
            initialValue: healMode,
            actions: [
                {
                    name: t('nui_menu.page_main.heal.myself.title'),
                    label: t('nui_menu.page_main.heal.myself.label'),
                    value: HealMode.SELF,
                    icon: <FavoriteOutlined />,
                    onSelect: () => {
                        setHealMode(HealMode.SELF);
                        handleHealMyself();
                    },
                },
                {
                    name: t('nui_menu.page_main.heal.everyone.title'),
                    label: t('nui_menu.page_main.heal.everyone.label'),
                    value: HealMode.ALL,
                    icon: <LocalHospitalOutlined />,
                    onSelect: () => {
                        setHealMode(HealMode.ALL);
                        handleHealAllPlayers();
                    },
                },
                {
                    name: t('nui_menu.page_main.heal.radius.title'),
                    label: t('nui_menu.page_main.heal.radius.label'),
                    value: HealMode.RADIUS,
                    icon: <CenterFocusWeakOutlined />,
                    onSelect: () => {
                        setHealMode(HealMode.RADIUS);
                        handleHealRadius();
                    },
                },
            ],
        },
    };
}
