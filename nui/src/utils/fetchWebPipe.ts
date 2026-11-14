import { isBrowserEnv } from '@nui/src/utils/miscUtils';
import { NUI_WEBPIPE_URL } from '@nui/src/utils/nuiGen';

const WEBPIPE_PATH = NUI_WEBPIPE_URL;

type ValidPath = `/${string}`;

export enum PipeTimeout {
    SHORT = 1500,
    MEDIUM = 5000,
    LONG = 9000,
}

interface fetchWebPipeOpts<T> {
    method?: 'GET' | 'POST';
    timeout?: PipeTimeout;
    data?: unknown;
    mockData?: T;
    queryParams?: Record<string, string | number | boolean>;
}

const buildWebPipeUrl = (path: ValidPath, queryParams?: Record<string, string | number | boolean>): string => {
    const base = WEBPIPE_PATH + path;
    if (!queryParams || Object.keys(queryParams).length === 0) return base;
    const qs = new URLSearchParams(Object.entries(queryParams).map(([key, value]) => [key, String(value)])).toString();
    return `${base}?${qs}`;
};
/**
 * A wrapper around fetch for HTTP reqs to the txAdminPipe
 * @param path The path to send the req to
 * @param options Additional options to control the fetch event's behavior
 **/
export const fetchWebPipe = async <T = any>(path: ValidPath, options?: fetchWebPipeOpts<T>): Promise<T> => {
    const reqPath = buildWebPipeUrl(path, options?.queryParams);
    const timeout = options?.timeout || PipeTimeout.MEDIUM;

    const abortionController = new AbortController();

    const fetchOpts: RequestInit = {
        headers: {
            'Content-Type': 'application/json; charset=UTF-8',
        },
        method: options?.method,
        body: JSON.stringify(options?.data),
        signal: abortionController.signal,
    };
    // Bail out of request if possible when browser
    if (isBrowserEnv() && options?.mockData) {
        return options.mockData as unknown as T;
    }

    // Timeout logic for fetch request
    const timeoutId = setTimeout(() => abortionController.abort(), timeout);
    const resp = await fetch(reqPath, fetchOpts);
    clearTimeout(timeoutId);

    if (resp.status === 404) {
        return false as unknown as T;
    }

    return await resp.json();
};
