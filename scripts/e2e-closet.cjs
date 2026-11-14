// 옷장 레일 확인: 작품 여러 벌을 심고 넘기기·꺼내 보기·이어 뜨기 (빈 데이터로 서버를 켠 뒤 실행)
const { chromium, devices } = require('playwright');
const B = process.env.BASE_URL ?? 'http://localhost:8787';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 810 }, locale: 'ko-KR' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto(B + '/');
  await p.screenshot({ path: (process.env.OUT_DIR ?? require('node:os').tmpdir()) + '/r0-who-empty.png' });
  // 여러 색의 작품을 심기
  await p.evaluate(async () => {
    const j = (m, u, body) => fetch(u, { method: m, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
    const prof = await j('POST', '/api/profiles', { name: '아내분' });
    const s = await j('POST', '/api/patterns/sample');
    const h = await j('POST', '/api/patterns/sample?which=beanie');
    const base = (await j('GET', '/api/patterns/' + s.id)).pattern;
    const looks = [
      ['구름 브로드리 스웨터', ['#F4EFEA', '#E8D9C8', '#D9C2A8', '#CDB79E', '#BFD4D0', '#9DB7C9'], 0.92],
      ['라벤더 요크 풀오버', ['#A9A6D6', '#F3EEF5', '#E7C6D8', '#7F7BB8', '#CFE0EA', '#5C5A99'], 0.55],
      ['살구 페어아일', ['#EDB9A8', '#FFF4EA', '#C96F5A', '#F1D9A0', '#B9D3C2', '#8C4A3C'], 0.3],
      ['세이지 스웨터', ['#A8B79B', '#F2EEDF', '#6E8062', '#E3C98F', '#D9A796', '#4D5C45'], 0.08],
    ];
    const made = [];
    made.push([await j('POST', '/api/projects', { profileId: prof.id, patternId: s.id, size: 'M', myGauge: { st: 25, row: 33 }, name: '겨울 페어아일 요크 스웨터' }), 0.7]);
    for (const [name, cols, prog] of looks) {
      const pat = { ...base, title: name, palette: base.palette.map((c, i) => ({ ...c, hex: cols[i] })) };
      const np = await j('POST', '/api/patterns', { pattern: pat });
      made.push([await j('POST', '/api/projects', { profileId: prof.id, patternId: np.id, size: 'M', myGauge: { st: 25, row: 33 }, name }), prog]);
    }
    made.push([await j('POST', '/api/projects', { profileId: prof.id, patternId: h.id, size: '성인', myGauge: { st: 22, row: 30 }, name: '호박 소용돌이 비니' }), 0.6]);
    for (const [m, prog] of made) {
      const proj = await j('GET', '/api/projects/' + m.id);
      let k = 0;
      for (const pc of proj.pieces) {
        await j('POST', '/api/pieces/' + encodeURIComponent(pc.id) + '/events', { events: [{ id: m.id + k++, type: 'jump', fromRow: 0, toRow: Math.round(pc.totalRows * Math.min(1, prog * (k === 1 ? 1.25 : 0.8))), at: Date.now() - 3600e3 }] });
      }
    }
  });
  await p.reload();
  await p.getByText('누구의 옷장인가요?').waitFor();
  await p.waitForTimeout(900);
  await p.screenshot({ path: (process.env.OUT_DIR ?? require('node:os').tmpdir()) + '/r1-who.png' });
  await p.getByRole('button', { name: /아내분/ }).click();
  await p.locator('.hang.front').waitFor();
  await p.waitForTimeout(2200);
  await p.screenshot({ path: (process.env.OUT_DIR ?? require('node:os').tmpdir()) + '/r2-rail.png' });
  await p.keyboard.press('ArrowRight');
  await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(1800);
  await p.screenshot({ path: (process.env.OUT_DIR ?? require('node:os').tmpdir()) + '/r3-rail-3.png' });
  console.log('detail:', (await p.locator('.detail').innerText()).replace(/\s+/g, ' ').slice(0, 140));
  // 뒤쪽 옷을 눌러 꺼내기
  await p.locator('.hang').nth(5).evaluate((el) => el.click());
  await p.waitForTimeout(1600);
  await p.screenshot({ path: (process.env.OUT_DIR ?? require('node:os').tmpdir()) + '/r4-hat.png' });
  console.log('after peek:', await p.locator('.detail h1').innerText());
  await p.locator('.hang.front').click({ force: true });
  await p.waitForURL(/\/work$/);
  console.log('follow → work ok');
  const ph = await b.newContext({ ...devices['iPhone 13'], locale: 'ko-KR' });
  const pp = await ph.newPage();
  await pp.goto(B + '/');
  await pp.getByRole('button', { name: /아내분/ }).click();
  await pp.locator('.hang.front').waitFor();
  await pp.waitForTimeout(2200);
  await pp.screenshot({ path: (process.env.OUT_DIR ?? require('node:os').tmpdir()) + '/r5-iphone.png', fullPage: true });
  console.log('iphone scrollWidth', await pp.evaluate(() => document.documentElement.scrollWidth));
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await b.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
