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

async function api(path, options = {}) {
    const response = await fetch(path, {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        ...options
    });
    let body = {};
    try { body = await response.json(); } catch {}
    return { status: response.status, body };
}

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
            el('span', {}, el('code', {}, name), ' ' + description)));
    }
}

function renderKeys(keys) {
    const body = $('keys');
    body.replaceChildren();
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
        body.append(el('tr', {},
            el('td', {}, key.name),
            el('td', {}, el('code', {}, key.id)),
            el('td', {}, ...key.scopes.flatMap((s) => [el('code', {}, s), ' '])),
            el('td', {}, fmt(key.createdAt)),
            el('td', {}, key.expiresAt ? fmt(key.expiresAt) : 'Never'),
            el('td', {}, fmt(key.lastUsedAt)),
            el('td', {}, revoke)));
    }
}

async function load() {
    const { status, body } = await api('/api/keys');
    if (status === 401) {
        $('app').hidden = true;
        $('signin').hidden = false;
        return;
    }
    if (status === 404) {
        $('app').hidden = true;
        showMessage('The external API is disabled. Set VRCX_API_ENABLED=1 on the server and restart it.', true);
        return;
    }
    $('signin').hidden = true;
    $('app').hidden = false;
    renderScopes(body.scopes);
    renderKeys(body.keys);
}

async function revokeKey(id) {
    const { status } = await api('/api/keys/' + encodeURIComponent(id), { method: 'DELETE' });
    showMessage(status === 200 ? 'Key revoked.' : 'Could not revoke that key.', status !== 200);
    load();
}

$('create').addEventListener('submit', async (event) => {
    event.preventDefault();
    const scopes = [...document.querySelectorAll('#scopes input:checked')].map((i) => i.value);
    const days = Number($('expiry').value);
    const { status, body } = await api('/api/keys', {
        method: 'POST',
        body: JSON.stringify({
            name: $('name').value,
            scopes,
            expiresAt: days ? new Date(Date.now() + days * 864e5).toISOString() : null
        })
    });
    if (status !== 201) {
        showMessage(body.error || 'Could not create the key.', true);
        return;
    }
    showMessage('', false);
    $('newKey').textContent = body.key;
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
@media (prefers-color-scheme: dark) { :root { --bg:#0f1317; --fg:#e6e9ec; --muted:#9aa5b1; --line:#2b333b; --card:#171c21; --accent:#7aa2ff; --danger:#ff8a80; --ok:#56d364; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 system-ui,sans-serif; }
main { max-width: 960px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 28px 0 10px; }
p.lead { color: var(--muted); margin: 0 0 16px; }
section, .card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 16px; }
label.field { display:block; margin-bottom: 12px; } label.field > span { display:block; font-weight:600; margin-bottom:4px; }
input[type=text], select { width:100%; padding:8px 10px; border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--fg); font:inherit; }
.scope { display:flex; gap:8px; align-items:flex-start; margin: 6px 0; }
code { font: 13px ui-monospace,monospace; background: var(--bg); border:1px solid var(--line); border-radius:4px; padding:1px 5px; }
button { font:inherit; padding:8px 14px; border-radius:6px; border:1px solid var(--line); background:var(--bg); color:var(--fg); cursor:pointer; }
button.primary { background:var(--accent); border-color:var(--accent); color:#fff; font-weight:600; }
button.danger { color:var(--danger); border-color:var(--danger); }
button:focus-visible, input:focus-visible, select:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.message { padding:10px 12px; border-radius:6px; border:1px solid var(--ok); margin:12px 0; }
.message.error { border-color: var(--danger); color: var(--danger); }
#newKey { display:block; word-break:break-all; padding:10px; margin:8px 0; user-select:all; }
.table-wrap { overflow-x:auto; } table { border-collapse:collapse; width:100%; min-width:720px; }
th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top; } th { color:var(--muted); font-weight:600; font-size:13px; }
[hidden] { display:none !important; }
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
  <strong>Not signed in.</strong> Open the <a href="/">web client</a>, sign in with your authenticator code, then reload this page.
</div>
<div id="app" hidden>
  <div id="reveal" class="card" hidden role="alert">
    <strong>Copy your new key now — it is shown only once.</strong>
    <code id="newKey"></code>
    <button id="copy" type="button">Copy</button>
    <button id="dismiss" type="button">I have saved it</button>
  </div>
  <h2>Create a key</h2>
  <section>
    <form id="create">
      <label class="field"><span>Name</span><input id="name" type="text" maxlength="100" required placeholder="e.g. stream overlay"></label>
      <fieldset style="border:0;padding:0;margin:0 0 12px"><legend style="font-weight:600;margin-bottom:4px">Scopes</legend><div id="scopes"></div></fieldset>
      <label class="field"><span>Expires</span>
        <select id="expiry"><option value="0">Never</option><option value="30">In 30 days</option><option value="90">In 90 days</option><option value="365">In 1 year</option></select></label>
      <button class="primary" type="submit">Create key</button>
    </form>
  </section>
  <h2>Existing keys</h2>
  <div class="table-wrap"><table>
    <thead><tr><th>Name</th><th>ID</th><th>Scopes</th><th>Created</th><th>Expires</th><th>Last used</th><th></th></tr></thead>
    <tbody id="keys"></tbody>
  </table></div>
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
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy':
            `default-src 'none'; script-src 'sha256-${scriptHash}'; ` +
            `style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; ` +
            `form-action 'none'; frame-ancestors 'none'`
    }
};
