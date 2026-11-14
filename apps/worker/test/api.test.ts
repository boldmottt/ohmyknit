import { beforeEach, describe, expect, it } from 'vitest';
import { app, type Env } from '../src/index.js';
import { fakeD1, fakeR2 } from './fakes.js';

let env: Env;

async function call<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await app.request(
    path,
    {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
    },
    env,
  );
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

async function setup() {
  const { data: prof } = await call('POST', '/api/profiles', { name: '아내분', avatar: '🧶' });
  const { data: pat } = await call('POST', '/api/patterns/sample');
  return { profileId: prof.id as string, patternId: pat.id as string };
}

beforeEach(() => {
  env = { DB: fakeD1(), FILES: fakeR2() };
});

describe('기본', () => {
  it('health', async () => {
    expect((await call('GET', '/api/health')).data.ok).toBe(true);
  });

  it('없는 API는 404', async () => {
    expect((await call('GET', '/api/nope')).status).toBe(404);
  });
});

describe('프로필과 손 프로필', () => {
  it('스와치가 없으면 도안 게이지를 추천', async () => {
    const { profileId } = await setup();
    const { data } = await call('GET', `/api/profiles/${profileId}/suggest-gauge?patternSt=22&patternRow=30`);
    expect(data.source).toBe('pattern');
    expect(data.st).toBe(22);
  });

  it('스와치가 있으면 블로킹 후 값 우선', async () => {
    const { profileId } = await setup();
    await call('POST', `/api/profiles/${profileId}/swatches`, {
      yarnWeight: 'dk', needleMm: 4, technique: 'stockinette', stsPre: 26, rowsPre: 34, stsPost: 25, rowsPost: 33,
    });
    const { data } = await call('GET', `/api/profiles/${profileId}/suggest-gauge?patternSt=22&patternRow=30&yarnWeight=dk`);
    expect(data.source).toBe('swatch');
    expect(data.st).toBe(25);
    expect(data.row).toBe(33);
  });

  it('게이지 없는 스와치는 거부', async () => {
    const { profileId } = await setup();
    const r = await call('POST', `/api/profiles/${profileId}/swatches`, { needleMm: 4 });
    expect(r.status).toBe(400);
    expect(r.data.error).toContain('게이지');
  });
});

describe('도안', () => {
  it('잘못된 도안은 400과 이유', async () => {
    const r = await call('POST', '/api/patterns', { pattern: { title: 'x' } });
    expect(r.status).toBe(400);
    expect(r.data.error).toContain('도안 형식');
  });

  it('변환 미리보기 (마법사 3단계)', async () => {
    const { patternId } = await setup();
    const { data } = await call('POST', `/api/patterns/${patternId}/preview`, { size: 'M', myGauge: { st: 25, row: 33 } });
    expect(data.pieces[0].castOn.value).toBe(228);
    expect(data.pieces[0].castOn.asIsWidthCm).toBe(80);
    expect(data.finished['가슴둘레']).toBe(91);
  });
});

