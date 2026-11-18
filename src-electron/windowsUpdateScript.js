// Fork-only (CLAUDE.md §5). Builds the `apply-update.vbs` that `scheduleWindowsInstallAfterUpdate()` (main.js)
// hands the install-then-relaunch chain to. Kept out of main.js so `server/test/windows-update-script.test.js`
// can run the real script against dummy executables.
//
// A VBScript run by wscript.exe instead of a .bat: it has no console window at all, and it checks processes
// through WMI. The previous batch used `tasklist | find` and `timeout`, which hang or abort when cmd.exe is
// launched detached without a console (the update stuck at "waiting for old process"). It can't be an
// Electron-as-Node helper either: the installer has to replace this very exe while the helper runs.

const DEFAULT_TIMINGS = Object.freeze({
    // Wait for the old process: `oldExitPolls` checks, `pollMs` apart, then kill it.
    oldExitPolls: 30,
    pollMs: 1000,
    killWaitMs: 2000,
    // Wait for update.exe / Uninstall* to be really gone after the installer returns.
    installerPolls: 120,
    // After starting the app, wait this long before checking it is running; up to `relaunchAttempts` times.
    relaunchWaitMs: 15000,
    relaunchAttempts: 3
});

/** VBScript string literal. */
const q = (value) => `"${String(value).replace(/"/g, '""')}"`;

/** Body of a single-quoted WQL string literal: WQL escapes with a backslash (`''` is not an escape there). */
const wql = (value) => String(value).replace(/[\\']/g, '\\$&');

/**
 * @param {object} options
 * @param {number} options.pid PID of the old (exiting) app process
 * @param {string} options.exeName Image name of the app, e.g. `VRCX Headless.exe`
 * @param {string} options.execPath Full path of the app exe to relaunch
 * @param {string} options.updateExePath Full path of the downloaded installer
 * @param {string} options.logPath `apply-update.log`
 * @param {Partial<typeof DEFAULT_TIMINGS>} [options.timings] Overridable so tests don't wait minutes
 * @returns {string} The script text, CRLF line endings
 */
function buildWindowsUpdateScript({ pid, exeName, execPath, updateExePath, logPath, timings }) {
    const t = { ...DEFAULT_TIMINGS, ...timings };
    // Matching the name as well as the PID: Windows recycles PIDs, so once the old app is gone an unrelated
    // process can hold `pid`. A PID-only check would then wait out the full timeout and `taskkill` that process.
    const oldRunning = `Running("ProcessId = ${pid} And Name = '${wql(exeName)}'")`;
    const lines = [
        'Option Explicit',
        'Dim sh, fso, wmi, i, attempt',
        'Set sh = CreateObject("WScript.Shell")',
        'Set fso = CreateObject("Scripting.FileSystemObject")',
        // Backslashes doubled: in a plain JS string `\r` is a carriage return and `\c` is just `c`,
        // which silently produced `winmgmts:\.ootcimv2` and made wscript die before it logged.
        'Set wmi = GetObject("winmgmts:\\\\.\\root\\cimv2")',
        'Sub Log(text)',
        '  Dim f',
        `  Set f = fso.OpenTextFile(${q(logPath)}, 8, True)`,
        '  f.WriteLine "[" & Now & "] " & text',
        '  f.Close',
        'End Sub',
        'Function Running(clause)',
        '  Running = (wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE " & clause).Count > 0)',
        'End Function',
        `Log "scheduled, waiting for old process ${pid} to exit"`,
        // A fixed short wait raced a slow-exiting old process: the installer then stalled on its
        // "app is running" check, and the relaunch bounced off the old single-instance lock.
        `For i = 1 To ${t.oldExitPolls}`,
        `  If Not ${oldRunning} Then Exit For`,
        `  WScript.Sleep ${t.pollMs}`,
        'Next',
        `If ${oldRunning} Then`,
        `  Log "old process still alive after ${t.oldExitPolls} checks, killing it"`,
        `  sh.Run "taskkill /F /T /PID ${pid}", 0, True`,
        `  WScript.Sleep ${t.killWaitMs}`,
        'End If',
        'Log "running installer"',
        // A missing/unstartable installer must not end the script: the app still has to come back.
        'i = -1',
        'On Error Resume Next',
        `i = sh.Run(${q(q(updateExePath))}, 1, True)`,
        'If Err.Number <> 0 Then Log "installer failed to start: " & Err.Description',
        'On Error GoTo 0',
        'Log "installer exit code " & i',
        // The NSIS installer can hand its work to a child and return early, which made the
        // relaunch start a half-replaced app. Wait until the installer is really done.
        `For i = 1 To ${t.installerPolls}`,
        '  If Not (Running("Name = \'update.exe\'") Or Running("Name LIKE \'Uninstall%\'")) Then Exit For',
        `  WScript.Sleep ${t.pollMs}`,
        'Next',
        'Log "installer processes gone"',
        // The installer runs from update.exe in place, so nothing else removes it.
        // Left behind, the relaunched app's Update.Check() (Dotnet/Program.cs Init)
        // moves it to VRCX_Setup.exe and re-runs the installer, then Environment.Exit(0)s
        // before the app ever opens: the "installer ran twice, app never launched" bug.
        'On Error Resume Next',
        `fso.DeleteFile ${q(updateExePath)}, True`,
        'On Error GoTo 0',
        'Log "removed update.exe"',
        // The installer's own "run after finish" may already have started the app, so only
        // launch it when nothing is running; then check again, up to `relaunchAttempts` times.
        `For attempt = 1 To ${t.relaunchAttempts}`,
        `  If Running("Name = '${wql(exeName)}'") Then`,
        '    Log "app is running"',
        '    Exit For',
        '  End If',
        '  Log "relaunch attempt " & attempt',
        `  sh.Run ${q(q(execPath))}, 1, False`,
        `  WScript.Sleep ${t.relaunchWaitMs}`,
        'Next'
    ];
    return lines.join('\r\n');
}

module.exports = { buildWindowsUpdateScript, DEFAULT_TIMINGS };
