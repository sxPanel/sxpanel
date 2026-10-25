import React from 'react';
import { Box, styled, Typography } from '@mui/material';
import { useTranslate } from 'react-polyglot';
import { InspectorTarget, useCoordsHudValue, useInspectorValue } from '../../state/staffTools.state';
import { useServerCtxValue } from '../../state/server.state';

const HudColumn = styled(Box)({
    position: 'fixed',
    top: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    width: 260,
    pointerEvents: 'none',
    userSelect: 'none',
    zIndex: 1200,
});

const HudCard = styled(Box)(({ theme }) => ({
    backgroundColor: 'rgba(14, 14, 16, 0.86)',
    border: `1px solid ${theme.tokens.border}`,
    borderRadius: theme.tokens.radiusCard,
    padding: '10px 12px',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
}));

const HudTitle = styled(Typography)(({ theme }) => ({
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: theme.tokens.textMuted,
}));

const ValueGrid = styled(Box)({
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    columnGap: 10,
    rowGap: 3,
    marginTop: 6,
    alignItems: 'baseline',
});

const Label = styled('span')(({ theme }) => ({
    fontSize: 11,
    color: theme.tokens.textMuted,
    whiteSpace: 'nowrap',
}));

const Value = styled('span')(({ theme }) => ({
    fontSize: 12,
    color: theme.tokens.textPrimary,
    fontVariantNumeric: 'tabular-nums',
    fontFamily: "'Geist Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace",
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
}));

const Badge = styled('span')(({ theme }) => ({
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    padding: '1px 6px',
    borderRadius: theme.tokens.radiusPill,
    color: theme.tokens.accent,
    backgroundColor: theme.tokens.accentTint,
    border: `1px solid ${theme.tokens.accentBorder}`,
}));

const Kbd = styled('span')(({ theme }) => ({
    fontSize: 10,
    fontWeight: 700,
    padding: '1px 5px',
    borderRadius: 4,
    color: theme.tokens.textPrimary,
    backgroundColor: theme.tokens.surfaceHover,
    border: `1px solid ${theme.tokens.borderStrong}`,
}));

const Crosshair = styled(Box, {
    shouldForwardProp: (prop) => prop !== 'active',
})<{ active: boolean }>(({ theme, active }) => ({
    position: 'fixed',
    top: '50%',
    left: '50%',
    width: 10,
    height: 10,
    marginTop: -5,
    marginLeft: -5,
    borderRadius: '50%',
    border: `2px solid ${active ? theme.tokens.accent : 'rgba(255, 255, 255, 0.7)'}`,
    boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.5)',
    pointerEvents: 'none',
    zIndex: 1200,
    transition: 'border-color 120ms ease',
}));

const fmt = (n: number) => n.toFixed(2);

const HealthBar: React.FC<{ health: number; maxHealth: number }> = ({ health, maxHealth }) => {
    const pct = maxHealth > 0 ? Math.max(0, Math.min(1, health / maxHealth)) : 0;
    return (
        <Box display="flex" alignItems="center" gap={1} minWidth={0}>
            <Box flexGrow={1} height={4} borderRadius={2} bgcolor="rgba(161, 161, 170, 0.2)" overflow="hidden">
                <Box
                    height="100%"
                    width={`${pct * 100}%`}
                    bgcolor={pct > 0.5 ? 'success.main' : pct > 0.2 ? 'warning.main' : 'error.main'}
                />
            </Box>
            <Value>
                {health}/{maxHealth}
            </Value>
        </Box>
    );
};

const InspectorDetails: React.FC<{ target: InspectorTarget }> = ({ target }) => {
    const t = useTranslate();
    return (
        <>
            <ValueGrid>
                <Label>{t('nui_menu.staff_hud.inspector.model')}</Label>
                <Value>{target.archetype ? `${target.archetype} (${target.modelHex})` : target.modelHex}</Value>
                {target.playerId !== false && (
                    <>
                        <Label>{t('nui_menu.staff_hud.inspector.player')}</Label>
                        <Value>#{target.playerId}</Value>
                    </>
                )}
                <Label>{t('nui_menu.staff_hud.inspector.net_id')}</Label>
                <Value>{target.netId !== false ? target.netId : t('nui_menu.staff_hud.inspector.not_networked')}</Value>
                {target.owner !== false && (
                    <>
                        <Label>{t('nui_menu.staff_hud.inspector.owner')}</Label>
                        <Value>#{target.owner}</Value>
                    </>
                )}
                <Label>{t('nui_menu.staff_hud.inspector.health')}</Label>
                <HealthBar health={target.health} maxHealth={target.maxHealth} />
                <Label>{t('nui_menu.staff_hud.inspector.distance')}</Label>
                <Value>{target.distance.toFixed(1)} m</Value>
                <Label>{t('nui_menu.staff_hud.inspector.coords')}</Label>
                <Value>
                    {fmt(target.coords.x)}, {fmt(target.coords.y)}, {fmt(target.coords.z)}
                </Value>
            </ValueGrid>
            {target.canDelete && (
                <Box display="flex" alignItems="center" gap={0.75} mt={1}>
                    <Kbd>DEL</Kbd>
                    <Label>{t('nui_menu.staff_hud.inspector.delete_hint')}</Label>
                </Box>
            )}
        </>
    );
};

/**
 * On-screen overlays for the developer tools (coords HUD, entity inspector).
 * Rendered outside the menu root so it stays visible with the menu closed.
 */
export const StaffHud: React.FC = () => {
    const t = useTranslate();
    const coords = useCoordsHudValue();
    const inspector = useInspectorValue();
    const serverCtx = useServerCtxValue();

    if (!coords && !inspector) return null;
    const target = inspector ? inspector.target : false;

    return (
        <>
            {/* Opposite side of the menu, so they never overlap */}
            <HudColumn style={serverCtx.alignRight ? { left: 40 } : { right: 40 }}>
                {coords && (
                    <HudCard>
                        <HudTitle>{t('nui_menu.staff_hud.coords.title')}</HudTitle>
                        <ValueGrid sx={{ gridTemplateColumns: 'auto 1fr auto 1fr' }}>
                            <Label>X</Label>
                            <Value>{fmt(coords.x)}</Value>
                            <Label>Y</Label>
                            <Value>{fmt(coords.y)}</Value>
                            <Label>Z</Label>
                            <Value>{fmt(coords.z)}</Value>
                            <Label>{t('nui_menu.staff_hud.coords.heading')}</Label>
                            <Value>{fmt(coords.heading)}</Value>
                        </ValueGrid>
                    </HudCard>
                )}
                {inspector && (
                    <HudCard>
                        <Box display="flex" alignItems="center" justifyContent="space-between" gap={1}>
                            <HudTitle>{t('nui_menu.staff_hud.inspector.title')}</HudTitle>
                            {target && <Badge>{t(`nui_menu.staff_hud.inspector.types.${target.entityType}`)}</Badge>}
                        </Box>
                        {target ? (
                            <InspectorDetails target={target} />
                        ) : (
                            <Typography sx={{ fontSize: 12, mt: 0.75, color: 'text.secondary' }}>
                                {t('nui_menu.staff_hud.inspector.no_target')}
                            </Typography>
                        )}
                    </HudCard>
                )}
            </HudColumn>
            {inspector && <Crosshair active={!!target} />}
        </>
    );
};
