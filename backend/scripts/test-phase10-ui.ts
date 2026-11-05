import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import { fixture, pass } from "../tests/phase05/helpers.js";
import { seed } from "../tests/phase09/seed.js";
import { TestRouting } from "../tests/phase07/routing.js";
import { TestStore } from "../tests/phase06/store.js";
import { dispatchCampaigns, projectOutbox } from "../src/engagement/worker.js";
const out = new URL("../docs/progress/phase-10-evidence/", import.meta.url);
await mkdir(out, { recursive: true });
const f = await fixture({
    routingProvider: new TestRouting(),
    objectStore: new TestStore(),
  }),
  h = await seed(f, false),
  browser = await chromium.launch({ headless: true }),
  context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: "light",
    reducedMotion: "reduce",
  });
const errors: string[] = [],
  results: any[] = [];
let screenshots = 0,
  external = 0,
  dropCampaign = false,
  dropped = 0,
  nativeBuild: number | null = null;
const text = (p: Page, t: string | RegExp) =>
  p.getByText(t).filter({ visible: true });
const button = (p: Page, t: string) =>
  p.getByRole("button", { name: t, exact: true }).filter({ visible: true });
async function click(p: Page, t: string) {
  console.log("UI10 " + t);
  await button(p, t).click();
}
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
  screenshots++;
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
    if (
      nativeBuild !== null &&
      u.pathname === "/api/v1/public/config" &&
      u.searchParams.get("app") === "customer"
    )
      u.searchParams.set("build", String(nativeBuild));
    const r = await fetch(f.origin + u.pathname + u.search, {
        method: q.method(),
        headers,
        ...(["GET", "HEAD"].includes(q.method())
          ? {}
          : { body: q.postDataBuffer() ?? undefined }),
      }),
      body = Buffer.from(await r.arrayBuffer());
    if (u.pathname === "/api/v1/auth/login/verify" && r.status === 200) {
      const a = q.postDataJSON().app,
        t = JSON.parse(body.toString()).accessToken;
      if (a === "courier") h.setCourierTokens(t);
      else h.setTokens({ [a]: t });
    }
    if (
      dropCampaign &&
      u.pathname === "/api/v1/admin/campaigns" &&
      q.method() === "POST" &&
      r.status === 200
    ) {
      dropCampaign = false;
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
  await text(p, /أهلًا (حساب اختبار صريح|موصل اختبار09)/).waitFor();
}
async function nav(p: Page, path: string) {
  if (path === "/notifications") {
    if (await button(p, "تحديث الإشعارات").count()) return;
    if (await button(p, "مركز الإشعارات").count())
      await click(p, "مركز الإشعارات");
    else if (p.url().includes(":8081/")) {
      await p
        .getByRole("tab", { name: "حسابي", exact: true })
        .filter({ visible: true })
        .click();
      await click(p, "مركز الإشعارات");
    } else await click(p, "إشعاراتي");
  } else if (path === "/operations") {
    if (await button(p, "مراجعة الصيانة").count()) return;
    if (!(await button(p, "الصيانة والإصدارات").count()))
      await click(p, "الرئيسية");
    await click(p, "الصيانة والإصدارات");
  } else if (path === "/") {
    if (await button(p, "الرئيسية").count()) await click(p, "الرئيسية");
    else if (await button(p, "المهام").count()) await click(p, "المهام");
    else await click(p, "متابعة التسوق");
  }
  await p.waitForTimeout(400);
}
try {
  const customer = await context.newPage(),
    admin = await context.newPage(),
    courier = await context.newPage();
  for (const p of [customer, admin, courier]) await attach(p);
  await customer.goto("http://127.0.0.1:8081/auth");
  await login(customer, h.customer.phone_e164);
  await admin.goto("http://127.0.0.1:8082/");
  await login(admin, h.staff.phone_e164);
  await courier.goto("http://127.0.0.1:8083/account");
  await login(courier, h.courier.phone_e164);
  await click(admin, "البث والجدولة");
  await input(admin, "عنوان البث", "عرض اختبار10 للمراجعة");
  await input(admin, "نص البث", "رسالة من اختبار معزول؛ لا إرسال Push حقيقي.");
  await click(admin, "مراجعة حفظ مسودة البث");
  dropCampaign = true;
  await click(admin, "تنفيذ قرار البث");
  await button(admin, "إعادة محاولة إجراء البث المحفوظ").waitFor();
  await shot(admin, "campaign-lost-ack");
  await click(admin, "إعادة محاولة إجراء البث المحفوظ");
  await text(admin, "عرض اختبار10 للمراجعة").first().waitFor();
  assert.equal(
    (await f.owner.query("SELECT count(*)::int n FROM notification_campaigns"))
      .rows[0].n,
    1,
  );
  results.push({
    name: "campaign draft lost acknowledgement retries same key once",
    passed: true,
  });
  await input(
    admin,
    "موعد البث UTC (ISO 8601)",
    new Date(Date.now() + 2000).toISOString(),
  );
  await click(admin, "مراجعة جدولة البث");
  await click(admin, "تنفيذ قرار البث");
  await text(admin, /مجدولة/).waitFor();
  await shot(admin, "campaign-scheduled");
  await admin.waitForTimeout(2200);
  await dispatchCampaigns(f.pool, f.config);
  await click(admin, "تحديث الحملات");
  await text(admin, /^اكتمل إنشاء الرسائل/).waitFor();
  await shot(admin, "campaign-projected");
  results.push({
    name: "scheduled audience persisted in backend inbox with explicit push limit",
    passed: true,
  });
  await nav(customer, "/notifications");
  await text(customer, "عرض اختبار10 للمراجعة").waitFor();
  await click(customer, "تحديد كمقروء");
  await shot(customer, "customer-inbox-read");
  await text(customer, /نسخة أصلية مهيأة/).waitFor();
  await click(customer, "كتم صوت التنبيهات");
  await button(customer, "تشغيل صوت التنبيهات").waitFor();
  results.push({
    name: "customer inbox read state and sound preference, Go/web limitation visible",
    passed: true,
  });
  const id = await h.confirmed();
  await h.assign(id);
  await projectOutbox(f.pool, f.config, 100);
  await nav(courier, "/notifications");
  await text(courier, "مهمة توصيل جديدة").waitFor();
  await shot(courier, "courier-assignment-inbox");
  await click(courier, "فتح الطلب");
  await text(courier, /عمولة هذا الإسناد/).waitFor();
  results.push({
    name: "courier assignment inbox opens current scoped task",
    passed: true,
  });
  await nav(admin, "/notifications");
  await text(admin, "وصل طلب جديد للمراجعة.").waitFor();
  await shot(admin, "admin-order-inbox");
  results.push({
    name: "staff inbox order event scoped to action and branch",
    passed: true,
  });
  await nav(admin, "/operations");
  await button(admin, "مراجعة الصيانة").waitFor();
  await click(admin, "الصيانة متوقفة؛ اضغط لتفعيلها");
  await input(
    admin,
    "رسالة الصيانة",
    "نجري صيانة اختبار10؛ طلباتك الجارية متاحة.",
  );
  await click(admin, "مراجعة الصيانة");
  await click(admin, "حفظ إعداد التشغيل");
  await button(admin, "الصيانة مفعّلة؛ اضغط لإيقافها").waitFor();
  await shot(admin, "maintenance-admin-enabled");
  await click(customer, "فحص حالة التشغيل");
  await nav(customer, "/");
  await text(customer, "تزويد يعود إليك قريبًا").waitFor();
  await shot(customer, "customer-maintenance");
  await click(customer, "متابعة طلباتي");
  await text(customer, "طلباتي").first().waitFor();
  await shot(customer, "customer-ongoing-during-maintenance");
  await nav(courier, "/");
  await text(courier, /المهام/)
    .first()
    .waitFor();
  await shot(courier, "courier-unaffected");
  results.push({
    name: "customer maintenance gates new catalog only, ongoing and courier/admin remain active",
    passed: true,
  });
  await input(admin, "الحد الأدنى للبناء", "9");
  await input(admin, "أحدث رقم بناء", "11");
  await input(admin, "اسم الإصدار", "1.1.0");
  await input(
    admin,
    "رابط المتجر",
    "https://play.google.com/store/apps/details?id=org.isolated.customer",
  );
  await input(admin, "رسالة التحديث", "تحديث اختبار10 للنسخة الأصلية.");
  await click(admin, "تأكيد التحقق من توفر النسخة ورابط المتجر");
  await click(admin, "مراجعة حدود الإصدار");
  await click(admin, "حفظ إعداد التشغيل");
  await text(admin, "الحد الحالي 9 / الأحدث 11").waitFor();
  await shot(admin, "release-bounds-staging");
  // Browser harness selects a native build at the real config API; this is not a phone test.
  await nav(customer, "/notifications");
  nativeBuild = 8;
  await click(customer, "فحص حالة التشغيل");
  await text(customer, "يلزم تحديث التطبيق").waitFor();
  await shot(customer, "required-update-native-build-simulation");
  nativeBuild = 10;
  await click(customer, "إعادة التحقق");
  await button(customer, "لاحقًا").waitFor();
  await shot(customer, "optional-update-native-build-simulation");
  await click(customer, "لاحقًا");
  results.push({
    name: "required/optional native build config rendered by browser harness, no store or OTA contacted",
    passed: true,
  });
  nativeBuild = null;
  await click(admin, "الصيانة مفعّلة؛ اضغط لإيقافها");
  await click(admin, "مراجعة الصيانة");
  await click(admin, "حفظ إعداد التشغيل");
  await button(admin, "الصيانة متوقفة؛ اضغط لتفعيلها").waitFor();
  for (const theme of ["light", "dark"])
    for (const width of [360, 390, 1024]) {
      for (const [role, p, port] of [
        ["customer", customer, 8081],
        ["admin", admin, 8082],
        ["courier", courier, 8083],
      ] as const) {
        await p.emulateMedia({ colorScheme: theme as any });
        await p.setViewportSize({ width, height: 844 });
        await nav(p, role === "admin" ? "/operations" : "/notifications");
        await text(
          p,
          role === "admin" ? "الصيانة والإصدارات" : "مركز الإشعارات",
        )
          .first()
          .waitFor();
        await p.evaluate(() => {
          for (const e of document.querySelectorAll("*"))
            if (e.scrollHeight > e.clientHeight + 20) e.scrollTop = 0;
        });
        await p
          .getByTestId("theme-" + theme)
          .filter({ visible: true })
          .waitFor();
        assert(
          !(await p.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          )),
          `${role}/${theme}/${width}: horizontal overflow`,
        );
        await shot(p, `${role}-${theme}-${width}`);
      }
    }
  results.push({
    name: "three apps light/dark at 360,390,1024 with no runtime errors",
    passed: true,
  });
  assert.deepEqual(errors, []);
  assert.equal(external, 0);
  assert.equal(dropped, 1);
  await writeFile(
    new URL("ui-checks.json", out),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        results,
        screenshots,
        pageErrors: errors,
        externalProviderRequests: external,
        lostAcknowledgements: dropped,
        backend:
          "real HTTP/PostgreSQL, limited runtime role, isolated OTP/routing/storage adapters",
        nativeBuildGate:
          "browser forwards explicit native build numbers to real config API for gate screenshots",
        nativePhoneTested: false,
        realPushTested: false,
        otaPublished: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      passed: results.length,
      screenshots,
      pageErrors: errors,
      externalProviderRequests: external,
    }),
  );
} catch (e) {
  for (const [i, p] of context.pages().entries())
    await p
      .screenshot({
        path: "/workspace/.phase10-work/ui-failure-" + i + ".png",
        fullPage: true,
      })
      .catch(() => {});
  throw e;
} finally {
  await browser.close();
  await f.close();
}
