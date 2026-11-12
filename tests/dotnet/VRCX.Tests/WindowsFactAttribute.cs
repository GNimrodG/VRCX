using System;
using Xunit;

namespace VRCX.Tests
{
    /// <summary>Runs only on Windows; reports as skipped elsewhere.</summary>
    public sealed class WindowsFactAttribute : FactAttribute
    {
        public WindowsFactAttribute()
        {
            if (!OperatingSystem.IsWindows())
                Skip = "Windows only";
        }
    }
}
