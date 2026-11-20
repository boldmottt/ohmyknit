# 맥북 설치 가이드 (M0)

뜨개옷장을 맥북에서 상시 실행하고, 아이패드·아이폰에서 안전하게 접속하는 방법이에요.
위에서부터 순서대로 하면 됩니다. 각 단계 끝에 "확인" 항목이 있어요.

## 1. 준비물

| 항목 | 설치 |
|---|---|
| Node.js 22.13 이상 | `brew install node@22` (또는 nvm) |
| pnpm | `corepack enable` (Node에 포함) |
| cloudflared | `brew install cloudflared` |
| Cloudflare 계정 + 도메인 | Tunnel과 Access에 필요 (무료 플랜으로 충분) |

## 2. 받아서 처음 실행

```bash
git clone https://github.com/boldmottt/knitcloset.git   # 레포 이름을 바꾸기 전이면 ohmyknit
cd knitcloset
pnpm install
pnpm test                 # 162개 테스트가 통과해야 해요
pnpm dev                  # 웹 빌드 → DB 마이그레이션 → 서버 (http://127.0.0.1:8787)
```

브라우저에서 http://127.0.0.1:8787 을 열고 네임태그를 만들어 보세요.
데이터는 레포 안 `data/` 폴더에 저장되고, git에는 올라가지 않아요.

**AI 도안 기능을 쓰려면** (선택):

```bash
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
# .dev.vars 파일을 열어 ANTHROPIC_API_KEY= 뒤에 키를 붙여 넣기
```

✅ 확인: 옷장 문이 열리고, "＋ 새 작품"에서 샘플 도안으로 프로젝트를 만들 수 있어요.

> 화면만 고칠 때는 `pnpm dev:web`(Vite, 핫 리로드)을 서버와 함께 켜면 편해요. `/api`는 8787로 넘어가요.

## 3. 맥북이 잠들지 않게 + 자동 실행

```bash
./scripts/install-launchd.sh
```

두 가지가 등록돼요.

| 이름 | 하는 일 |
|---|---|
| `com.knitcloset.server` | 로그인하면 서버를 켜고, 꺼지면 다시 켬. `caffeinate -s`로 **전원 연결 중에는 잠자기 방지** |
| `com.knitcloset.backup` | 매일 03:00 백업 (그 시각에 잠들어 있었으면 깨어난 뒤 실행) |

추가로 **시스템 설정 → 배터리(또는 에너지) → 옵션**에서 "전원 어댑터 연결 시 디스플레이가 꺼져 있을 때 자동으로 잠자기 방지"를 켜 두면 더 확실해요.
덮개를 닫아도 계속 돌리려면 외장 모니터 없이도 동작하도록 전원을 연결해 두세요.

로그: `data/logs/server.log`, `data/logs/backup.log` · 지우기: `./scripts/install-launchd.sh uninstall`

✅ 확인: 맥을 재시동하고 로그인만 해도 http://127.0.0.1:8787 이 열려요.

## 4. 밖에서 접속하기: Cloudflare Tunnel

포트를 열지 않고, 맥에서 Cloudflare로 나가는 연결만 만들어요.

```bash
cloudflared tunnel login                         # 브라우저에서 도메인 고르기
cloudflared tunnel create knitcloset             # ~/.cloudflared/<터널ID>.json 생성
cloudflared tunnel route dns knitcloset knit.<내 도메인>
cp scripts/cloudflared/config.example.yml ~/.cloudflared/config.yml
# config.yml의 credentials-file 경로와 hostname을 내 값으로 고치기
cloudflared tunnel run knitcloset                # 테스트 실행 (Ctrl+C로 끄기)
```

잘 되면 서비스로 등록해서 맥이 켜질 때 함께 켜지게 해요.

```bash
sudo cloudflared service install
```

> 서비스 등록 방식은 cloudflared 버전마다 조금씩 달라요. 안 되면 Cloudflare 문서의 "Run as a service → macOS"를 따라 주세요.

