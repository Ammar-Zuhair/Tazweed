import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const output = fileURLToPath(new URL('../docs/progress/phase-02-evidence/', import.meta.url));
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, reducedMotion: 'reduce', colorScheme: 'light' });
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  const button = name => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
  const clear = async () => { const toast = button('إغلاق التنبيه'); if (await toast.isVisible()) await toast.evaluate(element => element.click()).catch(() => {}); };
  const click = async name => { await clear(); await button(name).click(); };
  const tab = async name => { await clear(); await page.getByRole('tab', { name, exact: true }).filter({ visible: true }).click(); };
  const fill = async (name, value) => page.getByRole('textbox', { name, exact: true }).filter({ visible: true }).fill(value);
  const text = () => page.locator('body').innerText();
  await page.goto('http://127.0.0.1:8081'); await click('عدن'); await tab('حسابي'); await click('تسجيل الدخول'); await fill('كلمة المرور', 'demo-pass'); await click('متابعة إلى رمز التحقق'); await fill('رمز التحقق', '000000'); await click('تحقق من الرمز'); await click('عناويني'); await click('إضافة عنوان جديد'); await fill('اسم العنوان', 'عنوان سحب الخريطة');
  const coordinates = page.getByTestId('coordinates').filter({ visible: true }); const before = await coordinates.innerText(); const map = page.getByTestId('demo-map').filter({ visible: true }); await map.scrollIntoViewIfNeeded(); const bounds = await map.boundingBox(); assert(bounds);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 45, bounds.y + bounds.height / 2 + 25, { steps: 8 }); await page.mouse.up(); assert.notEqual(await coordinates.innerText(), before, 'drag must move the coordinates, not the center pin'); await page.screenshot({ path: `${output}/map-drag-light-360.png` }); await click('تأكيد الإحداثيات'); await click('حفظ العنوان');
  await click('الرئيسية'); await tab('طلباتي'); await click('تفاصيل TZ-DEMO-1001'); await click('إلغاء الطلب قبل التأكيد'); await click('تأكيد طلب الإلغاء'); assert.match(await text(), /ألغي الطلب التجريبي قبل التأكيد/); await page.screenshot({ path: `${output}/cancelled-light-360.png` });
  await click('الرئيسية'); await click('التوصيل إلى عدن'); await click('محافظة بلا إعداد تجريبي'); await page.getByText('لم يهيأ فرع الكتالوج لهذه المحافظة في المعاينة.', { exact: true }).filter({ visible: true }).waitFor(); await page.screenshot({ path: `${output}/province-unconfigured-light-360.png` }); await click('تغيير المحافظة'); await click('عدن');
  await tab('حسابي'); await click('الشروط'); assert.match(await text(), /مسودة واجهة/); await click('الرئيسية'); await tab('حسابي'); await click('عن تزويد'); assert.match(await text(), /المرحلة02/); await click('الرئيسية'); await tab('حسابي'); await click('المظهر والإعدادات'); await click('حسب الجهاز'); await page.emulateMedia({ colorScheme: 'dark' }); await page.getByTestId('theme-dark').filter({ visible: true }).waitFor(); await page.emulateMedia({ colorScheme: 'light' }); await page.getByTestId('theme-light').filter({ visible: true }).waitFor(); await click('مظلم'); await page.reload(); await page.getByTestId('theme-dark').filter({ visible: true }).waitFor(); assert.equal(await page.evaluate(() => localStorage.getItem('tazweed.theme.v1')), 'dark'); assert.equal(await page.evaluate(() => localStorage.getItem('tazweed.preview.governorate.v1')), 'aden');
  assert.deepEqual(errors, []); await writeFile(`${output}/edge-results.json`, JSON.stringify({ checkedAt: new Date().toISOString(), passed: true, viewport: { width: 360, height: 740 }, checks: ['real pointer drag of schematic map changes coordinates', 'save address after explicit pin confirmation', 'direct cancellation before confirmation without receipt', 'unconfigured province empty catalog then change recovery', 'terms and about navigation', 'system theme live light/dark changes', 'explicit dark and province persisted after reload'], runtimeErrors: errors, nativeDeviceTested: false }, null, 2) + '\n'); console.log('PASS customer edge checks 360px');
} finally { await browser.close(); }
