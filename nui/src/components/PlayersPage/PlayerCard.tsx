import React, { memo } from 'react';
import { alpha, styled } from '@mui/material/styles';
import { Box, Paper, Theme, Tooltip, Typography } from '@mui/material';
import { DirectionsBoat, DirectionsWalk, DriveEta, LiveHelp, TwoWheeler, Flight } from '@mui/icons-material';
import { useSetAssociatedPlayer } from '../../state/playerDetails.state';
import { asArray, formatDistance } from '../../utils/miscUtils';
import { useTranslate } from 'react-polyglot';
import { PlayerData, VehicleStatus } from '../../hooks/usePlayerListListener';
import { useSetPlayerModalVisibility } from '@nui/src/state/playerModal.state';
import { useServerCtxValue } from '@nui/src/state/server.state';
import { AUTO_TAG_DEFINITIONS, getPrimaryPlayerTag, type PlayerTag, type TagDefinition } from '@shared/socketioTypes';

const PREFIX = 'PlayerCard';

const classes = {
    paper: `${PREFIX}-paper`,
    barBackground: `${PREFIX}-barBackground`,
    barInner: `${PREFIX}-barInner`,
    icon: `${PREFIX}-icon`,
    tooltipOverride: `${PREFIX}-tooltipOverride`,
    tagChip: `${PREFIX}-tagChip`,
};

const FALLBACK_TAG_LOOKUP = Object.fromEntries(
    AUTO_TAG_DEFINITIONS.map((definition) => [definition.id, definition]),
) as Record<string, TagDefinition>;

const deriveTagColors = (hex: string) => {
    const sanitized = hex.startsWith('#') ? hex.slice(1) : hex;
    const normalized =
        sanitized.length === 3
            ? sanitized
                  .split('')
                  .map((char) => `${char}${char}`)
                  .join('')
            : sanitized;

    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);

    return {
        backgroundColor: `rgba(${r}, ${g}, ${b}, 0.16)`,
        borderColor: `rgba(${r}, ${g}, ${b}, 0.34)`,
        color: hex,
    };
};

const buildPlayerTagDisplay = (tags: PlayerTag[], definitions: TagDefinition[]) => {
    const lookup: Record<string, TagDefinition> = { ...FALLBACK_TAG_LOOKUP };
    for (const definition of asArray<TagDefinition>(definitions)) {
        if (definition.enabled === false) {
            delete lookup[definition.id];
        } else {
            lookup[definition.id] = definition;
        }
    }

    const primaryId = getPrimaryPlayerTag(tags, lookup);
    if (!primaryId) return [];

    const tag = lookup[primaryId] ?? { id: primaryId, label: primaryId, color: '#a1a1aa', priority: 999 };
    return [{ ...tag, styles: deriveTagColors(tag.color) }];
};

const StyledBox = styled(Box)(({ theme }) => ({
    [`& .${classes.paper}`]: {
        padding: '12px 14px',
        borderRadius: theme.tokens.radiusRow,
        border: '1px solid transparent',
        backgroundColor: theme.tokens.surfaceRaised,
        cursor: 'pointer',
        transition: 'background-color 120ms ease, border-color 120ms ease',
        minWidth: 0,
        '&:hover': {
            backgroundColor: theme.tokens.surfaceHover,
            borderColor: theme.tokens.borderStrong,
        },
    },

    //Vehicle status is passive metadata — keep it neutral, not brand-colored
    [`& .${classes.icon}`]: {
        paddingRight: 7,
        color: theme.tokens.textMuted,
        display: 'inline-flex',
        alignItems: 'center',
        '& svg': {
            fontSize: 18,
        },
    },

    [`& .${classes.tooltipOverride}`]: {
        fontSize: 12,
    },

    [`& .${classes.tagChip}`]: {
        display: 'inline-flex',
        alignItems: 'center',
        maxWidth: 110,
        minHeight: 22,
        padding: '2px 9px',
        borderRadius: 999,
        border: '1px solid transparent',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.02em',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
    },
}));

const determineHealthColor = (val: number, theme: Theme) => {
    if (val === -1) return theme.tokens.textMuted;
    else if (val <= 20) return theme.palette.error.main;
    else if (val <= 60) return theme.palette.warning.main;
    else return theme.palette.success.main;
};

//Neutral track — only the fill carries the status color, so the grid
//doesn't turn into a wall of competing colored bars.
const HealthBarBackground = styled(Box)(({ theme }) => ({
    background: theme.tokens.surfaceHover,
    height: 4,
    borderRadius: 10,
    overflow: 'hidden',
}));

