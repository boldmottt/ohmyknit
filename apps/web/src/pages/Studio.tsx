import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { makeSwirlChart, NO_STITCH, parsePattern, realCells, type Pattern, type Yarn } from '@knitcloset/pattern-schema';
import { api, fileUrl } from '../api';
import { ChartGrid, type Tool } from '../studio/ChartGrid';
import {
  applyDesign,
  blankDesign,
  chartSections,
  designFromPattern,
  designToPattern,
  floodFill,
  isStandalone,
  gridW,
  removeYarnFromGrid,
  resizeGrid,
  type ChartRef,
  type Design,
} from '../studio/design';
import { Preview, type PreviewHandle } from '../studio/Preview';
import { swatchUrl, YarnLibrary } from '../studio/YarnLibrary';
import { fmtDate, getStoredProfile, Modal, NumInput, useToast } from '../ui';
import '../studio/studio.css';

const ZOOMS = [0.5, 0.75, 1, 1.5, 2];

/** 차트 디자인 스튜디오 (/studio, /studio/:patternId) — 기획서 F2-3 확장 */
export default function Studio() {
  const { patternId } = useParams();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const profileId = getStoredProfile();

  const [design, setDesign] = useState<Design>(blankDesign);
  const [past, setPast] = useState<Design[]>([]);
  const [future, setFuture] = useState<Design[]>([]);
  const [saved, setSaved] = useState<string>(() => JSON.stringify(blankDesign()));
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pattern, setPattern] = useState<Pattern | null>(null);
  const [sourceType, setSourceType] = useState('design');
  const [fileKey, setFileKey] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('paint');
  const [color, setColor] = useState(0);
  const [chartZoom, setChartZoom] = useState(1);
  const [pvZoom, setPvZoom] = useState(1);
  const [rotate, setRotate] = useState(0);
  const [libSlot, setLibSlot] = useState<number | null>(null);
  const [hoverYarn, setHoverYarn] = useState<Yarn | null>(null);
  const [openDlg, setOpenDlg] = useState(false);
  const [busy, setBusy] = useState(false);
  const preview = useRef<PreviewHandle>(null);
  const strokeStart = useRef<Design | null>(null);

  const ref: ChartRef | null = useMemo(() => {
    if (!pattern) return null;
    const pi = Number(sp.get('piece'));
    const si = Number(sp.get('section'));
    if (Number.isInteger(pi) && Number.isInteger(si) && pattern.pieces[pi]?.sections[si]?.chart) return { pieceIndex: pi, sectionIndex: si };
    const first = chartSections(pattern)[0];
    return first ? { pieceIndex: first.pieceIndex, sectionIndex: first.sectionIndex } : null;
  }, [pattern, sp]);

  // 도안 열기
  useEffect(() => {
    if (!patternId) {
      setPattern(null);
      return;
    }
    let alive = true;
    void api.pattern(patternId).then((r) => {
      if (!alive) return;
      setPattern(r.pattern);
      setSourceType(r.sourceType);
      setFileKey(r.fileKey);
    });
    return () => {
      alive = false;
    };
  }, [patternId]);

  // 저장하지 않고 다른 화면으로 가도 작업이 사라지지 않게, 고치는 중인 디자인을 기기에 남겨 둠
  const draftKey = `kc.studio.draft:${patternId ?? 'new'}:${ref ? `${ref.pieceIndex}.${ref.sectionIndex}` : '-'}`;
  const restoreDraft = useCallback(
    (base: Design) => {
      try {
        const raw = localStorage.getItem(draftKey);
        if (!raw || raw === JSON.stringify(base)) return;
        const draft = JSON.parse(raw) as Design;
        if (!Array.isArray(draft.grid) || !Array.isArray(draft.yarns)) return;
        setDesign(draft);
        toast({
          text: '저장하지 않았던 변경을 되살렸어요',
          ms: 8000,
          action: {
            label: '버리기',
            run: () => {
              localStorage.removeItem(draftKey);
              setDesign(base);
              setPast([]);
              setFuture([]);
            },
          },
        });
      } catch {
        /* 초안을 못 읽으면 그냥 넘어감 */
      }
    },
    [draftKey, toast],
  );

  useEffect(() => {
    if (!pattern || !ref) return;
    const d = designFromPattern(pattern, ref);
    if (d) {
      setDesign(d);
      setSaved(JSON.stringify(d));
      setPast([]);
      setFuture([]);
      restoreDraft(d);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern, ref]);

  // 새 디자인(/studio)으로 들어왔을 때
  useEffect(() => {
    if (patternId) return;
    const d = blankDesign();
    setDesign(d);
    setSaved(JSON.stringify(d));
    setPast([]);
    setFuture([]);
    restoreDraft(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patternId]);

  const dirty = JSON.stringify(design) !== saved;
  useEffect(() => {
    try {
      if (dirty) localStorage.setItem(draftKey, JSON.stringify(design));
      else localStorage.removeItem(draftKey);
    } catch {
      /* 저장 공간이 없으면 초안 없이 동작 */
    }
  }, [design, dirty, draftKey]);
  const standalone = !!pattern && isStandalone(pattern, sourceType);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  /** 되돌리기 기록을 남기며 바꾸기 */
  const commit = useCallback((next: Design | ((d: Design) => Design)) => {
    setDesign((cur) => {
      const n = typeof next === 'function' ? next(cur) : next;
      if (n === cur) return cur;
      setPast((p) => [...p.slice(-99), cur]);
      setFuture([]);
      return n;
    });
  }, []);

  const undo = useCallback(() => {
    setPast((p) => {
      const prev = p.at(-1);
      if (!prev) return p;
      setDesign((cur) => {
        setFuture((f) => [cur, ...f]);
        return prev;
      });
      return p.slice(0, -1);
    });
  }, []);
  const redo = useCallback(() => {
    setFuture((f) => {
      const next = f[0];
      if (!next) return f;
      setDesign((cur) => {
        setPast((p) => [...p, cur]);
        return next;
      });
      return f.slice(1);
    });
  }, []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[1-9]$/.test(e.key) && Number(e.key) <= design.yarns.length) {
        setColor(Number(e.key) - 1);
        setTool('paint');
      }
      if (e.key === 'b') setTool('paint');
      if (e.key === 'x') setTool('nostitch');
      if (e.key === 'g') setTool('fill');
      if (e.key === 'i') setTool('pick');
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [undo, redo, design.yarns.length]);

  function onStroke(r: number, c: number, first: boolean) {
    const cur = design.grid[r]?.[c];
    if (cur === undefined) return;
    if (tool === 'pick') {
      if (cur !== NO_STITCH) setColor(cur);
      setTool('paint');
      return;
    }
    if (first) strokeStart.current = design;
    if (tool === 'fill') {
      if (!first) return;
      const v = color;
      setDesign((d) => ({ ...d, grid: floodFill(d.grid, r, c, v) }));
      return;
    }
    const v = tool === 'nostitch' ? (first && cur === NO_STITCH ? color : NO_STITCH) : color;
    // 코 없음 도구로 코 없음 칸을 누르면 다시 살림 (드래그 중에는 처음 결정 유지)
    if (first) strokeValue.current = v;
    const val = strokeValue.current;
    if (cur === val) return;
    setDesign((d) => {
      const g = d.grid.map((row) => [...row]);
      g[r]![c] = val;
      return { ...d, grid: g };
    });
  }
  const strokeValue = useRef(0);
  function onStrokeEnd() {
    const start = strokeStart.current;
    strokeStart.current = null;
    if (start && start !== design) {
      setPast((p) => [...p.slice(-99), start]);
      setFuture([]);
    }
  }

  const shown = useMemo(() => {
    if (libSlot === null || !hoverYarn) return design;
    const ys = [...design.yarns];
    ys[libSlot] = hoverYarn;
    return { ...design, yarns: ys };
  }, [design, libSlot, hoverYarn]);
  const onPreviewYarn = useCallback((y: Yarn | null) => setHoverYarn(y), []);

  async function save() {
    setBusy(true);
    try {
      if (pattern && patternId && ref) {
        const next = applyDesign(pattern, ref, design, standalone);
        parsePattern(next);
        await api.updatePattern(patternId, next, fileKey ?? undefined);
        setPattern(next);
      } else {
        const p = designToPattern(design);
        parsePattern(p);
        const { id } = await api.createPattern(p, { profileId: profileId ?? undefined, sourceType: 'design' });
        nav(`/studio/${id}?piece=0&section=0`, { replace: true });
      }
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* 무시 */
      }
      setSaved(JSON.stringify(design));
      setSavedAt(Date.now());
      await qc.invalidateQueries({ queryKey: ['patterns'] });
      toast({ text: '디자인을 저장했어요 🎨' });
    } catch (e) {
      toast({ text: (e as Error).message, ms: 6000 });
    } finally {
      setBusy(false);
    }
  }

  function exportPng() {
    const url = preview.current?.toPNG();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${design.name || 'design'}-미리보기.png`;
    a.click();
  }

  function newDesign() {
    if (dirty && !window.confirm('저장하지 않은 변경이 있어요. 새로 시작할까요?')) return;
    try {
      localStorage.removeItem(draftKey);
      localStorage.removeItem('kc.studio.draft:new:-');
    } catch {
      /* 무시 */
    }
    const d = blankDesign();
    setDesign(d);
    setSaved(JSON.stringify(d));
    setPast([]);
    setFuture([]);
    setSavedAt(null);
    nav('/studio');
  }

  const w = gridW(design.grid);
  const h = design.grid.length;
  const firstN = realCells(design.grid[0] ?? []).length * design.repeatsX;
  const lastN = realCells(design.grid.at(-1) ?? []).length * design.repeatsX;
  const canExport = sourceType !== 'pdf';
  const cell = Math.round(22 * chartZoom);
  const setGrid = (g: number[][]) => commit((d) => ({ ...d, grid: g }));

  return (
    <div className="studio">
      <aside className="studio-side">
        <div className="studio-brand">
          <b className="serif">🎨 디자인 스튜디오</b>
          <Link to="/patterns" className="small">도안 보관함</Link>
        </div>

        <section className="sp">
          <h3>디자인</h3>
          <label className="field"><span>이름</span><input value={design.name} onChange={(e) => commit({ ...design, name: e.target.value })} /></label>
          <label className="field"><span>설명 (작업 화면 지시로 쓰여요)</span><textarea rows={2} value={design.description} onChange={(e) => commit({ ...design, description: e.target.value })} /></label>
          {pattern && !ref && (
            <p className="small badge warn" style={{ display: 'block', padding: 8 }}>
              "{pattern.title}" 도안에는 차트 구간이 없어요. 지금 저장하면 새 디자인으로 따로 저장돼요.
            </p>
          )}
          {pattern && ref && (
            <div className="small muted">
              {chartSections(pattern).length > 1 ? (
                <select className="input" value={`${ref.pieceIndex}:${ref.sectionIndex}`} onChange={(e) => {
                  const [pi, si] = e.target.value.split(':');
                  setSp({ piece: pi!, section: si! });
                }}>
                  {chartSections(pattern).map((c) => <option key={`${c.pieceIndex}:${c.sectionIndex}`} value={`${c.pieceIndex}:${c.sectionIndex}`}>{c.label}</option>)}
                </select>
              ) : (
                <>도안 "{pattern.title}"의 차트를 고치는 중</>
              )}
            </div>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn small" onClick={newDesign}>새로</button>
            <button className="btn small" onClick={() => setOpenDlg(true)}>열기</button>
            {canExport && <button className="btn small" onClick={exportPng}>내보내기</button>}
            <button className="btn small primary" onClick={() => void save()} disabled={busy || (!dirty && !!patternId)}>저장</button>
          </div>
          <div className="small muted" style={{ marginTop: 4 }}>{dirty ? '● 저장 안 된 변경' : savedAt ? `저장됨 ${fmtDate(savedAt)}` : patternId ? '저장됨' : ''}</div>
          {patternId && !dirty && (
            <Link className="btn small" style={{ marginTop: 6 }} to={`/project/new?pattern=${patternId}`}>🧶 이 디자인으로 뜨기</Link>
          )}
        </section>

        <section className="sp">
          <h3>격자</h3>
          <div className="sp-grid">
            <NumInput integer min={1} max={80} live={false} aria-label="코 수" value={w} onCommit={(n) => setGrid(resizeGrid(design.grid, n, h, color))} />
            <span>코 ×</span>
            <NumInput integer min={1} max={40} aria-label="가로 반복" value={design.repeatsX} onCommit={(n) => commit({ ...design, repeatsX: n })} />
            <span>반복</span>
            <NumInput integer min={1} max={120} live={false} aria-label="단 수" value={h} onCommit={(n) => setGrid(resizeGrid(design.grid, w, n, color))} />
            <span>단 ×</span>
            <NumInput integer min={1} max={20} aria-label="세로 반복" value={design.repeatsY} onCommit={(n) => commit({ ...design, repeatsY: n })} />
            <span>반복</span>
          </div>
          <label className="field">
            <span>뜨는 방향</span>
            <select disabled={!!pattern && !standalone} value={design.direction} onChange={(e) => commit({ ...design, direction: e.target.value as Design['direction'] })}>
              <option value="bottom_up">↑ 아래에서 위로</option>
              <option value="top_down">↓ 위에서 아래로</option>
            </select>
          </label>
          <label className="field">
            <span>보기 방식 {design.renderAs === 'circle' && <span className="muted">· 5~10회 반복 추천</span>}</span>
            <select value={design.renderAs} onChange={(e) => commit({ ...design, renderAs: e.target.value as Design['renderAs'] })}>
              <option value="flat">평면 (몸판·요크 띠)</option>
              <option value="circle">원형 (정수리·원형 요크)</option>
            </select>
          </label>
        </section>

        <section className="sp">
          <h3>게이지 <span className="muted small">(10cm)</span></h3>
          {pattern && !standalone && (
            <p className="small muted" style={{ margin: 0 }}>
              이 차트는 "{pattern.title}" 도안의 한 구간이에요. 여기서 바꾼 게이지는 <b>미리보기에만</b> 쓰이고, 도안의 게이지·코잡기·방향은 도안 편집기에서 바꿔요.
            </p>
          )}
          <div className="sp-grid two">
            <NumInput min={1} max={80} aria-label="코 게이지" value={design.gauge.st} onCommit={(n) => commit({ ...design, gauge: { ...design.gauge, st: n } })} />
            <span>코 :</span>
            <NumInput min={1} max={120} aria-label="단 게이지" value={design.gauge.row} onCommit={(n) => commit({ ...design, gauge: { ...design.gauge, row: n } })} />
            <span>단</span>
          </div>
        </section>

        <section className="sp">
          <h3>실</h3>
          <div className="row">
            <span className="small">실 개수</span>
            <button className="btn small" aria-label="실 줄이기" disabled={design.yarns.length <= 1} onClick={() => {
              const idx = design.yarns.length - 1;
              commit({ ...design, yarns: design.yarns.slice(0, -1), grid: removeYarnFromGrid(design.grid, idx) });
              setColor((c) => Math.min(c, idx - 1));
            }}>−</button>
            <b className="num">{design.yarns.length}</b>
            <button className="btn small" aria-label="실 늘리기" disabled={design.yarns.length >= 9} onClick={() => {
              commit({ ...design, yarns: [...design.yarns, { name: `색${design.yarns.length + 1}`, hex: '#9CAF88' }] });
              setLibSlot(design.yarns.length);
            }}>+</button>
          </div>
          <ul className="yarn-slots">
            {design.yarns.map((y, i) => (
              <li key={i} className={color === i ? 'on' : ''}>
                <button className="slot-main" onClick={() => { setColor(i); setTool('paint'); }} aria-label={`${i + 1}번 실 ${y.name}로 칠하기`}>
                  <span className="slot-no num">{i + 1}</span>
                  <img src={y.photoKey ? fileUrl(y.photoKey) : swatchUrl(y)} alt="" />
                  <span className="slot-text">
                    {y.brand && <span className="muted tiny">{y.brand}</span>}
                    <b>{y.name}</b>
                  </span>
                </button>
                <button className="btn ghost small" aria-label={`${i + 1}번 실 바꾸기`} onClick={() => setLibSlot(i)}>✎</button>
                {design.yarns.length > 1 && (
                  <button className="btn ghost small" aria-label={`${i + 1}번 실 지우기`} onClick={() => {
                    commit({ ...design, yarns: design.yarns.filter((_, j) => j !== i), grid: removeYarnFromGrid(design.grid, i) });
                    setColor(0);
                  }}>✕</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </aside>

      <main className="studio-main">
        <section className="studio-preview">
          <Preview ref={preview} design={shown} zoom={pvZoom} rotate={rotate} />
          <div className="pv-tools">
            <b>미리보기</b>
            <div className="seg" role="group" aria-label="보기 방식">
              <button aria-pressed={design.renderAs === 'flat'} onClick={() => commit({ ...design, renderAs: 'flat' })}>평면</button>
              <button aria-pressed={design.renderAs === 'circle'} onClick={() => commit({ ...design, renderAs: 'circle' })}>원형</button>
            </div>
            <label className="small">확대 <select className="input" value={pvZoom} onChange={(e) => setPvZoom(Number(e.target.value))}>{ZOOMS.map((z) => <option key={z} value={z}>{z * 100}%</option>)}</select></label>
            <label className="small">회전 <select className="input" value={rotate} onChange={(e) => setRotate(Number(e.target.value))}>{[0, 45, 90, 135, 180, 270].map((r) => <option key={r} value={r}>{r}°</option>)}</select></label>
          </div>
          {libSlot !== null && (
            <YarnLibrary
              profileId={profileId}
              slotLabel={`${libSlot + 1}번 실 (${design.yarns[libSlot]?.name ?? ''})`}
              onPreview={onPreviewYarn}
              onPick={(y) => {
                const ys = [...design.yarns];
                ys[libSlot] = y;
                commit({ ...design, yarns: ys });
                setHoverYarn(null);
                setLibSlot(null);
              }}
              onClose={() => {
                setHoverYarn(null);
                setLibSlot(null);
              }}
            />
          )}
        </section>

        <section className="studio-chart">
          <div className="chart-tools">
            <b>차트</b>
            <label className="small">확대 <select className="input" value={chartZoom} onChange={(e) => setChartZoom(Number(e.target.value))}>{ZOOMS.map((z) => <option key={z} value={z}>{z * 100}%</option>)}</select></label>
            <span className="tool-group" role="group" aria-label="편집">
              <button className="btn small" onClick={undo} disabled={!past.length} aria-label="되돌리기 (⌘Z)">↶</button>
              <button className="btn small" onClick={redo} disabled={!future.length} aria-label="다시 하기 (⌘⇧Z)">↷</button>
            </span>
            <span className="tool-group" role="group" aria-label="도구">
              {(
                [
                  ['paint', '✏', '칠하기 (B)'],
                  ['nostitch', '⬚', '코 없음 (X)'],
                  ['fill', '🪣', '채우기 (G)'],
                  ['pick', '💧', '색 고르기 (I)'],
                ] as const
              ).map(([t, icon, label]) => (
                <button key={t} className={`btn small${tool === t ? ' primary' : ''}`} aria-pressed={tool === t} onClick={() => setTool(t)} title={label} aria-label={label}>
                  {icon}
                </button>
              ))}
            </span>
            <select className="input yarn-pick" value={color} onChange={(e) => { setColor(Number(e.target.value)); setTool('paint'); }} aria-label="칠할 실">
              {design.yarns.map((y, i) => <option key={i} value={i}>{i + 1} {y.name}</option>)}
            </select>
            <details className="more">
              <summary className="btn small">모양 ▾</summary>
              <div className="card more-menu">
                <button onClick={() => {
                  // 지금 색은 살리고, 왼쪽부터 코 없음을 늘려 정수리 줄임 모양으로
                  const mask = makeSwirlChart(w, h);
                  setGrid(design.grid.map((row, r) => row.map((v, c) => (mask[r]![c] === NO_STITCH ? NO_STITCH : v === NO_STITCH ? color : v))));
                }}>◺ 정수리 줄임 모양 (왼쪽 삼각형)</button>
                <button onClick={() => setGrid(design.grid.map((row) => row.map((v) => (v === NO_STITCH ? color : v))))}>코 없음 칸 모두 되살리기</button>
                <button onClick={() => setGrid(design.grid.map((row) => row.map(() => color)))}>지금 실로 모두 칠하기</button>
                <button onClick={() => setGrid([...design.grid].reverse())}>위아래 뒤집기</button>
                <button onClick={() => setGrid(design.grid.map((row) => [...row].reverse()))}>좌우 뒤집기</button>
              </div>
            </details>
          </div>
          <div className="chart-scroll">
            <ChartGrid grid={design.grid} yarns={shown.yarns} cell={cell} onStroke={onStroke} onStrokeEnd={onStrokeEnd} />
          </div>
          <p className="small muted num chart-sum">
            {w}코 × {h}단 · 가로 {design.repeatsX}회 반복 → 1단 {firstN}코
            {firstN !== lastN ? `, ${h}단 ${lastN}코 (차트대로 ${firstN > lastN ? '줄임' : '늘림'})` : ''}
            {' '}· 완성 둘레 약 {Math.round((Math.max(firstN, lastN) / design.gauge.st) * 100) / 10}cm
          </p>
        </section>
      </main>

      {openDlg && <OpenDialog onClose={() => setOpenDlg(false)} onOpen={(id, r) => {
        setOpenDlg(false);
        nav(`/studio/${id}?piece=${r.pieceIndex}&section=${r.sectionIndex}`);
      }} />}
    </div>
  );
}

function OpenDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string, r: ChartRef) => void }) {
  const list = useQuery({ queryKey: ['patterns'], queryFn: api.patterns });
  const [picked, setPicked] = useState<{ id: string; sections: ReturnType<typeof chartSections> } | null>(null);
  return (
    <Modal title="차트 열기" onClose={onClose}>
      {!picked ? (
        <ul className="list">
          {list.data?.map((p) => (
            <li key={p.id}>
              <button className="pick" onClick={async () => {
                const full = await api.pattern(p.id);
                const secs = chartSections(full.pattern);
                if (secs.length === 1) onOpen(p.id, secs[0]!);
                else setPicked({ id: p.id, sections: secs });
              }}>
                <b>{p.title}</b> <span className="muted small">{p.designer}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : picked.sections.length === 0 ? (
        <p>이 도안에는 차트 구간이 없어요. 도안 편집기에서 "차트 만들기"를 먼저 눌러 주세요.</p>
      ) : (
        <ul className="list">
          {picked.sections.map((s) => (
            <li key={`${s.pieceIndex}:${s.sectionIndex}`}>
              <button className="pick" onClick={() => onOpen(picked.id, s)}>{s.label}</button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
