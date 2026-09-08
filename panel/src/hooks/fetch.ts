import { txToast } from '@/components/TxToaster';
import { validToastTypes } from '@/components/toastTypes';
import { useCsrfToken, useExpireAuthData } from '@/hooks/auth';
import { useOpenAccountModal } from '@/hooks/dialogs';
import { useLocale } from '@/hooks/locale';
import { translateApiError } from '@/lib/translateApiError';
import { ApiTimeout } from '@/lib/fetchWithTimeout';
import type { ApiAccessDeniedResp, GenericApiErrorResp } from '@shared/genericApiTypes';
import { useCallback, useEffect, useRef } from 'react';
const WEBPIPE_PATH = 'https://monitor/WebPipe';
const headeruserAgent = `txAdminPanel/v${window.txConsts.txaVersion} (atop FXServer/b${window.txConsts.fxsVersion})`;
const defaultHeaders = {
    'Content-Type': 'application/json; charset=UTF-8',
    Accept: 'application/json',
};

const replacePathParam = (path: string, key: string, value: string | number) => {
    const segment = `/:${key}`;
    const segmentIndex = path.indexOf(segment);
    if (segmentIndex === -1) return path;

    const suffix = path.slice(segmentIndex + segment.length);
    if (suffix.length > 0 && !suffix.startsWith('/')) return path;

    return `${path.slice(0, segmentIndex)}/${value}${suffix}`;
};

export { ApiTimeout, fetchWithTimeout } from '@/lib/fetchWithTimeout';

export class BackendApiError extends Error {
    title: string;
    message: string;

    constructor(title: string, message: string) {
        super();
        this.title = title;
        this.message = message;
    }
}

/**
 * Returns a function to make authenticated fetch requests
 */
type FetcherOpts = {
    method?: 'GET' | 'POST' | 'DELETE';
    headers?: HeadersInit;
    body?: any;
};

export const useAuthedFetcher = () => {
    const csrfToken = useCsrfToken();
    const expireSess = useExpireAuthData();
    const openAccountModal = useOpenAccountModal();

    return useCallback(
        async <Resp = any>(fetchUrl: string, fetchOpts: FetcherOpts = {}, abortController?: AbortController) => {
            if (!csrfToken) throw new Error('CSRF token not set');
            //Enforce single slash at the start of the path to prevent CSRF token leak
            if (fetchUrl[0] !== '/' || fetchUrl[1] === '/') {
                throw new Error(`[useAuthedFetcher] fetchUrl MUST start with a single '/', got '${fetchUrl}'.`);
            }
            if (!window.txConsts.isWebInterface) {
                fetchUrl = WEBPIPE_PATH + fetchUrl;
            }

            fetchOpts.method ??= 'GET';
            const resp = await fetch(fetchUrl, {
                method: fetchOpts.method,
                credentials: 'include',
                headers: {
                    ...defaultHeaders,
                    'User-Agent': headeruserAgent,
                    'X-TxAdmin-CsrfToken': csrfToken,
                },
                body: fetchOpts.body ? JSON.stringify(fetchOpts.body) : undefined,
                signal: abortController?.signal,
            });
            const data = await resp.json();
            if (data?.logout) {
                expireSess('useAuthedFetcher', data?.reason ?? 'unknown');
                throw new Error('Session expired');
            }
            if (data?.accessDenied) {
                const denied = data as ApiAccessDeniedResp;
                const tab = denied.reason === 'two_factor_required' ? 'security' : 'password';
                openAccountModal(tab);
                // Temp-password / 2FA gates already show the account modal (MainShell + tab copy).
                // Skip per-request toasts or every parallel mount call stacks the same warning.
                const isAccountSetupGate =
                    denied.reason === 'temp_password_change_required' || denied.reason === 'two_factor_required';
                if (!isAccountSetupGate) {
                    txToast.warning(denied.error);
                }
                throw new Error(denied.error);
            }
            return data as Resp;
        },
        [csrfToken, expireSess, openAccountModal],
    );
};

/**
 * Hook that provides a function to call the txAdmin API
 * This provides auto handlers for GenericApiOkResp and ApiToastResp
 */
type HookOpts = {
    //I'm pretty sure the webpipe supports only GET and POST
    method: 'GET' | 'POST' | 'DELETE';
    path: string;
    abortOnUnmount?: boolean;
    throwGenericErrors?: boolean;
};

type ApiCallOpts<RespType, ReqType> = {
    pathParams?: {
        [key: string]: string;
    };
    queryParams?: {
        [key: string]: string | number | boolean | undefined;
    };
    timeout?: ApiTimeout;
    data?: ReqType;
    toastId?: string;
    toastLoadingMessage?: string;
    genericHandler?: {
        errorTitle?: string;
        successMsg: string;
    };
    success?: (data: RespType, toastId?: string) => void;
    error?: (message: string, toastId?: string) => void;
    finally?: () => void;
};

