import { expect, it, suite } from 'vitest';
import { ensureSteamAuthEnforced } from './utils';

suite('ensureSteamAuthEnforced', () => {
    it('should append the convar when missing', () => {
        const out = ensureSteamAuthEnforced('sv_hostname "test"\nset steam_webApiKey ""\n');
        expect(out.startsWith('sv_hostname "test"\nset steam_webApiKey ""\n')).toBe(true);
        expect(out.endsWith('\nset sv_enforceSteamAuth true\n')).toBe(true);
    });

    it('should keep CRLF line endings', () => {
        const out = ensureSteamAuthEnforced('sv_hostname "test"\r\nsv_maxclients 48\r\n');
        expect(out.endsWith('\r\nset sv_enforceSteamAuth true\r\n')).toBe(true);
        expect(out.replaceAll('\r\n', '')).not.toContain('\n');
    });

    it('should not touch configs that already set the convar', () => {
        const cfgs = [
            'set sv_enforceSteamAuth true',
            'sv_hostname "x"\n  SETS sv_enforcesteamauth false\n',
            'sv_enforceSteamAuth "true"',
            'set "sv_enforceSteamAuth" true',
        ];
        for (const cfg of cfgs) {
            expect(ensureSteamAuthEnforced(cfg)).toBe(cfg);
        }
    });

    it('should ignore commented out or unrelated mentions', () => {
        const cfg = '# set sv_enforceSteamAuth true\nsv_hostname "sv_enforceSteamAuth"';
        expect(ensureSteamAuthEnforced(cfg)).toContain('\nset sv_enforceSteamAuth true\n');
    });
});
