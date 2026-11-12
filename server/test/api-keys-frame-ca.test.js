/**
 * `src-electron/customCaTrust.js`: Chromium accepting the imported CA for the
 * connected server only. The certificates are throwaway fixtures (100-year
 * validity, no private keys kept).
 */
import { describe, expect, it } from 'vitest';

import { isTrustedByCustomCa, verifyWithCustomCa } from '../../src-electron/customCaTrust.js';

const CA =
    '-----BEGIN CERTIFICATE-----\nMIIDBzCCAe+gAwIBAgIUIOSMyYrCVVAEyBtCCCvxLg+dZrowDQYJKoZIhvcNAQEL\nBQAwEjEQMA4GA1UEAwwHVGVzdCBDQTAgFw0yNjExMDUxNjIwMTNaGA8yMTI2MTAx\nMjE2MjAxM1owEjEQMA4GA1UEAwwHVGVzdCBDQTCCASIwDQYJKoZIhvcNAQEBBQAD\nggEPADCCAQoCggEBALZwprKZZBa6FK/0QIE/tSdwKw6sWR7EFBRW75YoaNVeoR3+\nOlmZAlDckGWS+cqmJZrYjrw+SiDwCa4ErF6PMFV9tTQ87CLWN//1vqp6gozvDJ/q\n7GWYUwo92jZVlRMDQdf+i1ivU2rNK/of+34UL1A41zXtW0MVT023Y3FREqnOiKGQ\nbu3ZuUHAr3qsNHTk7wKSyYYA08Bx0nlDGjV9yPh1Gs7VhhgHggKirHA6ypjfaVU9\nqC/SoZdY2hkdrSVgbxGqJK2Eo+xSsEj3kwsQ+y7SeYRANDagf1k2zSLbB5dOvBss\nICYyExeFV0D5GwwdLha6F7SyKfgX93HSjPNWEOcCAwEAAaNTMFEwHQYDVR0OBBYE\nFI9leu7hmAJBWpvD9zbMuLeb4XOoMB8GA1UdIwQYMBaAFI9leu7hmAJBWpvD9zbM\nuLeb4XOoMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAHCRey/F\nJ/50dzV54wFqSkagT/9OgysFc+TukqAyCmawh/DO5oPr7xWX3mGogIsYjfWrDQZ1\nLh6qv6cKc4EU0I2sAkdSDcgF6ajqPQfpew/2vt74eJDf7JyOe1SiZX5xAw81feje\nk895DaIXQDO6k7GaNh53yNsRxcvtMXYRjE/BL9mxA8PADDA5dvVeV0A0tHGb7yE6\n9MKSaF4hpkQjx5BnP1Tqe+7SaLW/Cg574x2VS2ggSMI5DkO82EJpW2ZH6P7fK2N4\nw2tbUtIPUJSzLOqvlPeKiFBjPOFxrIE6QHb9iFs9ETjjxTtcaAy7w6FZhG/2kwR3\nz/euiuBCIX/8b/0=\n-----END CERTIFICATE-----\n';
const LEAF =
    '-----BEGIN CERTIFICATE-----\nMIIDDjCCAfagAwIBAgIUT8k1ao22k+m5cS20+RYqEc2x7bYwDQYJKoZIhvcNAQEL\nBQAwEjEQMA4GA1UEAwwHVGVzdCBDQTAgFw0yNjExMDUxNjIwMTNaGA8yMTI2MTAx\nMjE2MjAxM1owFDESMBAGA1UEAwwJdnJjeC50ZXN0MIIBIjANBgkqhkiG9w0BAQEF\nAAOCAQ8AMIIBCgKCAQEAuArL1oIps2XTfL0cAexbdEy8DbeOYVIeo89T48BDlYVp\n76pxBI6GpwDycW3TLmn60kJYFEQo4GxJE1cft0/p4C85cqHT9TG9UjzZHJLoY8Zp\n8IU8EVvnPIL07fWuglP61t4j7buK9htiWIYInUXlZm8pZ1sZjgodzY0fJAvPcHhn\nnOOzA0U/z3uVCKklabFvjvGHD04NTAWPV/u5HT0SmBuPiR0jtuQpr+NijGdN+VtX\n90xgRMs5Yq87Q7cJ28nKdVXZ+zxYeewKOzbKF3RPb+NovlkUfQ+VVJaHtvNT62Po\nWJs1BD2StIimdcz8tZS2b+7OundO4g75+BLSBsQTMwIDAQABo1gwVjAUBgNVHREE\nDTALggl2cmN4LnRlc3QwHQYDVR0OBBYEFA9OWzIPaSk2lFzJWsyP+APlJJgtMB8G\nA1UdIwQYMBaAFI9leu7hmAJBWpvD9zbMuLeb4XOoMA0GCSqGSIb3DQEBCwUAA4IB\nAQBhPjJq+AYIGwPMC210WNXtZRve+00yx2K6clBT7JCOUuY7ppQMRt98Wb3jSu/8\nVlTjJND+lhel9IasXJ0+cODP7Ary5KspYGT4kKz/kpvBhIgM3PlY4BEUlVoTHxvD\n4JoKPQinmV9T95LeR4MtfZqkbzfPlWEvOIZEZosSVT1LFsetKxTa0CKFsg0+c7cS\nFifB3WaDxJjvIww7kIDbDVHJP4MJnEa65BYNPFgxW9X7ENBI7P6l+jXTrpHlYJf8\nkm2UybZKRP7vYloQ94zDplknlPf9s4jSg06c8Jcfc0l75ZyrJNeO2fqhpWERZVNx\nGLtkDpIfN2NU/IYFLr7Wf31l\n-----END CERTIFICATE-----\n';
