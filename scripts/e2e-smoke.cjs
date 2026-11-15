// 끝에서 끝까지 동작 확인 (Playwright 필요: npm i -g playwright && npx playwright install chromium)
// 빈 데이터로 서버를 켠 뒤: node scripts/e2e-smoke.cjs
const { chromium, devices } = require('playwright');
const OUT = process.env.OUT_DIR ?? require('node:os').tmpdir();
const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const log = (...a) => console.log('▶', ...a);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'ko-KR' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));

  // 1. 옷장: 네임태그 만들고 열기
  await page.goto(BASE + '/');
  await page.getByText('네임태그를 걸어 옷장을 시작해요').waitFor();
  await page.screenshot({ path: OUT + '/01-closet-empty.png' });
  await page.getByRole('button', { name: '+ 네임태그' }).click();
  await page.getByPlaceholder('이름').fill('아내분');
  await page.getByRole('button', { name: '걸기' }).click();
  await page.getByRole('button', { name: /아내분/ }).click({ force: true });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: OUT + '/02-closet-open-empty.png' });
  log('closet opened');

  // 2. 마법사
  await page.getByRole('button', { name: '새 프로젝트 걸기' }).click();
  await page.getByRole('button', { name: /샘플 도안 추가/ }).click();
  await page.getByRole('button', { name: /겨울 페어아일 요크 스웨터/ }).waitFor();
  await page.getByRole('button', { name: '다음' }).click();
  await page.getByRole('button', { name: /^M/ }).click();
  await page.getByRole('button', { name: '다음' }).click();
  await page.getByLabel('내 코 게이지 (10cm)').fill('25');
  await page.getByLabel('내 단 게이지 (10cm)').fill('33');
  await page.getByText(/228코/).first().waitFor({ timeout: 10000 });
  await page.screenshot({ path: OUT + '/03-wizard-gauge.png', fullPage: true });
  log('wizard preview shows 228');
  await page.getByRole('button', { name: '다음' }).click();
  await page.getByRole('button', { name: '옷장에 걸기' }).click();
  await page.getByRole('button', { name: '바로 시작하기' }).click();

  // 3. 작업 화면
  await page.locator('.counter-num .cur').waitFor();
  await page.waitForTimeout(900);
  await page.screenshot({ path: OUT + '/04-work-start.png' });
  const castOn = await page.locator('.cast-on').innerText();
  log('cast on card:', castOn.replace(/\s+/g, ' '));
  for (let i = 0; i < 5; i++) await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  let cur = await page.locator('.counter-num .cur').innerText();
  log('counter after 5×Space =', cur);
  if (cur !== '6') throw new Error('counter mismatch ' + cur);
  await page.keyboard.press('ArrowDown');
  cur = await page.locator('.counter-num .cur').innerText();
  log('after ArrowDown =', cur);
  await page.keyboard.press('ArrowUp');

  // 몸통 → 배색 구간으로 점프 (차트 보기)
  await page.getByRole('tab', { name: '지시문' }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /배색 무늬/ }).click();
  await page.waitForTimeout(500);
  await page.getByRole('tab', { name: '차트' }).click();
  // 차트 4단째로
  for (let i = 0; i < 4; i++) await page.keyboard.press('Space');
  await page.waitForTimeout(900);
  await page.screenshot({ path: OUT + '/05-work-chart.png' });
  log('row card:', (await page.locator('.row-card').innerText()).replace(/\s+/g, ' '));

  // 비교 모드
  await page.keyboard.press('c');
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + '/06-work-compare.png' });
  await page.keyboard.press('c');

  // 소매로 이동 → 잠금 이벤트 확인
  await page.locator('.piece-tabs button', { hasText: '소매 1' }).click();
  await page.getByRole('tab', { name: '지시문' }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /소매 몸통/ }).click();
  await page.waitForTimeout(300);
  log('sleeve upcoming:', (await page.locator('.upcoming').innerText()).replace(/\s+/g, ' ').slice(0, 160));
  await page.screenshot({ path: OUT + '/07-work-sleeve.png' });

  // 집중 모드
  await page.keyboard.press('f');
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '/08-focus.png' });
  const before = await page.locator('.focus-num').innerText();
  await page.mouse.click(700, 500);
  await page.waitForTimeout(300);
  const after = await page.locator('.focus-num').innerText();
  log('focus tap', before, '→', after);
  await page.mouse.click(700, 500); // 1.5초 안 → 무시돼야 함
  await page.waitForTimeout(200);
  log('focus quick second tap ->', await page.locator('.focus-num').innerText());
  await page.keyboard.press('f');

  // 동기화 확인 후 새로고침 → 유지
  await page.waitForTimeout(1500);
  log('sync badge:', await page.locator('.sync').innerText());
  await page.reload();
  await page.locator('.counter-num .cur').waitFor();
  await page.waitForTimeout(600);
  log('after reload active piece:', await page.locator('.piece-tabs button[aria-pressed=true]').innerText(), 'row', await page.locator('.counter-num .cur').innerText());

  // 옷장으로 돌아가기
  await page.getByRole('button', { name: '← 옷장으로' }).click();
  await page.waitForURL(BASE + '/');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUT + '/09-closet-with-garment.png' });
  await page.locator('.hang.front').waitFor();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUT + '/10-closet-detail.png' });
  log('detail:', (await page.locator('.detail').innerText()).replace(/\s+/g, ' ').slice(0, 200));

  // 도안 편집기
  await page.goto(BASE + '/patterns');
  await page.getByRole('link', { name: '수정' }).first().click();
  await page.getByText('🎨 배색 차트').first().waitFor();
  await page.screenshot({ path: OUT + '/11-pattern-edit.png' });

  // 내 손
  await page.goto(BASE + '/profile/hands');
  await page.getByText('스와치 기록').first().waitFor();
  await page.screenshot({ path: OUT + '/12-hands.png' });

  // 아이폰
  const phone = await browser.newContext({ ...devices['iPhone 13'], locale: 'ko-KR' });
  const pp = await phone.newPage();
  pp.on('pageerror', (e) => errors.push('phone pageerror: ' + e.message));
  await pp.goto(BASE + '/');
  await pp.evaluate(async () => {
    const ps = await (await fetch('/api/profiles')).json();
    localStorage.setItem('kc.profile', ps[0].id);
  });
  const projects = await pp.evaluate(async () => {
    const ps = await (await fetch('/api/profiles')).json();
    return (await (await fetch(`/api/profiles/${ps[0].id}/projects`)).json()).map((p) => p.id);
  });
  await pp.goto(BASE + `/project/${projects[0]}/work`);
  await pp.locator('.counter-num .cur').waitFor();
  await pp.waitForTimeout(900);
  await pp.screenshot({ path: OUT + '/13-iphone-work.png' });
  const scrollW = await pp.evaluate(() => document.documentElement.scrollWidth);
  log('iphone scrollWidth', scrollW, 'viewport', pp.viewportSize().width);
  await pp.goto(BASE + '/');
  await pp.locator('.hang.front').waitFor();
  await pp.waitForTimeout(2000);
  await pp.screenshot({ path: OUT + '/14-iphone-closet.png' });

  // 다크 모드 작업 화면
  const dark = await browser.newContext({ viewport: { width: 1180, height: 820 }, colorScheme: 'dark', locale: 'ko-KR' });
  const dp = await dark.newPage();
  await dp.goto(BASE + '/');
  await dp.evaluate(async () => {
    const ps = await (await fetch('/api/profiles')).json();
    localStorage.setItem('kc.profile', ps[0].id);
  });
  await dp.goto(BASE + `/project/${projects[0]}/work`);
  await dp.locator('.counter-num .cur').waitFor();
  await dp.waitForTimeout(900);
  await dp.screenshot({ path: OUT + '/15-ipad-dark-work.png' });

  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
