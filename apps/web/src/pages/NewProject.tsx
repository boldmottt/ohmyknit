import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { recommendNeedle } from '@knitcloset/gauge-engine';
import { api, type ConversionPreview, type GaugeSuggestion } from '../api';
import { Garment } from '../closet/Garment';
import { getStoredProfile, useToast } from '../ui';

const STEPS = ['도안', '사이즈', '게이지 보정', '정보', '옷장에 걸기'];

/** 새 프로젝트 마법사 (기획서 Part 6) */
export default function NewProject() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const profileId = getStoredProfile();
  const [step, setStep] = useState(0);
  const [patternId, setPatternId] = useState<string>(sp.get('pattern') ?? '');
  const [size, setSize] = useState('');
  const [gauge, setGauge] = useState({ st: '', row: '' });
  const [basis, setBasis] = useState<GaugeSuggestion | null>(null);
  const [mode, setMode] = useState<'recalc' | 'needle'>('recalc');
  const [info, setInfo] = useState({ name: '', yarn: '', needleMm: '', ballGrams: '', startedAt: new Date().toISOString().slice(0, 10) });
  const [createdId, setCreatedId] = useState<string | null>(null);

  const patterns = useQuery({ queryKey: ['patterns'], queryFn: api.patterns });
  const pattern = useQuery({ queryKey: ['pattern', patternId], queryFn: () => api.pattern(patternId), enabled: !!patternId });
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: api.profiles });
  const profile = profiles.data?.find((p) => p.id === profileId);

  if (!profileId) {
    return (
      <div className="page">
        <p>먼저 옷장에서 네임태그를 골라 주세요.</p>
        <Link to="/">옷장으로</Link>
      </div>
    );
  }

  const pat = pattern.data?.pattern;
  return (
    <div className="page">
      <div className="page-head">
        <h1>새 작품 걸기</h1>
      </div>
      <div className="stepper" aria-label="단계">
        {STEPS.map((s, i) => (
          <span key={s} className={i === step ? 'on' : ''} aria-current={i === step ? 'step' : undefined}>
            {i + 1}. {s}
          </span>
        ))}
      </div>

      {step === 0 && (
        <StepPattern
          patterns={patterns.data ?? []}
          loading={patterns.isLoading}
          selected={patternId}
          onSelect={(id) => {
            setPatternId(id);
            setSize('');
          }}
          onNext={() => setStep(1)}
        />
      )}
      {step === 1 && pat && (
        <StepSize
          sizes={pat.sizes}
          body={profile?.bodyMeasurements ?? {}}
          selected={size}
          onSelect={setSize}
          onBack={() => setStep(0)}
          onNext={() => setStep(2)}
        />
      )}
      {step === 2 && pat && (
        <StepGauge
          profileId={profileId}
          patternId={patternId}
          patternGauge={pat.gauge}
          size={size}
          gauge={gauge}
          setGauge={setGauge}
          basis={basis}
          setBasis={setBasis}
          mode={mode}
          setMode={setMode}
          onBack={() => setStep(1)}
          onNext={() => {
            setInfo((i) => ({
              ...i,
              name: i.name || pat.title,
              yarn: i.yarn || pat.yarn,
              needleMm: i.needleMm || String(pat.gauge.needleMm ?? ''),
            }));
            setStep(3);
          }}
        />
      )}
      {step === 3 && pat && (
        <StepInfo
          info={info}
          setInfo={setInfo}
          onBack={() => setStep(2)}
          onCreate={async () => {
            const { id } = await api.createProject({
              profileId,
              patternId,
              size,
              myGauge: { st: Number(gauge.st), row: Number(gauge.row) },
              gaugeBasis: basis
                ? { swatchId: basis.swatchId, swatchSt: basis.swatchSt, swatchRow: basis.swatchRow, kSt: basis.kSt, kRow: basis.kRow, source: basis.source }
                : {},
              mode,
              name: info.name,
              yarn: info.yarn,
              needleMm: info.needleMm ? Number(info.needleMm) : null,
              ballGrams: info.ballGrams ? Number(info.ballGrams) : null,
              startedAt: new Date(`${info.startedAt}T12:00:00`).getTime(),
            });
            setCreatedId(id);
            setStep(4);
          }}
        />
      )}
      {step === 4 && createdId && pat && (
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="hang-anim" style={{ width: 180, margin: '0 auto' }}>
            <Garment id={createdId} palette={pat.palette} progress={0} swing label={info.name} />
          </div>
          <h2 className="serif">"{info.name}"을 옷장에 걸었어요 🎉</h2>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="btn" onClick={() => nav('/', { state: { returnedFrom: createdId } })}>옷장으로</button>
            <button className="btn primary" onClick={() => nav(`/project/${createdId}/work`)}>바로 시작하기</button>
          </div>
        </div>
      )}
      {(step === 1 || step === 2 || step === 3) && !pat && <p className="muted">도안을 불러오는 중…</p>}
    </div>
  );
}

