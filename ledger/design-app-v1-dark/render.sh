#!/bin/bash
# ./render.sh 02-tonight "ชื่อหน้า" [WxH]   → build html + screenshot png
# โปรไฟล์ chromium แยกต่อรอบ + ลบทิ้งทันที (snap เก็บโปรไฟล์ไว้เคยทำดิสก์เต็ม)
set -e
cd "$(dirname "$0")"
n="$1"; t="$2"; sz="${3:-1500,1000}"
./mk.sh "$n.body.html" "$t" >/dev/null
d="/root/snap/chromium/common/ld-$$-$RANDOM"; mkdir -p "$d"
mkdir -m 700 -p /tmp/xdg-chromium
XDG_RUNTIME_DIR=/tmp/xdg-chromium timeout 90 /snap/bin/chromium --headless --no-sandbox --disable-gpu --hide-scrollbars \
  --user-data-dir="$d" --window-size="$sz" \
  --screenshot="$PWD/$n.png" "file://$PWD/$n.html" 2>/dev/null || true
rm -rf "$d"
[ -s "$n.png" ] && echo "rendered $n.png ($sz)" || { echo "FAILED $n.png"; exit 1; }
