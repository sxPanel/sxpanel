import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import StreamZip from 'node-stream-zip';

const monitorDir = path.resolve('monitor');

//Entries that must exist for the resource to boot at all
const requiredEntries = ['fxmanifest.lua', 'entrypoint.js', 'core/index.js', 'resource/sv_main.lua'];

//The resource is folder-name-agnostic (uses GetCurrentResourceName() at runtime), so the same
//build output is packaged under both names: 'monitor' for gen8 servers, 'txadmin' for gen9.
const outputNames = ['monitor', 'txadmin'];

if (!existsSync(monitorDir)) {
    console.error(`Monitor directory not found: ${monitorDir}`);
    process.exit(1);
}

const packageAs = async (name) => {
    const zipPath = path.resolve(`${name}.zip`);
    const shaPath = path.resolve(`${name}.zip.sha256`);

    //NOTE: do not replace this with PowerShell's Compress-Archive — it writes
    //backslash entry paths, which Linux unzip extracts as flat literal filenames
    await new Promise((resolve, reject) => {
        const output = createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        output.on('close', resolve);
        archive.on('error', reject);
        archive.on('warning', reject);
        archive.pipe(output);
        archive.directory(monitorDir, false);
        archive.finalize();
    });

    //Make sure the zip extracts correctly on every platform
    const zip = new StreamZip.async({ file: zipPath });
    const entryNames = Object.keys(await zip.entries());
    await zip.close();

    const badEntries = entryNames.filter((entryName) => entryName.includes('\\'));
    if (badEntries.length) {
        console.error(`${name}.zip has ${badEntries.length} entries with backslash paths (eg. '${badEntries[0]}'), aborting.`);
        process.exit(1);
    }
    const missingEntries = requiredEntries.filter((entryName) => !entryNames.includes(entryName));
    if (missingEntries.length) {
        console.error(`${name}.zip is missing required entries: ${missingEntries.join(', ')}`);
        process.exit(1);
    }

    const digest = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
    writeFileSync(shaPath, `${digest}  ${name}.zip\n`);
    console.log(`Packaged ${zipPath} (${entryNames.length} entries) and ${shaPath}`);
};

for (const name of outputNames) {
    await packageAs(name);
}
