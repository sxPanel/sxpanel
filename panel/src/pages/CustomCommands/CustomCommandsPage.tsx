import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
    AlertTriangleIcon,
    CheckIcon,
    InfoIcon,
    Loader2Icon,
    PencilIcon,
    PlusIcon,
    RadioIcon,
    SquareTerminalIcon,
    Trash2Icon,
    ZapIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import InlineCode from '@/components/InlineCode';
import { txToast } from '@/components/TxToaster';
import { useAdminPerms } from '@/hooks/auth';
import { useOpenConfirmDialog } from '@/hooks/dialogs';
import { BackendApiError, useBackendApi } from '@/hooks/fetch';
import { useLocale } from '@/hooks/locale';
import { cn } from '@/lib/utils';
import { permissionsMap } from '@shared/permissions';
import {
    CustomCommand,
    CustomCommandMenuActionDef,
    GetCustomCommandsResp,
    SaveCustomCommandsReq,
    SaveCustomCommandsResp,
    customCommandMenuActions,
    getMenuActionDef,
    isPrivilegedCustomCommand,
} from '@shared/customCommands';
import CommandEditorDialog from './CommandEditorDialog';
import { actionTypeLabels, blankDraft, draftFromMenuAction } from './customCommandsUtils';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
type EditorState = { draft: CustomCommand; isNew: boolean } | undefined;

const permLabel = (perm: string) => (perm ? (permissionsMap.get(perm)?.label ?? perm) : 'Everyone');

const describeAction = (cmd: CustomCommand) => {
    switch (cmd.action.type) {
        case 'menuAction':
            return getMenuActionDef(cmd.action.actionId)?.label ?? cmd.action.actionId;
        case 'chatMessage':
            return cmd.action.message;
        case 'consoleCommand':
            return cmd.action.command;
        case 'serverEvent':
        case 'clientEvent':
            return cmd.action.eventName;
    }
};

