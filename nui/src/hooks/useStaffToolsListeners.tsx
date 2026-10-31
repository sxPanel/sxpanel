import React from 'react';
import { Box, Typography } from '@mui/material';
import { ForumRounded } from '@mui/icons-material';
import { useSnackbar } from 'notistack';
import { useTranslate } from 'react-polyglot';
import { useNuiEvent } from './useNuiEvent';
import {
    CoordsHudData,
    InspectorData,
    StaffStatus,
    useSetCoordsHud,
    useSetInspector,
    useSetStaffStatus,
} from '../state/staffTools.state';
import { usePlayerMode } from '../state/playermode.state';
import { useAnnounceNotiPosValue } from '../state/server.state';

interface StaffChatMessage {
    authorId: number;
    author: string;
    message: string;
    isSelf: boolean;
}

const staffChatSound = new Audio('sounds/message.mp3');

const StaffChatToast: React.FC<{ title: string; data: StaffChatMessage }> = ({ title, data }) => (
    <Box maxWidth={380} display="flex" gap={1.25} alignItems="flex-start">
        <ForumRounded sx={{ fontSize: 18, mt: '2px', opacity: 0.8 }} />
        <Box minWidth={0}>
            <Typography
                sx={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    opacity: 0.7,
                }}
            >
                {title} · [{data.authorId}] {data.author}
            </Typography>
            <Typography sx={{ fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {data.message}
            </Typography>
        </Box>
    </Box>
);

/**
 * Listeners for the staff tools (status strip, HUD overlays, staff chat).
 * Mounted once at the top level so they work with the menu closed.
 */
export const useStaffToolsListeners = () => {
    const t = useTranslate();
    const { enqueueSnackbar } = useSnackbar();
    const setStaffStatus = useSetStaffStatus();
    const setCoordsHud = useSetCoordsHud();
    const setInspector = useSetInspector();
    const [, setPlayerMode] = usePlayerMode();
    const notiPos = useAnnounceNotiPosValue();

    useNuiEvent<Partial<StaffStatus>>('setStaffStatus', (changes) => {
        if (!changes || typeof changes !== 'object') return;
        setStaffStatus((prev) => ({ ...prev, ...changes }));
        // Keeps the Player Mode row in sync when changed through keybinds/commands
        if (changes.playerMode) setPlayerMode(changes.playerMode);
    });

    useNuiEvent<CoordsHudData | false>('setCoordsHud', setCoordsHud);
    useNuiEvent<InspectorData>('setInspectorData', setInspector);

    useNuiEvent<StaffChatMessage>('staffChatMessage', (data) => {
        if (!data || typeof data.message !== 'string') return;
        if (!data.isSelf) {
            staffChatSound.play().catch(() => {});
        }
        enqueueSnackbar(<StaffChatToast title={t('nui_menu.staff_chat.title')} data={data} />, {
            variant: 'default',
            autoHideDuration: 12000,
            anchorOrigin: notiPos,
        });
    });
};
