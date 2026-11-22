/**
 * 모델 파일은 저장소에 올리지 않아요: 원본 라이선스(Sketchfab Standard)가 파일 자체의 재배포를 막아서
 * 각자 `pnpm form:fetch`로 받아 둠 (scripts/form-fetch.mjs). 파일이 없으면 빈 목록 → 계산으로 만든 마네킹
 */
const files = import.meta.glob<string>('./assets/form-*.bin', { query: '?inline', import: 'default', eager: true });
const femaleData = files['./assets/form-female.bin'];

/**
 * 마네킹 3D 모델 (scripts/form-mesh.mjs로 만든 바이너리): cm 단위, 발바닥 y = 0, 가운데 x = z = 0.
 */
export type FormMesh = { pos: Float32Array; index: Uint16Array | Uint32Array };

function bytesOf(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

export function decodeForm(u8: Uint8Array): FormMesh {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const magic = String.fromCharCode(u8[0]!, u8[1]!, u8[2]!, u8[3]!);
  if (magic !== 'KCFM') throw new Error('not a form mesh');
  const nv = dv.getUint32(8, true);
  const nt = dv.getUint32(12, true);
  const q = dv.getFloat32(16, true);
  const pos = new Float32Array(nv * 3);
  let o = 24;
  for (let i = 0; i < nv * 3; i++, o += 2) pos[i] = dv.getInt16(o, true) * q;
  const index = nv < 65536 ? new Uint16Array(nt * 3) : new Uint32Array(nt * 3);
  let prev = 0;
  for (let k = 0; k < nt * 3; k++) {
    let z = 0;
    let shift = 0;
    let b: number;
    do {
      b = u8[o++]!;
      z |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    const d = z & 1 ? -((z + 1) >>> 1) : z >>> 1;
    prev += d;
    index[k] = prev;
  }
  return { pos, index };
}

let female: FormMesh | null | undefined;
let given: Uint8Array | null = null;

/** 테스트(Node)에서는 파일을 직접 읽어 넘겨요 (브라우저에서는 JS에 들어 있는 데이터를 씀) */
export function setFemaleFormBytes(u8: Uint8Array) {
  given = u8;
  female = undefined;
}

/** 여자 마네킹 모델 (못 읽으면 null → 계산으로 만든 몸) */
export function femaleForm(): FormMesh | null {
  if (female === undefined) {
    try {
      const src = given ?? (typeof femaleData === 'string' && femaleData.startsWith('data:') ? bytesOf(femaleData) : null);
      female = src ? decodeForm(src) : null;
    } catch {
      female = null;
    }
  }
  return female;
}
