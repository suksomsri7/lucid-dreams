#!/bin/bash
# สร้างภาพเทียบ "แบบ | ของจริง" : ./scripts/parity.sh <mockup.png> <frameIndex 0..n> <shot.png> <out.png> [frameW=390 gap=22 left=26 top=60]
# mockup ของเราเป็นแถวกรอบ iPhone กว้าง 390 เว้น 22 เริ่ม x=26 (ดู _base.part .wrap/.rowf) · ครอปกรอบที่ index แล้ววางคู่ภาพจริง
python3 - "$@" <<'PY'
import sys
from PIL import Image, ImageDraw, ImageFont
mock, idx, shot, out = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
fw = int(sys.argv[5]) if len(sys.argv) > 5 else 390; gap = int(sys.argv[6]) if len(sys.argv) > 6 else 22
left = int(sys.argv[7]) if len(sys.argv) > 7 else 26; top = int(sys.argv[8]) if len(sys.argv) > 8 else 60
m = Image.open(mock).convert('RGB'); s = Image.open(shot).convert('RGB')
x0 = left + idx * (fw + gap)
# หาขอบบนของกรอบ: สแกนหาแถวแรกที่ต่างจากพื้นเวทีในคอลัมน์กลางกรอบ
cx = x0 + fw // 2; bg = m.getpixel((cx, 5)); y0 = top
for y in range(40, min(200, m.height)):
    if sum(abs(a - b) for a, b in zip(m.getpixel((cx, y)), bg)) > 30: y0 = y; break
crop = m.crop((x0, y0, x0 + fw, min(y0 + 844, m.height)))
h = max(crop.height, s.height)
canvas = Image.new('RGB', (crop.width + s.width + 30, h + 40), (245, 246, 248))
d = ImageDraw.Draw(canvas)
canvas.paste(crop, (0, 40)); canvas.paste(s, (crop.width + 30, 40))
d.text((8, 12), "MOCKUP", fill=(60, 65, 80)); d.text((crop.width + 38, 12), "RENDER", fill=(60, 65, 80))
canvas.save(out); print("parity →", out, canvas.size)
PY