export default function CustomCommandsPage() {
    const { t } = useLocale();
    const { hasPerm } = useAdminPerms();
    const openConfirmDialog = useOpenConfirmDialog();
    const [editor, setEditor] = useState<EditorState>();
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
    const [saveError, setSaveError] = useState<string | null>(null);
    const [tab, setTab] = useState('commands');

    const canEdit = hasPerm('settings.write');
    const canWriteConsole = hasPerm('console.write');

    const queryApi = useBackendApi<GetCustomCommandsResp>({
        method: 'GET',
        path: '/settings/customCommands',
        throwGenericErrors: true,
    });
    const saveApi = useBackendApi<SaveCustomCommandsResp, SaveCustomCommandsReq>({
        method: 'POST',
        path: '/settings/customCommands',
        throwGenericErrors: true,
    });

    const swr = useSWR<GetCustomCommandsResp>(
        '/settings/customCommands',
        async () => {
            const data = await queryApi({});
            if (!data) throw new Error('No data returned');
            return data;
        },
        { isPaused: () => saveStatus === 'saving' || isEditorOpen },
    );
    const commands = swr.data?.commands;

    //Clear the saved pill after a few seconds
    useEffect(() => {
        if (saveStatus !== 'saved') return;
        const timeout = setTimeout(() => setSaveStatus('idle'), 4000);
        return () => clearTimeout(timeout);
    }, [saveStatus]);

    /**
     * Applies the change optimistically, then saves the whole list.
     * On failure, the list is reloaded from the server so the UI never shows unsaved state.
     */
    const saveCommands = async (updater: (prev: CustomCommand[]) => CustomCommand[], successMsg?: string) => {
        if (!swr.data) return false;
        const nextCommands = updater(swr.data.commands);
        setSaveStatus('saving');
        setSaveError(null);
        try {
            await swr.mutate({ ...swr.data, commands: nextCommands }, false);
            const resp = await saveApi({ data: { commands: nextCommands } });
            if (!resp) throw new Error('No data returned');
            if ('error' in resp) throw new Error(resp.error);
            setSaveStatus('saved');
            if (successMsg) {
                txToast.success(
                    resp.liveReloaded
                        ? `${successMsg} Live in-game now.`
                        : `${successMsg} Applies on next server start.`,
                );
            }
            return true;
        } catch (error) {
            setSaveStatus('error');
            setSaveError(error instanceof BackendApiError || error instanceof Error ? error.message : String(error));
            swr.mutate();
            return false;
        }
    };

    //Handlers
    const openEditor = (draft: CustomCommand, isNew: boolean) => {
        setEditor({ draft, isNew });
        setIsEditorOpen(true);
    };
    const handleEditorSave = async (cmd: CustomCommand) => {
        const isNew = editor?.isNew;
        setIsEditorOpen(false);
        await saveCommands(
            (prev) => (isNew ? [...prev, cmd] : prev.map((item) => (item.id === cmd.id ? cmd : item))),
            isNew ? `Created /${cmd.name}.` : `Saved /${cmd.name}.`,
        );
        if (isNew) setTab('commands');
    };
    const handleToggle = (cmd: CustomCommand, enabled: boolean) => {
        saveCommands((prev) => prev.map((item) => (item.id === cmd.id ? { ...item, enabled } : item)));
    };
    const handleDelete = (cmd: CustomCommand) => {
        openConfirmDialog({
            title: 'Delete command',
            actionLabel: 'Delete',
            confirmBtnVariant: 'destructive',
            message: (
                <>
                    Delete <InlineCode>/{cmd.name}</InlineCode>? Players will no longer be able to use it.
                </>
            ),
            onConfirm: () => {
                saveCommands((prev) => prev.filter((item) => item.id !== cmd.id), `Deleted /${cmd.name}.`);
            },
        });
    };
    const handleQuickEnable = (def: CustomCommandMenuActionDef) => {
        if (!commands) return;
        const draft = draftFromMenuAction(def, commands);
        if (!draft.name) return openEditor(draft, true);
        saveCommands((prev) => [...prev, draft], `Enabled /${draft.name}.`);
    };

    //Derived state
    const enabledCount = commands?.filter((cmd) => cmd.enabled).length;
    const usedMenuActions = useMemo(() => {
        const map = new Map<string, CustomCommand[]>();
        for (const cmd of commands ?? []) {
            if (cmd.action.type !== 'menuAction') continue;
            const list = map.get(cmd.action.actionId) ?? [];
            list.push(cmd);
            map.set(cmd.action.actionId, list);
        }
        return map;
    }, [commands]);
    const catalogGroups = useMemo(() => {
        const groups = new Map<string, CustomCommandMenuActionDef[]>();
        for (const action of customCommandMenuActions) {
            const list = groups.get(action.group) ?? [];
            list.push(action);
            groups.set(action.group, list);
        }
        return [...groups.entries()];
    }, []);
    const hasMenuCommands = commands?.some((cmd) => cmd.enabled && cmd.action.type === 'menuAction');
    const isBusy = saveStatus === 'saving';

    return (
        <div className="mx-auto mb-10 flex w-full max-w-(--breakpoint-lg) min-w-96 flex-col px-2 md:px-0">
            {/* Header band */}
            <div className="border-border/60 bg-background mb-4 rounded-xl border">
                <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="bg-secondary/50 text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-xl">
                            <SquareTerminalIcon className="size-5" />
                        </div>
                        <div className="min-w-0">
                            <h1 className="text-foreground text-lg font-semibold tracking-tight">
                                {t('panel.routes.custom_commands')}
                            </h1>
                            <p className="text-muted-foreground mt-0.5 text-xs">
                                Create in-game chat commands, or turn /tx menu actions into commands.
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <SaveStatusPill status={saveStatus} />
                        <LiveStatusPill online={swr.data?.serverOnline} />
                        <StatPill label="Commands" value={commands?.length} />
                        <StatPill label="Enabled" value={enabledCount} />
                    </div>
                </div>
            </div>

            {/* Banners */}
            {swr.error && (
                <Banner variant="error">
                    Error loading commands: {swr.error?.message ?? 'unknown error'}
                    <Button variant="outline" size="sm" onClick={() => swr.mutate()}>
                        Try again
                    </Button>
                </Banner>
            )}
            {saveError && <Banner variant="error">Error saving: {saveError}</Banner>}
            {swr.data && !swr.data.menuEnabled && hasMenuCommands && (
                <Banner variant="warning">
                    The in-game menu is disabled in Settings, so /tx menu action commands won't work until it's enabled.
                </Banner>
            )}
            {!canEdit && (
                <Banner variant="warning">
                    You need the <InlineCode className="text-warning-inline">Settings: Change</InlineCode> permission to
                    edit chat commands.
                </Banner>
            )}

            <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="mb-3">
                    <TabsTrigger value="commands">Your commands</TabsTrigger>
                    <TabsTrigger value="catalog">From the /tx menu</TabsTrigger>
                </TabsList>

                {/* Commands list */}
                <TabsContent value="commands">
                    <div className="border-border/60 bg-background rounded-xl border p-3">
                        {!commands ? (
                            <div className="text-muted-foreground flex flex-col items-center justify-center gap-3 py-12">
                                <Loader2Icon className="size-6 animate-spin" />
                                <p className="text-sm">Loading commands…</p>
                            </div>
                        ) : (
                            <ul className="space-y-2">
                                {!commands.length && (
                                    <li className="text-muted-foreground flex flex-col items-center justify-center gap-3 py-10">
                                        <div className="bg-muted flex size-12 items-center justify-center rounded-xl">
                                            <SquareTerminalIcon className="size-6" />
                                        </div>
                                        <p className="text-sm font-medium">No chat commands yet</p>
                                        <p className="text-muted-foreground/70 max-w-sm text-center text-xs">
                                            Create one from scratch, or pick actions from the /tx menu to use them
                                            straight from chat.
                                        </p>
                                        <Button size="sm" variant="outline" onClick={() => setTab('catalog')}>
                                            Browse /tx menu actions
                                        </Button>
                                    </li>
                                )}
                                {commands.map((cmd) => {
                                    const isLocked = !canWriteConsole && isPrivilegedCustomCommand(cmd);
                                    const disabled = !canEdit || isBusy || isLocked;
                                    return (
                                        <li
                                            key={cmd.id}
                                            className={cn(
                                                'border-border/50 bg-card flex items-start gap-3 rounded-lg border p-3',
                                                !cmd.enabled && 'opacity-60',
                                            )}
                                        >
                                            <Switch
                                                className="mt-0.5"
                                                checked={cmd.enabled}
                                                disabled={disabled}
                                                onCheckedChange={(enabled) => handleToggle(cmd, enabled)}
                                                aria-label={`Enable /${cmd.name}`}
                                            />
                                            <div className="min-w-0 flex-1 space-y-1">
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    <span className="font-mono text-sm font-semibold">/{cmd.name}</span>
                                                    {cmd.aliases.map((alias) => (
                                                        <span
                                                            key={alias}
                                                            className="text-muted-foreground font-mono text-xs"
                                                        >
                                                            /{alias}
                                                        </span>
                                                    ))}
                                                    <Badge variant="outline-solid">
                                                        {actionTypeLabels[cmd.action.type].label}
                                                    </Badge>
                                                    <Badge variant="outline-solid">{permLabel(cmd.permission)}</Badge>
                                                    {cmd.cooldownSeconds > 0 && (
                                                        <Badge variant="outline-solid">
                                                            {cmd.cooldownSeconds}s cooldown
                                                        </Badge>
                                                    )}
                                                </div>
                                                <p className="text-muted-foreground truncate text-xs">
                                                    {cmd.description || describeAction(cmd)}
                                                </p>
                                            </div>
                                            <div className="flex shrink-0 gap-1">
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="size-8"
                                                    disabled={disabled}
                                                    onClick={() => openEditor(cmd, false)}
                                                    title={isLocked ? 'Requires Console: Write' : 'Edit'}
                                                >
                                                    <PencilIcon className="size-4" />
                                                </Button>
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="hover:text-destructive size-8"
                                                    disabled={disabled}
                                                    onClick={() => handleDelete(cmd)}
                                                    title="Delete"
                                                >
                                                    <Trash2Icon className="size-4" />
                                                </Button>
                                            </div>
                                        </li>
                                    );
                                })}
                                <li>
                                    <button
                                        type="button"
                                        disabled={!canEdit || isBusy}
                                        onClick={() => openEditor(blankDraft(), true)}
                                        className={cn(
                                            'border-border/60 text-muted-foreground flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-2 py-3 text-sm font-medium transition-colors',
                                            !canEdit || isBusy
                                                ? 'cursor-not-allowed opacity-50'
                                                : 'hover:border-primary/50 hover:bg-muted/40 hover:text-foreground cursor-pointer',
                                        )}
                                    >
                                        <PlusIcon className="size-4" />
                                        New command
                                    </button>
                                </li>
                            </ul>
                        )}
                    </div>
                    <div className="border-border/50 bg-secondary/40 mt-3 flex gap-3 rounded-xl border p-3">
                        <InfoIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                        <p className="text-muted-foreground text-xs leading-relaxed">
                            Commands are checked server-side against the selected permission, and /tx menu actions
                            re-check their own permission too. If another resource registers a command with the same
                            name, whichever registers last wins.
                        </p>
                    </div>
                </TabsContent>

                {/* Menu action catalog */}
                <TabsContent value="catalog">
                    <div className="space-y-3">
                        {catalogGroups.map(([group, actions]) => (
                            <div key={group} className="border-border/60 bg-background rounded-xl border p-3">
                                <h2 className="text-muted-foreground/80 mb-2 px-1 text-[11px] font-semibold tracking-wider uppercase">
                                    {group}
                                </h2>
                                <ul className="divide-border/50 divide-y">
                                    {actions.map((action) => {
                                        const usedBy = usedMenuActions.get(action.id) ?? [];
                                        return (
                                            <li key={action.id} className="flex items-center gap-3 px-1 py-2.5">
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex flex-wrap items-center gap-1.5">
                                                        <span className="text-sm font-medium">{action.label}</span>
                                                        {action.permission && (
                                                            <Badge variant="outline-solid">
                                                                {permLabel(action.permission)}
                                                            </Badge>
                                                        )}
                                                        {usedBy.map((cmd) => (
                                                            <button
                                                                key={cmd.id}
                                                                type="button"
                                                                disabled={!canEdit}
                                                                onClick={() => openEditor(cmd, false)}
                                                                className={cn(
                                                                    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-xs',
                                                                    cmd.enabled
                                                                        ? 'border-success/30 bg-success/10 text-success-inline'
                                                                        : 'border-border/60 text-muted-foreground',
                                                                )}
                                                            >
                                                                {cmd.enabled && <CheckIcon className="size-3" />}/
                                                                {cmd.name}
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <p className="text-muted-foreground text-xs">
                                                        {action.description}
                                                    </p>
                                                </div>
                                                <div className="flex shrink-0 gap-1.5">
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        disabled={!canEdit || isBusy || !commands}
                                                        onClick={() =>
                                                            commands &&
                                                            openEditor(draftFromMenuAction(action, commands), true)
                                                        }
                                                    >
                                                        Customize
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant={usedBy.length ? 'outline' : 'default'}
                                                        disabled={!canEdit || isBusy || !commands}
                                                        onClick={() => handleQuickEnable(action)}
                                                        title={`Adds /${action.suggestedName}`}
                                                    >
                                                        <ZapIcon className="mr-1 size-3.5" />
                                                        {usedBy.length ? 'Add another' : 'Enable'}
                                                    </Button>
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        ))}
                    </div>
                </TabsContent>
            </Tabs>

            <CommandEditorDialog
                isOpen={isEditorOpen}
                onOpenChange={setIsEditorOpen}
                initialData={editor?.draft}
                isNew={!!editor?.isNew}
                otherCommands={(commands ?? []).filter((cmd) => cmd.id !== editor?.draft.id)}
                canWriteConsole={canWriteConsole}
                onSave={handleEditorSave}
            />
        </div>
    );
}

function StatPill({ label, value }: { label: string; value: number | undefined }) {
    return (
        <div
            className={cn(
                'border-border/50 bg-secondary/40 inline-flex items-center gap-2 rounded-full border px-3 py-1.5',
                value === undefined && 'opacity-60',
            )}
        >
            <span className="text-muted-foreground/70 text-[11px] font-semibold tracking-wider uppercase">{label}</span>
            <span className="text-foreground text-sm font-semibold tabular-nums">{value ?? '—'}</span>
        </div>
    );
}

function LiveStatusPill({ online }: { online: boolean | undefined }) {
    if (online === undefined) return null;
    return (
        <div
            className="border-border/50 bg-secondary/40 inline-flex items-center gap-2 rounded-full border px-3 py-1.5"
            title={online ? 'Changes apply in-game instantly.' : 'Commands will load when the server starts.'}
        >
            <RadioIcon className={cn('size-3.5', online ? 'text-success-inline' : 'text-muted-foreground')} />
            <span className="text-muted-foreground/70 text-[11px] font-semibold tracking-wider uppercase">
                {online ? 'Live sync' : 'Server offline'}
            </span>
        </div>
    );
}

function SaveStatusPill({ status }: { status: SaveStatus }) {
    if (status === 'idle') return null;
    if (status === 'saving') {
        return (
            <div
                className="border-border/50 bg-secondary/40 inline-flex items-center gap-2 rounded-full border px-3 py-1.5"
                role="status"
            >
                <Loader2Icon className="text-muted-foreground size-3.5 animate-spin" />
                <span className="text-muted-foreground/70 text-[11px] font-semibold tracking-wider uppercase">
                    Saving
                </span>
            </div>
        );
    }
    if (status === 'saved') {
        return (
            <div
                className="border-success/30 bg-success/10 inline-flex items-center gap-2 rounded-full border px-3 py-1.5"
                role="status"
            >
                <CheckIcon className="text-success-inline size-3.5" />
                <span className="text-success-inline text-[11px] font-semibold tracking-wider uppercase">Saved</span>
            </div>
        );
    }
    return (
        <div
            className="border-destructive/40 bg-destructive/10 inline-flex items-center gap-2 rounded-full border px-3 py-1.5"
            role="status"
        >
            <span className="text-destructive-inline text-[11px] font-semibold tracking-wider uppercase">
                Save failed
            </span>
        </div>
    );
}

function Banner({ variant, children }: { variant: 'error' | 'warning'; children: React.ReactNode }) {
    return (
        <div
            className={cn(
                'mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm',
                variant === 'error'
                    ? 'border-destructive/40 bg-destructive/10 text-destructive-inline'
                    : 'border-warning/40 bg-warning/10 text-warning-inline',
            )}
            role="alert"
        >
            <AlertTriangleIcon className="size-4 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">{children}</div>
        </div>
    );
}
