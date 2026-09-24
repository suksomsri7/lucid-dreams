#!/bin/bash
# สำรองทั้ง repo (ทุก branch) เป็น git bundle ขึ้น Google Drive (gdrive-own:) — ที่พักนอกเครื่องแม้ยังไม่มี GitHub
set -e
cd /root/projects/lucid-dreams
f="/tmp/lucid-dreams-$(date +%F_%H%M).bundle"
git bundle create "$f" --all -q
rclone copy "$f" gdrive-own:VPS-Archive/lucid-dreams/ --quiet && echo "backup → gdrive-own:VPS-Archive/lucid-dreams/$(basename $f)"
rm -f "$f"
# เก็บแค่ 10 ไฟล์ล่าสุดบน Drive
rclone lsf gdrive-own:VPS-Archive/lucid-dreams/ | sort | head -n -10 | while read old; do rclone deletefile "gdrive-own:VPS-Archive/lucid-dreams/$old"; done
