import React, { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { fetchNui } from '@nui/src/utils/fetchNui';
import { useIsMenuVisibleValue } from '../state/visibility.state';
import { txAdminMenuPage, usePageValue } from '../state/page.state';

interface KeyboardNavProviderValue {
    disabledKeyNav: boolean;
    setDisabledKeyNav: (bool: boolean) => void;
}

const KeyboardNavContext = createContext<KeyboardNavProviderValue | null>(null);

interface KeyboardNavProviderProps {
    children: ReactNode;
}

export const KeyboardNavProvider: React.FC<KeyboardNavProviderProps> = ({ children }) => {
    const [disabledKeyNav, setDisabledKeyNav] = useState(false);
    const IsMenuVisible = useIsMenuVisibleValue();
    const curPage = usePageValue();

    const handleSetDisabledInputs = useCallback((bool: boolean) => {
        setDisabledKeyNav(bool);
    }, []);

    useEffect(() => {
        if (!IsMenuVisible) return;

        if (
            curPage === txAdminMenuPage.Players ||
            curPage === txAdminMenuPage.Resources ||
            curPage === txAdminMenuPage.PlayerModalOnly
        ) {
            return setDisabledKeyNav(true);
        }

        if (curPage === txAdminMenuPage.Main) {
            return setDisabledKeyNav(false);
        }
    }, [curPage, IsMenuVisible]);

    useEffect(() => {
        if (!IsMenuVisible) return;
        fetchNui('focusInputs', disabledKeyNav, { mockResp: {} }).catch(() => {});
    }, [disabledKeyNav, IsMenuVisible]);

    return (
        <KeyboardNavContext.Provider
            value={{
                disabledKeyNav: disabledKeyNav,
                setDisabledKeyNav: handleSetDisabledInputs,
            }}
        >
            {children}
        </KeyboardNavContext.Provider>
    );
};

export const useKeyboardNavContext = () => {
    const ctx = useContext(KeyboardNavContext);
    if (!ctx) {
        throw new Error('useKeyboardNavContext must be used within KeyboardNavProvider');
    }
    return ctx;
};
