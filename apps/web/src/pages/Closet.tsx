import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Profile, type ProjectSummary } from '../api';
import { emptyHangerArt, garmentArt } from '../closet/garmentArt';
import { daysSince, fmtDate, getStoredProfile, Modal, pct, reducedMotion, relDay, setStoredProfile, useToast } from '../ui';
import { SiteHeader } from '../SiteHeader';
import '../closet/closet.css';

/** 레일 위 한 칸: 프로젝트 또는 맨 끝의 빈 옷걸이(새 작품) */
type Item = { type: 'project'; project: ProjectSummary } | { type: 'new' };

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * 옷장 홈 (기획서 F1). 작품들이 한 줄 레일에 걸려 뒤로 이어지고,
 * 앞에 온 한 벌의 정보가 오른쪽에 조용히 놓여요.
 * 누르면 앞으로 꺼내 보고, 한 번 더 누르면 이어서 떠요.
 */
export function Closet() {
  const loc = useLocation();
  const returned = (loc.state as { returnedFrom?: string } | null)?.returnedFrom;
  const [profileId, setProfileId] = useState<string | null>(() => getStoredProfile());
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: api.profiles });
  const profile = profiles.data?.find((p) => p.id === profileId);

  useEffect(() => {
    // 저장된 이름표가 지워졌으면 다시 고르게
    if (profiles.data && profileId && !profile) {
      setStoredProfile(null);
      setProfileId(null);
    }
  }, [profiles.data, profileId, profile]);

  const pick = (p: Profile) => {
    setStoredProfile(p.id);
    setProfileId(p.id);
  };
  const leave = () => {
    setStoredProfile(null);
    setProfileId(null);
  };

  return (
    <div className="closet">
      <SiteHeader
        side={
          profile && (
            <button className="linkish" onClick={leave} title="다른 이름표로 바꾸기">
              {profile.avatar} {profile.name}
            </button>
          )
        }
      />
      {profile ? (
        <Rail key={profile.id} profile={profile} returned={returned} />
      ) : (
        <NameTags profiles={profiles.data ?? []} loading={profiles.isLoading} error={profiles.error} onPick={pick} />
      )}
    </div>
  );
}

