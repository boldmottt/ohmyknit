import { useEffect, useRef, useState } from 'react';
import type { ConvertedPiece } from '@knitcloset/gauge-engine';
import type { Palette } from '@knitcloset/knit-render';
import { colorRun, formatDuration, readsFromLeft, upcoming, type RowView } from '../derive';
import { pct } from '../ui';

type Props = {
  piece: ConvertedPiece;
  view: RowView;
  palette: Palette;
  progress: number;
  activeMs: number;
  onInc: () => void;
  onDec: () => void;
  onExit: () => void;
  minGapMs?: number;
};

type WakeLockLike = { release: () => Promise<void> };

/**
 * 집중 모드 (기획서 5.5): 아무 곳이나 탭 = +1, 길게 누르면 −1.
 * 실수 방지를 위해 탭 사이 최소 간격, 화면 꺼짐 방지(Wake Lock).
 */
export function FocusMode({ piece, view, palette, progress, activeMs, onInc, onDec, onExit, minGapMs = 1500 }: Props) {
  const lastTap = useRef(0);
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const held = useRef(false);
  const [wake, setWake] = useState<'on' | 'unsupported' | 'off'>('off');
  const [flash, setFlash] = useState<'' | 'inc' | 'dec' | 'wait'>('');

  useEffect(() => {
    let lock: WakeLockLike | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockLike> } };
    async function acquire() {
      if (!nav.wakeLock) {
        setWake('unsupported');
        return;
      }
      try {
        lock = await nav.wakeLock.request('screen');
        setWake('on');
      } catch {
        setWake('unsupported');
      }
    }
    void acquire();
    const vis = () => document.visibilityState === 'visible' && void acquire();
    document.addEventListener('visibilitychange', vis);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      void lock?.release().catch(() => {});
    };
  }, []);

  const pulse = (k: typeof flash) => {
    setFlash(k);
    setTimeout(() => setFlash(''), 350);
  };

  const r = view.row;
  const sec = view.section;
  const chartLine = sec?.chart && r?.chartRow !== undefined ? sec.chart.grid[r.chartRow] : undefined;
  const next = upcoming(piece, view.completedRows, 12)[0];

  return (
    <div
      className={`focus-mode ${flash}`}
      role="application"
      aria-label="집중 모드. 화면을 탭하면 한 단 완료, 길게 누르면 한 단 되돌리기"
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        held.current = false;
        hold.current = setTimeout(() => {
          held.current = true;
          onDec();
          pulse('dec');
          if ('vibrate' in navigator) navigator.vibrate([20, 30, 20]);
        }, 650);
      }}
      onPointerUp={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        clearTimeout(hold.current);
        if (held.current) return;
        const now = Date.now();
        if (now - lastTap.current < minGapMs) {
          pulse('wait');
          return;
        }
        lastTap.current = now;
        onInc();
        pulse('inc');
      }}
      onPointerCancel={() => clearTimeout(hold.current)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="focus-top">
        <span>
          {piece.name} · {pct(progress)}
        </span>
        <span className="num">⏱ {formatDuration(activeMs)}</span>
        <button className="btn small" onClick={onExit}>
          나가기 (F)
        </button>
      </div>
      <div className="focus-glow" aria-hidden="true" />
      <div className="focus-num num" key={view.completedRows}>{view.done ? '완성!' : Math.min(view.completedRows + 1, piece.totalRows)}</div>
      <div className="focus-tot num">/ {piece.totalRows} 단</div>
      {r && (
        <div className="focus-card">
          <div className="num">
            {r.stitchesWorked}코{sec?.instruction ? ` · ${sec.instruction}` : ''}
            {chartLine ? ` · ${readsFromLeft(piece, r.row) ? '(왼쪽부터) ' : ''}${colorRun(chartLine, palette, readsFromLeft(piece, r.row))} 반복` : ''}
          </div>
          {chartLine && (
            <div className="focus-chart">
              {chartLine.filter((c) => c !== -1).map((c, i) => (
                <span key={i} style={{ background: palette[c]?.hex }} />
              ))}
            </div>
          )}
          {r.events.map((e, i) => (
            <div key={i} className="event">
              {e.lock ? '🔒' : '⚠'} 이번 단: {e.text}
            </div>
          ))}
        </div>
      )}
      {next && next.rowsAway > 1 && (
        <div className="focus-next">
          {next.icon} {next.rowsAway - 1}단 뒤 {next.text}
        </div>
      )}
      <div className="focus-hint">
        화면 아무 곳이나 탭 = +1 · 길게 누르면 −1
        {wake === 'unsupported' && <div className="small">이 브라우저는 화면 꺼짐 방지를 지원하지 않아요. 기기 설정에서 자동 잠금을 늘려 주세요.</div>}
      </div>
    </div>
  );
}
