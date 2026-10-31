import { useEffect, useMemo, useState } from 'react';
import { AlertTriangleIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import InlineCode from '@/components/InlineCode';
import { permissionsByCategory, permissionsMap } from '@shared/permissions';
import {
    CustomCommand,
    CustomCommandAction,
    CustomCommandActionType,
    CustomCommandSchema,
    customCommandMenuActions,
    findCustomCommandConflicts,
    getMenuActionDef,
    isPrivilegedCustomCommand,
} from '@shared/customCommands';
import { actionTypeLabels, EVERYONE_PERM } from './customCommandsUtils';

type CommandEditorDialogProps = {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    /** The command being edited, or a pre-filled draft for a new one */
    initialData: CustomCommand | undefined;
    isNew: boolean;
    otherCommands: CustomCommand[];
    canWriteConsole: boolean;
    onSave: (cmd: CustomCommand) => void;
};

const defaultActionFor = (type: CustomCommandActionType): CustomCommandAction => {
    switch (type) {
        case 'menuAction':
            return { type, actionId: customCommandMenuActions[0].id };
        case 'chatMessage':
            return { type, message: '', broadcast: false };
        case 'consoleCommand':
            return { type, command: '' };
        case 'serverEvent':
        case 'clientEvent':
            return { type, eventName: '' };
    }
};

const menuActionGroups = customCommandMenuActions.reduce<Record<string, (typeof customCommandMenuActions)[number][]>>(
    (acc, action) => {
        (acc[action.group] ??= []).push(action);
        return acc;
    },
    {},
);

export default function CommandEditorDialog({
    isOpen,
    onOpenChange,
    initialData,
    isNew,
    otherCommands,
    canWriteConsole,
    onSave,
}: CommandEditorDialogProps) {
    const [draft, setDraft] = useState<CustomCommand | undefined>(initialData);
    const [aliasesText, setAliasesText] = useState('');
    const [error, setError] = useState<string | null>(null);

    //Reset the form whenever a new command is opened
    useEffect(() => {
        if (!isOpen) return;
        setDraft(initialData);
        setAliasesText(initialData?.aliases.join(', ') ?? '');
        setError(null);
    }, [isOpen, initialData]);

    const menuActionDef = draft?.action.type === 'menuAction' ? getMenuActionDef(draft.action.actionId) : undefined;
    const permissionMismatch =
        menuActionDef && menuActionDef.permission && draft && draft.permission !== menuActionDef.permission;
    const isLockedPrivileged = !!draft && !canWriteConsole && isPrivilegedCustomCommand(draft);

    const usage = useMemo(() => {
        if (!draft) return '';
        const args = menuActionDef?.args.map((a) => (a.optional ? `[${a.name}]` : `<${a.name}>`)).join(' ');
        return `/${draft.name || 'command'}${args ? ` ${args}` : ''}`;
    }, [draft, menuActionDef]);

    if (!draft) return null;

    const update = (changes: Partial<CustomCommand>) => setDraft({ ...draft, ...changes });
    const updateAction = (changes: Partial<CustomCommandAction>) =>
        setDraft({ ...draft, action: { ...draft.action, ...changes } as CustomCommandAction });

    const handleTypeChange = (type: CustomCommandActionType) => {
        update({ action: defaultActionFor(type) });
    };

    const handleMenuActionChange = (actionId: string) => {
        const def = getMenuActionDef(actionId);
        if (!def) return;
        //Keep the permission in sync with the action unless the user already customized it
        const prevDef = menuActionDef;
        const permWasDefault = !prevDef || draft.permission === prevDef.permission;
        update({
            action: { type: 'menuAction', actionId: def.id } as CustomCommandAction,
            permission: permWasDefault ? def.permission : draft.permission,
            description:
                !draft.description || draft.description === prevDef?.description ? def.description : draft.description,
        });
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const candidate = {
            ...draft,
            aliases: aliasesText
                .split(/[\s,]+/)
                .map((a) => a.replace(/^\//, '').trim().toLowerCase())
                .filter(Boolean),
            name: draft.name.replace(/^\//, ''),
        };
        const parsed = CustomCommandSchema.safeParse(candidate);
        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            const field = issue.path.join('.');
            setError(field ? `${field}: ${issue.message}` : issue.message);
            return;
        }
        const conflicts = findCustomCommandConflicts([...otherCommands, parsed.data]);
        if (conflicts.length) {
            setError(conflicts[0]);
            return;
        }
        if (!canWriteConsole && isPrivilegedCustomCommand(parsed.data)) {
            setError('You need the "Console: Write" permission to save console command or server event commands.');
            return;
        }
        onSave(parsed.data);
    };

    const permSelectValue = draft.permission === '' ? EVERYONE_PERM : draft.permission;

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
                <form onSubmit={handleSubmit} className="space-y-4">
                    <DialogHeader>
                        <DialogTitle>{isNew ? 'New chat command' : `Edit /${initialData?.name}`}</DialogTitle>
                        <DialogDescription>
                            Changes apply in-game as soon as you save — no restart needed.
                        </DialogDescription>
                    </DialogHeader>

                    {isLockedPrivileged && (
                        <div className="border-warning/40 bg-warning/10 text-warning-inline flex gap-2 rounded-lg border p-3 text-xs">
                            <AlertTriangleIcon className="size-4 shrink-0" />
                            This command runs console commands or server events, so editing it requires the "Console:
                            Write" permission.
                        </div>
                    )}

                    {/* Name & aliases */}
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="cmd-name">Command</Label>
                            <div className="relative">
                                <span className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2 text-sm">
                                    /
                                </span>
                                <Input
                                    id="cmd-name"
                                    className="pl-6 font-mono"
                                    placeholder="heal"
                                    value={draft.name}
                                    maxLength={32}
                                    autoFocus
                                    onChange={(e) => update({ name: e.target.value.toLowerCase().replace(/\s/g, '') })}
                                />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="cmd-aliases">Aliases</Label>
                            <Input
                                id="cmd-aliases"
                                className="font-mono"
                                placeholder="h, healme"
                                value={aliasesText}
                                onChange={(e) => setAliasesText(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="cmd-desc">Description</Label>
                        <Input
                            id="cmd-desc"
                            placeholder="Shown in the chat suggestions"
                            value={draft.description}
                            maxLength={128}
                            onChange={(e) => update({ description: e.target.value })}
                        />
                    </div>

                    {/* Action */}
                    <div className="border-border/60 bg-secondary/20 space-y-3 rounded-lg border p-3">
                        <div className="space-y-1.5">
                            <Label>What it does</Label>
                            <Select
                                value={draft.action.type}
                                onValueChange={(v) => handleTypeChange(v as CustomCommandActionType)}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.entries(actionTypeLabels).map(([type, { label, hint }]) => (
                                        <SelectItem key={type} value={type}>
                                            {label} <span className="text-muted-foreground text-xs">— {hint}</span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {draft.action.type === 'menuAction' && (
                            <div className="space-y-1.5">
                                <Label>Menu action</Label>
                                <Select value={draft.action.actionId} onValueChange={handleMenuActionChange}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {Object.entries(menuActionGroups).map(([group, actions]) => (
                                            <SelectGroup key={group}>
                                                <SelectLabel>{group}</SelectLabel>
                                                {actions.map((a) => (
                                                    <SelectItem key={a.id} value={a.id}>
                                                        {a.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectGroup>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {menuActionDef && (
                                    <p className="text-muted-foreground text-xs">{menuActionDef.description}</p>
                                )}
                            </div>
                        )}

                        {draft.action.type === 'chatMessage' && (
                            <>
                                <div className="space-y-1.5">
                                    <Label htmlFor="cmd-message">Message</Label>
                                    <Textarea
                                        id="cmd-message"
                                        rows={3}
                                        placeholder="^5Join our Discord: ^7discord.gg/yourserver"
                                        value={draft.action.message}
                                        maxLength={1000}
                                        onChange={(e) => updateAction({ message: e.target.value })}
                                    />
                                </div>
                                <label className="flex items-center gap-2 text-sm">
                                    <Switch
                                        checked={draft.action.broadcast}
                                        onCheckedChange={(broadcast) => updateAction({ broadcast })}
                                    />
                                    Send to everyone (otherwise only the player who used it sees it)
                                </label>
                            </>
                        )}

                        {draft.action.type === 'consoleCommand' && (
                            <div className="space-y-1.5">
                                <Label htmlFor="cmd-console">Console command</Label>
                                <Input
                                    id="cmd-console"
                                    className="font-mono"
                                    placeholder="ensure {1}"
                                    value={draft.action.command}
                                    maxLength={500}
                                    disabled={!canWriteConsole}
                                    onChange={(e) => updateAction({ command: e.target.value })}
                                />
                                <p className="text-muted-foreground text-xs">
                                    Runs in the server console. Semicolons and line breaks are stripped from player
                                    arguments.
                                </p>
                            </div>
                        )}

                        {(draft.action.type === 'serverEvent' || draft.action.type === 'clientEvent') && (
                            <div className="space-y-1.5">
                                <Label htmlFor="cmd-event">Event name</Label>
                                <Input
                                    id="cmd-event"
                                    className="font-mono"
                                    placeholder="myresource:doSomething"
                                    value={draft.action.eventName}
                                    maxLength={96}
                                    disabled={draft.action.type === 'serverEvent' && !canWriteConsole}
                                    onChange={(e) => updateAction({ eventName: e.target.value.trim() })}
                                />
                                <p className="text-muted-foreground text-xs">
                                    {draft.action.type === 'serverEvent' ? (
                                        <>
                                            Triggered on the server as{' '}
                                            <InlineCode>TriggerEvent(name, source, args)</InlineCode>.
                                        </>
                                    ) : (
                                        <>
                                            Triggered on the player's client as{' '}
                                            <InlineCode>TriggerClientEvent(name, source, args)</InlineCode>.
                                        </>
                                    )}
                                </p>
                            </div>
                        )}

                        {(draft.action.type === 'chatMessage' || draft.action.type === 'consoleCommand') && (
                            <p className="text-muted-foreground text-xs">
                                Placeholders: <InlineCode>{'{source}'}</InlineCode> player ID,{' '}
                                <InlineCode>{'{name}'}</InlineCode> player name, <InlineCode>{'{args}'}</InlineCode> all
                                arguments, <InlineCode>{'{1}'}</InlineCode>…<InlineCode>{'{9}'}</InlineCode> individual
                                arguments.
                            </p>
                        )}
                    </div>

                    {/* Access */}
                    <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
                        <div className="space-y-1.5">
                            <Label>Who can use it</Label>
                            <Select
                                value={permSelectValue}
                                onValueChange={(v) => update({ permission: v === EVERYONE_PERM ? '' : v })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={EVERYONE_PERM}>Everyone (all players)</SelectItem>
                                    {permissionsByCategory.map((cat) => (
                                        <SelectGroup key={cat.id}>
                                            <SelectLabel>{cat.label}</SelectLabel>
                                            {cat.permissions.map((perm) => (
                                                <SelectItem key={perm.id} value={perm.id}>
                                                    Admins with: {perm.label}
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="cmd-cooldown">Cooldown (s)</Label>
                            <Input
                                id="cmd-cooldown"
                                type="number"
                                min={0}
                                max={3600}
                                value={draft.cooldownSeconds}
                                onChange={(e) =>
                                    update({ cooldownSeconds: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
                                }
                            />
                        </div>
                    </div>

                    {permissionMismatch && (
                        <div className="border-warning/40 bg-warning/10 text-warning-inline flex gap-2 rounded-lg border p-3 text-xs">
                            <AlertTriangleIcon className="size-4 shrink-0" />
                            <span>
                                This menu action also checks for{' '}
                                <strong>{permissionsMap.get(menuActionDef.permission)?.label}</strong>. Players without
                                it will be able to type the command, but the action will be denied.
                            </span>
                        </div>
                    )}

                    <div className="flex items-center justify-between gap-2">
                        <p className="text-muted-foreground min-w-0 truncate text-xs">
                            Usage: <InlineCode>{usage}</InlineCode>
                        </p>
                        <label className="flex shrink-0 items-center gap-2 text-sm">
                            <Switch checked={draft.enabled} onCheckedChange={(enabled) => update({ enabled })} />
                            Enabled
                        </label>
                    </div>

                    {error && (
                        <p className="text-destructive-inline text-sm" role="alert">
                            {error}
                        </p>
                    )}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isLockedPrivileged}>
                            {isNew ? 'Create command' : 'Save changes'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
