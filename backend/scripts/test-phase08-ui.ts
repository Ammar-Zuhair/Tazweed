// Real HTTP workflow and disposable PostgreSQL. No fake business DTOs or staging fixtures.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import sharp from "sharp";
import { fixture, pass } from "../tests/phase05/helpers.js";
import { seed } from "../tests/phase08/seed.js";
import { TestRouting } from "../tests/phase07/routing.js";
import { TestStore } from "../tests/phase06/store.js";
const out = new URL("../docs/progress/phase-08-evidence/", import.meta.url);
await mkdir(out, { recursive: true });
const store = new TestStore(),
  f = await fixture({ routingProvider: new TestRouting(), objectStore: store }),
  h = await seed(f, false);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  reducedMotion: "reduce",
  colorScheme: "light",
});
const errors: string[] = [],
  results: any[] = [];
let shots = 0,
  external = 0,
  dropSubmission = false,
  dropped = 0;
const imagePath = "/workspace/.phase08-work/receipt.png";
await sharp({
  create: { width: 300, height: 180, channels: 3, background: "#f6c188" },
})
  .png()
  .toFile(imagePath);
const text = (p: Page, t: string | RegExp) =>
  p.getByText(t).filter({ visible: true });
const button = (p: Page, t: string) =>
  p.getByRole("button", { name: t, exact: true }).filter({ visible: true });
