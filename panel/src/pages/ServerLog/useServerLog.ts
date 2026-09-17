import { useEffect, useRef, useState, useCallback, useReducer } from 'react';
import { getSocket, joinSocketRoom, leaveSocketRoom } from '@/lib/utils';
import { parseFilterQuery, matchesFilterQuery } from '@/lib/textFilter';
import { useBackendApi } from '@/hooks/fetch';
import type { ServerLogEvent, EventFiltersState, EventFilterKey } from './serverLogTypes';
import { EVENT_FILTERS, DEFAULT_FILTERS, LOCALSTORAGE_FILTERS_KEY, LOCALSTORAGE_SOUND_KEY } from './serverLogTypes';

const MAX_EVENTS = 2000;
const HISTORY_PAGE_SIZE = 500;

export type SessionFile = {
    name: string;
    size: string;
    ts: string;
    mtime: number;
};

const loadFilters = (): EventFiltersState => {
    try {
        const stored = localStorage.getItem(LOCALSTORAGE_FILTERS_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            return { ...DEFAULT_FILTERS, ...parsed };
        }
    } catch (_) {
        /* ignore */
    }
    return { ...DEFAULT_FILTERS };
};

const saveFilters = (filters: EventFiltersState) => {
    localStorage.setItem(LOCALSTORAGE_FILTERS_KEY, JSON.stringify(filters));
};

const getVisibleTypes = (filters: EventFiltersState): Set<string> => {
    const types = new Set<string>();
    for (const filter of EVENT_FILTERS) {
        if (filters[filter.key]) {
            for (const t of filter.types) {
                types.add(t);
            }
        }
    }
    return types;
};

const EVENT_FILTERS_WITH_SETS = EVENT_FILTERS.map((filter) => ({
    ...filter,
    typeSet: new Set(filter.types),
}));

type ServerLogSocketState = {
    events: ServerLogEvent[];
    isConnected: boolean;
};

type ServerLogSocketAction =
    | { type: 'setConnected'; isConnected: boolean }
    | { type: 'appendEvents'; events: ServerLogEvent[] }
    | { type: 'replaceEvents'; events: ServerLogEvent[] }
    | { type: 'clearEvents' };

const trimServerLogEvents = (events: ServerLogEvent[]) => {
    if (events.length > MAX_EVENTS) {
        return events.slice(-MAX_EVENTS);
    }
    return events;
};

function reduceServerLogSocketState(state: ServerLogSocketState, action: ServerLogSocketAction): ServerLogSocketState {
    switch (action.type) {
        case 'setConnected':
            return {
                ...state,
                isConnected: action.isConnected,
            };
        case 'appendEvents':
            return {
                ...state,
                events: trimServerLogEvents([...state.events, ...action.events]),
            };
        case 'replaceEvents':
            return {
                ...state,
                events: trimServerLogEvents(action.events),
            };
        case 'clearEvents':
            return {
                ...state,
                events: [],
            };
        default:
            return state;
    }
}

