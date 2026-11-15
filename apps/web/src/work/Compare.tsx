import { useEffect, useRef, useState } from 'react';
import type { ProgressSnapshot } from '@knitcloset/gauge-engine';
import type { WorkData } from '../api';
import { artPieces, drawAssembled, type PlacedPiece } from '../closet/assembledArt';
import { convertedPiece, expectedLengthCm, formatHours, overall, pieceStitchProgress, remainingMinutes } from '../derive';
import { pct } from '../ui';

type Props = {
  data: WorkData;
  snapshots: Record<string, ProgressSnapshot>;
  activePieceId: string;
  onPick: (pieceId: string) => void;
};

const W = 560;
const H = 520;

/**
 * 완성본과 비교하기 (기획서 5.4 ②, F4-6).
 * 변환된 도안 그대로 조각마다 실제 니트를 그리고, **지금까지 뜬 단(과 코)까지만** 선명하게 보여요.
 * 조각들은 실제 cm 비율로 옷 모양으로 조립합니다.
 */
export function Compare({ data, snapshots, activePieceId, onPick }: Props) {
  const all = overall(data, snapshots);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [placed, setPlaced] = useState<PlacedPiece[]>([]);
  const convId = convertedPiece(data, activePieceId)?.id;

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    // 레티나에서도 실 결이 보이게 2배로
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const res = drawAssembled(ctx, { pieces: artPieces(data, snapshots), palette: data.converted.palette, width: W, height: H, hanger: false, activeId: convId });
    setPlaced(res ?? []);
  }, [data, snapshots, convId]);

  const pieces = data.pieces.map((p) => {
    const conv = convertedPiece(data, p.id)!;
    const snap = snapshots[p.id]!;
    return { p, conv, prog: pieceStitchProgress(conv, snap) };
  });
  const activeConv = convertedPiece(data, activePieceId);
  const activeSnap = snapshots[activePieceId];
  const remainMin = remainingMinutes(data, all.total - all.done);

  const pickAt = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * H;
    // 몸판이 맨 위에 그려지므로 뒤에서부터 찾음
    const hit = [...placed].reverse().find((q) => x >= q.box.x && x <= q.box.x + q.box.w && y >= q.box.y && y <= q.box.y + q.box.h);
    const st = hit && data.pieces.find((p) => convertedPiece(data, p.id)?.id === hit.id);
    if (st) onPick(st.id);
  };

  return (
    <div className="compare">
      <div className="cmp-art">
        <canvas ref={canvas} width={W * 2} height={H * 2} onClick={pickAt} role="img" aria-label={`전체 ${pct(all.ratio)} 완성. 뜬 부분만 선명하게 보여요`} />
        <div className="cmp-pieces" role="group" aria-label="조각">
          {pieces.map(({ p, prog }) => (
            <button key={p.id} className={`chip${p.id === activePieceId ? ' on' : ''}`} onClick={() => onPick(p.id)}>
              {p.name} <span className="num">{pct(prog.ratio)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="cmp-sum">
        <b>전체 {pct(all.ratio)} 완성</b>
        {activeConv && activeSnap && (
          <div className="num">
            {activeConv.name} 현재 길이 {expectedLengthCm(data, activeSnap.currentRow, activeConv)}cm / 목표 {expectedLengthCm(data, activeConv.totalRows, activeConv)}cm
          </div>
        )}
        <div className="num muted">
          남은 코 약 {Math.max(0, all.total - all.done).toLocaleString('ko-KR')}코
          {remainMin !== null ? ` · 약 ${formatHours(remainMin)}` : ''}
        </div>
        <div className="muted small">옷의 조각이나 아래 이름을 누르면 그 조각으로 이동해요 · 선명한 부분이 실제로 뜬 곳이에요</div>
      </div>
    </div>
  );
}
