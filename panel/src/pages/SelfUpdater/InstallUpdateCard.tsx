import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { CalendarClockIcon, CheckCircle2Icon, HandIcon, RotateCcwIcon, XIcon, ZapIcon } from 'lucide-react';
import type { PanelUpdateApplyReq, PanelUpdateListResp } from '@shared/otherTypes';

type ApplyMode = PanelUpdateApplyReq['mode'];
type SchedulePreset = '5' | '15' | '30' | '60' | '120' | 'custom';

const SCHEDULE_PRESETS: { value: SchedulePreset; label: string }[] = [
    { value: '5', label: 'In 5 minutes' },
    { value: '15', label: 'In 15 minutes' },
    { value: '30', label: 'In 30 minutes' },
    { value: '60', label: 'In 1 hour' },
    { value: '120', label: 'In 2 hours' },
    { value: 'custom', label: 'At a specific time…' },
];

/**
 * Minutes from now until the next occurrence of a HH:MM time (today, or tomorrow if it already passed).
 */
const minutesUntilTime = (hhmm: string) => {
    const [hours, minutes] = hhmm.split(':').map((x) => parseInt(x, 10));
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    const now = new Date();
    const target = new Date();
    target.setHours(hours, minutes, 0, 0);
    if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
    return Math.max(1, Math.round((target.getTime() - now.getTime()) / 60_000));
};

const formatClock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const formatRelative = (msLeft: number) => {
    if (msLeft <= 0) return 'any moment now';
    const mins = Math.ceil(msLeft / 60_000);
    if (mins < 60) return `in ${mins} minute${mins === 1 ? '' : 's'}`;
    const hours = Math.floor(mins / 60);
    const rem = mins % 60;
    return `in ${hours}h${rem ? ` ${rem}m` : ''}`;
};

const useNow = (intervalMs: number) => {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(interval);
    }, [intervalMs]);
    return now;
};

function ModeOption({
    value,
    selected,
    icon,
    title,
    description,
}: {
    value: ApplyMode;
    selected: boolean;
    icon: React.ReactNode;
    title: string;
    description: string;
}) {
    return (
        <Label
            htmlFor={`update-mode-${value}`}
            className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                selected ? 'border-primary bg-primary/5' : 'border-border/60 hover:bg-secondary/30',
            )}
        >
            <RadioGroupItem value={value} id={`update-mode-${value}`} className="mt-0.5" />
            <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                    {icon}
                    {title}
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed font-normal">{description}</p>
            </div>
        </Label>
    );
}

/**
 * Shown once an update is downloaded: what's pending (if anything), or the three install options.
 */
