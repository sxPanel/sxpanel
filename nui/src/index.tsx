import React from 'react';
import { createRoot } from 'react-dom/client';
import MenuWrapper from './MenuWrapper';
import './index.css';
import { ThemeProvider, StyledEngineProvider } from '@mui/material';
import { Provider as JotaiProvider } from 'jotai';
import { KeyboardNavProvider } from './provider/KeyboardNavProvider';
import { MaterialDesignContent, SnackbarProvider } from 'notistack';
import { registerDebugFunctions } from './utils/registerDebugFunctions';
import { startDevtoolsDetector } from './utils/devtoolsDetector';
import { useNuiEvent } from './hooks/useNuiEvent';
import { useGameCapture } from './hooks/useGameCapture';
import { styled } from '@mui/material/styles';
import { menuTheme, menuRedmTheme } from './styles/theme';
import { useIsRedm } from './state/isRedm.state';
import { useNuiAddonLoader } from './hooks/useNuiAddonLoader';

registerDebugFunctions();
startDevtoolsDetector();

//Overwriting the notistack colors
//Actually using the colors from the RedM theme, but could start using `theme` if needed
const StyledMaterialDesignContent = styled(MaterialDesignContent)(({ theme }) => ({
    '&.notistack-MuiContent-default': {
        color: theme.palette.text.primary,
        backgroundColor: theme.palette.background.paper,
        border: `1px solid ${theme.palette.divider}`,
    },
    '&.notistack-MuiContent-info': {
        backgroundColor: theme.palette.info.main,
        color: theme.palette.info.contrastText,
    },
    '&.notistack-MuiContent-success': {
        backgroundColor: theme.palette.success.main,
        color: theme.palette.success.contrastText,
    },
    '&.notistack-MuiContent-warning': {
        backgroundColor: theme.palette.warning.main,
        color: theme.palette.warning.contrastText,
    },
    '&.notistack-MuiContent-error': {
        backgroundColor: theme.palette.error.main,
        color: theme.palette.error.contrastText,
    },
}));

const App = () => {
    const [isRedm, setIsRedm] = useIsRedm();

    useNuiEvent<string>('setGameName', (gameName: string) => {
        setIsRedm(gameName === 'redm');
    });

    // NOTE: Screenshot & live spectate capture is handled by the inline script
    // in index.html (before React loads), mirroring the fivem-watch approach.
    // The React hook acts as a fallback in case the inline script didn't load.
    useGameCapture();

    // Load NUI addons (styles + scripts) from the addon manifest
    useNuiAddonLoader();

    return (
        <StyledEngineProvider injectFirst>
            <ThemeProvider theme={isRedm ? menuRedmTheme : menuTheme}>
                <KeyboardNavProvider>
                    <SnackbarProvider
                        maxSnack={5}
                        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
                        disableWindowBlurListener={true}
                        Components={{
                            default: StyledMaterialDesignContent,
                            info: StyledMaterialDesignContent,
                            success: StyledMaterialDesignContent,
                            warning: StyledMaterialDesignContent,
                            error: StyledMaterialDesignContent,
                        }}
                    >
                        <React.Suspense fallback={<></>}>
                            <MenuWrapper />
                        </React.Suspense>
                    </SnackbarProvider>
                </KeyboardNavProvider>
            </ThemeProvider>
        </StyledEngineProvider>
    );
};

const rootContainer = document.getElementById('root');
if (!rootContainer) {
    throw new Error('Root element #root not found');
}
const root = createRoot(rootContainer);
root.render(
    <JotaiProvider>
        <App />
    </JotaiProvider>,
);
