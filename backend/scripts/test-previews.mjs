import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = fileURLToPath(new URL('../..', import.meta.url));
const prefix = process.env.PHASE01_EVIDENCE_PREFIX ?? 'phase-02';
if (!/^phase-0[12](?:-[a-z0-9]+)*$/.test(prefix)) throw new Error('Invalid evidence prefix');
const evidence = resolve(workspace, `backend/docs/progress/${prefix}-evidence`);
await mkdir(evidence, { recursive: true });
const results = { checkedAt: new Date().toISOString(), viewport: { width: 390, height: 844 }, platform: 'Chromium / Expo web export; not a native-device test', checks: [] };
const browser = await chromium.launch({ headless: true });
const home = async page => { await page.getByTestId('state-ready').waitFor(); await page.getByTestId('fake-label').waitFor(); };
try {
  for (const [index, role] of ['customer', 'admin', 'courier'].entries()) {
    if (role === 'customer') continue; // Business journey is covered by test-customer-phase02.mjs.
    const origin = `http://127.0.0.1:${8081 + index}`;
    const context = await browser.newContext({ viewport: results.viewport, colorScheme: 'light', reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = []; const requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    const openedAt = Date.now();
    await page.goto(origin);
    await home(page);
    const startupMs = Date.now() - openedAt;
    if (role === 'customer') assert(startupMs < 4000, 'reduced motion must skip the 4.75s intro timeout');
    assert.equal(await page.locator('html').getAttribute('lang'), 'ar');
    assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
    assert.equal(await page.getByTestId('theme-light').evaluate(element => getComputedStyle(element).direction), 'rtl');
    const font = await page.getByTestId('fake-label').evaluate(element => ({ font: getComputedStyle(element).fontFamily, loaded: document.fonts.check('16px "Tajawal-Regular"') }));
    assert.match(font.font, /Tajawal-Regular/); assert(font.loaded);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile horizontal overflow');
    await page.screenshot({ path: resolve(evidence, `${role}-light.png`), fullPage: true });
    await page.getByRole('tab', { name: 'الإعدادات' }).click();
    await page.getByRole('radio', { name: 'الوضع المظلم', exact: true }).click();
    await page.getByTestId('theme-dark').filter({ visible: true }).first().waitFor();
    await page.reload(); await page.getByTestId('theme-dark').filter({ visible: true }).first().waitFor();
    await page.getByRole('radio', { name: 'الوضع المظلم', exact: true }).waitFor();
    assert.equal(await page.getByRole('radio', { name: 'الوضع المظلم', exact: true }).getAttribute('aria-checked'), 'true');
    await page.getByRole('tab', { name: 'الرئيسية' }).click(); await home(page);
    await page.screenshot({ path: resolve(evidence, `${role}-dark.png`), fullPage: true });
    await page.getByRole('button', { name: 'تعرّف على تزويد', exact: true }).click();
    await page.getByRole('button', { name: 'معاينة خطأ', exact: true }).click();
    await page.getByTestId('state-error').waitFor();
    await page.getByRole('button', { name: 'إعادة المحاولة', exact: true }).click(); await home(page);
    await page.getByRole('button', { name: 'تعرّف على تزويد', exact: true }).click();
    await page.getByRole('button', { name: 'معاينة فارغ', exact: true }).click();
    await page.getByTestId('state-empty').waitFor();
    await page.getByRole('button', { name: 'عرض المعاينة', exact: true }).click(); await home(page);
    await page.getByRole('button', { name: 'تعرّف على تزويد', exact: true }).click();
    await page.getByRole('button', { name: 'معاينة تحميل', exact: true }).click();
    await page.getByTestId('state-loading').waitFor(); await home(page);
    await page.getByRole('tab', { name: 'الإعدادات' }).click();
    await page.getByRole('radio', { name: 'حسب الجهاز', exact: true }).click();
    await page.emulateMedia({ colorScheme: 'light' }); await page.getByTestId('theme-light').filter({ visible: true }).first().waitFor();
    await page.emulateMedia({ colorScheme: 'dark' }); await page.getByTestId('theme-dark').filter({ visible: true }).first().waitFor();
    assert.equal(await page.getByRole('radio', { name: 'حسب الجهاز', exact: true }).getAttribute('aria-checked'), 'true');
    // Tablet width uses the same layout without overflow.
    await page.setViewportSize({ width: 1024, height: 768 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'tablet overflow');
    assert.deepEqual(errors, [], `${role} browser runtime errors`);
    if (role !== 'customer') assert.equal(requests.some(url => /\.mp4/.test(url)), false);
    assert.equal(requests.some(url => !url.startsWith(origin)), false, 'no third-party data/font/service requests');
    results.checks.push({ role, passed: true, startupMs, checks: ['Arabic/RTL', 'local Tajawal loaded', 'light/dark', 'saved preference after reload', 'system theme changes', 'navigation', 'loading/empty/error/retry', '390px/1024px no overflow', 'no external services', 'no page errors'], font });
    await context.close();
  }
  // Normal motion: one intro per cold start; navigation and background cannot replay it.
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: results.viewport, colorScheme: theme, reducedMotion: 'no-preference' });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:8081');
    const skip = page.getByRole('button', { name: 'تخطي الافتتاحية', exact: true });
    await skip.waitFor();
    const video = page.locator('video');
    await video.waitFor();
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    const media = await video.evaluate(element => ({ source: element.currentSrc, duration: element.duration, paused: element.paused, currentTime: element.currentTime, muted: element.muted, volume: element.volume }));
    assert(media.source.includes(`intro-${theme}`), 'intro follows startup theme');
    assert(Number.isFinite(media.duration) && media.duration >= 3.9 && media.duration <= 4.1);
    assert.equal(media.muted, false); assert.equal(media.volume, 0.45);
    // Capture the live frame without seeking past the application's fixed fail-open timer.
    await page.screenshot({ path: resolve(evidence, `customer-intro-${theme}.png`) });
    if (theme === 'light') await skip.click();
    // Dark also proves that a blocked autoplay/startup cannot trap the user beyond the timeout.
    await page.getByRole('button', { name: 'عدن', exact: true }).waitFor();
    await page.getByRole('tab', { name: 'حسابي' }).click();
    await page.getByRole('tab', { name: 'الرئيسية' }).click();
    assert.equal(await page.locator('video').count(), 0);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert.equal(await page.locator('video').count(), 0);
    assert.deepEqual(errors, []);
    results.checks.push({ role: `customer-intro-${theme}`, passed: true, media, checks: ['4 second local source loaded', 'sound not muted; audibility needs a device', theme === 'light' ? 'skip' : 'timeout/completion recovery', 'no navigation/focus replay'] });
    await context.close();
  }
  // Synthetic web lifecycle event; device background behavior remains a manual check.
  const backgroundContext = await browser.newContext({ viewport: results.viewport, reducedMotion: 'no-preference' });
  const backgroundPage = await backgroundContext.newPage();
  await backgroundPage.goto('http://127.0.0.1:8081');
  await backgroundPage.getByRole('button', { name: 'تخطي الافتتاحية', exact: true }).waitFor();
  await backgroundPage.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await backgroundPage.getByRole('button', { name: 'عدن', exact: true }).waitFor({ timeout: 2000 });
  assert.equal(await backgroundPage.locator('video').count(), 0);
  results.checks.push({ role: 'customer-synthetic-background', passed: true });
  await backgroundContext.close();
  // A failed video request must still enter the app.
  const context = await browser.newContext({ viewport: results.viewport, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  await page.route('**/*.mp4', route => route.abort('failed'));
  await page.goto('http://127.0.0.1:8081'); await page.getByRole('button', { name: 'عدن', exact: true }).waitFor();
  results.checks.push({ role: 'customer-video-failure', passed: true });
  await context.close();
} finally { await browser.close(); }
results.passed = results.checks.every(check => check.passed);
await writeFile(resolve(evidence, `../${prefix}-preview-checks.json`), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
