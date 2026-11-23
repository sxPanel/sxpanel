import { fetchNui } from './fetchNui';
import { isBrowserEnv } from './miscUtils';

const CHECK_INTERVAL_MS = 3000;
// A `debugger` statement is a no-op unless devtools are attached, in which case it pauses
// until resumed. Nothing else can stall two consecutive statements for this long.
const PAUSE_THRESHOLD_MS = 1000;

/**
 * Best-effort detection of the NUI devtools (`nui_devtools`), the usual way to copy NUI
 * html/js out of a server. Reports once to the client script, which forwards it to the
 * security module (resource/sv_security.lua, detection `nuiDevtools`).
 * NOTE: built with the Function constructor so the bundler can't strip the statement.
 */
export const startDevtoolsDetector = () => {
    if (isBrowserEnv()) return;

    let probe: () => void;
    try {
        probe = new Function('debugger') as () => void;
    } catch {
        return; // eval disabled, nothing to do
    }

    const timer = setInterval(() => {
        const start = performance.now();
        probe();
        if (performance.now() - start < PAUSE_THRESHOLD_MS) return;

        clearInterval(timer);
        fetchNui('securityReport', { kind: 'devtools' }).catch(() => {});
    }, CHECK_INTERVAL_MS);
};
