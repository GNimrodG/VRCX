// Fork-only. CI guard for server/test/windows-update-script.test.js: the wscript half is skipped when it can't run
// (non-Windows, no csc.exe), and a skipped test is a green run. On the Windows CI leg that must be a failure.
import fs from 'node:fs';

const MIN_TESTS = 8;
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const real = report.testResults
    .flatMap((file) => file.assertionResults)
    .filter((test) => test.fullName.includes('dummy executables'));
const notPassed = real.filter((test) => test.status !== 'passed');

if (real.length < MIN_TESTS || notPassed.length > 0) {
    console.error(
        `Expected at least ${MIN_TESTS} passing real-wscript tests, got ${real.length} (not passed: ${notPassed.map((t) => `${t.title}=${t.status}`).join(', ') || 'none'})`
    );
    process.exit(1);
}
console.log(`${real.length} real-wscript update tests passed`);
