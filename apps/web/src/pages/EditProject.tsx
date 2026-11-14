import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useToast } from '../ui';

/** 프로젝트 편집 (/project/:id/edit) — 정보 수정과 손 프로필 재변환 (F2-6) */
export default function EditProject() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const project = useQuery({ queryKey: ['project', id], queryFn: () => api.project(id) });
  const [f, setF] = useState({ name: '', yarn: '', needleMm: '', note: '', startedAt: '' });
  const [g, setG] = useState({ st: '', row: '', mode: 'recalc' as 'recalc' | 'needle' });

  useEffect(() => {
    const p = project.data;
    if (!p) return;
    setF({
      name: p.name,
      yarn: p.yarn,
      needleMm: p.needleMm ? String(p.needleMm) : '',
      note: p.note,
      startedAt: new Date(p.startedAt).toISOString().slice(0, 10),
    });
    setG({ st: String(p.myGauge.st), row: String(p.myGauge.row), mode: p.conversionMode });
  }, [project.data]);

  const save = useMutation({
    mutationFn: () =>
      api.updateProject(id, {
        name: f.name,
        yarn: f.yarn,
        needleMm: f.needleMm ? Number(f.needleMm) : null,
        note: f.note,
        startedAt: new Date(`${f.startedAt}T12:00:00`).getTime(),
      }),
    onSuccess: async () => {
      toast({ text: '저장했어요' });
      await qc.invalidateQueries();
      nav(-1);
    },
  });
  const reconvert = useMutation({
    mutationFn: () => api.reconvert(id, { st: Number(g.st), row: Number(g.row) }, g.mode),
    onSuccess: async () => {
      toast({ text: '새 게이지로 다시 변환했어요. 뜬 단 수는 그대로예요.' });
      await qc.invalidateQueries();
    },
  });

  if (project.error) return <div className="page error">{(project.error as Error).message}</div>;
  if (!project.data) return <div className="page muted">불러오는 중…</div>;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="page">
      <div className="page-head">
        <h1>내용 수정하기</h1>
        <Link to={`/project/${id}/work`} className="btn">작업 화면</Link>
      </div>
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid2">
          <label className="field"><span>이름</span><input value={f.name} onChange={set('name')} /></label>
          <label className="field"><span>실</span><input value={f.yarn} onChange={set('yarn')} /></label>
          <label className="field"><span>바늘 (mm)</span><input inputMode="decimal" value={f.needleMm} onChange={set('needleMm')} /></label>
          <label className="field"><span>시작일</span><input type="date" value={f.startedAt} onChange={set('startedAt')} /></label>
        </div>
        <label className="field" style={{ marginTop: 10 }}>
          <span>메모</span>
          <textarea value={f.note} onChange={set('note')} />
        </label>
        {save.error && <p className="error">{(save.error as Error).message}</p>}
        <button className="btn primary" style={{ marginTop: 12 }} disabled={save.isPending}>저장</button>
      </form>

      <div className="card" style={{ marginTop: 16 }}>
        <h2 className="serif">게이지 다시 맞추기</h2>
        <p className="small muted">
          손 프로필이 바뀌었거나 중간 실측에서 차이가 났을 때 써요. 원본 도안은 그대로 두고 변환만 다시 해요. 뜬 단 수는 유지돼요.
        </p>
        <div className="grid2">
          <label className="field"><span>코 (10cm)</span><input inputMode="decimal" value={g.st} onChange={(e) => setG({ ...g, st: e.target.value })} /></label>
          <label className="field"><span>단 (10cm)</span><input inputMode="decimal" value={g.row} onChange={(e) => setG({ ...g, row: e.target.value })} /></label>
        </div>
        <div className="seg" role="group" style={{ marginTop: 10 }}>
          <button aria-pressed={g.mode === 'recalc'} onClick={() => setG({ ...g, mode: 'recalc' })}>콧수 재계산</button>
          <button aria-pressed={g.mode === 'needle'} onClick={() => setG({ ...g, mode: 'needle' })}>바늘 교체</button>
        </div>
        {reconvert.error && <p className="error">{(reconvert.error as Error).message}</p>}
        <div>
          <button
            className="btn"
            style={{ marginTop: 12 }}
            disabled={reconvert.isPending || !(Number(g.st) > 0 && Number(g.row) > 0)}
            onClick={() => window.confirm('새 게이지로 단 표를 다시 만들까요?') && reconvert.mutate()}
          >
            다시 변환
          </button>
        </div>
      </div>
    </div>
  );
}
