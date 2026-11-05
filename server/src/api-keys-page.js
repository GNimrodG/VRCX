/**
 * The fork-only web UI for managing API keys, served by the server itself at
 * `/admin/api-keys` (private listener only, and only when the API is enabled).
 * Deliberately not part of the Vue client: that is upstream-owned and Vite-
 * built, whereas this is one self-contained page, so it costs no merge
 * surface, needs no client build, and works on an API-only container.
 *
 * It authenticates with the browser's existing `HttpOnly` session cookie
 * (same origin), calling the session-authenticated `/api/keys` routes, so it
 * can only be used from a logged-in web client session. The page itself holds
 * no data and is safe to serve unauthenticated.
 *
 * It is also the *only* implementation of the key form: the web client and
 * the desktop app both embed it in an iframe instead of reimplementing it.
 * Standalone and same-origin-embedded it uses the cookie; embedded in the
 * desktop app (`?bridge=1`, whose page is `file://` and holds no cookie) it
 * sends list/create/revoke to its parent with `postMessage` and the app
 * forwards them over its own authenticated channel. `?theme=dark|light`
 * lets the host pass its theme. Framing is limited to the same origin
 * (`frame-ancestors 'self'`); the desktop main process relaxes that for this
 * one URL, so the server never has to allow `file://` or a configurable list.
 *
 * All dynamic text is inserted with `textContent`, never `innerHTML`, so a
 * hostile key name can't inject markup. The CSP pins the inline script by hash
 * (no `unsafe-inline` for scripts) and forbids framing and external loads.
 */
import crypto from 'node:crypto';

