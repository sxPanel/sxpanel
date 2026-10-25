import { isBrowserEnv } from './miscUtils';
import { debugData } from './debugData';
import { PlayerData } from '../hooks/usePlayerListListener';
import { LocaleType } from '@shared/localeMap';
import { ServerCtx } from '../state/server.state';
import { SetWarnOpenData } from '../components/WarnPage/WarnPage';
import { AddAnnounceData } from '../hooks/useHudListenersService';
import { mockPlayerData } from './generateMockPlayerData';

let playerUpdateInterval: ReturnType<typeof setTimeout> | null = null;

type ReportDebugView = 'menu' | 'create' | 'list';

interface OpenReportUIOptions {
    view?: ReportDebugView;
    priorityEnabled?: boolean;
    categories?: string[];
    players?: { id: number; name: string }[];
}

const DEFAULT_REPORT_PLAYERS = [
    { id: 1, name: 'John_Doe' },
    { id: 2, name: 'Suspect_Player' },
    { id: 3, name: 'Jane_Smith' },
];

const DEFAULT_REPORT_CATEGORIES = ['Player Report', 'Bug Report', 'Question', 'Other'];

const DEFAULT_REPORT_TICKETS = [
    {
        id: 'TKT-1001',
        status: 'inReview' as const,
        category: 'Player Report',
        descriptionPreview: 'Player was RDMing at Legion Square',
        messageCount: 3,
        unreadCount: 1,
        tsCreated: Math.floor(Date.now() / 1000) - 3600,
    },
    {
        id: 'TKT-0998',
        status: 'resolved' as const,
        category: 'Bug Report',
        descriptionPreview: 'Vehicle despawned while driving on the highway',
        messageCount: 5,
        unreadCount: 0,
        tsCreated: Math.floor(Date.now() / 1000) - 86400,
        awaitingFeedback: true,
    },
];

