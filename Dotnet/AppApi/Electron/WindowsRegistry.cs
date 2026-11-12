using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;
using NLog;

namespace VRCX
{
    /// <summary>One value to write back when restoring a registry backup.</summary>
    public sealed class VrcRegistryWrite
    {
        public string Key;
        public int Type;
        public JsonElement Data;
    }

    /// <summary>
    /// Fork-only (CLAUDE.md §5). The pure half of the Windows VRChat registry support: key hashing, value
    /// conversion and the backup JSON format. No registry access, so it is unit tested on every OS
    /// (<c>tests/dotnet</c>). The JSON shape is the one the Wine path already produces and the settings
    /// backup stores: <c>{ "<key>": { "data": ..., "type": 3 | 4 | 100 } }</c>, where 100 is Unity's float
    /// (a double stored in an 8-byte REG_DWORD).
    /// </summary>
    public static class VrcRegistryCodec
    {
        public const int TypeBinary = 3; // RegistryValueKind.Binary
        public const int TypeDword = 4; // RegistryValueKind.DWord
        public const int TypeFloat = 100;

        /// <summary>
        /// Unity PlayerPrefs appends a hash to every key name:
        /// https://discussions.unity.com/t/playerprefs-changing-the-name-of-keys/30332/4
        /// </summary>
        public static string HashKeyName(string key)
        {
            uint hash = 5381;
            foreach (var c in key)
                hash = (hash * 33) ^ c;
            return key + "_h" + hash;
        }

        /// <summary>Strips the <c>_h&lt;hash&gt;</c> suffix; null when the name has none (not a PlayerPrefs key).</summary>
        public static string StripHash(string name)
        {
            var index = name.LastIndexOf("_h", StringComparison.Ordinal);
            return index > 0 ? name.Substring(0, index) : null;
        }

        public static double LongBitsToDouble(long bits) => BitConverter.ToDouble(BitConverter.GetBytes(bits), 0);

        /// <summary>The 8 bytes of an 8-byte REG_DWORD holding <paramref name="value"/>.</summary>
        public static byte[] DoubleToRawDword(double value) => BitConverter.GetBytes(value);

        /// <summary>REG_BINARY values are text; null when <paramref name="value"/> isn't a string or byte array.</summary>
        public static byte[] ToBinary(object value)
        {
            if (value is JsonElement json)
            {
                if (json.ValueKind == JsonValueKind.String)
                    return Encoding.UTF8.GetBytes(json.GetString() ?? string.Empty);

                if (json.ValueKind == JsonValueKind.Array)
                {
                    var list = new List<byte>();
                    foreach (var item in json.EnumerateArray())
                        list.Add((byte)item.GetInt32());
                    return list.ToArray();
                }

                return null;
            }

            return value is string text ? Encoding.UTF8.GetBytes(text) : null;
        }

        public static int? ToDword(object value)
        {
            if (value is int i)
                return i;
            if (value is string s && int.TryParse(s, out var parsed))
                return parsed;
            if (value is JsonElement { ValueKind: JsonValueKind.Number } number && number.TryGetInt32(out var n))
                return n;
            return null;
        }

        /// <summary>
        /// Builds the backup JSON from raw registry values (<c>Data</c> is a byte[] for REG_BINARY, an int
        /// for a normal REG_DWORD and a long for Unity's 8-byte float). Names without a hash are skipped.
        /// </summary>
        public static string BuildJson(IEnumerable<(string Name, RegistryValueKind Kind, object Data)> values)
        {
            var output = new Dictionary<string, Dictionary<string, object>>();
            foreach (var (name, kind, data) in values)
            {
                var key = StripHash(name);
                if (key == null || data == null)
                    continue;

                switch (kind)
                {
                    case RegistryValueKind.Binary:
                        output[key] = new Dictionary<string, object>
                        {
                            { "data", Encoding.ASCII.GetString((byte[])data).TrimEnd('\0') },
                            { "type", TypeBinary }
                        };
                        break;

                    case RegistryValueKind.DWord when data is long bits:
                        output[key] = new Dictionary<string, object>
                        {
                            { "data", LongBitsToDouble(bits) },
                            { "type", TypeFloat }
                        };
                        break;

                    case RegistryValueKind.DWord:
                        output[key] = new Dictionary<string, object>
                        {
                            { "data", data },
                            { "type", TypeDword }
                        };
                        break;
                }
            }

            return Newtonsoft.Json.JsonConvert.SerializeObject(output, Newtonsoft.Json.Formatting.Indented);
        }

        public static List<VrcRegistryWrite> ParseJson(string json)
        {
            var dict = JsonSerializer.Deserialize<Dictionary<string, Dictionary<string, object>>>(json);
            var writes = new List<VrcRegistryWrite>();
            foreach (var item in dict)
            {
                if (!int.TryParse(item.Value["type"].ToString(), out var type))
                    throw new Exception("Unknown type: " + item.Value["type"]);

                writes.Add(new VrcRegistryWrite { Key = item.Key, Type = type, Data = (JsonElement)item.Value["data"] });
            }

            return writes;
        }
    }

