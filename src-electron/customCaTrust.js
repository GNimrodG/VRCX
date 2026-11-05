/**
 * Lets Chromium (not just Node) trust the CA the user imported for a
 * self-signed headless server.
 *
 * `custom-ca.pem` reaches Node through `NODE_EXTRA_CA_CERTS`, which covers the
 * main process's own requests (RPC, the agent socket). It does nothing for
 * pages Chromium loads itself, such as the "Manage API keys" iframe, which then
 * fails with a certificate error and shows up as an empty frame.
 *
 * The check is narrow on purpose: only the host of the server the app is
 * connected to, only when Chromium's own verdict failed, and only if the chain
 * really is signed by the imported CA and the certificate names that host.
 *
 * Kept free of Electron imports so it can be unit-tested.
 */
const crypto = require('crypto');

/**
 * @param {{ data: string; issuerCert?: any }} certificate An Electron Certificate (leaf first, then `issuerCert`s)
 * @param {string} hostname
 * @param {string} caPem The imported CA bundle (one or more PEM certificates)
 * @returns {boolean}
 */
function isTrustedByCustomCa(certificate, hostname, caPem) {
    try {
        const cas = (caPem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []).map(
            (pem) => new crypto.X509Certificate(pem)
        );
        if (cas.length === 0) {
            return false;
        }
        const leaf = new crypto.X509Certificate(certificate.data);
        if (!leaf.checkHost(hostname)) {
            return false;
        }
        const now = Date.now();
        const chain = [];
        for (let c = certificate; c && chain.length < 8; c = c.issuerCert) {
            chain.push(new crypto.X509Certificate(c.data));
        }
        return chain.some(
            (cert) =>
                Date.parse(cert.validFrom) <= now &&
                now <= Date.parse(cert.validTo) &&
                cas.some(
                    (ca) =>
                        cert.fingerprint256 === ca.fingerprint256 || (cert.checkIssued(ca) && cert.verify(ca.publicKey))
                )
        );
    } catch {
        return false;
    }
}

/**
 * @param {{ hostname: string; verificationResult: string; certificate: any }} request
 * @param {string | null} serverUrl
 * @param {() => string | null} readCaPem
 * @returns {number} Electron verify-proc result: 0 accept, -3 use Chromium's verdict
 */
function verifyWithCustomCa(request, serverUrl, readCaPem) {
    if (request.verificationResult === 'net::OK' || !serverUrl) {
        return -3;
    }
    try {
        if (request.hostname !== new URL(serverUrl).hostname) {
            return -3;
        }
        const caPem = readCaPem();
        return caPem && isTrustedByCustomCa(request.certificate, request.hostname, caPem) ? 0 : -3;
    } catch {
        return -3;
    }
}

module.exports = { isTrustedByCustomCa, verifyWithCustomCa };
