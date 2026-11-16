import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { WorkData } from '../api';
import GarmentViewer from '../sim/GarmentViewer';
import { PatternBoard } from '../sim/PatternBoard';
import { pct } from '../ui';
import { artPieces } from './assembledArt';

/**
 * 3D로 입혀 보기 (CLO 3D처럼 왼쪽 3D, 오른쪽 패턴판).
 * 옷장에서 연 작품의 조각들을 마네킹에 입혀 보여 주고, 패턴판에서 조각을 고르면 3D에서도 강조돼요.
 */
export default function SimSheet({ data, onClose }: { data: WorkData; onClose: () => void }) {
  const pieces = useMemo(() => artPieces(data), [data]);
  const [active, setActive] = useState<string | undefined>(undefined);
  const [form, setForm] = useState(true);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    // 뒤의 옷장이 같이 스크롤되지 않게
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', k);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const pick = pieces.find((p) => p.piece.id === active);
  const total = pieces.reduce((s, p) => s + p.piece.totalStitches, 0);
  const doneSt = pieces.reduce((s, p) => {
    let st = 0;
    for (let i = 0; i < Math.min(p.completedRows, p.piece.rows.length); i++) st += p.piece.rows[i]!.stitchesWorked;
    return s + st + (p.currentStitch ?? 0);
  }, 0);

  return (
    <div className="sim-sheet" role="dialog" aria-modal="true" aria-label={`${data.project.name} 3D로 입혀 보기`}>
      <header className="sim-head">
        <div>
          <p className="eyebrow">패턴판 조립 시뮬레이션</p>
          <h2>{data.project.name}</h2>
        </div>
        <div className="sim-actions">
          <label className="sim-toggle">
            <input type="checkbox" checked={form} onChange={(e) => setForm(e.target.checked)} /> 마네킹
          </label>
          <Link className="cta" to={`/project/${data.project.id}/work`}>
            이어하기 <span aria-hidden="true">↗</span>
          </Link>
          <button className="sim-close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
      </header>
      <div className="sim-body">
        <section className="sim-3d">
          <GarmentViewer
            pieces={pieces}
            palette={data.converted.palette}
            activeId={active}
            mannequin={form}
            onPick={(id) => setActive((a) => (a === id ? undefined : id))}
            fallback={<p className="quiet sim-nogl">이 기기에서는 3D를 그릴 수 없어서 패턴판만 보여 드려요.</p>}
          />
          <p className="sim-legend">
            <span className="sw solid" /> 뜬 단 <span className="sw ghost" /> 남은 단 (완성 모습) <i>·</i> 드래그해서 돌려 보기
          </p>
        </section>
        <section className="sim-2d">
          <PatternBoard pieces={pieces} palette={data.converted.palette} activeId={active} onPick={(id) => setActive((a) => (a === id ? undefined : id))} height={260} />
          <dl className="sim-stats">
            <dt>전체</dt>
            <dd className="num">{pct(total ? doneSt / total : 0)} 완성</dd>
            {pick ? (
              <>
                <dt>{pick.piece.name}</dt>
                <dd className="num">
                  {pick.completedRows}/{pick.piece.totalRows}단 · 길이 {Math.round((pick.completedRows / pick.gauge.row) * 100) / 10} / {Math.round((pick.piece.totalRows / pick.gauge.row) * 100) / 10}cm
                </dd>
              </>
            ) : (
              <>
                <dt>조각</dt>
                <dd>3D나 패턴판에서 조각을 누르면 자세히 보여요</dd>
              </>
            )}
          </dl>
        </section>
      </div>
    </div>
  );
}
