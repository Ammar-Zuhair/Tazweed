// Real isolated identity API: hold an actual refresh acknowledgement across logout/login.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { fixture, pass } from "../tests/phase05/helpers.js";
import { seed } from "../tests/phase08/seed.js";
const f = await fixture(),
  h = await seed(f, false),
  other = await f.user("770008099");
await f.owner.query("UPDATE users SET name_ar='حساب ثان معزول' WHERE id=$1", [
  other.id,
]);
const browser = await chromium.launch({ headless: true }),
  page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
let force401 = false,
  holdRefresh = false,
  released = false,
  release!: () => void,
  held!: () => void;
const releaseSignal = new Promise<void>((r) => (release = r)),
  heldSignal = new Promise<void>((r) => (held = r));
const button = (name: string) =>
  page.getByRole("button", { name, exact: true }).filter({ visible: true });
const text = (value: string) =>
  page.getByText(value, { exact: true }).filter({ visible: true });
const click = async (name: string) => {
  console.log("Auth UI08 action: " + name);
  await button(name).click();
};
const input = (name: string, value: string) =>
  page
    .getByRole("textbox", { name, exact: true })
    .filter({ visible: true })
    .fill(value);
await page.route("**/api/v1/**", async (route) => {
  const q = route.request(),
    url = new URL(q.url());
  // Transport fault only; all successful identity/order DTOs come from the real isolated backend.
  if (force401 && url.pathname === "/api/v1/orders" && q.method() === "GET") {
    force401 = false;
    await route.fulfill({
      status: 401,
      json: {
        error: {
          code: "AUTH_FAILED",
          message: "جلسة تحتاج تجديدًا للاختبار",
          details: null,
          requestId: "00000000-0000-4000-8000-000000000008",
        },
      },
    });
    return;
  }
  const headers = { ...q.headers() };
  delete headers.origin;
  delete headers.host;
  delete headers["content-length"];
  const response = await fetch(f.origin + url.pathname + url.search, {
      method: q.method(),
      headers,
      ...(["GET", "HEAD"].includes(q.method())
        ? {}
        : { body: q.postDataBuffer() ?? undefined }),
    }),
    body = Buffer.from(await response.arrayBuffer());
  if (url.pathname === "/api/v1/auth/login/verify" && response.status === 200)
    h.setTokens({ customer: JSON.parse(body.toString()).accessToken });
  if (
    holdRefresh &&
    url.pathname === "/api/v1/auth/refresh" &&
    response.status === 200
  ) {
    holdRefresh = false;
    held();
    await releaseSignal;
    released = true;
  }
  const resultHeaders = Object.fromEntries(response.headers);
  delete resultHeaders["content-length"];
  delete resultHeaders["content-encoding"];
  await route.fulfill({
    status: response.status,
    headers: resultHeaders,
    body,
  });
});
async function login(phone: string, name: string) {
  await input("رقم الجوال", phone);
  await input("كلمة المرور", pass);
  await click("متابعة");
  await page
    .getByRole("textbox", { name: "رمز التحقق", exact: true })
    .waitFor();
  await input("رمز التحقق", f.provider.messages.at(-1)!.code);
  await click("تحقق ومتابعة");
  await text("أهلًا " + name).waitFor();
}
try {
  await page.goto("http://127.0.0.1:8081/auth");
  await login("770008001", "حساب اختبار صريح");
  const id = await h.submit();
  const number = (await h.get(id)).order.order_number;
  await click("متابعة التسوق");
  await page.getByRole("tab", { name: "طلباتي", exact: true }).click();
  await button("فتح الطلب " + number).waitFor();
  force401 = true;
  holdRefresh = true;
  await click("تحديث الطلبات");
  await heldSignal;
  await page.getByRole("tab", { name: "حسابي", exact: true }).click();
  await click("تسجيل الخروج");
  await login("770008099", "حساب ثان معزول");
  const refreshResponse = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/v1/auth/refresh",
  );
  release();
  await refreshResponse;
  assert(released);
  await page.getByRole("tab", { name: "طلباتي", exact: true }).click();
  await click("تحديث الطلبات");
  await text("لا توجد طلبات حتى الآن.").waitFor();
  assert.equal(await button("فتح الطلب " + number).count(), 0);
  await page.getByRole("tab", { name: "حسابي", exact: true }).click();
  await text("أهلًا حساب ثان معزول").waitFor();
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: "/workspace/backend/docs/progress/phase-08-evidence/customer-late-refresh-account-isolation-light-390.png",
    fullPage: true,
  });
  await writeFile(
    "/workspace/backend/docs/progress/phase-08-evidence/auth-ui-checks.json",
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        passed: true,
        scenario:
          "held real refresh acknowledgement after account A logout cannot restore A over account B or expose its order",
        database: "isolated real PostgreSQL",
        fault:
          "one injected 401 then delayed real refresh response; no business DTO fixtures",
        pageErrors: errors,
        nativePhoneTested: false,
        screenshots: 1,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({ passed: true, lateRefreshAccountIsolation: true }),
  );
} finally {
  release();
  await browser.close();
  await f.close();
}
