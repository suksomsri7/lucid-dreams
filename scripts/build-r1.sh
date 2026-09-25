#!/bin/bash
# ยิง EAS build รอบ R1 (iOS internal distribution) — **รันเมื่อเจ้าของสั่งเท่านั้น** (APP-RUN §0.2 · feedback_no_eas_build_without_order)
# ใช้: bash scripts/build-r1.sh [profile=r1-internal]   → ต้องมี /root/.lucid/expo.env + /root/.lucid/asc.env (chmod 600 นอก repo)
set -euo pipefail
prof="${1:-r1-internal}"
for f in /root/.lucid/expo.env /root/.lucid/asc.env; do [ -r "$f" ] || { echo "missing $f" >&2; exit 2; }; done
set -a; . /root/.lucid/expo.env; . /root/.lucid/asc.env; set +a
[ -r "$EXPO_ASC_API_KEY_PATH" ] || { echo "missing ASC key file" >&2; exit 2; }
cd "$(dirname "$0")/../apps/mobile"
# non-interactive: EAS ใช้ ASC API key (EXPO_ASC_*) สร้าง dist cert + provisioning + จด bundle id ลูก (.watch/.widget/.complication) เอง
exec npx eas-cli@latest build --platform ios --profile "$prof" --non-interactive --no-wait
