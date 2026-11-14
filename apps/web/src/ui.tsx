import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

/* ───── 토스트 ───── */

type Toast = { id: number; text: string; action?: { label: string; run: () => void }; ms: number };
const ToastCtx = createContext<(t: Omit<Toast, 'id' | 'ms'> & { ms?: number }) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((t: Omit<Toast, 'id' | 'ms'> & { ms?: number }) => {
    const id = ++seq.current;
    const ms = t.ms ?? 3500;
    setList((l) => [...l.slice(-2), { ...t, id, ms }]);
    setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), ms);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {list.map((t) => (
          <div className="toast" key={t.id}>
            <span>{t.text}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.run();
                  setList((l) => l.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/* ───── 모달 ───── */

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal card" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/* ───── 프로필 선택 (기기마다 기억) ───── */

const KEY = 'kc.profile';
export function getStoredProfile(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export function setStoredProfile(id: string | null) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* 무시 */
  }
}

/* ───── 화면 설정: 스킨, 테마, 동작 줄이기 ───── */

export type Prefs = { skin: 'antique' | 'modern'; theme: 'auto' | 'light' | 'dark'; motion: 'auto' | 'reduce'; sound: boolean; haptics: boolean };
const PREFS_KEY = 'kc.prefs';
const DEFAULT_PREFS: Prefs = { skin: 'antique', theme: 'auto', motion: 'auto', sound: false, haptics: true };

export function readPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function applyPrefs(p: Prefs) {
  const r = document.documentElement;
  r.dataset.skin = p.skin;
  if (p.theme === 'auto') delete r.dataset.theme;
  else r.dataset.theme = p.theme;
  if (p.motion === 'reduce') r.dataset.motion = 'reduce';
  else delete r.dataset.motion;
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* 무시 */
  }
  applyPrefs(p);
}

export function reducedMotion(): boolean {
  return (
    document.documentElement.dataset.motion === 'reduce' ||
    (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  );
}

/* ───── 짧은 피드백: 진동 + "톡" ───── */

let audio: AudioContext | null = null;
export function tick(prefs: Prefs, kind: 'up' | 'down' | 'warn' = 'up') {
  if (prefs.haptics && 'vibrate' in navigator) navigator.vibrate(kind === 'warn' ? [30, 40, 30] : 12);
  if (!prefs.sound) return;
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = kind === 'up' ? 880 : kind === 'down' ? 520 : 330;
    g.gain.setValueAtTime(0.06, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.08);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.09);
  } catch {
    /* 소리 실패는 무시 */
  }
}

/* ───── 날짜 ───── */

export function fmtDate(ms: number | null | undefined): string {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

/** 시작일부터 오늘까지 며칠째인지 (시작일 = 1일째) */
export function daysSince(ms: number, now = Date.now()): number {
  const a = new Date(ms);
  const b = new Date(now);
  const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.floor((db - da) / 86_400_000) + 1;
}

export function relDay(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return '아직 안 떴어요';
  const d = daysSince(ms, now) - 1;
  if (d <= 0) return '오늘';
  if (d === 1) return '어제';
  return `${d}일 전`;
}

export function pct(r: number, digits = 0): string {
  return `${(r * 100).toFixed(digits)}%`;
}