export default function InstallUpdateCard({
    data,
    onApply,
    onCancelPlan,
}: {
    data: PanelUpdateListResp;
    onApply: (req: PanelUpdateApplyReq) => void;
    onCancelPlan: () => void;
}) {
    const { stagedVersion, restartPlan, isWindows } = data;
    const versionLabel = stagedVersion ? `v${stagedVersion}` : 'The update';
    const [mode, setMode] = useState<ApplyMode>('now');
    const [preset, setPreset] = useState<SchedulePreset>('15');
    const [customTime, setCustomTime] = useState('');
    const now = useNow(15_000);

    //MARK: Pending plan
    if (restartPlan?.mode === 'scheduled') {
        return (
            <Card className="border-warning/40 bg-background rounded-xl shadow-none">
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-lg">
                        <CalendarClockIcon className="text-warning size-5" />
                        Restart scheduled
                    </CardTitle>
                    <CardDescription>
                        FXServer will restart at <strong>{formatClock(restartPlan.scheduledTs)}</strong> (
                        {formatRelative(restartPlan.scheduledTs - now)}) and install {versionLabel}.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 pt-0">
                    <p className="text-muted-foreground text-sm">
                        Players get in-game and Discord warnings 30, 15, 10 and 5 minutes before, then every minute. The
                        panel will be offline for a moment while FXServer comes back up.
                    </p>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="warning" onClick={() => onApply({ mode: 'now' })}>
                            <ZapIcon className="mr-2 size-4" />
                            Restart now instead
                        </Button>
                        <Button variant="outline" onClick={onCancelPlan}>
                            <XIcon className="mr-2 size-4" />
                            Cancel schedule
                        </Button>
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (restartPlan?.mode === 'manual') {
        return (
            <Card className="border-info/40 bg-background rounded-xl shadow-none">
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-lg">
                        <HandIcon className="text-info size-5" />
                        Ready to install on your next restart
                    </CardTitle>
                    <CardDescription>{versionLabel} will be installed as soon as FXServer is closed.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 pt-0">
                    <ol className="text-muted-foreground list-decimal space-y-1.5 pl-5 text-sm">
                        <li>
                            Close FXServer completely (close its console window or stop the service). Restarting only
                            the game server from the panel is not enough.
                        </li>
                        <li>
                            {isWindows
                                ? 'Wait a few seconds for the minimized "sxPanel Update" window to finish.'
                                : 'Wait a few seconds for the update to finish (progress goes to sxpanel_update.log next to the monitor folder).'}
                        </li>
                        <li>Start FXServer again the way you normally do.</li>
                    </ol>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="warning" onClick={() => onApply({ mode: 'now' })}>
                            <ZapIcon className="mr-2 size-4" />
                            Restart now instead
                        </Button>
                        <Button variant="outline" onClick={onCancelPlan}>
                            <XIcon className="mr-2 size-4" />
                            Cancel
                        </Button>
                    </div>
                </CardContent>
            </Card>
        );
    }

    //MARK: Pick an option
    const customMinutes = preset === 'custom' && customTime ? minutesUntilTime(customTime) : null;
    const delayMinutes = preset === 'custom' ? customMinutes : parseInt(preset, 10);
    const scheduleInvalid = mode === 'scheduled' && !delayMinutes;

    const submit = () => {
        if (mode === 'scheduled') {
            if (!delayMinutes) return;
            onApply({ mode, delayMinutes });
        } else {
            onApply({ mode });
        }
    };

    const submitLabel =
        mode === 'now'
            ? 'Install & restart now'
            : mode === 'scheduled'
              ? 'Schedule restart'
              : 'Install on next restart';

    return (
        <Card className="border-success/40 bg-background rounded-xl shadow-none">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                    <CheckCircle2Icon className="text-success size-5" />
                    {versionLabel} is ready to install
                </CardTitle>
                <CardDescription>
                    Downloaded and verified. The new files go straight into your monitor folder, so there is nothing to
                    copy by hand. FXServer needs to restart for the update to take effect.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
                <RadioGroup value={mode} onValueChange={(v) => setMode(v as ApplyMode)} className="gap-2">
                    <ModeOption
                        value="now"
                        selected={mode === 'now'}
                        icon={<ZapIcon className="size-4" />}
                        title="Restart now"
                        description="Stops the game server, installs the update and starts FXServer again automatically. Takes about a minute."
                    />
                    <ModeOption
                        value="scheduled"
                        selected={mode === 'scheduled'}
                        icon={<CalendarClockIcon className="size-4" />}
                        title="Schedule a restart"
                        description="Picks a time for the automatic restart. Players get countdown warnings in-game and on Discord."
                    />
                    <ModeOption
                        value="manual"
                        selected={mode === 'manual'}
                        icon={<HandIcon className="size-4" />}
                        title="I'll restart it myself"
                        description="Installs the update the next time you close FXServer. Nothing happens until then."
                    />
                </RadioGroup>

                {mode === 'scheduled' && (
                    <div className="border-border/60 bg-secondary/20 flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-end">
                        <div className="space-y-1.5">
                            <Label className="text-xs">When</Label>
                            <Select value={preset} onValueChange={(v) => setPreset(v as SchedulePreset)}>
                                <SelectTrigger className="w-52" aria-label="When to restart">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {SCHEDULE_PRESETS.map((p) => (
                                        <SelectItem key={p.value} value={p.value}>
                                            {p.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        {preset === 'custom' && (
                            <div className="space-y-1.5">
                                <Label htmlFor="update-custom-time" className="text-xs">
                                    Time (your local time)
                                </Label>
                                <Input
                                    id="update-custom-time"
                                    type="time"
                                    value={customTime}
                                    onChange={(e) => setCustomTime(e.target.value)}
                                    className="w-36"
                                />
                            </div>
                        )}
                        {delayMinutes ? (
                            <p className="text-muted-foreground pb-2 text-xs">
                                Restarts at {formatClock(now + delayMinutes * 60_000)} (
                                {formatRelative(delayMinutes * 60_000)}).
                            </p>
                        ) : null}
                    </div>
                )}

                <Button
                    variant={mode === 'now' ? 'warning' : 'default'}
                    className="w-full sm:w-auto"
                    disabled={scheduleInvalid}
                    onClick={submit}
                >
                    <RotateCcwIcon className="mr-2 size-4" />
                    {submitLabel}
                </Button>
            </CardContent>
        </Card>
    );
}
