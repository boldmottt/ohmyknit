/// <reference lib="webworker" />
import { simulate, type ClothInput } from './cloth';

/** 천 시뮬레이션은 몇 초 걸릴 수 있어서 화면이 멈추지 않게 따로 돌려요 */
self.onmessage = (e: MessageEvent<{ id: number; input: ClothInput }>) => {
  const out = simulate(e.data.input);
  const transfer: Transferable[] = [...out.pos.map((p) => p.buffer), ...out.ao.map((a) => a.buffer), out.occ.grid.buffer];
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id: e.data.id, out }, transfer);
};
