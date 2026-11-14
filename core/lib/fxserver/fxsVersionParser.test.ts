//@ts-nocheck
import { test, expect } from 'vitest';
import { parseFxserverVersion, parseGen9RuntimeArgs, isGen9Runtime } from './fxsVersionParser';
const p = parseFxserverVersion;

test('normal versions', () => {
    expect(p('FXServer-master SERVER v1.0.0.7290 win32')).toEqual({
        build: 7290,
        platform: 'windows',
        branch: 'master',
        valid: true,
    });
    expect(p('FXServer-master SERVER v1.0.0.10048 win32')).toEqual({
        build: 10048,
        platform: 'windows',
        branch: 'master',
        valid: true,
    });
    expect(p('FXServer-master v1.0.0.9956 linux')).toEqual({
        build: 9956,
        platform: 'linux',
        branch: 'master',
        valid: true,
    });
});

test('feat branch versions', () => {
    expect(p('FXServer-feature/improve_player_dropped_event SERVER v1.0.0.20240707 win32')).toEqual({
        build: 20240707,
        platform: 'windows',
        branch: 'feature/improve_player_dropped_event',
        valid: true,
    });
    expect(p('FXServer-abcdef SERVER v1.0.0.20240707 win32')).toEqual({
        build: 20240707,
        platform: 'windows',
        branch: 'abcdef',
        valid: true,
    });
});

test('invalids', () => {
    expect(() => p(1111 as any)).toThrow('expected');
    expect(p("FXServer-no-version (didn't run build tools?)")).toEqual({
        valid: false,
        build: null,
        branch: null,
        platform: null,
    });
    expect(p('Invalid server (internal validation failed)')).toEqual({
        valid: false,
        build: null,
        branch: null,
        platform: null,
    });
    //attempt to salvage platform
    expect(p('xxxxxxxx win32')).toEqual({
        valid: false,
        build: null,
        branch: null,
        platform: 'windows',
    });
    expect(p('xxxxxxxx linux')).toEqual({
        valid: false,
        build: null,
        branch: null,
        platform: 'linux',
    });
});

test('gen9 runtime detection', () => {
    //Primary signal: binary name (argv0)
    expect(isGen9Runtime('/opt/cfx-server/cfx-server', [])).toBe(true);
    expect(isGen9Runtime('C:\\fivem\\cfx-server.exe', [])).toBe(true);
    expect(isGen9Runtime('/opt/cfx-server/FXServer', [])).toBe(false);
    expect(isGen9Runtime('C:\\fivem\\FXServer.exe', [])).toBe(false);
    //Fallback signal: argv flag, for unrecognized/test argv0 (eg. 'node')
    expect(isGen9Runtime('node', ['node', 'index.js'])).toBe(false);
    expect(
        isGen9Runtime('node', ['node', '--runtime-branch', 'early-access', '--runtime-version', 'b50']),
    ).toBe(true);
});

test('gen9 runtime args parsing', () => {
    expect(
        parseGen9RuntimeArgs(['--runtime-branch "early-access" --runtime-version "b50"']).valid,
    ).toBe(true);
    expect(parseGen9RuntimeArgs(['--runtime-branch "early-access" --runtime-version "b50"'])).toEqual({
        valid: true,
        branch: 'early-access',
        build: 50,
        platform: expect.any(String),
    });
    expect(parseGen9RuntimeArgs(['--runtime-version b123'])).toEqual({
        valid: true,
        branch: 'unknown',
        build: 123,
        platform: expect.any(String),
    });
    expect(parseGen9RuntimeArgs(['node', 'index.js'])).toEqual({
        valid: false,
        branch: null,
        build: null,
        platform: expect.any(String),
    });
});
