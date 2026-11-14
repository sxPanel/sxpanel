//NOTE: Due to fxs's node, declaring ANY variable in this file will pollute
// the global scope, and it will NOT show in `Object.keys(global)`!
// Hence why I'm doing some data juggling and duplicated function calls.

//Check if running inside FXServer
try {
    if (!IsDuplicityVersion()) throw new Error();
} catch (error) {
    console.log('sxPanel must be run inside FXServer in monitor mode!');
    process.exit(999);
}

//Bridge FXServer's injected natives onto the real Node globalThis.
//NOTE: on FXServer gen9, natives are only visible to this top-level script's own execution
//context, NOT to require()'d modules (confirmed by a live "GetConvar is not defined" crash
//inside core/index.js despite it working fine right above this comment) - almost certainly the
//same context boundary referenced by the file-level note above about global scope pollution
//being invisible to Object.keys(global). Copying them onto globalThis here makes them visible
//to core/index.js. typeof-guarded since referencing an unbound identifier directly would throw.
try {
    if (typeof ExecuteCommand === 'function') globalThis.ExecuteCommand = ExecuteCommand;
    if (typeof GetConvar === 'function') globalThis.GetConvar = GetConvar;
    if (typeof GetCurrentResourceName === 'function') globalThis.GetCurrentResourceName = GetCurrentResourceName;
    if (typeof GetResourceMetadata === 'function') globalThis.GetResourceMetadata = GetResourceMetadata;
    if (typeof GetResourcePath === 'function') globalThis.GetResourcePath = GetResourcePath;
    if (typeof IsDuplicityVersion === 'function') globalThis.IsDuplicityVersion = IsDuplicityVersion;
    if (typeof PrintStructuredTrace === 'function') globalThis.PrintStructuredTrace = PrintStructuredTrace;
    if (typeof RegisterCommand === 'function') globalThis.RegisterCommand = RegisterCommand;
    if (typeof ScanResourceRoot === 'function') globalThis.ScanResourceRoot = ScanResourceRoot;
} catch (error) {
    //non-fatal - downstream code has its own typeof-guards for natives that end up missing
}

//Checking monitor mode and starting
try {
    if (GetConvar('monitorMode', 'false') == 'true') {
        require('./core/index.js');
    } else if (GetConvar('txAdminServerMode', 'false') == 'true') {
        require('./resource/sv_reportHeap.js');
    }
} catch (error) {
    //Prevent any async console.log messing with the output
    process.stdout.write(
        ['e'.repeat(80), `Resource load error: ${error.message}`, error.stack.toString(), 'e'.repeat(80), ''].join(
            '\n',
        ),
    );
}
