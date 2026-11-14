import React, { Component, ErrorInfo } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';
import { fetchNui } from '../../utils/fetchNui';

interface ErrorCompState {
    hasError: boolean;
    error: Error | null;
    componentStack: string | null;
}

interface ErrorBoundaryProps {
    children?: React.ReactNode;
}

export class TopLevelErrorBoundary extends Component<ErrorBoundaryProps, ErrorCompState> {
    state: ErrorCompState = {
        hasError: false,
        error: null,
        componentStack: null,
    };

    constructor(props: ErrorBoundaryProps) {
        super(props);
    }

    componentDidUpdate() {
        if (this.state.hasError) fetchNui('focusInputs', true).catch(() => {});
    }

    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('[TopLevelErrorBoundary]', error, errorInfo.componentStack);
        this.setState({ componentStack: errorInfo.componentStack ?? null });
    }

    handleReloadClick = () => {
        fetchNui('focusInputs', false).catch(() => {});
        window.location.reload();
    };

    render() {
        if (this.state.hasError) {
            //Stack traces so in-game reports are actionable without devtools access
            const errorStack = this.state.error?.stack;
            const componentStack = this.state.componentStack?.trim();
            return (
                <Dialog open={this.state.hasError} disablePortal maxWidth="md" fullWidth>
                    <DialogTitle>Fatal Error Encountered</DialogTitle>
                    <DialogContent>
                        <DialogContentText component="div">
                            The sxPanel menu has an encountered an error it was unable to recover from, the NUI frame
                            will need to be reloaded. The error message is shown below for developer reference.
                            <br />
                            <br />
                            <code style={{ color: 'red' }}>{this.state.error?.message}</code>
                            {(errorStack || componentStack) && (
                                <pre
                                    style={{
                                        marginTop: 12,
                                        maxHeight: 220,
                                        overflow: 'auto',
                                        fontSize: 11,
                                        lineHeight: 1.45,
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-all',
                                        opacity: 0.75,
                                    }}
                                >
                                    {errorStack}
                                    {componentStack ? `\n\nComponent stack:\n${componentStack}` : ''}
                                </pre>
                            )}
                        </DialogContentText>
                    </DialogContent>
                    <DialogActions>
                        <Button color="primary" onClick={this.handleReloadClick}>
                            Reload Menu
                        </Button>
                    </DialogActions>
                </Dialog>
            );
        }

        return this.props.children;
    }
}
