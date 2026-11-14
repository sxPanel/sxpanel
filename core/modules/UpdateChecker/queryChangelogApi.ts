const modulename = 'UpdateChecker';
import semver, { ReleaseType } from 'semver';
import { z } from 'zod';
import got from '@lib/got';
import { txEnv } from '@core/globalData';
import consoleFactory from '@lib/console';
import { UpdateDataType } from '@shared/otherTypes';
import { fromError } from 'zod-validation-error';
const console = consoleFactory(modulename);

//Schemas
const txVersion = z.string().refine((x) => x !== '0.0.0', { message: 'must not be 0.0.0' });
const changelogRespSchema = z.object({
    recommended: z.coerce.number().positive(),
    recommended_download: z.string().url(),
    recommended_txadmin: txVersion,
    optional: z.coerce.number().positive(),
    optional_download: z.string().url(),
    optional_txadmin: txVersion,
    latest: z.coerce.number().positive(),
    latest_download: z.string().url(),
    latest_txadmin: txVersion,
    critical: z.coerce.number().positive(),
    critical_download: z.string().url(),
    critical_txadmin: txVersion,
});
const sxpanelVersionSchema = z.object({
    latest: z.string().min(1),
});

//Types
type DetailedUpdateDataType = {
    semverDiff: ReleaseType;
    version: string;
    isImportant: boolean;
};

export const queryChangelogApi = async () => {
    //GET changelog data
    let apiResponse: z.infer<typeof changelogRespSchema>;
    try {
        //perform request - cache busting every ~1.4h
        const osTypeApiUrl = txEnv.isWindows ? 'win32' : 'linux';
        const cacheBuster = Math.floor(Date.now() / 5_000_000);
        const reqUrl = `https://changelogs-live.fivem.net/api/changelog/versions/${osTypeApiUrl}/server?${cacheBuster}`;
        const resp = await got(reqUrl).json();
        apiResponse = changelogRespSchema.parse(resp);
    } catch (error) {
        let msg = emsg(error);
        if (error instanceof z.ZodError) {
            msg = fromError(error, { prefix: null }).message;
        }
        console.verbose.warn(`Failed to retrieve FXServer/sxPanel update data with error: ${msg}`);
        return;
    }

    //Checking sxPanel version against sxpanel.org API
    let txaUpdateData: DetailedUpdateDataType | undefined;
    try {
        const sxpanelResp = await got('https://www.sxpanel.org/api/version').json();
        const sxpanelData = sxpanelVersionSchema.parse(sxpanelResp);
        const isOutdated = semver.lt(txEnv.txaVersion, sxpanelData.latest);
        if (isOutdated) {
            const semverDiff = semver.diff(txEnv.txaVersion, sxpanelData.latest) ?? 'patch';
            const isImportant = semverDiff === 'major' || semverDiff === 'minor';
            txaUpdateData = {
                semverDiff,
                isImportant,
                version: sxpanelData.latest,
            };
        }
    } catch (error) {
        console.verbose.warn('Error checking for sxPanel updates.');
        console.verbose.dir(error);
    }

    //Checking FXServer version
    //NOTE: gen9 (FiveM Enhanced) uses its own unrelated build-numbering scheme, which this
    //      changelog API doesn't have thresholds for yet, so the comparison is skipped entirely.
    let fxsUpdateData: UpdateDataType | undefined;
    try {
        if (txEnv.fxsIsGen9) {
            //no-op, nothing to compare gen9 build numbers against yet
        } else if (txEnv.fxsVersion < apiResponse.critical) {
            if (apiResponse.critical > apiResponse.recommended) {
                fxsUpdateData = {
                    version: apiResponse.critical.toString(),
                    isImportant: true,
                    downloadUrl: apiResponse.critical_download,
                };
            } else {
                fxsUpdateData = {
                    version: apiResponse.recommended.toString(),
                    isImportant: true,
                    downloadUrl: apiResponse.recommended_download,
                };
            }
        } else if (txEnv.fxsVersion < apiResponse.recommended) {
            fxsUpdateData = {
                version: apiResponse.recommended.toString(),
                isImportant: true,
                downloadUrl: apiResponse.recommended_download,
            };
        } else if (txEnv.fxsVersion < apiResponse.optional) {
            fxsUpdateData = {
                version: apiResponse.optional.toString(),
                isImportant: false,
                downloadUrl: apiResponse.optional_download,
            };
        }
    } catch (error) {
        console.warn('Error checking for FXServer updates.');
        console.verbose.dir(error);
    }

    return {
        txa: txaUpdateData,
        fxs: fxsUpdateData,
    };
};
