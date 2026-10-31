import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { root, adminFingerprint } from './admin-evidence.mjs';
const prefix = process.env.TAZWEED_ADMIN_EVIDENCE_PREFIX ?? 'phase-03';
if (!/^phase-0[34]$/.test(prefix)) throw new Error('Invalid evidence prefix');
const output = `${root}/backend/docs/progress/${prefix === 'phase-04' ? 'phase-04-admin' : prefix}-evidence`;
const origin = 'http://127.0.0.1:8082';
await mkdir(output, { recursive: true });
const results = { checkedAt: new Date().toISOString(), sourceFingerprint: await adminFingerprint(), platform: 'Chromium / admin Expo web export', nativeDeviceTested: false, runs: [] };
if (process.env.TAZWEED_UI_COLLECT === '1') {
  for (let index = 0; index < 4; index++) {
    const run = JSON.parse(await readFile(`${output}/run-${index}.json`, 'utf8'));
    assert.equal(run.sourceFingerprint, results.sourceFingerprint, 'all independent runs must match current source');
    assert(run.passed); results.runs.push(run);
  }
  results.passed = true;
  await writeFile(`${output}/browser-results.json`, JSON.stringify(results, null, 2) + '\n');
  console.log('Collected four independent admin UI runs for the current source');
  process.exit(0);
}
const selected = process.env.TAZWEED_UI_RUNS;
if (selected && !/^[0-3](?:,[0-3])*$/.test(selected)) throw new Error('Invalid run selection');
if (selected) {
  const old = await readFile(`${output}/browser-results.json`, 'utf8').then(JSON.parse).catch(() => null);
  if (old?.sourceFingerprint === results.sourceFingerprint) results.runs = old.runs;
}
const browser = await chromium.launch({ headless: true });
try {
  for (const [index, [theme, width]] of [['light', 390], ['dark', 390], ['light', 1024], ['dark', 1024]].entries()) {
    if (selected && !selected.split(',').includes(String(index))) continue;
    const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: theme, reducedMotion: 'reduce' });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = [], external = [], checks = [], images = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (!r.url().startsWith(origin) && !/^(data:|blob:)/.test(r.url())) external.push(r.url()); });
    const button = name => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
    const checkbox = name => page.getByRole('checkbox', { name, exact: true }).filter({ visible: true }).first();
    const current = () => page.getByTestId(`theme-${theme}`).filter({ visible: true }).last();
    const text = () => current().innerText();
    const clear = async () => { if (await button('تأكيد العملية التجريبية').isVisible()) return; const b = button('إغلاق التنبيه'); if (await b.isVisible()) await b.click(); };
    const click = async name => { await clear(); console.log('click', theme, width, name); await button(name).click(); };
    const fill = async (name, value) => { await clear(); await page.getByRole('textbox', { name, exact: true }).filter({ visible: true }).fill(value); };
    const choose = async name => { await clear(); await checkbox(name).click(); };
    const select = async (label, name) => { await clear(); await page.getByText(label, { exact: true }).filter({ visible: true }).locator('..').getByRole('checkbox', { name, exact: true }).click(); };
    const confirm = async () => { await click('تأكيد العملية التجريبية'); await button('تأكيد العملية التجريبية').waitFor({ state: 'hidden' }); await clear(); };
    const tabs = async () => {
      for (let n = 0; n < 6; n++) {
        if (/^\/(?:more|orders|catalog|settings)?$/.test(new URL(page.url()).pathname)) {
          await page.getByRole('tab', { name: 'الأدوات', exact: true }).waitFor({ state: 'visible' }); return;
        }
        const before = page.url();
        await click('العودة إلى لوحة الإدارة');
        await page.waitForURL(url => url.href !== before);
        // Native-stack web transitions and popstate reconciliation finish after the URL changes.
        await page.waitForTimeout(400);
      }
      throw new Error('Could not return to tabs');
    };
    const tab = async name => { await clear(); await tabs(); await page.getByRole('tab', { name, exact: true }).click(); await page.waitForTimeout(400); };
    const nav = async name => { await tab('الأدوات'); await click(`فتح ${name}`); await button('العودة إلى لوحة الإدارة').waitFor(); await page.waitForTimeout(400); };
    const order = async id => { await tab('الطلبات'); await click(`فتح الطلب ${id}`); };
    const shot = async (name, focus) => {
      await clear();
      if (focus) await page.getByText(focus, { exact: true }).filter({ visible: true }).first().scrollIntoViewIfNeeded();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `horizontal overflow ${name} ${theme} ${width}`);
      const file = `${name}-${theme}-${width}.png`; await page.screenshot({ path: `${output}/${file}` }); images.push(file);
    };
    const login = async (name = 'مدير المعاينة') => {
      await choose(name); await click('متابعة إلى رمز التحقق'); await fill('رمز التحقق', '111111'); await click('دخول لوحة الإدارة');
      assert.match(await page.locator('body').innerText(), /المتبقي 4/);
      await fill('رمز التحقق', '000000'); await click('دخول لوحة الإدارة'); await clear(); await page.getByRole('tab', { name: 'اللوحة', exact: true }).waitFor();
    };
    try {
      await page.goto(origin); await checkbox('مدير المعاينة').waitFor(); await shot('login'); await login();
      await page.evaluate(() => document.fonts.ready);
      assert(await page.evaluate(() => document.fonts.check('16px "Tajawal-Regular"')));
      assert.equal(await page.locator('html').getAttribute('lang'), 'ar'); assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
      assert.equal(await current().evaluate(e => getComputedStyle(e).direction), 'rtl'); await shot('dashboard');
      checks.push('staff password and OTP / incorrect attempt / Arabic RTL / local Tajawal / branch and date dashboard / protected late alert');

      // One complete business journey plus three independent layout/state reviews.
      // Domain rules are covered by unit tests and the full 390px light journey.
      if (index > 0) {
        for (const [name, imageName, seed] of [
          ['الخصائص وقيمها', 'attributes', 'الماركة'],
          ['الأقسام والفلاتر', 'category-filters', 'الزيوت'],
          ['المنتجات والوحدات', 'product-units', 'زيت محركات 15W-40'],
          ['مخزون الفروع', 'inventory'],
          ['المحافظات والفروع', 'branch-coverage'],
          ['الموصلون والعمولات', 'couriers'],
          ['وسائل التحويل', 'payment-method'],
          ['الدفاتر المالية', 'commission-ledger'],
          ['العروض والبنرات', 'promotion'],
          ['الرسائل والبث', 'campaign'],
          ['الشكاوى والتقييمات', 'quality'],
          ['الموظفون والأدوار', 'permissions'],
          ['الصيانة والإصدارات', 'maintenance'],
          ['التقرير الشهري', 'report'],
          ['سجل التدقيق', 'audit'],
        ]) {
          await nav(name); if (seed) await choose(seed);
          if (name === 'التقرير الشهري') await click('عرض تصور PDF التجريبي');
          if (name === 'الأقسام والفلاتر') await checkbox('اللزوجة في الفلاتر').scrollIntoViewIfNeeded();
          if (name === 'المحافظات والفروع') await page.getByLabel('خريطة فرع تخطيطية قابلة للسحب', { exact: true }).scrollIntoViewIfNeeded();
          await shot(imageName, name === 'المنتجات والوحدات' ? 'وحدات البيع وأسعارها المستقلة' : name === 'التقرير الشهري' ? 'تزويد · تقرير مبيعات شهري' : undefined);
          if (name === 'العروض والبنرات') await shot('banner-preview', 'البنرات ومعاينة الثيم الحالي');
          if (name === 'الرسائل والبث') await shot('campaign-preview', 'معاينة محتوى · لا إشعار مرسل');
        }
        await order('TZ-1001'); await fill('سبب القرار *', 'مراجعة النسخة في الثيم والمقاس'); await click('مراجعة إصدار التسعيرة'); await confirm();
        await click('محاكاة قبول العميل — نقد'); await select('فرع التنفيذ اليدوي', 'فرع صنعاء التجريبي'); await click('مراجعة إصدار التسعيرة'); await confirm();
        assert.match(await text(), /القبول السابق محفوظ/); await shot('quote-revision', 'تاريخ النسخ والموافقة');
        await order('TZ-1003'); await shot('receipt-attempts', 'صور الإيصال الخاصة — معاينة مخولة'); await shot('flag-and-hold', 'الحجز وتاريخه');
        await order('TZ-1005'); await shot('delivery-issue', 'بلاغات تعذر التسليم');
        await tab('الطلبات'); await choose('خطأ تجريبي'); await page.getByTestId('admin-error').waitFor(); await shot('read-error'); await click('إعادة المحاولة'); await button('فتح الطلب TZ-1002').waitFor();
        await tab('الأدوات'); await click('تسجيل الخروج'); await confirm(); await login('مراجع تجريبي'); await order('TZ-1003');
        assert.equal(await page.getByText('صور الإيصال الخاصة — معاينة مخولة', { exact: true }).filter({ visible: true }).count(), 0);
        assert.equal(await button('مراجعة تأكيد الطلب').count(), 0); await shot('reviewer-permissions');
        await nav('الصيانة والإصدارات'); await page.getByTestId('permission-denied').filter({ visible: true }).waitFor(); await shot('permission-denied');
        await tab('المظهر'); await page.getByRole('radio', { name: 'حسب الجهاز', exact: true }).click();
        await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' }); await page.getByTestId(`theme-${theme === 'light' ? 'dark' : 'light'}`).filter({ visible: true }).first().waitFor();
        await page.getByRole('radio', { name: theme === 'light' ? 'الوضع الفاتح' : 'الوضع المظلم', exact: true }).click();
        await page.reload(); await checkbox('مدير المعاينة').waitFor(); await current().waitFor();
        assert.equal(await page.locator('video').count(), 0); assert.deepEqual(errors, []); assert.deepEqual(external, []);
        checks.push('all admin tools and report concept / same-total branch revision and previous acceptance / private receipt and protected flag panels / delivery failure / error and retry / reviewer restrictions / independent theme persistence / no external requests or page errors');
        const run = { theme, width, coverage: 'screen, state and permission review', passed: true, checks, images, pageErrors: errors, externalRequests: external };
        results.runs = results.runs.filter(r => r.theme !== theme || r.width !== width); results.runs.push(run);
        await writeFile(`${output}/run-${index}.json`, JSON.stringify({ sourceFingerprint: results.sourceFingerprint, ...run }, null, 2) + '\n');
        await writeFile(`${output}/browser-results.json`, JSON.stringify(results, null, 2) + '\n');
        continue;
      }

      await nav('الخصائص وقيمها'); await fill('اسم الخاصية *', 'المقاس'); await fill('مفتاح الخاصية *', 'size');
      await fill('قيمة جديدة', '205/55 R16'); await click('إضافة القيمة للقائمة'); await click('حفظ الخاصية وقيمها'); await shot('attributes');
      await click('الانتقال إلى ربط القسم'); await fill('اسم القسم *', 'إطارات المعاينة'); await choose('ربط الماركة'); await choose('الماركة مطلوبة');
      await choose('ربط المقاس'); await choose('المقاس مطلوبة'); await fill('ترتيب فلتر المقاس', '2'); await click('حفظ القسم وفلاتره'); await shot('category-filters');
      await click('الانتقال إلى المنتجات'); await fill('اسم المنتج *', 'إطار معاينة جديد'); await fill('SKU ثابت *', 'DEMO-TIRE-16');
      await fill('وصف المنتج *', 'منتج محلي لا يباع؛ لاختبار الخصائص والوحدات'); await fill('بلد المنشأ *', 'منشأ تجريبي');
      await select('قسم المنتج', 'إطارات المعاينة');
      assert.equal(await page.getByText('اللزوجة *', { exact: true }).filter({ visible: true }).count(), 0);
      await select('الماركة *', 'علامة المعاينة'); await select('المقاس *', '205/55 R16'); await choose('رسم إطار');
      await fill('سعر الوحدة 1 بالريال', '15000'); await click('إضافة وحدة كرتون بديلة'); await fill('معامل الوحدة 2', '4'); await fill('سعر الوحدة 2 بالريال', '55000');
      await fill('سعر الفرع للوحدة 1 — فارغ للأساسي', '15500'); await click('حفظ المنتج والوحدات'); await shot('product-units', 'وحدات البيع وأسعارها المستقلة');
      checks.push('create attribute and value / category required+filterable+order / category-specific pickers / new SKU and piece/carton with independent branch price');
      await click('فتح مخزون الفروع'); assert.match(await text(), /2 × 12 \+ 3 = 27/); await fill('سبب حركة المخزون *', 'إدخال27حبة للمراجعة');
      await click('مراجعة حركة المخزون'); await click('تراجع'); assert.match(await text(), /فعلي 240/);
      await click('مراجعة حركة المخزون'); await confirm(); assert.match(await page.getByTestId('stock-totals').innerText(), /فعلي 267/); await shot('inventory');
      checks.push('2x12+3=27 / cancel critical confirmation / movement and balance evidence');

      await order('TZ-1001'); await fill('سعر البند 1 بالريال', '19000'); await fill('سعر البند 2 بالريال', '1700'); await fill('سبب القرار *', 'مراجعة جملة تجريبية');
      await click('مراجعة إصدار التسعيرة'); await confirm(); await click('محاكاة قبول العميل — نقد'); await clear();
      const firstTotal = await page.getByTestId('quote-total').innerText();
      await select('فرع التنفيذ اليدوي', 'فرع صنعاء التجريبي'); await fill('سبب القرار *', 'تغيير فرع ولو الإجمالي ثابت'); await click('مراجعة إصدار التسعيرة'); await confirm();
      assert.equal(await page.getByTestId('quote-total').innerText(), firstTotal); assert.match(await text(), /القبول السابق محفوظ/);
      await click('مراجعة تأكيد الطلب'); await click('تأكيد العملية التجريبية'); assert.match(await page.locator('body').innerText(), /قبول آخر نسخة/); await click('تراجع');
      await shot('quote-revision', 'تاريخ النسخ والموافقة'); await click('محاكاة قبول العميل — تحويل'); await click('تثبيت تعليمات التحويل التجريبية');
      await fill('رقم تحويل المعاينة', 'DEMO-UI-1001'); await fill('مبلغ التحويل أو التحقق', '43600'); await click('محاكاة رفع صورة لنفس التحويل');
      await select('نتيجة مراجعة الإيصال', 'رفض صورة للتصحيح'); await fill('سبب مراجعة الإيصال *', 'الصورة غير واضحة فقط');
      await click('مراجعة قرار الإيصال والحجز'); await confirm(); await click('محاكاة رفع صورة لنفس التحويل'); await shot('receipt-attempts', 'صور الإيصال الخاصة — معاينة مخولة');
      await select('نتيجة مراجعة الإيصال', 'تحويل متحقق خارجيًا'); await fill('المبلغ المتحقق خارجيًا', '43600'); await choose('تحققت خارجيًا من وصول المال');
      await fill('سبب مراجعة الإيصال *', 'تحقق خارجي تجريبي مطابق'); await click('مراجعة قرار الإيصال والحجز'); await confirm();
      await click('مراجعة تأكيد الطلب'); await confirm(); assert.match(await text(), /تم التأكيد/); assert.equal(await button('مراجعة إصدار التسعيرة').count(), 0);
      await select('الموصل المسند', 'موصل متعدد الفروع — تجربة · 15%'); await fill('سبب الإسناد أو إعادة الإسناد *', 'إسناد تجريبي'); await click('مراجعة إسناد الموصل'); await confirm(); await shot('assignment', 'الإسناد والعمولة');
      checks.push('wholesale custom line prices / same-total branch revision and old acceptance / stale acceptance blocks confirm / instruction before receipt / reject+correct same payment / external verification / confirm / eligible courier assignment');

      await order('TZ-1003'); assert.match(await text(), /تنبيه بلاغ سابق/); assert.match(await text(), /تعذر التواصل في طلب سابق/); await shot('flag-and-hold', 'الحجز وتاريخه');
      await order('TZ-1004'); await fill('سبب إعادة التحقق أو الرفض *', 'نفس الحقائق بعد انتهاء الحجز'); await click('مراجعة إعادة تحقق حجز نقدي'); await confirm();
      await click('مراجعة تأكيد الطلب'); await confirm(); assert.match(await text(), /تم التأكيد/); await shot('cash-confirmed', 'الإسناد والعمولة');
      await order('TZ-1005'); await fill('رد الإدارة على تعذر التسليم *', 'تنسيق التواصل دون تغيير المبلغ'); await click('مراجعة رد تعذر التسليم'); await confirm(); assert.match(await text(), /رد الإدارة:/);
      checks.push('prior client flag with protected hold / expired cash revalidation and confirm without receipt / delivery failure review without automatic status or money changes');

      await nav('الدفاتر المالية'); await fill('مرجع القيد أو المعالجة *', 'DEMO-SETTLE'); await fill('سبب القيد أو العكس *', 'صرف تجريبي مستقل'); await select('إثبات محلي تجريبي *', 'مرفق معاينة غير مالي');
      await choose('assignment-delivered · 100 ر.ي'); await click('مراجعة صرف عمولة'); await confirm(); assert.match(await page.getByTestId('available-ledger').innerText(), /:\s*0 ر\.ي/); await shot('commission-ledger');
      await select('نوع الدفتر', 'نقد المتجر وتوريده'); assert.match(await page.getByTestId('available-ledger').innerText(), /24,400/);
      await choose('DEMO-CASH-1006 · 24,400 ر.ي'); await click('مراجعة استلام توريد النقد'); await confirm(); await shot('cash-remittance');
      checks.push('commission payout100 / full cash remittance24400 independently / no netting');
      await nav('المحافظات والفروع'); await choose('عدن — تجربة'); await select('فرع كتالوج المحافظة الصريح', 'فرع عدن التجريبي'); await click('حفظ المحافظة');
      await page.getByText('الفروع والتوصيل', { exact: true }).locator('..').getByRole('checkbox', { name: 'فرع عدن التجريبي', exact: true }).click(); await fill('زيادة الكيلومتر بالريال', '50'); await click('حفظ الفرع والتعرفة'); assert.match(await text(), /400 ر.ي/); await shot('branch-coverage', 'الفروع والتوصيل');
      await nav('وسائل التحويل'); await choose('وسيلة تحويل تجريبية'); await fill('تعليمات التحويل', 'تعليمات مستقبلية لا تغير الطلبات'); await click('حفظ وسيلة التحويل'); await shot('payment-method');
      await nav('العروض والبنرات'); await fill('اسم العرض *', 'خصم منتجات تجريبي'); await fill('قيمة الخصم — ريال أو bps', '200'); await click('حفظ العرض'); await shot('promotion');
      await nav('الرسائل والبث'); await fill('عنوان الرسالة *', 'رسالة مراجعة'); await fill('نص الرسالة *', 'معاينة دون إرسال إلى مستخدمين'); await select('حالة الحملة المحلية', 'جدولة تجريبية دون إرسال'); await click('مراجعة حفظ الحملة'); await confirm(); await shot('campaign');
      checks.push('province catalog mapping / branch floor_km fee edit / future method instructions / single promotion / targeted scheduled local broadcast');

      await nav('الشكاوى والتقييمات'); await fill('رد إداري *', 'تمت مراجعة التغليف محليًا'); await select('حالة المعالجة', 'محلول'); await click('حفظ معالجة complaint-1'); await shot('quality');
      await nav('الموظفون والأدوار'); await shot('permissions');
      await nav('الصيانة والإصدارات'); await choose('محاكاة صيانة العميل'); await click('مراجعة حفظ صيانة العميل'); await confirm(); assert.match(await page.getByTestId('maintenance-state').innerText(), /بصيانة تجريبية/); await shot('maintenance');
      await fill('أقل build مسموح *', '9'); await fill('أحدث build *', '10'); await fill('رابط المتجر HTTPS *', 'https://example.invalid/demo-store'); await click('مراجعة حفظ إعداد الإصدار'); await confirm();
      await nav('التقرير الشهري'); await click('عرض تصور PDF التجريبي'); await shot('report', 'تزويد · تقرير مبيعات شهري'); assert.match(await text(), /غير صالح للمحاسبة/);
      await nav('سجل التدقيق'); await shot('audit'); assert.match(await text(), /إصدار نسخة TZ-1001/);
      checks.push('complaint response / roles and explicit permission list / customer-only maintenance keeps admin working / numeric release builds9<10 / marked Arabic PDF concept / audit');

      await tab('الطلبات'); await choose('خطأ تجريبي'); await page.getByTestId('admin-error').waitFor(); await shot('read-error'); await click('إعادة المحاولة'); await button('فتح الطلب TZ-1002').waitFor();
      await choose('قائمة فارغة'); await page.getByTestId('admin-empty').waitFor(); await click('إعادة المحاولة'); await button('فتح الطلب TZ-1002').waitFor();
      await choose('انقطاع تجريبي'); await page.getByTestId('admin-offline').waitFor(); await click('إعادة المحاولة'); await button('فتح الطلب TZ-1002').waitFor();
      await choose('تحميل بطيء'); await page.getByTestId('admin-loading').waitFor(); await button('فتح الطلب TZ-1002').waitFor();
      await tab('الأدوات'); await click('تسجيل الخروج'); await confirm(); await login('مراجع تجريبي'); await order('TZ-1003');
      assert.equal(await page.getByText('صور الإيصال الخاصة — معاينة مخولة', { exact: true }).filter({ visible: true }).count(), 0);
      assert.equal(await page.getByText('تعذر التواصل في طلب سابق — بلاغ تجريبي من موظف، ليس حظرًا آليًا', { exact: true }).filter({ visible: true }).count(), 0);
      assert.equal(await button('مراجعة تأكيد الطلب').count(), 0); await shot('reviewer-permissions');
      await nav('الصيانة والإصدارات'); await page.getByTestId('permission-denied').filter({ visible: true }).waitFor(); await shot('permission-denied');
      checks.push('loading/empty/error/offline/retry / reviewer has no receipt or private flag content / no confirm permission / direct operations access denied');

      if (index === 0) {
        await tab('الأدوات'); await click('تسجيل الخروج'); await confirm(); await login('أمين مخزن تجريبي');
        await nav('مخزون الفروع'); await select('نوع حركة المخزون', 'نقل بين فرعين'); await fill('سبب حركة المخزون *', 'محاولة نقل خارج النطاق');
        const before = await page.getByTestId('stock-totals').innerText(); await click('مراجعة حركة المخزون'); await click('تأكيد العملية التجريبية');
        assert.match(await page.locator('body').innerText(), /لا تملك صلاحية/); await click('تراجع'); await clear(); assert.equal(await page.getByTestId('stock-totals').innerText(), before); await shot('warehouse-scope');
        await tab('الأدوات'); await click('تسجيل الخروج'); await confirm(); await login(); await nav('الموظفون والأدوار');
        await fill('اسم الدور *', 'مسؤول الإصدارات التجريبي'); await choose('الإصدارات'); await click('مراجعة حفظ الدور'); await confirm();
        await fill('اسم الموظف *', 'موظف إصدارات تجريبي'); await fill('هاتف الموظف التجريبي *', '770000005');
        await select('دور المنحة', 'مسؤول الإصدارات التجريبي'); await select('نطاق المنحة', 'عام — كل الفروع والإجراءات العامة'); await click('إضافة الدور مع هذا النطاق'); await click('مراجعة حفظ الموظف'); await confirm();
        await tab('الأدوات'); await click('تسجيل الخروج'); await confirm(); await fill('رقم الموظف', '770000005'); await fill('كلمة مرور الاختبار', 'Tazweed123!'); await click('متابعة إلى رمز التحقق'); await fill('رمز التحقق', '000000'); await click('دخول لوحة الإدارة');
        await nav('الصيانة والإصدارات'); await page.getByText('الإصدارات لكل تطبيق ومنصة وبيئة', { exact: true }).waitFor();
        assert.equal(await checkbox('محاكاة صيانة العميل').count(), 0); await shot('release-only-role');
        checks.push('warehouse two-branch transfer denied atomically / create role and internal staff / releases-only global grant can edit releases and cannot access maintenance');
      }

      await tab('المظهر'); await page.getByRole('radio', { name: 'حسب الجهاز', exact: true }).click();
      const other = theme === 'light' ? 'dark' : 'light'; await page.emulateMedia({ colorScheme: other }); await page.getByTestId(`theme-${other}`).filter({ visible: true }).first().waitFor();
      await page.getByRole('radio', { name: theme === 'light' ? 'الوضع الفاتح' : 'الوضع المظلم', exact: true }).click();
      await page.reload(); await checkbox('مدير المعاينة').waitFor(); await current().waitFor();
      assert.equal(await page.locator('video').count(), 0); assert.deepEqual(errors, []); assert.deepEqual(external, []);
      checks.push('system theme changes / explicit theme persists across reload / preview session resets / no video / no external services or page errors');
      const run = { theme, width, passed: true, checks, images, pageErrors: errors, externalRequests: external };
      results.runs = results.runs.filter(r => r.theme !== theme || r.width !== width); results.runs.push(run);
      await writeFile(`${output}/run-${index}.json`, JSON.stringify({ sourceFingerprint: results.sourceFingerprint, ...run }, null, 2) + '\n');
      await writeFile(`${output}/browser-results.json`, JSON.stringify(results, null, 2) + '\n');
    } catch (error) {
      await page.screenshot({ path: `${root}/.phase03-work/failure-${theme}-${width}.png`, fullPage: true }).catch(() => {});
      await writeFile(`${root}/.phase03-work/failure-${theme}-${width}.txt`, await page.locator('body').innerText()).catch(() => {});
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
results.passed = results.runs.length === 4 && results.runs.every(r => r.passed);
await writeFile(`${output}/browser-results.json`, JSON.stringify(results, null, 2) + '\n');
console.log(`Admin UI: ${results.runs.length} successful journeys; full matrix passed=${results.passed}`);
