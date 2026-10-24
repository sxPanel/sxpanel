import fs from 'node:fs';
import path from 'node:path';
import esbuild from 'esbuild';
import { copyBotRuntimeDependencies, copyStaticFiles, getPublishVersion, licenseBanner } from './utils';

//Detect the tag/version and set the .cienv file
const { txVersion, isPreRelease, preReleaseExpiration } = getPublishVersion(true);
fs.mkdirSync('.github', { recursive: true });
fs.writeFileSync('.github/.cienv', `TX_IS_PRERELEASE=${isPreRelease}\n`);

//Copy static files
console.log('Starting sxPanel Prod Builder');
copyStaticFiles('./monitor/', txVersion, 'publish');
copyBotRuntimeDependencies('./monitor');
//yarn.installed Needs to be older than the package.json
fs.writeFileSync('./monitor/.yarn.installed', '');
fs.writeFileSync('./monitor/package.json', '{"type":"commonjs"}');
fs.writeFileSync('./monitor/LICENSE.txt', licenseBanner());

//Transpile & bundle core
try {
    const { errors } = esbuild.buildSync({
        entryPoints: ['./core'],
        bundle: true,
        outfile: './monitor/core/index.js',
        platform: 'node',
        target: 'node18',
        format: 'cjs', //typescript builds to esm and esbuild converts it to cjs
        minifyWhitespace: true,
        charset: 'utf8',
        inject: [path.join('scripts', 'build', 'importMetaUrlShim.js')],
        define: { TX_PRERELEASE_EXPIRATION: preReleaseExpiration, 'import.meta.url': 'import_meta_url' },
        banner: { js: licenseBanner(undefined, true) },
        //To satisfy the license's "full text" requirement, it will be generated
        //by another npm script and it is referenced in the banner.
        legalComments: 'none',
    });
    if (errors.length) {
        console.log(`[BUNDLER] Failed with ${errors.length} errors.`);
        process.exit(1);
    }
} catch (error) {
    console.log('[BUNDLER] Errored out :(');
    console.dir(error);
    process.exit(1);
}
console.log('Publish task finished :)');
