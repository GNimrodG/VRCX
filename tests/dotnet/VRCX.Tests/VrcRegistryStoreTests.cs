using System;
using System.Text.Json;
using Microsoft.Win32;
using Xunit;

namespace VRCX.Tests
{
    /// <summary>
    /// Real-registry tests, Windows only. Each test works in its own scratch key under
    /// HKCU\SOFTWARE\VRCX-Headless-Tests, never VRChat's.
    /// </summary>
    public sealed class VrcRegistryStoreTests : IDisposable
    {
        private readonly string _folder = @"SOFTWARE\VRCX-Headless-Tests\" + Guid.NewGuid().ToString("N");

        public void Dispose()
        {
            if (!OperatingSystem.IsWindows())
                return;

            Registry.CurrentUser.DeleteSubKeyTree(_folder, false);
        }

        private VrcRegistryStore Store() => new VrcRegistryStore(_folder);

        [WindowsFact]
        public void A_missing_folder_does_not_exist_and_reads_null()
        {
            var store = Store();
            Assert.False(store.Exists());
            Assert.Null(store.GetValue("anything"));
        }

        [WindowsFact]
        public void Binary_values_round_trip_as_text()
        {
            var store = Store();
            Assert.True(store.SetValue("note", "hello", VrcRegistryCodec.TypeBinary));
            Assert.Equal("hello", store.GetValue("note"));
            Assert.True(store.Exists());
        }

        [WindowsFact]
        public void Dword_values_round_trip_as_ints()
        {
            var store = Store();
            Assert.True(store.SetValue("count", 42, VrcRegistryCodec.TypeDword));
            Assert.Equal(42, store.GetValue("count"));
        }

        [WindowsFact]
        public void Values_are_stored_under_the_hashed_name()
        {
            var store = Store();
            store.SetValue("count", 1, VrcRegistryCodec.TypeDword);
            using var key = Registry.CurrentUser.OpenSubKey(_folder);
            Assert.Contains(VrcRegistryCodec.HashKeyName("count"), key.GetValueNames());
        }

        [WindowsFact]
        public void Floats_are_8_byte_dwords_read_back_as_doubles()
        {
            var store = Store();
            store.SetRawDword("volume", VrcRegistryCodec.DoubleToRawDword(0.75));
            Assert.Equal(0.75, store.GetValue("volume"));
        }

        [WindowsFact]
        public void Invalid_values_are_rejected_without_writing()
        {
            var store = Store();
            Assert.False(store.SetValue("count", "not a number", VrcRegistryCodec.TypeDword));
            Assert.False(store.SetValue("note", 5, VrcRegistryCodec.TypeBinary));
            Assert.False(store.SetValue("x", 1, (int)RegistryValueKind.String));
            Assert.Null(store.GetValue("count"));
        }

        [WindowsFact]
        public void A_backup_restores_into_an_empty_folder()
        {
            var source = Store();
            source.SetValue("note", "hello", VrcRegistryCodec.TypeBinary);
            source.SetValue("count", 7, VrcRegistryCodec.TypeDword);
            source.SetRawDword("volume", VrcRegistryCodec.DoubleToRawDword(1.5));
            var json = source.ToJson();
            source.Delete();
            Assert.False(source.Exists());

            source.FromJson(json);

            Assert.Equal("hello", source.GetValue("note"));
            Assert.Equal(7, source.GetValue("count"));
            Assert.Equal(1.5, source.GetValue("volume"));
        }

        [WindowsFact]
        public void ToJson_reports_a_missing_folder()
        {
            Assert.Throws<Exception>(() => Store().ToJson());
        }

        [WindowsFact]
        public void ToJson_ignores_values_that_are_not_player_prefs()
        {
            var store = Store();
            store.Create();
            using (var key = Registry.CurrentUser.OpenSubKey(_folder, true))
                key.SetValue("NotPlayerPrefs", 1, RegistryValueKind.DWord);
            store.SetValue("count", 3, VrcRegistryCodec.TypeDword);

            var doc = JsonDocument.Parse(store.ToJson()).RootElement;
            Assert.True(doc.TryGetProperty("count", out _));
            Assert.False(doc.TryGetProperty("NotPlayerPrefs", out _));
        }

        [WindowsFact]
        public void Delete_removes_the_folder_and_is_safe_to_repeat()
        {
            var store = Store();
            store.Create();
            Assert.True(store.Exists());
            store.Delete();
            Assert.False(store.Exists());
            store.Delete();
        }
    }
}
