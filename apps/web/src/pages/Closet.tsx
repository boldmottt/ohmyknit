import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Profile, type ProjectSummary } from '../api';
import { Garment } from '../closet/Garment';
import { daysSince, fmtDate, getStoredProfile, Modal, pct, reducedMotion, relDay, setStoredProfile, useToast } from '../ui';
import '../closet/closet.css';

type Phase = 'closed' | 'opening' | 'open';

/** 옷장 홈 (기획서 F1, 2.5 "/") */
export function Closet() {
  const loc = useLocation();
  const returned = (loc.state as { returnedFrom?: string } | null)?.returnedFrom;
  const [profileId, setProfileId] = useState<string | null>(() => getStoredProfile());
  const [phase, setPhase] = useState<Phase>(() => (getStoredProfile() && returned ? 'open' : 'closed'));
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: api.profiles });
  const profile = profiles.data?.find((p) => p.id === profileId);

  useEffect(() => {
    // 저장된 프로필이 지워졌으면 다시 고르게
    if (profiles.data && profileId && !profile) {
      setStoredProfile(null);
      setProfileId(null);
      setPhase('closed');
    }
  }, [profiles.data, profileId, profile]);

  function open(p: Profile) {
    setStoredProfile(p.id);
    setProfileId(p.id);
    if (reducedMotion()) {
      setPhase('open');
      return;
    }
    setPhase('opening');
    setTimeout(() => setPhase('open'), 1600);
  }

  function close() {
    setPhase('closed');
  }

  return (
    <div className={`closet-room phase-${phase}`}>
      <header className="closet-head">
        <h1 className="serif">뜨개옷장</h1>
        {phase !== 'closed' && profile && (
          <button className="nametag small-tag" onClick={close} style={{ ['--tag' as string]: profile.color }}>
            {profile.avatar} {profile.name} <span className="muted">· 문 닫기</span>
          </button>
        )}
        <nav className="closet-nav">
          <Link to="/patterns">📜 도안</Link>
          <Link to="/profile/hands">✋ 내 손</Link>
          <Link to="/settings">⚙</Link>
        </nav>
      </header>

      <div className="closet-stage">
        <YarnShelf side="left" palette={['#7A1F2B', '#E8A6A8', '#D9B45A', '#BFE3DD', '#2B5BD9', '#D9622B']} />
        <div className="wardrobe">
          <div className="crown" aria-hidden="true" />
          <div className="cabinet">
            <div className="inside">
              {phase !== 'closed' && profileId && <Rail profileId={profileId} returned={returned} />}
            </div>
            <div className="door left" aria-hidden={phase === 'open'}>
              <div className="panel-carve" />
              <span className="knob" />
            </div>
            <div className="door right" aria-hidden={phase === 'open'}>
              <div className="panel-carve" />
              <span className="knob" />
            </div>
            {phase === 'closed' && <NameTags profiles={profiles.data ?? []} loading={profiles.isLoading} error={profiles.error} onPick={open} />}
          </div>
          {phase !== 'closed' && profileId && <Drawer profileId={profileId} />}
          <div className="feet" aria-hidden="true" />
        </div>
        <YarnShelf side="right" palette={['#3F7A4A', '#F5EEDC', '#6B4426', '#C9962E', '#8E5BA8', '#1E1612']} />
      </div>
    </div>
  );
}

function YarnShelf({ side, palette }: { side: 'left' | 'right'; palette: string[] }) {
  return (
    <div className={`yarn-shelf ${side}`} aria-hidden="true">
      {[0, 1, 2].map((shelf) => (
        <div key={shelf} className="shelf">
          {palette.slice(shelf * 2, shelf * 2 + 2).map((c, i) => (
            <span key={i} className="yarn" style={{ ['--yarn' as string]: c }} />
          ))}
        </div>
      ))}
    </div>
  );
}