function NameTags({ profiles, loading, error, onPick }: { profiles: Profile[]; loading: boolean; error: unknown; onPick: (p: Profile) => void }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('🧶');
  const create = useMutation({
    mutationFn: () => api.createProfile({ name, avatar }),
    onSuccess: async () => {
      setAdding(false);
      setName('');
      await qc.invalidateQueries({ queryKey: ['profiles'] });
    },
  });
  return (
    <main className="who">
      <p className="eyebrow">WHOSE CLOSET</p>
      <h1>누구의 옷장인가요?</h1>
      {loading && <p className="quiet">불러오는 중…</p>}
      {error ? <p className="error">{(error as Error).message}</p> : null}
      {!loading && !error && profiles.length === 0 && <p className="quiet">네임태그를 걸어 옷장을 시작해요</p>}
      <ul className="who-list">
        {profiles.map((p, i) => (
          <li key={p.id} style={{ ['--i' as string]: i }}>
            <button className="who-name" onClick={() => onPick(p)}>
              <span className="who-avatar">{p.avatar}</span>
              <span>{p.name}</span>
              <span className="who-count">{pad(p.activeCount)}벌 뜨는 중</span>
            </button>
          </li>
        ))}
      </ul>
      {adding ? (
        <form
          className="who-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <select value={avatar} onChange={(e) => setAvatar(e.target.value)} aria-label="아이콘">
            {['🧶', '🐑', '🌷', '🦊', '🐻', '☕', '🌙'].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
          <input autoFocus placeholder="이름" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="linkish strong" disabled={!name.trim() || create.isPending}>걸기</button>
          <button type="button" className="linkish" onClick={() => setAdding(false)}>취소</button>
          {create.error && <p className="error">{(create.error as Error).message}</p>}
        </form>
      ) : (
        <button className="linkish" onClick={() => setAdding(true)}>+ 네임태그</button>
      )}
    </main>
  );
}

/** 레일에서 k번째 뒤(0 = 맨 앞)의 자리. 단위는 --u (화면 크기에 비례) */
function slot(k: number): React.CSSProperties {
  const gone = k < 0;
  const kk = gone ? -1.2 : k;
  return {
    transform: `translate3d(calc(var(--u) * ${(kk * 7.2).toFixed(2)}), calc(var(--u) * ${(kk * 1.2).toFixed(2)}), calc(var(--u) * ${(kk * -9).toFixed(2)})) rotateY(${k === 0 ? -6 : -26}deg)`,
    opacity: gone ? 0 : Math.max(0, 1 - Math.max(0, k - 5) * 0.34),
    zIndex: 100 - k,
    pointerEvents: gone || k > 7 ? 'none' : undefined,
  };
}

function Rail({ profile, returned }: { profile: Profile; returned?: string }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const projects = useQuery({ queryKey: ['projects', profile.id, 'active'], queryFn: () => api.projects(profile.id) });
  const items: Item[] = useMemo(
    () => [...(projects.data ?? []).map((project) => ({ type: 'project' as const, project })), { type: 'new' as const }],
    [projects.data],
  );
  const [active, setActive] = useState(0);
  const [entered, setEntered] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const prevK = useRef<Map<string, number>>(new Map());
  const n = items.length;

  // 작업 화면에서 돌아오면 그 옷을 앞에
  useEffect(() => {
    if (!projects.data) return;
    const i = returned ? projects.data.findIndex((p) => p.id === returned) : -1;
    if (i >= 0) setActive(i);
    const t = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(t);
  }, [projects.data, returned]);

  useEffect(() => {
    if (active > n - 1) setActive(Math.max(0, n - 1));
  }, [active, n]);

  const go = useCallback((d: number) => setActive((a) => (n ? (a + d + n) % n : 0)), [n]);
  const cur = items[active];
  const follow = useCallback(
    (it: Item | undefined) => {
      if (!it) return;
      nav(it.type === 'new' ? '/project/new' : `/project/${it.project.id}/work`);
    },
    [nav],
  );

  // 키보드 · 휠 · 스와이프
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [role=dialog]')) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') go(1);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  const wheelLock = useRef(0);
  const onWheel = (e: React.WheelEvent) => {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const now = Date.now();
    if (Math.abs(d) < 24 || now - wheelLock.current < 420) return;
    wheelLock.current = now;
    go(d > 0 ? 1 : -1);
  };
  const drag = useRef<{ x: number; moved: boolean } | null>(null);
  const raf = useRef(0);
  const onPointerMove = (e: React.PointerEvent) => {
    if (drag.current && Math.abs(e.clientX - drag.current.x) > 48) {
      go(e.clientX < drag.current.x ? 1 : -1);
      drag.current = { x: e.clientX, moved: true };
    }
    // 포인터를 따라 레일이 아주 조금 돌아가는 깊이감
    if (e.pointerType !== 'mouse' || reducedMotion()) return;
    const { clientX, clientY } = e;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const el = stage.current;
      if (!el) return;
      el.style.setProperty('--mx', ((clientX / window.innerWidth) * 2 - 1).toFixed(3));
      el.style.setProperty('--my', ((clientY / window.innerHeight) * 2 - 1).toFixed(3));
    });
  };

  const archive = useMutation({
    mutationFn: (p: ProjectSummary) => api.archive(p.id),
    onSuccess: async (_r, p) => {
      toast({
        text: `"${p.name}"을 서랍에 넣었어요`,
        action: { label: '되돌리기', run: () => void api.restore(p.id).then(() => qc.invalidateQueries({ queryKey: ['projects'] })) },
      });
      await qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const tint = cur?.type === 'project' ? (cur.project.palette[0]?.hex ?? '#C9B7C4') : '#C9B7C4';
  const count = projects.data?.length ?? 0;

  return (
    <main className="rail-view" style={{ ['--tint' as string]: tint }} onWheel={onWheel}>
      <div className="rail-index" aria-hidden="true">
        <span className="num">{pad(Math.min(active + 1, n))}</span>
        <i><b style={{ height: `${((active + 1) / n) * 100}%` }} /></i>
        <span className="num">{pad(n)}</span>
      </div>

      <div
        ref={stage}
        className={`rail-stage${entered ? ' entered' : ''}`}
        onPointerDown={(e) => (drag.current = { x: e.clientX, moved: false })}
        onPointerMove={onPointerMove}
        onPointerUp={() => setTimeout(() => (drag.current = null), 0)}
        onPointerCancel={() => (drag.current = null)}
      >
        <div className="rail-space">
          <div className="rail-bar" aria-hidden="true" />
          {projects.isLoading && <p className="quiet rail-msg">옷을 꺼내는 중…</p>}
          {projects.error && <p className="error rail-msg">{(projects.error as Error).message}</p>}
          {items.map((it, i) => {
            const id = it.type === 'new' ? 'new' : it.project.id;
            // 맨 앞보다 하나 앞(-1)은 화면 밖으로 빠진 옷. 나머지는 뒤로 줄지어 섬
            let k = (i - active + n) % n;
            if (n > 2 && k === n - 1) k = -1;
            const before = prevK.current.get(id);
            const jump = before !== undefined && Math.abs(before - k) > 1.5;
            prevK.current.set(id, k);
            const src = it.type === 'new' ? emptyHangerArt() : garmentArt(it.project);
            const label = it.type === 'new' ? '새 프로젝트 걸기' : `${it.project.name}, ${pct(it.project.progress)} 진행`;
            return (
              <button
                key={id}
                className={`hang${k === 0 ? ' front' : ''}${jump ? ' jump' : ''}${it.type === 'new' ? ' empty' : ''}`}
                style={{ ...slot(entered ? k : k + 7), transitionDelay: entered ? `${Math.max(0, k) * 45}ms` : undefined }}
                aria-label={label}
                aria-current={k === 0}
                tabIndex={k < 0 ? -1 : 0}
                onClick={() => {
                  if (drag.current?.moved) return;
                  if (k === 0) follow(it);
                  else setActive(i);
                }}
              >
                <span className="hang-sway" style={{ animationDelay: `${-(i * 1.3) % 7}s` }}>
                  <img className="garment-art" src={src} alt="" draggable={false} />
                  {it.type === 'new' && <span className="hang-plus">＋</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {cur && (
        <aside className="detail" key={cur.type === 'new' ? 'new' : cur.project.id} aria-live="polite">
          <p className="eyebrow num">
            {pad(active + 1)} / {pad(n)}
          </p>
          {cur.type === 'project' ? <ProjectDetail p={cur.project} onArchive={() => archive.mutate(cur.project)} /> : <NewDetail count={count} />}
        </aside>
      )}

      <div className="rail-pager">
        <button onClick={() => go(-1)} aria-label="이전 옷">←</button>
        <span className="num">
          {pad(Math.min(active + 1, n))} / {pad(n)}
        </span>
        <button onClick={() => go(1)} aria-label="다음 옷">→</button>
      </div>

      <footer className="rail-foot">
        <span>
          {profile.name}의 옷장 <i>|</i> <span className="num">{pad(count)}</span>벌
        </span>
        <span className="hint">눌러서 꺼내 보기 <i>↔</i> 한 번 더 눌러 이어 뜨기</span>
        <Drawer profileId={profile.id} />
      </footer>
    </main>
  );
}

function ProjectDetail({ p, onArchive }: { p: ProjectSummary; onArchive: () => void }) {
  return (
    <>
      <h1>{p.name}</h1>
      <hr />
      <p className="lede">
        {p.patternTitle !== p.name ? `${p.patternTitle}. ` : ''}
        {p.progress >= 1 ? '다 떴어요.' : p.progress > 0 ? `${pct(p.progress)}까지 떴어요.` : '아직 코를 잡기 전이에요.'}
      </p>
      <div className="thin-meter" role="img" aria-label={`진척도 ${pct(p.progress)}`}>
        <i style={{ width: pct(p.progress, 1) }} />
      </div>
      <dl>
        <dt>사이즈</dt>
        <dd className="num">
          {p.sizeLabel} · {p.myGauge.st}코 {p.myGauge.row}단{p.conversionMode === 'needle' ? ' (바늘 교체)' : ''}
        </dd>
        {p.yarn && (
          <>
            <dt>실</dt>
            <dd>
              {p.yarn}
              {p.needleMm ? ` · ${p.needleMm}mm` : ''}
            </dd>
          </>
        )}
        <dt>시작</dt>
        <dd className="num">
          {fmtDate(p.startedAt)} · {daysSince(p.startedAt)}일째
        </dd>
        <dt>최근</dt>
        <dd>{relDay(p.lastWorkedAt)}</dd>
        <dt>조각</dt>
        <dd className="num">{p.pieces.map((x) => `${x.name} ${x.currentRow}/${x.totalRows}`).join(' · ')}</dd>
      </dl>
      <div className="detail-actions">
        <Link className="cta" to={`/project/${p.id}/work`}>
          이어하기 <span aria-hidden="true">↗</span>
        </Link>
        <span className="sub-actions">
          <Link className="linkish" to={`/project/${p.id}/edit`}>내용 수정하기</Link>
          <button className="linkish" onClick={onArchive}>서랍 보관하기</button>
        </span>
      </div>
    </>
  );
}

function NewDetail({ count }: { count: number }) {
  return (
    <>
      <h1>새 작품</h1>
      <hr />
      <p className="lede">{count === 0 ? '빈 옷걸이가 기다리고 있어요. 첫 작품을 걸어 볼까요?' : '빈 옷걸이에 다음 작품을 걸어요.'}</p>
      <dl>
        <dt>도안</dt>
        <dd>보관함 · PDF · 직접 입력</dd>
        <dt>맞춤</dt>
        <dd>내 손 게이지로 콧수 변환</dd>
      </dl>
      <div className="detail-actions">
        <Link className="cta" to="/project/new">
          새 작품 걸기 <span aria-hidden="true">↗</span>
        </Link>
        <Link className="linkish" to="/studio">디자인 스튜디오에서 그리기</Link>
      </div>
    </>
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
  const items = list.data ?? [];
  return (
    <>
      <button className="linkish" onClick={() => setOpen(!open)} aria-expanded={open}>
        서랍 {open ? '닫기' : '열기'}
      </button>
      {open && (
        <div className="drawer-sheet" role="dialog" aria-label="서랍">
          <div className="drawer-tabs">
            <button aria-pressed={tab === 'archived'} onClick={() => setTab('archived')}>보관함</button>
            <button aria-pressed={tab === 'finished'} onClick={() => setTab('finished')}>완성 옷장</button>
            <button className="linkish" onClick={() => setOpen(false)}>닫기</button>
          </div>
          {list.isLoading && <p className="quiet">여는 중…</p>}
          {!list.isLoading && items.length === 0 && (
            <p className="quiet">{tab === 'archived' ? '서랍이 비어 있어요' : '아직 완성한 작품이 없어요. 곧 생길 거예요.'}</p>
          )}
          <ul className="drawer-list">
            {items.map((p) => (
              <li key={p.id}>
                <img src={garmentArt(p)} alt="" />
                <div>
                  <b>{p.name}</b>
                  <span className="num">
                    {pct(p.progress)} · {tab === 'finished' ? `완성 ${fmtDate(p.finishedAt)}` : `시작 ${fmtDate(p.startedAt)}`}
                  </span>
                </div>
                <button className="linkish" onClick={() => restore.mutate(p.id)}>{tab === 'finished' ? '다시 걸기' : '복원'}</button>
                {tab === 'archived' && (
                  <button className="linkish danger" onClick={() => setDeleting(p)}>영구 삭제</button>
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