const HealthBar = styled(Box, {
    shouldForwardProp: (prop) => prop !== 'healthVal',
})<{ healthVal: number }>(({ theme, healthVal }) => ({
    background: determineHealthColor(healthVal, theme),
    boxShadow: `0 0 6px ${alpha(determineHealthColor(healthVal, theme), 0.5)}`,
    height: 4,
    borderRadius: 10,
    overflow: 'hidden',
    transition: 'width 300ms ease',
}));

const PlayerCard: React.FC<{ playerData: PlayerData }> = ({ playerData }) => {
    const setModalOpen = useSetPlayerModalVisibility();
    const setAssociatedPlayer = useSetAssociatedPlayer();
    const t = useTranslate();
    const serverCtx = useServerCtxValue();

    const statusIcon: { [K in VehicleStatus]: React.ReactElement } = {
        unknown: <LiveHelp color="inherit" />,
        walking: <DirectionsWalk color="inherit" />,
        driving: <DriveEta color="inherit" />,
        boating: <DirectionsBoat color="inherit" />,
        biking: <TwoWheeler color="inherit" />,
        flying: <Flight color="inherit" />,
    };

    const handlePlayerClick = () => {
        setAssociatedPlayer(playerData);
        setModalOpen(true);
    };

    const upperCaseStatus = playerData.vType.charAt(0).toUpperCase() + playerData.vType.slice(1);
    const healthBarSize = Math.max(0, playerData.health);
    let primaryTag = buildPlayerTagDisplay(playerData.tags ?? [], serverCtx.tagDefinitions ?? [])[0];
    if (!primaryTag && playerData.admin) {
        primaryTag = buildPlayerTagDisplay(['staff'], serverCtx.tagDefinitions ?? [])[0];
    }
    const cardStyles = primaryTag?.styles;

    return (
        <StyledBox p={1}>
            <div onClick={handlePlayerClick}>
                <Paper
                    className={classes.paper}
                    style={
                        cardStyles
                            ? {
                                  backgroundImage: `linear-gradient(135deg, ${cardStyles.backgroundColor}, transparent 55%)`,
                                  border: `1px solid ${cardStyles.borderColor}`,
                                  boxShadow: `inset 0 1px 0 ${cardStyles.borderColor}`,
                              }
                            : undefined
                    }
                >
                    <Box display="flex" alignItems="center" pb="5px" minWidth={0}>
                        <Box flexGrow={1} display="flex" overflow="hidden" minWidth={0}>
                            <Tooltip
                                title={upperCaseStatus}
                                placement="top"
                                arrow
                                classes={{
                                    tooltip: classes.tooltipOverride,
                                }}
                            >
                                <span className={classes.icon}>{statusIcon[playerData.vType]}</span>
                            </Tooltip>
                            <Typography style={{ marginRight: 6, fontWeight: 500 }} variant="subtitle1" color="textSecondary">
                                #{playerData.id}
                            </Typography>
                            <Typography
                                noWrap
                                variant="subtitle1"
                                color="textPrimary"
                                sx={{
                                    fontWeight: 600,
                                    flexShrink: 1,
                                    minWidth: 0,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                }}
                            >
                                {playerData.displayName}
                            </Typography>
                            <Typography
                                style={{ marginLeft: 'auto', paddingLeft: 7, minWidth: 'fit-content', fontSize: 11 }}
                                noWrap
                                variant="subtitle1"
                                color="textSecondary"
                            >
                                {playerData.dist < 0 ? `?? m` : formatDistance(playerData.dist)}
                            </Typography>
                        </Box>
                        {primaryTag && (
                            <Box ml={1} flexShrink={0} minWidth={0} maxWidth={110}>
                                <span className={classes.tagChip} style={primaryTag.styles} title={primaryTag.label}>
                                    {primaryTag.label}
                                </span>
                            </Box>
                        )}
                    </Box>
                    <div>
                        <Tooltip
                            title={t('nui_menu.page_players.card.health', {
                                percentHealth: playerData.health ?? '0',
                            })}
                            placement="bottom"
                            arrow
                            classes={{
                                tooltip: classes.tooltipOverride,
                            }}
                        >
                            <HealthBarBackground>
                                <HealthBar width={`${healthBarSize}%`} healthVal={playerData.health} />
                            </HealthBarBackground>
                        </Tooltip>
                    </div>
                </Paper>
            </div>
        </StyledBox>
    );
};

export default memo(PlayerCard);