describe('프로젝트 수명주기', () => {
  async function newProject() {
    const ids = await setup();
    const { status, data } = await call('POST', '/api/projects', {
      ...ids,
      size: 'M',
      myGauge: { st: 25, row: 33 },
      name: '겨울 스웨터',
    });
    expect(status).toBe(201);
    return { ...ids, projectId: data.id as string };
  }

  it('만들면 옷장에 걸리고 조각 3개가 생김', async () => {
    const { profileId, projectId } = await newProject();
    const { data } = await call('GET', `/api/profiles/${profileId}/projects`);
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe(projectId);
    expect(data[0].pieces.map((p: any) => p.name)).toEqual(['몸판', '소매 1', '소매 2']);
    expect(data[0].progress).toBe(0);
  });

  it('작업 화면 데이터 한 번에', async () => {
    const { projectId } = await newProject();
    const { data } = await call('GET', `/api/projects/${projectId}/work`);
    expect(data.converted.pieces[0].castOn.value).toBe(228);
    expect(data.pieces[0].progress.currentRow).toBe(0);
    expect(data.speed.stitchesPerMinute).toBeNull();
  });

  it('이벤트 동기화: 중복 무시, 진척도 계산, 최근 작업일 갱신', async () => {
    const { projectId, profileId } = await newProject();
    const pieceId = `${projectId}:body`;
    const t = Date.now() - 10 * 60_000;
    const events = Array.from({ length: 10 }, (_, i) => ({
      id: `ev-${i}`, pieceId, type: 'row_inc', fromRow: i, toRow: i + 1, at: t + i * 60_000, device: 'ipad',
    }));
    const r1 = await call('POST', `/api/pieces/${encodeURIComponent(pieceId)}/events`, { events });
    expect(r1.data.currentRow).toBe(10);
    expect(r1.data.stitchesDone).toBe(2280);
    // 같은 이벤트 재전송 (오프라인 큐)
    const r2 = await call('POST', `/api/pieces/${encodeURIComponent(pieceId)}/events`, { events: events.slice(5) });
    expect(r2.data.currentRow).toBe(10);
    expect(r2.data.eventCount).toBe(10);

    const { data: list } = await call('GET', `/api/profiles/${profileId}/projects`);
    expect(list[0].lastWorkedAt).toBe(t + 9 * 60_000);
    expect(list[0].progress).toBeGreaterThan(0);

    const { data: work } = await call('GET', `/api/projects/${projectId}/work`);
    expect(work.speed.activeMs).toBe(9 * 60_000);
    expect(work.speed.stitchesPerMinute).toBeCloseTo(2280 / 9, 5);
  });

  it('풀기 기록', async () => {
    const { projectId } = await newProject();
    const pieceId = encodeURIComponent(`${projectId}:body`);
    const r = await call('POST', `/api/pieces/${pieceId}/events`, {
      events: [
        { id: 'a', type: 'jump', fromRow: 0, toRow: 40, at: 1 },
        { id: 'b', type: 'frog', fromRow: 40, toRow: 34, at: 2, meta: '실수' },
      ],
    });
    expect(r.data.currentRow).toBe(34);
    expect(r.data.frogRows).toBe(6);
  });

  it('메모와 실측', async () => {
    const { projectId } = await newProject();
    const pieceId = encodeURIComponent(`${projectId}:body`);
    await call('POST', `/api/pieces/${pieceId}/notes`, { row: 12, text: '여기서 실 바꿈' });
    const ck = await call('POST', `/api/pieces/${pieceId}/checkins`, { atRow: 60, measuredCm: 17, expectedCm: 18.2 });
    expect(ck.data.warn).toBe(true);
    const { data } = await call('GET', `/api/projects/${projectId}/work`);
    expect(data.notes[0].text).toBe('여기서 실 바꿈');
    expect(data.checkins[0].deviationPct).toBeLessThan(-3);
  });

  it('서랍 보관 → 복원, 영구 삭제는 보관 상태 + 이름 확인 필요', async () => {
    const { projectId, profileId } = await newProject();
    expect((await call('DELETE', `/api/projects/${projectId}?confirm=겨울 스웨터`)).status).toBe(400);
    await call('POST', `/api/projects/${projectId}/archive`);
    expect((await call('GET', `/api/profiles/${profileId}/projects`)).data).toHaveLength(0);
    expect((await call('GET', `/api/profiles/${profileId}/projects?status=archived`)).data).toHaveLength(1);
    expect((await call('DELETE', `/api/projects/${projectId}?confirm=틀린이름`)).status).toBe(400);
    await call('POST', `/api/projects/${projectId}/restore`);
    expect((await call('GET', `/api/profiles/${profileId}/projects`)).data).toHaveLength(1);
    await call('POST', `/api/projects/${projectId}/archive`);
    expect((await call('DELETE', `/api/projects/${projectId}?confirm=${encodeURIComponent('겨울 스웨터')}`)).status).toBe(200);
    expect((await call('GET', `/api/projects/${projectId}`)).status).toBe(404);
  });

  it('재변환해도 뜬 단은 유지', async () => {
    const { projectId } = await newProject();
    const pieceId = `${projectId}:body`;
    await call('POST', `/api/pieces/${encodeURIComponent(pieceId)}/events`, {
      events: [{ id: 'j', type: 'jump', fromRow: 0, toRow: 30, at: 1 }],
    });
    await call('POST', `/api/projects/${projectId}/reconvert`, { myGauge: { st: 24, row: 32 } });
    const { data } = await call('GET', `/api/projects/${projectId}/work`);
    expect(data.project.myGauge.st).toBe(24);
    expect(data.pieces[0].progress.currentRow).toBe(30);
    expect(data.converted.pieces[0].castOn.value).toBe(216); // 200 × 24/22 = 218.2 → 12의 배수 216
  });

  it('완성 실측으로 손 보정 계수 학습', async () => {
    const ids = await setup();
    const { data: sw } = await call('POST', `/api/profiles/${ids.profileId}/swatches`, {
      yarnWeight: 'dk', needleMm: 4, technique: 'stockinette', stsPost: 25, rowsPost: 33,
    });
    const { data: proj } = await call('POST', '/api/projects', {
      ...ids, size: 'M', myGauge: { st: 25, row: 33 },
      gaugeBasis: { swatchId: sw.id, swatchSt: 25, swatchRow: 33 },
    });
    // 예상 가슴둘레 91cm인데 89cm로 나옴 → 큰 작품에서 더 쫀쫀
    const { data } = await call('POST', `/api/projects/${proj.id}/finish`, { measured: { 가슴둘레: 89 } });
    expect(data.learned.kActualSt).toBeCloseTo(91 / 89, 4);
    // 기준선 1 (가중치 1) + 표본 1.0225 (가중치 2) → 1.015
    expect(data.learned.coefficient.kSt).toBeCloseTo((1 + (91 / 89) * 2) / 3, 4);

    const { data: hands } = await call('GET', `/api/profiles/${ids.profileId}/hands`);
    expect(hands.coefficients).toHaveLength(1);
    expect(hands.finished[0].measured['가슴둘레']).toBe(89);

    const { data: sug } = await call('GET', `/api/profiles/${ids.profileId}/suggest-gauge?patternSt=22&patternRow=30&yarnWeight=dk&technique=stockinette`);
    expect(sug.source).toBe('swatch+coef');
    expect(sug.st).toBeCloseTo(25 * ((1 + (91 / 89) * 2) / 3), 1);
  });
});

