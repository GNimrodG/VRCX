import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// src-electron/windowsUpdateScript.js is CommonJS and shared with the Electron main process
const require = createRequire(import.meta.url);
const { buildWindowsUpdateScript, DEFAULT_TIMINGS } = require('../../src-electron/windowsUpdateScript.js');

const baseOptions = {
    pid: 4242,
    exeName: 'VRCX Headless.exe',
    execPath: 'C:\\Users\\me\\AppData\\Local\\Programs\\VRCX Headless\\VRCX Headless.exe',
    updateExePath: 'C:\\Users\\me\\AppData\\Roaming\\VRCX\\update.exe',
    logPath: 'C:\\Users\\me\\AppData\\Roaming\\VRCX\\apply-update.log'
};

describe('buildWindowsUpdateScript (text)', () => {
    const script = buildWindowsUpdateScript(baseOptions);

    it('uses CRLF line endings, which wscript requires', () => {
        expect(script).toContain('\r\n');
        expect(script.replace(/\r\n/g, '')).not.toContain('\n');
    });

    it('keeps the WMI moniker backslashes intact (regression: winmgmts:\\.ootcimv2)', () => {
        expect(script).toContain('GetObject("winmgmts:\\\\.\\root\\cimv2")');
    });

    it('waits for the old process by PID and image name, so a recycled PID is not taken for it', () => {
        expect(script).toContain(`Running("ProcessId = 4242 And Name = 'VRCX Headless.exe'")`);
        expect(script).not.toMatch(/Running\("ProcessId = 4242"\)/);
    });

    it('quotes paths for sh.Run and the log/delete calls', () => {
        expect(script).toContain(`sh.Run("""${baseOptions.updateExePath}""", 1, True)`);
        expect(script).toContain(`sh.Run """${baseOptions.execPath}""", 1, False`);
        expect(script).toContain(`fso.DeleteFile "${baseOptions.updateExePath}", True`);
        expect(script).toContain(`fso.OpenTextFile("${baseOptions.logPath}", 8, True)`);
    });

    it('backslash-escapes apostrophes in WQL image names', () => {
        const odd = buildWindowsUpdateScript({ ...baseOptions, exeName: "Fox's VRCX.exe" });
        expect(odd).toContain("Name = 'Fox\\'s VRCX.exe'");
    });

    it('ignores the installer exit code (the NSIS installer does not reliably return 0)', () => {
        expect(script).toContain('Log "installer exit code " & i');
        expect(script).not.toMatch(/If i (=|<>|>)/);
    });

    it('deletes update.exe before relaunching, or the next start re-runs the installer', () => {
        expect(script.indexOf('fso.DeleteFile')).toBeGreaterThan(script.indexOf('Log "installer processes gone"'));
        expect(script.indexOf('fso.DeleteFile')).toBeLessThan(script.indexOf('relaunch attempt'));
    });

    it('applies the default timings, and lets tests shorten them', () => {
        expect(script).toContain(`For i = 1 To ${DEFAULT_TIMINGS.oldExitPolls}`);
        expect(script).toContain(`WScript.Sleep ${DEFAULT_TIMINGS.relaunchWaitMs}`);
        const fast = buildWindowsUpdateScript({ ...baseOptions, timings: { pollMs: 50, relaunchAttempts: 2 } });
        expect(fast).toContain('WScript.Sleep 50');
        expect(fast).toContain('For attempt = 1 To 2');
    });
});

// ---------------------------------------------------------------------------------------------------------
// Runs the generated script with wscript.exe against dummy executables. Windows only (wscript, WMI, csc.exe).
// ---------------------------------------------------------------------------------------------------------

const CSC = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
const canRunReal = process.platform === 'win32' && fs.existsSync(CSC);

// One program, many names. Behaviour comes from `<exe>.cfg` ("sleep=<ms>", "exit=<code>"); every start
// appends a line to `<exe>.ran`, so a test can count how often the script launched it.
const DUMMY_SOURCE = `
using System; using System.IO; using System.Reflection; using System.Threading;
class P {
    static int Main() {
        string exe = Assembly.GetEntryAssembly().Location;
        File.AppendAllText(exe + ".ran", DateTime.Now.ToString("o") + "\\n");
        int sleep = 0, code = 0;
        if (File.Exists(exe + ".cfg")) {
            foreach (string line in File.ReadAllLines(exe + ".cfg")) {
                string[] kv = line.Split('=');
                if (kv[0] == "sleep") sleep = int.Parse(kv[1]);
                if (kv[0] == "exit") code = int.Parse(kv[1]);
            }
        }
        Thread.Sleep(sleep);
        return code;
    }
}`;

