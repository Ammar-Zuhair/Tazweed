import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../..', import.meta.url));
const output = `${root}/backend/docs/progress/typography-glow-evidence`;
await mkdir(output, { recursive: true });
const role = process.env.TAZWEED_TYPO_ROLE;
assert(['customer', 'admin'].includes(role), 'set TAZWEED_TYPO_ROLE=customer or admin');
const hash = createHash('sha256');
for (const file of execFileSync('git', ['ls-files', '-co', '--exclude-standard', '--', `${role}-app/src`, `${role}-app/integration`], { cwd: root, encoding: 'utf8' }).trim().split('\n').sort()) hash.update(file).update(await readFile(`${root}/${file}`));
const sourceFingerprint = hash.digest('hex');
const results = { checkedAt: new Date().toISOString(), role, sourceFingerprint, nativeDeviceTested: false, runs: [] };
const origin = `http://127.0.0.1:${role === 'customer' ? 8081 : 8082}`;
const browser = await chromium.launch({ headless: true });
try {
 for (const width of [360, 390, 1024]) for (const theme of ['light', 'dark']) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, reducedMotion: 'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(15000); const runtimeErrors = [], externalRequests = [], screens = [];
  page.on('pageerror', e => runtimeErrors.push(e.message)); page.on('request', r => { if (!r.url().startsWith(origin) && !/^(blob:|data:)/.test(r.url())) externalRequests.push(r.url()); });
  const button = name => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
  const current = () => page.locator(`[data-testid="theme-${theme}"]:not([aria-hidden="true"] *)`).filter({ visible: true }).last();
  const clear = async () => { const toast = button('إغلاق التنبيه'); if (await toast.isVisible()) { try { await toast.click({ timeout: 2000 }); } catch { await toast.waitFor({ state: 'hidden', timeout: 8000 }); } } };
  const click = async name => { await clear(); await button(name).click(); };
  const tab = async name => { await clear(); await page.getByRole('tab', { name, exact: true }).filter({ visible: true }).click(); await page.waitForTimeout(250); };
  const card = id => page.locator(`[data-testid="product-card-${id}"]:not([aria-hidden="true"] *)`).filter({ visible: true }).first();
  const audit = async name => {
   await clear(); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(150);
   const modal = page.locator('[aria-modal="true"]').filter({ visible: true }).last();
   const scope = await modal.count() ? modal : current();
   const metrics = await scope.evaluate(root => {
    const rect = e => { const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height }; };
    const visible = e => !e.closest('[aria-hidden="true"]') && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
    const texts = [...root.querySelectorAll('*')].filter(e => !e.children.length && e.textContent.trim() && !e.closest('svg') && visible(e) && getComputedStyle(e).fontFamily.includes('Tajawal'));
    const clipped = texts.filter(e => getComputedStyle(e).textOverflow !== 'ellipsis' && !Number.parseInt(getComputedStyle(e).webkitLineClamp) && (e.scrollWidth > e.clientWidth + 2 || e.scrollHeight > e.clientHeight + 2)).map(e => ({ text: e.textContent.slice(0, 70), scroll: [e.scrollWidth, e.scrollHeight], client: [e.clientWidth, e.clientHeight] }));
    const inputs = [...root.querySelectorAll('input,textarea')].filter(visible).map(e => {
     const style = getComputedStyle(e), b = rect(e), label = e.previousElementSibling;
     return { label: e.getAttribute('aria-label'), size: parseFloat(style.fontSize), family: style.fontFamily, contentHeight: e.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom), lineHeight: parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2, labelOverlap: !!label && getComputedStyle(label).fontFamily.includes('Tajawal') && rect(label).bottom > b.top + 1 };
    });
    const buttonOverflow = [...root.querySelectorAll('[role="button"],[role="checkbox"],[role="tab"]')].filter(visible).flatMap(e => {
     const outer = rect(e);
     return texts.filter(t => e.contains(t)).filter(t => { const b = rect(t); return b.left < outer.left - 2 || b.right > outer.right + 2 || b.top < outer.top - 2 || b.bottom > outer.bottom + 2; }).map(t => ({ button: e.getAttribute('aria-label') || e.textContent.slice(0, 50), text: t.textContent.slice(0, 50) }));
    });
    return { minimumTextSize: Math.min(...texts.map(e => parseFloat(getComputedStyle(e).fontSize))), families: [...new Set(texts.map(e => getComputedStyle(e).fontFamily))], textCount: texts.length, clipped, inputs, buttonOverflow };
   });
   assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `page overflow ${role}/${name}/${width}`);
   assert(metrics.textCount > 0); assert(metrics.minimumTextSize >= 13, JSON.stringify({ role, name, metrics }));
   assert(metrics.families.every(f => /Tajawal-(Medium|Bold)/.test(f)), JSON.stringify(metrics.families));
   assert.deepEqual(metrics.clipped, [], `text clipped ${role}/${name}/${width}`);
   assert.deepEqual(metrics.buttonOverflow, [], `button text overflow ${role}/${name}/${width}`);
   assert(metrics.inputs.every(x => !x.labelOverlap && x.contentHeight + 2 >= x.lineHeight && x.size >= 17 && /Tajawal-(Medium|Bold)/.test(x.family)), JSON.stringify(metrics.inputs));
   await page.screenshot({ path: `${output}/${role}-${name}-${theme}-${width}.png` }); screens.push({ name, metrics });
  };
  console.log('RUN', role, theme, width);
  await page.goto(origin);
  if (role === 'customer') {
   await click('عدن'); await card('oil-15').waitFor(); await audit('home');
   const backdrop = page.getByTestId('orange-backdrop').filter({ visible: true }).first();
   assert.equal(await backdrop.evaluate(e => getComputedStyle(e).pointerEvents), 'none');
   assert(await backdrop.locator('radialGradient').count() >= 2);
   await card('oil-15').scrollIntoViewIfNeeded(); await audit('cards');
   await card('oil-15').getByRole('button', { name: 'طلب', exact: true }).click();
   await card('oil-15').getByRole('textbox').fill('٣'); await click('تفاصيل زيت محرك مدار 15W-40');
   const quantity = page.getByRole('textbox', { name: 'الكمية', exact: true }).filter({ visible: true });
   assert.equal(await quantity.inputValue(), '3'); await quantity.fill('5'); await click('تحديث الكمية'); await quantity.scrollIntoViewIfNeeded(); await audit('product');
   await click('السلة · 5 وحدة'); await page.getByRole('textbox', { name: 'الكمية', exact: true }).filter({ visible: true }).scrollIntoViewIfNeeded(); await audit('cart');
   await click('الرئيسية'); await click('تصفح الزيوت'); await click('الفلاتر (0)'); await audit('filters'); await click('إغلاق');
   await tab('حسابي'); await click('تسجيل الدخول'); const password = page.getByRole('textbox', { name: 'كلمة المرور', exact: true }).filter({ visible: true }); await password.fill('demo-pass'); await password.scrollIntoViewIfNeeded(); await audit('auth');
  } else {
   await page.getByRole('checkbox', { name: 'مدير المعاينة', exact: true }).click(); await audit('login');
   await click('متابعة إلى رمز التحقق'); await page.getByRole('textbox', { name: 'رمز التحقق', exact: true }).fill('000000'); await click('دخول لوحة الإدارة'); await page.getByRole('tab', { name: 'اللوحة', exact: true }).waitFor(); await audit('dashboard');
   for (const [title, image, focus] of [['المنتجات والوحدات', 'products', 'اسم المنتج *'], ['مخزون الفروع', 'inventory', 'عدد الكراتين'], ['الدفاتر المالية', 'finance'], ['الموظفون والأدوار', 'staff']]) {
    if (await button('العودة إلى لوحة الإدارة').isVisible()) { const before = page.url(); await click('العودة إلى لوحة الإدارة'); await page.waitForURL(url => url.href !== before); await page.waitForTimeout(300); }
    await tab('الأدوات'); await click(`فتح ${title}`); await button('العودة إلى لوحة الإدارة').waitFor();
    if (focus) await page.getByRole('textbox', { name: focus, exact: true }).filter({ visible: true }).scrollIntoViewIfNeeded(); await audit(image);
   }
  }
  assert.deepEqual(runtimeErrors, []); assert.deepEqual(externalRequests, []);
  results.runs.push({ theme, width, passed: true, screens, runtimeErrors, externalRequests });
  await writeFile(`${output}/${role}-results.json`, JSON.stringify(results, null, 2) + '\n'); console.log('PASS', role, theme, width); await context.close();
 }
} catch (error) {
 const page = browser.contexts().flatMap(c => c.pages()).at(-1);
 if (page) { await page.screenshot({ path: `${output}/${role}-failure.png` }); await writeFile(`${output}/${role}-failure-dom.txt`, await page.locator('body').innerText()); }
 throw error;
} finally { await browser.close(); }
