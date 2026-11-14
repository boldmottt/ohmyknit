#!/bin/bash
# 서버 자동 실행 + 매일 03:00 백업을 launchd에 등록합니다 (맥 전용).
# 지우기: ./scripts/install-launchd.sh uninstall
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
NODE="$(command -v node)"
mkdir -p "$AGENTS" "$REPO/data/logs"
for name in server backup; do
  label="com.knitcloset.$name"
  dest="$AGENTS/$label.plist"
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  if [ "${1:-}" = "uninstall" ]; then
    rm -f "$dest"
    echo "지움: $label"
    continue
  fi
  sed -e "s#__REPO__#$REPO#g" -e "s#__NODE__#$NODE#g" "$REPO/scripts/launchd/$label.plist" > "$dest"
  launchctl bootstrap "gui/$(id -u)" "$dest"
  echo "등록: $label → $dest"
done
