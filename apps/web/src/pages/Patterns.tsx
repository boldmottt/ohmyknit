import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AiDraft } from '../api';
import { fmtDate, getStoredProfile, useToast } from '../ui';

export const DRAFT_KEY = 'kc.draft';

export function stashDraft(d: AiDraft & { sourceType: string }) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* 무시 */
  }
}

/** 도안 보관함 (/patterns) */
export default function Patterns() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const profileId = getStoredProfile();
  const list = useQuery({ queryKey: ['patterns'], queryFn: api.patterns });
  const ai = useQuery({ queryKey: ['ai'], queryFn: api.aiStatus });
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [request, setRequest] = useState('');

  const sample = useMutation({
    mutationFn: api.addSamplePattern,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['patterns'] }),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.deletePattern(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['patterns'] }),
    onError: (e) => toast({ text: (e as Error).message }),
  });

  async function onPdf(file: File) {
    setErr('');
    try {
      setBusy('PDF 올리는 중…');
      const { key } = await api.upload(file);
      if (ai.data?.enabled) {
        setBusy('AI가 도안을 읽는 중… (1~2분 걸릴 수 있어요)');
        const draft = await api.parsePdf(key);
        stashDraft({ ...draft, fileKey: key, sourceType: 'pdf' });
      } else {
        stashDraft({ pattern: blankPattern(file.name.replace(/\.pdf$/i, '')), reviewNotes: ['AI가 꺼져 있어서 직접 입력해요. 오른쪽 PDF를 보면서 채워 주세요.'], valid: false, model: '', fileKey: key, sourceType: 'pdf' });
      }
      nav('/patterns/new?review=1');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function onGenerate() {
    setErr('');
    setBusy('AI가 도안을 만드는 중… (1~2분 걸릴 수 있어요)');
    try {
      let myGauge: { st: number; row: number; needleMm?: number } | undefined;
      let body: Record<string, number> | undefined;
      if (profileId) {
        const [hands, profiles] = await Promise.all([api.hands(profileId), api.profiles()]);
        const s = hands.swatches[0];
        const st = s?.stsPost ?? s?.stsPre;
        const row = s?.rowsPost ?? s?.rowsPre;
        if (s && st && row) myGauge = { st, row, needleMm: s.needleMm };
        body = profiles.find((p) => p.id === profileId)?.bodyMeasurements;
      }
      const draft = await api.generate({ request, myGauge, body });
      stashDraft({ ...draft, sourceType: 'ai' });
      nav('/patterns/new?review=1');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>도안 보관함</h1>
      </div>
      <p className="muted small">구매한 도안은 이 기기와 집 서버에만 저장되고, 공유·내보내기 기능은 없어요.</p>

      <div className="grid2" style={{ marginBottom: 20 }}>
        <div className="card">
          <h3>📄 PDF 올리기</h3>
          <p className="small muted">{ai.data?.enabled ? 'AI가 게이지·사이즈·단별 지시를 읽어 초안을 만들고, 검수 화면에서 확인해요.' : 'PDF를 옆에 띄워 두고 직접 입력해요. (AI 키를 넣으면 자동으로 읽어요)'}</p>
          <input ref={fileRef} type="file" accept="application/pdf" hidden onChange={(e) => e.target.files?.[0] && void onPdf(e.target.files[0])} />
          <button className="btn primary" disabled={!!busy} onClick={() => fileRef.current?.click()}>PDF 고르기</button>
        </div>
        <div className="card">
          <h3>✏ 직접 입력</h3>
          <p className="small muted">게이지, 사이즈표, 조각, 구간별 지시와 배색 차트를 입력해요.</p>
          <Link className="btn" to="/patterns/new">새 도안 입력</Link>
          <button className="btn ghost" onClick={() => sample.mutate()} disabled={sample.isPending}>샘플 추가</button>
        </div>
        <div className="card">
          <h3>🤖 AI로 새 도안 만들기</h3>
          {ai.data?.enabled ? (
            <>
              <textarea className="input" value={request} onChange={(e) => setRequest(e.target.value)} placeholder="예: DK 실로 뜨는 탑다운 래글런 가디건, 허리 길이" rows={3} />
              <p className="small muted">내 손 게이지와 신체 치수를 반영해요.</p>
              <button className="btn" disabled={!!busy || !request.trim()} onClick={() => void onGenerate()}>만들기</button>
            </>
          ) : (
            <p className="small muted">apps/worker/.dev.vars에 ANTHROPIC_API_KEY를 넣으면 쓸 수 있어요.</p>
          )}
        </div>
      </div>
      {busy && <p className="badge warn" style={{ padding: 10 }}>⏳ {busy}</p>}
      {err && <p className="error">{err}</p>}

      <ul className="list">
        {list.isLoading && <li className="muted">불러오는 중…</li>}
        {list.data?.length === 0 && <li className="muted">아직 도안이 없어요.</li>}
        {list.data?.map((p) => (
          <li key={p.id} className="card" style={{ boxShadow: 'none' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <b>{p.title}</b>
              <div className="small muted num">
                {p.designer || '작가 미상'} · {p.sourceType === 'pdf' ? 'PDF' : p.sourceType === 'ai' ? 'AI 생성' : '직접 입력'} · {p.gauge.st}코 {p.gauge.row}단
                {p.needleMm ? ` · ${p.needleMm}mm` : ''} · {fmtDate(p.updatedAt)}
              </div>
            </div>
            <Link className="btn small" to={`/patterns/${p.id}/edit`}>수정</Link>
            <Link className="btn small primary" to={`/project/new?pattern=${p.id}`}>이 도안으로 뜨기</Link>
            <button className="btn small danger" onClick={() => window.confirm(`"${p.title}" 도안을 지울까요?`) && del.mutate(p.id)}>삭제</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function blankPattern(title = '새 도안') {
  return {
    title,
    designer: '',
    yarn: '',
    gauge: { st: 22, row: 30, needleMm: 4, technique: 'stockinette' as const },
    palette: [{ name: '바탕색', hex: '#6B1F3A' }],
    sizes: [{ label: 'M', finished: { 가슴둘레: 90 } }],
    pieces: [
      {
        id: 'body',
        name: '몸판',
        construction: 'flat' as const,
        direction: 'bottom_up' as const,
        count: 1,
        castOn: 100,
        sections: [{ name: '몸통', technique: 'stockinette' as const, rows: 60, instruction: '겉뜨기', shaping: [], events: [] }],
      },
    ],
  };
}
