#!/usr/bin/env bash
# Regenerates images/VRCX_notify_<color>.{png,ico} from images/VRCX_notify.png.
# The source icon's body is monochrome and only the dot is saturated (red), so a
# pure hue rotation recolors the dot and leaves the rest untouched.
# Colors/angles must match TRAY_DOT_COLORS in src/shared/constants/trayDot.js
# (a test enforces that the files exist for every color).
set -euo pipefail
cd "$(dirname "$0")/../images"
declare -A SHIFT=([orange]=30 [yellow]=55 [green]=125 [cyan]=180 [blue]=215 [purple]=275)
for name in "${!SHIFT[@]}"; do
    # -modulate hue: 100 = unchanged, 200 = +360deg, so degrees / 1.8 + 100
    hue=$(awk -v d="${SHIFT[$name]}" 'BEGIN{printf "%.2f", 100 + d/1.8}')
    magick VRCX_notify.png -modulate 100,100,"$hue" "VRCX_notify_${name}.png"
    magick "VRCX_notify_${name}.png" -define icon:auto-resize=256,128,64,48,32,16 "VRCX_notify_${name}.ico"
done
