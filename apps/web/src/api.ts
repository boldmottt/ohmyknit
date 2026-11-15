import type { ConvertedPattern, ProgressEvent } from '@knitcloset/gauge-engine';
import type { Pattern, PatternInput } from '@knitcloset/pattern-schema';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body !== undefined && !(body instanceof FormData) ? { 'content-type': 'application/json' } : undefined,
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('서버에 연결할 수 없어요 (오프라인)', 0);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Cloudflare Access 로그인 페이지 등 JSON이 아닌 응답
    throw new ApiError(res.ok ? '서버 응답을 읽지 못했어요' : `서버 오류 (${res.status})`, res.status);
  }
  if (!res.ok) throw new ApiError((data as { error?: string })?.error ?? `오류 (${res.status})`, res.status);
  return data as T;
}

/**
 * 옷장을 여는 데 필요한 목록은 마지막으로 받은 것을 기기에 남겨 둡니다.
 * 맥북이 잠들었거나 집 밖이어도 옷장이 열리고, 거기서 작업 화면(따로 캐시됨)으로 들어갈 수 있어요.
 */
const CACHE_PREFIX = 'kc.cache:';
let servedFromCache = false;
const offlineListeners = new Set<(offline: boolean) => void>();

function setServedFromCache(v: boolean) {
  if (servedFromCache === v) return;
  servedFromCache = v;
  offlineListeners.forEach((f) => f(v));
}

/** 지금 화면의 목록이 기기에 남겨 둔 것인지 알려 줌 (구독 해제 함수를 돌려줌) */
export function onOfflineData(f: (offline: boolean) => void): () => void {
  offlineListeners.add(f);
  f(servedFromCache);
  return () => void offlineListeners.delete(f);
}

async function cachedGet<T>(path: string): Promise<T> {
  try {
    const data = await req<T>('GET', path);
    try {
      localStorage.setItem(CACHE_PREFIX + path, JSON.stringify(data));
    } catch {
      /* 저장 공간이 없으면 캐시 없이 동작 */
    }
    setServedFromCache(false);
    return data;
  } catch (e) {
    // 서버에 닿지 않을 때만 (오프라인, 로그인 만료로 JSON이 아닌 응답) 남겨 둔 것을 씀
    const unreachable = e instanceof ApiError && (e.status === 0 || e.message.includes('서버 응답을 읽지 못했어요'));
    if (unreachable) {
      try {
        const hit = localStorage.getItem(CACHE_PREFIX + path);
        if (hit) {
          setServedFromCache(true);
          return JSON.parse(hit) as T;
        }
      } catch {
        /* 무시 */
      }
    }
    throw e;
  }
}

export type Profile = {
  id: string;
  name: string;
  avatar: string;
  color: string;
  skinId: string;
  bodyMeasurements: Record<string, number>;
  activeCount: number;
};

export type ProjectSummary = {
  id: string;
  profileId: string;
  patternId: string;
  name: string;
  patternTitle: string;
  designer: string;
  sizeLabel: string;
  status: 'active' | 'archived' | 'finished';
  startedAt: number;
  lastWorkedAt: number | null;
  finishedAt: number | null;
  hangerOrder: number;
  conversionMode: 'recalc' | 'needle';
  myGauge: { st: number; row: number };
  needleMm: number | null;
  yarn: string;
  note: string;
  palette: { name: string; hex: string }[];
  motif: number[][] | null;
  kind: 'hat' | 'sweater';
  progress: number;
  stitchesDone: number;
  totalStitches: number;
  pieces: { id: string; name: string; currentRow: number; totalRows: number; progress: number }[];
};

export type PieceState = {
  id: string;
  key: string;
  name: string;
  totalRows: number;
  totalStitches: number;
  progress: {
    currentRow: number;
    currentStitch: number;
    stitchesDone: number;
    frogCount: number;
    frogRows: number;
    updatedAt: number;
  };
};

export type Note = { id: string; pieceId: string; row: number; text: string; photoKey: string | null; createdAt: number };
export type Checkin = {
  id: string;
  pieceId: string;
  atRow: number;
  dimension: string;
  measuredCm: number;
  expectedCm: number;
  deviationPct: number;
  createdAt: number;
};