    /// <summary>
    /// Fork-only (CLAUDE.md §5). The Windows registry side: reads and writes VRChat's PlayerPrefs key
    /// (<c>HKCU\SOFTWARE\VRChat\VRChat</c>). Ported from the deleted CefSharp client's
    /// <c>AppApiCef</c>, with the folder as a parameter so tests can use a scratch key instead of
    /// VRChat's real one.
    /// </summary>
    public sealed class VrcRegistryStore
    {
        public const string VrchatFolder = @"SOFTWARE\VRChat\VRChat";
        private static readonly Logger logger = LogManager.GetCurrentClassLogger();

        [DllImport("advapi32.dll", CharSet = CharSet.Ansi, SetLastError = true)]
        private static extern uint RegSetValueEx(UIntPtr hKey, [MarshalAs(UnmanagedType.LPStr)] string lpValueName,
            int reserved, RegistryValueKind dwType, byte[] lpData, int cbData);

        [DllImport("advapi32.dll", CharSet = CharSet.Ansi, SetLastError = true)]
        private static extern int RegOpenKeyEx(UIntPtr hKey, string subKey, int ulOptions, int samDesired,
            out UIntPtr hkResult);

        [DllImport("advapi32.dll")]
        private static extern int RegCloseKey(UIntPtr hKey);

        private readonly string _folder;

        public VrcRegistryStore(string folder = VrchatFolder)
        {
            _folder = folder;
        }

        public bool Exists()
        {
            using var key = Registry.CurrentUser.OpenSubKey(_folder);
            return key != null;
        }

        public void Create()
        {
            using var key = Registry.CurrentUser.CreateSubKey(_folder);
            if (key == null)
                throw new Exception("Error creating registry key.");
        }

        public void Delete()
        {
            if (Exists())
                Registry.CurrentUser.DeleteSubKeyTree(_folder);
        }

        public object GetValue(string key)
        {
            var name = VrcRegistryCodec.HashKeyName(key);
            using var regKey = Registry.CurrentUser.OpenSubKey(_folder);
            var data = regKey?.GetValue(name);
            if (data == null)
                return null;

            switch (regKey.GetValueKind(name))
            {
                case RegistryValueKind.Binary:
                    return Encoding.ASCII.GetString((byte[])data);

                case RegistryValueKind.DWord:
                    // Unity stores floats as an 8-byte REG_DWORD, which .NET surfaces as a long
                    return data is long bits ? VrcRegistryCodec.LongBitsToDouble(bits) : data;
            }

            return null;
        }

        public bool SetValue(string key, object value, int typeInt)
        {
            var name = VrcRegistryCodec.HashKeyName(key);
            switch ((RegistryValueKind)typeInt)
            {
                case RegistryValueKind.Binary:
                    {
                        var bytes = VrcRegistryCodec.ToBinary(value);
                        if (bytes == null)
                        {
                            logger.Error($"Invalid value for REG_BINARY: {value}. It must be a string or byte array.");
                            return false;
                        }

                        using var regKey = Registry.CurrentUser.CreateSubKey(_folder);
                        regKey.SetValue(name, bytes, RegistryValueKind.Binary);
                        return true;
                    }

                case RegistryValueKind.DWord:
                    {
                        var intValue = VrcRegistryCodec.ToDword(value);
                        if (intValue == null)
                        {
                            logger.Error($"Invalid value for REG_DWORD: {value}. It must be a valid integer.");
                            return false;
                        }

                        using var regKey = Registry.CurrentUser.CreateSubKey(_folder);
                        regKey.SetValue(name, intValue.Value, RegistryValueKind.DWord);
                        return true;
                    }

                default:
                    logger.Error($"Unsupported set registry value type: {typeInt}");
                    return false;
            }
        }

        /// <summary>Writes a raw 8-byte REG_DWORD (Unity's float encoding), which RegistryKey.SetValue can't.</summary>
        public void SetRawDword(string key, byte[] value)
        {
            Create();
            var name = VrcRegistryCodec.HashKeyName(key);
            var hkcu = (UIntPtr)0x80000001; // HKEY_CURRENT_USER
            const int keyWrite = 0x20006;
            var openResult = RegOpenKeyEx(hkcu, _folder, 0, keyWrite, out var folder);
            if (openResult != 0)
                throw new Exception("Error opening registry key. Error code: " + openResult);

            try
            {
                var setResult = RegSetValueEx(folder, name, 0, RegistryValueKind.DWord, value, value.Length);
                if (setResult != 0)
                    throw new Exception("Error setting registry value. Error code: " + setResult);
            }
            finally
            {
                RegCloseKey(folder);
            }
        }

        public string ToJson()
        {
            using var regKey = Registry.CurrentUser.OpenSubKey(_folder);
            if (regKey == null)
                throw new Exception("Failed to get VRC registry data");

            var values = new List<(string, RegistryValueKind, object)>();
            foreach (var name in regKey.GetValueNames())
                values.Add((name, regKey.GetValueKind(name), regKey.GetValue(name)));

            return VrcRegistryCodec.BuildJson(values);
        }

        public void FromJson(string json)
        {
            Create();
            foreach (var write in VrcRegistryCodec.ParseJson(json))
            {
                if (write.Type == VrcRegistryCodec.TypeFloat)
                {
                    SetRawDword(write.Key, VrcRegistryCodec.DoubleToRawDword(write.Data.GetDouble()));
                    continue;
                }

                if (write.Data.ValueKind == JsonValueKind.Number && !write.Data.TryGetInt32(out _))
                    throw new Exception("Unknown number type: " + write.Key);

                SetValue(write.Key, write.Data, write.Type);
            }
        }
    }
}