function NameTags({ profiles, loading, error, onPick }: { profiles: Profile[]; loading: boolean; error: unknown; onPick: (p: Profile) => void }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('🧶');
  const create = useMutation({
    mutationFn: () => api.createProfile({ name, avatar, color: profiles.length % 2 ? '#2B5BD9' : '#7A1F2B' }),
    onSuccess: async () => {
      setAdding(false);
      setName('');
      await qc.invalidateQueries({ queryKey: ['profiles'] });
    },
  });
  return (
    <div className="nametags">
      {loading && <p className="tag-hint">불러오는 중…</p>}
      {error ? <p className="tag-hint error">{(error as Error).message}</p> : null}
      {profiles.map((p) => (
        <button key={p.id} className="nametag" style={{ ['--tag' as string]: p.color }} onClick={() => onPick(p)}>
          <span className="tag-hole" />
          <span className="tag-avatar">{p.avatar}</span>
          <span className="tag-name serif">{p.name}</span>
          <span className="tag-count">{p.activeCount}벌 뜨는 중</span>
        </button>
      ))}
      {!loading && !error && profiles.length === 0 && <p className="tag-hint">네임태그를 걸어 옷장을 시작해요</p>}
      {adding ? (
        <form
          className="tag-form card"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <div className="row">
            <select className="input" value={avatar} onChange={(e) => setAvatar(e.target.value)} aria-label="아이콘" style={{ width: 70 }}>
              {['🧶', '🐑', '🌷', '🦊', '🐻', '☕', '🌙'].map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
            <input className="input" autoFocus placeholder="이름" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
          </div>
          {create.error && <p className="error">{(create.error as Error).message}</p>}
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" className="btn small" onClick={() => setAdding(false)}>취소</button>
            <button className="btn small primary" disabled={!name.trim() || create.isPending}>걸기</button>
          </div>
        </form>
      ) : (
        <button className="btn small add-tag" onClick={() => setAdding(true)}>+ 네임태그</button>
      )}
    </div>
  );
}

function Rail({ profileId, returned }: { profileId: string; returned?: string }) {
  const nav = useNavigate();
  const projects = useQuery({ queryKey: ['projects', profileId, 'active'], queryFn: () => api.projects(profileId) });
  const [selected, setSelected] = useState<string | null>(null);
  const [swing, setSwing] = useState<string | null>(returned ?? null);
  useEffect(() => {
    if (!swing) return;
    const t = setTimeout(() => setSwing(null), 1400);
    return () => clearTimeout(t);
  }, [swing]);
  const sel = projects.data?.find((p) => p.id === selected);
  return (
    <>
      <div className="rail" aria-hidden="true" />
      <div className="hangers">
        {projects.isLoading && <p className="muted">옷을 꺼내는 중…</p>}
        {projects.error && <p className="error">{(projects.error as Error).message}</p>}
        {projects.data?.map((p) => (
          <div key={p.id} className="hanger-slot">
            <Garment
              id={p.id}
              palette={p.palette}
              progress={p.progress}
              selected={p.id === selected}
              swing={p.id === swing}
              label={`${p.name}, ${pct(p.progress)} 진행`}
              onClick={() => {
                setSelected(p.id === selected ? null : p.id);
                setSwing(p.id);
              }}
            />
            <div className="garment-tag">
              <b>{p.name}</b>
              <span className="num">{pct(p.progress)}</span>
            </div>
          </div>
        ))}
        <div className="hanger-slot">
          <button className="empty-hanger" onClick={() => nav('/project/new')} aria-label="새 프로젝트 걸기">
            <svg viewBox="-4 -24 208 240" aria-hidden="true">
              <path d="M100 -20 q10 0 10 10 q0 8 -10 12 L100 10 M36 48 L100 10 L164 48" className="hanger" />
            </svg>
            <span>＋ 새 작품</span>
          </button>
        </div>
      </div>
      {sel && <DetailPanel project={sel} onClose={() => setSelected(null)} />}
    </>
  );
}

function DetailPanel({ project: p, onClose }: { project: ProjectSummary; onClose: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const archive = useMutation({
    mutationFn: () => api.archive(p.id),
    onSuccess: async () => {
      onClose();
      toast({
        text: `"${p.name}"을 서랍에 넣었어요`,
        action: {
          label: '되돌리기',
          run: () => void api.restore(p.id).then(() => qc.invalidateQueries({ queryKey: ['projects'] })),
        },
      });
      await qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
  const days = daysSince(p.startedAt);
  return (
    <aside className="detail card" aria-label={`${p.name} 상세`}>
      <button className="btn ghost close" onClick={onClose} aria-label="닫기">✕</button>
      <h2 className="serif">{p.name}</h2>
      <div className="big-pct num">{pct(p.progress)}</div>
      <div className="meter wide"><i style={{ width: pct(p.progress, 1) }} /></div>
      <dl>
        <dt>시작일</dt>
        <dd>
          {fmtDate(p.startedAt)} <span className="muted">({days}일째)</span>
        </dd>
        <dt>최근 작업</dt>
        <dd>{relDay(p.lastWorkedAt)}</dd>
        <dt>도안</dt>
        <dd>
          {p.patternTitle}
          {p.designer ? <span className="muted"> · {p.designer}</span> : null}
        </dd>
        <dt>사이즈 · 게이지</dt>
        <dd className="num">
          {p.sizeLabel} · {p.myGauge.st}코 {p.myGauge.row}단 {p.conversionMode === 'needle' ? '(바늘 교체)' : '(콧수 재계산)'}
        </dd>
        {p.yarn && (
          <>
            <dt>실 · 바늘</dt>
            <dd>
              {p.yarn}
              {p.needleMm ? ` · ${p.needleMm}mm` : ''}
            </dd>
          </>
        )}
        <dt>조각</dt>
        <dd>
          {p.pieces.map((x) => (
            <div key={x.id} className="small num">
              {x.name} {x.currentRow}/{x.totalRows}단 ({pct(x.progress)})
            </div>
          ))}
        </dd>
      </dl>
      <div className="detail-actions">
        <button className="btn primary" onClick={() => nav(`/project/${p.id}/work`)}>🧶 이어하기</button>
        <button className="btn" onClick={() => nav(`/project/${p.id}/edit`)}>✏ 내용 수정하기</button>
        <button className="btn" onClick={() => archive.mutate()} disabled={archive.isPending}>🗄 서랍 보관하기</button>
      </div>
    </aside>
  );
}

function Drawer({ profileId }: { profileId: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'archived' | 'finished'>('archived');
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['projects', profileId, tab], queryFn: () => api.projects(profileId, tab), enabled: open });
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const [confirm, setConfirm] = useState('');
  const restore = useMutation({
    mutationFn: (id: string) => api.restore(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });
  const del = useMutation({
    mutationFn: () => api.deleteProject(deleting!.id, confirm),
    onSuccess: async () => {
      toast({ text: '영구 삭제했어요' });
      setDeleting(null);
      setConfirm('');
      await qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
  const items = useMemo(() => list.data ?? [], [list.data]);
  return (
    <>
      <button className={`drawer${open ? ' open' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="drawer-handle" />
        <span className="drawer-label">서랍</span>
      </button>
      {open && (
        <div className="drawer-sheet card">
          <div className="row">
            <div className="seg" role="group">
              <button aria-pressed={tab === 'archived'} onClick={() => setTab('archived')}>보관함</button>
              <button aria-pressed={tab === 'finished'} onClick={() => setTab('finished')}>완성 옷장</button>
            </div>
            <button className="btn ghost small" onClick={() => setOpen(false)} style={{ marginLeft: 'auto' }}>닫기</button>
          </div>
          {list.isLoading && <p className="muted">여는 중…</p>}
          {!list.isLoading && items.length === 0 && <p className="muted">{tab === 'archived' ? '서랍이 비어 있어요' : '아직 완성한 작품이 없어요. 곧 생길 거예요! ✨'}</p>}
          <ul className="drawer-list">
            {items.map((p) => (
              <li key={p.id}>
                <span className="swatch" style={{ background: p.palette[0]?.hex ?? '#7A1F2B' }} />
                <div style={{ flex: 1 }}>
                  <b>{p.name}</b>
                  <div className="small muted num">
                    {pct(p.progress)} · {tab === 'finished' ? `완성 ${fmtDate(p.finishedAt)}` : `시작 ${fmtDate(p.startedAt)}`}
                  </div>
                </div>
                <button className="btn small" onClick={() => restore.mutate(p.id)}>
                  {tab === 'finished' ? '다시 걸기' : '복원'}
                </button>
                {tab === 'archived' && (
                  <button className="btn small danger" onClick={() => setDeleting(p)}>영구 삭제</button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {deleting && (
        <Modal title="영구 삭제" onClose={() => setDeleting(null)}>
          <p>
            <b>{deleting.name}</b>의 진행 기록, 메모, 실측까지 모두 지워지고 되돌릴 수 없어요.
          </p>
          <label className="field">
            <span>확인을 위해 프로젝트 이름을 똑같이 입력해 주세요</span>
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={deleting.name} />
          </label>
          {del.error && <p className="error">{(del.error as Error).message}</p>}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => setDeleting(null)}>취소</button>
            <button className="btn danger" disabled={confirm !== deleting.name || del.isPending} onClick={() => del.mutate()}>
              영구 삭제
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
