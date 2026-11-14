/**
 * Parses a fxserver version convar into a number.
 */
export const parseFxserverVersion = (version: any): ParseFxserverVersionResult => {
    if (typeof version !== 'string') throw new Error(`expected string`);

    const fxsVersionRegex = /^FXServer-(?<branch>\S+).*?v1\.0\.0\.(?<build>\d{4,8}) (?<platform>\w+)$/;
    try {
        const matches = fxsVersionRegex.exec(version);
        if (!matches) throw new Error(`no match`);
        return {
            valid: true,
            branch: matches.groups!.branch,
            build: parseInt(matches.groups!.build),
            platform: matches.groups!.platform === 'win32' ? 'windows' : 'linux',
        };
    } catch (error) {
        return {
            valid: false,
            branch: null,
            build: null,
            platform: version.includes('win32') ? 'windows' : version.includes('linux') ? 'linux' : null,
        };
    }
};

export type ParseFxserverVersionResult =
    | {
          valid: true;
          branch: string;
          build: number;
          platform: string;
      }
    | {
          valid: false;
          branch: null;
          build: null;
          platform: 'windows' | 'linux' | null;
      };

/**
 * Detects whether the current process is running under FXServer gen9 (FiveM Enhanced/cfx-server).
 *
 * Primary signal (matches upstream txAdmin's own gen9 detection): the embedded runtime's binary
 * is named `cfx-server(.exe)` on gen9, vs `FXServer(.exe)` on gen8 - checked via process.argv0.
 * Falls back to detecting the gen9-only `--runtime-branch "..." --runtime-version "b<build>"`
 * argv pair (used as a secondary signal, and so tests/non-FXServer environments where argv0
 * isn't one of the two binary names default safely to gen8/false).
 */
export const isGen9Runtime = (argv0: string = process.argv0, argv: string[] = process.argv): boolean => {
    const argv0Bin = (argv0.split(/[\\/]/).pop() ?? '').toLowerCase();
    if (argv0Bin === 'cfx-server' || argv0Bin === 'cfx-server.exe') return true;
    if (argv0Bin === 'fxserver' || argv0Bin === 'fxserver.exe') return false;

    //Unknown binary (eg. tests) - fall back to the argv flag heuristic
    return argv.some((arg) => arg.includes('--runtime-version'));
};

/**
 * Parses FXServer gen9's runtime version info out of process.argv.
 * Example argv entry: --runtime-branch "early-access" --runtime-version "b50"
 * NOTE: gen9's build numbering is a small incrementing counter, unrelated to and not
 * comparable with gen8's `v1.0.0.<build>` scheme (see parseFxserverVersion above).
 */
export const parseGen9RuntimeArgs = (argv: string[] = process.argv): ParseFxserverVersionResult => {
    const raw = argv.find((arg) => arg.includes('--runtime-version')) ?? '';
    const branchMatch = raw.match(/--runtime-branch\s+(?:"([^"]+)"|(\S+))/);
    const branch = branchMatch?.[1] ?? branchMatch?.[2] ?? null;
    const buildMatch = raw.match(/--runtime-version\s+"?b(\d+)"?/);
    const platform: 'windows' | 'linux' = process.platform === 'win32' ? 'windows' : 'linux';

    if (!buildMatch) {
        return { valid: false, branch: null, build: null, platform };
    }
    return {
        valid: true,
        branch: branch ?? 'unknown',
        build: parseInt(buildMatch[1], 10),
        platform,
    };
};
