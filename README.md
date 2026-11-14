# 뜨개옷장 (KnitCloset) 🧶

도안을 내 손에 맞게 바꿔 주고, 뜨는 과정을 옷장 속 옷처럼 지켜보게 해 주는 나만의 뜨개 작업실.

- 기획서: [`docs/PLAN.md`](docs/PLAN.md)
- 참고 화면: [`docs/reference/knithub-chart-editor.png`](docs/reference/knithub-chart-editor.png)

## 구조

```
packages/
└─ gauge-engine/   게이지 변환, 늘림·줄임 재분배, rowTable, 진척도, 손 보정 계수 (M1)
```

## 개발

```bash
pnpm install
pnpm test        # 전체 테스트
pnpm typecheck
```
