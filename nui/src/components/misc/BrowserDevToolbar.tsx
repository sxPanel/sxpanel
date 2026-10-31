import React from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { isBrowserEnv } from '../../utils/miscUtils';
import { browserMenuDebug } from '../../utils/registerDebugFunctions';

/**
 * Floating dev controls — only rendered in `npm run browser` mode.
 * Gives one-click access to overlays that Lua normally opens in-game.
 */
export function BrowserDevToolbar() {
    if (!isBrowserEnv()) return null;

    return (
        <Box
            sx={{
                position: 'fixed',
                bottom: 16,
                right: 16,
                zIndex: 9999,
                display: 'flex',
                flexDirection: 'column',
                gap: 0.75,
                p: 1.25,
                borderRadius: 2,
                bgcolor: 'rgba(12, 14, 22, 0.92)',
                border: '1px solid rgba(124, 134, 171, 0.25)',
                backdropFilter: 'blur(8px)',
                pointerEvents: 'auto',
            }}
        >
            <Typography
                variant="caption"
                sx={{
                    color: '#9ea4bd',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    fontSize: '0.65rem',
                }}
            >
                Browser Dev
            </Typography>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                <Button
                    size="small"
                    variant="contained"
                    onClick={() => browserMenuDebug.openReportCreate()}
                    sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                >
                    Report UI
                </Button>
                <Button
                    size="small"
                    variant="outlined"
                    onClick={() => browserMenuDebug.openReportList()}
                    sx={{
                        textTransform: 'none',
                        fontSize: '0.75rem',
                        color: '#9ea4bd',
                        borderColor: 'rgba(124, 134, 171, 0.35)',
                    }}
                >
                    My Tickets
                </Button>
                <Button
                    size="small"
                    variant="outlined"
                    onClick={() => browserMenuDebug.showStaffHud()}
                    sx={{
                        textTransform: 'none',
                        fontSize: '0.75rem',
                        color: '#9ea4bd',
                        borderColor: 'rgba(124, 134, 171, 0.35)',
                    }}
                >
                    Staff HUD
                </Button>
            </Stack>
        </Box>
    );
}
