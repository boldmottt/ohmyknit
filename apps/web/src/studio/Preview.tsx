import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { drawChartCircle, drawChartFlat, expandRows, stitchAspect } from '@knitcloset/knit-render';
import type { Design } from './design';

type Props = { design: Design; zoom: number; rotate: number };
export type PreviewHandle = { toPNG: () => string | null };

/** 미리보기: 평면(반복 펼침) 또는 원형(정수리) */
export const Preview = forwardRef<PreviewHandle, Props>(function Preview({ design, zoom, rotate }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({ toPNG: () => canvas.current?.toDataURL('image/png') ?? null }));

  useEffect(() => {
    const c = canvas.current;
    const w = wrap.current;
    if (!c || !w) return;
    let raf = 0;
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const box = Math.max(240, Math.min(w.clientWidth, 640));
      const size = box * zoom;
      const o = { palette: design.yarns, repeatsX: design.repeatsX, repeatsY: design.repeatsY, gauge: design.gauge, direction: design.direction };
      const ctx = c.getContext('2d');
      if (!ctx) return;
      if (design.renderAs === 'circle') {
        c.width = size * dpr;
        c.height = size * dpr;
        c.style.width = `${size}px`;
        c.style.height = `${size}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, size, size);
        drawChartCircle(ctx, design.grid, { ...o, cx: size / 2, cy: size / 2, radius: size / 2 - 6, rotateDeg: rotate });
      } else {
        const rows = expandRows(design.grid, o);
        const maxN = Math.max(1, ...rows.map((r) => r.length));
        const cellW = Math.max(3, Math.min(28, (box / maxN) * zoom));
        const dims = { width: maxN * cellW, height: rows.length * cellW * stitchAspect(design.gauge) };
        c.width = Math.ceil(dims.width * dpr);
        c.height = Math.ceil(dims.height * dpr);
        c.style.width = `${dims.width}px`;
        c.style.height = `${dims.height}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, dims.width, dims.height);
        if (rotate) {
          ctx.translate(dims.width / 2, dims.height / 2);
          ctx.rotate((rotate * Math.PI) / 180);
          ctx.translate(-dims.width / 2, -dims.height / 2);
        }
        drawChartFlat(ctx, design.grid, { ...o, cellW });
      }
    };
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    });
    ro.observe(w);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [design, zoom, rotate]);

  return (
    <div ref={wrap} className="preview-wrap">
      <canvas ref={canvas} role="img" aria-label={`${design.name} ${design.renderAs === 'circle' ? '원형' : '평면'} 미리보기`} />
    </div>
  );
});
