// =============================================
// Menu design system — single source of truth
//
// Semantic tokens (per game) + a shared theme builder. Components should
// consume colors via the MUI theme (`theme.tokens.*` / `theme.palette.*`)
// instead of importing hex values directly.
//
// Visual language: dark solid. Opaque panels with hairline white borders
// and soft depth shadows, brand accent reserved for selection states and
// primary actions (never for passive icons/text).
//
// NOTE: deliberately no `backdrop-filter` anywhere in this file or its
// consumers. FiveM's bundled CEF renders backdrop-filter unreliably —
// it can paint an unclipped, unblurred opaque rectangle that ignores the
// element's border-radius, i.e. a black box bleeding past the card. Alpha
// (rgba backgrounds) is plain compositing and always safe; blur is not.
// =============================================
import { createTheme, type Theme } from '@mui/material/styles';

export interface MenuTokens {
    /** Deepest background — main card surfaces (solid, near-opaque). */
    readonly surface: string;
    /** Opaque surface for floating chrome that must not see-through (popovers, tooltips, selects). */
    readonly surfaceSolid: string;
    /** Raised panels — list rows, inner cards. A soft wash over `surface`. */
    readonly surfaceRaised: string;
    /** Hover state for raised panels. */
    readonly surfaceHover: string;
    /** Hairline border for cards and rows. */
    readonly border: string;
    /** Emphasized border (focused/hovered outlines). */
    readonly borderStrong: string;
    /** Brand accent — active pill, selected rows. */
    readonly accent: string;
    /** Gradient fill for active/primary elements. */
    readonly accentGradient: string;
    /** Glow shadow under accent-filled elements. */
    readonly accentGlow: string;
    /** Text/icon color rendered on top of the accent. */
    readonly accentContrast: string;
    /** Faint accent wash for selected-row backgrounds. */
    readonly accentTint: string;
    /** Accent-colored border for selected rows. */
    readonly accentBorder: string;
    /** Secondary accent, used by MUI's `secondary` palette slot. */
    readonly accentSecondary: string;
    readonly textPrimary: string;
    readonly textMuted: string;
    readonly success: string;
    readonly warning: string;
    readonly error: string;
    readonly info: string;
    /** Depth shadow for floating cards (menu, dialogs, pages). */
    readonly shadowCard: string;
    /** Outer card radius. */
    readonly radiusCard: number;
    /** List-row / inner panel radius. */
    readonly radiusRow: number;
    /** Fully-rounded pill radius. */
    readonly radiusPill: number;
}

export const fivemTokens: MenuTokens = {
    surface: 'rgba(13, 14, 20, 0.96)',
    surfaceSolid: '#11141d',
    surfaceRaised: 'rgba(255, 255, 255, 0.045)',
    surfaceHover: 'rgba(255, 255, 255, 0.09)',
    border: 'rgba(255, 255, 255, 0.08)',
    borderStrong: 'rgba(255, 255, 255, 0.18)',
    //Violet/indigo, matching the web dashboard's accent — deliberately not
    //txAdmin's classic hot-pink/red.
    accent: '#7c5cff',
    accentGradient: 'linear-gradient(135deg, #9b7bff 0%, #7c5cff 100%)',
    accentGlow: '0 2px 14px rgba(124, 92, 255, 0.4)',
    accentContrast: '#ffffff',
    accentTint: 'rgba(124, 92, 255, 0.14)',
    accentBorder: 'rgba(124, 92, 255, 0.5)',
    accentSecondary: '#7c5cff',
    textPrimary: '#f4f4f6',
    textMuted: '#9aa1b5',
    success: '#0dbd8b',
    warning: '#ffae00',
    error: '#e33131',
    info: '#2b9bc5',
    shadowCard: '0 18px 48px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.35)',
    radiusCard: 18,
    radiusRow: 10,
    radiusPill: 999,
};

export const redmTokens: MenuTokens = {
    surface: 'rgba(23, 19, 14, 0.96)',
    surfaceSolid: '#211b13',
    surfaceRaised: 'rgba(240, 225, 205, 0.05)',
    surfaceHover: 'rgba(240, 225, 205, 0.1)',
    border: 'rgba(240, 225, 205, 0.1)',
    borderStrong: 'rgba(240, 225, 205, 0.22)',
    accent: '#f4df88',
    accentGradient: 'linear-gradient(135deg, #ffefad 0%, #eccf62 100%)',
    accentGlow: '0 2px 14px rgba(244, 223, 136, 0.35)',
    accentContrast: '#241900',
    accentTint: 'rgba(244, 223, 136, 0.13)',
    accentBorder: 'rgba(244, 223, 136, 0.5)',
    accentSecondary: '#c68ed9',
    textPrimary: '#efe8df',
    textMuted: '#b5a795',
    success: '#57d58d',
    warning: '#f5b041',
    error: '#d52c1a',
    info: '#5bace1',
    shadowCard: '0 18px 48px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.4)',
    radiusCard: 18,
    radiusRow: 10,
    radiusPill: 999,
};

interface MenuThemeMeta {
    readonly name: string;
    readonly logo: string;
}

/**
 * Builds the MUI theme for a game variant from its semantic tokens, with all
 * shared component overrides centralized here.
 */