const SCRIPT = String.raw`
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...kids);
    return node;
};
const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

const params = new URLSearchParams(location.search);
const framed = window.parent !== window;
const bridge = framed && params.get('bridge') === '1';
const theme = params.get('theme');
if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
if (framed) document.documentElement.classList.add('embedded');

async function rest(path, options = {}) {
    const response = await fetch(path, {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        ...options
    });
    let body = {};
    try { body = await response.json(); } catch {}
    return { status: response.status, body };
}

// Bridge transport: only our parent window may answer, and the answers are
// the app's own; this page never sees the session token.
const pending = new Map();
let nextCallId = 1;
window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.type !== 'vrcx-apikeys-rpc-result') return;
    const resolve = pending.get(data.id);
    if (resolve) {
        pending.delete(data.id);
        resolve(data.result);
    }
});
function bridgeCall(method, args) {
    return new Promise((resolve) => {
        const id = nextCallId++;
        const timer = setTimeout(() => {
            pending.delete(id);
            resolve({ ok: false, error: 'The app did not respond.' });
        }, 15000);
        pending.set(id, (result) => { clearTimeout(timer); resolve(result); });
        window.parent.postMessage({ type: 'vrcx-apikeys-rpc', id, method, args }, '*');
    });
}

// One interface over both transports. Every call resolves, never rejects:
// { ok, result?, error?, kind? } with kind 'signin' | 'disabled' | 'error'.
const ops = bridge
    ? {
        async list() {
            const r = await bridgeCall('list', []);
            if (!r.ok) return { ok: false, kind: /not available/i.test(r.error || '') ? 'disabled' : 'error', error: r.error };
            return r;
        },
        create: (input) => bridgeCall('create', [input]),
        async revoke(id) {
            const r = await bridgeCall('revoke', [id]);
            return r.ok && r.result !== true ? { ok: false, error: 'Could not revoke that key.' } : r;
        }
    }
    : {
        async list() {
            try {
                const { status, body } = await rest('/api/keys');
                if (status === 401) return { ok: false, kind: 'signin' };
                if (status === 404) return { ok: false, kind: 'disabled' };
                if (status !== 200) return { ok: false, kind: 'error', error: body.error || 'Could not load keys.' };
                return { ok: true, result: { keys: body.keys, scopes: body.scopes } };
            } catch (err) {
                return { ok: false, kind: 'error', error: String(err.message || err) };
            }
        },
        async create(input) {
            try {
                const { status, body } = await rest('/api/keys', { method: 'POST', body: JSON.stringify(input) });
                return status === 201 ? { ok: true, result: body } : { ok: false, error: body.error || 'Could not create the key.' };
            } catch (err) {
                return { ok: false, error: String(err.message || err) };
            }
        },
        async revoke(id) {
            try {
                const { status } = await rest('/api/keys/' + encodeURIComponent(id), { method: 'DELETE' });
                return status === 200 ? { ok: true, result: true } : { ok: false, error: 'Could not revoke that key.' };
            } catch (err) {
                return { ok: false, error: String(err.message || err) };
            }
        }
    };

function showMessage(text, isError) {
    const box = $('message');
    box.textContent = text;
    box.className = isError ? 'message error' : 'message';
    box.hidden = !text;
}

function renderScopes(scopes) {
    const list = $('scopes');
    list.replaceChildren();
    for (const [name, description] of Object.entries(scopes)) {
        const input = el('input', { type: 'checkbox', value: name });
        list.append(el('label', { className: 'scope' }, input,
            el('span', {}, el('code', {}, name), el('span', { className: 'desc' }, description))));
    }
}

function renderKeys(keys) {
    const list = $('keys');
    list.replaceChildren();
    $('empty').hidden = keys.length > 0;
    for (const key of keys) {
        const revoke = el('button', { type: 'button', className: 'danger', textContent: 'Revoke' });
        revoke.addEventListener('click', () => {
            if (revoke.dataset.armed !== '1') {
                revoke.dataset.armed = '1';
                revoke.textContent = 'Click again to confirm';
                setTimeout(() => { revoke.dataset.armed = ''; revoke.textContent = 'Revoke'; }, 4000);
                return;
            }
            revokeKey(key.id);
        });
        list.append(el('li', { className: 'key' },
            el('div', { className: 'key-head' },
                el('span', { className: 'key-name' }, key.name), ' ', el('code', {}, key.id)),
            el('div', { className: 'key-scopes' }, ...key.scopes.map((s) => el('code', {}, s))),
            el('div', { className: 'key-meta' },
                'Created ' + fmt(key.createdAt) + ' · Expires ' + (key.expiresAt ? fmt(key.expiresAt) : 'never')
                + ' · Last used ' + (key.lastUsedAt ? fmt(key.lastUsedAt) : 'never')),
            revoke));
    }
}

async function load() {
    const r = await ops.list();
    if (!r.ok) {
        if (r.kind === 'signin') {
            $('app').hidden = true;
            $('signin').hidden = false;
        } else if (r.kind === 'disabled') {
            $('app').hidden = true;
            showMessage('The external API is disabled. Set VRCX_API_ENABLED=1 on the server and restart it.', true);
        } else {
            // Keep what is on screen (e.g. a just-created key) if we were already showing keys.
            showMessage(r.error || 'Could not load API keys.', true);
        }
        return;
    }
    $('signin').hidden = true;
    $('app').hidden = false;
    renderScopes(r.result.scopes);
    renderKeys(r.result.keys);
}

async function revokeKey(id) {
    const r = await ops.revoke(id);
    showMessage(r.ok ? 'Key revoked.' : r.error || 'Could not revoke that key.', !r.ok);
    if (r.ok) load();
}

$('create').addEventListener('submit', async (event) => {
    event.preventDefault();
    const scopes = [...document.querySelectorAll('#scopes input:checked')].map((i) => i.value);
    const days = Number($('expiry').value);
    const r = await ops.create({
        name: $('name').value,
        scopes,
        expiresAt: days ? new Date(Date.now() + days * 864e5).toISOString() : null
    });
    if (!r.ok) {
        showMessage(r.error || 'Could not create the key.', true);
        return;
    }
    showMessage('', false);
    $('newKey').textContent = r.result.key;
    $('reveal').hidden = false;
    $('name').value = '';
    document.querySelectorAll('#scopes input').forEach((i) => { i.checked = false; });
    load();
});

$('copy').addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText($('newKey').textContent);
        $('copy').textContent = 'Copied';
    } catch {
        $('copy').textContent = 'Select the key and copy it manually';
    }
});
$('dismiss').addEventListener('click', () => {
    $('newKey').textContent = '';
    $('reveal').hidden = true;
    $('copy').textContent = 'Copy';
});

load();
`;

