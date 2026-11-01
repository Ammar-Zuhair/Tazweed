// Real API and disposable PostgreSQL. Routing and map tiles are isolated fixtures, never store locations.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { chromium, type Page } from "playwright";
import { fixture, pass } from "../tests/phase05/helpers.js";
import { TestRouting } from "../tests/phase07/routing.js";
const out = new URL("../docs/progress/phase-07-evidence/", import.meta.url);
await mkdir(out, { recursive: true });
const routing = new TestRouting(),
  f = await fixture({ routingProvider: routing });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const errors: string[] = [],
  results: any[] = [];
let shots = 0,
  external = 0;
const click = async (p: Page, name: string) => {
  console.log("UI action: " + name);
  await p.getByRole("button", { name, exact: true }).click();
};
const visibleText = (p: Page, text: string | RegExp, options: any = {}) =>
  p.getByText(text, options).filter({ visible: true });
const input = (p: Page, label: string, value: string) =>
  p.getByRole("textbox", { name: label, exact: true }).fill(value);
async function shot(p: Page, name: string) {
  if (name.startsWith("checkout-") && name !== "checkout-no-route-light-390")
    await p
      .locator("iframe:visible")
      .contentFrame()
      .getByText("مسار توصيل تقديري · العنوان المحفوظ", { exact: true })
      .waitFor({ timeout: 30000 });
  if (name.startsWith("checkout-")) {
    const total = visibleText(p, /الإجمالي التقديري:/);
    if (await total.count()) await total.scrollIntoViewIfNeeded();
    else await visibleText(p, /لم يُعثر على طريق/).scrollIntoViewIfNeeded();
  }
  if (name.startsWith("addresses-") || name.startsWith("address-maplibre-"))
    await p.locator("iframe:visible").scrollIntoViewIfNeeded();
  if (name.startsWith("address-permission-"))
    await visibleText(
      p,
      "لم يُمنح إذن الموقع؛ حدد الدبوس أو أدخل الإحداثيات يدويًا.",
      { exact: true },
    ).scrollIntoViewIfNeeded();
  if (name === "catalog-promotion-light-390")
    await visibleText(p, "عرض توصيل واجهة07", {
      exact: true,
    }).scrollIntoViewIfNeeded();
  if (name.startsWith("admin-promotion"))
    await p
      .getByRole("textbox", {
        name: "قيمة الخصم (النسبة بنقاط الأساس؛1000=10٪)",
        exact: true,
      })
      .scrollIntoViewIfNeeded();
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
      u = new URL(q.url());
    // MapLibre engine/assets are real; only the public style source is an explicitly empty test style.
    if (u.pathname === "/api/v1/public/maps") {
      const r = await fetch(f.origin + u.pathname),
        v = await r.json();
      v.styleUrl = {
        version: 8,
        sources: {},
        layers: [
          {
            id: "test-background",
            type: "background",
            paint: { "background-color": "#f6eee4" },
          },
        ],
      };
      await route.fulfill({ status: 200, json: v });
      return;
    }
    const h = { ...q.headers() };
    delete h.origin;
    delete h.host;
    delete h["content-length"];
    const r = await fetch(f.origin + u.pathname + u.search, {
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
  await visibleText(p, "أهلًا حساب اختبار صريح", { exact: true }).waitFor();
}
try {
  const customer = await f.user("770007010"),
    admin = await f.user("770007011", "staff");
  await f.owner.query(
    "INSERT INTO staff_grants(user_id,role_id,global_scope) SELECT $1,id,true FROM roles WHERE code='general_admin'",
    [admin.id],
  );
  const g = randomUUID(),
    g2 = randomUUID(),
    b = randomUUID(),
    b2 = randomUUID(),
    cat = randomUUID(),
    product = randomUUID(),
    piece = randomUUID(),
    carton = randomUUID();
  await f.owner.query(
    "INSERT INTO governorates(id,name_ar) VALUES($1,'محافظة واجهة07'),($2,'محافظة ثانية07')",
    [g, g2],
  );
  await f.owner.query(
    "INSERT INTO branches(id,governorate_id,name_ar,latitude,longitude,coverage_radius_m) VALUES($1,$2,'فرع واجهة07',15,44,20000),($3,$4,'فرع ثاني07',15.1,44.1,20000)",
    [b, g, b2, g2],
  );
  await f.owner.query(
    "INSERT INTO delivery_rules(branch_id,base_yer,per_km_yer,max_distance_m) VALUES($1,300,50,15000),($2,500,100,15000)",
    [b, b2],
  );
  await f.owner.query("UPDATE branches SET delivery_enabled=true");
  await f.owner.query(
    "UPDATE governorates SET catalog_branch_id=CASE WHEN id=$1 THEN $2::uuid ELSE $3::uuid END",
    [g, b, b2],
  );
  await f.owner.query(
    "INSERT INTO categories(id,name_ar) VALUES($1,'زيوت واجهة07')",
    [cat],
  );
  await f.owner.query(
    "INSERT INTO products(id,sku,category_id,name_ar) VALUES($1,'OIL-UI07',$2,'زيت سلة07')",
    [product, cat],
  );
  await f.owner.query(
    "INSERT INTO product_units(id,product_id,unit_kind,pieces_per_unit,price_yer) VALUES($1,$2,'piece',1,100),($3,$2,'carton',12,1000)",
    [piece, product, carton],
  );
  await f.owner.query(
    "INSERT INTO stock_levels(branch_id,product_id,on_hand) VALUES($1,$2,100),($3,$2,100)",
    [b, product, b2],
  );
  await f.owner.query(
    "INSERT INTO branch_unit_prices(branch_id,unit_id,price_yer) VALUES($1,$2,250)",
    [b2, piece],
  );
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
      colorScheme: "light",
    }),
    a = await context.newPage();
  await attach(a);
  await a.goto("http://127.0.0.1:8082/");
  await login(a, "770007011");
  await click(a, "العروض الترويجية");
  for (const [k, v] of Object.entries({
    الاسم: "عرض توصيل واجهة07",
    "قيمة الخصم (النسبة بنقاط الأساس؛1000=10٪)": "300",
    "بداية العرض UTC (2026-11-01T00:00:00Z)": "2020-01-01T00:00:00Z",
    "نهاية العرض UTC": "2099-01-01T00:00:00Z",
  }))
    await input(a, k, v);
  await click(a, "محافظة واجهة07");
  await click(a, "توصيل");
  await click(a, "مبلغ ثابت");
  await click(a, "حفظ في الخادم");
  await visibleText(a, "حُفظت العملية في الخادم", { exact: true }).waitFor();
  await shot(a, "admin-promotion-light-390");
  const p = await context.newPage();
  await attach(p);
  await p.goto("http://127.0.0.1:8081/auth");
  await login(p, "770007010");
  await click(p, "متابعة التسوق");
  await click(p, "محافظة واجهة07");
  await p
    .getByRole("button", { name: "تفاصيل زيت سلة07", exact: true })
    .waitFor();
  await p
    .getByRole("textbox", { name: "الكمية", exact: true })
    .nth(0)
    .fill("2");
  await p
    .getByRole("textbox", { name: "الكمية", exact: true })
    .nth(1)
    .fill("3");
  await shot(p, "catalog-promotion-quantities-light-390");
  await shot(p, "catalog-promotion-light-390");
  await click(p, "فتح السلة ومعاينة السعر");
  await click(p, "إدارة عناوين التوصيل");
  await input(p, "اسم العنوان", "منزل واجهة07");
  await input(p, "وصف المكان أو معلم قريب", "عنوان اختبار معزول فقط");
  await input(p, "خط العرض", "15.01");
  await input(p, "خط الطول", "44.01");
  const frame = p.locator("iframe:visible").contentFrame();
  await frame.locator("canvas.maplibregl-canvas").waitFor();
  await frame
    .getByText("اسحب الدبوس أو اضغط موقع العنوان", { exact: true })
    .waitFor({ timeout: 30000 });
  assert.equal(
    await frame
      .getByRole("link", { name: "© OpenStreetMap contributors", exact: true })
      .count(),
    1,
  );
  const permissions = await context.newCDPSession(p);
  await permissions.send("Browser.setPermission", {
    permission: { name: "geolocation" },
    setting: "denied",
    origin: "http://127.0.0.1:8081",
  });
  await click(p, "استخدام موقعي الحالي");
  await visibleText(
    p,
    "لم يُمنح إذن الموقع؛ حدد الدبوس أو أدخل الإحداثيات يدويًا.",
    { exact: true },
  ).waitFor();
  await shot(p, "address-permission-denied-light-390");
  await context.grantPermissions(["geolocation"], {
    origin: "http://127.0.0.1:8081",
  });
  await context.setGeolocation({
    latitude: 15.012,
    longitude: 44.013,
    accuracy: 25,
  });
  await click(p, "استخدام موقعي الحالي");
  await visibleText(p, "دقة الجهاز التقريبية: 25 متر. راجع الدبوس قبل الحفظ.", {
    exact: true,
  }).waitFor();
  assert.equal(
    await p
      .getByRole("textbox", { name: "خط العرض", exact: true })
      .inputValue(),
    "15.012000",
  );
  await input(p, "خط العرض", "15.01");
  await input(p, "خط الطول", "44.01");
  await click(p, "عنوان افتراضي: لا");
  await frame.locator("canvas").click({ position: { x: 60, y: 210 } });
  await p.waitForTimeout(200);
  assert.notEqual(
    await p
      .getByRole("textbox", { name: "خط العرض", exact: true })
      .inputValue(),
    "15.01",
  );
  await input(p, "خط العرض", "15.01");
  await input(p, "خط الطول", "44.01");
  await shot(p, "address-maplibre-pin-light-390");
  await click(p, "حفظ العنوان في الخادم");
  await visibleText(p, "حُفظ العنوان في الخادم.", { exact: true }).waitFor();
  await click(p, "عودة إلى السلة");
  await click(p, "حساب المعاينة من الخادم");
  await visibleText(p, "الإجمالي التقديري: 2400 ر.ي", {
    exact: true,
  }).waitFor();
  await visibleText(p, "مسافة الطريق: 2800 متر · الكيلومترات المحتسبة: 2", {
    exact: true,
  }).waitFor();
  await shot(p, "checkout-road-promotion-light-390");
  //3->5 is an absolute quantity edit; both unit lines survive route navigation.
  await input(p, "كمية زيت سلة07 · حبة", "");
  assert(
    await p
      .getByRole("textbox", { name: "كمية زيت سلة07 · حبة", exact: true })
      .isVisible(),
  );
  assert(
    await p
      .getByRole("button", { name: "حساب المعاينة من الخادم", exact: true })
      .isDisabled(),
  );
  await input(p, "كمية زيت سلة07 · حبة", "5");
  assert.equal(
    await visibleText(p, "الإجمالي التقديري: 2400 ر.ي", {
      exact: true,
    }).count(),
    0,
  );
  await click(p, "حساب المعاينة من الخادم");
  await visibleText(p, "الإجمالي التقديري: 2600 ر.ي", {
    exact: true,
  }).waitFor();
  await click(p, "جملة");
  await click(p, "حساب المعاينة من الخادم");
  await visibleText(p, "الإجمالي التقديري: 2900 ر.ي", {
    exact: true,
  }).waitFor();
  await shot(p, "checkout-wholesale-reference-light-390");
  await click(p, "تجزئة");
  routing.fail = "NO_ROUTE";
  await click(p, "حساب المعاينة من الخادم");
  await visibleText(p, /لم يُعثر على طريق/).waitFor();
  assert.equal(await visibleText(p, /الإجمالي التقديري:/).count(), 0);
  await shot(p, "checkout-no-route-light-390");
  routing.fail = null;
  await click(p, "متابعة التسوق أو تغيير المحافظة");
  await click(p, "محافظة ثانية07");
  await click(p, "فتح السلة ومعاينة السعر");
  await visibleText(p, "أضف عنوانًا في المحافظة الحالية أولًا.", {
    exact: true,
  }).waitFor();
  assert.equal(await visibleText(p, /الإجمالي التقديري:/).count(), 0);
  assert.equal(
    await p
      .getByRole("textbox", { name: "كمية زيت سلة07 · حبة", exact: true })
      .inputValue(),
    "5",
  );
  await click(p, "إدارة عناوين التوصيل");
  await click(p, "عنوان جديد");
  await input(p, "اسم العنوان", "عنوان المحافظة الثانية");
  await input(p, "خط العرض", "15.11");
  await input(p, "خط الطول", "44.11");
  await click(p, "حفظ العنوان في الخادم");
  await visibleText(p, "حُفظ العنوان في الخادم.", { exact: true }).waitFor();
  await click(p, "عودة إلى السلة");
  await click(p, "حساب المعاينة من الخادم");
  await visibleText(p, "الإجمالي التقديري: 3950 ر.ي", {
    exact: true,
  }).waitFor();
  await shot(p, "checkout-governorate-repriced-light-390");
  const facts = (
    await f.owner.query(
      "SELECT (SELECT count(*) FROM orders)::int orders,(SELECT count(*) FROM order_quotes)::int quotes,(SELECT count(*) FROM stock_reservations)::int holds,(SELECT sum(reserved)::text FROM stock_levels) reserved",
    )
  ).rows[0];
  assert.deepEqual(facts, { orders: 0, quotes: 0, holds: 0, reserved: "0" });
  results.push({
    scenario:
      "real PG + API: promotion create, pin bridge + address save, independent units, preview/floor/promo,3to5,wholesale,no-route,governorate repricing,no holds",
    passed: true,
  });
  for (const theme of ["light", "dark"] as const)
    for (const width of [360, 390, 1024]) {
      await context.setDefaultTimeout(20000);
      await context.setDefaultNavigationTimeout(30000);
      await p.setViewportSize({ width, height: width === 1024 ? 900 : 844 });
      await p.emulateMedia({ colorScheme: theme });
      await a.setViewportSize({ width, height: width === 1024 ? 900 : 844 });
      await a.emulateMedia({ colorScheme: theme });
      await click(p, "حساب المعاينة من الخادم");
      await visibleText(p, "الإجمالي التقديري: 3950 ر.ي", {
        exact: true,
      }).waitFor();
      await shot(p, `checkout-${theme}-${width}`);
      await click(p, "إدارة عناوين التوصيل");
      await p
        .locator("iframe:visible")
        .contentFrame()
        .getByText("اسحب الدبوس أو اضغط موقع العنوان", { exact: true })
        .waitFor();
      await shot(p, `addresses-${theme}-${width}`);
      await click(p, "عودة إلى السلة");
      await shot(a, `admin-promotions-${theme}-${width}`);
      for (const page of [p, a])
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
      results.push({
        scenario: "customer maps/checkout and admin promotions responsive",
        theme,
        width,
        passed: true,
        horizontalOverflow: false,
      });
    }
  assert.deepEqual(errors, []);
  assert.equal(external, 0);
  await writeFile(
    new URL("ui-checks.json", out),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        database: "isolated real PostgreSQL",
        routing:
          "in-process TestRouting; straight fixture geometry is not a real road",
        map: "real pinned MapLibre GL JS engine with empty isolated style; no real map tiles/store locations",
        otp: "in-process CaptureProvider",
        nativePhoneTested: false,
        geolocation:
          "browser permission denial then Playwright synthetic coordinates, not device GPS",
        externalProviderRequests: external,
        pageErrors: errors,
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
      pageErrors: errors.length,
    }),
  );
  await context.close();
} catch (e) {
  console.error("UI07 failed:", e instanceof Error ? e.message : "unknown");
  for (const context of browser.contexts())
    for (const page of context.pages())
      await page
        .screenshot({
          path:
            "/workspace/.phase07-work/ui-failure-" +
            context.pages().indexOf(page) +
            ".png",
          fullPage: true,
        })
        .catch(() => {});
  throw e;
} finally {
  await browser.close();
  await f.close();
}
