import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { alpha, styled } from '@mui/material/styles';
import { Box, Button, IconButton, InputAdornment, MenuItem, Select, Typography, useTheme } from '@mui/material';
import {
    ArrowBack,
    Check,
    DescriptionOutlined,
    PlayArrow,
    Refresh,
    RestartAlt,
    Save,
    Search,
    Stop,
    TaskAlt,
} from '@mui/icons-material';
import { useSnackbar } from 'notistack';
import { useTranslate } from 'react-polyglot';
import { TextField } from '../misc/TextField';
import { fetchWebPipe, PipeTimeout } from '../../utils/fetchWebPipe';
import { userHasPerm } from '../../utils/miscUtils';
import { usePermissionsValue } from '../../state/permissions.state';
import { useSetDisableTab, useSetListenForExit } from '../../state/keys.state';
import type { ApiToastResp } from '@shared/genericApiTypes';
import type {
    ResourceConfigFileEntry,
    ResourceConfigFileResp,
    ResourceConfigFilesResp,
    ResourceConfigSaveReq,
    ResourceConfigSaveResp,
    ResourceGroup,
    ResourceItemData,
    ResourcesListResp,
} from '@shared/resourcesApiTypes';

// =============================================
// Constants & helpers
// =============================================

/**
 * Saves travel client -> server as a single net event (see cl_webpipe.lua), so
 * the in-game editor uses a lower cap than core's own limit. Bigger files can
 * still be edited from the web panel.
 */
const NUI_MAX_CONFIG_FILE_BYTES = 64 * 1024;
const ACTION_REFRESH_DELAY_MS = 1500;
const EDITOR_INDENT = '    ';

type StatusFilter = 'all' | 'started' | 'stopped';
type ResourceAction = 'start_res' | 'stop_res' | 'restart_res' | 'ensure_res';
type ResourcesListData = Exclude<ResourcesListResp, { error: string }>;

const mockResourcesList: ResourcesListData = {
    groups: [
        {
            subPath: '[core]',
            resources: [
                {
                    name: 'es_extended',
                    status: 'started',
                    path: '/srv/resources/[core]/es_extended',
                    version: '1.10.2',
                    author: 'ESX-Framework',
                    description: 'ESX Legacy core',
                },
                {
                    name: 'oxmysql',
                    status: 'started',
                    path: '/srv/resources/[core]/oxmysql',
                    version: '2.9.1',
                    author: 'Overextended',
                    description: 'FXServer to MySQL communication via node-mysql2',
                },
            ],
        },
        {
            subPath: '[jobs]',
            resources: [
                {
                    name: 'esx_policejob',
                    status: 'stopped',
                    path: '/srv/resources/[jobs]/esx_policejob',
                    version: '',
                    author: '',
                    description: '',
                },
            ],
        },
    ],
    totalResources: 3,
    startedCount: 2,
    stoppedCount: 1,
};
const mockConfigFiles: ResourceConfigFilesResp = {
    files: [
        { path: 'config.lua', size: 420, tooLarge: false },
        { path: 'data/items.json', size: 300_000, tooLarge: true },
    ],
    truncated: false,
    maxFileBytes: 256 * 1024,
};
const mockConfigFile: ResourceConfigFileResp = {
    name: 'es_extended',
    file: 'config.lua',
    contents: 'Config = {}\nConfig.Locale = "en"\n',
};

/** The webpipe answers `false` on 404 and `{logout}` on auth failures instead of the typed body. */
const getPipeError = (resp: unknown): string | null | undefined => {
    if (!resp || typeof resp !== 'object') return null;
    const record = resp as Record<string, unknown>;
    if (typeof record.error === 'string') return record.error;
    if (record.logout || record.accessDenied) return typeof record.reason === 'string' ? record.reason : null;
    return undefined;
};

const stripHtml = (msg: string) => msg.replace(/<[^>]*>/g, ' ').trim();

// =============================================
// Styled components
// =============================================