const OTHER_CA =
    '-----BEGIN CERTIFICATE-----\nMIIDCTCCAfGgAwIBAgIUVbiKBC8hbsvd9EpBqwJoFQ4bqCMwDQYJKoZIhvcNAQEL\nBQAwEzERMA8GA1UEAwwIT3RoZXIgQ0EwIBcNMjYxMTA1MTYyMDE0WhgPMjEyNjEw\nMTIxNjIwMTRaMBMxETAPBgNVBAMMCE90aGVyIENBMIIBIjANBgkqhkiG9w0BAQEF\nAAOCAQ8AMIIBCgKCAQEAnfea780c0Gn5Z2x/tbhxbAX87ZwrIR6daY+0k7uvQT2C\nhPAktxfMp9qynrkjY1SjfkUv5K+yhGjD/Xhb95elVCiKSAhK54nrsZkSyg5YDM39\np3+nDMyhmQ7NnwxdvWdTBWfd5ovq713eGhADv/AWMPvz4gHle79pgB9u+T1bI/GR\naQP4Ll5CRRjdgHQNeAB6vco0j4O8uhedYIVqITEFe0YUCKwgk4whZ7ZbRvPc9MLY\nsMEIcOOHtCqYlBD33gRcTO2d4gTE9CAG4OLUE/gSoCk+ZRMPgvVVyBS7Fte4VwJJ\nHlZCf7+9ZmHFbbCkXKHH916JdH3GJObhHoioYp+HiwIDAQABo1MwUTAdBgNVHQ4E\nFgQUQBmIHciWO99y7g/Zoprb9+rhxY8wHwYDVR0jBBgwFoAUQBmIHciWO99y7g/Z\noprb9+rhxY8wDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAYEXr\nvyXtTLwYNSIUY3nnrlE8bRSP8hjYT+lrUpKpYZUDdXgTsTPbdwaZzJciIyQBhz+i\nVRBQRm3ySxe6q+H2V/4JKkMhTZvCY8LPyc4F4PmykzRfXvqq+R7ejDCsNjair9l+\nay8VqD9XZLYsEZaDZrngA6LYBucGhE3nOkPp3IKOD8vRbnKVvYdgZ4SUvuE+O8Mn\nNQbsl5UJBMF9JCl4iN+tuCf4BZ4qPwtXCGttRujZXuAJvi0aMiGDbfje7w2eiYWn\nXQBCX80NDYWMWdC24c2HlLp1jrla0mIm+FI9MtahKV/Wz67dvFn+8w44oHRx1oG6\n9orCh9q+VXDzQbJkIg==\n-----END CERTIFICATE-----\n';

const request = (overrides = {}) => ({
    hostname: 'vrcx.test',
    verificationResult: 'net::ERR_CERT_AUTHORITY_INVALID',
    certificate: { data: LEAF },
    ...overrides
});

describe('isTrustedByCustomCa', () => {
    it('accepts a certificate signed by the imported CA for its own host', () => {
        expect(isTrustedByCustomCa({ data: LEAF }, 'vrcx.test', CA)).toBe(true);
    });
    it('accepts it when the chain includes the CA', () => {
        expect(isTrustedByCustomCa({ data: LEAF, issuerCert: { data: CA } }, 'vrcx.test', OTHER_CA + CA)).toBe(true);
    });
    it('rejects a different CA, a different host, or no CA', () => {
        expect(isTrustedByCustomCa({ data: LEAF }, 'vrcx.test', OTHER_CA)).toBe(false);
        expect(isTrustedByCustomCa({ data: LEAF }, 'evil.test', CA)).toBe(false);
        expect(isTrustedByCustomCa({ data: LEAF }, 'vrcx.test', '')).toBe(false);
        expect(isTrustedByCustomCa({ data: 'garbage' }, 'vrcx.test', CA)).toBe(false);
    });
});

describe('verifyWithCustomCa', () => {
    const ca = () => CA;
    it('accepts only the connected server', () => {
        expect(verifyWithCustomCa(request(), 'https://vrcx.test', ca)).toBe(0);
        expect(verifyWithCustomCa(request(), 'https://other.test', ca)).toBe(-3);
        expect(verifyWithCustomCa(request(), null, ca)).toBe(-3);
    });
    it('defers to Chromium when it already trusts the certificate or no CA was imported', () => {
        expect(verifyWithCustomCa(request({ verificationResult: 'net::OK' }), 'https://vrcx.test', ca)).toBe(-3);
        expect(verifyWithCustomCa(request(), 'https://vrcx.test', () => null)).toBe(-3);
    });
});
