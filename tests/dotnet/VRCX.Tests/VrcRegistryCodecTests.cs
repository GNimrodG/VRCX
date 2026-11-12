using System.Linq;
using System.Collections.Generic;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;
using Xunit;

namespace VRCX.Tests
{
    public class VrcRegistryCodecTests
    {
        [Fact]
        public void HashKeyName_matches_the_unity_reference_example()
        {
            // the example documented on AddHashToKeyName and in the Unity forum thread it links
            Assert.Equal(
                "VRC_GROUP_ORDER_usr_032383a7-748c-4fb2-94e4-bcb928e5de6b_h2810492971",
                VrcRegistryCodec.HashKeyName("VRC_GROUP_ORDER_usr_032383a7-748c-4fb2-94e4-bcb928e5de6b"));
        }

        [Fact]
        public void HashKeyName_of_empty_key_is_the_seed()
        {
            Assert.Equal("_h5381", VrcRegistryCodec.HashKeyName(""));
        }

        [Theory]
        [InlineData("VRC_GROUP_ORDER_usr_x_h2810492971", "VRC_GROUP_ORDER_usr_x")]
        [InlineData("a_h1_h2", "a_h1")]
        public void StripHash_removes_only_the_last_suffix(string name, string expected)
        {
            Assert.Equal(expected, VrcRegistryCodec.StripHash(name));
        }

        [Theory]
        [InlineData("NoHashHere")]
        [InlineData("_hLeading")]
        [InlineData("")]
        public void StripHash_returns_null_for_names_without_a_hash(string name)
        {
            Assert.Null(VrcRegistryCodec.StripHash(name));
        }

        [Theory]
        [InlineData(0.0)]
        [InlineData(1.0)]
        [InlineData(-3.5)]
        [InlineData(0.123456789)]
        [InlineData(double.MaxValue)]
        public void Float_encoding_round_trips_through_the_raw_dword(double value)
        {
            var raw = VrcRegistryCodec.DoubleToRawDword(value);
            Assert.Equal(8, raw.Length);
            Assert.Equal(value, VrcRegistryCodec.LongBitsToDouble(System.BitConverter.ToInt64(raw, 0)));
        }

        [Fact]
        public void ToBinary_accepts_strings_json_strings_and_json_arrays()
        {
            Assert.Equal(Encoding.UTF8.GetBytes("héllo"), VrcRegistryCodec.ToBinary("héllo"));
            Assert.Equal(Encoding.UTF8.GetBytes("abc"), VrcRegistryCodec.ToBinary(Json("\"abc\"")));
            Assert.Equal(new byte[] { 1, 2, 255 }, VrcRegistryCodec.ToBinary(Json("[1,2,255]")));
            Assert.Empty(VrcRegistryCodec.ToBinary(Json("\"\"")));
        }

        [Fact]
        public void ToBinary_rejects_everything_else()
        {
            Assert.Null(VrcRegistryCodec.ToBinary(Json("5")));
            Assert.Null(VrcRegistryCodec.ToBinary(Json("{}")));
            Assert.Null(VrcRegistryCodec.ToBinary(5));
            Assert.Null(VrcRegistryCodec.ToBinary(null));
        }

        [Fact]
        public void ToDword_accepts_ints_numeric_strings_and_json_numbers()
        {
            Assert.Equal(7, VrcRegistryCodec.ToDword(7));
            Assert.Equal(-7, VrcRegistryCodec.ToDword("-7"));
            Assert.Equal(42, VrcRegistryCodec.ToDword(Json("42")));
        }

        [Fact]
        public void ToDword_rejects_non_integers_and_overflow()
        {
            Assert.Null(VrcRegistryCodec.ToDword("abc"));
            Assert.Null(VrcRegistryCodec.ToDword(Json("1.5")));
            Assert.Null(VrcRegistryCodec.ToDword(Json("99999999999")));
            Assert.Null(VrcRegistryCodec.ToDword(Json("\"7\"")));
            Assert.Null(VrcRegistryCodec.ToDword(null));
        }

        [Fact]
        public void BuildJson_maps_each_value_kind_to_the_backup_format()
        {
            var json = VrcRegistryCodec.BuildJson(new (string, RegistryValueKind, object)[]
            {
                ("note_h1", RegistryValueKind.Binary, Encoding.ASCII.GetBytes("hello\0")),
                ("count_h2", RegistryValueKind.DWord, 12),
                ("volume_h3", RegistryValueKind.DWord, System.BitConverter.ToInt64(System.BitConverter.GetBytes(0.5), 0)),
            });

            var doc = JsonDocument.Parse(json).RootElement;
            Assert.Equal("hello", doc.GetProperty("note").GetProperty("data").GetString());
            Assert.Equal(3, doc.GetProperty("note").GetProperty("type").GetInt32());
            Assert.Equal(12, doc.GetProperty("count").GetProperty("data").GetInt32());
            Assert.Equal(4, doc.GetProperty("count").GetProperty("type").GetInt32());
            Assert.Equal(0.5, doc.GetProperty("volume").GetProperty("data").GetDouble());
            Assert.Equal(100, doc.GetProperty("volume").GetProperty("type").GetInt32());
        }

        [Fact]
        public void BuildJson_skips_unhashed_names_null_data_and_other_kinds()
        {
            var json = VrcRegistryCodec.BuildJson(new (string, RegistryValueKind, object)[]
            {
                ("NoHash", RegistryValueKind.DWord, 1),
                ("gone_h9", RegistryValueKind.DWord, null),
                ("text_h4", RegistryValueKind.String, "x"),
                ("kept_h5", RegistryValueKind.DWord, 1),
            });

            var doc = JsonDocument.Parse(json).RootElement;
            Assert.Equal(new[] { "kept" }, doc.EnumerateObject().Select(p => p.Name).ToArray());
        }

        [Fact]
        public void ParseJson_reads_what_BuildJson_wrote()
        {
            var json = VrcRegistryCodec.BuildJson(new (string, RegistryValueKind, object)[]
            {
                ("note_h1", RegistryValueKind.Binary, Encoding.ASCII.GetBytes("hello")),
                ("count_h2", RegistryValueKind.DWord, 12),
                ("volume_h3", RegistryValueKind.DWord, System.BitConverter.ToInt64(System.BitConverter.GetBytes(0.25), 0)),
            });

            var writes = VrcRegistryCodec.ParseJson(json);
            Assert.Equal(3, writes.Count);

            var note = writes.Single(w => w.Key == "note");
            Assert.Equal(VrcRegistryCodec.TypeBinary, note.Type);
            Assert.Equal("hello", note.Data.GetString());

            var count = writes.Single(w => w.Key == "count");
            Assert.Equal(VrcRegistryCodec.TypeDword, count.Type);
            Assert.Equal(12, count.Data.GetInt32());

            var volume = writes.Single(w => w.Key == "volume");
            Assert.Equal(VrcRegistryCodec.TypeFloat, volume.Type);
            Assert.Equal(0.25, volume.Data.GetDouble());
        }

        [Fact]
        public void ParseJson_throws_on_a_non_numeric_type()
        {
            var ex = Assert.Throws<System.Exception>(() =>
                VrcRegistryCodec.ParseJson("{\"a\":{\"data\":1,\"type\":\"nope\"}}"));
            Assert.Contains("Unknown type", ex.Message);
        }

        private static JsonElement Json(string raw) => JsonDocument.Parse(raw).RootElement.Clone();
    }
}
