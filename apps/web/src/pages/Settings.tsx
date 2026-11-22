import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { flushAll, pendingCount } from '../offline';
import { readPrefs, savePrefs, setStoredProfile, useToast, type Prefs } from '../ui';

/** 설정 (/settings) — 스킨, 접근성, 백업 */
export default function Settings() {
  const nav = useNavigate();
  const toast = useToast();
  const [prefs, setPrefs] = useState<Prefs>(readPrefs());
  const ai = useQuery({ queryKey: ['ai'], queryFn: api.aiStatus });
  const health = useQuery({ queryKey: ['health'], queryFn: () => fetch('/api/health').then((r) => r.json() as Promise<{ ok: boolean }>) });
  const [pending, setPending] = useState(0);
  useEffect(() => {
    void pendingCount().then(setPending);
  }, []);

  const update = (p: Partial<Prefs>) => {
    const n = { ...prefs, ...p };
    setPrefs(n);
    savePrefs(n);
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>⚙ 설정</h1>
      </div>

      <section className="card">
        <h2 className="serif">스킨과 화면</h2>
        <div className="row">
          <span>스킨</span>
          <div className="seg" role="group">
            <button aria-pressed={prefs.skin === 'antique'} onClick={() => update({ skin: 'antique' })}>고풍 옷장</button>
            <button aria-pressed={prefs.skin === 'modern'} onClick={() => update({ skin: 'modern' })}>모던</button>
          </div>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <span>테마</span>
          <div className="seg" role="group">
            <button aria-pressed={prefs.theme === 'auto'} onClick={() => update({ theme: 'auto' })}>기기 설정</button>
            <button aria-pressed={prefs.theme === 'light'} onClick={() => update({ theme: 'light' })}>밝게</button>
            <button aria-pressed={prefs.theme === 'dark'} onClick={() => update({ theme: 'dark' })}>야간</button>
          </div>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <span>움직임</span>
          <div className="seg" role="group">
            <button aria-pressed={prefs.motion === 'auto'} onClick={() => update({ motion: 'auto' })}>기기 설정</button>
            <button aria-pressed={prefs.motion === 'reduce'} onClick={() => update({ motion: 'reduce' })}>줄이기</button>
          </div>
        </div>
        <label className="row" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={prefs.haptics} onChange={(e) => update({ haptics: e.target.checked })} /> +1 할 때 진동
        </label>
        <label className="row" style={{ marginTop: 6 }}>
          <input type="checkbox" checked={prefs.sound} onChange={(e) => update({ sound: e.target.checked })} /> +1 할 때 "톡" 소리
        </label>
        <p className="small muted">색약 모드(차트에 기호 표시)는 작업 화면 ⋯ 메뉴에서 켤 수 있어요.</p>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2 className="serif">연결과 백업</h2>
        <p>
          서버: {health.data?.ok ? '✅ 연결됨' : health.isLoading ? '확인 중…' : '⚡ 연결 안 됨 (오프라인으로 동작해요)'}
          <br />
          보내지 못한 진행 기록: <b className="num">{pending}개</b>{' '}
          {pending > 0 && (
            <button
              className="btn small"
              onClick={async () => {
                const r = await flushAll();
                setPending(await pendingCount());
                toast({ text: r.offline ? '아직 오프라인이에요' : `${r.sent}개 보냈어요` });
              }}
            >
              지금 보내기
            </button>
          )}
          <br />
          AI 도안 기능: {ai.data?.enabled ? `켜짐 (${ai.data.model})` : '꺼짐 (.dev.vars에 ANTHROPIC_API_KEY 필요)'}
        </p>
        <a className="btn" href="/api/export" download={`knitcloset-backup-${new Date().toISOString().slice(0, 10)}.json`}>
          ⬇ 전체 데이터 내려받기 (JSON)
        </a>
        <p className="small muted">자동 백업은 맥북에서 매일 03:00에 scripts/backup.sh가 실행해요 (README 참고).</p>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2 className="serif">프로필</h2>
        <button
          className="btn"
          onClick={() => {
            setStoredProfile(null);
            nav('/');
          }}
        >
          다른 네임태그로 바꾸기
        </button>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2 className="serif">만든 사람들</h2>
        <p className="small muted">
          여자 마네킹 3D 모델(맥에 받아 둔 경우): “Free Female Mannequin Base Mesh” — Devlane (
          <a href="https://sketchfab.com/3d-models/free-female-mannequin-base-mesh-187300a221c04178b96b84bf9cab97e0" target="_blank" rel="noreferrer">
            Sketchfab
          </a>
          , Sketchfab Standard 라이선스). 천을 씌운 질감·박음선을 더하고 가슴을 매끈하게 다듬어 썼어요.
        </p>
      </section>
    </div>
  );
}
