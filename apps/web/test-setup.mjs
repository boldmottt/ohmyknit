// 테스트(Node)에서는 Vite가 바이너리를 JS에 넣어 주지 않아서 마네킹 모델 파일을 직접 읽어 넘겨요
// (받아 두지 않았으면 그대로 → 그 몸은 계산으로 만든 마네킹으로 테스트하고, 3D 모델 테스트는 건너뜀)
import { existsSync, readFileSync } from 'node:fs';
import { setFormBytes } from './src/sim/formMesh';

for (const kind of ['female', 'male']) {
  const file = new URL(`./src/sim/assets/form-${kind}.bin`, import.meta.url);
  if (existsSync(file)) setFormBytes(kind, new Uint8Array(readFileSync(file)));
}