export type WorkData = {
  project: {
    id: string;
    profileId: string;
    name: string;
    patternTitle: string;
    patternFileKey: string | null;
    sizeLabel: string;
    status: string;
    startedAt: number;
    lastWorkedAt: number | null;
    conversionMode: 'recalc' | 'needle';
    myGauge: { st: number; row: number };
    needleMm: number | null;
    yarn: string;
    ballGrams: number | null;
  };
  converted: ConvertedPattern;
  /** 이 사이즈의 완성 치수 (cm) */
  finished: Record<string, number>;
  pieces: PieceState[];
  notes: Note[];
  checkins: Checkin[];
  yarnLog: { gramsUsed: number; stitchesDone: number; at: number } | null;
  speed: { activeMs: number; stitches: number; stitchesPerMinute: number | null };
};

export type Swatch = {
  id: string;
  yarnName: string;
  yarnWeight: string;
  fiber: string;
  needleMm: number;
  needleMaterial: string;
  technique: string;
  stsPre: number | null;
  rowsPre: number | null;
  stsPost: number | null;
  rowsPost: number | null;
  photoKey: string | null;
  note: string;
  createdAt: number;
};

export type Hands = {
  swatches: Swatch[];
  coefficients: { technique: string; yarnWeight: string; needleMaterial: string; kSt: number; kRow: number; sampleCount: number; updatedAt: number }[];
  finished: { projectId: string; name: string; measured: Record<string, number>; expected: Record<string, number>; kActualSt: number | null; finishedAt: number }[];
};

export type GaugeSuggestion = {
  st: number;
  row: number;
  source: 'swatch+coef' | 'swatch' | 'pattern';
  swatchId?: string;
  swatchSt?: number;
  swatchRow?: number;
  kSt: number;
  kRow: number;
  explanation: string;
};

export type PatternListItem = {
  id: string;
  title: string;
  designer: string;
  sourceType: string;
  gauge: { st: number; row: number };
  needleMm: number | null;
  fileKey: string | null;
  updatedAt: number;
};

export type ConversionPreview = {
  kSt: number;
  kRow: number;
  finished: Record<string, number>;
  pieces: {
    id: string;
    name: string;
    castOn: { original: number; value: number; explanation: string; designWidthCm: number; asIsWidthCm: number; expectedWidthCm: number };
    totalRows: number;
    sections: { name: string; originalRows: number; rows: number; shapingNotes: string[] }[];
    warnings: string[];
  }[];
};

export type AiDraft = {
  pattern: PatternInput;
  reviewNotes: string[];
  valid: boolean;
  validationError?: string;
  model: string;
  fileKey?: string;
};

export type LibraryYarn = {
  id: string;
  source: 'library' | 'mine';
  brand: string;
  name: string;
  weight: string;
  fiber: string;
  hex: string;
  hex2: string | null;
  heather: number;
  photoKey: string | null;
  gramsOwned: number | null;
  family: string;
};

export type YarnPage = { items: LibraryYarn[]; total: number; page: number; pages: number; brands: string[]; families: string[] };