export default function useServerLog() {
    const [socketState, dispatchSocketState] = useReducer(reduceServerLogSocketState, {
        events: [],
        isConnected: false,
    });
    const { events, isConnected } = socketState;
    const [isLive, setIsLive] = useState(true);
    const [isLoadingOlder, setIsLoadingOlder] = useState(false);
    const [hasOlderData, setHasOlderData] = useState(true);
    const [filters, setFilters] = useState<EventFiltersState>(loadFilters);
    const [searchText, setSearchText] = useState('');
    const [playerFilter, setPlayerFilter] = useState<string | null>(null);
    const [playerCommandsOnly, setPlayerCommandsOnly] = useState(false);
    const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem(LOCALSTORAGE_SOUND_KEY) === 'true');
    const [sessions, setSessions] = useState<SessionFile[]>([]);
    const [activeSession, setActiveSession] = useState<string | null>(null);
    const [isLoadingSession, setIsLoadingSession] = useState(false);

    const pageSocket = useRef<ReturnType<typeof getSocket> | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);

    const playNotifSound = useCallback(() => {
        if (!soundEnabled) return;
        try {
            if (!audioCtxRef.current) {
                audioCtxRef.current = new AudioContext();
            }
            const ctx = audioCtxRef.current;
            const oscillator = ctx.createOscillator();
            const gain = ctx.createGain();
            oscillator.connect(gain);
            gain.connect(ctx.destination);
            oscillator.type = 'sine';
            oscillator.frequency.value = 880;
            gain.gain.setValueAtTime(0.3, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
            oscillator.start(ctx.currentTime);
            oscillator.stop(ctx.currentTime + 0.15);
        } catch (_) {
            /* ignore */
        }
    }, [soundEnabled]);

    // ── Partial history API ──
    const historyApi = useBackendApi<{ boundry: boolean; log: ServerLogEvent[] }>({
        method: 'GET',
        path: '/logs/server/partial',
        throwGenericErrors: true,
    });

    // ── Session APIs ──
    const sessionsApi = useBackendApi<{ sessions: SessionFile[] }>({
        method: 'GET',
        path: '/logs/server/sessions',
        throwGenericErrors: true,
    });
    const sessionFileApi = useBackendApi<{ events: ServerLogEvent[] }>({
        method: 'GET',
        path: '/logs/server/session',
        throwGenericErrors: true,
    });

    // ── Fetch session list on mount ──
    useEffect(() => {
        sessionsApi({})
            .then((resp) => {
                if (resp?.sessions) setSessions(resp.sessions);
            })
            .catch(() => {
                /* ignore */
            });
    }, []);

    // ── Socket connection ──
    useEffect(() => {
        if (!isLive) return;

        const socket = getSocket();
        pageSocket.current = socket;
        dispatchSocketState({ type: 'setConnected', isConnected: socket.connected });

        const connectHandler = () => {
            dispatchSocketState({ type: 'setConnected', isConnected: true });
        };
        const disconnectHandler = () => {
            dispatchSocketState({ type: 'setConnected', isConnected: false });
        };
        const logDataHandler = (data: ServerLogEvent[]) => {
            if (!Array.isArray(data)) return;
            dispatchSocketState({ type: 'appendEvents', events: data });
        };

        socket.on('connect', connectHandler);
        socket.on('disconnect', disconnectHandler);
        (socket as any).on('logData', logDataHandler);
        joinSocketRoom('serverlog');

        return () => {
            socket.off('connect', connectHandler);
            socket.off('disconnect', disconnectHandler);
            (socket as any).off('logData', logDataHandler);
            leaveSocketRoom('serverlog');
            pageSocket.current = null;
            dispatchSocketState({ type: 'setConnected', isConnected: false });
        };
    }, [isLive]);

    // ── Play sound for specific event types ──
    const prevEventsLen = useRef(0);
    useEffect(() => {
        if (!soundEnabled) return;
        if (events.length > prevEventsLen.current && prevEventsLen.current > 0) {
            const newEvents = events.slice(prevEventsLen.current);
            const hasNotifiable = newEvents.some((e) => e.type === 'explosionEvent' || e.type === 'DeathNotice');
            if (hasNotifiable) {
                playNotifSound();
            }
        }
        prevEventsLen.current = events.length;
    }, [events, soundEnabled, playNotifSound]);

    // ── Toggle live/paused ──
    const toggleLive = useCallback(() => {
        setIsLive((prev) => !prev);
    }, []);

    const goLive = useCallback(() => {
        setActiveSession(null);
        dispatchSocketState({ type: 'clearEvents' });
        setHasOlderData(true);
        setIsLive(true);
    }, []);

    // ── Load historical session ──
    const loadSession = useCallback(
        async (fileName: string) => {
            // Disconnect live - setting isLive to false triggers the useEffect cleanup
            // which calls leaveSocketRoom('serverlog')
            setIsLive(false);

            setActiveSession(fileName);
            dispatchSocketState({ type: 'clearEvents' });
            setHasOlderData(false);
            setIsLoadingSession(true);
            try {
                const resp = await sessionFileApi({ queryParams: { file: fileName } });
                if (resp?.events) {
                    dispatchSocketState({ type: 'replaceEvents', events: resp.events });
                }
            } catch (_) {
                /* silently fail */
            } finally {
                setIsLoadingSession(false);
            }
        },
        [sessionFileApi],
    );

    // ── Load older events ──
    const loadOlder = useCallback(async () => {
        if (isLoadingOlder || !hasOlderData || events.length === 0) return;
        const oldestTs = events[0].ts;
        setIsLoadingOlder(true);
        try {
            const resp = await historyApi({
                queryParams: { dir: 'older', ref: String(oldestTs) },
            });
            if (!resp || !Array.isArray(resp.log)) return;
            if (resp.boundry) setHasOlderData(false);
            if (resp.log.length > 0) {
                dispatchSocketState({ type: 'replaceEvents', events: [...resp.log, ...events] });
            } else {
                setHasOlderData(false);
            }
        } catch (_) {
            /* silently fail */
        } finally {
            setIsLoadingOlder(false);
        }
    }, [isLoadingOlder, hasOlderData, events, historyApi]);

    // ── Jump to time ──
    const jumpToTime = useCallback(
        async (timestamp: number) => {
            setIsLive(false);
            setActiveSession(null);
            dispatchSocketState({ type: 'clearEvents' });
            setHasOlderData(true);
            setIsLoadingOlder(true);
            try {
                const resp = await historyApi({
                    queryParams: { dir: 'newer', ref: String(timestamp) },
                });
                if (!resp || !Array.isArray(resp.log)) return;
                dispatchSocketState({ type: 'replaceEvents', events: resp.log });
                if (resp.boundry) {
                    // Reached end of buffer — just go live instead
                    goLive();
                }
            } catch (_) {
                /* silently fail */
            } finally {
                setIsLoadingOlder(false);
            }
        },
        [historyApi, goLive],
    );

    // ── Filter management ──
    const toggleFilter = useCallback((key: EventFilterKey) => {
        setFilters((prev) => {
            const next = { ...prev, [key]: !prev[key] };
            saveFilters(next);
            return next;
        });
    }, []);

    const setAllFilters = useCallback((enabled: boolean) => {
        setFilters(() => {
            const next: EventFiltersState = { ...DEFAULT_FILTERS };
            for (const key of Object.keys(next) as EventFilterKey[]) {
                next[key] = enabled;
            }
            saveFilters(next);
            return next;
        });
    }, []);

    const toggleSound = useCallback(() => {
        setSoundEnabled((prev) => {
            const next = !prev;
            localStorage.setItem(LOCALSTORAGE_SOUND_KEY, String(next));
            return next;
        });
    }, []);

    const handleSetPlayerFilter = useCallback((name: string | null) => {
        setPlayerFilter(name);
        if (!name) setPlayerCommandsOnly(false);
    }, []);

    const togglePlayerCommandsOnly = useCallback(() => {
        setPlayerCommandsOnly((prev) => !prev);
    }, []);

    // ── Filtered & searched events ──
    const visibleTypes = getVisibleTypes(filters);
    const parsedSearch = parseFilterQuery(searchText);
    const commandsOnly = !!playerFilter && playerCommandsOnly;

    const filteredEvents = events.filter((e) => {
        if (commandsOnly) {
            // "player + their commands" view overrides the category chips
            if (e.type !== 'CommandExecuted') return false;
        } else if (!visibleTypes.has(e.type)) {
            return false;
        }
        if (playerFilter && e.src.name !== playerFilter) return false;
        if (!parsedSearch.isEmpty) {
            const haystack = `${e.src.name} ${e.msg}`.toLowerCase();
            if (!matchesFilterQuery(haystack, parsedSearch)) return false;
        }
        return true;
    });

    // ── Event counts per filter ──
    const eventCounts: Record<EventFilterKey, number> = {
        joins: 0,
        leaves: 0,
        chat: 0,
        deaths: 0,
        menu: 0,
        explosions: 0,
        commands: 0,
        system: 0,
    };
    for (const event of events) {
        for (const filter of EVENT_FILTERS_WITH_SETS) {
            if (filter.typeSet.has(event.type)) {
                eventCounts[filter.key]++;
                break;
            }
        }
    }

    return {
        events: filteredEvents,
        allEventsCount: events.length,
        eventCounts,
        isLive,
        isConnected,
        isLoadingOlder,
        isLoadingSession,
        hasOlderData,
        filters,
        searchText,
        playerFilter,
        playerCommandsOnly: commandsOnly,
        soundEnabled,
        sessions,
        activeSession,
        toggleLive,
        goLive,
        loadOlder,
        loadSession,
        jumpToTime,
        toggleFilter,
        setAllFilters,
        setSearchText,
        setPlayerFilter: handleSetPlayerFilter,
        togglePlayerCommandsOnly,
        toggleSound,
    };
}