function StepPattern(p: {
  patterns: { id: string; title: string; designer: string; sourceType: string; gauge: { st: number; row: number } }[];
  loading: boolean;
  selected: string;
  onSelect: (id: string) => void;
  onNext: () => void;
}) {
  const qc = useQueryClient();
  const sample = useMutation({
    mutationFn: api.addSamplePattern,
    onSuccess: async ({ id }) => {
      await qc.invalidateQueries({ queryKey: ['patterns'] });
      p.onSelect(id);
    },
  });
  return (
    <div className="card">
      <h2 className="serif">어떤 도안으로 뜰까요?</h2>
      {p.loading && <p className="muted">불러오는 중…</p>}
      <ul className="list">
        {p.patterns.map((x) => (
          <li key={x.id}>
            <button className="pick" aria-pressed={p.selected === x.id} onClick={() => p.onSelect(x.id)}>
              <b>{x.title}</b>{' '}
              <span className="muted small">
                {x.designer} · {x.sourceType === 'pdf' ? 'PDF' : x.sourceType === 'ai' ? 'AI 생성' : x.sourceType === 'design' ? '내 디자인' : '직접 입력'} · {x.gauge.st}코 {x.gauge.row}단
              </span>
            </button>
          </li>
        ))}
      </ul>
      {!p.loading && p.patterns.length === 0 && <p className="muted">도안 보관함이 비어 있어요.</p>}
      <div className="row" style={{ marginTop: 14 }}>
        <Link className="btn" to="/patterns">📜 PDF 올리기 · AI 생성 · 직접 입력</Link>
        <button className="btn" onClick={() => sample.mutate()} disabled={sample.isPending}>🧶 샘플 도안 추가</button>
        <button className="btn primary" style={{ marginLeft: 'auto' }} disabled={!p.selected} onClick={p.onNext}>다음</button>
      </div>
    </div>
  );
}

