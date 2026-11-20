import { useEffect, useRef, useState } from 'react';
import type { Palette } from '@knitcloset/knit-render';
import type { ArtPiece } from '../closet/assembledArt';
import { drawBoard, type BoardHit } from './boardDraw';

type Props = {
  pieces: ArtPiece[];
  palette: Palette;
  activeId?: string;
  onPick?: (convertedPieceId: string) => void;
  height?: number;
  className?: string;
};

/** 패턴판 보드 (2D). 너비에 맞춰 다시 그리고, 조각을 누르면 그 조각을 골라요 */
export function PatternBoard({ pieces, palette, activeId, onPick, height = 210, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hits = useRef<BoardHit[]>([]);
  const [w, setW] = useState(0);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ro = new ResizeObserver(() => setW(c.clientWidth));
    ro.observe(c);
    setW(c.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = ref.current;
    if (!c || !w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(w * dpr);
    c.height = Math.round(height * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    hits.current = drawBoard(ctx, pieces, palette, w, height, activeId);
  }, [pieces, palette, activeId, w, height]);

  return (
    <canvas
      ref={ref}
      className={`pattern-board${className ? ` ${className}` : ''}`}
      style={{ height }}
      role="img"
      aria-label={`패턴판: ${pieces.map((p) => `${p.piece.name} ${p.completedRows}/${p.piece.totalRows}단`).join(', ')}`}
      onClick={(e) => {
        if (!onPick) return;
        const r = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        const hit = hits.current.find((h) => x >= h.x - 4 && x <= h.x + h.w + 4 && y >= h.y - 4 && y <= h.y + h.h);
        if (hit) onPick(hit.id);
      }}
    />
  );
}
