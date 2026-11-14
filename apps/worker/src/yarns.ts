import { Hono } from 'hono';
import type { Db } from './db.js';
import { now, uid } from './db.js';
import type { Env } from './index.js';

/**
 * 실 라이브러리 (디자인 스튜디오).
 * - 기본 색: 앱에 들어 있는 색 견본 (실제 브랜드 제품이 아니라 색 고르기용)
 * - 내 실: 집에 있는 실을 사진·색·얼룩 정도와 함께 등록
 */

export type YarnOut = {
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
  family: ColorFamily;
};

export type ColorFamily = '빨강' | '주황' | '노랑' | '초록' | '파랑' | '보라' | '분홍' | '갈색' | '무채색';
export const FAMILIES: ColorFamily[] = ['빨강', '주황', '노랑', '초록', '파랑', '보라', '분홍', '갈색', '무채색'];

export function hsl(hex: string): { h: number; s: number; l: number } {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

/** 색 계열 (필터용) */
export function colorFamily(hex: string): ColorFamily {
  const { h, s, l } = hsl(hex);
  if (s < 0.14 || l < 0.1 || l > 0.94) return '무채색';
  if (h >= 15 && h < 45 && l < 0.45) return '갈색';
  if (h < 12 || h >= 345) return l > 0.72 ? '분홍' : '빨강';
  if (h < 40) return '주황';
  if (h < 68) return '노랑';
  if (h < 170) return '초록';
  if (h < 255) return '파랑';
  if (h < 300) return '보라';
  return '분홍';
}

/** 색 순서 정렬 키: 무채색은 맨 뒤 밝은 순, 나머지는 색상환 → 밝기 */
export function colorOrderKey(hex: string): number {
  const { h, s, l } = hsl(hex);
  if (s < 0.14) return 1000 + (1 - l) * 100;
  // 빨강(345°~)이 맨 앞에 오게 돌림
  return ((h + 15) % 360) + (1 - l) * 0.9;
}

type Seed = [name: string, hex: string, hex2?: string, heather?: number];

const LINES: { brand: string; weight: string; fiber: string; colors: Seed[] }[] = [
  {
    brand: '기본 DK 울',
    weight: 'dk',
    fiber: '울 100%',
    colors: [
      ['크림', '#F3EBDD'], ['오트밀', '#D8CBB3'], ['차콜', '#3A3A3C'], ['먹색', '#1F1D1E'], ['연회색', '#BDBBB7'],
      ['버건디', '#6B1F3A'], ['체리', '#A3192B'], ['토마토', '#D2402E'], ['코랄', '#E8735E'], ['살구', '#F2A57E'],
      ['호박', '#C8641E'], ['머스터드', '#D9B45A'], ['레몬', '#EAD86A'], ['올리브', '#7A7A3A'], ['세이지', '#9CAF88'],
      ['포레스트', '#2F5233'], ['민트', '#BFE3DD'], ['청록', '#2C7A7B'], ['하늘', '#9CC3E4'], ['코발트', '#2B5BD9'],
      ['네이비', '#1E2A4A'], ['라벤더', '#B9A7D6'], ['자두', '#5B2A55'], ['핑크', '#E8A6A8'], ['로즈', '#C76D7E'],
      ['초콜릿', '#4A2C21'], ['카멜', '#B07A45'], ['테라코타', '#B5543A'],
    ],
  },
  {
    brand: '셰틀랜드풍 (fingering)',
    weight: 'fingering',
    fiber: '울 100% · 헤더',
    colors: [
      ['이끼', '#6E7A3E', '#9A8A4A', 0.5], ['피트', '#5A3E2B', '#7B5A3A', 0.45], ['안개', '#A9B4B8', '#8A949A', 0.5],
      ['히스', '#8E5B7E', '#B88AA6', 0.55], ['해초', '#3C6458', '#5E8274', 0.5], ['저녁놀', '#C8642E', '#E0954A', 0.45],
      ['라즈베리', '#A3315A', '#C55A7E', 0.45], ['보리', '#D7C08A', '#BFA36A', 0.45], ['바다', '#2E5C8A', '#5A86B0', 0.5],
      ['석탄', '#2E2E30', '#55524F', 0.4], ['양털', '#EDE5D6', '#D6CBB8', 0.35], ['와일드 바이올렛', '#B07A8C', '#7E4E6A', 0.7],
      ['러스트', '#9E4426', '#C06A3C', 0.45], ['호박 마알', '#C8641E', '#F3EBDD', 0.3],
    ],
  },
  {
    brand: '모헤어 실크 (lace)',
    weight: 'lace',
    fiber: '모헤어 70% · 실크 30%',
    colors: [
      ['구름', '#F4F0EA', '#FFFFFF', 0.4], ['블러시', '#EBC3C0', '#F6DCD8', 0.4], ['피스타치오', '#C9D6A5', '#DDE6C0', 0.4],
      ['라일락', '#CDB8DE', '#E1D3EC', 0.4], ['스모크', '#8F8C8A', '#B4B0AC', 0.4], ['캐러멜', '#C08A55', '#D8A877', 0.4],
    ],
  },
];

export const LIBRARY: YarnOut[] = LINES.flatMap((line, li) =>
  line.colors.map(([name, hex, hex2, heather], i) => ({
    id: `lib-${li}-${i}`,
    source: 'library' as const,
    brand: line.brand,
    name,
    weight: line.weight,
    fiber: line.fiber,
    hex,
    hex2: hex2 ?? null,
    heather: heather ?? 0,
    photoKey: null,
    gramsOwned: null,
    family: colorFamily(hex),
  })),
);

type YarnRow = {
  id: string;
  profile_id: string;
  brand: string;
  name: string;
  weight: string;
  fiber: string;
  hex: string;
  hex2: string | null;
  heather: number;
  photo_key: string | null;
  grams_owned: number | null;
  note: string;
  created_at: number;
};

const rowOut = (r: YarnRow): YarnOut => ({
  id: r.id,
  source: 'mine',
  brand: r.brand,
  name: r.name,
  weight: r.weight,
  fiber: r.fiber,
  hex: r.hex,
  hex2: r.hex2,
  heather: r.heather,
  photoKey: r.photo_key,
  gramsOwned: r.grams_owned,
  family: colorFamily(r.hex),
});

const HEX = /^#[0-9a-fA-F]{6}$/;

export const yarnRoutes = new Hono<{ Bindings: Env; Variables: { db: Db } }>();

/** 검색·필터·정렬·페이지 */
yarnRoutes.get('/yarns', async (c) => {
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  const brand = c.req.query('brand') ?? '';
  const family = c.req.query('family') ?? '';
  const source = c.req.query('source') ?? 'all';
  const sort = c.req.query('sort') === 'brand' ? 'brand' : 'color';
  const per = Math.min(60, Math.max(6, Number(c.req.query('per') ?? 24)));
  const page = Math.max(1, Number(c.req.query('page') ?? 1));
  const profileId = c.req.query('profileId');

  const mine = profileId
    ? (await c.var.db.all<YarnRow>('SELECT * FROM yarns WHERE profile_id = ? ORDER BY created_at DESC', profileId)).map(rowOut)
    : [];
  let all = source === 'mine' ? mine : source === 'library' ? LIBRARY : [...mine, ...LIBRARY];
  const brands = [...new Set(all.map((y) => y.brand).filter(Boolean))];
  if (q) all = all.filter((y) => `${y.brand} ${y.name} ${y.fiber} ${y.family}`.toLowerCase().includes(q));
  if (brand) all = all.filter((y) => y.brand === brand);
  if (family) all = all.filter((y) => y.family === family);
  all = [...all].sort((a, b) =>
    sort === 'brand'
      ? (a.source === b.source ? 0 : a.source === 'mine' ? -1 : 1) || a.brand.localeCompare(b.brand, 'ko') || a.name.localeCompare(b.name, 'ko')
      : colorOrderKey(a.hex) - colorOrderKey(b.hex),
  );
  const total = all.length;
  return c.json({
    items: all.slice((page - 1) * per, page * per),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / per)),
    brands,
    families: FAMILIES,
  });
});

