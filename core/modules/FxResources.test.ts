import { beforeEach, describe, expect, it, vi } from 'vitest';
import FxResources from './FxResources';

describe('FxResources websocket updates', () => {
    let buffer: ReturnType<typeof vi.fn>;
    let hasRoomListeners: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        buffer = vi.fn();
        hasRoomListeners = vi.fn(() => false);
        vi.stubGlobal('txCore', {
            webServer: {
                webSocket: {
                    buffer,
                    hasRoomListeners,
                },
            },
        });
    });

    it('stores full resource reports without echoing a full websocket snapshot', () => {
        const fxResources = new FxResources();

        fxResources.tmpUpdateResourceList([{ name: 'es_extended', status: 'started' }]);

        expect(buffer).not.toHaveBeenCalled();
        expect(fxResources.getResourceStatusSnapshot()).toEqual([{ name: 'es_extended', status: 'started' }]);
    });

    it('pushes report-derived status deltas only when the resources room has listeners', () => {
        const fxResources = new FxResources();

        hasRoomListeners.mockReturnValue(true);
        fxResources.tmpUpdateResourceList([{ name: 'es_extended', status: 'started' }]);
        expect(buffer).not.toHaveBeenCalled();

        fxResources.tmpUpdateResourceList([{ name: 'es_extended', status: 'stopped' }]);
        expect(buffer).toHaveBeenCalledWith('resources', {
            type: 'update',
            updates: [{ name: 'es_extended', status: 'stopped', perf: undefined }],
        });
    });

    it('skips repeated perf websocket updates when nobody is subscribed or values did not change', () => {
        const fxResources = new FxResources();
        const perfPayload = {
            type: 'txAdminResourcePerf',
            resources: [{ name: 'es_extended', cpu: 0, memory: 0, tickTime: 0 }],
        } as const;

        fxResources.handlePerfData(perfPayload);
        expect(buffer).not.toHaveBeenCalled();

        hasRoomListeners.mockReturnValue(true);
        fxResources.handlePerfData(perfPayload);
        expect(buffer).not.toHaveBeenCalled();

        fxResources.handlePerfData({
            type: 'txAdminResourcePerf',
            resources: [{ name: 'es_extended', cpu: 1.234, memory: 128.4, tickTime: 2.345 }],
        });

        expect(buffer).toHaveBeenCalledWith('resources', {
            type: 'update',
            updates: [
                {
                    name: 'es_extended',
                    status: 'started',
                    perf: { cpu: 1.23, memory: 128, tickTime: 2.35 },
                },
            ],
        });
    });
});

describe('FxResources console update notices', () => {
    let buffer: ReturnType<typeof vi.fn>;
    let hasRoomListeners: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        buffer = vi.fn();
        hasRoomListeners = vi.fn(() => true);
        vi.stubGlobal('txCore', {
            webServer: {
                webSocket: {
                    buffer,
                    hasRoomListeners,
                },
            },
        });
    });

    it('detects update messages printed by a resource and pushes a ws update', () => {
        const fxResources = new FxResources();
        fxResources.tmpUpdateResourceList([{ name: 'ox_lib', status: 'started' }]);

        fxResources.handleConsoleOutput('[    script:ox_lib] An update is available for ox_lib (current: 3.0.0)\n');

        expect(fxResources.getUpdateNotices().get('ox_lib')).toBe('An update is available for ox_lib (current: 3.0.0)');
        expect(buffer).toHaveBeenCalledWith('resources', {
            type: 'update',
            updates: [
                {
                    name: 'ox_lib',
                    status: 'started',
                    perf: undefined,
                    updateNotice: 'An update is available for ox_lib (current: 3.0.0)',
                },
            ],
        });
    });

    it('handles color codes, partial chunks, and ignores unrelated lines', () => {
        const fxResources = new FxResources();

        fxResources.handleConsoleOutput('[    script:esx_core] \x1B[31mYou are running an out');
        expect(fxResources.getUpdateNotices().size).toBe(0);

        fxResources.handleConsoleOutput('dated version, please update!\x1B[0m\n[script:chat] hello world\n');
        expect(fxResources.getUpdateNotices().get('esx_core')).toBe(
            'You are running an outdated version, please update!',
        );
        expect(fxResources.getUpdateNotices().has('chat')).toBe(false);
    });

    it('keeps only the first notice per resource and clears it when the resource stops', () => {
        const fxResources = new FxResources();

        fxResources.handleConsoleOutput('[script:ox_lib] update available: v1\n');
        fxResources.handleConsoleOutput('[script:ox_lib] update available: v2\n');
        expect(fxResources.getUpdateNotices().get('ox_lib')).toBe('update available: v1');

        fxResources.handleServerEvents(
            { type: 'txAdminResourceEvent', event: 'onResourceStop', resource: 'ox_lib' },
            'mutex',
        );
        expect(fxResources.getUpdateNotices().has('ox_lib')).toBe(false);
    });
});
