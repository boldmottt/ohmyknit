import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EMPTY_SNAPSHOT } from '@knitcloset/gauge-engine';
import { api } from '../api';
import {
  convertedPiece,
  currentRowView,
  expectedLengthCm,
  expectedWidthCm,
  formatDuration,
  formatHours,
  overall,
  pieceStitchProgress,
  remainingMinutes,
  yarnForecast,
} from '../derive';
import { cacheWork, cachedWork, flushAll } from '../offline';
import { pct, readPrefs, reducedMotion, savePrefs, tick, useToast } from '../ui';
import { liveActiveMs, useWork } from '../workStore';
import { Compare } from '../work/Compare';
import { CheckinDialog, FinishDialog, FrogDialog, LockDialog, NoteDialog, ShortcutsDialog, YarnDialog } from '../work/Dialogs';
import { Dock } from '../work/Dock';
import { FocusMode } from '../work/FocusMode';
import { KnitCanvas } from '../work/KnitCanvas';
import { PatternPanel } from '../work/PatternPanel';
import '../work/work.css';

type Dialog = null | 'checkin' | 'note' | 'frog' | 'yarn' | 'lock' | 'finish' | 'shortcuts' | 'pieceDone';

export default function Work() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [loadErr, setLoadErr] = useState('');
  const [fromCache, setFromCache] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [menu, setMenu] = useState(false);
  const [stitchTracking, setStitchTracking] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [leaving, setLeaving] = useState(false);
  const prefs = useRef(readPrefs());
  const startOverall = useRef<number | null>(null);

  const w = useWork();
  const { data, snapshots, activePieceId, ui, session, sync, pending } = w;

  const reload = useCallback(async () => {
    try {
      const d = await api.work(id);
      await cacheWork(d);
      await useWork.getState().load(d);
      setFromCache(false);
      setLoadErr('');
    } catch (e) {
      const cached = await cachedWork(id);
      if (cached) {
        await useWork.getState().load(cached);
        setFromCache(true);
      } else {
        setLoadErr((e as Error).message);
      }
    }
  }, [id]);

  useEffect(() => {
    useWork.getState().reset();
    void flushAll().catch(() => {}).finally(() => void reload());
    return () => {
      void useWork.getState().flush();
    };
  }, [reload]);

  useEffect(() => {
    if (data && startOverall.current === null) startOverall.current = overall(data, snapshots).ratio;
  }, [data, snapshots]);

  // 다른 기기에서 뜬 기록을 합쳤을 때 알림
  const merged = w.merged;
  useEffect(() => {
    if (!merged || !data) return;
    const name = data.pieces.find((p) => p.id === merged.pieceId)?.name ?? '';
    toast({ text: `다른 기기의 기록을 합쳤어요: ${name} ${merged.from}단 → ${merged.to}단`, ms: 5000 });
    useWork.getState().clearMerged();
  }, [merged, data, toast]);

  // 타이머 표시용
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const conv = data ? convertedPiece(data, activePieceId) : undefined;
  const pieceState = data?.pieces.find((p) => p.id === activePieceId);
  const snap = snapshots[activePieceId] ?? EMPTY_SNAPSHOT;
  const view = conv ? currentRowView(conv, snap) : null;
  const palette = data?.converted.palette.length ? data.converted.palette : [{ name: '바탕색', hex: '#6B1F3A' }];
  const notes = useMemo(() => data?.notes.filter((n) => n.pieceId === activePieceId) ?? [], [data, activePieceId]);

  const inc = useCallback(() => {
    const st = useWork.getState();
    const r = st.increment();
    if (r === 'locked') {
      tick(prefs.current, 'warn');
      setDialog('lock');
      return;
    }
    tick(prefs.current, 'up');
    if (r === 'end') setDialog('pieceDone');
    setStitchTracking(false);
  }, []);

  const dec = useCallback(() => {
    useWork.getState().decrement();
    tick(prefs.current, 'down');
  }, []);

  const jump = useCallback(
    (target: number) => {
      const st = useWork.getState();
      const cur = st.snapshots[st.activePieceId]?.currentRow ?? 0;
      if (target === cur) return;
      const apply = () => {
        st.jumpTo(target);
        toast({ text: `${cur}단 → ${target}단으로 이동했어요`, action: { label: '되돌리기', run: () => useWork.getState().undo() } });
      };
      if (Math.abs(target - cur) <= 5) apply();
      else if (window.confirm(`${cur}단 → ${target}단으로 이동할까요?`)) apply();
    },
    [toast],
  );

  const exit = useCallback(async () => {
    const st = useWork.getState();
    if (!st.data) return nav('/');
    setLeaving(true);
    await st.flush();
    const rows = st.data.pieces.reduce((s, p) => s + Math.max(0, (st.snapshots[p.id]?.currentRow ?? 0) - (st.session.startRows[p.id] ?? 0)), 0);
    const delta = overall(st.data, st.snapshots).ratio - (startOverall.current ?? 0);
    const mins = Math.round(liveActiveMs(st.session) / 60_000);
    if (rows > 0 || mins > 0) {
      toast({ text: `오늘 ${rows}단 · ${mins}분 · +${(delta * 100).toFixed(1)}% 🧶`, ms: 5000 });
    }
    setTimeout(() => nav('/', { state: { returnedFrom: st.data!.project.id } }), reducedMotion() ? 0 : 350);
  }, [nav, toast]);

  // 키보드 · 페이지 터너 (기획서 5.6)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]') || dialog) return;
      const st = useWork.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (st.undo()) toast({ text: '되돌렸어요' });
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case ' ':
        case 'ArrowUp':
        case 'PageDown':
        case 'ArrowRight':
          e.preventDefault();
          inc();
          break;
        case 'Backspace':
        case 'ArrowDown':
        case 'PageUp':
        case 'ArrowLeft':
          e.preventDefault();
          dec();
          break;
        case 'f':
        case 'F':
          st.setUi({ focus: !st.ui.focus });
          break;
        case 'c':
        case 'C':
          st.setUi({ compare: !st.ui.compare });
          break;
        case 'n':
        case 'N':
          setDialog('note');
          break;
        case 'm':
        case 'M':
          setDialog('checkin');
          break;
        case 'Escape':
          if (st.ui.focus) st.setUi({ focus: false });
          break;
        default:
          if (/^[1-9]$/.test(e.key) && st.data) {
            const p = st.data.pieces[Number(e.key) - 1];
            if (p) st.setActivePiece(p.id);
          }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inc, dec, dialog, toast]);

  if (loadErr) {
    return (
      <div className="page">
        <p className="error">{loadErr}</p>
        <Link to="/">옷장으로</Link>
      </div>
    );
  }
  if (!data || !conv || !view || !pieceState) {
    return <div className="work-loading">옷을 꺼내는 중… 🧥</div>;
  }

  const pProg = pieceStitchProgress(conv, snap);
  const all = overall(data, snapshots);
  const remainMin = remainingMinutes(data, all.total - all.done);
  const yarn = yarnForecast(data, all.done, all.total);
  const activeMs = liveActiveMs(session, now);
  const syncLabel =
    sync === 'syncing' ? '⟳ 동기화 중' : sync === 'offline' || fromCache ? `⚡ 오프라인${pending ? ` (${pending}개 대기)` : ''}` : sync === 'error' ? '⚠ 저장 오류' : '☁ 저장됨';

  if (ui.focus) {
    return (
      <FocusMode
        piece={conv}
        view={view}
        palette={palette}
        progress={pProg.ratio}
        activeMs={activeMs}
        onInc={inc}
        onDec={dec}
        onExit={() => w.setUi({ focus: false })}
      />
    );
  }

  const lockTexts = view.row?.events.filter((e) => e.lock).map((e) => e.text) ?? [];
  const nextPiece = data.pieces.find((p) => p.id !== activePieceId && (snapshots[p.id]?.currentRow ?? 0) < p.totalRows);

  return (
    <div className={`work${leaving ? ' leaving' : ''}`}>
      <header className="work-top">
        <button className="btn ghost" onClick={exit}>← 옷장으로</button>
        <h1 className="serif" title={data.project.patternTitle}>{data.project.name}</h1>
        <nav className="piece-tabs" aria-label="조각">
          {data.pieces.map((p, i) => {
            const c = convertedPiece(data, p.id)!;
            const r = pieceStitchProgress(c, snapshots[p.id] ?? EMPTY_SNAPSHOT).ratio;
            return (
              <button key={p.id} aria-pressed={p.id === activePieceId} onClick={() => w.setActivePiece(p.id)} title={`${i + 1}번 키`}>
                <svg width="18" height="18" viewBox="0 0 36 36" aria-hidden="true">
                  <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="5" />
                  <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="5" strokeDasharray={`${r * 94.2} 94.2`} transform="rotate(-90 18 18)" />
                </svg>
                {p.name}
              </button>
            );
          })}
        </nav>
        <button className="btn ghost num timer" onClick={() => w.togglePause()} aria-label={session.paused ? '타이머 시작' : '타이머 일시정지'}>
          ⏱ {formatDuration(activeMs)} {session.paused ? '▶' : '⏸'}
        </button>
        <span className={`sync ${sync}`} title={fromCache ? '저장된 데이터로 열었어요' : ''}>{syncLabel}</span>
        <div className="menu-wrap">
          <button className="btn ghost" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>⋯</button>
          {menu && (
            <div className="menu card" role="menu" onClick={() => setMenu(false)}>
              <button role="menuitem" onClick={() => w.setUi({ focus: true })}>🎯 집중 모드 (F)</button>
              <button
                role="menuitem"
                onClick={() => {
                  const p = { ...prefs.current, theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' } as const;
                  prefs.current = p;
                  savePrefs(p);
                }}
              >
                🌙 다크 모드 전환
              </button>
              <button role="menuitem" onClick={() => w.setUi({ symbols: !ui.symbols })}>
                {ui.symbols ? '✓ ' : ''}색약 모드 (기호 표시)
              </button>
              <button role="menuitem" onClick={() => setDialog('shortcuts')}>⌨ 단축키 안내</button>
              <button role="menuitem" onClick={() => nav(`/project/${data.project.id}/edit`)}>✏ 내용 수정하기</button>
              <button role="menuitem" onClick={() => setDialog('finish')}>🎉 완성 처리</button>
            </div>
          )}
        </div>
      </header>

      <main className="work-main">
        <PatternPanel
          data={data}
          piece={conv}
          view={view}
          palette={palette}
          symbols={ui.symbols}
          hoverRow={ui.hoverRow}
          onHoverRow={(r) => w.setUi({ hoverRow: r })}
          onPickRow={jump}
          notes={notes}
          onPiece={(key) => w.setActivePiece(`${data.project.id}:${key}`)}
        />
        <section className="sim panel" aria-label="시뮬레이션">
          <div className="sim-head">
            <div className="seg" role="group" aria-label="보기">
              <button aria-pressed={!ui.compare} onClick={() => w.setUi({ compare: false })}>{conv.name}</button>
              <button aria-pressed={ui.compare} onClick={() => w.setUi({ compare: true })}>◐ 완성본과 비교</button>
            </div>
          </div>
          {ui.compare ? (
            <Compare data={data} snapshots={snapshots} activePieceId={activePieceId} onPick={(pid) => w.setActivePiece(pid)} />
          ) : (
            <KnitCanvas
              piece={conv}
              palette={palette}
              completedRows={snap.currentRow}
              currentStitch={snap.currentStitch}
              hoverRow={ui.hoverRow}
              onHoverRow={(r) => w.setUi({ hoverRow: r })}
              onScrub={jump}
              symbols={ui.symbols}
              notes={notes}
            />
          )}
        </section>
        <Dock
          notes={notes}
          onDeleteNote={async (nid) => {
            await api.deleteNote(nid);
            void reload();
          }}
          piece={conv}
          view={view}
          projectId={data.project.id}
          onInc={inc}
          onDec={dec}
          stitchTracking={stitchTracking}
          currentStitch={snap.currentStitch}
          onStitchStep={(d) => w.setStitch(Math.max(0, Math.min(view.row?.stitchesWorked ?? 0, snap.currentStitch + d)))}
          onTool={(t) => (t === 'stitch' ? setStitchTracking(!stitchTracking) : setDialog(t))}
        />
      </main>

      <footer className="status-bar">
        <div className="bar" aria-label={`${conv.name} ${pct(pProg.ratio)}`}>
          <span>{conv.name}</span>
          <div className="meter"><i style={{ width: pct(pProg.ratio, 1) }} /></div>
          <b className="num">{pct(pProg.ratio)}</b>
        </div>
        <span className="num">전체 {pct(all.ratio)}</span>
        <span className="num">{remainMin !== null ? `남은 예상 ${formatHours(remainMin)}` : '속도 기록 중…'}</span>
        <span className="num">
          {yarn ? (yarn.balls !== null ? `실 ≈ ${yarn.balls.toFixed(1)}볼 더 필요` : `실 ≈ ${Math.round(yarn.remainingGrams)}g 더 필요`) : '⚖ 실 무게를 재면 사용량을 예측해요'}
        </span>
        {snap.frogCount > 0 && <span className="muted small num">풀기 {snap.frogCount}회 · {snap.frogRows}단</span>}
      </footer>

      {dialog === 'checkin' && (
        <CheckinDialog
          pieceId={activePieceId}
          atRow={snap.currentRow}
          expectedLength={expectedLengthCm(data, snap.currentRow)}
          expectedWidth={expectedWidthCm(data, view.row?.stitchesWorked ?? conv.rows.at(-1)!.stitchCount)}
          round={conv.construction === 'round'}
          onClose={() => setDialog(null)}
          onDone={(msg) => {
            setDialog(null);
            toast({ text: msg, ms: 6000 });
            void reload();
          }}
        />
      )}
      {dialog === 'note' && (
        <NoteDialog
          pieceId={activePieceId}
          row={Math.min(snap.currentRow + 1, conv.totalRows)}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            toast({ text: '메모를 붙였어요 📌' });
            void reload();
          }}
        />
      )}
      {dialog === 'frog' && (
        <FrogDialog
          current={snap.currentRow}
          onClose={() => setDialog(null)}
          onDone={(rows, reason) => {
            w.frog(rows, reason);
            setDialog(null);
            toast({ text: `${rows}단 풀었어요. 괜찮아요, 다시 뜨면 돼요 💪` });
          }}
        />
      )}
      {dialog === 'yarn' && (
        <YarnDialog
          projectId={data.project.id}
          ballGrams={data.project.ballGrams}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            void reload();
          }}
        />
      )}
      {dialog === 'lock' && view.row && (
        <LockDialog
          text={lockTexts}
          onClose={() => setDialog(null)}
          onConfirm={() => {
            w.acknowledge(activePieceId, view.row!.row);
            setDialog(null);
            inc();
          }}
        />
      )}
      {dialog === 'pieceDone' && (
        <div className="modal-back" onClick={() => setDialog(null)}>
          <div className="modal card celebrate" onClick={(e) => e.stopPropagation()}>
            <div className="knot" aria-hidden="true">🪢</div>
            <h2>{conv.name} 완성!</h2>
            <p>정말 수고 많았어요 ✨</p>
            <div className="row">
              {nextPiece ? (
                <button
                  className="btn primary"
                  onClick={() => {
                    w.setActivePiece(nextPiece.id);
                    setDialog(null);
                  }}
                >
                  다음: {nextPiece.name} 뜨기
                </button>
              ) : (
                <button className="btn primary" onClick={() => setDialog('finish')}>완성 실측 입력하기</button>
              )}
              <button className="btn" onClick={() => setDialog(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}
      {dialog === 'finish' && (
        <FinishDialog
          projectId={data.project.id}
          finishedKeys={Object.keys(data.finished ?? {})}
          onClose={() => setDialog(null)}
          onDone={(msg) => {
            setDialog(null);
            toast({ text: msg, ms: 6000 });
            nav('/');
          }}
        />
      )}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
