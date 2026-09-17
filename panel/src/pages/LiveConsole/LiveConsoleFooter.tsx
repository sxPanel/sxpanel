import React, { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn, submitAuthedDownload } from '@/lib/utils';
import { BookMarkedIcon, FileDownIcon, ListFilterIcon, SearchIcon, Trash2Icon } from 'lucide-react';
import { useAdminPerms, useCsrfToken } from '@/hooks/auth';
import { useLiveConsoleHistory } from '@/pages/LiveConsole/liveConsoleHooks';
import { useAtomValue } from 'jotai';
import { fxRunnerStateAtom } from '@/hooks/status';
import LiveConsoleOptionsDropdown from '@/pages/LiveConsole/LiveConsoleOptionsDropdown';
import type { LiveConsoleOptions } from '@/pages/LiveConsole/LiveConsolePage';
import { useLocale } from '@/hooks/locale';

type ConsoleFooterButtonProps = {
    icon: React.ElementType;
    title: string;
    disabled?: boolean;
    onClick: () => void;
};

function ConsoleFooterButton({ icon: Icon, title, disabled, onClick }: ConsoleFooterButtonProps) {
    return (
        <div
            tabIndex={0}
            role="button"
            aria-disabled={disabled ? true : undefined}
            className={cn(
                `group bg-secondary xs:bg-transparent 2xl:hover:bg-secondary ring-offset-background focus-visible:ring-ring flex w-full cursor-pointer items-center justify-center rounded-lg px-1.5 py-2 transition-all focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden`,
                disabled && 'pointer-events-none opacity-50',
            )}
            onClick={() => !disabled && onClick()}
            onKeyDown={(e) => (e.code === 'Enter' || e.code === 'Space') && !disabled && onClick()}
        >
            <Icon className="text-muted-foreground group-hover:text-secondary-foreground inline size-6 group-hover:scale-110 2xl:h-5 2xl:w-5" />
            <span className="ml-1 hidden align-middle 2xl:inline">{title}</span>
        </div>
    );
}

type LiveConsoleFooterProps = {
    isConnected: boolean;
    consoleWrite: (_data: string) => void;
    consoleClear: () => void;
    toggleSaveSheet: () => void;
    toggleSearchBar: () => void;
    toggleFilterPanel: () => void;
    termInputRef: React.RefObject<HTMLInputElement | null>;
    consoleOptions: LiveConsoleOptions;
    onOptionsChange: (options: LiveConsoleOptions) => void;
};

export default function LiveConsoleFooter(props: LiveConsoleFooterProps) {
    const { t } = useLocale();
    const { history, appendHistory } = useLiveConsoleHistory();
    const [histIndex, setHistIndex] = useState(-1);
    const savedInput = useRef('');
    const termInputRef = props.termInputRef;
    const { hasPerm } = useAdminPerms();
    const hasWritePerm = hasPerm('console.write');
    const csrfToken = useCsrfToken();
    const fxRunnerState = useAtomValue(fxRunnerStateAtom);

    //autofocus on input when connected
    useEffect(() => {
        if (props.isConnected && termInputRef.current) {
            termInputRef.current.focus();
        }
    }, [props.isConnected, termInputRef]);

    const handleArrowUp = () => {
        if (!termInputRef.current) return;
        if (histIndex === -1) {
            savedInput.current = termInputRef.current.value ?? '';
        }
        const nextHistId = histIndex + 1;
        if (history[nextHistId]) {
            termInputRef.current.value = history[nextHistId];
            setHistIndex(nextHistId);
        }
    };

    const handleArrowDown = () => {
        if (!termInputRef.current) return;
        const prevHistId = histIndex - 1;
        if (prevHistId === -1) {
            termInputRef.current.value = savedInput.current;
            setHistIndex(prevHistId);
        } else if (history[prevHistId]) {
            termInputRef.current.value = history[prevHistId];
            setHistIndex(prevHistId);
        }
    };

    const handleEnter = () => {
        if (!termInputRef.current) return;
        const currentInput = termInputRef.current.value.trim();
        setHistIndex(-1);
        termInputRef.current.value = '';
        savedInput.current = '';
        if (currentInput) {
            appendHistory(currentInput);
            props.consoleWrite(currentInput);
        }
    };

    const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!props.isConnected) return;
        if (e.key === 'ArrowUp') {
            handleArrowUp();
            e.preventDefault();
        } else if (e.key === 'ArrowDown') {
            handleArrowDown();
            e.preventDefault();
        } else if (e.key === 'Enter') {
            handleEnter();
            e.preventDefault();
        }
    };

    let inputError: string | undefined;
    if (!hasWritePerm) {
        inputError = t('panel.live_console.footer.no_write_perm');
    } else if (!fxRunnerState.isChildAlive) {
        inputError = t('panel.live_console.footer.server_not_running');
    } else if (!props.isConnected) {
        inputError = t('panel.live_console.footer.socket_lost');
    }

    return (
        <div className="xs:flex-row xs:items-center flex flex-col justify-center gap-2 border-t px-1 py-2 sm:px-4">
            <div className="flex grow items-center">
                <svg
                    className="text-warning-inline mr-2 hidden size-4 shrink-0 sm:block"
                    fill="none"
                    height="24"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    width="24"
                    xmlns="http://www.w3.org/2000/svg"
                >
                    <path d="m9 18 6-6-6-6" />
                </svg>
                <Input
                    ref={termInputRef}
                    className={cn('w-full', !!inputError && 'placeholder:text-destructive placeholder:opacity-100')}
                    placeholder={inputError ?? t('panel.live_console.footer.command_placeholder')}
                    type="text"
                    disabled={!!inputError}
                    onKeyDown={handleInputKeyDown}
                    autoCapitalize="none"
                    autoComplete="off"
                    autoCorrect="off"
                    aria-label={
                        inputError
                            ? t('panel.live_console.footer.input_disabled', { reason: inputError })
                            : t('panel.live_console.footer.input_label')
                    }
                />
            </div>
            <div className="flex flex-row justify-evenly gap-3 select-none 2xl:gap-1">
                <ConsoleFooterButton
                    icon={BookMarkedIcon}
                    title={t('panel.live_console.footer.saved')}
                    onClick={props.toggleSaveSheet}
                />
                <ConsoleFooterButton
                    icon={SearchIcon}
                    title={t('panel.live_console.footer.search')}
                    disabled={!props.isConnected}
                    onClick={props.toggleSearchBar}
                />
                <ConsoleFooterButton
                    icon={ListFilterIcon}
                    title={t('panel.live_console.footer.filter')}
                    disabled={!props.isConnected}
                    onClick={props.toggleFilterPanel}
                />
                <ConsoleFooterButton
                    icon={Trash2Icon}
                    title={t('panel.live_console.footer.clear')}
                    disabled={!props.isConnected}
                    onClick={props.consoleClear}
                />
                <ConsoleFooterButton
                    icon={FileDownIcon}
                    title={t('panel.live_console.footer.download')}
                    disabled={!props.isConnected || !csrfToken}
                    onClick={() => {
                        submitAuthedDownload('/logs/fxserver/download', csrfToken);
                    }}
                />
                <LiveConsoleOptionsDropdown options={props.consoleOptions} onOptionsChange={props.onOptionsChange} />
            </div>
        </div>
    );
}