const STYLE = `
:root { color-scheme: light dark; --bg:#fff; --fg:#1b1f23; --muted:#5b6670; --line:#d6dbe0; --card:#f6f8fa; --accent:#2457d6; --danger:#b3261e; --ok:#1a7f37; }
@media (prefers-color-scheme: dark) { :root:not([data-theme]) { --bg:#0f1317; --fg:#e6e9ec; --muted:#9aa5b1; --line:#2b333b; --card:#171c21; --accent:#7aa2ff; --danger:#ff8a80; --ok:#56d364; } }
:root[data-theme="dark"] { color-scheme: dark; --bg:#0f1317; --fg:#e6e9ec; --muted:#9aa5b1; --line:#2b333b; --card:#171c21; --accent:#7aa2ff; --danger:#ff8a80; --ok:#56d364; }
:root[data-theme="light"] { color-scheme: light; --bg:#fff; --fg:#1b1f23; --muted:#5b6670; --line:#d6dbe0; --card:#f6f8fa; --accent:#2457d6; --danger:#b3261e; --ok:#1a7f37; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.55 system-ui,sans-serif; }
main { max-width: 720px; margin: 0 auto; padding: 32px 24px 64px; }
h1 { font-size: 22px; margin: 0 0 6px; }
h2 { font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin: 32px 0 12px; }
p.lead { color: var(--muted); margin: 0 0 24px; }
section, .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 20px; }
.field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 20px; }
.field > span, legend { font-weight: 600; }
fieldset { border: 0; padding: 0; margin: 0 0 20px; display: flex; flex-direction: column; gap: 8px; }
legend { padding: 0; margin-bottom: 8px; float: left; width: 100%; }
legend + * { clear: both; }
#scopes { display: flex; flex-direction: column; gap: 8px; }
.scope { display: flex; gap: 12px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); cursor: pointer; }
.scope input { margin: 3px 0 0; }
.scope .desc { display: block; color: var(--muted); font-size: 13px; margin-top: 2px; }
input[type=text], select { width: 100%; height: 40px; padding: 0 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--fg); font: inherit; }
.actions { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
.actions .field { flex: 1 1 200px; margin: 0; }
code { font: 12px ui-monospace, monospace; background: var(--bg); border: 1px solid var(--line); border-radius: 4px; padding: 1px 6px; }
button { font: inherit; height: 40px; padding: 0 16px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--fg); cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
button.danger { color: var(--danger); border-color: var(--danger); }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.message { padding: 12px 14px; border-radius: 8px; border: 1px solid var(--ok); margin: 0 0 16px; }
.message.error { border-color: var(--danger); color: var(--danger); }
#reveal { margin-bottom: 8px; display: flex; flex-direction: column; gap: 12px; }
#reveal .row { display: flex; gap: 8px; flex-wrap: wrap; }
#newKey { display: block; word-break: break-all; padding: 12px; user-select: all; font-size: 13px; }
.keys { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.key { display: grid; grid-template-columns: 1fr auto; gap: 8px 16px; align-items: start; padding: 16px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
.key-name { font-weight: 600; font-size: 15px; }
.key-scopes { display: flex; flex-wrap: wrap; gap: 6px; grid-column: 1; }
.key-meta { color: var(--muted); font-size: 13px; grid-column: 1; }
.key button { grid-column: 2; grid-row: 1 / span 3; }
@media (max-width: 520px) { .key { grid-template-columns: 1fr; } .key button { grid-column: 1; grid-row: auto; justify-self: start; } }
[hidden] { display: none !important; }
.embedded h1, .embedded p.lead { display: none; }
:root.embedded, :root.embedded body { background: transparent; }
.embedded main { padding: 0; max-width: none; }
.embedded body { overflow-x: hidden; }
.embedded h2:first-of-type { margin-top: 0; }
.embedded section { background: none; border: 0; padding: 0; }
`;

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>API keys</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>API keys</h1>
<p class="lead">Read-only keys for external tools. See <code>/api/v1/openapi.json</code> for what they can call.</p>
<div id="message" class="message" hidden role="status"></div>
<div id="signin" class="card" hidden>
  <strong>Not signed in.</strong> Open the <a href="/" target="_top">web client</a>, sign in with your authenticator code, then reload this page.
</div>
<div id="app" hidden>
  <div id="reveal" class="card" hidden role="alert">
    <strong>Copy your new key now — it is shown only once.</strong>
    <code id="newKey"></code>
    <div class="row">
      <button id="copy" type="button">Copy</button>
      <button id="dismiss" type="button">I have saved it</button>
    </div>
  </div>
  <h2>Create a key</h2>
  <section>
    <form id="create">
      <label class="field"><span>Name</span><input id="name" type="text" maxlength="100" required placeholder="e.g. stream overlay"></label>
      <fieldset><legend>Scopes</legend><div id="scopes"></div></fieldset>
      <div class="actions">
        <label class="field"><span>Expires</span>
          <select id="expiry"><option value="0">Never</option><option value="30">In 30 days</option><option value="90">In 90 days</option><option value="365">In 1 year</option></select></label>
        <button class="primary" type="submit">Create key</button>
      </div>
    </form>
  </section>
  <h2>Existing keys</h2>
  <ul id="keys" class="keys"></ul>
  <p id="empty" class="lead" hidden>No keys yet.</p>
</div>
</main>
<script>${SCRIPT}</script>
</body>
</html>
`;

const scriptHash = crypto.createHash('sha256').update(SCRIPT).digest('base64');

export const API_KEYS_PAGE = {
    html: HTML,
    headers: {
        'Content-Type': 'text/html;charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Frame-Options': 'SAMEORIGIN',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy':
            `default-src 'none'; script-src 'sha256-${scriptHash}'; ` +
            `style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; ` +
            `form-action 'none'; frame-ancestors 'self'`
    }
};
