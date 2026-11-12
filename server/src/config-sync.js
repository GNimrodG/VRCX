/**
 * Settings sync between clients. A write to the shared config store
 * (`/api/rpc`, `config` target) is relayed on `/api/stream` to every *other*
 * connected client, so a second browser tab or desktop app sees that settings
 * changed. The writer is identified by the `X-Vrcx-Client` header on the RPC
 * call and the `?client=` query on its stream socket; both carry the same
 * per-instance id the client generated, so the writer is skipped.
 *
 * Only writes that went through `/api/rpc` are relayed. The device-local keys
 * never reach the server (see the client config shims), and the server's own
 * writes are not settings changes.
 */

export const CONFIG_CHANGED_TYPE = 'vrcx-headless-config-changed';

const WRITE_METHODS = new Set(['setString', 'setBool', 'setInt', 'setFloat', 'setObject', 'setArray', 'remove']);

/** Past this size the value is left out and clients re-read the key instead. */
const MAX_INLINE_VALUE_BYTES = 64 * 1024;

/**
 * @param {unknown} value A raw header or query value
 * @returns {string | null} The client id, or null if absent or malformed
 */
export function normalizeClientId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value) ? value : null;
}

/**
 * @param {{ target?: unknown; method?: unknown; args?: unknown } | null | undefined} request A _successful_ RPC request
 * @returns {string | null} The frame to broadcast, or null when the call was not a config write
 */
export function configChangeFrame(request) {
    if (request?.target !== 'config' || typeof request.method !== 'string' || !WRITE_METHODS.has(request.method)) {
        return null;
    }
    const [key, value] = Array.isArray(request.args) ? request.args : [];
    if (typeof key !== 'string') {
        return null;
    }
    const frame = { type: CONFIG_CHANGED_TYPE, key, method: request.method };
    if (request.method !== 'remove') {
        const serialized = JSON.stringify(value ?? null);
        if (Buffer.byteLength(serialized) <= MAX_INLINE_VALUE_BYTES) {
            frame.value = value ?? null;
        }
    }
    return JSON.stringify(frame);
}
