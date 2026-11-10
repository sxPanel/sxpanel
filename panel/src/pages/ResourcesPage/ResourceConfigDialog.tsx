import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangleIcon, CheckCircle2Icon, FileCogIcon, Loader2Icon, RotateCwIcon, SaveIcon } from 'lucide-react';
import { useBackendApi } from '@/hooks/fetch';
import { useLocale } from '@/hooks/locale';
import { txToast } from '@/components/TxToaster';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LazyMonacoEditor } from '@/components/LazyMonacoEditor';
import {
    ResourceConfigFileEntry,
    ResourceConfigFileResp,
    ResourceConfigFilesResp,
    ResourceConfigSaveReq,
    ResourceConfigSaveResp,
    ResourceItemData,
} from '@shared/resourcesApiTypes';

const MONACO_LANGUAGES: Record<string, string> = {
    lua: 'lua',
    js: 'javascript',
    json: 'json',
    yml: 'yaml',
    yaml: 'yaml',
    cfg: 'ini',
    ini: 'ini',
    toml: 'ini',
};

const getEditorLanguage = (filePath: string) => {
    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
    return MONACO_LANGUAGES[ext] ?? 'plaintext';
};

type DialogState = {
    files: ResourceConfigFileEntry[] | null;
    listError: string | null;
    truncated: boolean;
    currentFile: string;
    savedContents: string;
    editorContents: string;
    isLoadingFile: boolean;
    isSaving: boolean;
    savedFile: string | null;
};

const initialState: DialogState = {
    files: null,
    listError: null,
    truncated: false,
    currentFile: '',
    savedContents: '',
    editorContents: '',
    isLoadingFile: false,
    isSaving: false,
    savedFile: null,
};

type ResourceConfigDialogProps = {
    resource: ResourceItemData | null;
    onClose: () => void;
    onRestart: (resourceName: string) => void;
};

/**
 * Editor for the config files of a single resource. The backend decides which
 * files are editable and confines every path to the resource folder; this
 * component only ever sends (resource name, relative path).
 */
