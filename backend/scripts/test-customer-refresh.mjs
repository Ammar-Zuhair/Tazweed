import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../..', import.meta.url));
const output = `${root}/backend/docs/progress/customer-ui-refresh-evidence`;
await mkdir(output, { recursive: true });
const hash = createHash('sha256');
for (const path of execFileSync('git', ['ls-files', '-co', '--exclude-standard', '--', 'customer-app/src', 'customer-app/integration'], { cwd: root, encoding: 'utf8' }).trim().split('\n').sort()) hash.update(path).update(await readFile(`${root}/${path}`));
const results = { checkedAt: new Date().toISOString(), sourceFingerprint: hash.digest('hex'), nativeDeviceTested: false, runs: [] };
const selected = process.env.TAZWEED_REFRESH_RUNS;
if (selected && !/^[0-5](?:,[0-5])*$/.test(selected)) throw new Error('Invalid UI run selection');
if (selected) {
  const prior = await readFile(`${output}/browser-results.json`, 'utf8').then(JSON.parse).catch(() => null);
  if (prior?.sourceFingerprint === results.sourceFingerprint) results.runs = prior.runs;
}
const browser = await chromium.launch({ headless: true });
try {
  for (const [runIndex, [width, theme]] of [[360, 'light'], [360, 'dark'], [390, 'light'], [390, 'dark'], [1024, 'light'], [1024, 'dark']].entries()) {
    if (selected && !selected.split(',').includes(String(runIndex))) continue;
    const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce', colorScheme: theme });
    const page = await context.newPage(); page.setDefaultTimeout(12000); const errors = [], external = [], checks = [];
    page.on('pageerror', error => errors.push(error.message)); page.on('request', req => { if (!req.url().startsWith('http://127.0.0.1:8081') && !/^(data:|blob:)/.test(req.url())) external.push(req.url()); });
    const button = name => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
    const active = id => page.locator(`[data-testid="${id}"]:not([aria-hidden="true"] *)`).filter({ visible: true }).first();
    const clear = async () => { const toast = button('إغلاق التنبيه'); if (await toast.isVisible()) { try { await toast.click({ timeout: 2000 }); } catch { await toast.waitFor({ state: 'hidden', timeout: 8000 }); } } };
    const click = async name => { await clear(); await button(name).click(); };
    const home = async () => { await clear(); if (await button('الرئيسية').isVisible()) await button('الرئيسية').click(); else await page.getByRole('tab', { name: 'الرئيسية', exact: true }).filter({ visible: true }).click(); await active('home-popular').waitFor(); };
    const shot = async name => { await clear(); await page.waitForTimeout(180); await page.getByTestId('catalog-loading').filter({ visible: true }).waitFor({ state: 'hidden' }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal page overflow'); await page.screenshot({ path: `${output}/${name}-${theme}-${width}.png` }); };
    const card = id => active(`product-card-${id}`);
    const quantity = (id, unit = 'حبة', name = 'زيت محرك مدار 15W-40') => card(id).getByRole('textbox', { name: `كمية ${unit} ${name}`, exact: true });
    console.log('RUN', theme, width);
    await page.goto('http://127.0.0.1:8081'); await click('عدن'); await active('promotions').waitFor(); await active(`theme-${theme}`).waitFor();
    const positions = await Promise.all(['home-promotions', 'home-categories', 'home-popular'].map(id => active(id).evaluate(el => el.getBoundingClientRect().top)));
    assert(positions[0] < positions[1] && positions[1] < positions[2]);
    assert.equal(await active('orange-backdrop').evaluate(el => getComputedStyle(el).pointerEvents), 'none');
    await shot('home');
    const scroll = active('promotions').locator('div').filter({ visible: true });
    const carousel = await scroll.evaluateAll(els => els.findIndex(el => getComputedStyle(el).overflowX === 'auto' && el.scrollWidth > el.clientWidth));
    assert(carousel >= 0, 'horizontal scroll container exists'); const scroller = scroll.nth(carousel); const before = await scroller.evaluate(el => el.scrollLeft);
    await scroller.hover(); await page.mouse.wheel(-280, 0); await page.waitForTimeout(450); assert.notEqual(await scroller.evaluate(el => el.scrollLeft), before, 'RTL list responds to horizontal wheel/swipe equivalent');
    await click('العرض 3 من 3'); await page.waitForTimeout(400); await click('تسوّق البطاريات'); await page.getByRole('textbox', { name: 'البحث عن منتج', exact: true }).filter({ visible: true }).waitFor();
    await click('الفلاتر (0)'); await click('70 أمبير'); await click('قوة'); await click('تطبيق الفلاتر'); await card('battery-70').waitFor(); assert.equal(await card('battery-100').count(), 0); await shot('battery-filter');
    await home(); await click('العرض 1 من 3'); await page.waitForTimeout(350); await click('اكتشف العروض'); await page.getByText('أفضل توفير واحد', { exact: true }).filter({ visible: true }).waitFor(); await home();
    await click('العرض 2 من 3'); await page.waitForTimeout(350); await click('تسوّق الزيوت'); await card('oil-15').waitFor();
    await click('الفلاتر (0)'); await click('مدار'); await click('15W-40'); await click('تطبيق الفلاتر'); await card('oil-15').waitFor(); assert.equal(await card('oil-20').count(), 0);
    const search = page.getByRole('textbox', { name: 'البحث عن منتج', exact: true }).filter({ visible: true }); await search.fill('DEMO-OIL-15'); await card('oil-15').waitFor(); await shot('oils-filter'); await search.fill(''); await page.waitForTimeout(180); await card('oil-15').waitFor();
    await click('البطاريات'); await card('battery-70').waitFor();
    await home(); await click('تصفح الزيوت'); await card('oil-15').waitFor(); assert.equal(await card('battery-70').count(), 0); await button('الفلاتر (0)').waitFor();
    checks.push('home order / decorative backdrop / RTL horizontal scrolling / three promotion destinations / battery brand+capacity / oil brand+viscosity+search / catalog category switch then home link returns to requested category');
    await card('oil-15').getByRole('button', { name: 'طلب', exact: true }).click(); assert.equal(new URL(page.url()).pathname, '/categories');
    await quantity('oil-15').fill('٣'); await card('oil-15').getByText('في السلة: 3 حبة', { exact: true }).waitFor();
    await quantity('oil-15').fill(''); await card('oil-15').getByText('في السلة: 3 حبة', { exact: true }).waitFor();
    for (const invalid of ['-1', '1.5', '1000']) { await quantity('oil-15').fill(invalid); await card('oil-15').getByRole('alert').waitFor(); assert.match(await card('oil-15').innerText(), /في السلة: 3 حبة/); }
    await quantity('oil-15').fill('999'); assert(await card('oil-15').getByRole('button', { name: 'زيادة كمية حبة زيت محرك مدار 15W-40', exact: true }).isDisabled()); await quantity('oil-15').fill('3');
    await card('oil-15').getByRole('button', { name: 'كرتون', exact: true }).click(); assert.match(await card('oil-15').innerText(), /25,200/); await card('oil-15').getByRole('button', { name: 'طلب', exact: true }).click(); await quantity('oil-15', 'كرتون').fill('٢');
    await card('oil-15').getByRole('button', { name: 'حبة', exact: true }).click(); assert.equal(await quantity('oil-15').inputValue(), '3');
    await click('تفاصيل زيت محرك مدار 15W-40'); const detailQuantity = page.getByRole('textbox', { name: 'الكمية', exact: true }).filter({ visible: true }); assert.equal(await detailQuantity.inputValue(), '3');
    await detailQuantity.fill(''); assert(await button('تحديث الكمية').isDisabled()); await detailQuantity.fill('٥'); await click('تحديث الكمية'); await clear(); await shot('product-quantity');
    await click('كرتون'); assert.equal(await detailQuantity.inputValue(), '2'); await detailQuantity.fill('6'); await click('تحديث الكمية'); await click('السلة · 11 وحدة'); await page.getByText('حبة · يعادل 5 حبة · متوفر', { exact: true }).filter({ visible: true }).waitFor(); await page.getByText('كرتون · يعادل 72 حبة · متوفر', { exact: true }).filter({ visible: true }).waitFor(); await shot('cart');
    await home(); await card('oil-15').waitFor(); await card('oil-15').scrollIntoViewIfNeeded(); await shot('popular'); await quantity('oil-15').fill('1'); await card('oil-15').getByRole('button', { name: 'إنقاص كمية حبة زيت محرك مدار 15W-40', exact: true }).click(); assert.match(await card('oil-15').innerText(), /في السلة: 6 كرتون/);
    await card('oil-15').getByRole('button', { name: 'كرتون', exact: true }).click(); await quantity('oil-15', 'كرتون').fill('1'); await card('oil-15').getByRole('button', { name: 'إنقاص كمية كرتون زيت محرك مدار 15W-40', exact: true }).click(); assert.equal(await card('oil-15').getByText(/في السلة/).count(), 0);
    checks.push('direct order stays in catalog / editable Arabic quantity / invalid text leaves cart unchanged / max999 / separate piece+carton prices and quantities / detail3→5 replaces / cart sync / zero removes selected unit');
    const boxes = await active('product-grid').locator('[data-testid^="product-card-"]').evaluateAll(els => els.map(el => ({ x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y, width: el.getBoundingClientRect().width })));
    const firstRow = boxes.filter(box => Math.abs(box.y - boxes[0].y) < 2); assert.equal(firstRow.length, width < 390 ? 1 : width < 768 ? 2 : 3);
    for (const [name, id] of [['الزيوت', 'oil-15'], ['البطاريات', 'battery-70'], ['الإطارات', 'tire-16'], ['الطاقة الشمسية', 'solar-150'], ['الفلاتر', 'filter-air'], ['الرقع', 'patch-small']]) {
      await home(); await click(`تصفح ${name}`); await card(id).waitFor(); await button('الفلاتر (0)').waitFor();
    }
    await home(); await click('التوصيل إلى عدن'); await click('صنعاء'); await active('product-grid').waitFor(); assert.equal(await active('product-grid').locator('[data-testid^="product-card-"]').first().getAttribute('data-testid'), 'product-card-battery-100');
    await click('تصفح الزيوت'); await card('oil-20').waitFor(); await card('oil-20').getByRole('button', { name: 'طلب', exact: true }).click(); await quantity('oil-20', 'حبة', 'زيت محرك قوة 20W-50').fill('3');
    await home(); await click('التوصيل إلى صنعاء'); await click('عدن'); await click('تصفح الزيوت'); await card('oil-20').waitFor();
    assert(await card('oil-20').getByRole('button', { name: 'زيادة كمية حبة زيت محرك قوة 20W-50', exact: true }).isDisabled());
    await quantity('oil-20', 'حبة', 'زيت محرك قوة 20W-50').fill('4'); await card('oil-20').getByRole('alert').waitFor(); assert.match(await card('oil-20').innerText(), /في السلة: 3 حبة/);
    await quantity('oil-20', 'حبة', 'زيت محرك قوة 20W-50').fill('1'); await card('oil-20').getByRole('button', { name: 'إنقاص كمية حبة زيت محرك قوة 20W-50', exact: true }).click(); assert(await card('oil-20').getByRole('button', { name: 'طلب', exact: true }).isDisabled());
    await shot('unavailable'); checks.push('responsive columns1/2/3 / six category links reset filters / governorate-specific daily ranking / unavailable blocks new/increased quantity, allows reduction/removal');
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    await writeFile(`${output}/run-${theme}-${width}.json`, JSON.stringify({ sourceFingerprint: results.sourceFingerprint, width, theme, passed: true, checks, runtimeErrors: errors, externalRequests: external }, null, 2) + '\n');
    results.runs = (await Promise.all([[360, 'light'], [360, 'dark'], [390, 'light'], [390, 'dark'], [1024, 'light'], [1024, 'dark']].map(async ([w, t]) => readFile(`${output}/run-${t}-${w}.json`, 'utf8').then(JSON.parse).catch(() => null)))).filter(run => run?.sourceFingerprint === results.sourceFingerprint);
    await writeFile(`${output}/browser-results.json`, JSON.stringify(results, null, 2) + '\n'); await context.close(); console.log('PASS', theme, width);
  }
} catch (error) {
  const page = browser.contexts().flatMap(context => context.pages()).at(-1);
  if (page) { await page.screenshot({ path: `${output}/failure.png` }); await writeFile(`${output}/failure-dom.txt`, await page.locator('body').innerText()); }
  throw error;
} finally { await browser.close(); }
