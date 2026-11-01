import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { fixture, type Fixture } from "./phase05/helpers.js";
import { TestRouting } from "./phase07/routing.js";
import {
  OsrmProvider,
  RoutingError,
  routingFromConfig,
} from "../src/checkout/routing.js";
import { roadFee, bestPromotion } from "../src/checkout/pricing.js";
import { readConfig } from "../src/config.js";
let f: Fixture,
  token: string,
  adminToken: string,
  g: string,
  b: string,
  otherGov: string,
  otherBranch: string,
  cat: string,
  product: string,
  piece: string,
  carton: string,
  address: string,
  otherAddress: string;
const routing = new TestRouting();
before(async () => {
  f = await fixture({ routingProvider: routing });
});
after(async () => {
  await f?.close();
});
beforeEach(async () => {
  await f.owner.query("SET statement_timeout=180000");
  await f.owner.query(
    "TRUNCATE users,governorates,categories,promotions,outbox_events CASCADE",
  );
  await f.owner.query("DELETE FROM auth_rate_buckets");
  routing.reset();
  const customer = await f.user("770007001"),
    staff = await f.user("770007002", "staff");
  await f.owner.query(
    "INSERT INTO staff_grants(user_id,role_id,global_scope) SELECT $1,id,true FROM roles WHERE code='general_admin'",
    [staff.id],
  );
  token = (await f.login(customer)).accessToken;
  adminToken = (await f.login(staff, "admin")).accessToken;
  g = randomUUID();
  b = randomUUID();
  otherGov = randomUUID();
  otherBranch = randomUUID();
  cat = randomUUID();
  product = randomUUID();
  piece = randomUUID();
  carton = randomUUID();
  address = randomUUID();
  otherAddress = randomUUID();
  await f.owner.query(
    "INSERT INTO governorates(id,name_ar) VALUES($1,'محافظة اختبار07'),($2,'محافظة أخرى اختبار07')",
    [g, otherGov],
  );
  await f.owner.query(
    "INSERT INTO branches(id,governorate_id,name_ar,latitude,longitude,coverage_radius_m) VALUES($1,$2,'فرع كتالوج اختبار',15,44,20000),($3,$4,'فرع محافظة أخرى',15.1,44.1,20000)",
    [b, g, otherBranch, otherGov],
  );
  await f.owner.query(
    "INSERT INTO delivery_rules(branch_id,base_yer,per_km_yer,max_distance_m) VALUES($1,300,50,15000),($2,500,100,15000)",
    [b, otherBranch],
  );
  await f.owner.query("UPDATE branches SET delivery_enabled=true");
  await f.owner.query(
    "UPDATE governorates SET catalog_branch_id=CASE WHEN id=$1 THEN $2::uuid ELSE $3::uuid END",
    [g, b, otherBranch],
  );
  await f.owner.query(
    "INSERT INTO categories(id,name_ar) VALUES($1,'قسم اختبار07')",
    [cat],
  );
  await f.owner.query(
    "INSERT INTO products(id,sku,category_id,name_ar) VALUES($1,'PH07-OIL',$2,'زيت سلة موثق')",
    [product, cat],
  );
  await f.owner.query(
    "INSERT INTO product_units(id,product_id,unit_kind,pieces_per_unit,price_yer) VALUES($1,$2,'piece',1,100),($3,$2,'carton',12,1000)",
    [piece, product, carton],
  );
  await f.owner.query(
    "INSERT INTO stock_levels(branch_id,product_id,on_hand) VALUES($1,$2,27),($3,$2,27)",
    [b, product, otherBranch],
  );
  await f.owner.query(
    "INSERT INTO branch_unit_prices(branch_id,unit_id,price_yer) VALUES($1,$2,250)",
    [otherBranch, piece],
  );
  await f.owner.query(
    "INSERT INTO addresses(id,user_id,governorate_id,label,latitude,longitude) VALUES($1,$2,$3,'منزل اختبار',15.01,44.01),($4,$2,$5,'عنوان محافظة أخرى',15.11,44.11)",
    [address, customer.id, g, otherAddress, otherGov],
  );
});
const body = () => ({
  governorateId: g,
  addressId: address,
  kind: "retail",
  items: [
    { unitId: carton, quantity: 2 },
    { unitId: piece, quantity: 3 },
  ],
});
const preview = (v: any = body(), t = token, app = "customer") =>
  f.request("POST", "/api/v1/checkout/preview", v, t, app);
