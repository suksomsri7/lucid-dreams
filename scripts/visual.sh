#!/bin/bash
# ถ่ายภาพจอจาก web export เพื่อเทียบ mockup : ./scripts/visual.sh <worktree> <wo> <route1,route2,...> [lang=th]
# ผล: <main repo>/.qc-shots/<wo>/<route>-<lang>.png  (โปรไฟล์ chromium ชั่วคราว ลบทิ้งทุกครั้ง)
set -u
wt="$1"; wo="$2"; routes="$3"; lang="${4:-th}"
out="/root/projects/lucid-dreams/.qc-shots/$wo"; mkdir -p "$out"
dist="$wt/apps/mobile/dist"; [ -f "$dist/index.html" ] || { echo "ไม่มี $dist/index.html"; exit 1; }
port=$((41000 + RANDOM % 1000))
ss -lntp 2>/dev/null | grep -q ":$port " && port=$((port+1))
setsid npx --yes serve -s "$dist" -l $port >/tmp/visual-serve-$wo.log 2>&1 < /dev/null &
spid=$!
for i in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:$port/" && break; sleep 1; done
d="/root/snap/chromium/common/vis-$$"; mkdir -p "$d"; mkdir -m 700 -p /tmp/xdg-chromium
IFS=',' read -ra R <<< "$routes"
for r in "${R[@]}"; do
  name=$(echo "$r" | sed 's#^/##; s#/#_#g; s#[?&=]#-#g'); [ -z "$name" ] && name=index
  XDG_RUNTIME_DIR=/tmp/xdg-chromium timeout 60 /snap/bin/chromium --headless --no-sandbox --disable-gpu --hide-scrollbars \
    --user-data-dir="$d" --window-size=390,844 --lang=$lang --virtual-time-budget=8000 \
    --screenshot="$out/$name-$lang.png" "http://127.0.0.1:$port$r" 2>/dev/null
  [ -s "$out/$name-$lang.png" ] && echo "shot $out/$name-$lang.png" || echo "FAILED $r"
done
rm -rf "$d"; kill $spid 2>/dev/null; pkill -f "serve -s $dist -l $port" 2>/dev/null; exit 0
