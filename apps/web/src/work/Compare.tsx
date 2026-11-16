import { lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import type { ProgressSnapshot } from '@knitcloset/gauge-engine';
import type { WorkData } from '../api';
import { artPieces, drawAssembled, type ArtPiece } from '../closet/assembledArt';
import { convertedPiece, expectedLengthCm, formatHours, overall, pieceStitchProgress, remainingMinutes } from '../derive';
import { PatternBoard } from '../sim/PatternBoard';
import { pct } from '../ui';

const GarmentViewer = lazy(() => import('../sim/GarmentViewer'));

type Props = {
  data: WorkData;
  snapshots: Record<string, ProgressSnapshot>;
  activePieceId: string;
  onPick: (pieceId: string) => void;
};

/** WebGL을 못 쓰는 기기: 조각을 평면으로 조립한 2D 그림 */
function Flat({ pieces, data, activeId }: { pieces: ArtPiece[]; data: WorkData; activeId?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, 560, 500);
    drawAssembled(ctx, { pieces, palette: data.converted.palette, width: 560, height: 500, activeId });
  }, [pieces, data, activeId]);
  return <canvas ref={ref} width={1120} height={1000} className="garment-3d flat" />;
}

/**
 * 완성본과 비교하기 (기획서 5.4 ②, F4-6).
 * 위: 패턴판을 마네킹에 입혀 조립한 3D (드래그로 돌려 보기).
 * 아래: 패턴판을 평평하게 늘어놓은 2D.
 * 둘 다 완성 모습은 반투명, 실제로 뜬 단(과 지금 단의 뜬 코)까지만 진하게.
 */
export function Compare({ data, snapshots, activePieceId, onPick }: Props) {
  const all = overall(data, snapshots);
  const pieces = useMemo(() => artPieces(data, snapshots), [data, snapshots]);
  const convId = convertedPiece(data, activePieceId)?.id;
  const pickConv = (cid: string) => {
    const st = data.pieces.find((p) => convertedPiece(data, p.id)?.id === cid);
    if (st) onPick(st.id);
  };

  const chips = data.pieces.map((p) => {
    const conv = convertedPiece(data, p.id)!;
    return { p, prog: pieceStitchProgress(conv, snapshots[p.id]!) };
  });
  const activeConv = convertedPiece(data, activePieceId);
  const activeSnap = snapshots[activePieceId];
  const remainMin = remainingMinutes(data, all.total - all.done);
  const flat = <Flat pieces={pieces} data={data} activeId={convId} />;

  return (
    <div className="compare">
      <div className="cmp-art">
        <div className="cmp-3d" aria-label={`전체 ${pct(all.ratio)} 완성. 진한 부분이 실제로 뜬 곳, 반투명한 부분이 남은 곳`}>
          <Suspense fallback={flat}>
            <GarmentViewer pieces={pieces} palette={data.converted.palette} activeId={convId} onPick={pickConv} fallback={flat} />
          </Suspense>
          <p className="cmp-legend">
            <span className="sw solid" /> 뜬 단 <span className="sw ghost" /> 남은 단 <i>·</i> 드래그해서 돌려 보기
          </p>
        </div>
        <PatternBoard pieces={pieces} palette={data.converted.palette} activeId={convId} onPick={pickConv} height={200} />
        <div className="cmp-pieces" role="group" aria-label="조각">
          {chips.map(({ p, prog }) => (
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
        <div className="muted small">3D나 패턴판에서 조각을 누르면 그 조각으로 이동해요</div>
      </div>
    </div>
  );
}
