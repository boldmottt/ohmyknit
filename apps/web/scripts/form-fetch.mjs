// 여자 마네킹 3D 모델을 Sketchfab에서 받아 앱에 넣는 파일로 바꿔요 (한 번만 하면 돼요).
//
//   SKETCHFAB_TOKEN=내_토큰 pnpm form:fetch      (그다음 pnpm build, 서버 다시 켜기)
//
// 토큰: sketchfab.com에 로그인 → Settings → Password & API → API Token 복사.
// 모델은 Sketchfab Standard 라이선스라 앱 안에서 쓰는 건 되지만 파일 자체를 나눠 주면 안 돼서
// 공개 저장소에 올리지 않아요. 받은 파일(apps/web/src/sim/assets/form-female.bin)은 .gitignore에 있고,
// 없으면 앱은 계산으로 만든 마네킹을 보여 줘요.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** “Free Female Mannequin Base Mesh” by Devlane — https://sketchfab.com/3d-models/free-female-mannequin-base-mesh-187300a221c04178b96b84bf9cab97e0 */
const MODELS = [{ kind: 'female', uid: '187300a221c04178b96b84bf9cab97e0', heightCm: 178 }];

const here = dirname(fileURLToPath(import.meta.url));
const token = process.env.SKETCHFAB_TOKEN;
if (!token) {
  console.error('SKETCHFAB_TOKEN이 필요해요. 예: SKETCHFAB_TOKEN=내_토큰 pnpm form:fetch');
  console.error('토큰은 sketchfab.com 로그인 → Settings → Password & API → API Token 에 있어요.');
  process.exit(1);
}

for (const m of MODELS) {
  const res = await fetch(`https://api.sketchfab.com/v3/models/${m.uid}/download`, { headers: { Authorization: `Token ${token}` } });
  if (res.status === 401 || res.status === 403) throw new Error('Sketchfab이 토큰을 받지 않았어요. 토큰을 다시 복사해 주세요.');
  if (!res.ok) throw new Error(`Sketchfab 응답 ${res.status}`);
  const { glb } = await res.json();
  if (!glb?.url) throw new Error('이 모델의 GLB 파일 주소를 받지 못했어요.');
  const file = await fetch(glb.url);
  if (!file.ok) throw new Error(`모델 파일 받기 실패 ${file.status}`);
  const dir = mkdtempSync(join(tmpdir(), 'knitcloset-form-'));
  try {
    const glbPath = join(dir, 'model.glb');
    writeFileSync(glbPath, Buffer.from(await file.arrayBuffer()));
    const out = join(here, '..', 'src', 'sim', 'assets', `form-${m.kind}.bin`);
    execFileSync(process.execPath, [join(here, 'form-mesh.mjs'), glbPath, out, String(m.heightCm)], { stdio: 'inherit' });
    console.log(`✓ ${m.kind} 마네킹 → ${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log('이제 pnpm build 하고 서버를 다시 켜면 새 마네킹이 보여요.');
