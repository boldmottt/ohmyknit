import type { ProgressSnapshot } from '@knitcloset/gauge-engine';
import type { WorkData } from '../api';
import { convertedPiece, expectedLengthCm, formatHours, overall, pieceStitchProgress, remainingMinutes } from '../derive';
import { pct } from '../ui';

type Props = {
  data: WorkData;
  snapshots: Record<string, ProgressSnapshot>;
  activePieceId: string;
  onPick: (pieceId: string) => void;
};

/**
 * 완성본과 비교하기 (기획서 5.4 ②, F4-6).
 * 조각들을 조립된 모습으로 늘어놓고, 콧수 기준 진척도로 아래부터 칠합니다.
 */
export function Compare({ data, snapshots, activePieceId, onPick }: Props) {
  const all = overall(data, snapshots);
  const pieces = data.pieces.map((p) => {
    const conv = convertedPiece(data, p.id)!;
    const snap = snapshots[p.id]!;
    const prog = pieceStitchProgress(conv, snap);
    const maxSt = Math.max(...conv.rows.map((r) => (conv.construction === 'round' ? r.stitchesWorked / 2 : r.stitchesWorked)));
    return { p, conv, snap, prog, w: maxSt, h: conv.totalRows };
  });
  // 가장 큰 조각을 가운데, 나머지는 양옆에 번갈아
  const sorted = [...pieces].sort((a, b) => b.w * b.h - a.w * a.h);
  const center = sorted[0]!;
  const sides = sorted.slice(1);
  const left = sides.filter((_, i) => i % 2 === 0);
  const right = sides.filter((_, i) => i % 2 === 1);
  const scale = 220 / Math.max(...pieces.map((x) => x.h), 1);
  const gap = 10;
  const order = [...left.reverse(), center, ...right];
  let x = 0;
  const placed = order.map((it) => {
    const w = it.w * scale * 0.86;
    const h = it.h * scale;
    const r = { ...it, x, y: 240 - h, wPx: w, hPx: h };
    x += w + gap;
    return r;
  });
  const totalW = x - gap;
  const activeConv = convertedPiece(data, activePieceId);
  const activeSnap = snapshots[activePieceId];
  const remainMin = remainingMinutes(data, all.total - all.done);

  return (
    <div className="compare">
      <svg viewBox={`-10 -10 ${totalW + 20} 270`} role="img" aria-label={`전체 ${pct(all.ratio)} 완성`}>
        {placed.map(({ p, conv, prog, x: px, y, wPx, hPx }) => {
          const fillH = hPx * prog.ratio;
          const fromTop = conv.direction === 'top_down';
          const isActive = p.id === activePieceId;
          return (
            <g key={p.id} onClick={() => onPick(p.id)} style={{ cursor: 'pointer' }}>
              <rect x={px} y={y} width={wPx} height={hPx} rx={6} className="cmp-shape" strokeWidth={isActive ? 3 : 1} />
              <rect
                x={px}
                y={fromTop ? y : y + hPx - fillH}
                width={wPx}
                height={fillH}
                rx={6}
                className="cmp-fill"
                style={{ fill: data.converted.palette[0]?.hex }}
              />
              <text x={px + wPx / 2} y={y + hPx / 2 - 6} textAnchor="middle" className="cmp-label">
                {p.name}
              </text>
              <text x={px + wPx / 2} y={y + hPx / 2 + 14} textAnchor="middle" className="cmp-label num">
                {pct(prog.ratio)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="cmp-sum">
        <b>전체 {pct(all.ratio)} 완성</b>
        {activeConv && activeSnap && (
          <div className="num">
            {activeConv.name} 현재 길이 {expectedLengthCm(data, activeSnap.currentRow)}cm / 목표 {expectedLengthCm(data, activeConv.totalRows)}cm
          </div>
        )}
        <div className="num muted">
          남은 코 약 {Math.max(0, all.total - all.done).toLocaleString('ko-KR')}코
          {remainMin !== null ? ` · 약 ${formatHours(remainMin)}` : ''}
        </div>
        <div className="muted small">조각을 누르면 그 조각으로 이동해요</div>
      </div>
    </div>
  );
}
