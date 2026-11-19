import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Palette } from '@knitcloset/knit-render';
import type { ArtPiece } from '../closet/assembledArt';
import { Viewer } from './viewer';

type Props = {
  pieces: ArtPiece[];
  palette: Palette;
  /** 강조할 조각 (변환된 조각 id) */
  activeId?: string;
  onPick?: (convertedPieceId: string) => void;
  mannequin?: boolean;
  className?: string;
  /** WebGL을 못 쓰는 기기에서 대신 보여 줄 것 */
  fallback?: ReactNode;
};

/** 3D 조립 시뮬레이션. 드래그해서 돌려 보고, 조각을 누르면 그 조각을 골라요 */
export default function GarmentViewer({ pieces, palette, activeId, onPick, mannequin = true, className, fallback }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const [failed, setFailed] = useState(false);
  const [settling, setSettling] = useState(false);

  useEffect(() => {
    if (!host.current) return;
    try {
      viewer.current = new Viewer(host.current, (id) => pick.current?.(id));
      viewer.current.onSettling = setSettling;
    } catch {
      setFailed(true);
    }
    return () => {
      viewer.current?.dispose();
      viewer.current = null;
    };
  }, []);

  useEffect(() => {
    try {
      viewer.current?.set(pieces, palette, { mannequin, activeId });
    } catch {
      setFailed(true);
    }
  }, [pieces, palette, activeId, mannequin]);

  if (failed) return <>{fallback ?? null}</>;
  return (
    <div ref={host} className={`garment-3d${className ? ` ${className}` : ''}`}>
      {settling && (
        <span className="garment-settling" role="status">
          천이 늘어지는 중…
        </span>
      )}
    </div>
  );
}
