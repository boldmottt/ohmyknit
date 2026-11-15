import { useState } from 'react';
import { api } from '../api';
import { Modal } from '../ui';

export function CheckinDialog(p: {
  pieceId: string;
  atRow: number;
  expectedLength: number;
  expectedWidth: number;
  round: boolean;
  onClose: () => void;
  onDone: (msg: string, warn: boolean, measuredCm: number, dimension: 'length' | 'width') => void;
}) {
  const [dim, setDim] = useState<'length' | 'width'>('length');
  const [cm, setCm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const expected = dim === 'length' ? p.expectedLength : p.expectedWidth;
  return (
    <Modal title="📏 중간 실측" onClose={p.onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const v = Number(cm);
          if (!(v > 0)) return setErr('숫자를 입력해 주세요');
          setBusy(true);
          try {
            const r = await api.checkin(p.pieceId, { atRow: p.atRow, measuredCm: v, expectedCm: expected, dimension: dim });
            p.onDone(r.message, r.warn, v, dim);
          } catch (x) {
            setErr((x as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="seg" role="group" aria-label="잴 곳">
          <button type="button" aria-pressed={dim === 'length'} onClick={() => setDim('length')}>길이</button>
          <button type="button" aria-pressed={dim === 'width'} onClick={() => setDim('width')}>{p.round ? '둘레' : '너비'}</button>
        </div>
        <p className="muted small">
          블로킹 전, 평평하게 놓고 재 주세요. 지금 {p.atRow}단 기준 예상 {dim === 'length' ? '길이' : p.round ? '둘레' : '너비'}는{' '}
          <b className="num">{expected}cm</b>예요.
        </p>
        <label className="field">
          <span>잰 값 (cm)</span>
          <input inputMode="decimal" autoFocus value={cm} onChange={(e) => setCm(e.target.value)} />
        </label>
        {err && <p className="error">{err}</p>}
        <div className="row" style={{ marginTop: 12 }}>
          <button type="button" className="btn" onClick={p.onClose}>취소</button>
          <button className="btn primary" disabled={busy}>비교하기</button>
        </div>
      </form>
    </Modal>
  );
}

export function NoteDialog(p: { pieceId: string; row: number; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <Modal title={`📝 ${p.row}단 메모`} onClose={p.onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const photoKey = file ? (await api.upload(file)).key : undefined;
            await api.addNote(p.pieceId, { row: p.row, text, ...(photoKey ? { photoKey } : {}) });
            p.onDone();
          } catch (x) {
            setErr((x as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span>메모</span>
          <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="예: 여기서 실 새 볼로 바꿈" />
        </label>
        <label className="field" style={{ marginTop: 8 }}>
          <span>사진 (선택)</span>
          <input type="file" accept="image/*" capture="environment" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        {err && <p className="error">{err}</p>}
        <div className="row" style={{ marginTop: 12 }}>
          <button type="button" className="btn" onClick={p.onClose}>취소</button>
          <button className="btn primary" disabled={busy || (!text.trim() && !file)}>저장</button>
        </div>
      </form>
    </Modal>
  );
}

const REASONS = ['실수', '게이지', '마음에 안 듦'];

export function FrogDialog(p: { current: number; onClose: () => void; onDone: (rows: number, reason: string) => void }) {
  const [rows, setRows] = useState('1');
  const [reason, setReason] = useState(REASONS[0]!);
  const n = Math.max(0, Math.min(p.current, Math.round(Number(rows) || 0)));
  return (
    <Modal title="↺ 풀기 기록" onClose={p.onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (n > 0) p.onDone(n, reason);
        }}
      >
        <label className="field">
          <span>몇 단 풀었나요?</span>
          <input inputMode="numeric" autoFocus value={rows} onChange={(e) => setRows(e.target.value)} />
        </label>
        <div className="row" style={{ marginTop: 10 }} role="group" aria-label="사유">
          {REASONS.map((r) => (
            <button type="button" key={r} className={`btn small${reason === r ? ' primary' : ''}`} onClick={() => setReason(r)}>
              {r}
            </button>
          ))}
        </div>
        <p className="muted small">
          {p.current}단 → <b className="num">{p.current - n}단</b>으로 돌아가요. 일반 −1과 따로 통계에 남아요.
        </p>
        <div className="row">
          <button type="button" className="btn" onClick={p.onClose}>취소</button>
          <button className="btn primary" disabled={n <= 0}>풀었어요</button>
        </div>
      </form>
    </Modal>
  );
}

export function YarnDialog(p: { projectId: string; ballGrams: number | null; onClose: () => void; onDone: () => void }) {
  const [grams, setGrams] = useState('');
  const [ball, setBall] = useState(p.ballGrams ? String(p.ballGrams) : '');
  const [err, setErr] = useState('');
  return (
    <Modal title="⚖ 지금까지 쓴 실 무게" onClose={p.onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            if (ball && Number(ball) > 0 && Number(ball) !== p.ballGrams) await api.updateProject(p.projectId, { ballGrams: Number(ball) });
            await api.logYarn(p.projectId, Number(grams));
            p.onDone();
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
      >
        <p className="muted small">뜬 부분(작품)을 저울에 올려 잰 무게를 넣으면, 남은 코 수로 필요한 실을 예측해요.</p>
        <div className="grid2">
          <label className="field">
            <span>뜬 부분 무게 (g)</span>
            <input inputMode="decimal" autoFocus value={grams} onChange={(e) => setGrams(e.target.value)} />
          </label>
          <label className="field">
            <span>한 볼 무게 (g)</span>
            <input inputMode="decimal" value={ball} onChange={(e) => setBall(e.target.value)} placeholder="50" />
          </label>
        </div>
        {err && <p className="error">{err}</p>}
        <div className="row" style={{ marginTop: 12 }}>
          <button type="button" className="btn" onClick={p.onClose}>취소</button>
          <button className="btn primary" disabled={!(Number(grams) > 0)}>저장</button>
        </div>
      </form>
    </Modal>
  );
}

export function LockDialog(p: { text: string[]; onClose: () => void; onConfirm: () => void }) {
  return (
    <Modal title="🔒 잠깐! 이 단에서 할 일" onClose={p.onClose}>
      <ul>
        {p.text.map((t, i) => (
          <li key={i}><b>{t}</b></li>
        ))}
      </ul>
      <p className="muted small">놓치면 크게 풀어야 하는 단계라서 확인을 받아요.</p>
      <div className="row">
        <button className="btn" onClick={p.onClose}>아직이에요</button>
        <button className="btn primary" autoFocus onClick={p.onConfirm}>했어요, 다음 단으로</button>
      </div>
    </Modal>
  );
}

export function FinishDialog(p: { projectId: string; finishedKeys: string[]; onClose: () => void; onDone: (msg: string) => void }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const keys = p.finishedKeys.length ? p.finishedKeys : ['가슴둘레', '총장'];
  return (
    <Modal title="🎉 완성 실측 입력하기" onClose={p.onClose}>
      <p className="muted small">블로킹까지 마친 뒤 재 주세요. 이 값으로 다음 작품의 게이지 보정이 더 정확해져요.</p>
      <div className="grid2">
        {keys.map((k) => (
          <label key={k} className="field">
            <span>{k} (cm)</span>
            <input inputMode="decimal" value={vals[k] ?? ''} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} />
          </label>
        ))}
      </div>
      {err && <p className="error">{err}</p>}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={p.onClose}>나중에</button>
        <button
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const measured = Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, Number(v)]).filter(([, v]) => (v as number) > 0));
              const r = await api.finish(p.projectId, measured);
              const k = r.learned.coefficient?.kSt;
              p.onDone(k ? `완성! 큰 작품 보정 계수가 ${k.toFixed(3)}로 업데이트됐어요` : '완성! 완성 옷장으로 옮겼어요');
            } catch (x) {
              setErr((x as Error).message);
              setBusy(false);
            }
          }}
        >
          완성 처리
        </button>
      </div>
    </Modal>
  );
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const rows = [
    ['Space · ↑ · PageDown · →', '+1 (한 단 완료)'],
    ['Backspace · ↓ · PageUp · ←', '−1'],
    ['⌘Z / Ctrl+Z', '실행 취소'],
    ['F', '집중 모드'],
    ['C', '완성본과 비교'],
    ['N', '메모'],
    ['M', '실측'],
    ['1~9', '조각 탭'],
  ];
  return (
    <Modal title="⌨ 단축키" onClose={onClose}>
      <table className="dims">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td><kbd>{k}</kbd></td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">블루투스 페이지 터너·발판은 대부분 PageDown/PageUp(또는 →/←) 키로 인식돼서 바로 쓸 수 있어요.</p>
      <button className="btn" onClick={onClose}>닫기</button>
    </Modal>
  );
}
