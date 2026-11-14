import React from 'react';
import { Box, styled } from '@mui/material';
import { PlayerPageHeader } from './PlayerPageHeader';
import { useFilteredSortedPlayers } from '../../state/players.state';
import { PlayersListEmpty } from './PlayersListEmpty';
import { PlayersListGrid } from './PlayersListGrid';

const RootStyled = styled(Box)(({ theme }) => ({
    backgroundColor: theme.tokens.surface,
    boxShadow: theme.tokens.shadowCard,
    border: `1px solid ${theme.tokens.border}`,
    //Hugs its content (header + player grid) up to maxHeight, then the grid
    //below scrolls internally — a full 50vh box wastes screen space when
    //there are only a couple of players online.
    height: 'fit-content',
    maxHeight: '50vh',
    flexDirection: 'column',
    minWidth: 0,
    boxSizing: 'border-box',
    overflow: 'hidden',
    borderRadius: theme.tokens.radiusCard,
}));

const GridStyled = styled(Box)(({ theme }) => ({
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    minWidth: 0,
}));

export const PlayersPage: React.FC<{ visible: boolean }> = ({ visible }) => {
    const players = useFilteredSortedPlayers();

    return (
        <RootStyled mt={2} mb={10} pt={4} px={4} display={visible ? 'flex' : 'none'}>
            <PlayerPageHeader />
            <GridStyled>{players.length ? <PlayersListGrid /> : <PlayersListEmpty />}</GridStyled>
        </RootStyled>
    );
};
