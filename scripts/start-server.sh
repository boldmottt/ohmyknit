#!/bin/bash
# 맥북에서 뜨개옷장 서버를 켭니다. launchd가 로그인할 때 실행해요.
# caffeinate -s: 전원 연결 중에는 맥이 잠들지 않게 (기획서 2.3)
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/share/pnpm:$PATH"
[ -d node_modules ] || pnpm install --frozen-lockfile
[ -f apps/web/dist/index.html ] || pnpm build
pnpm migrate
exec caffeinate -s pnpm --filter @knitcloset/worker serve
