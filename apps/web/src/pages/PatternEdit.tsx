import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { convertPattern } from '@knitcloset/gauge-engine';
import { parsePattern, TECHNIQUE_LABEL, type Technique } from '@knitcloset/pattern-schema';
import { api, fileUrl } from '../api';
import { blankPattern, DRAFT_KEY } from './Patterns';
import { getStoredProfile, NumInput, useToast } from '../ui';
import { parseLooseJson } from '../derive';

/* 편집 중인 도안은 느슨한 형태(입력 중 빈 값 허용)로 다루고 저장할 때 검증합니다 */
type SV = number | Record<string, number>;
type EShaping = { kind: 'inc' | 'dec'; everyRows: SV; times: SV; stitchesPerEvent: number; position: string; afterRows?: SV };
type EEvent = { kind: 'bindoff' | 'split' | 'pickup' | 'color' | 'note' | 'checkin'; atRow: number | 'end'; stitches?: SV; text: string; lock?: boolean };
type ESection = { name: string; technique: Technique; rows: SV; instruction: string; chart?: { grid: number[][]; repeatW?: number }; shaping: EShaping[]; events: EEvent[] };
type EPiece = { id: string; name: string; construction: 'flat' | 'round'; direction: 'top_down' | 'bottom_up'; count: number; castOn: SV; stitchMultiple?: number; sections: ESection[] };
type EPattern = {
  title: string;
  designer: string;
  yarn: string;
  gauge: { st: number; row: number; needleMm?: number; technique?: Technique };
  palette: { name: string; hex: string }[];
  sizes: { label: string; finished: Record<string, number> }[];
  pieces: EPiece[];
};

function normalize(p: unknown): EPattern {
  const x = p as Partial<EPattern>;
  const base = blankPattern() as unknown as EPattern;
  return {
    ...base,
    ...x,
    gauge: { ...base.gauge, ...(x.gauge ?? {}) },
    palette: x.palette?.length ? x.palette : base.palette,
    sizes: x.sizes?.length ? x.sizes.map((s) => ({ label: s.label, finished: s.finished ?? {} })) : base.sizes,
    pieces: (x.pieces ?? base.pieces).map((pc) => ({
      ...pc,
      count: pc.count ?? 1,
      construction: pc.construction ?? 'flat',
      direction: pc.direction ?? 'bottom_up',
      sections: pc.sections.map((s) => ({ ...s, technique: s.technique ?? 'stockinette', instruction: s.instruction ?? '', shaping: s.shaping ?? [], events: s.events ?? [] })),
    })),
  };
}

const EDIT_DRAFT_PREFIX = 'kc.patternEdit:';

const TECHS = Object.keys(TECHNIQUE_LABEL) as Technique[];
const EVENT_LABEL: Record<EEvent['kind'], string> = { bindoff: '코막음', split: '분리', pickup: '코줍기', color: '배색 변경', note: '메모', checkin: '실측' };