const FAST = {
    pollMs: 200,
    killWaitMs: 300,
    oldExitPolls: 10,
    installerPolls: 25,
    relaunchWaitMs: 1500,
    relaunchAttempts: 3
};

describe.skipIf(!canRunReal)('apply-update.vbs against dummy executables (Windows)', { timeout: 60_000 }, () => {
    let root;
    let dummyExe;
    const spawnedNames = new Set();
    const spawnedPids = [];

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'vrcx-update-test-'));
        const src = path.join(root, 'dummy.cs');
        dummyExe = path.join(root, 'dummy.exe');
        fs.writeFileSync(src, DUMMY_SOURCE);
        execFileSync(CSC, ['/nologo', '/target:winexe', `/out:${dummyExe}`, src], { stdio: 'pipe' });
        // The describe-level timeout covers tests only; hooks have their own 10s default, which a cold
        // CI runner's first csc run exceeds (v5 vitest, 2026-11-23).
    }, 120_000);

    afterEach(() => {
        for (const pid of spawnedPids.splice(0)) {
            try {
                process.kill(pid);
            } catch {
                // already gone
            }
        }
        for (const name of spawnedNames) {
            try {
                execFileSync('taskkill', ['/F', '/IM', name], { stdio: 'ignore', windowsHide: true });
            } catch {
                // none running
            }
        }
        spawnedNames.clear();
    });

    afterAll(() => {
        if (root) {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    /** A dummy exe under `dir` named `name`, configured by `cfg`. */
    function makeExe(dir, name, cfg = {}) {
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, name);
        fs.copyFileSync(dummyExe, file);
        fs.writeFileSync(
            `${file}.cfg`,
            Object.entries(cfg)
                .map(([k, v]) => `${k}=${v}`)
                .join('\n')
        );
        spawnedNames.add(name);
        return file;
    }

    // Resolves once the process has really started (it has written its `.ran` line and read its `.cfg`).
    async function start(file) {
        const before = runs(file);
        const child = spawn(file, [], { detached: true, stdio: 'ignore', windowsHide: true });
        child.unref();
        spawnedPids.push(child.pid);
        for (let i = 0; i < 200 && runs(file) === before; i++) {
            await new Promise((r) => setTimeout(r, 50));
        }
        expect(runs(file)).toBe(before + 1);
        return child.pid;
    }

    const alive = (pid) => {
        try {
            process.kill(pid, 0);
            return true;
        } catch {
            return false;
        }
    };

    const runs = (file) =>
        fs.existsSync(`${file}.ran`) ? fs.readFileSync(`${file}.ran`, 'utf8').trim().split('\n').length : 0;

    function runScript(scriptOptions) {
        const scriptPath = path.join(scriptOptions.dir, 'apply-update.vbs');
        const logPath = path.join(scriptOptions.dir, 'apply-update.log');
        fs.writeFileSync(
            scriptPath,
            buildWindowsUpdateScript({ ...scriptOptions, logPath, timings: { ...FAST, ...scriptOptions.timings } })
        );
        return new Promise((resolve, reject) => {
            const child = spawn('wscript.exe', ['//B', '//Nologo', scriptPath], { stdio: 'ignore', windowsHide: true });
            const readLog = () => (fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '');
            const timer = setTimeout(() => {
                child.kill();
                reject(new Error(`wscript did not finish; log:\n${readLog()}`));
            }, 60_000);
            child.on('exit', () => {
                clearTimeout(timer);
                resolve(readLog());
            });
        });
    }

    const lines = (log) =>
        log
            .split(/\r?\n/)
            .filter(Boolean)
            .map((l) => l.replace(/^\[[^\]]*\] /, ''));

    async function setup(appName, { oldCfg = { sleep: 1500 }, installerCfg = {} } = {}) {
        // Directory name has a space and an apostrophe, like a real "C:\Users\Some User's Name" path.
        const base = path.join(root, `case ${Math.random().toString(36).slice(2, 8)}'s dir`);
        const app = makeExe(path.join(base, 'app'), appName, oldCfg);
        const updateExe = makeExe(base, 'update.exe', installerCfg);
        const oldPid = await start(app);
        // The relaunched app should stay up, unlike the old one that is meant to exit.
        fs.writeFileSync(`${app}.cfg`, 'sleep=30000');
        fs.rmSync(`${app}.ran`);
        return { base, app, updateExe, oldPid, appName };
    }

    const opts = (c) => ({
        dir: c.base,
        pid: c.oldPid,
        exeName: c.appName,
        execPath: c.app,
        updateExePath: c.updateExe
    });

    it('waits for the old app, runs the installer, removes update.exe and relaunches once', async () => {
        const c = await setup("VRCX Dummy 'one'.exe");
        const log = lines(await runScript(opts(c)));

        expect(log).toEqual([
            `scheduled, waiting for old process ${c.oldPid} to exit`,
            'running installer',
            'installer exit code 0',
            'installer processes gone',
            'removed update.exe',
            'relaunch attempt 1',
            'app is running'
        ]);
        expect(runs(c.updateExe)).toBe(1);
        expect(fs.existsSync(c.updateExe)).toBe(false);
        expect(runs(c.app)).toBe(1);
        expect(alive(c.oldPid)).toBe(false);
    });

    it('still relaunches when the installer returns a non-zero exit code', async () => {
        const c = await setup('vrcx-dummy-two.exe', { installerCfg: { exit: 1 } });
        const log = lines(await runScript(opts(c)));

        expect(log).toContain('installer exit code 1');
        expect(log).toContain('relaunch attempt 1');
        expect(runs(c.app)).toBe(1);
    });

    it('waits for a slow installer before deleting it and relaunching', async () => {
        const c = await setup('vrcx-dummy-three.exe', { installerCfg: { sleep: 1200 } });
        const startedAt = Date.now();
        const log = lines(await runScript(opts(c)));

        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1200);
        expect(log.indexOf('installer processes gone')).toBeLessThan(log.indexOf('relaunch attempt 1'));
        expect(fs.existsSync(c.updateExe)).toBe(false);
        expect(runs(c.app)).toBe(1);
    });

    it('kills an old app that never exits, then carries on', async () => {
        const c = await setup('vrcx-dummy-four.exe', { oldCfg: { sleep: 60000 } });
        const log = lines(await runScript(opts(c)));

        expect(log[1]).toMatch(/^old process still alive after \d+ checks, killing it$/);
        expect(alive(c.oldPid)).toBe(false);
        expect(log).toContain('running installer');
        expect(runs(c.app)).toBe(1);
    });

    it('does not wait for, or kill, an unrelated process that took over the old PID', async () => {
        const c = await setup('vrcx-dummy-five.exe', { oldCfg: { sleep: 100 } });
        // The old app is gone; some other program now holds its PID. Simulated by pointing the script at a
        // live process with a different image name.
        const stranger = makeExe(path.join(c.base, 'stranger'), 'vrcx-dummy-stranger.exe', { sleep: 60000 });
        const strangerPid = await start(stranger);

        const startedAt = Date.now();
        const log = lines(await runScript({ ...opts(c), pid: strangerPid }));

        expect(log.join('\n')).not.toContain('killing it');
        expect(Date.now() - startedAt).toBeLessThan(FAST.oldExitPolls * FAST.pollMs + 5000);
        expect(alive(strangerPid)).toBe(true);
        expect(log).toContain('running installer');
        expect(runs(c.app)).toBe(1);
    });

    it('does not launch a second copy when the installer already started the app', async () => {
        const c = await setup('vrcx-dummy-six.exe', { oldCfg: { sleep: 100 } });
        // Stands in for the installer's own "run after finish".
        const already = await start(c.app);
        const log = lines(await runScript(opts(c)));

        expect(log).toContain('app is running');
        expect(log.join('\n')).not.toContain('relaunch attempt');
        expect(runs(c.app)).toBe(1);
        expect(alive(already)).toBe(true);
    });

    it('retries the relaunch when the app dies right after starting, and gives up after the last attempt', async () => {
        const c = await setup('vrcx-dummy-seven.exe', { oldCfg: { sleep: 100 } });
        fs.writeFileSync(`${c.app}.cfg`, 'sleep=0');
        const log = lines(await runScript({ ...opts(c), timings: { relaunchWaitMs: 600 } }));

        expect(log.filter((l) => l.startsWith('relaunch attempt'))).toEqual([
            'relaunch attempt 1',
            'relaunch attempt 2',
            'relaunch attempt 3'
        ]);
        expect(runs(c.app)).toBe(3);
    });

    it('proceeds when the installer removed update.exe itself', async () => {
        const c = await setup('vrcx-dummy-eight.exe', { oldCfg: { sleep: 100 } });
        fs.rmSync(c.updateExe);
        const log = lines(await runScript(opts(c)));

        // sh.Run on a missing file fails; the script must still reach the relaunch step.
        expect(log.some((l) => l.startsWith('installer failed to start'))).toBe(true);
        expect(log).toContain('removed update.exe');
        expect(runs(c.app)).toBe(1);
    });
});
