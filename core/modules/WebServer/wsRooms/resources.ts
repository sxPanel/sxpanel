import type { RoomType } from '@modules/WebServer/webSocket';
import type { ResourcesWsEventType } from '@shared/resourcesApiTypes';

/**
 * The resources room provides real-time resource status updates.
 * Joined when viewing the resources page.
 * Pushes status changes via WebSocket instead of polling.
 */
export default {
    permission: 'commands.resources',
    eventName: 'resources',
    cumulativeBuffer: false,
    outBuffer: null,
    initialData: (): ResourcesWsEventType => {
        return {
            type: 'full',
            resources: txCore.fxResources.getResourceStatusSnapshot(),
        };
    },
} satisfies RoomType;
