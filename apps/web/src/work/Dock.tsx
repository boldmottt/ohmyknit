import { useEffect, useState } from 'react';
import type { ConvertedPiece } from '@knitcloset/gauge-engine';
import { fileUrl, type Note } from '../api';
import { linkedCounters, upcoming, type RowView } from '../derive';

type Props = {
  piece: ConvertedPiece;
  view: RowView;
  projectId: string;
  onInc: () => void;
  onDec: () => void;
  onTool: (t: 'checkin' | 'note' | 'frog' | 'yarn' | 'stitch') => void;
  stitchTracking: boolean;
  currentStitch: number;
  onStitchStep: (delta: number) => void;
  notes: Note[];
  onDeleteNote: (id: string) => void;
};

type Custom = { label: string; every: number };

function useCustomCounters(projectId: string): [Custom[], (c: Custom[]) => void] {
  const key = `kc.counters.${projectId}`;
  const [list, setList] = useState<Custom[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? '[]');
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(list));
    } catch {
      /* 무시 */
    }
  }, [key, list]);
  return [list, setList];
}

/** ③ 진행 도크: 메인 카운터, 연결된 반복 카운터, 다가오는 일, 도구 (기획서 5.4) */
export function Dock({ piece, view, projectId, onInc, onDec, onTool, stitchTracking, currentStitch, onStitchStep, notes, onDeleteNote }: Props) {
  const [custom, setCustom] = useCustomCounters(projectId);
  const [adding, setAdding] = useState(false);
  const counters = linkedCounters(piece, view.completedRows, custom);
  const next = upcoming(piece, view.completedRows, 20);
  const ch = view.section?.chart;
  const repeatW = ch?.shaped && view.row?.chartRow !== undefined
    ? Math.max(1, (ch.grid[view.row.chartRow] ?? []).filter((c) => c !== -1).length)
    : ch?.repeatW;
  return (
    <section className="dock panel" aria-label="진행">
      <div className="counter">
        <div className="muted small">현재 단</div>
        <div className="counter-num num" aria-live="polite">
          <span className="cur" key={view.completedRows}>{Math.min(view.completedRows + 1, piece.totalRows)}</span>
          <span className="tot"> / {piece.totalRows}</span>
        </div>
        <div className="muted small num">{view.completedRows}단 완료</div>
      </div>
      <div className="counter-btns">
        <button className="btn dec" onClick={onDec} aria-label="한 단 되돌리기 (−1)">−</button>
        <button className="btn primary inc" onClick={onInc} aria-label="한 단 완료 (+1)">+1</button>
      </div>

      {stitchTracking && repeatW && view.row && (
        <div className="stitch-track">
          <div className="muted small">코 단위 추적 ({repeatW}코씩)</div>
          <div className="row">
            <button className="btn small" onClick={() => onStitchStep(-repeatW)}>−{repeatW}</button>
            <b className="num">
              {currentStitch} / {view.row.stitchesWorked}코
            </b>
            <button className="btn small" onClick={() => onStitchStep(repeatW)}>+{repeatW}</button>
          </div>
          <div className="muted small num">
            반복 {Math.floor(currentStitch / repeatW)} / {Math.floor(view.row.stitchesWorked / repeatW)}
          </div>
        </div>
      )}

      <div className="linked">
        <h3>반복 카운터</h3>
        {counters.map((c, i) => (
          <div key={i} className="linked-row">
            <span>{c.label}</span>
            <b className="num">{c.value}</b>
            {c.detail && <span className="muted small">{c.detail}</span>}
            {i >= counters.length - custom.length && (
              <button
                className="btn ghost small"
                aria-label={`${c.label} 지우기`}
                onClick={() => setCustom(custom.filter((x) => x.label !== c.label))}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {adding ? (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const every = Number(f.get('every'));
              const label = String(f.get('label') || '').trim();
              if (label && every > 0) setCustom([...custom, { label, every }]);
              setAdding(false);
            }}
          >
            <input className="input" name="label" placeholder="케이블 꼬기" aria-label="이름" style={{ flex: 2 }} />
            <input className="input" name="every" type="number" min={1} placeholder="8" aria-label="몇 단마다" style={{ flex: 1 }} />
            <button className="btn small">추가</button>
          </form>
        ) : (
          <button className="btn ghost small" onClick={() => setAdding(true)}>+ 내 카운터 (N단마다)</button>
        )}
      </div>

      <div className="upcoming">
        <h3>다가오는 일</h3>
        {next.length === 0 && <div className="muted small">20단 안에 특별한 일이 없어요</div>}
        <ul>
          {next.slice(0, 6).map((u, i) => (
            <li key={i} className={u.rowsAway <= 3 ? 'soon' : ''}>
              <span aria-hidden="true">{u.lock ? '🔒' : u.icon}</span>{' '}
              <b className="num">{u.rowsAway === 1 ? '이번 단' : `${u.rowsAway - 1}단 뒤`}</b> {u.text}
            </li>
          ))}
        </ul>
      </div>

      {notes.length > 0 && (
        <details className="notes">
          <summary>
            <h3 style={{ display: 'inline' }}>📌 메모 {notes.length}개</h3>
            {notes.some((n) => Math.abs(n.row - (view.completedRows + 1)) <= 3) && <span className="badge warn">근처에 메모 있음</span>}
          </summary>
          <ul>
            {notes.map((n) => (
              <li key={n.id} className={Math.abs(n.row - (view.completedRows + 1)) <= 3 ? 'soon' : ''}>
                <b className="num">{n.row}단</b> {n.text}
                {n.photoKey && (
                  <a href={fileUrl(n.photoKey)} target="_blank" rel="noreferrer">
                    <img src={fileUrl(n.photoKey)} alt={`${n.row}단 사진`} />
                  </a>
                )}
                <button className="btn ghost small" aria-label="메모 지우기" onClick={() => window.confirm('이 메모를 지울까요?') && onDeleteNote(n.id)}>✕</button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="tools">
        <button className="btn" onClick={() => onTool('checkin')}>📏 실측</button>
        <button className="btn" onClick={() => onTool('note')}>📝 메모</button>
        <button className="btn" onClick={() => onTool('frog')}>↺ 풀기</button>
        <button className="btn" onClick={() => onTool('yarn')}>⚖ 실 무게</button>
        {repeatW && (
          <button className="btn" aria-pressed={stitchTracking} onClick={() => onTool('stitch')}>
            🔢 코 추적{stitchTracking ? ' 끄기' : ''}
          </button>
        )}
      </div>
    </section>
  );
}