export const useBackendApi = <RespType = any, ReqType = NonNullable<Object>>(hookOpts: HookOpts) => {
    const { method, path, abortOnUnmount = false, throwGenericErrors = false } = hookOpts;
    const abortController = useRef<AbortController | undefined>(undefined);
    const currentToastId = useRef<string | undefined>(undefined);
    const authedFetcher = useAuthedFetcher();
    const { t } = useLocale();

    useEffect(() => {
        return () => {
            if (!abortOnUnmount) return;
            abortController.current?.abort('unmount');
            if (currentToastId.current) {
                txToast.dismiss(currentToastId.current);
            }
        };
    }, [abortOnUnmount]);

    return useCallback(
        async (opts: ApiCallOpts<RespType, ReqType>) => {
            //The abort controller is not aborted, just forgotten
            abortController.current = new AbortController();

            //Processing URL
            let fetchUrl = path;
            if (opts.pathParams) {
                for (const [key, val] of Object.entries(opts.pathParams)) {
                    const replaced = replacePathParam(fetchUrl, key, val);
                    if (replaced === fetchUrl) {
                        throw new Error(`[useBackendApi] pathParam '${key}' not found in path '${path}'`);
                    }
                    fetchUrl = replaced;
                }
            }
            if (opts.queryParams) {
                const params = new URLSearchParams();
                for (const [key, val] of Object.entries(opts.queryParams)) {
                    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
                        params.append(key, val.toString());
                    }
                }
                fetchUrl += `?${params.toString()}`;
            }
            const apiCallDesc = `${method} ${path}`;

            //Error handler
            const handleError = (title: string, msg: string) => {
                if (currentToastId.current) {
                    txToast.error({ title, msg }, { id: currentToastId.current });
                }
                if (opts.error) {
                    try {
                        opts.error(msg, currentToastId.current);
                    } catch (error) {
                        console.log('[ERROR CB ERROR]', apiCallDesc, error);
                    }
                } else {
                    throw new BackendApiError(title, msg);
                }
            };

            //Setting up new toast or clear any previous lingering toast
            if (opts.toastId && opts.toastLoadingMessage) {
                throw new Error(`[useBackendApi] toastId and toastLoadingMessage are mutually exclusive.`);
            } else if (opts.toastLoadingMessage) {
                currentToastId.current = txToast.loading(opts.toastLoadingMessage);
            } else if (opts.toastId) {
                currentToastId.current = opts.toastId;
            } else if (currentToastId.current) {
                txToast.dismiss(currentToastId.current);
                currentToastId.current = undefined;
            }

            //Starting request timeout
            const timeoutId = setTimeout(() => {
                if (abortController.current?.signal.aborted) return;
                console.log('[TIMEOUT]', apiCallDesc);
                abortController.current?.abort('timeout');
                handleError('Request Timeout', 'If you closed sxPanel, please restart it and try again.');
            }, opts.timeout ?? ApiTimeout.DEFAULT);

            try {
                //Make request
                console.log('[>>]', apiCallDesc);
                const data = await authedFetcher(
                    fetchUrl,
                    {
                        method,
                        body: opts.data,
                    },
                    abortController.current,
                );
                clearTimeout(timeoutId);
                if (abortController.current?.signal.aborted) return;

                //If generic error
                if (throwGenericErrors && 'error' in data) {
                    const apiError = data as GenericApiErrorResp;
                    throw new BackendApiError('API Error', translateApiError(t, apiError.errorCode, apiError.error));
                }

                //Auto handler for GenericApiErrorResp & GenericApiOkResp if genericHandler is set
                if (opts.genericHandler && currentToastId.current) {
                    if ('error' in data) {
                        const apiError = data as GenericApiErrorResp;
                        txToast.error(
                            {
                                title: opts.genericHandler.errorTitle,
                                msg: translateApiError(t, apiError.errorCode, apiError.error),
                            },
                            { id: currentToastId.current },
                        );
                    } else {
                        txToast.success(opts.genericHandler.successMsg, { id: currentToastId.current });
                    }
                }

                //Auto handler for ApiToastResp
                if (
                    currentToastId.current &&
                    typeof data?.type === 'string' &&
                    typeof data?.msg === 'string' &&
                    validToastTypes.includes(data?.type) &&
                    typeof txToast[data.type as keyof typeof txToast] === 'function'
                ) {
                    txToast(data, { id: currentToastId.current });
                }

                //Custom success handler
                if (opts.success) {
                    try {
                        opts.success(data, currentToastId.current);
                    } catch (error) {
                        console.log('[SUCCESS CB ERROR]', apiCallDesc, error);
                    }
                }
                return data as RespType;
            } catch (e) {
                if (abortController.current?.signal.aborted) return;
                clearTimeout(timeoutId);
                let errorMessage = 'unknown error';
                const error = e as any;
                if (typeof error.message !== 'string') {
                    errorMessage = JSON.stringify(error);
                } else if (error.message.startsWith('NetworkError')) {
                    errorMessage = 'Network error.\nIf you closed sxPanel, please restart it and try again.';
                } else if (error.message.startsWith('JSON.parse:')) {
                    errorMessage = 'Invalid JSON response from server.';
                } else {
                    errorMessage = error.message;
                }

                if (errorMessage.includes('unmount')) {
                    console.warn('[UNMOUNTED]', apiCallDesc);
                } else {
                    console.error('[ERROR]', apiCallDesc, errorMessage);
                    handleError('Request Error', errorMessage);
                }
            } finally {
                if (opts.finally) {
                    try {
                        opts.finally();
                    } catch (error) {
                        console.log('[FINALLY CB ERROR]', apiCallDesc, error);
                    }
                }
            }
        },
        [authedFetcher, method, path, t, throwGenericErrors],
    );
};
