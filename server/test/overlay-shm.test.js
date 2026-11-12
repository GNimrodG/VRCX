import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

// src-electron/overlayShm.js is CommonJS and shared with the Electron main process
const require = createRequire(import.meta.url);
const { getOverlayShmPath } = require('../../src-electron/overlayShm.js');

describe('getOverlayShmPath', () => {
    it('uses /dev/shm on Linux, ignoring the temp dir', () => {
        expect(getOverlayShmPath('linux', '/tmp')).toBe('/dev/shm/vrcx_overlay');
    });

    it('uses a file in the temp folder on Windows', () => {
        expect(getOverlayShmPath('win32', 'C:\\Users\\me\\AppData\\Local\\Temp')).toBe(
            'C:\\Users\\me\\AppData\\Local\\Temp\\vrcx_overlay'
        );
    });

    it('does not double the separator when the temp dir ends with one', () => {
        expect(getOverlayShmPath('win32', 'C:\\Temp\\')).toBe('C:\\Temp\\vrcx_overlay');
    });

    it('returns null where the offscreen overlay is unsupported', () => {
        expect(getOverlayShmPath('darwin', '/tmp')).toBeNull();
        expect(getOverlayShmPath('freebsd', '/tmp')).toBeNull();
    });
});
