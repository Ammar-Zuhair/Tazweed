// UI -> real HTTP -> limited-role PostgreSQL. Only external transports are isolated adapters.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import sharp from "sharp";
import { fixture, pass } from "../tests/phase05/helpers.js";
import { seed } from "../tests/phase09/seed.js";
import { TestRouting } from "../tests/phase07/routing.js";
import { TestStore } from "../tests/phase06/store.js";
const out = new URL("../docs/progress/phase-09-evidence/", import.meta.url);
await mkdir(out, { recursive: true });
const store = new TestStore(),
  f = await fixture({ routingProvider: new TestRouting(), objectStore: store }),
  h = await seed(f, false);
const browser = await chromium.launch({ headless: true }),
  context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
    colorScheme: "light",
  });
const errors: string[] = [],
  results: any[] = [];
let shots = 0,
  external = 0,
  dropDelivery = false,
  dropped = 0;
const imagePath = "/workspace/.phase09-work/proof.png";
await sharp({
  create: { width: 320, height: 200, channels: 3, background: "#f6c188" },
})
  .png()
  .toFile(imagePath);
const text = (p: Page, t: string | RegExp) =>
  p.getByText(t).filter({ visible: true });
const button = (p: Page, t: string) =>
  p.getByRole("button", { name: t, exact: true }).filter({ visible: true });
const click = async (p: Page, t: string) => {
  console.log("UI09 action: " + t);
  await button(p, t).click();
};
const input = (p: Page, t: string, v: string) =>
  p
    .getByRole("textbox", { name: t, exact: true })
    .filter({ visible: true })
    .fill(v);