describe('파일과 AI', () => {
  it('파일 올리고 받기', async () => {
    const form = new FormData();
    form.append('file', new File([new Uint8Array([37, 80, 68, 70])], '도안.pdf', { type: 'application/pdf' }));
    const up = await app.request('/api/files', { method: 'POST', body: form }, env);
    expect(up.status).toBe(201);
    const { key } = (await up.json()) as { key: string };
    const down = await app.request(`/api/files/${key}`, {}, env);
    expect(down.headers.get('content-type')).toBe('application/pdf');
    expect(new Uint8Array(await down.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]));
  });

  it('API 키가 없으면 501과 안내', async () => {
    const r = await call('POST', '/api/patterns/generate', { request: '래글런 가디건' });
    expect(r.status).toBe(501);
    expect(r.data.error).toContain('ANTHROPIC_API_KEY');
    expect((await call('GET', '/api/ai/status')).data.enabled).toBe(false);
  });
});

describe('실 라이브러리', () => {
  it('기본 색: 검색·색 계열·정렬·페이지', async () => {
    const all = await call('GET', '/api/yarns?per=60');
    expect(all.data.total).toBeGreaterThan(40);
    expect(all.data.brands).toContain('기본 DK 울');
    const orange = await call('GET', `/api/yarns?family=${encodeURIComponent('주황')}`);
    expect(orange.data.items.length).toBeGreaterThan(0);
    expect(orange.data.items.every((y: any) => y.family === '주황')).toBe(true);
    const q = await call('GET', `/api/yarns?q=${encodeURIComponent('호박')}`);
    expect(q.data.items.map((y: any) => y.name)).toContain('호박');
    const p2 = await call('GET', '/api/yarns?per=10&page=2');
    expect(p2.data.items).toHaveLength(10);
    expect(p2.data.page).toBe(2);
  });

  it('내 실 등록 → 맨 앞(브랜드 순)에 나오고 지울 수 있음', async () => {
    const { profileId } = await setup();
    const bad = await call('POST', `/api/profiles/${profileId}/yarns`, { name: '보라', hex: 'purple' });
    expect(bad.status).toBe(400);
    const { data } = await call('POST', `/api/profiles/${profileId}/yarns`, {
      brand: '우리집 실', name: '들꽃 보라', hex: '#b07a8c', hex2: '#7E4E6A', heather: 0.7, gramsOwned: 50,
    });
    const list = await call('GET', `/api/yarns?profileId=${profileId}&sort=brand`);
    expect(list.data.items[0].id).toBe(data.id);
    expect(list.data.items[0].hex).toBe('#B07A8C');
    expect(list.data.items[0].family).toBe('분홍');
    const mine = await call('GET', `/api/yarns?profileId=${profileId}&source=mine`);
    expect(mine.data.total).toBe(1);
    await call('DELETE', `/api/yarns/${data.id}`);
    expect((await call('GET', `/api/yarns?profileId=${profileId}&source=mine`)).data.total).toBe(0);
  });

  it('비니 샘플 도안 (정수리 차트)', async () => {
    const { data } = await call('POST', '/api/patterns/sample?which=beanie');
    const p = await call('GET', `/api/patterns/${data.id}`);
    expect(p.data.title).toBe('호박 소용돌이 비니');
  });
});
