#!/bin/bash
# รันงานหนักแยก unit (รอดแม้ session ตาย) : ./scripts/heavy.sh <ชื่อ> <คำสั่ง...>
# ผล: .heavy/<ชื่อ>.log และ .heavy/<ชื่อ>.exit · ดูสถานะ systemctl status lucid-<ชื่อ>
set -u
name="$1"; shift
root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$root/.heavy"; rm -f "$root/.heavy/$name.exit"
systemctl stop "lucid-$name" 2>/dev/null || true; systemctl reset-failed "lucid-$name" 2>/dev/null || true
systemd-run --unit="lucid-$name" --collect --same-dir --setenv=PATH="$PATH" --setenv=HOME=/root -p MemoryMax=3G \
  bash -c "cd '$root' && ( $* ) > '.heavy/$name.log' 2>&1; echo \$? > '.heavy/$name.exit'"
echo "started lucid-$name → .heavy/$name.log (รอ .exit)"
