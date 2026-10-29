const modulename = 'FxResources';
import consoleFactory from '@lib/console';
import { Stopwatch } from './FxMonitor/utils';
import type { ResourceStatusEvent } from '@shared/resourcesApiTypes';
const console = consoleFactory(modulename);

type ResourceEventType = {
    type: 'txAdminResourceEvent';
    resource: string;
    event:
        | 'onResourceStarting'
        | 'onResourceStart'
        | 'onServerResourceStart'
        | 'onResourceListRefresh'
        | 'onResourceStop'
        | 'onServerResourceStop';
};

type ResourceReportType = {
    ts: Date;
    resources: any[];
};

type ResPendingStartState = {
    name: string;
    time: Stopwatch;
};

type ResBootLogEntry = {
    tsBooted: number;
    resource: string;
    duration: number;
};

//Update notice detection constants
const regexConsoleColors = /\x1B[^m]*?m/g;
const regexScriptPrefix = /^\[\s*(?:script|c-scripting-core):([a-zA-Z0-9_.-]{1,64})\]\s*(.+)$/;
const regexUpdateNotice =
    /\b(?:(?:an? )?(?:new )?update (?:is )?(?:now )?available|new(?:er)? version (?:is )?(?:available|released|found|out)|outdated|out[ -]of[ -]date|please update|update (?:is )?required|needs? (?:an )?update)\b/i;
const UPDATE_NOTICE_MAX_LENGTH = 300;
const UPDATE_NOTICE_MAX_RESOURCES = 250;
const CONSOLE_LINE_BUFFER_MAX = 4096;

/**
 * Module responsible to track FXServer resource states.
 * Also tracks real-time resource status.
 */
export default class FxResources {
    public resourceReport?: ResourceReportType;
    private resBooting: ResPendingStartState | null = null;
    private resBootLog: ResBootLogEntry[] = [];

    // Real-time resource state tracking
    private resourceStates: Map<string, string> = new Map();
    private resourceUpdateNotices: Map<string, string> = new Map();
    private consoleLineBuffer = '';

    private hasResourceListeners() {
        return txCore.webServer?.webSocket?.hasRoomListeners('resources') ?? false;
    }

    /**
     * Reset boot state on server close
     */
    handleServerClose() {
        this.resBooting = null;
        this.resBootLog = [];
        this.resourceStates.clear();
        this.resourceUpdateNotices.clear();
        this.consoleLineBuffer = '';
    }

    /**
     * Handler for all txAdminResourceEvent FD3 events
     */
    handleServerEvents(payload: ResourceEventType, mutex: string) {
        const { resource, event } = payload;
        if (!resource || !event) {
            console.verbose.error(`Invalid txAdminResourceEvent payload: ${JSON.stringify(payload)}`);
        } else if (event === 'onResourceStarting') {
            //Resource will start
            this.resBooting = {
                name: resource,
                time: new Stopwatch(true),
            };
            this.resourceStates.set(resource, 'starting');
            this.pushStatusUpdate(resource, 'starting');
        } else if (event === 'onResourceStart') {
            //Resource started
            this.resBootLog.push({
                resource,
                duration: this.resBooting?.time.elapsed ?? 0,
                tsBooted: Date.now(),
            });
            this.resourceStates.set(resource, 'started');
            this.pushStatusUpdate(resource, 'started');
        } else if (event === 'onResourceStop' || event === 'onServerResourceStop') {
            this.resourceStates.set(resource, 'stopped');
            //Clear the notice so a restart of an updated resource doesn't show a stale warning
            this.resourceUpdateNotices.delete(resource);
            this.pushStatusUpdate(resource, 'stopped');
        }
    }

