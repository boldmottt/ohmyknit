import { useMemo } from 'react';
import { drawSwatch, type Palette } from '@knitcloset/knit-render';

const cache = new Map<string, string>();

/** 팔레트로 만든 작은 니트 텍스처 (바탕색 + 배색 띠) */
function texture(palette: Palette): string {
  const key = palette.map((p) => p.hex).join(',');
  const hit = cache.get(key);
  if (hit) return hit;
  const cols = 24;
  const rows = 40;
  const cell = 7;
  const c = document.createElement('canvas');
  c.width = cols * cell;
  c.height = Math.ceil(rows * cell * 0.86);
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  const n = palette.length;
  drawSwatch(ctx, cols, rows, cell, palette, (r, col) => {
    if (n < 2) return 0;
    // 위쪽(요크)에 배색 띠
    const band = r - 26;
    if (band < 0 || band > 9) return 0;
    const k = 1 + ((band >> 1) % (n - 1));
    const zig = Math.abs(((col + band) % 6) - 3);
    return zig < 2 ? k : 0;
  });
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}

type Props = {
  id: string;
  palette: Palette;
  progress: number;
  selected?: boolean;
  swing?: boolean;
  label: string;
  onClick?: () => void;
};

/**
 * 옷걸이에 걸린 스웨터. 진척도만큼 아래부터 실제 니트 텍스처로 채워지고,
 * 나머지는 점선 실루엣으로 보입니다 (기획서 F1-3).
 */
export function Garment({ id, palette, progress, selected, swing, label, onClick }: Props) {
  const tex = useMemo(() => texture(palette), [palette]);
  const fillTop = 40 + 170 * (1 - Math.max(0, Math.min(1, progress)));
  const shape =
    'M70 40 Q100 56 130 40 L176 58 L198 128 L172 136 L160 98 L160 210 L40 210 L40 98 L28 136 L2 128 L24 58 Z';
  const clip = `g-${id}`;
  return (
    <button className={`garment${selected ? ' selected' : ''}${swing ? ' swing' : ''}`} onClick={onClick} aria-label={label}>
      <svg viewBox="-4 -24 208 240" aria-hidden="true">
        {/* 옷걸이 */}
        <path d="M100 -20 q10 0 10 10 q0 8 -10 12 L100 10 M36 48 L100 10 L164 48" className="hanger" />
        <defs>
          <clipPath id={clip}>
            <path d={shape} />
          </clipPath>
          <pattern id={`${clip}-t`} patternUnits="userSpaceOnUse" width="168" height="241">
            <image href={tex} width="168" height="241" />
          </pattern>
        </defs>
        <path d={shape} className="ghost-shape" />
        <g clipPath={`url(#${clip})`}>
          <rect x="0" y={fillTop} width="200" height={220 - fillTop} fill={`url(#${clip}-t)`} />
          <line x1="0" x2="200" y1={fillTop} y2={fillTop} className="needle-line" />
        </g>
        <path d={shape} className="outline" />
      </svg>
    </button>
  );
}