const buildMenuTheme = (tokens: MenuTokens, meta: MenuThemeMeta): Theme => {
    return createTheme({
        name: meta.name,
        logo: meta.logo,
        tokens,
        typography: {
            fontFamily: "'Geist Variable', 'Inter', 'Segoe UI', sans-serif",
            button: {
                textTransform: 'none',
                fontWeight: 600,
            },
        },
        shape: {
            borderRadius: tokens.radiusRow,
        },
        palette: {
            mode: 'dark',
            primary: {
                main: tokens.accent,
                contrastText: tokens.accentContrast,
            },
            secondary: {
                main: tokens.accentSecondary,
            },
            success: {
                main: tokens.success,
            },
            warning: {
                main: tokens.warning,
            },
            error: {
                main: tokens.error,
            },
            info: {
                main: tokens.info,
            },
            background: {
                default: tokens.surfaceSolid,
                paper: tokens.surfaceSolid,
            },
            action: {
                selected: tokens.accentTint,
            },
            text: {
                primary: tokens.textPrimary,
                secondary: tokens.textMuted,
            },
            divider: tokens.border,
        },
        components: {
            MuiPaper: {
                styleOverrides: {
                    root: {
                        backgroundImage: 'unset',
                    },
                },
            },
            //Flat list: rows have no resting/hover background or border — they read
            //as plain icon + text on the glass card. Only the selected row gets the
            //accent tint + border highlight.
            MuiListItem: {
                styleOverrides: {
                    root: {
                        borderRadius: tokens.radiusRow,
                        border: '1px solid transparent',
                        backgroundColor: 'transparent',
                        '&.Mui-selected': {
                            backgroundColor: tokens.accentTint,
                            border: `1px solid ${tokens.accentBorder}`,
                        },
                    },
                },
            },
            MuiListItemButton: {
                styleOverrides: {
                    root: {
                        borderRadius: tokens.radiusRow,
                        border: '1px solid transparent',
                        backgroundColor: 'transparent',
                        minHeight: 40,
                        paddingTop: 5,
                        paddingBottom: 5,
                        paddingLeft: 6,
                        paddingRight: 28,
                        transition: 'background-color 120ms ease, border-color 120ms ease',
                        '&:hover': {
                            backgroundColor: tokens.surfaceHover,
                        },
                        '&.Mui-selected, &.Mui-selected:hover': {
                            backgroundColor: tokens.accentTint,
                            border: `1px solid ${tokens.accentBorder}`,
                        },
                    },
                    dense: {
                        paddingTop: 5,
                        paddingBottom: 5,
                    },
                },
            },
            MuiListItemIcon: {
                styleOverrides: {
                    root: {
                        minWidth: 36,
                        marginRight: 6,
                        '& svg': {
                            fontSize: 16,
                        },
                    },
                },
            },
            MuiListItemSecondaryAction: {
                styleOverrides: {
                    root: {
                        right: 6,
                        '& svg': {
                            fontSize: 15,
                        },
                    },
                },
            },
            MuiButton: {
                styleOverrides: {
                    root: {
                        borderRadius: 8,
                    },
                    //Neutral glass buttons — accent is reserved for contained/primary.
                    outlinedPrimary: {
                        color: tokens.textPrimary,
                        borderColor: tokens.border,
                        backgroundColor: tokens.surfaceRaised,
                        '&:hover': {
                            borderColor: tokens.borderStrong,
                            backgroundColor: tokens.surfaceHover,
                        },
                        '&.Mui-disabled': {
                            borderColor: tokens.border,
                            color: tokens.textMuted,
                            opacity: 0.4,
                        },
                    },
                    containedPrimary: {
                        background: tokens.accentGradient,
                        boxShadow: tokens.accentGlow,
                        '&:hover': {
                            background: tokens.accentGradient,
                            filter: 'brightness(1.1)',
                            boxShadow: tokens.accentGlow,
                        },
                    },
                },
            },
            MuiChip: {
                styleOverrides: {
                    root: {
                        borderRadius: 6,
                        fontWeight: 500,
                    },
                },
            },
            MuiDialog: {
                styleOverrides: {
                    paper: {
                        backgroundColor: tokens.surface,
                        backgroundImage: 'unset',
                        border: `1px solid ${tokens.borderStrong}`,
                        borderRadius: tokens.radiusCard,
                        boxShadow: tokens.shadowCard,
                    },
                },
            },
            //Floating chrome (select dropdowns, context menus) must stay opaque.
            MuiMenu: {
                styleOverrides: {
                    paper: {
                        backgroundColor: tokens.surfaceSolid,
                        border: `1px solid ${tokens.border}`,
                        borderRadius: tokens.radiusRow,
                        boxShadow: tokens.shadowCard,
                    },
                },
            },
            MuiTooltip: {
                styleOverrides: {
                    tooltip: {
                        backgroundColor: tokens.surfaceSolid,
                        border: `1px solid ${tokens.borderStrong}`,
                        color: tokens.textPrimary,
                        fontSize: 12,
                        boxShadow: '0 6px 20px rgba(0, 0, 0, 0.4)',
                    },
                },
            },
            MuiOutlinedInput: {
                styleOverrides: {
                    notchedOutline: {
                        borderColor: tokens.border,
                    },
                },
            },
        },
    });
};

/** Inner content width for the main menu card and pill bar. */
export const MENU_MAIN_CONTENT_WIDTH = 320;

/**
 * Shared outer width for the pill tab bar and main menu card.
 * Content width + horizontal padding (`px={1.5}` → 12px × 2) + 1px border × 2.
 */
export const MENU_MAIN_COLUMN_WIDTH = MENU_MAIN_CONTENT_WIDTH + 26;

export const menuTheme = buildMenuTheme(fivemTokens, { name: 'fivem', logo: 'images/sxPanel.png' });
export const menuRedmTheme = buildMenuTheme(redmTokens, { name: 'redm', logo: 'images/sxPanel.png' });
