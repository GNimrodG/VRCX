namespace VRCX
{
    /// <summary>
    /// Fork-only (CLAUDE.md §5). The command lines the Windows shell helpers run, kept as pure functions and
    /// constants so tests can check them without launching explorer or PowerShell.
    /// </summary>
    public static class WindowsShell
    {
        /// <summary>The image path travels in this environment variable so it never needs PowerShell quoting.</summary>
        public const string ClipboardImageVariable = "VRCX_CLIPBOARD_IMAGE";

        public const string GetClipboardScript =
            "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $t = Get-Clipboard -Raw; if ($t) { [Console]::Out.Write($t) }";

        public const string SetClipboardImageScript =
            "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; " +
            "$img = [System.Drawing.Image]::FromFile($env:" + ClipboardImageVariable + "); " +
            "try { [System.Windows.Forms.Clipboard]::SetImage($img) } finally { $img.Dispose() }";

        /// <summary>Folders open as-is; files open their folder with the file selected.</summary>
        public static string ExplorerArguments(string path, bool isFolder)
        {
            return isFolder ? $"\"{path}\"" : $"/select,\"{path}\"";
        }

        /// <summary>The clipboard needs an STA thread, hence -STA.</summary>
        public static string[] PowerShellArguments(string script)
        {
            return new[] { "-NoProfile", "-NonInteractive", "-STA", "-Command", script };
        }
    }
}
