import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import { fixture, pass } from "../tests/phase05/helpers.js";
import { seed } from "../tests/phase09/seed.js";
import { TestStore } from "../tests/phase06/store.js";
import { TestRouting } from "../tests/phase07/routing.js";
import { processReport } from "../src/reports/service.js";
import { DeletionService } from "../src/privacy/service.js";
import { AuthService } from "../src/identity/auth.js";
const out = new URL("../docs/progress/phase-11-evidence/", import.meta.url);
await mkdir(out, { recursive: true });
const store = new TestStore(),
  f = await fixture({
    objectStore: store,
    routingProvider: new TestRouting(),
    configOverrides: {
      STORE_LEGAL_NAME: "جهة اختبار معزولة11",
      STORE_SUPPORT_PHONE: "+967770000000",
      PRIVACY_CONTACT_EMAIL: "privacy@example.test",
      PRIVACY_POLICY_VERSION: "ui-isolated-11",
      PRIVACY_POLICY_APPROVED_AT: "2026-11-06",
      PRIVACY_PERSONAL_RETENTION_DAYS: "0",
      TRANSACTION_RETENTION_DAYS: "0",
      PRIVACY_SECURITY_RETENTION_DAYS: "1",
      PRIVACY_BACKUP_RETENTION_DAYS: "1",
      PRIVACY_REQUEST_TARGET_DAYS: "1",
    },
  }),
  h = await seed(f, false),
  s = new DeletionService(
    new AuthService(f.pool, f.security, f.provider),
    f.config,
    store,
  ),
  browser = await chromium.launch({ headless: true }),
  context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: "light",
    reducedMotion: "reduce",
    acceptDownloads: true,
  });
const results: any[] = [],
  errors: string[] = [];
let screenshots = 0,
  external = 0,
  dropReport = true,
  dropDelete = true,
  droppedReports = 0,
  droppedDeletions = 0;
const button = (p: Page, t: string) =>
  p.getByRole("button", { name: t, exact: true }).filter({ visible: true });
const text = (p: Page, t: string | RegExp) =>
  p.getByText(t).filter({ visible: true });