yarnRoutes.post('/profiles/:id/yarns', async (c) => {
  const b = (await c.req.json()) as Partial<YarnOut> & { note?: string };
  if (!b.name?.trim()) throw new Error('실 이름(색 이름)을 입력해 주세요');
  if (!b.hex || !HEX.test(b.hex)) throw new Error('색을 골라 주세요');
  if (b.hex2 && !HEX.test(b.hex2)) throw new Error('두 번째 색 형식이 올바르지 않아요');
  const id = uid();
  await c.var.db.run(
    `INSERT INTO yarns (id, profile_id, brand, name, weight, fiber, hex, hex2, heather, photo_key, grams_owned, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    c.req.param('id'),
    b.brand?.trim() ?? '',
    b.name.trim(),
    b.weight ?? 'dk',
    b.fiber ?? '',
    b.hex.toUpperCase(),
    b.hex2 ? b.hex2.toUpperCase() : null,
    Math.max(0, Math.min(1, Number(b.heather ?? 0))),
    b.photoKey ?? null,
    b.gramsOwned ?? null,
    b.note ?? '',
    now(),
  );
  return c.json({ id }, 201);
});

yarnRoutes.delete('/yarns/:id', async (c) => {
  await c.var.db.run('DELETE FROM yarns WHERE id = ?', c.req.param('id'));
  return c.json({ ok: true });
});