export function ResourceConfigDialog({ resource, onClose, onRestart }: ResourceConfigDialogProps) {
    const { t } = useLocale();
    const [state, setState] = useState<DialogState>(initialState);
    const requestIdRef = useRef(0);
    const { files, listError, truncated, currentFile, savedContents, editorContents, isLoadingFile, isSaving } = state;
    const isDirty = !!currentFile && editorContents !== savedContents;

    const filesApi = useBackendApi<ResourceConfigFilesResp>({ method: 'GET', path: '/resources/config/files' });
    const fileApi = useBackendApi<ResourceConfigFileResp>({ method: 'GET', path: '/resources/config/file' });
    const saveApi = useBackendApi<ResourceConfigSaveResp, ResourceConfigSaveReq>({
        method: 'POST',
        path: '/resources/config/save',
    });

    const resourceName = resource?.name;
    const resourcePath = resource?.path;

    const loadFile = useCallback(
        async (filePath: string) => {
            if (!resourceName) return;
            const requestId = ++requestIdRef.current;
            setState((prev) => ({ ...prev, isLoadingFile: true, savedFile: null }));
            let data: ResourceConfigFileResp | undefined;
            try {
                data = await fileApi({
                    queryParams: { name: resourceName, path: resourcePath ?? '', file: filePath },
                });
            } catch {
                data = undefined;
            }
            if (requestId !== requestIdRef.current) return;
            if (!data || 'error' in data) {
                setState((prev) => ({ ...prev, isLoadingFile: false }));
                txToast.error(data && 'error' in data ? data.error : t('panel.resources_config.load_failed'));
                return;
            }
            const loaded = data;
            setState((prev) => ({
                ...prev,
                isLoadingFile: false,
                currentFile: loaded.file,
                savedContents: loaded.contents,
                editorContents: loaded.contents,
            }));
        },
        [fileApi, resourceName, resourcePath, t],
    );

    //Load the file list whenever a resource is opened
    useEffect(() => {
        if (!resourceName) return;
        const requestId = ++requestIdRef.current;
        setState(initialState);
        (async () => {
            let data: ResourceConfigFilesResp | undefined;
            try {
                data = await filesApi({ queryParams: { name: resourceName, path: resourcePath ?? '' } });
            } catch {
                data = undefined;
            }
            if (requestId !== requestIdRef.current) return;
            if (!data || 'error' in data) {
                const listError = data && 'error' in data ? data.error : t('panel.resources_config.load_failed');
                setState((prev) => ({ ...prev, files: [], listError }));
                return;
            }
            setState((prev) => ({ ...prev, files: data.files, truncated: data.truncated }));
            const firstEditable = data.files.find((f) => !f.tooLarge);
            if (firstEditable) loadFile(firstEditable.path);
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resourceName, resourcePath]);

    const confirmDiscard = () => !isDirty || window.confirm(t('panel.resources_config.discard_confirm'));

    const handleFileChange = (filePath: string) => {
        if (!filePath || filePath === currentFile) return;
        if (!confirmDiscard()) return;
        loadFile(filePath);
    };

    const handleClose = () => {
        if (!confirmDiscard()) return;
        requestIdRef.current++;
        onClose();
    };

    const handleSave = useCallback(async () => {
        if (!resourceName || !currentFile || isSaving) return;
        const contents = editorContents;
        setState((prev) => ({ ...prev, isSaving: true }));
        let data: ResourceConfigSaveResp | undefined;
        try {
            data = await saveApi({
                data: { name: resourceName, path: resourcePath, file: currentFile, contents },
            });
        } catch {
            data = undefined;
        }
        if (!data || 'error' in data) {
            setState((prev) => ({ ...prev, isSaving: false }));
            txToast.error(data && 'error' in data ? data.error : t('panel.resources_config.save_failed'));
            return;
        }
        const saved = data;
        setState((prev) => ({ ...prev, isSaving: false, savedContents: contents, savedFile: saved.file }));
        txToast.success(t('panel.resources_config.saved', { file: saved.file, backup: saved.backupFile }));
    }, [resourceName, resourcePath, currentFile, editorContents, isSaving, saveApi, t]);

    //CTRL+S shortcut while the dialog is open
    useEffect(() => {
        if (!resourceName) return;
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                handleSave();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [resourceName, handleSave]);

    const hasFiles = !!files?.length;

    return (
        <Dialog open={!!resource} onOpenChange={(open) => !open && handleClose()}>
            <DialogContent className="flex h-[85vh] max-w-5xl flex-col gap-3">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FileCogIcon className="size-5 shrink-0" />
                        <span className="truncate">
                            {t('panel.resources_config.title', { name: resourceName ?? '' })}
                        </span>
                    </DialogTitle>
                    <DialogDescription>{t('panel.resources_config.description')}</DialogDescription>
                </DialogHeader>

                {files === null ? (
                    <div className="text-muted-foreground flex flex-1 items-center justify-center">
                        <Loader2Icon className="size-8 animate-spin" />
                    </div>
                ) : !hasFiles ? (
                    <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 text-sm">
                        <AlertTriangleIcon className={listError ? 'text-destructive size-6' : 'size-6'} />
                        <span className="max-w-md text-center">
                            {listError ?? t('panel.resources_config.no_files')}
                        </span>
                    </div>
                ) : (
                    <>
                        <div className="flex flex-wrap items-center gap-2">
                            <Select value={currentFile} onValueChange={handleFileChange} disabled={isLoadingFile}>
                                <SelectTrigger
                                    className="w-80 max-w-full font-mono text-xs"
                                    aria-label={t('panel.resources_config.file_label')}
                                >
                                    <SelectValue placeholder={t('panel.resources_config.file_label')} />
                                </SelectTrigger>
                                <SelectContent>
                                    {files.map((f) => (
                                        <SelectItem
                                            key={f.path}
                                            value={f.path}
                                            disabled={f.tooLarge}
                                            className="font-mono text-xs"
                                        >
                                            {f.path}
                                            {f.tooLarge && (
                                                <span className="text-muted-foreground ml-2 font-sans">
                                                    ({t('panel.resources_config.too_large')})
                                                </span>
                                            )}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {truncated && (
                                <span className="text-muted-foreground text-xs">
                                    {t('panel.resources_config.truncated')}
                                </span>
                            )}
                            <div className="flex-1" />
                            <Button size="sm" disabled={!isDirty || isSaving || isLoadingFile} onClick={handleSave}>
                                {isSaving ? (
                                    <Loader2Icon className="mr-1.5 size-4 animate-spin" />
                                ) : (
                                    <SaveIcon className="mr-1.5 size-4" />
                                )}
                                {t('panel.resources_config.save')}
                            </Button>
                        </div>

                        {state.savedFile && !isDirty && (
                            <div
                                className="border-success/30 bg-success/10 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                                role="status"
                            >
                                <CheckCircle2Icon className="text-success-inline size-4 shrink-0" />
                                <span className="min-w-0 flex-1">{t('panel.resources_config.restart_prompt')}</span>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                        onRestart(resourceName!);
                                        setState((prev) => ({ ...prev, savedFile: null }));
                                    }}
                                >
                                    <RotateCwIcon className="mr-1.5 size-4" />
                                    {t('panel.resources_config.restart_now')}
                                </Button>
                            </div>
                        )}

                        <div className="border-border/60 bg-background relative min-h-0 flex-1 overflow-hidden rounded-xl border">
                            <div className="absolute inset-0">
                                {isLoadingFile ? (
                                    <div className="text-muted-foreground flex h-full items-center justify-center">
                                        <Loader2Icon className="size-8 animate-spin" />
                                    </div>
                                ) : (
                                    <LazyMonacoEditor
                                        height="100%"
                                        path={`${resourceName}/${currentFile}`}
                                        language={getEditorLanguage(currentFile)}
                                        value={editorContents}
                                        onChange={(value) =>
                                            setState((prev) => ({ ...prev, editorContents: value ?? '' }))
                                        }
                                        options={{
                                            minimap: { enabled: false },
                                            lineNumbers: 'on',
                                            wordWrap: 'on',
                                            scrollBeyondLastLine: false,
                                            fontSize: 14,
                                        }}
                                    />
                                )}
                            </div>
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
