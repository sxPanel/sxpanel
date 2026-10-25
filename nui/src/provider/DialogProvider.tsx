import React, {
    ChangeEvent,
    createContext,
    ReactEventHandler,
    ReactNode,
    useCallback,
    useContext,
    useEffect,
    useState,
} from 'react';

import { styled } from '@mui/material/styles';

import {
    Button,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    InputAdornment,
    TextField,
    Theme,
    useTheme,
} from '@mui/material';
import { Create } from '@mui/icons-material';
import { useKeyboardNavContext } from './KeyboardNavProvider';
import { useSnackbar } from 'notistack';
import { useTranslate } from 'react-polyglot';
import { useSetDisableTab, useSetListenForExit } from '../state/keys.state';
import { txAdminMenuPage, usePageValue } from '../state/page.state';
import { Box } from '@mui/system';

const StyledDialogTitle = styled(DialogTitle)(({ theme }) => ({
    color: theme.palette.text.primary,
    fontSize: 16,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    '&::before': {
        content: '""',
        width: 3,
        height: 16,
        borderRadius: 2,
        backgroundColor: theme.palette.primary.main,
    },
}));
const StyledCreate = styled(Create)(({ theme }) => ({
    color: theme.palette.text.secondary,
}));

interface InputDialogProps {
    title: string;
    description: string;
    placeholder: string;
    onSubmit: (inputValue: string) => void;
    isMultiline?: boolean;
    suggestions?: string[];
}

interface DialogProviderContext {
    openDialog: (dialogProps: InputDialogProps) => void;
    closeDialog: () => void;
    isDialogOpen: boolean;
}

const DialogContext = createContext<DialogProviderContext | null>(null);

const defaultDialogState = {
    description: 'This is the default description for whatever',
    placeholder: 'This is the default placeholder...',
    onSubmit: () => {},
    title: 'Dialog Title',
};

interface DialogProviderProps {
    children: ReactNode;
}

export const DialogProvider: React.FC<DialogProviderProps> = ({ children }) => {
    const theme = useTheme();
    const [canSubmit, setCanSubmit] = useState(true);

    const setDisableTabs = useSetDisableTab();
    const { setDisabledKeyNav } = useKeyboardNavContext();
    const setListenForExit = useSetListenForExit();

    const [dialogOpen, setDialogOpen] = useState(false);
    const [dialogProps, setDialogProps] = useState<InputDialogProps>(defaultDialogState);
    const [dialogInputVal, setDialogInputVal] = useState<string>('');
    const { enqueueSnackbar } = useSnackbar();
    const curPage = usePageValue();
    const t = useTranslate();

    useEffect(() => {
        if (curPage === txAdminMenuPage.Main) {
            setDisabledKeyNav(dialogOpen);
            setDisableTabs(dialogOpen);
        }
    }, [dialogOpen, setDisabledKeyNav, setDisableTabs]);

    const handleDialogSubmit = (suggested?: string) => {
        if (!canSubmit) return;

        const input = suggested ?? dialogInputVal;
        if (!input.trim()) {
            return enqueueSnackbar(t('nui_menu.misc.dialog_empty_input'), {
                variant: 'error',
            });
        }

        dialogProps.onSubmit(input);
        setCanSubmit(false);

        setListenForExit(true);
        setDialogOpen(false);
    };

    const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
        setDialogInputVal(e.target.value);
    };

    const openDialog = useCallback((dialogProps: InputDialogProps) => {
        setDialogProps(dialogProps);
        setDialogOpen(true);
        setListenForExit(false);
    }, []);

    const handleDialogClose = useCallback((_event?: {}, _reason?: 'backdropClick' | 'escapeKeyDown') => {
        setDialogOpen(false);
        setListenForExit(true);
    }, []);

    // We reset default state after the animation is complete
    const handleOnExited = () => {
        setDialogProps(defaultDialogState);
        setCanSubmit(true);
        setDialogInputVal('');
    };

    return (
        <DialogContext.Provider
            value={{
                openDialog,
                closeDialog: () => handleDialogClose(),
                isDialogOpen: dialogOpen,
            }}
        >
            <Dialog
                onClose={handleDialogClose}
                open={dialogOpen}
                fullWidth
                TransitionProps={{
                    onExited: handleOnExited,
                }}
            >
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        handleDialogSubmit();
                    }}
                >
                    <StyledDialogTitle>{dialogProps.title}</StyledDialogTitle>
                    <DialogContent sx={{ pb: 1 }}>
                        <DialogContentText sx={{ fontSize: 13, mb: 1.5 }}>{dialogProps.description}</DialogContentText>
                        <TextField
                            variant="outlined"
                            size="small"
                            autoFocus
                            fullWidth
                            multiline={dialogProps?.isMultiline}
                            id="dialog-input"
                            placeholder={dialogProps.placeholder}
                            InputProps={{
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <StyledCreate color="inherit" fontSize="small" />
                                    </InputAdornment>
                                ),
                                sx: { backgroundColor: theme.tokens.surfaceRaised },
                            }}
                            onChange={handleChange}
                        />
                        {Array.isArray(dialogProps.suggestions) && dialogProps.suggestions.length > 0 && (
                            <Box display="flex" flexWrap="wrap" gap={0.75} mt={1.25}>
                                {dialogProps.suggestions.map((suggestion) => (
                                    <Chip
                                        key={suggestion}
                                        label={suggestion}
                                        size="small"
                                        variant="outlined"
                                        clickable
                                        onClick={() => handleDialogSubmit(suggestion)}
                                    />
                                ))}
                            </Box>
                        )}
                    </DialogContent>
                    <DialogActions sx={{ px: 3, pb: 2 }}>
                        <Button
                            onClick={handleDialogClose}
                            style={{
                                color: theme.palette.text.secondary,
                            }}
                        >
                            {t('nui_menu.common.cancel')}
                        </Button>
                        <Button type="submit" color="primary" variant="contained" disableElevation>
                            {t('nui_menu.common.submit')}
                        </Button>
                    </DialogActions>
                </form>
            </Dialog>
            {children}
        </DialogContext.Provider>
    );
};

export const useDialogContext = () => {
    const ctx = useContext(DialogContext);
    if (!ctx) {
        throw new Error('useDialogContext must be used within DialogProvider');
    }
    return ctx;
};