export const api = {
  profiles: () => cachedGet<Profile[]>('/profiles'),
  createProfile: (b: { name: string; avatar?: string; color?: string }) => req<{ id: string }>('POST', '/profiles', b),
  updateProfile: (id: string, b: Partial<Pick<Profile, 'name' | 'avatar' | 'color' | 'skinId' | 'bodyMeasurements'>>) =>
    req('PATCH', `/profiles/${id}`, b),
  projects: (profileId: string, status: 'active' | 'archived' | 'finished' = 'active') =>
    cachedGet<ProjectSummary[]>(`/profiles/${profileId}/projects?status=${status}`),
  project: (id: string) => req<ProjectSummary>('GET', `/projects/${id}`),
  createProject: (b: {
    profileId: string;
    patternId: string;
    size: string;
    myGauge: { st: number; row: number };
    gaugeBasis?: Record<string, unknown>;
    mode: 'recalc' | 'needle';
    name: string;
    yarn: string;
    needleMm: number | null;
    ballGrams: number | null;
    startedAt: number;
  }) => req<{ id: string }>('POST', '/projects', b),
  updateProject: (id: string, b: Record<string, unknown>) => req('PATCH', `/projects/${id}`, b),
  archive: (id: string) => req('POST', `/projects/${id}/archive`),
  restore: (id: string) => req('POST', `/projects/${id}/restore`),
  deleteProject: (id: string, confirm: string) => req('DELETE', `/projects/${id}?confirm=${encodeURIComponent(confirm)}`),
  finish: (id: string, measured: Record<string, number>) =>
    req<{
      expected: Record<string, number>;
      measured: Record<string, number>;
      learned: { kActualSt?: number; coefficient?: { kSt: number }; ignored?: { key: string; measured: number; expected: number }[] };
    }>(
      'POST',
      `/projects/${id}/finish`,
      { measured },
    ),
  reconvert: (id: string, myGauge: { st: number; row: number }, mode?: 'recalc' | 'needle') =>
    req<{ kept: string[]; updated: string[] }>('POST', `/projects/${id}/reconvert`, { myGauge, mode }),
  logYarn: (id: string, gramsUsed: number) => req('POST', `/projects/${id}/yarn`, { gramsUsed }),
  work: (id: string) => req<WorkData>('GET', `/projects/${id}/work`),
  sendEvents: (pieceId: string, events: ProgressEvent[]) =>
    req<{ currentRow: number; currentStitch: number; stitchesDone: number; frogCount: number; frogRows: number }>(
      'POST',
      `/pieces/${encodeURIComponent(pieceId)}/events`,
      { events },
    ),
  checkin: (pieceId: string, b: { atRow: number; measuredCm: number; expectedCm: number; dimension: 'length' | 'width' }) =>
    req<{ id: string; deviationPct: number; warn: boolean; message: string }>('POST', `/pieces/${encodeURIComponent(pieceId)}/checkins`, b),
  addNote: (pieceId: string, b: { row: number; text: string; photoKey?: string }) =>
    req<{ id: string }>('POST', `/pieces/${encodeURIComponent(pieceId)}/notes`, b),
  deleteNote: (id: string) => req('DELETE', `/notes/${id}`),
  hands: (profileId: string) => req<Hands>('GET', `/profiles/${profileId}/hands`),
  suggestGauge: (profileId: string, q: { patternSt: number; patternRow: number; technique?: string; yarnWeight?: string }) =>
    req<GaugeSuggestion>(
      'GET',
      `/profiles/${profileId}/suggest-gauge?${new URLSearchParams(
        Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]),
      )}`,
    ),
  addSwatch: (profileId: string, b: Partial<Swatch>) => req<{ id: string }>('POST', `/profiles/${profileId}/swatches`, b),
  deleteSwatch: (id: string) => req('DELETE', `/swatches/${id}`),
  resetCoefficient: (profileId: string, k: { technique: string; yarnWeight: string; needleMaterial: string }) =>
    req('DELETE', `/profiles/${profileId}/coefficients?${new URLSearchParams(k)}`),
  patterns: () => req<PatternListItem[]>('GET', '/patterns'),
  pattern: (id: string) => req<PatternListItem & { pattern: Pattern }>('GET', `/patterns/${id}`),
  createPattern: (pattern: unknown, meta: { profileId?: string; sourceType?: string; fileKey?: string } = {}) =>
    req<{ id: string }>('POST', '/patterns', { pattern, ...meta }),
  addSamplePattern: (which: 'sweater' | 'beanie' = 'sweater') =>
    req<{ id: string }>('POST', `/patterns/sample${which === 'beanie' ? '?which=beanie' : ''}`),
  yarns: (q: { profileId?: string; q?: string; brand?: string; family?: string; sort?: 'color' | 'brand'; source?: string; page?: number; per?: number }) =>
    req<YarnPage>(
      'GET',
      `/yarns?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))}`,
    ),
  addYarn: (profileId: string, b: Partial<LibraryYarn> & { note?: string }) => req<{ id: string }>('POST', `/profiles/${profileId}/yarns`, b),
  deleteYarn: (id: string) => req('DELETE', `/yarns/${id}`),
  updatePattern: (id: string, pattern: unknown, fileKey?: string) => req('PUT', `/patterns/${id}`, { pattern, fileKey }),
  deletePattern: (id: string) => req('DELETE', `/patterns/${id}`),
  preview: (id: string, b: { size: string; myGauge: { st: number; row: number }; mode: 'recalc' | 'needle' }) =>
    req<ConversionPreview>('POST', `/patterns/${id}/preview`, b),
  upload: (file: File) => {
    const f = new FormData();
    f.append('file', file);
    return req<{ key: string }>('POST', '/files', f);
  },
  aiStatus: () => req<{ enabled: boolean; model: string }>('GET', '/ai/status'),
  parsePdf: (fileKey: string, hint?: string) => req<AiDraft>('POST', '/patterns/parse', { fileKey, hint }),
  generate: (b: { request: string; myGauge?: { st: number; row: number; needleMm?: number }; body?: Record<string, number> }) =>
    req<AiDraft>('POST', '/patterns/generate', b),
};

export const fileUrl = (key: string) => `/api/files/${key.split('/').map(encodeURIComponent).join('/')}`;
