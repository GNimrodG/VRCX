using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;

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
        private const string WinVrcRegistryFolder = @"SOFTWARE\VRChat\VRChat";

        [DllImport("advapi32.dll", CharSet = CharSet.Ansi, SetLastError = true)]
        private static extern uint RegSetValueEx(
            UIntPtr hKey,
            [MarshalAs(UnmanagedType.LPStr)] string lpValueName,
            int Reserved,
            RegistryValueKind dwType,
            byte[] lpData,
            int cbData);

        [DllImport("advapi32.dll", CharSet = CharSet.Ansi, SetLastError = true)]
        private static extern int RegOpenKeyEx(
            UIntPtr hKey,
            string subKey,
            int ulOptions,
            int samDesired,
            out UIntPtr hkResult);

        [DllImport("advapi32.dll")]
        private static extern int RegCloseKey(UIntPtr hKey);

        // ---- Registry -------------------------------------------------------------------------

        private object WinGetVRChatRegistryKey(string key)
        {
            var keyName = AddHashToKeyName(key);
            using var regKey = Registry.CurrentUser.OpenSubKey(WinVrcRegistryFolder);
            var data = regKey?.GetValue(keyName);
            if (data == null)
                return null;

            switch (regKey.GetValueKind(keyName))
            {
                case RegistryValueKind.Binary:
                    return Encoding.ASCII.GetString((byte[])data);

                case RegistryValueKind.DWord:
                    // Unity stores floats as an 8-byte REG_DWORD, which .NET surfaces as a long
                    if (data is not long longValue)
                        return data;
                    return BitConverter.ToDouble(BitConverter.GetBytes(longValue), 0);
            }

            return null;
        }

        private bool WinSetVRChatRegistryKey(string key, object value, int typeInt)
        {
            var type = (RegistryValueKind)typeInt;
            var keyName = AddHashToKeyName(key);
            using var regKey = Registry.CurrentUser.CreateSubKey(WinVrcRegistryFolder);
            if (regKey == null)
                return false;

            switch (type)
            {
                case RegistryValueKind.Binary:
                {
                    byte[] bytes;
                    if (value is JsonElement json)
                    {
                        if (json.ValueKind == JsonValueKind.String)
                        {
                            bytes = Encoding.UTF8.GetBytes(json.GetString() ?? string.Empty);
                        }
                        else if (json.ValueKind == JsonValueKind.Array)
                        {
                            var list = new List<byte>();
                            foreach (var item in json.EnumerateArray())
                                list.Add((byte)item.GetInt32());
                            bytes = list.ToArray();
                        }
                        else
                        {
                            logger.Error($"Invalid value for REG_BINARY: {value}. It must be a JSON string or array.");
                            return false;
                        }
                    }
                    else if (value is string text)
                    {
                        bytes = Encoding.UTF8.GetBytes(text);
                    }
                    else
                    {
                        logger.Error($"Invalid value for REG_BINARY: {value}.");
                        return false;
                    }

                    regKey.SetValue(keyName, bytes, RegistryValueKind.Binary);
                    return true;
                }

                case RegistryValueKind.DWord:
                {
                    int intValue;
                    if (value is int i)
                        intValue = i;
                    else if (value is string s && int.TryParse(s, out var parsed))
                        intValue = parsed;
                    else if (value is JsonElement { ValueKind: JsonValueKind.Number } num)
                        intValue = num.GetInt32();
                    else
                    {
                        logger.Error($"Invalid value for REG_DWORD: {value}. It must be a valid integer.");
                        return false;
                    }

                    regKey.SetValue(keyName, intValue, RegistryValueKind.DWord);
                    return true;
                }

                default:
                    logger.Error($"Unsupported set registry value type: {typeInt}");
                    return false;
            }
        }

        /// <summary>Writes a raw 8-byte REG_DWORD (Unity's float encoding), which `RegistryKey.SetValue` can't.</summary>
        private void WinSetVRChatRegistryKeyBytes(string key, byte[] value)
        {
            WinCreateVRChatRegistryFolder();
            var keyName = AddHashToKeyName(key);
            var hkcu = (UIntPtr)0x80000001; // HKEY_CURRENT_USER
            const int keyWrite = 0x20006;
            var openResult = RegOpenKeyEx(hkcu, WinVrcRegistryFolder, 0, keyWrite, out var folder);
            if (openResult != 0)
                throw new Exception("Error opening registry key. Error code: " + openResult);

            try
            {
                var setResult = RegSetValueEx(folder, keyName, 0, RegistryValueKind.DWord, value, value.Length);
                if (setResult != 0)
                    throw new Exception("Error setting registry value. Error code: " + setResult);
            }
            finally
            {
                RegCloseKey(folder);
            }
        }

        private string WinGetVRChatRegistryJson()
        {
            var output = new Dictionary<string, Dictionary<string, object>>();
            using var regKey = Registry.CurrentUser.OpenSubKey(WinVrcRegistryFolder);
            if (regKey == null)
                throw new Exception("Failed to get VRC registry data");

            foreach (var name in regKey.GetValueNames())
            {
                var index = name.LastIndexOf("_h", StringComparison.Ordinal);
                if (index <= 0)
                    continue;

                var data = regKey.GetValue(name);
                if (data == null)
                    continue;

                var keyName = name.Substring(0, index);
                var type = regKey.GetValueKind(name);
                switch (type)
                {
                    case RegistryValueKind.Binary:
                        output[keyName] = new Dictionary<string, object>
                        {
                            { "data", Encoding.ASCII.GetString((byte[])data).TrimEnd('\0') },
                            { "type", (int)type }
                        };
                        break;

                    case RegistryValueKind.DWord:
                        if (data is long longValue)
                        {
                            output[keyName] = new Dictionary<string, object>
                            {
                                { "data", BitConverter.ToDouble(BitConverter.GetBytes(longValue), 0) },
                                { "type", 100 } // it's special: Unity float
                            };
                        }
                        else
                        {
                            output[keyName] = new Dictionary<string, object>
                            {
                                { "data", data },
                                { "type", (int)type }
                            };
                        }
                        break;

                    default:
                        logger.Warn($"Unknown registry value kind for {name}: {type}");
                        break;
                }
            }

            return Newtonsoft.Json.JsonConvert.SerializeObject(output, Newtonsoft.Json.Formatting.Indented);
        }

        private void WinSetVRChatRegistry(string json)
        {
            WinCreateVRChatRegistryFolder();
            var dict = JsonSerializer.Deserialize<Dictionary<string, Dictionary<string, object>>>(json);
            foreach (var item in dict)
            {
                var data = (JsonElement)item.Value["data"];
                if (!int.TryParse(item.Value["type"].ToString(), out var type))
                    throw new Exception("Unknown type: " + item.Value["type"]);

                if (data.ValueKind == JsonValueKind.Number)
                {
                    if (type == 100)
                    {
                        WinSetVRChatRegistryKeyBytes(item.Key, BitConverter.GetBytes(data.GetDouble()));
                        continue;
                    }

                    if (int.TryParse(data.ToString(), out var intValue))
                    {
                        WinSetVRChatRegistryKey(item.Key, intValue, type);
                        continue;
                    }

                    throw new Exception("Unknown number type: " + item.Key);
                }

                WinSetVRChatRegistryKey(item.Key, data, type);
            }
        }

        private static bool WinHasVRChatRegistryFolder()
        {
            using var regKey = Registry.CurrentUser.OpenSubKey(WinVrcRegistryFolder);
            return regKey != null;
        }

        private static void WinCreateVRChatRegistryFolder()
        {
            using var key = Registry.CurrentUser.CreateSubKey(WinVrcRegistryFolder);
            if (key == null)
                throw new Exception("Error creating registry key.");
        }

        private static void WinDeleteVRChatRegistryFolder()
        {
            if (!WinHasVRChatRegistryFolder())
                return;

            Registry.CurrentUser.DeleteSubKeyTree(WinVrcRegistryFolder);
        }

        // ---- Explorer / clipboard -------------------------------------------------------------

        private static void WinOpenFolderAndSelectItem(string path, bool isFolder)
        {
            try
            {
                // explorer.exe returns a non-zero exit code even on success, so never check it
                var args = isFolder ? $"\"{path}\"" : $"/select,\"{path}\"";
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
            foreach (var arg in new[] { "-NoProfile", "-NonInteractive", "-STA", "-Command", script })
                psi.ArgumentList.Add(arg);
            if (imagePathEnv != null)
                psi.Environment["VRCX_CLIPBOARD_IMAGE"] = imagePathEnv;

            using var process = Process.Start(psi);
            var output = process.StandardOutput.ReadToEnd();
            process.WaitForExit();
            return output;
        }

        private static string WinGetClipboard()
        {
            try
            {
                var output = WinRunPowerShell(
                    "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $t = Get-Clipboard -Raw; if ($t) { [Console]::Out.Write($t) }");
                return output;
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
                // path goes through an environment variable so it never needs PowerShell quoting
                WinRunPowerShell(
                    "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; " +
                    "$img = [System.Drawing.Image]::FromFile($env:VRCX_CLIPBOARD_IMAGE); " +
                    "try { [System.Windows.Forms.Clipboard]::SetImage($img) } finally { $img.Dispose() }",
                    path);
            }
            catch (Exception ex)
            {
                logger.Error($"Failed to copy image to clipboard: {ex.Message}");
            }
        }
    }
}
