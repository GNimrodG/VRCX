using System;
using System.IO;
using Xunit;

namespace VRCX.Tests
{
    public class OverlayFrameTests
    {
        [Fact]
        public void Path_is_dev_shm_on_linux_and_the_temp_folder_on_windows()
        {
            Assert.Equal("/dev/shm/vrcx_overlay", OverlayFrame.GetSharedMemoryPath(false, "/tmp"));
            Assert.Equal(Path.Combine("C:\\Temp", "vrcx_overlay"), OverlayFrame.GetSharedMemoryPath(true, "C:\\Temp"));
        }

        [Fact]
        public void Crop_swaps_blue_and_red_and_keeps_green_and_alpha()
        {
            // one BGRA pixel: B=1 G=2 R=3 A=4
            var dest = new byte[4];
            OverlayFrame.CropBgraToRgba(new byte[] { 1, 2, 3, 4 }, 1, 0, 0, 1, 1, dest);
            Assert.Equal(new byte[] { 3, 2, 1, 4 }, dest);
        }

        [Fact]
        public void Crop_copies_only_the_requested_rectangle()
        {
            // 3x3 frame, pixel (x, y) has B = y * 3 + x; crop the 2x2 block at (1, 1)
            var source = new byte[3 * 3 * 4];
            for (var y = 0; y < 3; y++)
                for (var x = 0; x < 3; x++)
                {
                    var i = (y * 3 + x) * 4;
                    source[i] = (byte)(y * 3 + x);
                    source[i + 3] = 255;
                }

            var dest = new byte[2 * 2 * 4];
            OverlayFrame.CropBgraToRgba(source, 3, 1, 1, 2, 2, dest);

            // blue (index 2 after the swap) of the four cropped pixels: (1,1)=4 (2,1)=5 (1,2)=7 (2,2)=8
            Assert.Equal(new byte[] { 4, 5, 7, 8 }, new[] { dest[2], dest[6], dest[10], dest[14] });
        }

        [Fact]
        public void Crop_does_not_flip_vertically()
        {
            // top row red, bottom row blue (BGRA); the output keeps that order, as raw uploads are top-down
            var source = new byte[]
            {
                0, 0, 255, 255, // row 0: red
                255, 0, 0, 255, // row 1: blue
            };
            var dest = new byte[8];
            OverlayFrame.CropBgraToRgba(source, 1, 0, 0, 1, 2, dest);
            Assert.Equal(new byte[] { 255, 0, 0, 255 }, dest[..4]); // RGBA red
            Assert.Equal(new byte[] { 0, 0, 255, 255 }, dest[4..]); // RGBA blue
        }

        [Fact]
        public void Crop_of_the_overlay_layout_splits_wrist_and_hmd()
        {
            // the real shared frame: 1024 wide, wrist 512x512 at the top left, HMD 1024x1024 below it
            const int width = 1024, height = 1536;
            var frame = new byte[width * height * 4];
            frame[(0 * width + 0) * 4] = 11; // wrist's first pixel (blue channel)
            frame[(512 * width + 0) * 4] = 22; // HMD's first pixel

            var wrist = new byte[512 * 512 * 4];
            var hmd = new byte[1024 * 1024 * 4];
            OverlayFrame.CropBgraToRgba(frame, width, 0, 0, 512, 512, wrist);
            OverlayFrame.CropBgraToRgba(frame, width, 0, 512, 1024, 1024, hmd);

            Assert.Equal(11, wrist[2]);
            Assert.Equal(22, hmd[2]);
        }

        [Theory]
        [InlineData(-1, 0, 1, 1)]
        [InlineData(0, -1, 1, 1)]
        [InlineData(0, 0, 0, 1)]
        [InlineData(0, 0, 1, 0)]
        [InlineData(1, 0, 2, 1)] // runs past the right edge of a 2-wide frame
        public void Crop_rejects_rectangles_outside_the_frame(int x, int y, int w, int h)
        {
            Assert.Throws<ArgumentOutOfRangeException>(() =>
                OverlayFrame.CropBgraToRgba(new byte[2 * 2 * 4], 2, x, y, w, h, new byte[64]));
        }

        [Fact]
        public void Crop_rejects_buffers_that_are_too_small()
        {
            Assert.Throws<ArgumentException>(() =>
                OverlayFrame.CropBgraToRgba(new byte[4], 2, 0, 0, 2, 2, new byte[16])); // source too short
            Assert.Throws<ArgumentException>(() =>
                OverlayFrame.CropBgraToRgba(new byte[16], 2, 0, 0, 2, 2, new byte[4])); // destination too short
        }

        [Fact]
        public void Mapping_stays_readable_while_another_writer_updates_the_file()
        {
            // Electron writes the frame with plain file I/O while .NET holds the mapping open
            var path = Path.Combine(Path.GetTempPath(), "vrcx_overlay_test_" + Guid.NewGuid().ToString("N"));
            File.WriteAllBytes(path, new byte[16]);
            try
            {
                using var mapping = OverlayFrame.OpenMapping(path, 16);
                using var view = mapping.CreateViewAccessor();

                using (var writer = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite))
                {
                    writer.Write(new byte[] { 1, 9, 8, 7 }, 0, 4);
                    writer.Flush(true);
                }

                Assert.Equal(1, view.ReadByte(0));
                Assert.Equal(9, view.ReadByte(1));
            }
            finally
            {
                File.Delete(path);
            }
        }

        [Fact]
        public void SystemTimes_total_is_kernel_plus_user_because_kernel_includes_idle()
        {
            var (total, idle) = WindowsSystemTimes.ToTotalAndIdle(idle: 100, kernel: 300, user: 200);
            Assert.Equal(500, total);
            Assert.Equal(100, idle);
        }

        [Fact]
        public void SystemTimes_uptime_is_positive_and_in_milliseconds()
        {
            Assert.True(WindowsSystemTimes.UptimeMilliseconds() > 0);
        }

        [WindowsFact]
        public void SystemTimes_read_returns_a_sane_cpu_snapshot_on_windows()
        {
            var times = WindowsSystemTimes.Read();
            Assert.NotNull(times);
            Assert.True(times.Value.TotalTime > 0);
            Assert.InRange(times.Value.IdleTime, 0, times.Value.TotalTime);
        }
    }
}
