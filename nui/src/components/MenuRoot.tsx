import React, { lazy, Suspense } from 'react';
import { Box } from '@mui/material';
import { txAdminMenuPage, usePageValue } from '../state/page.state';
import { useHudListenersService } from '../hooks/useHudListenersService';
import { usePlayerListListener } from '../hooks/usePlayerListListener';
import { useStaffToolsListeners } from '../hooks/useStaffToolsListeners';
import { useServerCtxValue } from '../state/server.state';
import { MenuRootContent } from '@nui/src/components/MenuRootContent';
import { PageTabs } from '@nui/src/components/misc/PageTabs';
import { MENU_MAIN_COLUMN_WIDTH } from '@nui/src/styles/theme';

const PlayersPage = lazy(() => import('./PlayersPage/PlayersPage').then((module) => ({ default: module.PlayersPage })));
const ReportsTab = lazy(() => import('./ReportsTab/ReportsTab').then((module) => ({ default: module.ReportsTab })));

const MenuRoot: React.FC = () => {
    useHudListenersService();
    useStaffToolsListeners();
    usePlayerListListener();
    const curPage = usePageValue();
    const serverCtx = useServerCtxValue();

    if (curPage === txAdminMenuPage.PlayerModalOnly) return null;
    return (
        <>
            <Box
                style={{
                    width: MENU_MAIN_COLUMN_WIDTH,
                    flexShrink: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    alignSelf: serverCtx.alignRight ? 'flex-end' : 'auto',
                }}
            >
                <PageTabs />
                <MenuRootContent />
            </Box>
            <Suspense fallback={null}>{curPage === txAdminMenuPage.Players && <PlayersPage visible />}</Suspense>
            {serverCtx.reportsEnabled && (
                <Suspense fallback={null}>{curPage === txAdminMenuPage.Reports && <ReportsTab visible />}</Suspense>
            )}
        </>
    );
};

export default MenuRoot;
