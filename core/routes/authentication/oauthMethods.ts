const modulename = 'WebServer:CfxreOauthMethods';
import { InitializedCtx } from '@modules/WebServer/ctxTypes';
import { ApiOauthCallbackErrorResp } from '@shared/authApiTypes';
import { randomUUID } from 'node:crypto';
import consoleFactory from '@lib/console';
import {
    getCitizenFXAuthUrl,
    getCitizenFXUserInfo,
    CitizenFXUserInfoType,
} from '@modules/AdminStore/providers/CitizenFX';
const console = consoleFactory(modulename);

/**
 * Sets up session state (state nonce + the exact callback URI used) and
 * returns the CitizenFX authorization URL. Shared by the login and
 * add-master flows since they only differ by the callback path.
 */
export const getOauthRedirectUrl = (ctx: InitializedCtx, callbackUrl: string) => {
    const state = randomUUID();
    ctx.sessTools.set({
        tmpOauthLoginState: state,
        tmpOauthLoginCallbackUri: callbackUrl,
    });
    return getCitizenFXAuthUrl(callbackUrl, state);
};

/**
 * Validates the session state against the callback URL, exchanges the
 * authorization code, and returns the CitizenFX user info.
 */
export const handleOauthCallback = async (
    ctx: InitializedCtx,
    redirectUri: string,
): Promise<ApiOauthCallbackErrorResp | CitizenFXUserInfoType> => {
    const inboundSession = ctx.sessTools.get();
    if (!inboundSession?.tmpOauthLoginState || !inboundSession?.tmpOauthLoginCallbackUri) {
        return { errorCode: 'invalid_session' };
    }

    let callbackParams: URLSearchParams;
    try {
        callbackParams = new URL(redirectUri).searchParams;
    } catch {
        return {
            errorTitle: 'Invalid redirect URI',
            errorMessage: 'Could not parse the callback URL.',
        };
    }
    const code = callbackParams.get('code');
    const state = callbackParams.get('state');
    if (!code || !state) {
        return {
            errorTitle: 'Missing OAuth parameters',
            errorMessage: 'The callback URL did not include the expected code/state parameters.',
        };
    }
    if (state !== inboundSession.tmpOauthLoginState) {
        return { errorCode: 'invalid_state' };
    }

    try {
        return await getCitizenFXUserInfo(code, inboundSession.tmpOauthLoginCallbackUri);
    } catch (error) {
        const err = error as Error & { name?: string; cause?: { name?: string } };
        console.warn(`Code exchange error: ${err.message}`);
        if (err.name === 'TimeoutError' || err.cause?.name === 'TimeoutError') {
            return { errorCode: 'timeout' };
        }
        return {
            errorTitle: 'Code exchange error:',
            errorMessage: err.message,
        };
    }
};
