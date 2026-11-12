using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;

namespace VRCX
{
    /// <summary>
    /// Fork-only (CLAUDE.md §5): native Windows implementations for the Electron client's AppApi.
    /// The upstream-owned Electron methods (`Folders.cs`, `RegistryPlayerPrefs.cs`, `AppApiElectron.cs`)
    /// were written around Linux and Wine (`reg` via a Wine prefix, `xclip`, Linux file managers), so each
    /// of them dispatches here first when `OperatingSystem.IsWindows()`. Keeping the bodies in this file
    /// means an upstream edit to those methods conflicts on one added line, not on a rewritten method.
    /// The registry code is the CefSharp client's `AppApiCef` implementation (deleted 2026-11-06),
    /// restored against the real registry instead of Wine.
    /// </summary>
    public partial class AppApiElectron
    {
        // ---- Registry (logic in WindowsRegistry.cs) -------------------------------------------

        private readonly VrcRegistryStore _winRegistry = new VrcRegistryStore();

        private object WinGetVRChatRegistryKey(string key) => _winRegistry.GetValue(key);

        private bool WinSetVRChatRegistryKey(string key, object value, int typeInt) =>
            _winRegistry.SetValue(key, value, typeInt);

        private void WinSetVRChatRegistryKeyBytes(string key, byte[] value) => _winRegistry.SetRawDword(key, value);

        private string WinGetVRChatRegistryJson() => _winRegistry.ToJson();

        private void WinSetVRChatRegistry(string json) => _winRegistry.FromJson(json);

        private bool WinHasVRChatRegistryFolder() => _winRegistry.Exists();

        private void WinDeleteVRChatRegistryFolder() => _winRegistry.Delete();

        // ---- Explorer / clipboard -------------------------------------------------------------

        private static void WinOpenFolderAndSelectItem(string path, bool isFolder)
        {
            try
            {
                // explorer.exe returns a non-zero exit code even on success, so never check it
                var args = WindowsShell.ExplorerArguments(path, isFolder);
                Process.Start(new ProcessStartInfo("explorer.exe", args) { UseShellExecute = false })?.Dispose();
            }
            catch (Exception ex)
            {
                logger.Error($"Failed to open explorer for {path}: {ex.Message}");
            }
        }

        /// <summary>Runs a PowerShell snippet in an STA thread (the clipboard needs one) and returns stdout.</summary>
        private static string WinRunPowerShell(string script, string imagePathEnv = null)
        {
            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                StandardOutputEncoding = Encoding.UTF8
            };
            foreach (var arg in WindowsShell.PowerShellArguments(script))
                psi.ArgumentList.Add(arg);
            if (imagePathEnv != null)
                psi.Environment[WindowsShell.ClipboardImageVariable] = imagePathEnv;

            using var process = Process.Start(psi);
            var output = process.StandardOutput.ReadToEnd();
            process.WaitForExit();
            return output;
        }

        private static string WinGetClipboard()
        {
            try
            {
                return WinRunPowerShell(WindowsShell.GetClipboardScript);
            }
            catch (Exception ex)
            {
                logger.Error($"Failed to get clipboard: {ex.Message}");
                return string.Empty;
            }
        }

        private static void WinCopyImageToClipboard(string path)
        {
            try
            {
                WinRunPowerShell(WindowsShell.SetClipboardImageScript, path);
            }
            catch (Exception ex)
            {
                logger.Error($"Failed to copy image to clipboard: {ex.Message}");
            }
        }
    }
}
