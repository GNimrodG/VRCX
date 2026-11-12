using System;

namespace VRCX
{
    /// <summary>
    /// Entry point for Electron's main process (src-electron/main.js, via node-api-dotnet in the same process) to
    /// hand the offscreen overlay window's BGRA paint bitmap to the VR overlay thread on native Windows, where the
    /// Linux /dev/shm file transport does not exist. A JS Buffer/Uint8Array marshals to Memory&lt;byte&gt; without a copy.
    /// </summary>
    public class OverlayFrameSinkElectron
    {
        public void Submit(Memory<byte> frame)
        {
            VRCXVRElectron.FrameMailbox.Post(frame.Span);
        }
    }
}
