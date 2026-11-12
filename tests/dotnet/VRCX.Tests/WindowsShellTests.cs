using Xunit;

namespace VRCX.Tests
{
    public class WindowsShellTests
    {
        [Fact]
        public void Folders_open_as_is_and_files_are_selected()
        {
            Assert.Equal("\"C:\\Users\\me\\Pictures\\VRChat\"", WindowsShell.ExplorerArguments("C:\\Users\\me\\Pictures\\VRChat", true));
            Assert.Equal("/select,\"C:\\a b\\shot.png\"", WindowsShell.ExplorerArguments("C:\\a b\\shot.png", false));
        }

        [Fact]
        public void Paths_with_spaces_stay_inside_one_quoted_argument()
        {
            var args = WindowsShell.ExplorerArguments("C:\\Program Files\\VRChat", true);
            Assert.StartsWith("\"", args);
            Assert.EndsWith("\"", args);
        }

        [Fact]
        public void PowerShell_runs_without_profile_and_in_an_sta_thread()
        {
            var args = WindowsShell.PowerShellArguments("Write-Output 1");
            Assert.Equal(new[] { "-NoProfile", "-NonInteractive", "-STA", "-Command", "Write-Output 1" }, args);
        }

        [Fact]
        public void The_image_script_reads_the_path_from_the_environment_not_the_command_line()
        {
            Assert.Contains("$env:" + WindowsShell.ClipboardImageVariable, WindowsShell.SetClipboardImageScript);
            Assert.DoesNotContain("{0}", WindowsShell.SetClipboardImageScript);
        }

        [Fact]
        public void The_text_script_writes_utf8()
        {
            Assert.Contains("UTF8", WindowsShell.GetClipboardScript);
            Assert.Contains("Get-Clipboard -Raw", WindowsShell.GetClipboardScript);
        }
    }
}