const click = async (p: Page, t: string) => {
  console.log("UI08 action: " + t);
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
    if (u.pathname === "/api/v1/auth/login/verify" && r.status === 200)
      h.setTokens({
        [q.postDataJSON().app]: JSON.parse(body.toString()).accessToken,
      });
    if (
      dropSubmission &&
      u.pathname === "/api/v1/orders" &&
      q.method() === "POST" &&
      r.status === 200
    ) {
      dropSubmission = false;
      dropped++;
      await route.abort("connectionreset");
      return;
    }
    const responseHeaders = Object.fromEntries(r.headers);
    delete responseHeaders["content-length"];
    delete responseHeaders["content-encoding"];
    await route.fulfill({ status: r.status, headers: responseHeaders, body });
  });
  await p.route(/^https:\/\//, async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "isolated.test") {
      if (u.pathname.startsWith("/upload/")) {
        store.files.set(
          decodeURIComponent(u.pathname.slice("/upload/".length)),
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
async function login(p: Page, phone: string, wait: string) {
  await input(p, "رقم الجوال", phone);
  await input(p, "كلمة المرور", pass);
  await click(p, "متابعة");
  await p.getByRole("textbox", { name: "رمز التحقق", exact: true }).waitFor();
  await input(p, "رمز التحقق", f.provider.messages.at(-1)!.code);
  await click(p, "تحقق ومتابعة");
  await text(p, "أهلًا حساب اختبار صريح").waitFor();
  await button(p, wait).waitFor();
}
async function upload(p: Page, title: string) {
  const chooser = p.waitForEvent("filechooser");
  await click(p, title);
  await (await chooser).setFiles(imagePath);
  await text(
    p,
    title === "رفع إثبات تسوية خاص"
      ? "الإثبات متحقق وجاهز للربط"
      : "تم التحقق من الصورة؛ أرسل الإيصال لربطها بالتحويل",
  ).waitFor();
}
async function openAdmin(a: Page, id: string) {
  await click(a, "قائمة الطلبات");
  await click(a, "تحديث الطلبات");
  const d = await h.get(id);
  await click(a, "مراجعة الطلب " + d.order.order_number);
  await text(a, "طلب #" + d.order.order_number).waitFor();
}
async function adminQuote(a: Page, branch = "فرع أول", wholesale = false) {
  await click(a, branch);
  if (wholesale)
    await a
      .getByRole("textbox", { name: /^سعر زيت اختبار08 للوحدة .* للجملة$/ })
      .filter({ visible: true })
      .fill("80");
  await input(
    a,
    "سبب التسعير أو التغيير أو التجاوز اليدوي",
    "تسعيرة واجهة08 موثقة",
  );
  await click(a, "إصدار العرض وحجز المخزون");
  await text(a, "حفظ الخادم العملية").waitFor();
}
async function confirm(a: Page) {
  await click(a, "مراجعة التأكيد النهائي");
  await click(a, "تأكيد الطلب نهائيًا");
  await text(a, "مؤكد ·").first().waitFor();
}
try {
  const a = await context.newPage(),
    p = await context.newPage();
  await attach(a);
  await attach(p);
  await a.goto("http://127.0.0.1:8082/");
  await login(a, "770008002", "إدارة الطلبات والدفع");
  await click(a, "إدارة الطلبات والدفع");
  await p.goto("http://127.0.0.1:8081/auth");
  await login(p, "770008001", "متابعة التسوق");
  await click(p, "متابعة التسوق");
  await click(p, "محافظة اختبار08");
  await p
    .getByRole("textbox", { name: "الكمية", exact: true })
    .first()
    .fill("1");
  await click(p, "فتح السلة ومعاينة السعر");
  await click(p, "منزل اختبار08");
  await click(p, "تحويل بنكي");
  await click(p, "إرسال الطلب إلى المتجر");
  await p.waitForURL(/\/order\?id=/);
  const first = new URL(p.url()).searchParams.get("id")!;
  let d = await h.get(first);
  await click(a, "تحديث الطلبات");
  await click(a, "مراجعة الطلب " + d.order.order_number);
  await adminQuote(a);
  await click(a, "مراجعة التأكيد النهائي");
  await click(a, "تأكيد الطلب نهائيًا");
  await text(a, "يلزم قبول العميل لأحدث عرض").waitFor();
  await shot(a, "admin-quote-awaiting-accept-light-390");
  // Equal price branch replacement is a new revision, then explicit customer acceptance.
  await adminQuote(a, "فرع ثان");
  await click(p, "تحديث حالة الطلب");
  await text(p, /العرض الحالي · النسخة2/).waitFor();
  await shot(p, "customer-quote-revision-light-390");
  await click(p, "أوافق على هذا العرض والفرع");
  await click(p, "جهة اختبار غير قابلة للدفع");
  await click(p, "إظهار تعليمات التحويل المثبتة");
  await text(p, "رقم التحويل إليه: TEST-08-NOT-PAYABLE").waitFor();
  await shot(p, "customer-frozen-instructions-light-390");
  d = await h.get(first);
  await input(p, "رقم التحويل الفعلي", "UI08-FIRST");
  await input(p, "المبلغ المحول بالريال", d.quotes[0].total_yer);
  await upload(p, "اختيار صورة الإيصال ورفعها");
  await click(p, "إرسال الإيصال للمراجعة");
  await text(p, /الإيصال يحمي السعر والحجز/).waitFor();
  await click(a, "تحديث بيانات الطلب");
  await click(a, "مراجعة أحدث صورة لهذا التحويل");
  await click(a, "الصورة مرفوضة");
  await input(
    a,
    "سبب قرار مراجعة الإيصال والحجز",
    "الصورة غير واضحة؛ الحجز يبقى محميًا",
  );
  await click(a, "إبقاء الحجز محميًا للتصحيح");
  await click(a, "حفظ مراجعة الإيصال وقرار الحجز");
  await text(a, "الصورة غير واضحة؛ الحجز يبقى محميًا").waitFor();
  await shot(a, "admin-image-rejected-protected-light-390");
  await click(p, "تحديث حالة الطلب");
  await click(p, "تصحيح صورة هذا التحويل");
  await upload(p, "اختيار صورة الإيصال ورفعها");
  await click(p, "إرسال الصورة المصححة لنفس التحويل");
  await text(p, "الصورة2: بانتظار المراجعة ·").waitFor();
  await shot(p, "customer-corrected-image-light-390");
  await click(a, "تحديث بيانات الطلب");
  await click(a, "مراجعة أحدث صورة لهذا التحويل");
  await click(a, "التحويل معتمد");
  await input(a, "المبلغ المتحقق منه بالريال", d.quotes[0].total_yer);
  await input(
    a,
    "سبب قرار مراجعة الإيصال والحجز",
    "تحقق معزول من التحويل المطابق",
  );
  await click(a, "إبقاء الحجز للاستهلاك عند التأكيد");
  await click(a, "حفظ مراجعة الإيصال وقرار الحجز");
  await text(a, "تحويل معتمد · المعتمد").waitFor();
  await confirm(a);
  await shot(a, "admin-confirmed-transfer-light-390");
  await click(p, "تحديث حالة الطلب");
  await text(p, "مؤكد · انتهت المراجعة").waitFor();
  assert.equal(await button(p, "إلغاء قبل التأكيد").count(), 0);
  await shot(p, "customer-confirmed-transfer-light-390");
  d = await h.get(first);
  assert.equal(d.payments.length, 1);
  assert.equal(d.payments[0].attempts.length, 2);
  assert.equal(d.order.status, "confirmed");
  results.push({
    scenario:
      "retail transfer revision/acceptance/frozen instructions/upload/image correction/verification/confirmation",
    passed: true,
  });
  // Lose the server acknowledgement after commit, then retry the same saved key through the UI.
  await click(p, "العودة إلى طلباتي");
  await p.getByRole("tab", { name: "الرئيسية", exact: true }).click();
  await p
    .getByRole("textbox", { name: "الكمية", exact: true })
    .first()
    .fill("1");
  await click(p, "فتح السلة ومعاينة السعر");
  await click(p, "منزل اختبار08");
  await click(p, "جملة");
  await click(p, "نقد عند الاستلام");
  dropSubmission = true;
  await click(p, "إرسال الطلب إلى المتجر");
  await button(p, "إعادة إرسال الطلب المحفوظ").waitFor();
  await click(p, "إعادة إرسال الطلب المحفوظ");
  await p.waitForURL(/\/order\?id=/);
  const second = new URL(p.url()).searchParams.get("id")!;
  assert.notEqual(second, first);
  assert.equal(
    (await f.owner.query("SELECT count(*)::int n FROM orders")).rows[0].n,
    2,
  );
  await openAdmin(a, second);
  await adminQuote(a, "فرع أول", true);
  await click(p, "تحديث حالة الطلب");
  await click(p, "أوافق على هذا العرض والفرع");
  await shot(p, "customer-wholesale-cod-accepted-light-390");
  await click(a, "تحديث بيانات الطلب");
  await confirm(a);
  await click(p, "تحديث حالة الطلب");
  await text(p, "مؤكد · انتهت المراجعة").waitFor();
  await text(
    p,
    "المبلغ مستحق عند الاستلام؛ التأكيد لا يعني التحصيل.",
  ).waitFor();
  d = await h.get(second);
  assert.equal(d.payments.length, 0);
  assert.equal(d.cashCollected, false);
  assert.equal(d.order.status, "confirmed");
  assert.equal(dropped, 1);
  results.push({
    scenario:
      "wholesale COD without receipt and lost acknowledgement retry creates one order",
    passed: true,
  });
  // Finance form uses a third order prepared through real HTTP, never injected UI state.
  const third = await h.submit("retail", "transfer");
  await h.quote(third);
  await h.accept(third);
  const pid = await h.receipt(third, "400");
  assert.equal(
    (await h.review(third, pid, "transfer_verified", "400")).status,
    200,
  );
  await openAdmin(a, third);
  await click(a, "اختيار استثناء نقص مبلغ");
  await input(a, "مبلغ الاستثناء أو التسوية بالريال", "100");
  await input(a, "سبب الاستثناء أو التسوية", "استلام خارجي مثبت للمبلغ الناقص");
  await click(a, "استلام خارجي من العميل");
  await input(a, "مرجع التسوية الخارجية", "UI08-EXTERNAL-100");
  await upload(a, "رفع إثبات تسوية خاص");
  await click(a, "تسجيل التسوية الخارجية");
  await text(
    a,
    "استلام خارجي من العميل · 100 ر.ي · المرجعUI08-EXTERNAL-100",
  ).waitFor();
  await shot(a, "admin-external-settlement-light-390");
  await click(a, "إغلاق الاستثناء بعد التسوية");
  await text(a, /نقص مبلغ · 100 ر.ي · مسوى/).waitFor();
  await confirm(a);
  results.push({
    scenario:
      "underpayment external settlement/private proof/exception closure and confirmation via admin UI",
    passed: true,
  });
  // Current editable detail at each theme and size, with the same real backend data.
  const pending = await h.submit();
  await h.quote(pending);
  await openAdmin(a, pending);
  await click(p, "العودة إلى طلباتي");
  await click(p, "تحديث الطلبات");
  d = await h.get(pending);
  await click(p, "فتح الطلب " + d.order.order_number);
  for (const theme of ["light", "dark"] as const)
    for (const width of [360, 390, 1024]) {
      for (const page of [p, a]) {
        await page.setViewportSize({
          width,
          height: width === 1024 ? 900 : 844,
        });
        await page.emulateMedia({ colorScheme: theme });
        await page
          .getByTestId("theme-" + theme)
          .filter({ visible: true })
          .waitFor();
        await page.evaluate(() => document.fonts.ready);
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
      }
      await shot(p, `customer-pending-${theme}-${width}`);
      await shot(a, `admin-review-${theme}-${width}`);
      results.push({
        scenario: "customer/admin order review responsive",
        theme,
        width,
        passed: true,
        horizontalOverflow: false,
      });
    }
  await click(a, "قائمة الطلبات");
  await click(a, "وسائل التحويل");
  await text(a, "بيانات الجهة والمستفيد يديرها الخادم").waitFor();
  await shot(a, "admin-payment-methods-dark-1024");
  assert.deepEqual(errors, []);
  assert.equal(external, 0);
  for (const table of [
    "cash_collections",
    "order_assignments",
    "courier_earnings",
  ])
    assert.equal(
      Number(
        (await f.owner.query(`SELECT count(*) n FROM ${table}`)).rows[0].n,
      ),
      0,
    );
  await writeFile(
    new URL("ui-checks.json", out),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        database: "isolated real PostgreSQL",
        otp: "in-process CaptureProvider",
        routing: "in-process TestRouting, not real roads",
        storage:
          "in-process TestStore; image verification/processing is real, not R2",
        nativePhoneTested: false,
        externalProviderRequests: external,
        pageErrors: errors,
        screenshots: shots,
        lostAcknowledgements: dropped,
        results,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      passed: true,
      scenarios: results.length,
      screenshots: shots,
    }),
  );
} catch (e) {
  console.error("UI08 failed:", e instanceof Error ? e.message : "unknown");
  for (const [n, p] of context.pages().entries())
    await p
      .screenshot({
        path: "/workspace/.phase08-work/ui-failure-" + n + ".png",
        fullPage: true,
      })
      .catch(() => {});
  throw e;
} finally {
  await browser.close();
  await f.close();
}
