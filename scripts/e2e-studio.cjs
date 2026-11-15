// 디자인 스튜디오 끝에서 끝까지 확인 (Playwright 필요). 빈 데이터로 서버를 켠 뒤: node scripts/e2e-studio.cjs
const { chromium, devices } = require('playwright');
const OUT = process.env.OUT_DIR ?? require('node:os').tmpdir();
const B = process.env.BASE_URL ?? 'http://localhost:8787';
const log = (...a) => console.log('▶', ...a);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ko-KR' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  let sawBeforeUnload = false;
  p.on('dialog', (d) => { if (d.type() === 'beforeunload') sawBeforeUnload = true; d.accept().catch(() => {}); });
  await p.goto(B + '/');
  await p.evaluate(async () => {
    const r = await fetch('/api/profiles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '아내분' }) });
    localStorage.setItem('kc.profile', (await r.json()).id);
  });
  // 1) 샘플 비니 → 스튜디오
  await p.goto(B + '/patterns');
  await p.getByRole('button', { name: '소용돌이 비니 샘플' }).click();
  await p.waitForURL(/\/studio\//);
  await p.locator('.preview-wrap canvas').waitFor();
  await p.waitForTimeout(800);
  await p.screenshot({ path: OUT + '/s1-studio-beanie.png' });
  log('summary:', await p.locator('.chart-sum').innerText());
  // 2) 실 라이브러리: 2번 실 바꾸기 → 보라 계열 호버
  await p.getByRole('button', { name: '2번 실 바꾸기' }).click();
  await p.locator('.yarn-card').first().waitFor();
  await p.getByLabel('색 계열').selectOption('분홍');
  await p.waitForTimeout(500);
  await p.locator('.yarn-card', { hasText: '와일드 바이올렛' }).hover().catch(async () => {
    await p.getByLabel('색 계열').selectOption('보라'); await p.waitForTimeout(400);
    await p.locator('.yarn-card', { hasText: '와일드 바이올렛' }).hover();
  });
  await p.waitForTimeout(600);
  await p.screenshot({ path: OUT + '/s2-yarn-library-hover.png' });
  await p.locator('.yarn-card', { hasText: '와일드 바이올렛' }).click();
  await p.waitForTimeout(400);
  log('slot2 now:', await p.locator('.yarn-slots li').nth(1).innerText());
  log('dirty:', await p.locator('.studio-side').getByText(/저장 안 된 변경|저장됨/).first().innerText());
  // 되돌리기
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(200);
  log('after undo slot2:', (await p.locator('.yarn-slots li').nth(1).innerText()).replace(/\s+/g, ' '));
  await p.keyboard.press('Control+Shift+z');
  // 3) 칠하기: 크림으로 몇 칸
  await p.getByRole('button', { name: /1번 실 .*칠하기/ }).click();
  const cells = p.locator('.cg-cell:not(.none)');
  const n = await cells.count();
  for (const i of [5, 40, 77]) await cells.nth(Math.min(i, n - 1)).click();
  // 저장
  await p.getByRole('button', { name: '저장', exact: true }).click();
  await p.waitForTimeout(800);
  log('after save:', await p.locator('.studio-side').getByText(/저장 안 된 변경|저장됨/).first().innerText());
  // 평면 보기
  await p.locator('.pv-tools').getByRole('button', { name: '평면' }).click();
  await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + '/s3-studio-flat.png' });
  await p.locator('.pv-tools').getByRole('button', { name: '원형' }).click();
  // 10회 반복 (영상 3번째 장면처럼)
  await p.getByLabel('가로 반복').fill('10');
  await p.waitForTimeout(600);
  await p.screenshot({ path: OUT + '/s3b-beanie-10.png' });
  await p.getByRole('button', { name: '저장', exact: true }).click();
  await p.waitForTimeout(600);

  // 4) 새 디자인: 정수리 모양 + 10회 반복 (사진 3번처럼)
  await p.goto(B + '/studio');
  await p.locator('.preview-wrap canvas').waitFor();
  await p.locator('.chart-tools summary').click();
  await p.getByRole('button', { name: /정수리 줄임 모양/ }).click();
  await p.getByLabel('가로 반복').fill('10');
  await p.getByLabel('보기 방식').first().selectOption('circle').catch(() => {});
  await p.locator('.pv-tools').getByRole('button', { name: '원형' }).click();
  // 줄무늬: 1번 실(크림)로 세로줄 몇 개 채우기
  await p.getByRole('button', { name: /1번 실 .*칠하기/ }).click();
  await p.getByRole('button', { name: /채우기/ }).click();
  await p.waitForTimeout(600);
  await p.screenshot({ path: OUT + '/s4-new-circle-10.png' });
  log('new summary:', await p.locator('.chart-sum').innerText());

  // 5) 비니로 프로젝트 → 작업 화면 정수리 구간
  log('beforeunload warning shown for unsaved design:', sawBeforeUnload);
  const pats = await p.evaluate(async () => (await (await fetch('/api/patterns')).json()));
  const beanie = pats.find((x) => x.title === '호박 소용돌이 비니');
  await p.goto(B + `/project/new?pattern=${beanie.id}`);
  log('beforeunload warning shown for unsaved design:', sawBeforeUnload);
  await p.getByRole('button', { name: '다음' }).click();
  await p.getByRole('button', { name: /성인/ }).click();
  await p.getByRole('button', { name: '다음' }).click();
  await p.getByLabel('내 코 게이지 (10cm)').fill('25');
  await p.getByLabel('내 단 게이지 (10cm)').fill('33');
  await p.getByText(/128코/).first().waitFor({ timeout: 10000 });
  await p.getByRole('button', { name: '다음' }).click();
  await p.getByRole('button', { name: '옷장에 걸기' }).click();
  await p.getByRole('button', { name: '바로 시작하기' }).click();
  await p.locator('.counter-num .cur').waitFor();
  await p.getByRole('tab', { name: '지시문' }).click();
  await p.getByRole('button', { name: /소용돌이 정수리/ }).click();
  await p.getByRole('tab', { name: '차트' }).click();
  for (let i = 0; i < 3; i++) await p.keyboard.press('Space');
  await p.waitForTimeout(900);
  await p.screenshot({ path: OUT + '/s5-work-crown.png' });
  log('row card:', (await p.locator('.row-card').innerText()).replace(/\s+/g, ' '));
  log('linked:', (await p.locator('.linked').innerText()).replace(/\s+/g, ' '));

  // 6) 아이폰 스튜디오
  const ph = await b.newContext({ ...devices['iPhone 13'], locale: 'ko-KR' });
  const pp = await ph.newPage();
  pp.on('pageerror', (e) => errs.push('phone ' + e.message));
  await pp.goto(B + `/studio/${beanie.id}`);
  await pp.locator('.preview-wrap canvas').waitFor();
  await pp.waitForTimeout(700);
  await pp.screenshot({ path: OUT + '/s6-iphone-studio.png' });
  log('iphone scrollWidth', await pp.evaluate(() => document.documentElement.scrollWidth));
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await b.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