⚠ **다음 단계(Access)를 마치기 전에는 주소를 다른 사람에게 알려 주지 마세요.** 이 단계까지만 하면 주소를 아는 누구나 들어올 수 있어요.

## 5. 가족만 들어오게: Cloudflare Access

1. Cloudflare 대시보드 → **Zero Trust** → Access → Applications → **Add an application** → Self-hosted
2. Application domain: `knit.<내 도메인>`
3. Session duration: **1 month** 정도로 길게 (뜨다가 로그인 화면이 뜨면 번거로워요)
4. Policy: Action **Allow**, Include → **Emails**에 두 사람의 이메일
5. 로그인 방법은 기본 "One-time PIN"(이메일로 코드 받기)이면 충분해요

✅ 확인: 아이폰에서 `https://knit.<내 도메인>` → 이메일 코드 입력 → 옷장이 보여요. 다른 이메일로는 못 들어와요.

> 서버는 `127.0.0.1`에만 열려 있어서, 집 와이파이의 다른 기기도 Tunnel(+Access)을 거쳐야만 들어올 수 있어요.

## 6. 아이패드·아이폰에 앱처럼 설치 (PWA)

Safari에서 주소를 열고 **공유 → 홈 화면에 추가**. 이렇게 설치하면

- 전체 화면으로 열리고
- 맥북이 잠들거나 와이파이가 끊겨도 **작업 화면 카운터가 계속 동작**해요. 누른 기록은 기기에 쌓였다가 다시 연결되면 자동으로 보내져요 (상단에 `⚡ 오프라인 (N개 대기)` 표시)

> Access 로그인 기간(1달)이 지나면 한 번 다시 로그인해야 해요. 그동안 쌓인 기록은 지워지지 않아요.

## 7. 블루투스 페이지 터너 · 발판 (추천)

대부분 키보드처럼 `PageDown/PageUp` 또는 `→/←` 신호를 보내서 **추가 설정 없이** 작업 화면에서 +1 / −1로 동작해요.
아이패드와 블루투스로 연결한 뒤 작업 화면을 열어 두기만 하면 돼요. 집중 모드(F)와 함께 쓰면 손을 전혀 안 써도 돼요.

## 8. 백업과 되돌리기

```bash
pnpm backup                                   # 지금 바로 백업
pnpm restore ~/…/knitcloset-20261114-030000.tar.gz   # 되돌리기 (먼저 서버 끄기)
```

- 저장 위치: iCloud Drive가 있으면 `iCloud Drive/KnitCloset-backups`, 없으면 `~/KnitCloset-backups` (`BACKUP_DIR`로 바꿀 수 있어요)
- 들어 있는 것: DB 스냅숏(`d1.sqlite`), SQL 덤프(`d1.sql`), 사진·PDF(`r2/`), 서버가 켜져 있으면 JSON(`export.json`)
- 30일 지난 백업은 자동으로 지워져요 (`KEEP_DAYS`)
- 되돌리면 지금 데이터는 `data.before-restore-<시각>` 폴더로 옮겨 둬요

서버를 끄려면: `launchctl bootout gui/$(id -u)/com.knitcloset.server` (다시 켜기: `./scripts/install-launchd.sh`)

## 9. 문제가 생기면

| 증상 | 확인할 것 |
|---|---|
| 아이패드에서 "서버에 연결할 수 없어요" | 맥이 잠들었는지, `data/logs/server.log`, `cloudflared` 실행 여부 |
| "서버 응답을 읽지 못했어요" | Access 로그인이 만료됐을 수 있어요. 앱을 닫고 다시 열어 로그인 |
| AI 기능이 꺼져 있다고 나옴 | `apps/worker/.dev.vars`의 키 확인 후 서버 재시작 |
| 업데이트 후 화면이 예전 그대로 | 앱을 완전히 닫았다 열기 (서비스 워커가 새 버전을 받아요) |

업데이트할 때는 `git pull && pnpm install && pnpm build` 후 서버를 재시작하세요 (`launchctl kickstart -k gui/$(id -u)/com.knitcloset.server`).