    /**
     * Scans FXServer console output for per-resource update notices.
     * FXServer prefixes resource prints with `[script:resname]`, so we can attribute
     * "update available" style messages to the resource that printed them.
     */
    handleConsoleOutput(data: string) {
        const text = this.consoleLineBuffer + data;
        const lines = text.split('\n');
        //Last element is either '' (data ended in \n) or a partial line to buffer
        this.consoleLineBuffer = (lines.pop() ?? '').slice(-CONSOLE_LINE_BUFFER_MAX);

        for (const rawLine of lines) {
            const line = rawLine.replace(regexConsoleColors, '').trim();
            const prefixMatch = line.match(regexScriptPrefix);
            if (!prefixMatch) continue;
            const [, resource, message] = prefixMatch;
            if (this.resourceUpdateNotices.has(resource)) continue;
            if (!regexUpdateNotice.test(message)) continue;
            if (this.resourceUpdateNotices.size >= UPDATE_NOTICE_MAX_RESOURCES) return;

            const notice = message.trim().slice(0, UPDATE_NOTICE_MAX_LENGTH);
            this.resourceUpdateNotices.set(resource, notice);
            console.verbose.log(`Update notice detected for resource '${resource}'.`);
            this.pushStatusUpdate(resource, this.resourceStates.get(resource) ?? 'started');
        }
    }

    /**
     * Returns the detected update notices map
     */
    getUpdateNotices(): ReadonlyMap<string, string> {
        return this.resourceUpdateNotices;
    }

    /**
     * Push a single resource status change via WebSocket
     */
    private pushStatusUpdate(name: string, status: string) {
        if (!this.hasResourceListeners()) return;
        txCore.webServer.webSocket.buffer('resources', {
            type: 'update',
            updates: [{ name, status, updateNotice: this.resourceUpdateNotices.get(name) }],
        });
    }

    /**
     * Returns the status of the resource boot process
     */
    public get bootStatus() {
        let elapsedSinceLast = null;
        if (this.resBootLog.length > 0) {
            const tsMs = this.resBootLog[this.resBootLog.length - 1].tsBooted;
            elapsedSinceLast = Math.floor((Date.now() - tsMs) / 1000);
        }
        return {
            current: this.resBooting,
            elapsedSinceLast,
        };
    }

    /**
     * Handle resource report.
     * Also syncs internal state map and pushes a full snapshot via WebSocket.
     */
    tmpUpdateResourceList(resources: any[]) {
        this.resourceReport = {
            ts: new Date(),
            resources,
        };
        const updates: ResourceStatusEvent[] = [];
        const shouldPush = this.hasResourceListeners();

        // Sync internal state and only push actual status changes. The HTTP caller
        // already receives the full grouped list, so echoing another full snapshot
        // over the websocket just duplicates large payloads.
        for (const res of resources) {
            if (res.name) {
                const status = res.status ?? 'stopped';
                const previousStatus = this.resourceStates.get(res.name);
                this.resourceStates.set(res.name, status);

                if (shouldPush && previousStatus !== undefined && previousStatus !== status) {
                    updates.push({
                        name: res.name,
                        status,
                        updateNotice: this.resourceUpdateNotices.get(res.name),
                    });
                }
            }
        }

        if (updates.length > 0) {
            txCore.webServer.webSocket.buffer('resources', {
                type: 'update',
                updates,
            });
        }
    }

    /**
     * Get current resource status snapshot for WebSocket initial data
     */
    getResourceStatusSnapshot(): ResourceStatusEvent[] {
        const result: ResourceStatusEvent[] = [];
        for (const [name, status] of this.resourceStates) {
            result.push({
                name,
                status,
                updateNotice: this.resourceUpdateNotices.get(name),
            });
        }
        return result;
    }
}

/*
NOTE Resource load scenarios knowledge base:
- resource lua error:
    - `onResourceStarting` sourceRes
    - print lua error
    - `onResourceStart` sourceRes
- resource lua crash/hang:
    - `onResourceStarting` sourceRes
    - crash/hang
- dependency missing:
    - `onResourceStarting` sourceRes
    - does not get to `onResourceStart`
- dependency success:
    - `onResourceStarting` sourceRes
    - `onResourceStarting` dependency
    - `onResourceStart` dependency
    - `onResourceStart` sourceRes
- webpack/yarn fail:
    - `onResourceStarting` sourceRes
    - does not get to `onResourceStart`
- webpack/yarn success:
    - `onResourceStarting` chat
    - `onResourceStarting` yarn
    - `onResourceStart` yarn
    - `onResourceStarting` webpack
    - `onResourceStart` webpack
    - server first tick
    - wait for build
    - `onResourceStarting` chat
    - `onResourceStart` chat
- ensure started resource:
    - `onResourceStop` sourceRes
    - `onResourceStarting` sourceRes
    - `onResourceStart` sourceRes
    - `onServerResourceStop` sourceRes
    - `onServerResourceStart` sourceRes
*/
