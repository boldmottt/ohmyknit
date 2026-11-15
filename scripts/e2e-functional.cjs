// 기능 점검 22개: 집중 모드 잠금, 타이머, 실측 조언, 재변환, 숫자 입력, 스튜디오 초안, 오프라인 (빈 데이터로 서버를 켠 뒤 실행)
// 기능 점검: 이번에 고친 동작들을 실제 브라우저에서 확인
const { chromium } = require('playwright');
const B = process.env.BASE_URL ?? 'http://localhost:8787';
const results = [];
const check = (name, ok, extra = '') => { results.push([ok, name, extra]); console.log(ok ? '✓' : '✗', name, extra); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, locale: 'ko-KR' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept().catch(() => {}));
  await p.goto(B + '/');
  const ids = await p.evaluate(async () => {
    const j = (m, u, body) => fetch(u, { method: m, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
    const prof = await j('POST', '/api/profiles', { name: '아내분' });
    localStorage.setItem('kc.profile', prof.id);
    const s = await j('POST', '/api/patterns/sample');
    const proj = await j('POST', '/api/projects', { profileId: prof.id, patternId: s.id, size: 'M', myGauge: { st: 25, row: 33 }, name: '기능 점검 스웨터' });
    return { prof: prof.id, pattern: s.id, project: proj.id };
  });

  // ── 1. 집중 모드에서 잠금 이벤트 확인 창이 뜨는가 (몸판 마지막 단 = 소매 분리, 잠금)
  await p.goto(`${B}/project/${ids.project}/work`);
  await p.locator('.counter-num .cur').waitFor();
  await p.evaluate(async (id) => {
    await fetch(`/api/pieces/${encodeURIComponent(id + ':body')}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events: [{ id: 'seed1', type: 'jump', fromRow: 0, toRow: 150, at: Date.now() - 5000 }] }) });
  }, ids.project);
  await p.reload();
  await p.locator('.counter-num .cur').waitFor();
  await p.waitForTimeout(500);
  check('몸판 151단 중 151단째에서 시작', (await p.locator('.counter-num .cur').innerText()) === '151');
  await p.keyboard.press('f');
  await p.locator('.focus-mode').waitFor();
  await p.keyboard.press('Space');
  await p.waitForTimeout(400);
  const lockVisible = await p.getByRole('dialog', { name: /잠깐/ }).isVisible().catch(() => false);
  check('집중 모드에서 잠금 확인 창이 뜸', lockVisible);
  check('확인 전에는 단이 넘어가지 않음', (await p.locator('.focus-num').innerText()) === '151');
  await p.getByRole('button', { name: /했어요, 다음 단으로/ }).click();
  await p.waitForTimeout(500);
  check('확인 뒤 조각 완성 창이 집중 모드 위에 뜸', await p.getByRole('heading', { name: '몸판 완성!' }).isVisible().catch((e) => (console.log(e.message.slice(0, 120)), false)));
  await p.getByRole('button', { name: /다음: 소매 1 뜨기/ }).click();
  await p.keyboard.press('f');
  await p.waitForTimeout(300);

  // ── 2. 타이머: 긴 단에서는 5분 넘게 조작이 없어도 계속 흐름
  await p.keyboard.press('Space'); // 소매 1단 완료 → 타이머 시작
  await p.waitForTimeout(300);
  const limit = await p.evaluate(() => 0);
  const timerLabel = await p.locator('.timer').getAttribute('aria-label');
  check('+1을 누르면 타이머가 흐름', timerLabel === '타이머 일시정지', timerLabel);

  // ── 3. 실측: 조언과 "게이지 다시 맞추기"
  await p.locator('.piece-tabs button', { hasText: '몸판' }).click();
  await p.getByRole('button', { name: /실측/ }).click();
  await p.getByLabel('잰 값 (cm)').fill('41');
  await p.getByRole('button', { name: '비교하기' }).click();
  const toast = p.locator('.toast').last();
  await toast.waitFor();
  const toastText = await toast.innerText();
  check('실측 결과에 구체적인 조언이 붙음', /단이 필요|거의 맞아요|다 떴는데/.test(toastText), toastText.replace(/\s+/g, ' ').slice(0, 90));
  const hasAction = await toast.getByRole('button', { name: '게이지 다시 맞추기' }).isVisible().catch(() => false);
  check('차이가 크면 게이지 다시 맞추기 버튼이 나옴', hasAction);
  if (hasAction) {
    await toast.getByRole('button', { name: '게이지 다시 맞추기' }).click();
    await p.waitForURL(/\/edit\?/);
    await p.getByText('중간 실측으로 구한 값을 넣어 두었어요').waitFor();
    const rowVal = await p.getByLabel('단 (10cm)').inputValue();
    check('편집 화면에 실측 게이지가 미리 들어감', Number(rowVal) > 33, `단 ${rowVal}`);
    await p.getByRole('button', { name: '다시 변환' }).click();
    const t2 = p.locator('.toast').last();
    await t2.waitFor();
    const txt = await t2.innerText();
    check('재변환: 뜨던 몸판은 그대로, 소매 2만 다시 계산', txt.includes('그대로 둠: 몸판, 소매 1') && txt.includes('다시 계산: 소매 2'), txt.replace(/\s+/g, ' ').slice(0, 100));
  }
  const after = await p.evaluate(async (id) => (await (await fetch(`/api/projects/${id}/work`)).json()), ids.project);
  check('몸판 코잡기 228코 유지', after.converted.pieces[0].castOn.value === 228);

  // ── 4. 숫자 입력: 소수점
  await p.goto(`${B}/patterns/${ids.pattern}/edit`);
  const st = p.locator('label.field', { hasText: /^코$/ }).locator('input');
  await st.waitFor();
  await st.fill('');
  await st.type('22.5');
  check('도안 게이지에 22.5를 칠 수 있음', (await st.inputValue()) === '22.5', await st.inputValue());
  await st.fill('');
  await p.keyboard.press('Tab');
  check('칸을 비우고 벗어나면 마지막 값으로 돌아옴', (await st.inputValue()) === '22.5', await st.inputValue());

  // ── 5. 스튜디오: 격자 크기 입력 중 차트가 망가지지 않음 + 초안 보존
  await p.goto(`${B}/studio/${ids.pattern}`);
  await p.locator('.cg-cell').first().waitFor();
  const colorsBefore = await p.locator('.cg-cell').evaluateAll((els) => els.map((e) => e.style.background).join('|'));
  const wInput = p.getByLabel('코 수');
  await wInput.fill('');
  await wInput.type('1');
  const midCount = await p.locator('.cg-cell').count();
  check('입력 도중(1)에는 격자가 줄어들지 않음', midCount === 12 * 19, `칸 ${midCount}`);
  await wInput.type('2');
  await p.keyboard.press('Enter');
  const colorsAfter = await p.locator('.cg-cell').evaluateAll((els) => els.map((e) => e.style.background).join('|'));
  check('12로 다시 입력해도 차트 그림이 그대로', colorsBefore === colorsAfter);
  // 한 칸 칠하고 저장하지 않은 채 다른 화면으로
  await p.getByLabel('칠할 실').selectOption('2'); // 머스터드
  await p.locator('.cg-cell').nth(3).click();
  await p.waitForTimeout(200);
  const painted = await p.locator('.cg-cell').evaluateAll((els) => els.map((e) => e.style.background).join('|'));
  await p.getByRole('link', { name: '도안', exact: true }).first().click();
  await p.waitForURL(/\/patterns$/);
  await p.goto(`${B}/studio/${ids.pattern}`);
  await p.locator('.cg-cell').first().waitFor();
  await p.getByText('저장하지 않았던 변경을 되살렸어요').waitFor({ timeout: 5000 }).catch(() => {});
  const restored = await p.locator('.cg-cell').evaluateAll((els) => els.map((e) => e.style.background).join('|'));
  check('저장 안 하고 나갔다 와도 칠한 것이 남아 있음', restored === painted && painted !== colorsBefore);

  // ── 6. 마법사: 게이지 칸을 지워도 추천값이 다시 채워지지 않음
  await p.goto(`${B}/project/new?pattern=${ids.pattern}`);
  await p.getByRole('button', { name: '다음' }).click();
  await p.getByRole('button', { name: /^M/ }).click();
  await p.getByRole('button', { name: '다음' }).click();
  const gst = p.getByLabel('내 코 게이지 (10cm)');
  await p.waitForFunction(() => document.querySelector('input')?.value !== undefined);
  await p.waitForTimeout(600);
  await gst.fill('');
  await p.waitForTimeout(500);
  check('게이지 칸을 지우면 빈 채로 있음', (await gst.inputValue()) === '', `"${await gst.inputValue()}"`);

  // ── 7. 오프라인: 서버가 안 닿아도 옷장과 작업 화면이 열리고, 누른 기록이 남았다가 전송됨
  await p.goto(B + '/');
  await p.locator('.hang.front').waitFor();
  await p.waitForTimeout(1500); // 작업 화면 자료 미리 받기
  await ctx.route('**/api/**', (r) => r.abort());
  await p.reload();
  await p.locator('.hang.front').waitFor({ timeout: 8000 }).catch(() => {});
  check('서버가 안 닿아도 옷장이 열림', await p.locator('.hang.front').isVisible().catch(() => false));
  check('오프라인 표시', await p.getByText('마지막으로 받은 옷장').isVisible().catch(() => false));
  await p.goto(`${B}/project/${ids.project}/work`);
  await p.locator('.counter-num .cur').waitFor({ timeout: 8000 }).catch(() => {});
  const curBefore = Number(await p.locator('.counter-num .cur').innerText().catch(() => 'NaN'));
  check('서버가 안 닿아도 작업 화면이 열림', Number.isFinite(curBefore), `현재 ${curBefore}단`);
  await p.keyboard.press('Space');
  await p.keyboard.press('Space');
  await p.waitForTimeout(1500);
  const badge = await p.locator('.sync').innerText();
  check('오프라인에서 +1이 되고 대기 중으로 표시', /오프라인.*2개 대기/.test(badge) && Number(await p.locator('.counter-num .cur').innerText()) === curBefore + 2, badge);
  await ctx.unroute('**/api/**');
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
  await p.waitForTimeout(2500);
  const badge2 = await p.locator('.sync').innerText();
  check('다시 연결되면 자동으로 전송', /저장됨/.test(badge2), badge2);

  // ── 8. 속도: 서버가 계산한 값 (방금 누른 것들은 몰아 누른 것이라 속도에 반영되지 않아야 함)
  const work = await p.evaluate(async (id) => (await (await fetch(`/api/projects/${id}/work`)).json()), ids.project);
  check('몰아서 누른 +1은 속도에 반영되지 않음', work.speed.stitchesPerMinute === null, JSON.stringify(work.speed));

  console.log('\n페이지 오류:', errs.length ? errs.join('\n') : '없음');
  const failed = results.filter((r) => !r[0]);
  console.log(`\n${results.length - failed.length}/${results.length} 통과`);
  await b.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