const RootStyled = styled(Box)(({ theme }) => ({
    backgroundColor: theme.tokens.surface,
    boxShadow: theme.tokens.shadowCard,
    border: `1px solid ${theme.tokens.border}`,
    color: theme.tokens.textPrimary,
    height: 'fit-content',
    maxHeight: '60vh',
    minHeight: 380,
    minWidth: 0,
    boxSizing: 'border-box',
    borderRadius: theme.tokens.radiusCard,
    flexDirection: 'column',
    overflow: 'hidden',
}));

const FilterChip = styled('button', {
    shouldForwardProp: (prop) => prop !== 'active',
})<{ active: boolean }>(({ theme, active }) => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontFamily: 'inherit',
    fontSize: 11,
    fontWeight: 600,
    lineHeight: 1,
    padding: '6px 9px',
    cursor: 'pointer',
    borderRadius: theme.tokens.radiusPill,
    color: active ? theme.tokens.textPrimary : theme.tokens.textMuted,
    backgroundColor: active ? theme.tokens.accentTint : 'transparent',
    border: `1px solid ${active ? theme.tokens.accentBorder : theme.tokens.border}`,
    '&:hover': { color: theme.tokens.textPrimary },
}));

const GroupLabel = styled(Typography)(({ theme }) => ({
    fontSize: '0.68rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: theme.tokens.textMuted,
    padding: '10px 4px 4px',
}));

const Row = styled(Box)(({ theme }) => ({
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
    padding: '6px 8px',
    borderRadius: theme.tokens.radiusRow,
    '&:hover': { backgroundColor: theme.tokens.surfaceHover },
}));

const StatusDot = styled('span', {
    shouldForwardProp: (prop) => prop !== 'color',
})<{ color: string }>(({ color }) => ({
    width: 8,
    height: 8,
    flexShrink: 0,
    borderRadius: '50%',
    backgroundColor: color,
    boxShadow: `0 0 6px ${color}`,
}));

const VersionTag = styled('span')(({ theme }) => ({
    flexShrink: 0,
    fontFamily: 'monospace',
    fontSize: 10,
    padding: '1px 5px',
    borderRadius: 4,
    color: theme.tokens.textMuted,
    border: `1px solid ${theme.tokens.border}`,
}));

const EditorArea = styled('textarea')(({ theme }) => ({
    flex: 1,
    minHeight: 220,
    width: '100%',
    boxSizing: 'border-box',
    resize: 'none',
    padding: 10,
    fontFamily: "'Cascadia Mono', Consolas, 'Courier New', monospace",
    fontSize: 12,
    lineHeight: 1.5,
    tabSize: 4,
    whiteSpace: 'pre',
    overflow: 'auto',
    userSelect: 'text',
    color: theme.tokens.textPrimary,
    backgroundColor: theme.tokens.surfaceRaised,
    border: `1px solid ${theme.tokens.border}`,
    borderRadius: theme.tokens.radiusRow,
    outline: 'none',
    '&:focus': { borderColor: theme.tokens.accentBorder },
    '&:disabled': { opacity: 0.6 },
}));

// =============================================
// Resource row
// =============================================

interface ResourceRowProps {
    resource: ResourceItemData;
    busy: boolean;
    canEditConfig: boolean;
    onAction: (action: ResourceAction, resource: ResourceItemData) => void;
    onEditConfig: (resource: ResourceItemData) => void;
}