const MenuObject = {
    warnSelf: (reason: string) => {
        debugData<SetWarnOpenData>([
            {
                action: 'setWarnOpen',
                data: {
                    reason: reason,
                    warnedBy: 'Taso',
                    isWarningNew: true,
                },
            },
        ]);
    },
    setPlayerModalTarget: (target: string) => {
        debugData<string>([
            {
                action: 'openPlayerModal',
                data: target,
            },
        ]);
    },
    startPlayerUpdateLoop: (ms = 30000) => {
        if (playerUpdateInterval) {
            clearTimeout(playerUpdateInterval);
            playerUpdateInterval = null;
        }

        console.log('Started player update loop');

        playerUpdateInterval = setInterval(() => {
            const mockPlayers = mockPlayerData(200);

            debugData<PlayerData[]>(
                [
                    {
                        action: 'setPlayerList',
                        data: mockPlayers,
                    },
                ],
                3000,
            );
        }, ms);
    },
    clearPlayerUpdateLoop: () => {
        if (!playerUpdateInterval) return console.error('No interval to clear');

        clearTimeout(playerUpdateInterval);
        playerUpdateInterval = null;
    },
    warnPulse: () => {
        debugData([
            {
                action: 'pulseWarning',
                data: {},
            },
        ]);
    },
    closeWarn: () => {
        debugData([
            {
                action: 'closeWarning',
                data: {},
            },
        ]);
    },
    announceMsg: ({ message, author }: AddAnnounceData) => {
        debugData([
            {
                action: 'addAnnounceMessage',
                data: {
                    message,
                    author,
                },
            },
        ]);
    },
    setCustomLocale: (localeObj: LocaleType) => {
        debugData<ServerCtx>([
            {
                action: 'setServerCtx',
                data: {
                    announceNotiPos: 'top-right',
                    projectName: '',
                    locale: 'custom',
                    localeData: localeObj,
                    alignRight: false,
                    maxClients: 32,
                    oneSync: {
                        status: true,
                        type: 'Infinity',
                    },
                    switchPageKey: 'Tab',
                    sxPanelVersion: '9.9.9',
                    tagDefinitions: [],
                    reportsEnabled: true,
                },
            },
        ]);
    },
    setVisible: (bool: boolean = true) => {
        debugData(
            [
                {
                    action: 'setVisible',
                    data: bool,
                },
            ],
            0,
        );
    },
    useMockPlayerList: () => {
        debugData([
            {
                action: 'setPlayerList',
                data: mockPlayerData(400),
            },
        ]);
    },
    /**
     * Opens the player-facing report UI (ReportPage overlay).
     * @param options.view - Jump straight to `menu`, `create`, or `list`
     */
    openReportUI: (options: OpenReportUIOptions = {}) => {
        const {
            view = 'menu',
            priorityEnabled = true,
            categories = DEFAULT_REPORT_CATEGORIES,
            players = DEFAULT_REPORT_PLAYERS,
        } = options;

        // Single event — back-to-back messages were causing React 19 DOM reconciliation crashes.
        debugData(
            [
                {
                    action: 'openTicketUI',
                    data: {
                        players,
                        categories,
                        priorityEnabled,
                        initialView: view,
                        tickets: DEFAULT_REPORT_TICKETS,
                    },
                },
            ],
            0,
        );
    },
    /** Shortcut — opens directly on the New Ticket / create form */
    openReportCreate: () => MenuObject.openReportUI({ view: 'create' }),
    /** Shortcut — opens on My Tickets list */
    openReportList: () => MenuObject.openReportUI({ view: 'list' }),
    /** Shows the dev tools overlays (coords HUD + entity inspector) with mock data */
    showStaffHud: () => {
        debugData<unknown>(
            [
                { action: 'setStaffStatus', data: { coordsHud: true, inspector: true, invisible: true } },
                { action: 'setCoordsHud', data: { x: -1037.42, y: -2738.11, z: 20.17, heading: 328.4 } },
                {
                    action: 'setInspectorData',
                    data: {
                        target: {
                            entityType: 'vehicle',
                            model: -1216765807,
                            modelHex: '0xB779A091',
                            archetype: 'adder',
                            handle: 123906,
                            netId: 132,
                            owner: 3,
                            playerId: false,
                            health: 742,
                            maxHealth: 1000,
                            coords: { x: -1030.12, y: -2731.55, z: 19.98 },
                            heading: 240.1,
                            distance: 9.6,
                            canDelete: true,
                        },
                    },
                },
            ],
            0,
        );
    },
    /** Shows a staff chat message toast */
    staffChatMsg: (message = 'Heads up, checking the adder at the airport.') => {
        debugData([{ action: 'staffChatMessage', data: { authorId: 3, author: 'Taso', message, isSelf: false } }], 0);
    },
    /** Loads mock players and opens the player modal for the first one */
    openPlayerModalDemo: () => {
        MenuObject.useMockPlayerList();
        setTimeout(() => MenuObject.setPlayerModalTarget('1'), 300);
    },
    /** Opens the staff chat dialog */
    openStaffChatDialog: () => {
        debugData([{ action: 'openStaffChatDialog', data: {} }], 0);
    },
    /** Hides the dev tools overlays */
    hideStaffHud: () => {
        debugData<unknown>(
            [
                { action: 'setStaffStatus', data: { coordsHud: false, inspector: false } },
                { action: 'setCoordsHud', data: false },
                { action: 'setInspectorData', data: false },
            ],
            0,
        );
    },
    /** Closes the report UI overlay */
    closeReportUI: () => {
        debugData([{ action: 'closeTicketUI', data: {} }], 0);
    },
};

/** Shared browser-dev actions — used by `window.menuDebug` and BrowserDevToolbar. */
export const browserMenuDebug = MenuObject;

export const registerDebugFunctions = () => {
    if (isBrowserEnv()) {
        (window as any).menuDebug = browserMenuDebug;

        // `?debug=showStaffHud` runs a debug function on load (handy for headless screenshots)
        const debugFn = new URLSearchParams(window.location.search).get('debug');
        if (debugFn && typeof (browserMenuDebug as any)[debugFn] === 'function') {
            setTimeout(() => (browserMenuDebug as any)[debugFn](), 1500);
        }

        console.log('%csxPanel Debug Utilities', 'font-weight: bold; font-size: 25px; color: red;');
        console.log(
            '%csxPanel debug utilities have been injected for browser use. Inspect `window.menuDebug` object for further details.',
            'font-size: 15px; color: green;',
        );
    }
};
