// Isolated PostgreSQL, real API and real exported UI. OTP/R2 are in-process adapters only.
import assert from "node:assert/strict";
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import { fixture, pass } from "../tests/phase05/helpers.js";
import { TestStore } from "../tests/phase06/store.js";
const out = new URL("../docs/progress/phase-06-evidence/", import.meta.url);
await mkdir(out, { recursive: true });
const store = new TestStore(),
  f = await fixture({ objectStore: store });
const browser = await chromium.launch({ headless: true });
const failures: string[] = [],
  results: any[] = [];
let shots = 0;
const click = (p: Page, name: string) =>
  p.getByRole("button", { name, exact: true }).click();
const input = (p: Page, label: string, value: string) =>
  p.getByRole("textbox", { name: label, exact: true }).fill(value);
async function shot(p: Page, name: string) {
  if (name === "admin-stock27-light-390")
    await p
      .getByText("فعلي: 27 · محجوز: 0 · حر: 27", { exact: true })
      .scrollIntoViewIfNeeded();
  if (name === "customer-filter-light-390")
    await p
      .getByRole("button", { name: "تفاصيل زيت موثق من الخادم", exact: true })
      .scrollIntoViewIfNeeded();
  if (name === "customer-quantity-light-390")
    await p
      .getByRole("textbox", { name: "الكمية", exact: true })
      .first()
      .scrollIntoViewIfNeeded();
  await p.screenshot({
    path: new URL(name + ".png", out).pathname,
    fullPage: true,
  });
  shots++;
}
async function saved(p: Page) {
  await click(p, "حفظ في الخادم");
  await p.getByText("حُفظت العملية في الخادم", { exact: true }).waitFor();
}
async function uiCreate(
  p: Page,
  section: string,
  fields: Record<string, string>,
  select: Record<string, string> = {},
) {
  await click(p, section);
  for (const [k, v] of Object.entries(fields)) await input(p, k, v);
  for (const v of Object.values(select)) await click(p, v);
  await saved(p);
}
async function attach(page: Page) {
  page.on("pageerror", (e) => failures.push(e.name));
  await page.route("**/api/v1/**", async (route) => {
    const q = route.request(),
      url = new URL(q.url());
    const h = { ...q.headers() };
    delete h.origin;
    delete h.host;
    delete h["content-length"];
    const r = await fetch(f.origin + url.pathname + url.search, {
      method: q.method(),
      headers: h,
      ...(["GET", "HEAD"].includes(q.method())
        ? {}
        : { body: q.postDataBuffer() ?? undefined }),
    });
    const headers = Object.fromEntries(r.headers);
    delete headers["content-length"];
    delete headers["content-encoding"];
    await route.fulfill({
      status: r.status,
      headers,
      body: Buffer.from(await r.arrayBuffer()),
    });
  });
  await page.route("https://isolated.test/**", async (route) => {
    const cors = {
      "Access-Control-Allow-Origin":
        route.request().headers().origin ?? "http://127.0.0.1:8082",
      "Access-Control-Allow-Methods": "PUT,GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }

    const u = new URL(route.request().url()),
      key = decodeURIComponent(u.pathname.split("/").slice(2).join("/"));
    if (route.request().method() === "PUT") {
      store.files.set(key, route.request().postDataBuffer()!);
      await route.fulfill({ status: 200, body: "", headers: cors });
    } else {
      await route.fulfill({
        status: store.files.has(key) ? 200 : 404,
        body: store.files.get(key) ?? "",
        contentType: "image/webp",
      });
    }
  });
}
try {
  const actor = await f.user("770006010", "staff");
  const role = (
    await f.owner.query("SELECT id FROM roles WHERE code='general_admin'")
  ).rows[0];
  await f.owner.query(
    "INSERT INTO staff_grants(user_id,role_id,global_scope) VALUES($1,$2,true)",
    [actor.id, role.id],
  );
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const admin = await context.newPage();
  await attach(admin);
  await admin.goto("http://127.0.0.1:8082/");
  await input(admin, "رقم الجوال", "770006010");
  await input(admin, "كلمة المرور", pass);
  await click(admin, "متابعة");
  await admin
    .getByRole("textbox", { name: "رمز التحقق", exact: true })
    .waitFor();
  assert(f.provider.messages.length);
  await input(admin, "رمز التحقق", f.provider.messages.at(-1)!.code);
  await click(admin, "تحقق ومتابعة");
  await admin.getByText("أهلًا حساب اختبار صريح", { exact: true }).waitFor();
  await uiCreate(admin, "المحافظات", { الاسم: "محافظة واجهة06" });
  for (const name of ["فرع واجهة أ", "فرع واجهة ب"])
    await uiCreate(
      admin,
      "الفروع",
      { الاسم: name, "خط العرض": "15", "خط الطول": "44" },
      { gov: "محافظة واجهة06" },
    );
  await click(admin, "المحافظات");
  await click(admin, "تحميل السجلات");
  await click(admin, "تعديل");
  await click(admin, "فرع واجهة أ");
  await saved(admin);
  await uiCreate(admin, "الأقسام", { الاسم: "زيوت واجهة" });
  await uiCreate(admin, "الأقسام", { الاسم: "إطارات واجهة" });
  await uiCreate(admin, "الخصائص", {
    الاسم: "اللزوجة",
    "المفتاح التعريفي": "viscosity",
  });
  await uiCreate(admin, "الخصائص", {
    الاسم: "المقاس",
    "المفتاح التعريفي": "tire_size",
  });
  await uiCreate(
    admin,
    "قيم الخصائص",
    { القيمة: "20W50" },
    { attr: "اللزوجة" },
  );
  await uiCreate(
    admin,
    "قيم الخصائص",
    { القيمة: "205/55" },
    { attr: "المقاس" },
  );
  await click(admin, "الأقسام");
  await click(admin, "تحميل السجلات");
  let card = admin.getByText("زيوت واجهة", { exact: true }).locator("..");
  await card.getByRole("button", { name: "تعديل", exact: true }).click();
  let attr = admin.getByText("اللزوجة", { exact: true }).locator("..");
  await attr.getByRole("button", { name: "ربط الخاصية", exact: true }).click();
  await attr.getByRole("button", { name: "اختيارية", exact: true }).click();
  await click(admin, "حفظ ربط الخصائص");
  await admin.getByText("حُفظ ربط الخصائص", { exact: true }).waitFor();
  await click(admin, "المنتجات");
  for (const [k, v] of Object.entries({
    "SKU ثابت": "UI-OIL06",
    الاسم: "زيت موثق من الخادم",
    الوصف: "بيانات اختبار معزولة",
    "بلد المنشأ": "اليمن",
  }))
    await input(admin, k, v);
  await click(admin, "زيوت واجهة");
  await admin.getByRole("button", { name: "20W50", exact: true }).waitFor();
  const picture = await sharp({
    create: { width: 640, height: 480, channels: 3, background: "#ff7900" },
  })
    .png()
    .toBuffer();
  const chooser = admin.waitForEvent("filechooser");
  await click(admin, "اختيار صورة ورفعها");
  await (
    await chooser
  ).setFiles({
    name: "isolated-product.png",
    mimeType: "image/png",
    buffer: picture,
  });
  await admin
    .getByText("تم التحقق من الصورة وحفظها", { exact: true })
    .waitFor();
  assert.equal(
    (
      await f.owner.query(
        "SELECT count(*)::int n FROM media_objects WHERE status='verified' AND visibility='public'",
      )
    ).rows[0].n,
    1,
  );
  await click(admin, "حفظ في الخادم");
  await admin.getByText("خاصية مطلوبة ناقصة", { exact: true }).waitFor();
  // Required value is selected before saving the product below; the first save must reject missing value.
  assert(
    (await f.owner.query("SELECT count(*)::int n FROM products")).rows[0].n ===
      0,
  );
  await click(admin, "20W50");
  await saved(admin);
  await shot(admin, "admin-product-light-390");
  await uiCreate(
    admin,
    "وحدات البيع",
    { "عدد الحبات": "1", "السعر بالريال": "500" },
    { product: "زيت موثق من الخادم", kind: "حبة" },
  );
  await uiCreate(
    admin,
    "وحدات البيع",
    { "عدد الحبات": "12", "السعر بالريال": "5500" },
    { product: "زيت موثق من الخادم", kind: "كرتون" },
  );
  await uiCreate(
    admin,
    "المخزون",
    { الكمية: "2", "سبب الحركة": "اختبار كرتون" },
    {
      branch: "فرع واجهة أ",
      product: "زيت موثق من الخادم",
      unit: "كرتون · 12",
    },
  );
  await uiCreate(
    admin,
    "المخزون",
    { الكمية: "3", "سبب الحركة": "اختبار حبة" },
    { branch: "فرع واجهة أ", product: "زيت موثق من الخادم", unit: "حبة · 1" },
  );
  await click(admin, "تحميل السجلات");
  await admin
    .getByText("فعلي: 27 · محجوز: 0 · حر: 27", { exact: true })
    .waitFor();
  await shot(admin, "admin-stock27-light-390");
  assert.equal(
    (
      await f.owner.query(
        "SELECT sum(delta_pieces)::text n FROM stock_movements",
      )
    ).rows[0].n,
    "27",
  );
  const customer = await context.newPage();
  await attach(customer);
  await customer.goto("http://127.0.0.1:8081/");
  await click(customer, "محافظة واجهة06");
  await click(customer, "زيوت واجهة");
  await customer.getByRole("button", { name: "20W50", exact: true }).waitFor();
  assert.equal(await customer.getByText("المقاس", { exact: true }).count(), 0);
  await click(customer, "20W50");
  await customer
    .getByRole("button", { name: "تفاصيل زيت موثق من الخادم", exact: true })
    .waitFor();
  await input(customer, "ابحث بالاسم أو SKU", "UI-OIL06");
  await customer
    .getByRole("button", { name: "تفاصيل زيت موثق من الخادم", exact: true })
    .waitFor();
  await click(customer, "تفاصيل زيت موثق من الخادم");
  await customer.getByText("اللزوجة: 20W50", { exact: true }).waitFor();
  await shot(customer, "customer-filter-light-390");
  await shot(customer, "customer-quantity-light-390");
  await click(customer, "إطارات واجهة");
  await customer
    .getByText("لا منتجات مطابقة حاليًا.", { exact: true })
    .waitFor();
  assert.equal(
    await customer.getByRole("button", { name: "20W50", exact: true }).count(),
    0,
  );
  // Network failure has an explicit error and does not resurrect the historical fixtures.
  await customer.route("**/api/v1/catalog/products?**", (r) =>
    r.fulfill({ status: 503, json: { error: { message: "انقطاع اختبار" } } }),
  );
  await click(customer, "زيوت واجهة");
  await customer.getByText("انقطاع اختبار", { exact: true }).waitFor();
  assert.equal(
    await customer
      .getByRole("button", { name: "تفاصيل زيت موثق من الخادم", exact: true })
      .count(),
    0,
  );
  await shot(customer, "customer-offline-light-390");
  results.push({
    scenario:
      "real UI login, catalog writes and processed image upload, required-property rejection,27pieces,filters/search,network failure",
    passed: true,
  });
  await context.close();
  for (const width of [360, 390, 1024])
    for (const theme of ["light", "dark"] as const) {
      const c = await browser.newContext({
        viewport: { width, height: 844 },
        colorScheme: theme,
        reducedMotion: "reduce",
      });
      for (const [role, port] of [
        ["customer", 8081],
        ["admin", 8082],
        ["courier", 8083],
      ] as const) {
        const p = await c.newPage();
        if (role !== "courier") await attach(p);
        await p.goto("http://127.0.0.1:" + port + "/");
        if (role === "customer") {
          await click(p, "محافظة واجهة06");
          await click(p, "زيوت واجهة");
          await p
            .getByRole("button", {
              name: "تفاصيل زيت موثق من الخادم",
              exact: true,
            })
            .waitFor();
        } else
          await p
            .getByText(
              role === "admin" ? "دخول الإدارة" : "خدمة المهام قيد الربط",
              { exact: true },
            )
            .waitFor();
        assert(await p.getByTestId("theme-" + theme).count());
        const overflow = await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 2,
        );
        assert(!overflow, role + " overflow");
        await shot(p, role + "-" + theme + "-" + width);
        results.push({
          role,
          width,
          theme,
          horizontalOverflow: false,
          passed: true,
        });
        await p.close();
      }
      await c.close();
    }
  assert.deepEqual(failures, []);
  await writeFile(
    new URL("ui-checks.json", out),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        database: "isolated real PostgreSQL",
        otp: "in-process captured, no real messages",
        r2: "in-process transport, no real requests",
        nativePhoneTested: false,
        screenshots: shots,
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
      pageErrors: failures.length,
    }),
  );
} catch (e) {
  console.error(
    "UI acceptance failed:",
    e instanceof Error ? e.message : "unknown",
  );
  throw e;
} finally {
  await browser.close();
  await f.close();
}