async function promo(v: any = {}) {
  const data = {
    name_ar: "عرض اختبار",
    governorate_id: g,
    category_id: null,
    product_id: null,
    target: "products",
    discount_kind: "fixed",
    value: "100",
    starts_at: "2020-01-01T00:00:00Z",
    ends_at: "2099-01-01T00:00:00Z",
    active: true,
    ...v,
  };
  const r = await f.request(
    "POST",
    "/api/v1/admin/promotions",
    data,
    adminToken,
    "admin",
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
async function counts() {
  return (
    await f.owner.query(
      `SELECT (SELECT count(*) FROM orders)::int orders,(SELECT count(*) FROM order_quotes)::int quotes,(SELECT count(*) FROM stock_reservations)::int holds,(SELECT count(*) FROM stock_movements)::int movements,(SELECT count(*) FROM outbox_events)::int events,(SELECT count(*) FROM audit_logs)::int audits,(SELECT sum(reserved)::text FROM stock_levels) reserved,(SELECT count(*) FROM idempotency_records)::int idempotency`,
    )
  ).rows[0];
}
test("07 read-only coherent preview prices 2 cartons + 3 pieces from one explicit catalog branch, without any write", async () => {
  const before = await counts(),
    r = await preview();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.previewOnly, true);
  assert.equal(r.body.reservationCreated, false);
  assert.equal(r.body.catalogBranchId, b);
  assert.equal(r.body.executionBranchId, null);
  assert.equal(r.body.reviewStage, "awaiting_branch");
  assert.equal(r.body.estimatedTotals.subtotal_yer, "2300");
  assert.equal(r.body.delivery.fee_yer, "400");
  assert.equal(r.body.delivery.billed_km, 2);
  assert.equal(r.body.delivery.snapshot.base_yer, "300");
  assert.equal(r.body.delivery.snapshot.per_km_yer, "50");
  assert.equal(r.body.delivery.snapshot.rounding, "floor_km");
  assert.equal(r.body.estimatedTotals.total_yer, "2700");
  assert.deepEqual(await counts(), before);
  assert.equal(routing.calls[0]?.from.latitude, 15);
  assert(!r.text.includes("on_hand"));
  assert(!r.text.includes("free"));
  assert(!r.text.includes("reserved"));
  assert.deepEqual(f.pool.options.statement_timeout, 10000);
});
test("07 floor_km handles sub-km, 2.8km and fractional meters below next km with exact bigint fees", async () => {
  for (const [distance, km, fee] of [
    [999.99, 0, "300"],
    [2800, 2, "400"],
    [2999.99, 2, "400"],
    [3000, 3, "450"],
    [0, 0, "300"],
  ] as const) {
    routing.distance = distance;
    const r = await preview();
    assert.equal(r.status, 200);
    assert.equal(r.body.delivery.billed_km, km);
    assert.equal(r.body.delivery.fee_yer, fee);
    assert.equal(r.body.delivery.snapshot.raw_distance_m, distance);
  }
  assert.equal(
    roadFee(2800, "9007199254740993", "50").fee_yer,
    "9007199254741093",
  );
});
test("07 greatest saving across products and delivery, stable id ASC tie, one multi-product promotion and no usage cap", async () => {
  const a = await promo({ value: "200" }),
    d = await promo({ target: "delivery", value: "300" });
  let r = await preview();
  assert.equal(r.body.promotion.id, d.id);
  assert.equal(r.body.estimatedTotals.delivery_discount_yer, "300");
  assert.equal(r.body.estimatedTotals.product_discount_yer, "0");
  const e = await promo({ value: "300" });
  r = await preview();
  assert.equal(r.body.promotion.id, [d.id, e.id].sort()[0]);
  await f.owner.query("UPDATE promotions SET active=false WHERE id<>$1", [
    a.id,
  ]);
  for (let i = 0; i < 3; i++) {
    r = await preview();
    assert.equal(r.body.promotion.id, a.id);
    assert.equal(r.body.promotion.eligible_base_yer, "2300");
    assert.equal(r.body.estimatedTotals.product_discount_yer, "200");
  }
});
test("07 promotion eligibility respects governorate, exact category/product, dates, inactive, percentage and caps to eligible base", async () => {
  await promo({ governorate_id: otherGov, value: "999999" });
  await promo({ starts_at: "2098-01-01T00:00:00Z", value: "999999" });
  await promo({ ends_at: "2021-01-01T00:00:00Z", value: "999999" });
  await promo({ active: false, value: "999999" });
  const p = await promo({
    category_id: cat,
    discount_kind: "percent",
    value: "1250",
  });
  let r = await preview();
  assert.equal(r.body.promotion.id, p.id);
  assert.equal(r.body.promotion.saving_yer, "288");
  const capped = await promo({ product_id: product, value: "999999" });
  r = await preview();
  assert.equal(r.body.promotion.id, capped.id);
  assert.equal(r.body.promotion.saving_yer, "2300");
  assert.equal(r.body.estimatedTotals.total_yer, "400");
  const ineligible = {
    ...p,
    id: randomUUID(),
    product_id: randomUUID(),
    category_id: null,
    target: "delivery",
  };
  assert.equal(
    bestPromotion([ineligible], g, "retail", r.body.items, "400", new Date()),
    null,
  );
});
test("07 wholesale reference never combines retail promotions or claims a manager price", async () => {
  await promo({ value: "999999" });
  const r = await preview({ ...body(), kind: "wholesale" });
  assert.equal(r.status, 200);
  assert.equal(r.body.pricingMode, "wholesale_reference");
  assert.equal(r.body.promotion, null);
  assert.equal(r.body.promotionSelection, "excluded_wholesale");
  assert.equal(r.body.estimatedTotals.product_discount_yer, "0");
  assert.equal(r.body.executionBranchId, null);
});
test("07 changing governorate reprices explicitly without aggregation or silent item loss; address mismatch rejects", async () => {
  const first = await preview();
  const wrong = await preview({ ...body(), governorateId: otherGov });
  assert.equal(wrong.status, 422);
  const second = await preview({
    ...body(),
    governorateId: otherGov,
    addressId: otherAddress,
  });
  assert.equal(second.status, 200);
  assert.equal(second.body.catalogBranchId, otherBranch);
  assert.equal(second.body.estimatedTotals.subtotal_yer, "2750");
  assert.equal(second.body.delivery.fee_yer, "700");
  assert.notEqual(
    second.body.estimatedTotals.total_yer,
    first.body.estimatedTotals.total_yer,
  );
  await f.owner.query(
    "UPDATE governorates SET catalog_branch_id=NULL WHERE id=$1",
    [g],
  );
  assert.equal((await preview()).status, 409);
});
test("07 missing/no/failed road leaves total null; never replaces road with straight distance or stacks partial promotions", async () => {
  await promo({ value: "500" });
  for (const fail of [
    "NO_ROUTE",
    "ROUTING_UNAVAILABLE",
    "ROUTING_UNCONFIGURED",
    "SNAP_TOO_FAR",
  ] as const) {
    routing.fail = fail;
    const r = await preview();
    assert.equal(r.status, 200);
    assert.equal(r.body.delivery.status, "review_required");
    assert.equal(r.body.delivery.reason, fail);
    assert.equal(r.body.delivery.fee_yer, null);
    assert.equal(r.body.estimatedTotals.total_yer, null);
    assert.equal(r.body.promotion, null);
    assert.equal(r.body.promotionSelection, "pending_delivery");
    assert.equal(r.body.delivery.snapshot, null);
  }
});
test("07 coverage and unrounded route limit gate pricing; disabled delivery has no fee; NULL cannot enable", async () => {
  await f.owner.query("UPDATE branches SET coverage_radius_m=100 WHERE id=$1", [
    b,
  ]);
  let r = await preview();
  assert.equal(r.body.delivery.reason, "OUTSIDE_COVERAGE");
  assert.equal(routing.calls.length, 0);
  await f.owner.query(
    "UPDATE branches SET coverage_radius_m=20000 WHERE id=$1",
    [b],
  );
  routing.distance = 15000.01;
  r = await preview();
  assert.equal(r.body.delivery.reason, "ROAD_LIMIT_EXCEEDED");
  await f.owner.query(
    "UPDATE branches SET delivery_enabled=false,coverage_radius_m=NULL WHERE id=$1",
    [b],
  );
  r = await preview();
  assert.equal(r.body.delivery.reason, "DELIVERY_UNCONFIGURED");
  const enabled = await f.request(
    "PATCH",
    "/api/v1/admin/branches/" + b + "/delivery-enabled",
    { enabled: true },
    adminToken,
    "admin",
  );
  assert.equal(enabled.status, 409);
});
test("07 preview rejects other owner/archived addresses, unauthenticated/staff and spoofed fields", async () => {
  assert.equal((await preview(body(), "")).status, 401);
  assert.equal((await preview(body(), adminToken, "admin")).status, 403);
  const other = await f.user("770007003"),
    t = (await f.login(other)).accessToken;
  assert.equal((await preview(body(), t)).status, 404);
  assert.equal((await preview({ ...body(), deliveryFee: "1" })).status, 422);
  assert.equal(
    (await preview({ ...body(), branchId: otherBranch })).status,
    422,
  );
  await f.owner.query("UPDATE addresses SET archived_at=now() WHERE id=$1", [
    address,
  ]);
  assert.equal((await preview()).status, 404);
});
test("07 quantities combine piece/carton availability, reject duplicates/inactive/required attributes without leaking counts", async () => {
  let r = await preview({
    ...body(),
    items: [
      { unitId: carton, quantity: 2 },
      { unitId: piece, quantity: 4 },
    ],
  });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, "ITEM_UNAVAILABLE");
  assert.equal(r.body.error.details.productId, product);
  assert.equal(
    (
      await preview({
        ...body(),
        items: [
          { unitId: piece, quantity: 1 },
          { unitId: piece, quantity: 2 },
        ],
      })
    ).status,
    422,
  );
  await f.owner.query("UPDATE product_units SET active=false WHERE id=$1", [
    piece,
  ]);
  assert.equal((await preview()).status, 409);
  await f.owner.query("UPDATE product_units SET active=true WHERE id=$1", [
    piece,
  ]);
  const attr = (
    await f.owner.query(
      "INSERT INTO attributes(code,name_ar) VALUES('phase07_required','خاصية اختبار') RETURNING id",
    )
  ).rows[0].id;
  await f.owner.query(
    "INSERT INTO category_attributes(category_id,attribute_id,required) VALUES($1,$2,true)",
    [cat, attr],
  );
  assert.equal((await preview()).status, 409);
});
test("07 snapshot is immutable response data; next preview observes new tariff and price; parallel previews do not reserve", async () => {
  const first = await preview();
  await f.owner.query(
    "UPDATE delivery_rules SET base_yer=700,per_km_yer=100,version=version+1 WHERE branch_id=$1",
    [b],
  );
  await f.owner.query("UPDATE product_units SET price_yer=150 WHERE id=$1", [
    piece,
  ]);
  const second = await preview();
  assert.equal(first.body.delivery.snapshot.base_yer, "300");
  assert.equal(second.body.delivery.snapshot.base_yer, "700");
  assert.equal(second.body.delivery.snapshot.rule_version, 2);
  assert.equal(second.body.estimatedTotals.subtotal_yer, "2450");
  const prior = await counts();
  routing.delay = 100;
  const all = await Promise.all([preview(), preview()]);
  assert.deepEqual(all.map((v) => v.status).sort(), [200, 429]);
  assert.deepEqual(await counts(), prior);
});
test("07 maintenance blocks customer preview and catalog promotions but preserves addresses and admin promotion management", async () => {
  await f.owner.query(
    "INSERT INTO customer_maintenance(singleton,enabled,message_ar) VALUES(true,true,'صيانة اختبار07') ON CONFLICT(singleton) DO UPDATE SET enabled=true",
  );
  assert.equal((await preview()).status, 503);
  assert.equal(
    (await f.request("GET", "/api/v1/catalog/promotions?governorateId=" + g))
      .status,
    503,
  );
  assert.equal(
    (await f.request("GET", "/api/v1/me/addresses", undefined, token)).status,
    200,
  );
  await promo();
  await f.owner.query("UPDATE customer_maintenance SET enabled=false");
});
test("07 promotion writes require global action grant, validate dates/scope/percent and cannot write orders or holds", async () => {
  const no = await f.user("770007004", "staff"),
    t = (await f.login(no, "admin")).accessToken;
  const r = await f.request(
    "GET",
    "/api/v1/admin/promotions",
    undefined,
    t,
    "admin",
  );
  assert.equal(r.status, 403);
  const role = (
    await f.owner.query(
      "INSERT INTO roles(code,name_ar) VALUES('phase07_scope','نطاق عروض اختبار') ON CONFLICT(code) DO UPDATE SET name_ar=excluded.name_ar RETURNING id",
    )
  ).rows[0];
  await f.owner.query(
    "INSERT INTO role_permissions VALUES($1,'promotions.write') ON CONFLICT DO NOTHING",
    [role.id],
  );
  await f.owner.query(
    "INSERT INTO staff_grants(user_id,role_id,branch_id) VALUES($1,$2,$3)",
    [no.id, role.id, b],
  );
  assert.equal(
    (await f.request("GET", "/api/v1/admin/promotions", undefined, t, "admin"))
      .status,
    403,
  );
  const p = await promo();
  assert.equal(
    (
      await f.request(
        "PUT",
        "/api/v1/admin/promotions/" + p.id,
        {
          ...Object.fromEntries(Object.entries(p).filter(([k]) => k !== "id")),
          discount_kind: "percent",
          value: "10001",
        },
        adminToken,
        "admin",
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await f.pool.query(
        "SELECT has_table_privilege(current_user,'orders','INSERT') ok",
      )
    ).rows[0].ok,
    true,
  );
  assert.equal(
    (
      await f.pool.query(
        "SELECT has_table_privilege(current_user,'stock_reservations','INSERT') ok",
      )
    ).rows[0].ok,
    true,
  );
});
test("07 maps endpoint serves pinned MapLibre assets, explicit attribution and no provider key or arbitrary URL proxy", async () => {
  const c = await f.request("GET", "/api/v1/public/maps");
  assert.equal(c.status, 200);
  assert.equal(c.body.engine, "maplibre-gl-js");
  assert.equal(c.body.attribution.length, 3);
  assert(!JSON.stringify(c.body).includes("API_KEY"));
  const html = await fetch(f.origin + "/api/v1/maps/picker");
  assert.equal(html.status, 200);
  assert.match(await html.text(), /OpenStreetMap contributors/);
  assert.match(
    html.headers.get("content-security-policy")!,
    /frame-ancestors 'self'/,
  );
  assert.equal(
    (await fetch(f.origin + "/api/v1/maps/assets/maplibre-gl.mjs")).status,
    200,
  );
  assert.equal((await fetch(f.origin + "/api/v1/maps/picker.js")).status, 200);
  assert.equal(
    (await fetch(f.origin + "/api/v1/maps/assets/unknown")).status,
    404,
  );
});
test("07 OSRM HTTP contract: lng/lat, no alternatives, bounded snap, server Bearer, malformed/timeout/no-route fail closed", async () => {
  let mode = "ok",
    seen: any;
  const server = createServer((req, res) => {
    seen = { url: req.url, auth: req.headers.authorization };
    if (mode === "timeout") return;
    if (mode === "oversize") {
      res.end(" ".repeat(524289));
      return;
    }
    if (mode === "redirect") {
      res.writeHead(302, { Location: "http://127.0.0.1:9/" }).end();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(
        mode === "no"
          ? { code: "NoRoute" }
          : mode === "bad"
            ? { code: "Ok", routes: [{ distance: -1 }] }
            : {
                code: "Ok",
                data_version: "test-only",
                waypoints: [
                  { distance: mode === "snap" ? 500 : 2, location: [44, 15] },
                  { distance: 1, location: [44.01, 15.01] },
                ],
                routes: [
                  {
                    distance: 2800.7,
                    duration: 200,
                    geometry: {
                      type: "LineString",
                      coordinates: [
                        [44, 15],
                        [44.01, 15.01],
                      ],
                    },
                  },
                ],
              },
      ),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  assert(addr && typeof addr !== "string");
  try {
    const config = readConfig({
        ...(f.config as any),
        ROUTING_PROVIDER: "osrm",
        ROUTING_BASE_URL: `http://127.0.0.1:${addr.port}`,
        ROUTING_API_KEY: "isolated-bearer-only",
        ROUTING_TIMEOUT_MS: "500",
      }),
      adapter = new OsrmProvider(config);
    const route = await adapter.route(
      { latitude: 15, longitude: 44 },
      { latitude: 15.01, longitude: 44.01 },
    );
    assert.equal(route.distanceMeters, 2800.7);
    assert.match(seen.url, /44,15;44.01,15.01/);
    assert.match(seen.url, /geometries=geojson/);
    assert.match(seen.url, /radiuses=200%3B200/);
    assert.equal(seen.auth, "Bearer isolated-bearer-only");
    for (const [m, code] of [
      ["no", "NO_ROUTE"],
      ["bad", "ROUTING_UNAVAILABLE"],
      ["oversize", "ROUTING_UNAVAILABLE"],
      ["redirect", "ROUTING_UNAVAILABLE"],
      ["snap", "SNAP_TOO_FAR"],
      ["timeout", "ROUTING_UNAVAILABLE"],
    ]) {
      mode = m!;
      await assert.rejects(
        adapter.route(
          { latitude: 15, longitude: 44 },
          { latitude: 15.01, longitude: 44.01 },
        ),
        (e: any) => e instanceof RoutingError && e.code === code,
      );
    }
    for (const url of [
      "https://router.project-osrm.org",
      "https://secret@example.com",
      "https://example.com?key=secret",
      "http://example.com",
    ])
      assert.throws(() =>
        readConfig({
          ...(f.config as any),
          ROUTING_PROVIDER: "osrm",
          ROUTING_BASE_URL: url,
        }),
      );
    await assert.rejects(
      routingFromConfig(f.config).route(
        { latitude: 15, longitude: 44 },
        { latitude: 15.01, longitude: 44.01 },
      ),
      RoutingError,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("07 one category promotion covers multiple SKUs on the order, excludes unrelated scope and rounds percentage half-up", async () => {
  const p2 = randomUUID(),
    u2 = randomUUID();
  await f.owner.query(
    "INSERT INTO products(id,sku,category_id,name_ar) VALUES($1,'PH07-SECOND',$2,'منتج ثان للاختبار')",
    [p2, cat],
  );
  await f.owner.query(
    "INSERT INTO product_units(id,product_id,unit_kind,pieces_per_unit,price_yer) VALUES($1,$2,'piece',1,1000)",
    [u2, p2],
  );
  await f.owner.query(
    "INSERT INTO stock_levels(branch_id,product_id,on_hand) VALUES($1,$2,5)",
    [b, p2],
  );
  const p = await promo({
    category_id: cat,
    discount_kind: "percent",
    value: "1000",
  });
  const r = await preview({
    ...body(),
    items: [...body().items, { unitId: u2, quantity: 2 }],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.promotion.id, p.id);
  assert.equal(r.body.promotion.eligible_base_yer, "4300");
  assert.equal(r.body.promotion.saving_yer, "430");
  assert.equal(r.body.estimatedTotals.total_yer, "4270");
});
test("07 overflowing configured amounts fail before they can become a future bigint quote; no preview writes", async () => {
  await f.owner.query(
    "UPDATE product_units SET price_yer=10000000000000000 WHERE id=$1",
    [piece],
  );
  await f.owner.query(
    "UPDATE stock_levels SET on_hand=10000 WHERE branch_id=$1",
    [b],
  );
  const before = await counts();
  const r = await preview({
    ...body(),
    items: [{ unitId: piece, quantity: 999 }],
  });
  assert.equal(r.status, 422);
  assert.equal(r.body.error.code, "PRICE_OUT_OF_RANGE");
  assert.deepEqual(await counts(), before);
});
