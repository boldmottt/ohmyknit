# 마네킹 3D 모델

- `form-female.bin` — 여자 마네킹. 원본: “Free Female Mannequin Base Mesh” by Devlane
  (https://sketchfab.com/3d-models/free-female-mannequin-base-mesh-187300a221c04178b96b84bf9cab97e0),
  Sketchfab Standard 라이선스 (가족끼리 쓰는 앱, 앱 설정 화면에 출처 표시).
- **저장소에는 없어요** (`.gitignore`): Standard 라이선스는 앱 안에서 쓰는 건 되지만 파일 자체의 재배포를 막아서,
  공개 저장소에 올리면 누구나 받을 수 있게 돼요. 각자 `SKETCHFAB_TOKEN=… pnpm form:fetch`로 받아요 (`docs/SETUP.md` 8-1).
  파일이 없으면 `formMesh.ts`가 빈 목록을 받아 계산으로 만든 마네킹을 쓰고, 3D 모델 테스트는 건너뛰어요.
- `pnpm form:fetch`(`scripts/form-fetch.mjs`)는 Sketchfab API로 GLB를 받아 아래 변환을 돌려요. 손으로 하려면
  `node scripts/form-mesh.mjs <model.glb> src/sim/assets/form-female.bin 178`
  - cm 단위·발바닥 0·허리 가운데로 맞추고, 같은 자리 꼭짓점을 합침
  - 원본은 두께 있는 껍데기라 겉면 안쪽에 속면이 있어서, 0.25cm 격자로 몸 속 빈 공간을 찾아 그쪽을 보는 속면을 뺌 (삼각형 절반)
  - 드레스폼처럼 가슴 꼭지를 없앰: 꼭지 둘레 가슴 면에 맞춘 공 위로 옮김
  - 위치 16비트·삼각형 번호 차이값 압축 (325KB)
- 앱에서는 `formMesh.ts`가 읽고 `formFit.ts`가 높이마다 잘라 몸통·팔·다리·관절을 찾아 천 시뮬레이션 부딪힘 모양을 만들어요.