/** 도안 입력·수정·검수 (/patterns/new, /patterns/:id/edit, /patterns/:id/review) — F2-1, F2-2, F2-3 */
export default function PatternEdit() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [pat, setPat] = useState<EPattern | null>(null);
  const [fileKey, setFileKey] = useState<string | undefined>();
  const [sourceType, setSourceType] = useState('manual');
  const [notes, setNotes] = useState<string[]>([]);
  const [mode, setMode] = useState<'form' | 'json'>('form');
  const [json, setJson] = useState('');
  const [errors, setErrors] = useState('');
  const [saving, setSaving] = useState(false);
  /** 불러온 그대로의 도안 (이것과 다르면 저장 안 된 변경이 있는 것) */
  const [baseline, setBaseline] = useState('');
  const draftKey = useRef('');

  /** 입력하던 내용이 기기에 남아 있으면 되살림 */
  const loadBase = (base: EPattern, key: string) => {
    draftKey.current = EDIT_DRAFT_PREFIX + key;
    setBaseline(JSON.stringify(base));
    setPat(base);
    try {
      const raw = localStorage.getItem(draftKey.current);
      if (!raw) return;
      const d = JSON.parse(raw) as { pat: EPattern; json?: string; at: number };
      if (JSON.stringify(d.pat) === JSON.stringify(base) && d.json === undefined) return;
      setPat(normalize(d.pat));
      if (d.json !== undefined) {
        setJson(d.json);
        setMode('json');
      }
      toast({
        text: `저장하지 않고 나갔던 입력을 되살렸어요 (${new Date(d.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })})`,
        ms: 10000,
        action: {
          label: '버리기',
          run: () => {
            localStorage.removeItem(draftKey.current);
            setPat(base);
            setMode('form');
          },
        },
      });
    } catch {
      /* 초안을 못 읽으면 그냥 넘어감 */
    }
  };

  useEffect(() => {
    if (id) {
      void api.pattern(id).then((r) => {
        setFileKey(r.fileKey ?? undefined);
        setSourceType(r.sourceType);
        loadBase(normalize(r.pattern), id);
      });
      return;
    }
    if (sp.get('review')) {
      try {
        const d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null');
        if (d) {
          loadBase(normalize(d.pattern), `review:${d.fileKey ?? ''}`);
          setNotes(d.reviewNotes ?? []);
          setFileKey(d.fileKey);
          setSourceType(d.sourceType ?? 'manual');
          if (d.validationError) setErrors(d.validationError);
          return;
        }
      } catch {
        /* 무시 */
      }
    }
    loadBase(normalize(blankPattern()), 'new');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, sp]);

  // 입력할 때마다 기기에 임시 저장 (다른 화면에 갔다 오거나 새로고침해도 남게)
  const dirty = !!pat && !!baseline && (JSON.stringify(pat) !== baseline || (mode === 'json' && json !== JSON.stringify(pat, null, 2)));
  useEffect(() => {
    if (!pat || !draftKey.current || !baseline) return;
    try {
      if (dirty) localStorage.setItem(draftKey.current, JSON.stringify({ pat, ...(mode === 'json' ? { json } : {}), at: Date.now() }));
      else localStorage.removeItem(draftKey.current);
    } catch {
      /* 저장 공간이 없으면 임시 저장 없이 동작 */
    }
  }, [pat, json, mode, dirty, baseline]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const preview = useMemo(() => {
    if (!pat) return null;
    try {
      const parsed = parsePattern(pat);
      const conv = convertPattern(parsed, { size: parsed.sizes[0]!.label, myGauge: parsed.gauge, mode: 'needle' });
      return { ok: true as const, conv };
    } catch (e) {
      return { ok: false as const, msg: (e as Error).message };
    }
  }, [pat]);

  if (!pat) return <div className="page muted">불러오는 중…</div>;

  const upd = (f: (p: EPattern) => void) => {
    const next = structuredClone(pat);
    f(next);
    setPat(next);
  };

  async function save() {
    setErrors('');
    let candidate: unknown = pat;
    if (mode === 'json') {
      try {
        candidate = parseLooseJson(json);
      } catch (e) {
        setErrors(`JSON 형식 오류: ${(e as Error).message}`);
        return;
      }
    }
    try {
      parsePattern(candidate);
    } catch (e) {
      setErrors((e as Error).message);
      return;
    }
    setSaving(true);
    try {
      if (id) await api.updatePattern(id, candidate, fileKey);
      else await api.createPattern(candidate, { profileId: getStoredProfile() ?? undefined, sourceType, fileKey });
      sessionStorage.removeItem(DRAFT_KEY);
      try {
        localStorage.removeItem(draftKey.current);
      } catch {
        /* 무시 */
      }
      setBaseline('');
      await qc.invalidateQueries({ queryKey: ['patterns'] });
      toast({ text: '도안을 저장했어요 📜' });
      nav('/patterns');
    } catch (e) {
      setErrors((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const sizeLabels = pat.sizes.map((s) => s.label).filter(Boolean);

  return (
    <div className="page" style={{ maxWidth: fileKey ? 1400 : 1100 }}>
      <div className="page-head">
        <h1>{id ? '도안 수정' : sp.get('review') ? '도안 검수' : '새 도안 입력'}</h1>
        <div className="seg" role="group">
          <button
            aria-pressed={mode === 'form'}
            onClick={() => {
              if (mode === 'json') {
                try {
                  setPat(normalize(parseLooseJson(json)));
                } catch {
                  setErrors('JSON을 고친 뒤 전환해 주세요');
                  return;
                }
              }
              setMode('form');
            }}
          >
            양식
          </button>
          <button
            aria-pressed={mode === 'json'}
            onClick={() => {
              setJson(JSON.stringify(pat, null, 2));
              setMode('json');
            }}
          >
            JSON
          </button>
        </div>
        <button className="btn primary" onClick={() => void save()} disabled={saving}>저장</button>
      </div>

      {notes.length > 0 && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'var(--warn)' }}>
          <b>🔍 꼭 확인해 주세요</b>
          <ul>{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </div>
      )}
      {errors && <pre className="error" style={{ whiteSpace: 'pre-wrap' }}>{errors}</pre>}

      <div style={{ display: 'grid', gridTemplateColumns: fileKey ? 'minmax(0,1fr) minmax(0,1fr)' : '1fr', gap: 16 }}>
        <div>
          {mode === 'json' ? (
            <textarea className="input json-box" value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} />
          ) : (
            <>
              <section className="card">
                <h2 className="serif">기본 정보</h2>
                <div className="grid2">
                  <Field label="제목" value={pat.title} onChange={(v) => upd((p) => void (p.title = v))} />
                  <Field label="작가" value={pat.designer} onChange={(v) => upd((p) => void (p.designer = v))} />
                  <Field label="실" value={pat.yarn} onChange={(v) => upd((p) => void (p.yarn = v))} />
                </div>
                <h3>게이지 (10cm)</h3>
                <div className="grid2">
                  <Num label="코" value={pat.gauge.st} onChange={(v) => upd((p) => void (p.gauge.st = v))} />
                  <Num label="단" value={pat.gauge.row} onChange={(v) => upd((p) => void (p.gauge.row = v))} />
                  <Num label="바늘 (mm)" value={pat.gauge.needleMm ?? 0} onChange={(v) => upd((p) => void (p.gauge.needleMm = v || undefined))} />
                  <label className="field">
                    <span>기법</span>
                    <select value={pat.gauge.technique ?? 'stockinette'} onChange={(e) => upd((p) => void (p.gauge.technique = e.target.value as Technique))}>
                      {TECHS.map((t) => <option key={t} value={t}>{TECHNIQUE_LABEL[t]}</option>)}
                    </select>
                  </label>
                </div>
              </section>

              <section className="card" style={{ marginTop: 14 }}>
                <h2 className="serif">색 팔레트</h2>
                <div className="row">
                  {pat.palette.map((c, i) => (
                    <div key={i} className="row" style={{ gap: 4 }}>
                      <input type="color" value={c.hex} onChange={(e) => upd((p) => void (p.palette[i]!.hex = e.target.value.toUpperCase()))} aria-label={`${i}번 색`} />
                      <input className="input" style={{ width: 110 }} value={c.name} onChange={(e) => upd((p) => void (p.palette[i]!.name = e.target.value))} aria-label={`${i}번 색 이름`} />
                      {i > 0 && <button className="btn ghost small" onClick={() => upd((p) => {
                        p.palette.splice(i, 1);
                        for (const pc of p.pieces) for (const sec of pc.sections) {
                          if (sec.chart) sec.chart.grid = sec.chart.grid.map((row) => row.map((v) => (v === i ? 0 : v > i ? v - 1 : v)));
                        }
                      })} aria-label="색 지우기">✕</button>}
                    </div>
                  ))}
                  <button className="btn small" onClick={() => upd((p) => void p.palette.push({ name: `색${p.palette.length}`, hex: '#E8A6A8' }))}>+ 색</button>
                </div>
                <p className="small muted">0번이 바탕색이에요. 차트의 칸 번호가 이 순서를 가리켜요.</p>
              </section>

              <section className="card" style={{ marginTop: 14 }}>
                <h2 className="serif">사이즈표</h2>
                {pat.sizes.map((s, i) => (
                  <div key={i} className="row" style={{ marginBottom: 8 }}>
                    <input className="input" style={{ width: 80 }} value={s.label} onChange={(e) => upd((p) => void (p.sizes[i]!.label = e.target.value))} aria-label="사이즈 이름" />
                    {Object.entries(s.finished).map(([k, v]) => (
                      <span key={k} className="row" style={{ gap: 4 }}>
                        <span className="small">{k}</span>
                        <NumInput className="input" style={{ width: 80 }} value={v} min={0} onCommit={(n) => upd((p) => void (p.sizes[i]!.finished[k] = n))} aria-label={`${s.label} ${k}`} />
                      </span>
                    ))}
                    <button className="btn ghost small" onClick={() => {
                      const k = window.prompt('치수 이름 (예: 총장, 소매길이)');
                      if (k) upd((p) => { for (const z of p.sizes) z.finished[k] ??= 0; });
                    }}>+ 치수</button>
                    {pat.sizes.length > 1 && <button className="btn ghost small" onClick={() => upd((p) => void p.sizes.splice(i, 1))}>✕</button>}
                  </div>
                ))}
                <button className="btn small" onClick={() => upd((p) => void p.sizes.push({ label: '', finished: Object.fromEntries(Object.keys(p.sizes[0]?.finished ?? {}).map((k) => [k, 0])) }))}>+ 사이즈</button>
              </section>

              {pat.pieces.map((pc, pi) => (
                <PieceEditor key={pi} {...(id ? { studioBase: `/studio/${id}?piece=${pi}` } : {})} piece={pc} sizes={sizeLabels} palette={pat.palette} onChange={(np) => upd((p) => void (p.pieces[pi] = np))} onRemove={pat.pieces.length > 1 ? () => upd((p) => void p.pieces.splice(pi, 1)) : undefined} />
              ))}
              <button className="btn" style={{ marginTop: 14 }} onClick={() => upd((p) => void p.pieces.push({ id: `piece${p.pieces.length + 1}`, name: '새 조각', construction: 'flat', direction: 'bottom_up', count: 1, castOn: 60, sections: [{ name: '몸통', technique: 'stockinette', rows: 40, instruction: '겉뜨기', shaping: [], events: [] }] }))}>
                + 조각 추가
              </button>
            </>
          )}

          <section className="card" style={{ marginTop: 14 }}>
            <h2 className="serif">확인</h2>
            {preview?.ok ? (
              <ul className="small">
                {preview.conv.pieces.map((p) => (
                  <li key={p.id} className="num">
                    {p.name}: 코잡기 {p.castOn.value}코 · 총 {p.totalRows}단 · 마지막 {p.rows.at(-1)?.stitchCount}코
                    {p.warnings.map((w, i) => <div key={i} className="warn-text">⚠ {w}</div>)}
                  </li>
                ))}
              </ul>
            ) : (
              <pre className="error small" style={{ whiteSpace: 'pre-wrap' }}>{preview?.msg}</pre>
            )}
          </section>
        </div>
        {fileKey && (
          <aside style={{ position: 'sticky', top: 70, alignSelf: 'start' }}>
            <span className="badge warn">원본 PDF</span>
            <iframe title="원본 도안" src={fileUrl(fileKey)} style={{ width: '100%', height: '80vh', border: '1px solid var(--panel-border)', borderRadius: 10, marginTop: 6 }} />
          </aside>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Num({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <NumInput value={value || undefined} min={0} onCommit={onChange} />
    </label>
  );
}

/** 사이즈 공통 값 또는 사이즈별 값 */
function SizeInput({ label, value, sizes, onChange }: { label: string; value: SV | undefined; sizes: string[]; onChange: (v: SV) => void }) {
  const per = typeof value === 'object';
  return (
    <div className="field">
      <span>
        {label}{' '}
        {sizes.length > 1 && (
          <button
            type="button"
            className="btn ghost small"
            onClick={() => onChange(per ? (Object.values(value as Record<string, number>)[0] ?? 0) : Object.fromEntries(sizes.map((s) => [s, (value as number) ?? 0])))}
          >
            {per ? '공통 값으로' : '사이즈별로'}
          </button>
        )}
      </span>
      {per ? (
        <div className="row" style={{ gap: 4 }}>
          {sizes.map((s) => (
            <NumInput key={s} className="input" style={{ width: 72 }} integer min={0} aria-label={`${label} ${s}`} placeholder={s} value={(value as Record<string, number>)[s]} onCommit={(n) => onChange({ ...(value as Record<string, number>), [s]: n })} />
          ))}
        </div>
      ) : (
        <NumInput className="input" integer min={0} value={value as number | undefined} onCommit={onChange} />
      )}
    </div>
  );
}

function PieceEditor({ piece, sizes, palette, onChange, onRemove, studioBase }: { piece: EPiece; sizes: string[]; palette: { name: string; hex: string }[]; onChange: (p: EPiece) => void; onRemove?: () => void; studioBase?: string }) {
  const set = (f: (p: EPiece) => void) => {
    const n = structuredClone(piece);
    f(n);
    onChange(n);
  };
  return (
    <section className="card" style={{ marginTop: 14 }}>
      <div className="row">
        <h2 className="serif" style={{ flex: 1 }}>🧩 {piece.name}</h2>
        {onRemove && <button className="btn small danger" onClick={onRemove}>조각 지우기</button>}
      </div>
      <div className="grid2">
        <Field label="이름" value={piece.name} onChange={(v) => set((p) => void (p.name = v))} />
        <Field label="id (영문)" value={piece.id} onChange={(v) => set((p) => void (p.id = v.replace(/[^\w-]/g, '')))} />
        <label className="field">
          <span>뜨는 방식</span>
          <select value={piece.construction} onChange={(e) => set((p) => void (p.construction = e.target.value as EPiece['construction']))}>
            <option value="flat">평면뜨기</option>
            <option value="round">원통뜨기</option>
          </select>
        </label>
        <label className="field">
          <span>방향</span>
          <select value={piece.direction} onChange={(e) => set((p) => void (p.direction = e.target.value as EPiece['direction']))}>
            <option value="bottom_up">아래에서 위로</option>
            <option value="top_down">위에서 아래로 (탑다운)</option>
          </select>
        </label>
        <Num label="몇 장 (소매는 2)" value={piece.count} onChange={(v) => set((p) => void (p.count = Math.max(1, Math.round(v))))} />
        <SizeInput label="코잡기" value={piece.castOn} sizes={sizes} onChange={(v) => set((p) => void (p.castOn = v))} />
        <Num label="콧수 배수 (없으면 0)" value={piece.stitchMultiple ?? 0} onChange={(v) => set((p) => void (p.stitchMultiple = v > 0 ? Math.round(v) : undefined))} />
      </div>
      {piece.sections.map((s, si) => (
        <SectionEditor
          key={si}
          index={si}
          section={s}
          sizes={sizes}
          palette={palette}
          onChange={(ns) => set((p) => void (p.sections[si] = ns))}
          {...(studioBase ? { studioHref: `${studioBase}&section=${si}` } : {})}
          onRemove={piece.sections.length > 1 ? () => set((p) => void p.sections.splice(si, 1)) : undefined}
          onMove={(d) => set((p) => {
            const j = si + d;
            if (j < 0 || j >= p.sections.length) return;
            [p.sections[si], p.sections[j]] = [p.sections[j]!, p.sections[si]!];
          })}
        />
      ))}
      <button className="btn small" onClick={() => set((p) => void p.sections.push({ name: '새 구간', technique: 'stockinette', rows: 10, instruction: '', shaping: [], events: [] }))}>+ 구간</button>
    </section>
  );
}

function SectionEditor({ index, section: s, sizes, palette, onChange, onRemove, onMove, studioHref }: { index: number; section: ESection; sizes: string[]; palette: { name: string; hex: string }[]; onChange: (s: ESection) => void; onRemove?: () => void; onMove: (d: number) => void; studioHref?: string }) {
  const set = (f: (x: ESection) => void) => {
    const n = structuredClone(s);
    f(n);
    onChange(n);
  };
  return (
    <div className="sec-card">
      <div className="row">
        <b style={{ flex: 1 }}>{index + 1}. {s.name}</b>
        <button className="btn ghost small" onClick={() => onMove(-1)} aria-label="위로">↑</button>
        <button className="btn ghost small" onClick={() => onMove(1)} aria-label="아래로">↓</button>
        {onRemove && <button className="btn ghost small" onClick={onRemove} aria-label="구간 지우기">✕</button>}
      </div>
      <div className="grid2">
        <Field label="구간 이름" value={s.name} onChange={(v) => set((x) => void (x.name = v))} />
        <label className="field">
          <span>기법</span>
          <select value={s.technique} onChange={(e) => set((x) => void (x.technique = e.target.value as Technique))}>
            {TECHS.map((t) => <option key={t} value={t}>{TECHNIQUE_LABEL[t]}</option>)}
          </select>
        </label>
        <SizeInput label="단 수" value={s.rows} sizes={sizes} onChange={(v) => set((x) => void (x.rows = v))} />
        <Field label="지시 (예: 2코 고무뜨기)" value={s.instruction} onChange={(v) => set((x) => void (x.instruction = v))} />
      </div>

      <details open={!!s.chart} style={{ marginTop: 8 }}>
        <summary>🎨 배색 차트 {s.chart ? `(${s.chart.grid[0]?.length}×${s.chart.grid.length})` : ''}</summary>
        {s.chart && (
          <p className="small" style={{ margin: '6px 0' }}>
            {studioHref ? <Link className="btn small" to={studioHref}>🎨 디자인 스튜디오에서 열기</Link> : <span className="muted">저장한 뒤 디자인 스튜디오(원형 미리보기·실 라이브러리)에서 열 수 있어요</span>}
          </p>
        )}
        {s.chart ? (
          <ChartEditor chart={s.chart} palette={palette} onChange={(c) => set((x) => void (x.chart = c))} onRemove={() => set((x) => void delete x.chart)} />
        ) : (
          <button className="btn small" style={{ marginTop: 6 }} onClick={() => set((x) => {
            x.chart = { grid: Array.from({ length: 8 }, () => Array(12).fill(0)) };
            x.technique = 'colorwork';
            x.rows = 8;
          })}>차트 만들기</button>
        )}
      </details>

      <div style={{ marginTop: 8 }}>
        <b className="small">늘림·줄임</b>
        {s.shaping.map((sh, i) => (
          <div key={i} className="grid2" style={{ alignItems: 'end', marginTop: 6 }}>
            <label className="field">
              <span>종류</span>
              <select value={sh.kind} onChange={(e) => set((x) => void (x.shaping[i]!.kind = e.target.value as 'inc' | 'dec'))}>
                <option value="inc">늘림</option>
                <option value="dec">줄임</option>
              </select>
            </label>
            <SizeInput label="몇 단마다" value={sh.everyRows} sizes={sizes} onChange={(v) => set((x) => void (x.shaping[i]!.everyRows = v))} />
            <SizeInput label="몇 회" value={sh.times} sizes={sizes} onChange={(v) => set((x) => void (x.shaping[i]!.times = v))} />
            <Num label="한 번에 몇 코" value={sh.stitchesPerEvent} onChange={(v) => set((x) => void (x.shaping[i]!.stitchesPerEvent = Math.max(1, Math.round(v))))} />
            <Field label="위치" value={sh.position} onChange={(v) => set((x) => void (x.shaping[i]!.position = v))} />
            <SizeInput label="시작 전 단 수" value={sh.afterRows ?? 0} sizes={sizes} onChange={(v) => set((x) => void (x.shaping[i]!.afterRows = v))} />
            <button className="btn ghost small" onClick={() => set((x) => void x.shaping.splice(i, 1))}>✕ 지우기</button>
          </div>
        ))}
        <button className="btn ghost small" onClick={() => set((x) => void x.shaping.push({ kind: 'inc', everyRows: 6, times: 6, stitchesPerEvent: 2, position: '양끝' }))}>+ 늘림·줄임</button>
      </div>

      <div style={{ marginTop: 8 }}>
        <b className="small">특정 단의 일</b>
        {s.events.map((ev, i) => (
          <div key={i} className="grid2" style={{ alignItems: 'end', marginTop: 6 }}>
            <label className="field">
              <span>종류</span>
              <select value={ev.kind} onChange={(e) => set((x) => void (x.events[i]!.kind = e.target.value as EEvent['kind']))}>
                {(Object.keys(EVENT_LABEL) as EEvent['kind'][]).map((k) => <option key={k} value={k}>{EVENT_LABEL[k]}</option>)}
              </select>
            </label>
            <label className="field">
              <span>구간 안 몇 단째 (0 = 마지막 단)</span>
              <NumInput integer min={0} value={ev.atRow === 'end' ? 0 : ev.atRow} onCommit={(n) => set((x) => void (x.events[i]!.atRow = n > 0 ? n : 'end'))} />
            </label>
            <SizeInput label="콧수 (없으면 0)" value={ev.stitches ?? 0} sizes={sizes} onChange={(v) => set((x) => void (x.events[i]!.stitches = v))} />
            <Field label="설명" value={ev.text} onChange={(v) => set((x) => void (x.events[i]!.text = v))} />
            <label className="row small">
              <input type="checkbox" checked={!!ev.lock} onChange={(e) => set((x) => void (x.events[i]!.lock = e.target.checked))} /> 🔒 확인해야 넘어가기
            </label>
            <button className="btn ghost small" onClick={() => set((x) => void x.events.splice(i, 1))}>✕ 지우기</button>
          </div>
        ))}
        <button className="btn ghost small" onClick={() => set((x) => void x.events.push({ kind: 'bindoff', atRow: 'end', text: '', lock: false }))}>+ 일 추가</button>
      </div>
    </div>
  );
}

/** 배색 차트 도트 에디터 (F2-3). 눌러서 칠하고 끌어서 여러 칸을 칠해요 */
function ChartEditor({ chart, palette, onChange, onRemove }: { chart: { grid: number[][]; repeatW?: number }; palette: { name: string; hex: string }[]; onChange: (c: { grid: number[][]; repeatW?: number }) => void; onRemove: () => void }) {
  const [color, setColor] = useState(1 < palette.length ? 1 : 0);
  const painting = useRef(false);
  const h = chart.grid.length;
  const w = chart.grid[0]?.length ?? 0;
  const paint = (r: number, c: number) => {
    if (chart.grid[r]?.[c] === color) return;
    const g = chart.grid.map((row) => [...row]);
    g[r]![c] = color;
    onChange({ ...chart, grid: g });
  };
  const resize = (nw: number, nh: number) => {
    nw = Math.max(1, Math.min(60, nw));
    nh = Math.max(1, Math.min(80, nh));
    const g = Array.from({ length: nh }, (_, r) => Array.from({ length: nw }, (_, c) => chart.grid[r]?.[c] ?? 0));
    onChange({ ...chart, grid: g, repeatW: chart.repeatW && chart.repeatW <= nw ? chart.repeatW : undefined });
  };
  return (
    <div style={{ marginTop: 8 }}>
      <div className="row">
        {palette.map((p, i) => (
          <button key={i} className="btn small" aria-pressed={color === i} style={{ outline: color === i ? '3px solid var(--accent)' : undefined }} onClick={() => setColor(i)}>
            <i style={{ width: 14, height: 14, background: p.hex, display: 'inline-block', borderRadius: 3 }} /> {p.name}
          </button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <label className="row small">너비 <NumInput className="input" style={{ width: 70 }} integer min={1} max={60} live={false} value={w} onCommit={(n) => resize(n, h)} /></label>
        <label className="row small">높이 <NumInput className="input" style={{ width: 70 }} integer min={1} max={80} live={false} value={h} onCommit={(n) => resize(w, n)} /></label>
        <label className="row small">반복 너비 <NumInput className="input" style={{ width: 70 }} integer min={1} max={w} value={chart.repeatW ?? w} onCommit={(n) => onChange({ ...chart, repeatW: n })} /></label>
        <button className="btn ghost small" onClick={onRemove}>차트 없애기</button>
      </div>
      <div
        className="chart-editor"
        style={{ marginTop: 8 }}
        onPointerUp={() => (painting.current = false)}
        onPointerLeave={() => (painting.current = false)}
      >
        {[...chart.grid.keys()].reverse().map((r) => (
          <div key={r} className="er">
            {chart.grid[r]!.map((c, ci) => (
              <span
                key={ci}
                className="ec"
                style={{ background: c === -1 ? 'repeating-linear-gradient(45deg,#0000 0 3px,#0002 3px 4px)' : palette[c]?.hex ?? '#ccc', borderRight: chart.repeatW && (ci + 1) % chart.repeatW === 0 ? '2px solid #000' : undefined }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
                  painting.current = true;
                  paint(r, ci);
                }}
                onPointerEnter={() => painting.current && paint(r, ci)}
              />
            ))}
            <span className="small muted" style={{ width: 28, textAlign: 'right' }}>{r + 1}</span>
          </div>
        ))}
      </div>
      <p className="small muted">맨 아래 줄이 1단이에요.</p>
    </div>
  );
}
