import { debugLog } from './debugLog';
import { isBrowserEnv } from '@nui/src/utils/miscUtils';
import { NUI_CALLBACK_URL } from '@nui/src/utils/nuiGen';
import { debugData } from './debugData';
import { browserNuiReplies } from './browserNuiReplies';

type OptsWithMockData<T> = Partial<RequestInit & { mockResp: T }>;

/**
 * Simple wrapper around fetch API tailored for CEF/NUI use.
 * @param eventName - The endpoint eventname to target
 * @param data - Data you wish to send in the NUI Callback
 * @param opts - Request init opts to pass to fetch API
 * @return returnData - A promise for the data sent back by the NuiCallbacks CB argument
 */
export async function fetchNui<T = any>(eventName: string, data: unknown = {}, opts?: OptsWithMockData<T>): Promise<T> {
    const options = {
        ...opts,
        method: 'post',
        headers: {
            'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify(data),
    };

    // debugLog(eventName, data, "PostToScripts");

    // If we are in browser and mockResp option is defined, we can
    // bail out of having to make failing HTTP reqs, speeding up data dispatching.
    if (isBrowserEnv() && opts?.mockResp) return opts.mockResp;

    // Callbacks that Lua answers with a separate NUI message get a mock reply message instead.
    const browserReply = isBrowserEnv() ? browserNuiReplies[eventName] : undefined;
    if (browserReply) {
        debugData(browserReply(data), 250);
        return {} as T;
    }

    try {
        const resp = await fetch(`${NUI_CALLBACK_URL}/${eventName}`, options);
        return await resp.json();
    } catch (error) {
        if (error instanceof Error && error.name === 'SyntaxError') {
            throw new Error(
                `JSON error. Maybe the NUI Callback \'${eventName}\' is not registered. This can be caused if the file that registers it has a lua syntax error.`,
            );
        } else {
            throw error;
        }
    }
}