const ResourceRow: React.FC<ResourceRowProps> = React.memo(
    ({ resource, busy, canEditConfig, onAction, onEditConfig }) => {
        const t = useTranslate();
        const { tokens } = useTheme();
        const isStarted = resource.status === 'started';
        const isStarting = resource.status === 'starting';
        const statusColor = isStarted ? tokens.success : isStarting ? tokens.warning : tokens.error;
        const statusLabel = t(
            isStarted ? 'nui_resources.started' : isStarting ? 'nui_resources.starting' : 'nui_resources.stopped',
        );
        const actionSx = { color: tokens.textMuted, '&:hover': { color: tokens.textPrimary } };

        return (
            <Row>
                <StatusDot color={statusColor} title={statusLabel} />
                <Box minWidth={0} flex={1}>
                    <Box display="flex" alignItems="center" gap={0.75} minWidth={0}>
                        <Typography noWrap sx={{ fontSize: '0.82rem', fontWeight: 600 }}>
                            {resource.name}
                        </Typography>
                        {resource.version && <VersionTag>{resource.version}</VersionTag>}
                        {!isStarted && (
                            <Typography
                                sx={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: statusColor }}
                            >
                                {statusLabel}
                            </Typography>
                        )}
                    </Box>
                    {(resource.description || resource.author) && (
                        <Typography noWrap sx={{ fontSize: '0.7rem', color: tokens.textMuted }}>
                            {[resource.description, resource.author].filter(Boolean).join(' · ')}
                        </Typography>
                    )}
                </Box>
                <Box display="flex" alignItems="center" flexShrink={0}>
                    {isStarted ? (
                        <IconButton
                            size="small"
                            disabled={busy}
                            title={t('nui_resources.stop')}
                            onClick={() => onAction('stop_res', resource)}
                            sx={actionSx}
                        >
                            <Stop fontSize="small" />
                        </IconButton>
                    ) : (
                        <IconButton
                            size="small"
                            disabled={busy}
                            title={t('nui_resources.start')}
                            onClick={() => onAction('start_res', resource)}
                            sx={actionSx}
                        >
                            <PlayArrow fontSize="small" />
                        </IconButton>
                    )}
                    <IconButton
                        size="small"
                        disabled={busy}
                        title={t('nui_resources.restart')}
                        onClick={() => onAction('restart_res', resource)}
                        sx={actionSx}
                    >
                        <RestartAlt fontSize="small" />
                    </IconButton>
                    <IconButton
                        size="small"
                        disabled={busy}
                        title={t('nui_resources.ensure')}
                        onClick={() => onAction('ensure_res', resource)}
                        sx={actionSx}
                    >
                        <TaskAlt fontSize="small" />
                    </IconButton>
                    {canEditConfig && (
                        <IconButton
                            size="small"
                            title={t('nui_resources.edit_config')}
                            onClick={() => onEditConfig(resource)}
                            sx={actionSx}
                        >
                            <DescriptionOutlined fontSize="small" />
                        </IconButton>
                    )}
                </Box>
            </Row>
        );
    },
);

// =============================================
// Config editor view
// =============================================

interface ConfigEditorProps {
    resource: ResourceItemData;
    onBack: () => void;
    onRestart: (resource: ResourceItemData) => void;
}