async function shot(p: Page, name: string) {
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({
    path: new URL(name + ".png", out).pathname,
    fullPage: true,
  });
  shots++;
}
async function attach(p: Page) {
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route("**/api/v1/**", async (route) => {
    const q = route.request(),
      u = new URL(q.url()),
      headers = { ...q.headers() };
    delete headers.host;
    delete headers.origin;
    delete headers["content-length"];
    const r = await fetch(f.origin + u.pathname + u.search, {
      method: q.method(),
      headers,
      ...(["GET", "HEAD"].includes(q.method())
        ? {}
        : { body: q.postDataBuffer() ?? undefined }),
    });
    const body = Buffer.from(await r.arrayBuffer());
    if (u.pathname === "/api/v1/auth/login/verify" && r.status === 200) {
      const a = q.postDataJSON().app,
        t = JSON.parse(body.toString()).accessToken;
      if (a === "courier") h.setCourierTokens(t);
      else h.setTokens({ [a]: t });
    }
    if (dropDelivery && u.pathname.endsWith("/deliver") && r.status === 200) {
      dropDelivery = false;
      dropped++;
      await route.abort("connectionreset");
      return;
    }
    const rh = Object.fromEntries(r.headers);
    delete rh["content-length"];
    delete rh["content-encoding"];
    await route.fulfill({ status: r.status, headers: rh, body });
  });
  await p.route(/^https:\/\//, async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "isolated.test") {
      if (u.pathname.startsWith("/upload/")) {
        store.files.set(
          decodeURIComponent(u.pathname.slice(8)),
          route.request().postDataBuffer()!,
        );
        await route.fulfill({ status: 200 });
        return;
      }
      const key = decodeURIComponent(
          u.pathname.replace(/^\/(private|public)\//, ""),
        ),
        data = store.files.get(key);
      await route.fulfill({
        status: data ? 200 : 404,
        contentType: "image/webp",
        body: data ?? Buffer.alloc(0),
      });
      return;
    }
    external++;
    await route.abort();
  });
}
async function login(p: Page, phone: string) {
  await input(p, "رقم الجوال", phone);
  await input(p, "كلمة المرور", pass);
  await click(p, "متابعة");
  await p.getByRole("textbox", { name: "رمز التحقق", exact: true }).waitFor();
  await input(p, "رمز التحقق", f.provider.messages.at(-1)!.code);
  await click(p, "تحقق ومتابعة");
  if (p.url().includes(":8082/")) await button(p, "تحديث الطلبات").waitFor();
  else await text(p, /أهلًا (حساب اختبار صريح|موصل اختبار09)/).waitFor();
}
async function upload(p: Page, title: string, wait: string) {
  const chooser = p.waitForEvent("filechooser");
  await click(p, title);
  await (await chooser).setFiles(imagePath);
  await button(p, wait).waitFor();
}
async function route(p: Page, label: string) {
  await click(p, label);
  await p.waitForTimeout(350);
}
try {
  const customer = await context.newPage(),
    admin = await context.newPage(),
    courier = await context.newPage();
  for (const p of [customer, admin, courier]) await attach(p);
  await customer.goto("http://127.0.0.1:8081/auth");
  await login(customer, h.customer.phone_e164);
  await admin.goto("http://127.0.0.1:8082/orders");
  await login(admin, h.staff.phone_e164);
  await courier.goto("http://127.0.0.1:8083/account");
  await login(courier, h.courier.phone_e164);
  await route(admin, "الموصلون والدفاتر");
  await click(admin, "تعديل الموصل موصل اختبار09");
  await input(admin, "نسبة العمولة (%)", "20");
  await click(admin, "مراجعة حفظ الموصل");
  await click(admin, "تأكيد حفظ الموصل");
  await button(admin, "تأكيد حفظ الموصل").waitFor({ state: "hidden" });
  await click(admin, "سجل إعدادات موصل اختبار09");
  await text(admin, /النسبة 20% · نشط · 2 فروع/).waitFor();
  await text(admin, /النسبة 20% · نشط · 2 فروع/).scrollIntoViewIfNeeded();
  await shot(admin, "admin-courier-configuration-history");
  results.push({
    name: "explicit percentage and courier configuration history",
    passed: true,
  });
  await route(admin, "الطلبات");
  // Fix the explicit sample: 500 before discount, 100 discount, commission20%=100.
  await f.owner.query("UPDATE delivery_rules SET base_yer=400");
  await f.owner.query(
    "INSERT INTO promotions(name_ar,target,discount_kind,value,starts_at,ends_at) VALUES('عرض اختبار09','delivery','fixed',100,now()-interval '1 hour',now()+interval '1 hour')",
  );
  const first = await h.confirmed(),
    second = await h.confirmed(),
    firstNumber = (await h.get(first)).order.order_number;
  await click(admin, "تحديث الطلبات");
  await click(admin, "مراجعة الطلب " + firstNumber);
  await text(admin, "مؤكد · تجزئة · نقد عند الاستلام").waitFor();
  await click(admin, "تحميل الموصلين المتاحين");
  await click(admin, "إسناد إلى موصل اختبار09");
  await input(admin, "سبب الإسناد أو إعادة الإسناد", "إسناد رحلة واجهة09 موثق");
  await click(admin, "مراجعة الإسناد");
  await click(admin, "تأكيد الإسناد");
  await text(admin, /الإسناد الحالي.*عمولة 100/).waitFor();
  await text(admin, /الإسناد الحالي.*عمولة 100/).scrollIntoViewIfNeeded();
  await shot(admin, "admin-dispatch-light-390");
  await h.assign(second);
  await route(courier, "المهام");
  await click(courier, "تحديث المهام");
  await text(courier, "طلب #" + firstNumber + " · مؤكد").waitFor();
  await shot(courier, "courier-multiple-tasks-light-390");
  await click(courier, "فتح المهمة " + firstNumber);
  await text(courier, /الدبوس: 15\.01/).waitFor();
  await shot(courier, "courier-task-light-390");
  await text(courier, "عمولة هذا الإسناد").scrollIntoViewIfNeeded();
  await shot(courier, "courier-commission-snapshot-light-390");
  await click(courier, "بدء التوصيل");
  await click(courier, "تأكيد التنفيذ");
  await button(courier, "تم التسليم").waitFor();
  await click(courier, "تم التسليم");
  await click(courier, "تأكيد التنفيذ");
  await text(
    courier,
    "سجل التحصيل الفعلي أو استثناء الفرق الحالي للإدارة قبل التسليم",
  ).waitFor();
  assert.equal((await h.task(first)).cashCollectedYer, "0");
  await input(courier, "المبلغ النقدي المستلم فعليًا", "500");
  await input(courier, "مرجع التحصيل", "UI09-CASH");
  await click(courier, "تسجيل التحصيل الفعلي");
  await click(courier, "تأكيد التنفيذ");
  await text(courier, "المحصل فعليًا 500 · الباقي 0 ر.ي").waitFor();
  dropDelivery = true;
  await click(courier, "تم التسليم");
  await click(courier, "تأكيد التنفيذ");
  const deadline = Date.now() + 15000;
  while (!dropped && Date.now() < deadline) await courier.waitForTimeout(50);
  assert.equal(dropped, 1);
  await courier
    .getByRole("button", {
      name: "إعادة محاولة العملية",
      exact: true,
      disabled: false,
    })
    .filter({ visible: true })
    .waitFor();
  assert.equal((await h.task(first)).order.status, "delivered");
  await shot(courier, "courier-delivery-lost-ack");
  await click(courier, "إعادة محاولة العملية");
  await text(courier, "طلب #" + firstNumber + " · تم التسليم").waitFor();
  const earnings = (await h.req("/courier/earnings")).body;
  assert.equal(earnings.totalYer, "100");
  assert.equal(earnings.sources.length, 1);
  assert.equal(dropped, 1);
  results.push({
    name: "dispatch, multiple tasks, real cash, lost delivery acknowledgement, one commission",
    passed: true,
  });
  await click(courier, "بلاغ أو تعذر تسليم");
  await input(courier, "تفاصيل البلاغ", "بلاغ رحلة واجهة09 للطلب التالي");
  await upload(courier, "إضافة صورة اختيارية", "الصورة جاهزة");
  await click(courier, "مراجعة إرسال البلاغ");
  await click(courier, "تأكيد إرسال البلاغ");
  await text(
    courier,
    "استلم الخادم البلاغ؛ تتابعه الإدارة دون حظر آلي",
  ).waitFor();
  await shot(courier, "courier-report-attachment");
  const next = await h.submit();
  await click(admin, "قائمة الطلبات");
  await click(admin, "تحديث الطلبات");
  await click(admin, "مراجعة الطلب " + (await h.get(next)).order.order_number);
  await text(admin, "يوجد تنبيه سابق على العميل؛ لا حظر تلقائي.").waitFor();
  await text(admin, "بلاغ رحلة واجهة09 للطلب التالي").waitFor();
  await shot(admin, "admin-next-order-warning");
  results.push({
    name: "private courier attachment, prior flag warns before next confirmation",
    passed: true,
  });
  await click(customer, "متابعة التسوق");
  await customer.getByRole("tab", { name: "طلباتي", exact: true }).click();
  // Navigate through actual router controls to retain the in-memory web session.
  await click(customer, "تحديث الطلبات");
  await click(customer, "فتح الطلب " + firstNumber);
  await click(customer, "تقييم الطلب");
  await click(customer, "تقييم 5 من5");
  await input(customer, "ملاحظات التقييم (اختياري)", "تقييم واجهة09");
  await click(customer, "مراجعة التقييم");
  await click(customer, "تأكيد إرسال التقييم");
  await text(customer, "تقييمك 5/5").waitFor();
  await shot(customer, "customer-review");
  await click(customer, "العودة للطلب");
  await click(customer, "شكوى ومتابعة الرد");
  await input(customer, "تفاصيل الشكوى", "شكوى رحلة واجهة09");
  await upload(customer, "إرفاق صورة للشكوى (اختياري)", "الصورة جاهزة");
  await click(customer, "مراجعة الشكوى");
  await click(customer, "تأكيد إرسال الشكوى");
  await text(customer, "استلم الخادم الشكوى؛ ستجد رد الإدارة هنا").waitFor();
  await shot(customer, "customer-complaint");
  await click(admin, "قائمة الطلبات");
  await route(admin, "الجودة والشكاوى");
  await text(admin, "شكوى رحلة واجهة09").waitFor();
  await click(admin, "عرض المرفق الخاص");
  await shot(admin, "admin-complaint-attachment");
  await click(admin, "إغلاق المرفق");
  await click(admin, "مراجعة سجل " + firstNumber);
  await input(admin, "رد الإدارة", "رد09 تمت معالجة الشكوى");
  await click(admin, "محلول");
  await click(admin, "مراجعة حفظ الرد");
  await click(admin, "تأكيد حفظ الرد");
  await text(admin, "حفظ الخادم المراجعة").waitFor();
  await click(customer, "تحديث المتابعة");
  await text(customer, "رد الإدارة: رد09 تمت معالجة الشكوى").waitFor();
  results.push({
    name: "once-only order review and private complaint with administrative response",
    passed: true,
  });
  await route(admin, "الدفاتر");
  await click(admin, "اختيار موصل اختبار09");
  await text(admin, "مستحقات العمولة · المتبقي 100 ر.ي").waitFor();
  await click(admin, "تحديد قيد 100");
  await input(admin, "مرجع العملية المالية", "UI09-PAYOUT");
  await click(admin, "مراجعة صرف العمولة");
  await click(admin, "تأكيد العملية المالية");
  await text(admin, "مستحقات العمولة · المتبقي 0 ر.ي").waitFor();
  await shot(admin, "admin-commission-paid");
  await input(admin, "مرجع العملية المالية", "UI09-REVERSE");
  await input(admin, "سبب التصحيح أو العكس", "عكس تسوية اختبار موثق");
  await upload(admin, "رفع إثبات خاص للتصحيح أو العكس", "الإثبات جاهز");
  await click(admin, "مراجعة عكس UI09-PAYOUT");
  await click(admin, "تأكيد العملية المالية");
  await text(admin, "مستحقات العمولة · المتبقي 100 ر.ي").waitFor();
  await click(admin, "تحديد رصيد عكس 100");
  await input(admin, "مرجع العملية المالية", "UI09-REPAY");
  await click(admin, "مراجعة صرف العمولة");
  await click(admin, "تأكيد العملية المالية");
  await text(admin, "مستحقات العمولة · المتبقي 0 ر.ي").waitFor();
  await shot(admin, "admin-reversal-credit-repaid");
  await click(admin, "عرض نقد المتجر");
  await text(admin, "نقد المتجر · المتبقي 500 ر.ي").waitFor();
  await click(admin, "تحديد قيد 500");
  await input(admin, "مرجع العملية المالية", "UI09-REMIT");
  await click(admin, "مراجعة توريد النقد");
  await click(admin, "تأكيد العملية المالية");
  await text(admin, "نقد المتجر · المتبقي 0 ر.ي").waitFor();
  await shot(admin, "admin-cash-remitted");
  results.push({
    name: "payout, private reversal proof, single reusable credit and independent cash remittance",
    passed: true,
  });
  // Second task: actual shortage remains400 and produces an explicit exception.
  await route(courier, "العودة للمهمة");
  await route(courier, "المهام");
  await click(courier, "تحديث المهام");
  await click(
    courier,
    "فتح المهمة " + (await h.get(second)).order.order_number,
  );
  await click(courier, "بدء التوصيل");
  await click(courier, "تأكيد التنفيذ");
  await input(courier, "المبلغ النقدي المستلم فعليًا", "400");
  await input(courier, "مرجع التحصيل", "UI09-SHORT");
  await click(courier, "تسجيل التحصيل الفعلي");
  await click(courier, "تأكيد التنفيذ");
  await input(courier, "سبب نقص أو تعذر التحصيل", "تعذر تحصيل مئة ريال");
  await click(courier, "إبلاغ الإدارة بفرق النقد");
  await click(courier, "تأكيد التنفيذ");
  await button(courier, "اختيار استثناء 100 ر.ي").waitFor();
  await click(courier, "اختيار استثناء 100 ر.ي");
  await click(courier, "تم التسليم");
  await click(courier, "تأكيد التنفيذ");
  await text(courier, /· تم التسليم/).waitFor();
  await shot(courier, "courier-shortfall-delivered");
  assert.equal((await h.get(second)).paymentStatus, "cash_exception");
  results.push({
    name: "short cash delivery with explicit exception preserves actual collected amount",
    passed: true,
  });
  for (const theme of ["light", "dark"])
    for (const width of [360, 390, 1024]) {
      for (const [name, p] of [
        ["courier", courier],
        ["admin", admin],
        ["customer", customer],
      ] as const) {
        await p.emulateMedia({ colorScheme: theme as "light" | "dark" });
        await p.setViewportSize({ width, height: 900 });
        if (name === "courier") {
          await click(p, "مستحقاتي");
          await text(p, "غير المسدد: 100 ر.ي").waitFor();
        }
        await p.evaluate(() => document.fonts.ready);
        await shot(p, `${name}-${theme}-${width}`);
        assert(
          await p
            .locator('[data-testid="theme-' + theme + '"]')
            .filter({ visible: true })
            .count(),
        );
        const overflow = await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        );
        assert(!overflow, `${name} ${theme} ${width}: horizontal overflow`);
      }
      results.push({
        name: `theme ${theme}, width ${width}, three apps`,
        passed: true,
      });
    }
  assert.deepEqual(errors, []);
  assert.equal(external, 0);
  await writeFile(
    new URL("ui-checks.json", out),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        results,
        screenshots: shots,
        pageErrors: errors,
        externalProviderRequests: external,
        lostAcknowledgements: dropped,
        backend:
          "real HTTP and disposable PostgreSQL with limited runtime role",
        adapters: ["Capture OTP", "TestRouting", "TestStore"],
        nativeDevice: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      passed: results.length,
      screenshots: shots,
      pageErrors: errors,
      externalProviderRequests: external,
    }),
  );
} catch (e) {
  console.error("UI09 failed:", e instanceof Error ? e.message : "unknown");
  for (const [n, p] of context.pages().entries())
    await p
      .screenshot({
        path: "/workspace/.phase09-work/ui-failure-" + n + ".png",
        fullPage: true,
      })
      .catch(() => {});
  throw e;
} finally {
  await browser.close();
  await f.close();
}
