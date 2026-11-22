import { useCallback, useEffect, useState } from 'react';
import type { BodyKind } from './body';

/**
 * 마네킹 몸(여자·남자) 고르기. 옷장 주인(프로필)마다 이 기기에 기억해요.
 * 한 화면에서 바꾸면 열려 있는 다른 화면(옷장 정지 그림, 작업 화면 3D)도 같이 바뀌어요.
 */
const KEY = (profileId?: string) => `kc.body.${profileId ?? 'default'}`;
const EVENT = 'kc:body';

export function readBody(profileId?: string): BodyKind {
  try {
    return localStorage.getItem(KEY(profileId)) === 'male' ? 'male' : 'female';
  } catch {
    return 'female';
  }
}

export function writeBody(profileId: string | undefined, kind: BodyKind) {
  try {
    localStorage.setItem(KEY(profileId), kind);
  } catch {
    // 저장 공간을 못 쓰면 이번만
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { profileId, kind } }));
}

export function useBody(profileId?: string): [BodyKind, (kind: BodyKind) => void] {
  const [kind, setKind] = useState<BodyKind>(() => readBody(profileId));
  useEffect(() => {
    setKind(readBody(profileId));
    const sync = () => setKind(readBody(profileId));
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [profileId]);
  const set = useCallback(
    (k: BodyKind) => {
      setKind(k);
      writeBody(profileId, k);
    },
    [profileId],
  );
  return [kind, set];
}
