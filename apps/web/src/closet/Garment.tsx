import { useMemo } from 'react';
import type { Palette } from '@knitcloset/knit-render';
import { garmentArt } from './garmentArt';

type Props = {
  id: string;
  palette: Palette;
  progress: number;
  motif?: number[][] | null;
  kind?: 'hat' | 'sweater';
  selected?: boolean;
  swing?: boolean;
  label: string;
  onClick?: () => void;
};

/** 옷걸이에 걸린 옷 한 벌 (그림은 garmentArt가 실제 실 색·무늬로 그림) */
export function Garment({ palette, progress, motif = null, kind = 'sweater', selected, swing, label, onClick }: Props) {
  const src = useMemo(() => garmentArt({ palette, motif, kind, progress }), [palette, motif, kind, progress]);
  return (
    <button className={`garment${selected ? ' selected' : ''}${swing ? ' swing' : ''}`} onClick={onClick} aria-label={label}>
      <img src={src} alt="" draggable={false} />
    </button>
  );
}