function StepSize(p: {
  sizes: { label: string; finished: Record<string, number> }[];
  body: Record<string, number>;
  selected: string;
  onSelect: (s: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  // 신체 가슴둘레 + 여유분 8cm에 가장 가까운 사이즈 추천 (F3-6 간단판)
  const chest = p.body['가슴둘레'];
  const recommended = useMemo(() => {
    if (!chest) return null;
    let best: string | null = null;
    let diff = Infinity;
    for (const s of p.sizes) {
      const f = s.finished['가슴둘레'];
      if (!f) continue;
      const d = Math.abs(f - (chest + 8));
      if (d < diff) {
        diff = d;
        best = s.label;
      }
    }
    return best;
  }, [chest, p.sizes]);
  useEffect(() => {
    if (!p.selected && recommended) p.onSelect(recommended);
  }, [recommended, p]);
  return (
    <div className="card">
      <h2 className="serif">사이즈를 골라 주세요</h2>
      {chest ? (
        <p className="muted small">내 가슴둘레 {chest}cm + 여유분 약 8cm 기준으로 추천했어요.</p>
      ) : (
        <p className="muted small">"내 손" 화면에 신체 치수를 넣으면 사이즈를 추천해 드려요.</p>
      )}
      <div className="grid2">
        {p.sizes.map((s) => (
          <button key={s.label} className="pick" aria-pressed={p.selected === s.label} onClick={() => p.onSelect(s.label)}>
            <b>{s.label}</b> {recommended === s.label && <span className="badge">추천</span>}
            {Object.entries(s.finished).map(([k, v]) => (
              <div key={k} className="small muted num">
                {k} {v}cm
              </div>
            ))}
          </button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn" onClick={p.onBack}>이전</button>
        <button className="btn primary" style={{ marginLeft: 'auto' }} disabled={!p.selected} onClick={p.onNext}>다음</button>
      </div>
    </div>
  );
}

function StepGauge(p: {
  profileId: string;
  patternId: string;
  patternGauge: { st: number; row: number; needleMm?: number; technique?: string };
  size: string;
  gauge: { st: string; row: string };
  setGauge: (g: { st: string; row: string }) => void;
  basis: GaugeSuggestion | null;
  setBasis: (b: GaugeSuggestion | null) => void;
  mode: 'recalc' | 'needle';
  setMode: (m: 'recalc' | 'needle') => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const qc = useQueryClient();
  const [yarnWeight, setYarnWeight] = useState('dk');
  const suggestion = useQuery({
    queryKey: ['suggest', p.profileId, p.patternGauge.st, p.patternGauge.row, yarnWeight],
    queryFn: () =>
      api.suggestGauge(p.profileId, {
        patternSt: p.patternGauge.st,
        patternRow: p.patternGauge.row,
        technique: p.patternGauge.technique,
        yarnWeight,
      }),
  });
  const hands = useQuery({ queryKey: ['hands', p.profileId], queryFn: () => api.hands(p.profileId) });
  const { setGauge, setBasis, gauge } = p;
  useEffect(() => {
    if (suggestion.data && !gauge.st) {
      setGauge({ st: String(suggestion.data.st), row: String(suggestion.data.row) });
      setBasis(suggestion.data);
    }
  }, [suggestion.data, gauge.st, setGauge, setBasis]);

  const st = Number(p.gauge.st);
  const row = Number(p.gauge.row);
  const valid = st > 0 && row > 0;
  const [preview, setPreview] = useState<ConversionPreview | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!valid) return;
    const t = setTimeout(() => {
      api
        .preview(p.patternId, { size: p.size, myGauge: { st, row }, mode: p.mode })
        .then((r) => {
          setPreview(r);
          setErr('');
        })
        .catch((e) => setErr((e as Error).message));
    }, 300);
    return () => clearTimeout(t);
  }, [st, row, p.mode, p.patternId, p.size, valid]);

  const [sw, setSw] = useState({ st: '', row: '', needle: String(p.patternGauge.needleMm ?? '') });
  const addSwatch = useMutation({
    mutationFn: () =>
      api.addSwatch(p.profileId, {
        stsPost: Number(sw.st),
        rowsPost: Number(sw.row),
        needleMm: Number(sw.needle),
        yarnWeight,
        technique: p.patternGauge.technique ?? 'stockinette',
      }),
    onSuccess: async () => {
      p.setGauge({ st: '', row: '' });
      await qc.invalidateQueries({ queryKey: ['suggest'] });
      await qc.invalidateQueries({ queryKey: ['hands'] });
    },
  });

  const needleRec = valid && p.patternGauge.needleMm
    ? recommendNeedle(
        p.patternGauge.st,
        { needleMm: p.patternGauge.needleMm, st },
        (hands.data?.swatches ?? [])
          .filter((s) => s.yarnWeight === yarnWeight)
          .map((s) => ({ needleMm: s.needleMm, st: (s.stsPost ?? s.stsPre)! }))
          .filter((s) => s.st > 0),
      )
    : null;

  return (
    <div className="card">
      <h2 className="serif">내 손에 맞추기</h2>
      <p className="small">
        도안 게이지: <b className="num">{p.patternGauge.st}코 {p.patternGauge.row}단</b> (10cm)
        {p.patternGauge.needleMm ? ` · ${p.patternGauge.needleMm}mm` : ''}
      </p>
      {suggestion.data && <p className="small muted">💡 {suggestion.data.explanation}</p>}
      <div className="grid2">
        <label className="field">
          <span>실 두께</span>
          <select value={yarnWeight} onChange={(e) => { setYarnWeight(e.target.value); p.setGauge({ st: '', row: '' }); }}>
            {['lace', 'fingering', 'sport', 'dk', 'worsted', 'aran', 'bulky'].map((w) => (
              <option key={w}>{w}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>내 코 게이지 (10cm)</span>
          <input inputMode="decimal" value={p.gauge.st} onChange={(e) => { p.setGauge({ ...p.gauge, st: e.target.value }); p.setBasis(null); }} />
        </label>
        <label className="field">
          <span>내 단 게이지 (10cm)</span>
          <input inputMode="decimal" value={p.gauge.row} onChange={(e) => { p.setGauge({ ...p.gauge, row: e.target.value }); p.setBasis(null); }} />
        </label>
      </div>
      <details style={{ margin: '10px 0' }}>
        <summary>새 스와치 입력하기</summary>
        <div className="grid2" style={{ marginTop: 8 }}>
          <label className="field"><span>블로킹 후 코 (10cm)</span><input inputMode="decimal" value={sw.st} onChange={(e) => setSw({ ...sw, st: e.target.value })} /></label>
          <label className="field"><span>블로킹 후 단 (10cm)</span><input inputMode="decimal" value={sw.row} onChange={(e) => setSw({ ...sw, row: e.target.value })} /></label>
          <label className="field"><span>바늘 (mm)</span><input inputMode="decimal" value={sw.needle} onChange={(e) => setSw({ ...sw, needle: e.target.value })} /></label>
        </div>
        <button className="btn small" style={{ marginTop: 8 }} disabled={!(Number(sw.st) > 0 && Number(sw.row) > 0 && Number(sw.needle) > 0)} onClick={() => addSwatch.mutate()}>
          스와치 저장하고 다시 추천받기
        </button>
      </details>

      <div className="seg" role="group" aria-label="변환 방식" style={{ margin: '8px 0' }}>
        <button aria-pressed={p.mode === 'recalc'} onClick={() => p.setMode('recalc')}>콧수 재계산</button>
        <button aria-pressed={p.mode === 'needle'} onClick={() => p.setMode('needle')}>바늘 교체</button>
      </div>
      {p.mode === 'needle' && needleRec && (
        <p className="badge warn" style={{ display: 'block', padding: 10 }}>
          🪡 <b>{needleRec.needleMm}mm</b> 바늘로 바꿔 보세요 — {needleRec.explanation}
        </p>
      )}

      {err && <p className="error">{err}</p>}
      {preview && (
        <div className="compare-cols" style={{ marginTop: 10 }}>
          {preview.pieces
            .filter((pc, i, arr) => arr.findIndex((x) => x.name.replace(/ \d+$/, '') === pc.name.replace(/ \d+$/, '')) === i)
            .map((pc) => (
              <div key={pc.id} className="card" style={{ boxShadow: 'none' }}>
                <b>{pc.name.replace(/ \d+$/, '')}</b>
                <div className="num">
                  시작 {pc.castOn.original}코 → <b>{pc.castOn.value}코</b>
                </div>
                <div className="small num">
                  완성 예상 {pc.castOn.expectedWidthCm}cm <span className="muted">(설계 {pc.castOn.designWidthCm}cm)</span>
                </div>
                {pc.castOn.asIsWidthCm !== pc.castOn.designWidthCm && p.mode === 'recalc' && (
                  <div className="small muted num">그대로 떴다면 {pc.castOn.asIsWidthCm}cm</div>
                )}
                {pc.sections.map((s, i) => (
                  <div key={i} className="small">
                    {s.name}: {s.originalRows}단 → <b className="num">{s.rows}단</b>
                    {s.shapingNotes.map((n, j) => (
                      <div key={j} className="warn-text">⚠ {n}</div>
                    ))}
                  </div>
                ))}
                {pc.warnings.map((w, i) => (
                  <p key={i} className="error small">{w}</p>
                ))}
                <details className="small muted">
                  <summary>계산식 보기</summary>
                  {pc.castOn.explanation}
                </details>
              </div>
            ))}
        </div>
      )}
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn" onClick={p.onBack}>이전</button>
        <button className="btn primary" style={{ marginLeft: 'auto' }} disabled={!valid || !preview} onClick={p.onNext}>다음</button>
      </div>
    </div>
  );
}

function StepInfo(p: {
  info: { name: string; yarn: string; needleMm: string; ballGrams: string; startedAt: string };
  setInfo: (i: StepInfoProps) => void;
  onBack: () => void;
  onCreate: () => Promise<void>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: keyof StepInfoProps) => (e: React.ChangeEvent<HTMLInputElement>) => p.setInfo({ ...p.info, [k]: e.target.value });
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await p.onCreate();
        } catch (x) {
          setErr((x as Error).message);
          toast({ text: '만들지 못했어요' });
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="serif">작품 정보</h2>
      <div className="grid2">
        <label className="field"><span>이름</span><input value={p.info.name} onChange={set('name')} required /></label>
        <label className="field"><span>실</span><input value={p.info.yarn} onChange={set('yarn')} /></label>
        <label className="field"><span>바늘 (mm)</span><input inputMode="decimal" value={p.info.needleMm} onChange={set('needleMm')} /></label>
        <label className="field"><span>한 볼 무게 (g)</span><input inputMode="decimal" value={p.info.ballGrams} onChange={set('ballGrams')} placeholder="50" /></label>
        <label className="field"><span>시작일</span><input type="date" value={p.info.startedAt} onChange={set('startedAt')} /></label>
      </div>
      {err && <p className="error">{err}</p>}
      <div className="row" style={{ marginTop: 14 }}>
        <button type="button" className="btn" onClick={p.onBack}>이전</button>
        <button className="btn primary" style={{ marginLeft: 'auto' }} disabled={busy || !p.info.name.trim()}>옷장에 걸기</button>
      </div>
    </form>
  );
}

type StepInfoProps = { name: string; yarn: string; needleMm: string; ballGrams: string; startedAt: string };
