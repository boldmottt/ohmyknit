import { useRef } from 'react';
import { NO_STITCH, type Yarn } from '@knitcloset/pattern-schema';
import { shade } from '@knitcloset/knit-render';

export type Tool = 'paint' | 'nostitch' | 'fill' | 'pick';

type Props = {
  grid: number[][];
  yarns: Yarn[];
  cell: number;
  onStroke: (r: number, c: number, first: boolean) => void;
  onStrokeEnd: () => void;
};

/**
 * 차트 편집 격자. 단 번호는 아래부터(양옆), 코 번호는 오른쪽부터(위아래).
 * 칸에는 실 번호, 코 없음 칸은 비워서 빗금으로 보여 줘요.
 */
export function ChartGrid({ grid, yarns, cell, onStroke, onStrokeEnd }: Props) {
  const down = useRef(false);
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  const colNums = (
    <div className="cg-row cg-nums">
      <span className="cg-side" />
      {[...Array(w).keys()].map((i) => (
        <span key={i} className="cg-num num">{w - i}</span>
      ))}
      <span className="cg-side" />
    </div>
  );
  const at = (e: React.PointerEvent) => {
    const el = (e.target as HTMLElement).closest('[data-r]') as HTMLElement | null;
    if (!el) return null;
    return { r: Number(el.dataset.r), c: Number(el.dataset.c) };
  };
  return (
    <div
      className="chart-grid"
      style={{ ['--cg' as string]: `${cell}px` }}
      onPointerDown={(e) => {
        const p = at(e);
        if (!p) return;
        e.preventDefault();
        down.current = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        onStroke(p.r, p.c, true);
      }}
      onPointerMove={(e) => {
        if (!down.current) return;
        const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        const cellEl = el?.closest('[data-r]') as HTMLElement | null;
        if (cellEl) onStroke(Number(cellEl.dataset.r), Number(cellEl.dataset.c), false);
      }}
      onPointerUp={() => {
        if (down.current) onStrokeEnd();
        down.current = false;
      }}
      onPointerCancel={() => {
        if (down.current) onStrokeEnd();
        down.current = false;
      }}
      role="grid"
      aria-label={`차트 ${w}코 × ${h}단`}
    >
      {colNums}
      {[...Array(h).keys()].reverse().map((r) => (
        <div key={r} className="cg-row" role="row">
          <span className="cg-side num">{r + 1}</span>
          {grid[r]!.map((v, c) => {
            const y = v === NO_STITCH ? undefined : yarns[v];
            return (
              <span
                key={c}
                role="gridcell"
                data-r={r}
                data-c={c}
                className={`cg-cell${v === NO_STITCH ? ' none' : ''}`}
                style={y ? { background: y.hex, color: shade(y.hex, -0.62) } : undefined}
                aria-label={`${r + 1}단 ${w - c}코: ${v === NO_STITCH ? '코 없음' : (y?.name ?? '')}`}
              >
                {v === NO_STITCH ? '' : cell >= 16 ? v + 1 : ''}
              </span>
            );
          })}
          <span className="cg-side num">{r + 1}</span>
        </div>
      ))}
      {colNums}
    </div>
  );
}
