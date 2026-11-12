/**
 * Browser-tab counterpart of the desktop tray dot: `SetTrayIconNotification`
 * (called by `src/stores/ui.js`'s `updateTrayIconNotify`, unchanged) swaps the
 * page's favicon between the plain icon and the colored-dot variants — same
 * color-resolution logic, same `images/VRCX_notify_<color>.png` assets as the
 * Electron tray (`scripts/generate-tray-icons.sh`). Fork-owned.
 *
 * The tab title is deliberately left alone.
 */
import { trayDotIconName } from '../../src/shared/utils/trayDot.js';

// Lazy: only the variants actually used are fetched.
const icons = import.meta.glob('../../images/VRCX*.png', { query: '?url', import: 'default' });

let latest = 0;

function getIconLink() {
    let link = document.querySelector('link[rel~="icon"]');
    if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        link.type = 'image/png';
        document.head.appendChild(link);
    }
    return link;
}

/**
 * @param {string | boolean | null} color Dot color, `null`/`false` for no dot;
 *   `true` is the pre-color protocol and means red.
 */
export async function setFaviconDot(color) {
    const resolved = color === true ? 'red' : typeof color === 'string' ? color : null;
    const ticket = ++latest;
    const load = icons[`../../images/${trayDotIconName(resolved)}.png`] ?? icons['../../images/VRCX_notify.png'];
    let url;
    try {
        url = await load();
    } catch {
        return; // keep whatever icon is showing rather than breaking boot
    }
    // A newer call (dot cleared while this one was loading) wins.
    if (ticket === latest) {
        getIconLink().href = url;
    }
}
