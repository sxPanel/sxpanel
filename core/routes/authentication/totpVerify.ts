/**
 * TOTP Verify - Verify a TOTP code during login (after password was accepted).
 * Reads the pending_2fa session, validates code, upgrades to full session.
 * Also accepts backup codes as fallback.
 */
const modulename = 'WebServer:TotpVerify';
import { PassSessAuthType, resolveEffectiveAuthedAdmin } from '@modules/WebServer/authLogic';
import { InitializedCtx } from '@modules/WebServer/ctxTypes';
import consoleFactory from '@lib/console';
import { verifyTotpCode, verifyBackupCode } from '@lib/totp';
import { ApiTotpVerifyResp } from '@shared/authApiTypes';
import { totpVerifyBodySchema as bodySchema } from '@shared/authApiSchemas';
const console = consoleFactory(modulename);

export default async function TotpVerify(ctx: InitializedCtx) {
    const sendTypedResp = (data: ApiTotpVerifyResp) => ctx.send(data);

    const postBody = ctx.getBody(bodySchema);
    if (!postBody) return;

    try {
        // Get the pending 2FA session
        const sess = ctx.sessTools.get();
        const authData = sess?.auth;
        if (!authData || authData.type !== 'pending_2fa') {
            return sendTypedResp({ error: 'No pending 2FA session. Please login again.' });
        }

        // Find the admin
        const vaultAdmin = txCore.adminStore.getAdminByName(authData.username);
        if (!vaultAdmin) {
            ctx.sessTools.destroy();
            return sendTypedResp({ error: 'Admin not found.' });
        }

        // Verify password revision still matches (in case it changed)
        if (vaultAdmin.passwordRevision !== authData.password_revision) {
            ctx.sessTools.destroy();
            return sendTypedResp({ error: 'Session expired. Please login again.' });
        }

        // Get the raw admin to access the TOTP secret
        const rawAdmin = txCore.adminStore.getRawAdminByName(authData.username);
        if (!rawAdmin?.totp_secret) {
            ctx.sessTools.destroy();
            return sendTypedResp({ error: '2FA is not configured for this account.' });
        }

        // Try TOTP code first
        let isValid = verifyTotpCode(rawAdmin.totp_secret, postBody.code);

        // If not a valid TOTP code, try as a backup code
        if (!isValid && rawAdmin.totp_backup_codes?.length) {
            const backupIndex = verifyBackupCode(postBody.code, rawAdmin.totp_backup_codes);
            if (backupIndex >= 0) {
                isValid = true;
                // Consume the backup code
                await txCore.adminStore.consumeBackupCode(authData.username, backupIndex);
                console.warn(`Admin ${authData.username} used a backup code for 2FA`);
            }
        }

        if (!isValid) {
            return sendTypedResp({ error: 'Invalid code. Please try again.' });
        }

        // Upgrade to full session — regenerate the session id to prevent
        // session-fixation: the pre-2FA cookie value is discarded.
        const sessData = {
            type: 'password',
            username: vaultAdmin.name,
            password_revision: vaultAdmin.passwordRevision,
            expiresAt: false,
            csrfToken: txCore.adminStore.genCsrfToken(),
        } satisfies PassSessAuthType;
        ctx.sessTools.regenerate({ auth: sessData });

        txCore.logger.system.write(vaultAdmin.name, `logged in via password+2FA`, 'login', {
            actionId: 'login.password_2fa',
            ip: ctx.ip,
        });
        txManager.txRuntime.loginOrigins.count(ctx.txVars.hostType);
        txManager.txRuntime.loginMethods.count('password');

        const authedAdmin = await resolveEffectiveAuthedAdmin(vaultAdmin, sessData.csrfToken);
        return sendTypedResp(authedAdmin.getAuthData());
    } catch (error) {
        console.warn(`Failed TOTP verify: ${emsg(error)}`);
        return sendTypedResp({ error: 'Failed to verify 2FA code.' });
    }
}
