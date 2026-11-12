// Fork-only (CLAUDE.md §5). Where the offscreen VR overlay's frames are exchanged with the .NET side.
// Must match `OverlayFrame.GetSharedMemoryPath` in `Dotnet/Overlay/Electron/WindowsOverlay.cs`.
const path = require('path');

/**
 * @param {string} platform `process.platform`
 * @param {string} tmpdir `os.tmpdir()`
 * @returns {string | null} The frame file, or null where the offscreen overlay isn't supported
 */
function getOverlayShmPath(platform, tmpdir) {
    if (platform === 'linux') {
        return '/dev/shm/vrcx_overlay';
    }
    if (platform === 'win32') {
        return path.win32.join(tmpdir, 'vrcx_overlay');
    }
    return null;
}

module.exports = { getOverlayShmPath };
