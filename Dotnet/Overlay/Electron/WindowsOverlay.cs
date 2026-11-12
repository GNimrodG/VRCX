using System;
using System.IO;
using System.IO.MemoryMappedFiles;
using System.Runtime.InteropServices;

namespace VRCX
{
    /// <summary>
    /// Fork-only (CLAUDE.md §5): the Windows half of the Electron VR overlay. Upstream's overlay is Linux-only
    /// (OpenGL textures through libGL/X11/Wayland/EGL, frames in /dev/shm). On Windows the frames travel through
    /// a plain file in the temp folder instead, and are uploaded with OpenVR's <c>SetOverlayRaw</c> (a CPU
    /// buffer), so no graphics-API interop is needed. This file is deliberately free of OpenVR and Electron
    /// types so the pixel and path logic can be unit tested on any OS (<c>tests/dotnet</c>).
    /// </summary>
    public static class OverlayFrame
    {
        public const int BytesPerPixel = 4;

        /// <summary>
        /// Where Electron writes frames and .NET reads them. Must match <c>src-electron/overlayShm.js</c>.
        /// </summary>
        public static string GetSharedMemoryPath(bool windows, string tempPath)
        {
            return windows ? Path.Combine(tempPath, "vrcx_overlay") : "/dev/shm/vrcx_overlay";
        }

        /// <summary>
        /// Maps the frame file. Node writes it with ordinary file I/O while this mapping is open, so the file
        /// must be opened with sharing enabled (the plain <c>CreateFromFile(path, ...)</c> overload denies it).
        /// </summary>
        public static MemoryMappedFile OpenMapping(string path, long capacity)
        {
            var stream = new FileStream(path, FileMode.Open, FileAccess.ReadWrite,
                FileShare.ReadWrite | FileShare.Delete);
            return MemoryMappedFile.CreateFromFile(stream, null, capacity, MemoryMappedFileAccess.ReadWrite,
                HandleInheritability.None, false);
        }

        /// <summary>
        /// Copies a rectangle out of a top-down BGRA frame (Chromium's bitmap order) into a tightly packed
        /// RGBA buffer, the format <c>SetOverlayRaw</c> expects. Unlike the OpenGL path no vertical flip is
        /// needed: both the frame and the raw upload are top-down.
        /// </summary>
        public static void CropBgraToRgba(byte[] source, int sourceWidth, int x, int y, int width, int height,
            byte[] destination)
        {
            if (source == null) throw new ArgumentNullException(nameof(source));
            if (destination == null) throw new ArgumentNullException(nameof(destination));
            if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > sourceWidth)
                throw new ArgumentOutOfRangeException(nameof(x), "Crop rectangle is outside the frame.");

            var sourceStride = sourceWidth * BytesPerPixel;
            if (source.Length < (y + height) * sourceStride)
                throw new ArgumentException("Source is smaller than the crop rectangle needs.", nameof(source));
            if (destination.Length < width * height * BytesPerPixel)
                throw new ArgumentException("Destination is too small.", nameof(destination));

            var destinationIndex = 0;
            for (var row = 0; row < height; row++)
            {
                var sourceIndex = (y + row) * sourceStride + x * BytesPerPixel;
                for (var column = 0; column < width; column++)
                {
                    destination[destinationIndex] = source[sourceIndex + 2]; // R
                    destination[destinationIndex + 1] = source[sourceIndex + 1]; // G
                    destination[destinationIndex + 2] = source[sourceIndex]; // B
                    destination[destinationIndex + 3] = source[sourceIndex + 3]; // A
                    sourceIndex += BytesPerPixel;
                    destinationIndex += BytesPerPixel;
                }
            }
        }
    }

    /// <summary>Windows counters for <see cref="SystemMonitorElectron"/> (the Linux ones read /proc).</summary>
    public static class WindowsSystemTimes
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct FileTime
        {
            public uint Low;
            public uint High;

            public long Value => ((long)High << 32) | Low;
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetSystemTimes(out FileTime idle, out FileTime kernel, out FileTime user);

        /// <summary>
        /// GetSystemTimes' kernel time already includes idle time, so busy time is kernel + user - idle and
        /// the total is kernel + user. Returns the same (total, idle) pair the Linux /proc/stat reader does.
        /// </summary>
        public static (long TotalTime, long IdleTime) ToTotalAndIdle(long idle, long kernel, long user)
        {
            return (kernel + user, idle);
        }

        public static (long TotalTime, long IdleTime)? Read()
        {
            if (!GetSystemTimes(out var idle, out var kernel, out var user))
                return null;

            return ToTotalAndIdle(idle.Value, kernel.Value, user.Value);
        }

        /// <summary>Milliseconds since boot, as the Linux reader gets from /proc/uptime.</summary>
        public static double UptimeMilliseconds() => Environment.TickCount64;
    }
}