const ConfigEditor: React.FC<ConfigEditorProps> = ({ resource, onBack, onRestart }) => {
    const t = useTranslate();
    const { tokens } = useTheme();
    const { enqueueSnackbar } = useSnackbar();
    const setDisableTab = useSetDisableTab();
    const setListenForExit = useSetListenForExit();
    const requestIdRef = useRef(0);

    const [files, setFiles] = useState<ResourceConfigFileEntry[] | null>(null);
    const [listError, setListError] = useState<string | null>(null);
    const [currentFile, setCurrentFile] = useState('');
    const [savedContents, setSavedContents] = useState('');
    const [contents, setContents] = useState('');
    const [loadingFile, setLoadingFile] = useState(false);
    const [saving, setSaving] = useState(false);
    const [offerRestart, setOfferRestart] = useState(false);
    const isDirty = !!currentFile && contents !== savedContents;
    const isEditable = (file: ResourceConfigFileEntry) => !file.tooLarge && file.size <= NUI_MAX_CONFIG_FILE_BYTES;

    //While editing, Tab must indent and Backspace/Escape must not close the menu
    useEffect(() => {
        setDisableTab(true);
        setListenForExit(false);
        return () => {
            setDisableTab(false);
            setListenForExit(true);
        };
    }, [setDisableTab, setListenForExit]);

    const loadFile = useCallback(
        async (filePath: string) => {
            const requestId = ++requestIdRef.current;
            setLoadingFile(true);
            setOfferRestart(false);
            let resp: ResourceConfigFileResp | undefined;
            try {
                resp = await fetchWebPipe<ResourceConfigFileResp>('/resources/config/file', {
                    timeout: PipeTimeout.LONG,
                    queryParams: { name: resource.name, file: filePath },
                    mockData: { ...mockConfigFile, name: resource.name },
                });
            } catch {
                resp = undefined;
            }
            if (requestId !== requestIdRef.current) return;
            setLoadingFile(false);
            const error = getPipeError(resp);
            if (error !== undefined || !resp || !('contents' in resp)) {
                enqueueSnackbar(error || t('nui_resources.config_load_failed'), { variant: 'error' });
                return;
            }
            //CEF textareas normalize to LF; core restores CRLF on save when the file used it
            const normalized = resp.contents.replace(/\r\n/g, '\n');
            setCurrentFile(resp.file);
            setSavedContents(normalized);
            setContents(normalized);
        },
        [resource.name, enqueueSnackbar, t],
    );

    //Load the file list when the editor opens
    useEffect(() => {
        const requestId = ++requestIdRef.current;
        (async () => {
            let resp: ResourceConfigFilesResp | undefined;
            try {
                resp = await fetchWebPipe<ResourceConfigFilesResp>('/resources/config/files', {
                    timeout: PipeTimeout.LONG,
                    queryParams: { name: resource.name },
                    mockData: mockConfigFiles,
                });
            } catch {
                resp = undefined;
            }
            if (requestId !== requestIdRef.current) return;
            const error = getPipeError(resp);
            if (error !== undefined || !resp || !('files' in resp)) {
                setFiles([]);
                setListError(error || t('nui_resources.config_load_failed'));
                return;
            }
            setFiles(resp.files);
            const firstEditable = resp.files.find(isEditable);
            if (firstEditable) loadFile(firstEditable.path);
        })();
        return () => {
            requestIdRef.current++;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resource.name]);

    const handleSave = useCallback(async () => {
        if (!currentFile || saving || !isDirty) return;
        const toSave = contents;
        setSaving(true);
        let resp: ResourceConfigSaveResp | undefined;
        try {
            const data: ResourceConfigSaveReq = { name: resource.name, file: currentFile, contents: toSave };
            resp = await fetchWebPipe<ResourceConfigSaveResp>('/resources/config/save', {
                method: 'POST',
                timeout: PipeTimeout.LONG,
                data,
                mockData: { success: true, file: currentFile, backupFile: `${currentFile}.bkp` },
            });
        } catch {
            resp = undefined;
        }
        setSaving(false);
        const error = getPipeError(resp);
        if (error !== undefined || !resp || !('success' in resp)) {
            enqueueSnackbar(error || t('nui_resources.config_save_failed'), { variant: 'error' });
            return;
        }
        setSavedContents(toSave);
        setOfferRestart(true);
        enqueueSnackbar(t('nui_resources.config_saved', { file: resp.file, backup: resp.backupFile }), {
            variant: 'success',
        });
    }, [resource.name, currentFile, contents, saving, isDirty, enqueueSnackbar, t]);

    const handleFileChange = (filePath: string) => {
        if (!filePath || filePath === currentFile) return;
        if (isDirty) {
            enqueueSnackbar(t('nui_resources.config_unsaved'), { variant: 'warning' });
            return;
        }
        loadFile(filePath);
    };

    const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const el = e.currentTarget;
            const { selectionStart, selectionEnd, value } = el;
            setContents(value.slice(0, selectionStart) + EDITOR_INDENT + value.slice(selectionEnd));
            requestAnimationFrame(() => {
                el.selectionStart = el.selectionEnd = selectionStart + EDITOR_INDENT.length;
            });
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            handleSave();
        }
    };

    //Escape leaves the editor (never the whole menu) unless there are unsaved changes
    useEffect(() => {
        const keyHandler = (e: KeyboardEvent) => {
            if (e.code !== 'Escape') return;
            if (isDirty) {
                enqueueSnackbar(t('nui_resources.config_unsaved'), { variant: 'warning' });
            } else {
                onBack();
            }
        };
        window.addEventListener('keydown', keyHandler);
        return () => window.removeEventListener('keydown', keyHandler);
    }, [isDirty, onBack, enqueueSnackbar, t]);

    const byteLength = useMemo(() => new Blob([contents]).size, [contents]);
    const isTooLargeToSave = byteLength > NUI_MAX_CONFIG_FILE_BYTES;

    return (
        <>
            <Box display="flex" alignItems="center" gap={1} mb={1.25} minWidth={0}>
                <Button
                    size="small"
                    color={isDirty ? 'warning' : 'inherit'}
                    startIcon={<ArrowBack />}
                    onClick={onBack}
                    sx={{ flexShrink: 0 }}
                >
                    {t(isDirty ? 'nui_resources.config_discard' : 'nui_resources.back')}
                </Button>
                <Typography noWrap variant="subtitle1" fontWeight={700} sx={{ minWidth: 0, flex: 1 }}>
                    {resource.name}
                </Typography>
                {!!files?.length && (
                    <Select
                        size="small"
                        value={currentFile}
                        displayEmpty
                        disabled={loadingFile || saving}
                        onChange={(e) => handleFileChange(e.target.value)}
                        sx={{ minWidth: 180, maxWidth: 280, fontSize: '0.78rem', fontFamily: 'monospace' }}
                    >
                        {files.map((file) => (
                            <MenuItem
                                key={file.path}
                                value={file.path}
                                disabled={!isEditable(file)}
                                sx={{ fontSize: '0.78rem', fontFamily: 'monospace' }}
                            >
                                {file.path}
                                {!isEditable(file) && ` (${t('nui_resources.config_too_large')})`}
                            </MenuItem>
                        ))}
                    </Select>
                )}
                <Button
                    size="small"
                    variant="contained"
                    startIcon={<Save />}
                    disabled={!isDirty || saving || loadingFile || isTooLargeToSave}
                    onClick={handleSave}
                    sx={{ flexShrink: 0 }}
                >
                    {t('nui_resources.config_save')}
                </Button>
            </Box>

            {offerRestart && !isDirty && (
                <Box
                    display="flex"
                    alignItems="center"
                    gap={1}
                    mb={1.25}
                    px={1.5}
                    py={0.75}
                    sx={{
                        backgroundColor: alpha(tokens.success, 0.13),
                        border: `1px solid ${alpha(tokens.success, 0.5)}`,
                        borderRadius: 1,
                    }}
                >
                    <Check fontSize="small" sx={{ color: tokens.success }} />
                    <Typography sx={{ fontSize: '0.8rem', flex: 1, minWidth: 0 }}>
                        {t('nui_resources.config_restart_prompt')}
                    </Typography>
                    <Button
                        size="small"
                        startIcon={<RestartAlt />}
                        onClick={() => {
                            setOfferRestart(false);
                            onRestart(resource);
                        }}
                    >
                        {t('nui_resources.restart')}
                    </Button>
                </Box>
            )}

            {files === null ? (
                <CenteredNote>{t('nui_resources.loading')}</CenteredNote>
            ) : !files.length ? (
                <CenteredNote>{listError ?? t('nui_resources.config_no_files')}</CenteredNote>
            ) : !currentFile && !loadingFile ? (
                <CenteredNote>{t('nui_resources.config_none_editable')}</CenteredNote>
            ) : (
                <>
                    <EditorArea
                        value={contents}
                        disabled={loadingFile || saving}
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                        wrap="off"
                        onChange={(e) => setContents(e.target.value)}
                        onKeyDown={handleEditorKeyDown}
                    />
                    <Typography
                        sx={{ fontSize: '0.68rem', mt: 0.5, color: isTooLargeToSave ? tokens.error : tokens.textMuted }}
                    >
                        {isTooLargeToSave
                            ? t('nui_resources.config_too_large_to_save')
                            : t('nui_resources.config_hint')}
                    </Typography>
                </>
            )}
        </>
    );
};