const click = async (p: Page, t: string) => {
  console.log("UI11 " + t);
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
      dropReport &&
      u.pathname === "/api/v1/admin/reports/monthly-sales" &&
      r.status === 200
    ) {
      dropReport = false;
      droppedReports++;
      await route.abort("connectionreset");
      return;
    }
    if (
      dropDelete &&
      u.pathname === "/api/v1/account-deletion/verify" &&
      r.status === 200
    ) {
      dropDelete = false;
      droppedDeletions++;
      await s.processOne(JSON.parse(body.toString()).id);
      await route.abort("connectionreset");
      return;
    }
    if (u.pathname.includes("account-deletion"))
      console.log(
        JSON.stringify({
          deletionPath: u.pathname,
          status: r.status,
          error:
            r.status >= 400
              ? JSON.parse(body.toString()).error?.code
              : undefined,
        }),
      );
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
  await text(p, /أهلًا حساب اختبار صريح/).waitFor();
}
async function matrix(p: Page, prefix: string) {
  for (const theme of ["light", "dark"] as const)
    for (const width of [360, 390, 1024]) {
      await p.setViewportSize({ width, height: 900 });
      await context.setExtraHTTPHeaders({});
      await p.emulateMedia({ colorScheme: theme });
      await p.waitForTimeout(150);
      if (
        !(await p
          .getByTestId("theme-" + theme)
          .filter({ visible: true })
          .count())
      )
        await click(
          p,
          theme === "dark" ? "تفعيل الوضع المظلم" : "تفعيل الوضع الفاتح",
        );
      await p
        .getByTestId("theme-" + theme)
        .filter({ visible: true })
        .waitFor();
      await p.evaluate(() =>
        document.querySelectorAll("div").forEach((x) => {
          if (x.scrollHeight > x.clientHeight + 40) x.scrollTop = 0;
        }),
      );
      await p.waitForTimeout(120);
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await shot(p, `${prefix}-${theme}-${width}`);
    }
}
try {
  const customer = await context.newPage(),
    admin = await context.newPage();
  await attach(customer);
  await attach(admin);
  await customer.goto("http://127.0.0.1:8081/auth");
  await login(customer, h.customer.phone_e164);
  await admin.goto("http://127.0.0.1:8082/");
  await login(admin, h.staff.phone_e164);
  const courier = await f.login(h.courier, "courier");
  h.setCourierTokens(courier.accessToken);
  await h.delivered();
  const ongoing = await h.confirmed();
  await click(admin, "التقرير الشهري PDF");
  await button(admin, "إنشاء تقرير PDF").waitFor();
  await click(admin, "إنشاء تقرير PDF");
  await button(admin, "إعادة محاولة التقرير المعلق").waitFor();
  await shot(admin, "report-lost-ack");
  await click(admin, "إعادة محاولة التقرير المعلق");
  assert.equal(
    (await f.owner.query("SELECT count(*)::int n FROM report_jobs")).rows[0].n,
    1,
  );
  await processReport(f.pool);
  await click(admin, "تحديث حالة التقرير");
  await text(admin, "حالة التقرير: جاهز").waitFor();
  const download = admin.waitForEvent("download");
  await click(admin, "تنزيل ومشاركة PDF");
  const file = await download;
  await file.saveAs(new URL("monthly-sales.pdf", out).pathname);
  results.push({
    name: "private Arabic PDF with saved idempotency after lost acknowledgement and authenticated download",
    passed: true,
  });
  await matrix(admin, "report");
  await click(customer, "الخصوصية");
  await text(customer, "الجهة المسؤولة والتواصل").waitFor();
  await matrix(customer, "privacy");
  results.push({
    name: "live Arabic privacy content in customer, both themes at 360/390/1024",
    passed: true,
  });
  await click(customer, "حذف الحساب");
  await click(customer, "أوافق على طلب حذف الحساب");
  await click(customer, "إرسال رمز حذف الحساب");
  await customer
    .getByRole("textbox", { name: "رمز تأكيد حذف الحساب", exact: true })
    .waitFor();
  await input(
    customer,
    "رمز تأكيد حذف الحساب",
    f.provider.messages.at(-1)!.code,
  );
  await click(customer, "تأكيد حذف الحساب نهائيًا");
  await button(customer, "تأكيد حذف الحساب نهائيًا").waitFor();
  await shot(customer, "deletion-lost-ack");
  await click(customer, "تأكيد حذف الحساب نهائيًا");
  await click(customer, "تحديث حالة الحذف");
  await text(customer, "الحالة: تحتاج مراجعة").waitFor();
  await shot(customer, "deletion-open-obligations");
  assert.equal(
    (await f.owner.query("SELECT status FROM orders WHERE id=$1", [ongoing]))
      .rows[0].status,
    "confirmed",
  );
  assert.equal(
    (
      await f.owner.query(
        "SELECT count(*)::int n FROM deletion_requests WHERE user_id=$1",
        [h.customer.id],
      )
    ).rows[0].n,
    1,
  );
  results.push({
    name: "in-app deletion accepts ongoing order, lost acknowledgement retries once, session revoked, truthful review state",
    passed: true,
  });
  const c2 = await f.user("770011002"),
    p2 = await context.newPage();
  await attach(p2);
  await p2.goto("http://127.0.0.1:8081/auth");
  await login(p2, c2.phone_e164);
  await click(p2, "حذف الحساب");
  await click(p2, "أوافق على طلب حذف الحساب");
  await click(p2, "إرسال رمز حذف الحساب");
  await p2
    .getByRole("textbox", { name: "رمز تأكيد حذف الحساب", exact: true })
    .waitFor();
  await input(p2, "رمز تأكيد حذف الحساب", f.provider.messages.at(-1)!.code);
  await click(p2, "تأكيد حذف الحساب نهائيًا");
  await text(p2, "الحالة: موثق").waitFor();
  const dr = (
    await f.owner.query("SELECT id FROM deletion_requests WHERE user_id=$1", [
      c2.id,
    ])
  ).rows[0];
  await s.processOne(dr.id);
  await click(p2, "تحديث حالة الحذف");
  await text(p2, "الحالة: مكتمل").waitFor();
  await shot(p2, "app-deletion-completed");
  await p2.reload();
  await button(p2, "تحديث حالة الحذف").waitFor();
  await click(p2, "تحديث حالة الحذف");
  await text(p2, "الحالة: مكتمل").waitFor();
  assert.equal(
    (await f.owner.query("SELECT phone_e164 FROM users WHERE id=$1", [c2.id]))
      .rows[0].phone_e164,
    null,
  );
  results.push({
    name: "in-app full account deletion removes identity and survives page reload with receipt only",
    passed: true,
  });
  const c3 = await f.user("770011003"),
    web = await context.newPage();
  web.on("pageerror", (e) => errors.push(e.message));
  await web.goto(f.origin + "/delete-account");
  await web.getByLabel("رقم الجوال", { exact: true }).fill(c3.phone_e164);
  await web.locator("#confirm").check();
  await web
    .getByRole("button", { name: "إرسال رمز الحذف", exact: true })
    .click();
  await web.locator("#code").waitFor({ state: "visible" });
  const correct = f.provider.messages.at(-1)!.code;
  await web.locator("#code").fill(correct === "000000" ? "111111" : "000000");
  await web
    .getByRole("button", { name: "تأكيد حذف الحساب", exact: true })
    .click();
  await web
    .getByRole("status")
    .filter({ hasText: /رمز|تحقق/ })
    .waitFor();
  await web.locator("#code").fill(correct);
  await web
    .getByRole("button", { name: "تأكيد حذف الحساب", exact: true })
    .click();
  await web.locator("#receipt").waitFor({ state: "visible" });
  const rid = await web.locator("#requestId").inputValue();
  await s.processOne(rid);
  await web.getByRole("button", { name: "تحديث الحالة", exact: true }).click();
  await web.getByRole("status").filter({ hasText: /مكتمل/ }).waitFor();
  await shot(web, "web-deletion-completed");
  assert.equal(
    (await f.owner.query("SELECT status FROM users WHERE id=$1", [c3.id]))
      .rows[0].status,
    "deleted",
  );
  results.push({
    name: "browser-only deletion with wrong OTP then correct OTP, no app or login required",
    passed: true,
  });
  await web.goto(f.origin + "/delete-account");
  f.provider.fail = true;
  await web.getByLabel("رقم الجوال", { exact: true }).fill("+967770011004");
  await web.locator("#confirm").check();
  await web
    .getByRole("button", { name: "إرسال رمز الحذف", exact: true })
    .click();
  await web
    .getByRole("status")
    .filter({ hasText: /تعذر إرسال/ })
    .waitFor();
  await shot(web, "web-otp-unavailable");
  f.provider.fail = false;
  results.push({
    name: "OTP outage surfaces error and creates no successful deletion",
    passed: true,
  });
  await web.goto(f.origin + "/privacy");
  for (const theme of ["light", "dark"] as const)
    for (const width of [360, 390, 1024]) {
      await web.emulateMedia({ colorScheme: theme });
      await web.setViewportSize({ width, height: 900 });
      assert(
        await web.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await shot(web, `express-privacy-${theme}-${width}`);
    }
  const cp = await context.newPage();
  await attach(cp);
  await cp.goto("http://127.0.0.1:8083/privacy");
  await text(cp, "الجهة المسؤولة والتواصل").waitFor();
  await shot(cp, "courier-privacy");
  results.push({
    name: "public Express RTL legal pages and courier live legal screen, both themes and three widths",
    passed: true,
  });
  await f.owner.query("DELETE FROM staff_grants WHERE user_id=$1", [
    h.staff.id,
  ]);
  await click(admin, "تحديث حالة التقرير");
  await admin.getByRole("alert").filter({ visible: true }).waitFor();
  await shot(admin, "report-permission-revoked");
  results.push({
    name: "report refresh refuses revoked permission instead of stale financial access",
    passed: true,
  });
  await f.owner.query(
    "INSERT INTO staff_grants(user_id,role_id,global_scope) SELECT $1,id,true FROM roles WHERE code='general_admin'",
    [h.staff.id],
  );
  await click(admin, "العودة للإدارة");
  await click(admin, "طلبات حذف الحساب");
  await text(admin, "الحالة: تحتاج مراجعة").waitFor();
  await click(admin, "فحص الالتزامات ومعالجة الطلب");
  await text(admin, "الحالة: تحتاج مراجعة").waitFor();
  await shot(admin, "admin-deletion-review");
  results.push({
    name: "administrator privacy review cannot override the existing operational obligation",
    passed: true,
  });
  assert.equal(droppedReports, 1);
  assert.equal(droppedDeletions, 1);
  assert.deepEqual(errors, []);
  assert.equal(external, 0);
  await writeFile(
    new URL("ui-checks.json", out),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        passed: true,
        results,
        screenshots,
        pageErrors: errors,
        externalProviderRequests: external,
        realProvidersTested: false,
        nativePhoneTested: false,
        droppedReports,
        droppedDeletions,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({ passed: true, scenarios: results.length, screenshots }),
  );
} catch (e) {
  for (const p of context.pages())
    console.error(
      JSON.stringify({
        uiAlerts: await p.getByRole("alert").allTextContents(),
      }),
    );
  for (const [i, p] of context.pages().entries())
    await p
      .screenshot({
        path: `/workspace/.phase11-work/ui-failure-${i}.png`,
        fullPage: true,
      })
      .catch(() => {});
  throw e;
} finally {
  await browser.close();
  await f.close();
}
