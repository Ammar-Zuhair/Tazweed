import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { root, courierFingerprint } from "./courier-evidence.mjs";
const output = `${root}/backend/docs/progress/phase-04-evidence`;
const origin = "http://127.0.0.1:8083";
await mkdir(output, { recursive: true });
const results = {
  checkedAt: new Date().toISOString(),
  sourceFingerprint: await courierFingerprint(),
  platform: "Chromium / Expo web export",
  nativeDeviceTested: false,
  runs: [],
};
const selected = process.env.TAZWEED_UI_RUNS;
if (selected && !/^[0-3](?:,[0-3])*$/.test(selected))
  throw new Error("Invalid selection");
if (process.env.TAZWEED_UI_COLLECT === "1") {
  for (let i = 0; i < 4; i++) {
    const run = JSON.parse(await readFile(`${output}/run-${i}.json`, "utf8"));
    assert(run.passed);
    assert.equal(run.sourceFingerprint, results.sourceFingerprint);
    results.runs.push(run);
  }
  results.passed = true;
  await writeFile(
    `${output}/browser-results.json`,
    JSON.stringify(results, null, 2) + "\n",
  );
  process.exit(0);
}
const browser = await chromium.launch({ headless: true });
try {
  for (const [index, [theme, width]] of [
    ["light", 390],
    ["dark", 390],
    ["light", 1024],
    ["dark", 1024],
  ].entries()) {
    if (selected && !selected.split(",").includes(String(index))) continue;
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      colorScheme: theme,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [],
      external = [],
      images = [],
      checks = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (!r.url().startsWith(origin) && !/^(data:|blob:)/.test(r.url()))
        external.push(r.url());
    });
    const b = (name) =>
      page
        .getByRole("button", { name, exact: true })
        .filter({ visible: true })
        .first();
    const clear = async () => {
      if (await b("تأكيد الإجراء").isVisible()) return;
      if (await b("إغلاق التنبيه").isVisible())
        await b("إغلاق التنبيه").click();
    };
    const click = async (name) => {
      await clear();
      console.log(theme, width, name);
      await b(name).click();
    };
    const fill = async (name, value) =>
      page
        .getByRole("textbox", { name, exact: true })
        .filter({ visible: true })
        .fill(value);
    const confirm = async () => {
      await click("تأكيد الإجراء");
      await b("تأكيد الإجراء").waitFor({ state: "hidden" });
    };
    const current = () =>
      page
        .locator('[data-testid^="theme-"]:not([aria-hidden="true"] *)')
        .filter({ visible: true })
        .last();
    const text = () => current().innerText();
    const expectText = async (pattern) => assert.match(await text(), pattern);
    const waitText = async (value) =>
      page
        .getByText(value, { exact: false })
        .filter({ visible: true })
        .first()
        .waitFor();
    const shot = async (name) => {
      await clear();
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `overflow ${name}`,
      );
      const file = `${name}-${theme}-${width}.png`;
      await page.screenshot({ path: `${output}/${file}` });
      images.push(file);
    };
    const back = async () => {
      await click("العودة");
      await page.waitForTimeout(450);
    };
    const tabs = async () => {
      for (let n = 0; n < 6; n++) {
        if (/^\/(?:account|earnings)?$/.test(new URL(page.url()).pathname))
          return;
        await back();
      }
      throw new Error("tabs unavailable");
    };
    const tab = async (name) => {
      await tabs();
      await clear();
      await page.getByRole("tab", { name, exact: true }).click();
      await page.waitForTimeout(450);
    };
    const nav = async (name) => {
      await tab("حسابي");
      await click(name);
      await page.waitForTimeout(450);
    };
    const open = async (number) => {
      await tab("مهامي");
      await click(`تفاصيل ${number}`);
      await page.waitForTimeout(450);
    };
    const login = async () => {
      await fill("رقم الهاتف", "770000012");
      await fill("كلمة المرور", "Tazweed123!");
      await click("إرسال رمز التحقق");
      await fill("رمز التحقق", "000000");
      await click("تحقق ودخول");
      await page
        .getByTestId("task-t1")
        .filter({ visible: true })
        .first()
        .waitFor();
    };
    try {
      await page.goto(origin);
      await b("إرسال رمز التحقق").waitFor();
      await shot("login");
      await login();
      await page.evaluate(() => document.fonts.ready);
      assert(
        await page.evaluate(() =>
          document.fonts.check('16px "Tajawal-Regular"'),
        ),
      );
      assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
      assert.equal(await page.locator("html").getAttribute("lang"), "ar");
      assert.equal(await page.locator("video").count(), 0);
      assert.equal(
        await page.getByTestId("task-other").filter({ visible: true }).count(),
        0,
      );
      await shot("tasks");
      checks.push(
        "internal password and OTP / multiple assigned tasks / no private other courier / RTL Tajawal / no video",
      );
      await open("TZ-0401");
      await shot("task-address");
      await click("ملاحة خارجية");
      await expectText(/destination=12.8531,44.9772/);
      await shot("navigation");
      await click("إغلاق الوجهة");
      await click("بدء التوصيل");
      await click("تراجع");
      await b("بدء التوصيل").waitFor();
      await click("بدء التوصيل");
      await confirm();
      await b("تم التسليم").waitFor();
      await shot("on-the-way");
      if (index === 0) {
        await click("تم التسليم");
        await confirm();
        await waitText("سجل النقد الحقيقي أو الاستثناء قبل التسليم.");
        await shot("cash-required");
        await click("مراجعة العملية المعلقة");
        await click("إزالة العملية المرفوضة");
        await confirm();
        await back();
        await fill("المبلغ المستلم فعليًا", "24400");
        await fill("مرجع التحصيل", "CASH-UI-0401");
        await click("استلمت نقدًا");
        await confirm();
        await waitText("محصل بالكامل");
        await shot("cash-collected");
        await click("تم التسليم");
        await confirm();
        await waitText("أقرت المحاكاة التسليم في");
        await shot("delivered");
        await open("TZ-0403");
        await fill("المبلغ المستلم فعليًا", "24000");
        await fill("مرجع التحصيل", "CASH-UI-SHORT");
        await click("استلمت نقدًا");
        await confirm();
        await waitText("تحصيل غير مطابق");
        await fill(
          "سبب النقص أو التعذر أو الزيادة",
          "العميل سلم مبلغًا ناقصًا وطلب مراجعة الإدارة",
        );
        await click("تسجيل استثناء نقدي للإدارة");
        await confirm();
        await waitText("استثناء مسجل:");
        await shot("cash-shortfall");
        await click("تم التسليم");
        await confirm();
        await waitText("أقرت المحاكاة التسليم في");
        await expectText(/استثناء نقدي مسجل للإدارة/);
        checks.push(
          "confirmation cancellation / delivery blocked before cash / actual cash 24400 separate / shortfall 400 explicit / commission earned only once",
        );
        await open("TZ-0402");
        await click("بلاغ أو تعذر التسليم");
        await fill(
          "تفاصيل البلاغ",
          "تعذر التواصل مع العميل عند الوصول إلى العنوان التجريبي",
        );
        await click("استخدام صورة بلاغ تجريبية");
        await shot("report-compose");
        await click("إرسال البلاغ");
        await confirm();
        await b("بلاغ أو تعذر التسليم").waitFor();
        await waitText("تعذر التسليم · مفتوح");
        await shot("report-sent");
        await nav("مختبر المعاينة");
        await click("محاكاة رد الإدارة على البلاغ");
        await click("محاكاة صيانة العميل");
        await expectText(/تبقى مهام الموصل متاحة/);
        await open("TZ-0402");
        await waitText("رد إداري تجريبي:");
        await shot("report-reply");
        // Offline start must stay confirmed and retain a single operation/key.
        await nav("مختبر المعاينة");
        await click("الشبكة: منقطعة");
        await open("TZ-0402");
        await click("بدء التوصيل");
        await confirm();
        await waitText("بانتظار الشبكة");
        await b("بدء التوصيل").waitFor();
        assert.equal(await b("بدء التوصيل").isDisabled(), true);
        await shot("pending-offline");
        await tab("مهامي");
        await click("عمليات الشبكة");
        await waitText("بانتظار الشبكة — لم يصل الإقرار");
        const key = await page
          .getByText(/^local-/)
          .filter({ visible: true })
          .innerText();
        await shot("queue");
        await click("إعادة المحاولة بالمفتاح نفسه");
        await waitText("بانتظار الشبكة — لم يصل الإقرار");
        assert.equal(
          await page
            .getByText(/^local-/)
            .filter({ visible: true })
            .innerText(),
          key,
        );
        await nav("مختبر المعاينة");
        await click("الشبكة: متصلة");
        await tab("مهامي");
        await click("عمليات الشبكة");
        await click("إعادة المحاولة بالمفتاح نفسه");
        await waitText("لا عمليات معلّقة");
        await open("TZ-0402");
        await b("تم التسليم").waitFor();
        await click("تم التسليم");
        await confirm();
        await waitText("أقرت المحاكاة التسليم في");
        checks.push(
          "local image and report reply / client maintenance keeps courier open / offline does not confirm / same-key retry / transfer delivers without cash receipt",
        );
      }
      await tab("مستحقاتي");
      await shot("earnings");
      await expectText(/أساس التوصيل 500/);
      await expectText(/معكوسة — عاد المبلغ/);
      await click("عهدة نقد المتجر");
      await shot("cash-ledger");
      await expectText(/دون طرح العمولة تلقائيًا/);
      await nav("الإشعارات وصوت المهام");
      await shot("notifications");
      await click("تجربة صوت مهمة");
      await waitText("طلب تشغيل نغمة محلية");
      await click("كتم صوت المهام");
      await click("تجربة صوت مهمة");
      await waitText("الصوت مكتوم");
      await nav("الخصوصية والشروط");
      await shot("policies");
      await nav("المظهر");
      await shot("appearance");
      await page
        .getByRole("radio", {
          name: theme === "dark" ? "الوضع المظلم" : "الوضع الفاتح",
          exact: true,
        })
        .click();
      await page
        .getByTestId(`theme-${theme}`)
        .filter({ visible: true })
        .first()
        .waitFor();
      await page.reload();
      await b("إرسال رمز التحقق").waitFor();
      await page
        .getByTestId(`theme-${theme}`)
        .filter({ visible: true })
        .first()
        .waitFor();
      await login();
      await nav("المظهر");
      await page
        .getByRole("radio", { name: "حسب الجهاز", exact: true })
        .click();
      await page.emulateMedia({
        colorScheme: theme === "dark" ? "light" : "dark",
      });
      await page
        .getByTestId(`theme-${theme === "dark" ? "light" : "dark"}`)
        .filter({ visible: true })
        .first()
        .waitFor();
      await page.emulateMedia({ colorScheme: theme });
      checks.push(
        "daily commission and frozen rate / independent cash ledger and reversal / local foreground sound request and mute / policies / saved and system theme / reload clears session",
      );
      await nav("مختبر المعاينة");
      await shot("lab");
      await click("قراءة فارغة");
      await page
        .getByTestId("tasks-empty")
        .filter({ visible: true })
        .first()
        .waitFor();
      await shot("empty");
      await nav("مختبر المعاينة");
      await click("قراءة خطأ");
      await page
        .getByTestId("tasks-error")
        .filter({ visible: true })
        .first()
        .waitFor();
      await shot("error");
      await nav("مختبر المعاينة");
      await click("قراءة تحميل");
      await page
        .getByTestId("tasks-loading")
        .filter({ visible: true })
        .first()
        .waitFor();
      await page
        .getByTestId("task-t1")
        .filter({ visible: true })
        .first()
        .waitFor();
      await nav("مختبر المعاينة");
      await click("قراءة جاهزة");
      await page
        .getByTestId("task-t1")
        .filter({ visible: true })
        .first()
        .waitFor();
      await nav("مختبر المعاينة");
      await click("إنهاء صلاحية إسناد TZ-0401");
      await confirm();
      await open("TZ-0402");
      await back();
      assert.equal(
        await page.getByTestId("task-t1").filter({ visible: true }).count(),
        0,
      );
      // Revoked deep link does not restore private data, then logout purges cache.
      await page.goto(origin + "/task?id=t1");
      await b("إرسال رمز التحقق").waitFor();
      await login();
      await open("TZ-0402");
      await nav("مختبر المعاينة");
      await click("إنهاء صلاحية إسناد TZ-0401");
      await confirm();
      await click("فتح إسناد TZ-0401");
      await waitText("الإسناد غير متاح أو انتهت صلاحية النسخة.");
      await shot("assignment-expired");
      await nav("نقد المتجر");
      await nav("الخصوصية والشروط");
      await tab("حسابي");
      await click("تسجيل الخروج");
      await confirm();
      await b("إرسال رمز التحقق").waitFor();
      assert(!(await text()).includes("شارع تجريبي 12"));
      await shot("signed-out");
      checks.push(
        "empty/error/loading/retry / assignment expiry removes private data / protected deep link / confirmed logout clears cache",
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      assert.equal(await page.locator("video").count(), 0);
      const run = {
        index,
        theme,
        width,
        checks,
        images,
        pageErrors: errors,
        externalRequests: external,
        passed: true,
      };
      results.runs.push(run);
      await writeFile(
        `${output}/run-${index}.json`,
        JSON.stringify(
          { ...run, sourceFingerprint: results.sourceFingerprint },
          null,
          2,
        ) + "\n",
      );
    } catch (error) {
      await page.screenshot({ path: `${output}/failure-${index}.png` });
      await writeFile(`${output}/failure-${index}.txt`, await text());
      throw error;
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
results.passed =
  results.runs.length === 4 && results.runs.every((x) => x.passed);
await writeFile(
  `${output}/browser-results.json`,
  JSON.stringify(results, null, 2) + "\n",
);
console.log(
  `Courier phase04: ${results.runs.length} selected runs passed; matrix=${results.passed}`,
);