const CenteredNote: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { tokens } = useTheme();
    return (
        <Box textAlign="center" py={6} px={2}>
            <Typography variant="body2" sx={{ color: tokens.textMuted }}>
                {children}
            </Typography>
        </Box>
    );
};

// =============================================
// Page
// =============================================

export const ResourcesPage: React.FC<{ visible: boolean }> = ({ visible }) => {
    const t = useTranslate();
    const { tokens } = useTheme();
    const { enqueueSnackbar } = useSnackbar();
    const userPerms = usePermissionsValue();
    //UI hints only: core validates the admin's permissions on every request
    const canControl = userHasPerm('commands.resources', userPerms);
    const canEditConfig = canControl && userHasPerm('server.cfg.editor', userPerms);

    const [data, setData] = useState<ResourcesListData | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [busyResources, setBusyResources] = useState<ReadonlySet<string>>(new Set());
    const [editingResource, setEditingResource] = useState<ResourceItemData | null>(null);
    const mountedRef = useRef(true);
    const refreshTimersRef = useRef(new Set<ReturnType<typeof setTimeout>>());

    const handleRefresh = useCallback(async () => {
        setLoading(true);
        let resp: ResourcesListResp | undefined;
        try {
            resp = await fetchWebPipe<ResourcesListResp>('/resources/list', {
                timeout: PipeTimeout.LONG,
                mockData: mockResourcesList,
            });
        } catch {
            resp = undefined;
        }
        if (!mountedRef.current) return;
        setLoading(false);
        const error = getPipeError(resp);
        if (error !== undefined || !resp || !('groups' in resp)) {
            setLoadError(error || t('nui_resources.load_failed'));
            return;
        }
        setLoadError(null);
        setData(resp);
    }, [t]);

    //The page is only mounted while its tab is active: load on mount, clean up timers on unmount
    useEffect(() => {
        mountedRef.current = true;
        const timers = refreshTimersRef.current;
        handleRefresh();
        return () => {
            mountedRef.current = false;
            timers.forEach(clearTimeout);
            timers.clear();
        };
    }, [handleRefresh]);

    const handleAction = useCallback(
        async (action: ResourceAction, resource: ResourceItemData) => {
            const setBusy = (busy: boolean) => {
                setBusyResources((prev) => {
                    const next = new Set(prev);
                    if (busy) next.add(resource.name);
                    else next.delete(resource.name);
                    return next;
                });
            };
            setBusy(true);
            let resp: ApiToastResp | undefined;
            try {
                resp = await fetchWebPipe<ApiToastResp>('/fxserver/commands', {
                    method: 'POST',
                    data: { action, parameter: resource.name },
                    mockData: { type: 'warning', msg: 'mock' },
                });
            } catch {
                resp = undefined;
            }
            if (!mountedRef.current) return;

            const pipeError = getPipeError(resp);
            if (pipeError !== undefined || !resp || typeof resp.msg !== 'string' || resp.type === 'error') {
                setBusy(false);
                const msg = pipeError || (resp && typeof resp.msg === 'string' ? stripHtml(resp.msg) : '');
                enqueueSnackbar(msg || t('nui_menu.misc.unknown_error'), { variant: 'error' });
                return;
            }
            enqueueSnackbar(t(`nui_resources.sent.${action}`, { name: resource.name }), { variant: 'success' });

            //The command is async on the server: re-read the list once it had time to apply
            const timer = setTimeout(() => {
                refreshTimersRef.current.delete(timer);
                setBusy(false);
                handleRefresh();
            }, ACTION_REFRESH_DELAY_MS);
            refreshTimersRef.current.add(timer);
        },
        [enqueueSnackbar, handleRefresh, t],
    );

    const handleRestart = useCallback(
        (resource: ResourceItemData) => handleAction('restart_res', resource),
        [handleAction],
    );
    const handleCloseEditor = useCallback(() => setEditingResource(null), []);

    const filteredGroups = useMemo<ResourceGroup[]>(() => {
        if (!data) return [];
        const query = searchQuery.trim().toLowerCase();
        return data.groups.flatMap((group) => {
            const resources = group.resources.filter((res) => {
                if (statusFilter === 'started' && res.status !== 'started') return false;
                if (statusFilter === 'stopped' && res.status === 'started') return false;
                if (!query) return true;
                return (
                    res.name.toLowerCase().includes(query) ||
                    res.author.toLowerCase().includes(query) ||
                    res.description.toLowerCase().includes(query)
                );
            });
            return resources.length ? [{ ...group, resources }] : [];
        });
    }, [data, searchQuery, statusFilter]);

    const filterChips: { key: StatusFilter; count?: number }[] = [
        { key: 'all', count: data?.totalResources },
        { key: 'started', count: data?.startedCount },
        { key: 'stopped', count: data?.stoppedCount },
    ];

    return (
        <RootStyled mt={2} mb={10} p={2} display={visible ? 'flex' : 'none'}>
            {editingResource ? (
                <ConfigEditor resource={editingResource} onBack={handleCloseEditor} onRestart={handleRestart} />
            ) : (
                <>
                    <Box display="flex" alignItems="center" gap={1} mb={1.25} minWidth={0}>
                        <Typography variant="subtitle1" fontWeight={700} sx={{ flexShrink: 0 }}>
                            {t('nui_resources.title')}
                        </Typography>
                        <Box flex={1} />
                        {filterChips.map((chip) => (
                            <FilterChip
                                key={chip.key}
                                type="button"
                                active={statusFilter === chip.key}
                                onClick={() => setStatusFilter(chip.key)}
                            >
                                {t(`nui_resources.filter_${chip.key}`)}
                                <span style={{ opacity: 0.7 }}>{chip.count ?? '—'}</span>
                            </FilterChip>
                        ))}
                        <IconButton
                            size="small"
                            onClick={handleRefresh}
                            disabled={loading}
                            title={t('nui_resources.refresh')}
                            sx={{ color: tokens.textMuted, flexShrink: 0 }}
                        >
                            <Refresh fontSize="small" />
                        </IconButton>
                    </Box>

                    <TextField
                        size="small"
                        variant="outlined"
                        fullWidth
                        placeholder={t('nui_resources.search')}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <Search fontSize="small" sx={{ color: tokens.textMuted }} />
                                </InputAdornment>
                            ),
                        }}
                        sx={{
                            mb: 0.5,
                            '& .MuiInputBase-input': { color: tokens.textPrimary, fontSize: '0.82rem' },
                            '& .MuiInputBase-input::placeholder': { color: tokens.textMuted, opacity: 1 },
                            '& .MuiOutlinedInput-root': {
                                '& fieldset': { borderColor: tokens.border },
                                '&:hover fieldset': { borderColor: tokens.textMuted },
                            },
                        }}
                    />

                    <Box flex={1} minHeight={0} sx={{ overflowY: 'auto' }}>
                        {!data && loading ? (
                            <CenteredNote>{t('nui_resources.loading')}</CenteredNote>
                        ) : !data ? (
                            <CenteredNote>{loadError ?? t('nui_resources.load_failed')}</CenteredNote>
                        ) : !filteredGroups.length ? (
                            <CenteredNote>{t('nui_resources.no_results')}</CenteredNote>
                        ) : (
                            <>
                                {loadError && (
                                    <Typography sx={{ fontSize: '0.72rem', color: tokens.error, px: 0.5, pt: 0.5 }}>
                                        {loadError}
                                    </Typography>
                                )}
                                {filteredGroups.map((group) => (
                                    <Box key={group.subPath}>
                                        <GroupLabel>
                                            {group.subPath} · {group.resources.length}
                                        </GroupLabel>
                                        {group.resources.map((resource) => (
                                            <ResourceRow
                                                key={resource.name}
                                                resource={resource}
                                                busy={!canControl || busyResources.has(resource.name)}
                                                canEditConfig={canEditConfig}
                                                onAction={handleAction}
                                                onEditConfig={setEditingResource}
                                            />
                                        ))}
                                    </Box>
                                ))}
                            </>
                        )}
                    </Box>
                </>
            )}
        </RootStyled>
    );
};
