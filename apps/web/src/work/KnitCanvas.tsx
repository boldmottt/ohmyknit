import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConvertedPiece } from '@knitcloset/gauge-engine';
import { drawFabric, drawProgress, fabricLayout, rowAtY, rowTop, type Palette } from '@knitcloset/knit-render';
import type { Note } from '../api';

type Props = {
  piece: ConvertedPiece;
  palette: Palette;
  completedRows: number;
  currentStitch: number;
  hoverRow: number | null;
  onHoverRow: (row: number | null) => void;
  /** "여기까지 다 떴어요" = row단까지 완료 */
  onScrub: (completedRows: number) => void;
  symbols: boolean;
  notes: Note[];
};

function cssVar(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

const ZOOMS = [2.5, 4, 6, 9, 14];

/**
 * ② 시뮬레이션 캔버스 (기획서 5.4).
 * 다 뜬 원단은 오프스크린에 한 번 그리고, 진행·호버·드래그 표시만 다시 그립니다.
 */
export function KnitCanvas({ piece, palette, completedRows, currentStitch, hoverRow, onHoverRow, onScrub, symbols, notes }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoomIdx, setZoomIdx] = useState(1);
  const [back, setBack] = useState(false);
  const [scrubRow, setScrubRow] = useState<number | null>(null);
  const cellW = ZOOMS[zoomIdx]!;
  const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);

  const layout = useMemo(() => fabricLayout(piece, cellW), [piece, cellW]);

  // 다 뜬 모습 (오프스크린)
  const fabric = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = Math.ceil(layout.width * dpr);
    c.height = Math.ceil(layout.height * dpr);
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    drawFabric(ctx, piece, { palette, cellW, symbols, back });
    return c;
  }, [piece, palette, cellW, symbols, back, layout, dpr]);

  const shownRows = scrubRow ?? completedRows;

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = fabric.width;
    c.height = fabric.height;
    c.style.width = `${layout.width}px`;
    c.style.height = `${layout.height}px`;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(fabric, 0, 0);
    ctx.scale(dpr, dpr);
    drawProgress(ctx, piece, layout, {
      completedRows: shownRows,
      currentStitch: scrubRow === null ? currentStitch : 0,
      ghost: cssVar('--ghost', 'rgba(245,238,220,0.78)'),
      highlight: cssVar('--accent', '#7A1F2B'),
    });
    if (hoverRow && hoverRow !== shownRows + 1) {
      ctx.fillStyle = cssVar('--accent', '#7A1F2B');
      ctx.globalAlpha = 0.18;
      ctx.fillRect(0, rowTop(piece, layout, hoverRow), layout.width, layout.cellH);
      ctx.globalAlpha = 1;
    }
    // 메모 핀
    ctx.font = `${Math.max(10, layout.cellH * 2)}px sans-serif`;
    ctx.textBaseline = 'middle';
    for (const n of notes) {
      if (n.row < 1 || n.row > layout.totalRows) continue;
      ctx.fillText('📌', layout.width - Math.max(12, layout.cellH * 2.2), rowTop(piece, layout, n.row) + layout.cellH / 2);
    }
  }, [fabric, piece, layout, shownRows, currentStitch, hoverRow, scrubRow, notes, dpr]);

  // 현재 단이 보이게 자동 스크롤
  useEffect(() => {
    const w = wrapRef.current;
    if (!w || scrubRow !== null) return;
    const row = Math.min(layout.totalRows, completedRows + 1);
    const y = rowTop(piece, layout, row);
    const target = y - w.clientHeight / 2;
    w.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    const x = (layout.width - w.clientWidth) / 2;
    if (x > 0) w.scrollLeft = x;
  }, [completedRows, layout, piece, scrubRow]);

  const press = useRef<{ id: number; y: number; timer?: ReturnType<typeof setTimeout>; active: boolean } | null>(null);
  // 길게 눌러 끌기 시작한 뒤에는 화면이 같이 스크롤되지 않게 막음.
  // (touch-action은 손을 댄 순간에 정해져서 도중에 바꿀 수 없으므로 touchmove를 직접 막아야 해요)
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const block = (e: TouchEvent) => {
      if (press.current?.active) e.preventDefault();
    };
    c.addEventListener('touchmove', block, { passive: false });
    return () => c.removeEventListener('touchmove', block);
  }, []);

  // 드래그로 진행 위치 정하기: 마우스는 바로, 터치는 길게 눌러서 (스크롤과 구분)

  function rowFromEvent(e: React.PointerEvent): number {
    const rect = canvasRef.current!.getBoundingClientRect();
    const y = e.clientY - rect.top;
    // 첫 단보다 바깥으로 끌면 0단 (아직 아무것도 안 뜸)
    const beforeFirst = piece.direction === 'top_down' ? y < 0 : y > layout.height;
    if (beforeFirst) return 0;
    // 손가락 위치의 단까지 "다 뜬" 것으로
    return rowAtY(piece, layout, y);
  }

  function onPointerDown(e: React.PointerEvent) {
    const start = { id: e.pointerId, y: e.clientY, active: e.pointerType === 'mouse' && e.button === 0 } as NonNullable<typeof press.current>;
    press.current = start;
    if (start.active) {
      (e.target as Element).setPointerCapture(e.pointerId);
      setScrubRow(rowFromEvent(e));
    } else if (e.pointerType !== 'mouse') {
      start.timer = setTimeout(() => {
        if (press.current === start) {
          start.active = true;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          setScrubRow(rowFromEvent(e));
          if ('vibrate' in navigator) navigator.vibrate(15);
        }
      }, 350);
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const p = press.current;
    if (p && !p.active && Math.abs(e.clientY - p.y) > 8) {
      clearTimeout(p.timer);
      press.current = null;
    }
    if (p?.active) {
      setScrubRow(rowFromEvent(e));
      return;
    }
    if (e.pointerType === 'mouse') onHoverRow(rowFromEvent(e));
  }

  function onPointerUp() {
    const p = press.current;
    press.current = null;
    if (p) clearTimeout(p.timer);
    if (p?.active && scrubRow !== null) {
      if (scrubRow !== completedRows) onScrub(scrubRow);
    }
    setScrubRow(null);
  }

  return (
    <div className="knit-canvas">
      <div
        ref={wrapRef}
        className="knit-scroll"
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            setZoomIdx((z) => Math.max(0, Math.min(ZOOMS.length - 1, z + (e.deltaY < 0 ? 1 : -1))));
          }
        }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={(e) => e.pointerType === 'mouse' && !press.current && onHoverRow(null)}
          onContextMenu={(e) => e.preventDefault()}
          aria-label={`${piece.name} 니트 미리보기, ${completedRows}단까지 떴어요`}
          role="img"
        />
        {scrubRow !== null && (
          <div className="scrub-bubble" style={{ top: Math.max(0, rowTop(piece, layout, Math.max(1, scrubRow)) - 34) }}>
            {completedRows}단 → <b>{scrubRow}단</b>까지
          </div>
        )}
      </div>
      <div className="canvas-tools">
        {piece.construction === 'round' && (
          <div className="seg" role="group" aria-label="앞뒤">
            <button aria-pressed={!back} onClick={() => setBack(false)}>앞</button>
            <button aria-pressed={back} onClick={() => setBack(true)}>뒤</button>
          </div>
        )}
        <button className="btn small" onClick={() => setZoomIdx((z) => Math.max(0, z - 1))} aria-label="축소">🔍−</button>
        <button className="btn small" onClick={() => setZoomIdx((z) => Math.min(ZOOMS.length - 1, z + 1))} aria-label="확대">🔍+</button>
        <span className="muted small">길게 누르거나 끌어서 진행 위치 이동</span>
      </div>
    </div>
  );
}
