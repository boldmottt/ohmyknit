import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TECHNIQUE_LABEL, type Technique } from '@knitcloset/pattern-schema';
import { api, fileUrl } from '../api';
import { fmtDate, getStoredProfile, useToast } from '../ui';

const WEIGHTS = ['lace', 'fingering', 'sport', 'dk', 'worsted', 'aran', 'bulky'];
const BODY_KEYS = ['가슴둘레', '허리둘레', '어깨너비', '팔길이', '총장'];

/** 내 손 프로필 (/profile/hands) — 스와치, 보정 계수, 신체 치수 (F3) */
export default function Hands() {
  const profileId = getStoredProfile();
  const qc = useQueryClient();
  const toast = useToast();
  const hands = useQuery({ queryKey: ['hands', profileId], queryFn: () => api.hands(profileId!), enabled: !!profileId });
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: api.profiles });
  const profile = profiles.data?.find((p) => p.id === profileId);
  const [body, setBody] = useState<Record<string, string>>({});
  useEffect(() => {
    if (profile) setBody(Object.fromEntries(Object.entries(profile.bodyMeasurements).map(([k, v]) => [k, String(v)])));
  }, [profile]);

  const [sw, setSw] = useState({
    yarnName: '',
    yarnWeight: 'dk',
    fiber: '',
    needleMm: '4',
    needleMaterial: 'any',
    technique: 'stockinette',
    stsPre: '',
    rowsPre: '',
    stsPost: '',
    rowsPost: '',
    note: '',
  });
  const [photo, setPhoto] = useState<File | null>(null);
  const addSwatch = useMutation({
    mutationFn: async () => {
      const photoKey = photo ? (await api.upload(photo)).key : undefined;
      const n = (v: string) => (v ? Number(v) : null);
      return api.addSwatch(profileId!, {
        ...sw,
        needleMm: Number(sw.needleMm),
        stsPre: n(sw.stsPre),
        rowsPre: n(sw.rowsPre),
        stsPost: n(sw.stsPost),
        rowsPost: n(sw.rowsPost),
        ...(photoKey ? { photoKey } : {}),
      });
    },
    onSuccess: async () => {
      toast({ text: '스와치를 기록했어요 🧶' });
      setSw((s) => ({ ...s, stsPre: '', rowsPre: '', stsPost: '', rowsPost: '', note: '' }));
      setPhoto(null);
      await qc.invalidateQueries({ queryKey: ['hands'] });
    },
  });
  const delSwatch = useMutation({
    mutationFn: (id: string) => api.deleteSwatch(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hands'] }),
  });
  const resetCoef = useMutation({
    mutationFn: (k: { technique: string; yarnWeight: string; needleMaterial: string }) => api.resetCoefficient(profileId!, k),
    onSuccess: async () => {
      toast({ text: '보정 계수를 초기화했어요' });
      await qc.invalidateQueries({ queryKey: ['hands'] });
      await qc.invalidateQueries({ queryKey: ['suggest'] });
    },
  });
  const saveBody = useMutation({
    mutationFn: () =>
      api.updateProfile(profileId!, {
        bodyMeasurements: Object.fromEntries(Object.entries(body).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)])),
      }),
    onSuccess: async () => {
      toast({ text: '신체 치수를 저장했어요' });
      await qc.invalidateQueries({ queryKey: ['profiles'] });
    },
  });

  if (!profileId) {
    return (
      <div className="page">
        먼저 <Link to="/">옷장</Link>에서 네임태그를 골라 주세요.
      </div>
    );
  }
  const set = (k: keyof typeof sw) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setSw({ ...sw, [k]: e.target.value });

  return (
    <div className="page">
      <div className="page-head">
        <h1>✋ {profile?.name ?? ''}의 손</h1>
      </div>

      <section className="card">
        <h2 className="serif">스와치 기록</h2>
        <p className="small muted">블로킹 후 값이 있으면 그걸 우선으로 써요. 10cm 안의 코·단 수를 적어 주세요.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addSwatch.mutate();
          }}
        >
          <div className="grid2">
            <label className="field"><span>실 이름</span><input value={sw.yarnName} onChange={set('yarnName')} /></label>
            <label className="field">
              <span>실 두께</span>
              <select value={sw.yarnWeight} onChange={set('yarnWeight')}>{WEIGHTS.map((w) => <option key={w}>{w}</option>)}</select>
            </label>
            <label className="field"><span>소재</span><input value={sw.fiber} onChange={set('fiber')} placeholder="울 100%" /></label>
            <label className="field"><span>바늘 (mm)</span><input inputMode="decimal" value={sw.needleMm} onChange={set('needleMm')} /></label>
            <label className="field">
              <span>바늘 재질</span>
              <select value={sw.needleMaterial} onChange={set('needleMaterial')}>
                <option value="any">상관없음</option>
                <option value="metal">금속</option>
                <option value="wood">나무</option>
                <option value="bamboo">대나무</option>
                <option value="carbon">카본</option>
              </select>
            </label>
            <label className="field">
              <span>기법</span>
              <select value={sw.technique} onChange={set('technique')}>
                {(Object.keys(TECHNIQUE_LABEL) as Technique[]).map((t) => <option key={t} value={t}>{TECHNIQUE_LABEL[t]}</option>)}
              </select>
            </label>
            <label className="field"><span>블로킹 전 코</span><input inputMode="decimal" value={sw.stsPre} onChange={set('stsPre')} /></label>
            <label className="field"><span>블로킹 전 단</span><input inputMode="decimal" value={sw.rowsPre} onChange={set('rowsPre')} /></label>
            <label className="field"><span>블로킹 후 코</span><input inputMode="decimal" value={sw.stsPost} onChange={set('stsPost')} /></label>
            <label className="field"><span>블로킹 후 단</span><input inputMode="decimal" value={sw.rowsPost} onChange={set('rowsPost')} /></label>
            <label className="field"><span>사진</span><input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} /></label>
          </div>
          {addSwatch.error && <p className="error">{(addSwatch.error as Error).message}</p>}
          <button className="btn primary" style={{ marginTop: 10 }} disabled={addSwatch.isPending}>기록하기</button>
        </form>

        <ul className="list" style={{ marginTop: 16 }}>
          {hands.data?.swatches.map((s) => (
            <li key={s.id}>
              {s.photoKey && <img src={fileUrl(s.photoKey)} alt="" width={56} height={56} style={{ objectFit: 'cover', borderRadius: 8 }} />}
              <div style={{ flex: 1 }}>
                <b>{s.yarnName || s.yarnWeight}</b> <span className="muted small">{s.needleMm}mm · {TECHNIQUE_LABEL[s.technique as Technique] ?? s.technique}</span>
                <div className="small num">
                  {s.stsPre ? `전 ${s.stsPre}코 ${s.rowsPre ?? '?'}단` : ''}
                  {s.stsPre && s.stsPost ? ' → ' : ''}
                  {s.stsPost ? `후 ${s.stsPost}코 ${s.rowsPost ?? '?'}단` : ''}
                  <span className="muted"> · {fmtDate(s.createdAt)}</span>
                </div>
              </div>
              <button className="btn small ghost" onClick={() => window.confirm('이 스와치 기록을 지울까요?') && delSwatch.mutate(s.id)}>지우기</button>
            </li>
          ))}
          {hands.data && hands.data.swatches.length === 0 && <li className="muted">아직 스와치 기록이 없어요.</li>}
        </ul>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2 className="serif">큰 작품 보정 계수</h2>
        <p className="small muted">
          완성 실측을 넣을 때마다 배워요. 1보다 크면 스와치보다 큰 작품을 더 쫀쫀하게 뜨는 손이에요. 새 프로젝트의 게이지 추천에 자동으로 곱해져요.
        </p>
        {hands.data?.coefficients.length ? (
          <table className="dims">
            <thead>
              <tr><th>기법</th><th>실</th><th>바늘</th><th>코</th><th>단</th><th>표본</th><th /></tr>
            </thead>
            <tbody>
              {hands.data.coefficients.map((c, i) => (
                <tr key={i} className="num">
                  <td>{TECHNIQUE_LABEL[c.technique as Technique] ?? c.technique}</td>
                  <td>{c.yarnWeight}</td>
                  <td>{c.needleMaterial === 'any' ? '—' : c.needleMaterial}</td>
                  <td>×{c.kSt.toFixed(3)}</td>
                  <td>×{c.kRow.toFixed(3)}</td>
                  <td>{c.sampleCount}</td>
                  <td>
                    <button
                      className="btn small ghost"
                      onClick={() =>
                        window.confirm('이 보정 계수를 지우고 스와치 게이지부터 다시 배울까요? (완성 기록은 남아요)') &&
                        resetCoef.mutate({ technique: c.technique, yarnWeight: c.yarnWeight, needleMaterial: c.needleMaterial })
                      }
                    >
                      초기화
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">아직 없어요. 작품을 완성하고 실측을 넣으면 생겨요.</p>
        )}
        {hands.data?.coefficients.some((c) => c.kSt < 0.75 || c.kSt > 1.33 || c.kRow < 0.75 || c.kRow > 1.33) && (
          <p className="badge warn" style={{ display: 'block', padding: 10 }}>
            ⚠ 범위를 벗어난 계수가 있어요. 실측 오타로 잘못 배웠을 수 있어요. 추천에는 0.75~1.33 안으로 줄여서 쓰고 있으니, 초기화를 권해요.
          </p>
        )}
        {hands.data?.finished.length ? (
          <>
            <h3>완성 기록</h3>
            <ul className="list">
              {hands.data.finished.map((f) => (
                <li key={f.projectId} className="small num">
                  <b>{f.name}</b> · {fmtDate(f.finishedAt)} ·{' '}
                  {Object.entries(f.measured).map(([k, v]) => `${k} ${v}cm (예상 ${f.expected[k] ?? '?'}cm)`).join(', ')}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2 className="serif">신체 치수</h2>
        <p className="small muted">사이즈 추천과 AI 도안 생성에 써요.</p>
        <div className="grid2">
          {BODY_KEYS.map((k) => (
            <label key={k} className="field">
              <span>{k} (cm)</span>
              <input inputMode="decimal" value={body[k] ?? ''} onChange={(e) => setBody({ ...body, [k]: e.target.value })} />
            </label>
          ))}
        </div>
        <button className="btn" style={{ marginTop: 10 }} onClick={() => saveBody.mutate()} disabled={saveBody.isPending}>저장</button>
      </section>
    </div>
  );
}
