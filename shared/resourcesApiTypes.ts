export type ResourceItemData = {
    name: string;
    status: string;
    path: string;
    version: string;
    author: string;
    description: string;
    updateNotice?: string; // console message indicating an update is available
};

export type ResourceGroup = {
    subPath: string;
    resources: ResourceItemData[];
};

export type ResourcesListResp =
    | {
          groups: ResourceGroup[];
          totalResources: number;
          startedCount: number;
          stoppedCount: number;
      }
    | { error: string };

// WebSocket event for real-time resource status updates
export type ResourceStatusEvent = {
    name: string;
    status: string;
    updateNotice?: string;
};

export type ResourcesWsEventType = {
    type: 'full' | 'update';
    resources?: ResourceStatusEvent[];
    updates?: ResourceStatusEvent[];
};
