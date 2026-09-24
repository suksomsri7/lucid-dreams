#!/bin/bash
# snapshot ทุก worktree ที่ active ทุก 10 นาที (systemd timer) — builder เขียนไปเรื่อย ๆ ก็มี commit
# ถ้ามี remote 'origin' จะ push branch นั้นด้วย · ไม่แตะ main
for wt in /root/projects/lucid-dreams-*; do
  [ -d "$wt/.git" ] || [ -f "$wt/.git" ] || continue
  cd "$wt" || continue
  br=$(git rev-parse --abbrev-ref HEAD 2>/dev/null); case "$br" in wo/*) ;; *) continue;; esac
  if [ -n "$(git status --porcelain)" ]; then
    git add -A && git commit -qm "autosave $(date +%F_%H:%M) [$br]" && echo "autosave $wt $br"
  fi
  git remote get-url origin >/dev/null 2>&1 && git push -q -u origin "$br" 2>/dev/null
done
# main repo: ledger เปลี่ยน (RUN-STATE/§3.1) แต่ยังไม่ commit → commit ด้วย
cd /root/projects/lucid-dreams && if [ -n "$(git status --porcelain ledger)" ]; then git add ledger && git commit -qm "autosave ledger $(date +%F_%H:%M)"; fi
git remote get-url origin >/dev/null 2>&1 && git push -q origin HEAD 2>/dev/null
exit 0
