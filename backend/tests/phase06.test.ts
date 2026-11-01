import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { fixture, type Fixture, device } from "./phase05/helpers.js";
import type { ObjectStore } from "../src/catalog/media.js";
import { prunePendingMedia } from "../src/catalog/media.js";
import { expireTimed } from "../src/catalog/stock.js";
import { TestStore } from "./phase06/store.js";
let f: Fixture;
const store = new TestStore();
let token: string;
let actor: any;
before(async () => {
  f = await fixture({ objectStore: store });
});
after(async () => await f?.close());
beforeEach(async () => {
  await f.owner.query("SET statement_timeout=180000");
  await f.owner.query(
    "TRUNCATE users,governorates,categories,attributes,outbox_events CASCADE",
  );
  await f.owner.query("DELETE FROM auth_rate_buckets");
  store.files.clear();
  actor = await f.user("770006001", "staff");
  const role = (
    await f.owner.query("SELECT id FROM roles WHERE code='general_admin'")
  ).rows[0];
  await f.owner.query(
    "INSERT INTO staff_grants(user_id,role_id,global_scope) VALUES($1,$2,true)",
    [actor.id, role.id],
  );
  token = (await f.login(actor, "admin")).accessToken;
});
const req = (
  method: string,
  path: string,
  body?: any,
  key?: string,
  t = token,
) =>
  f.request(
    method,
    "/api/v1" + path,
    body,
    t,
    "admin",
    key ? { "Idempotency-Key": key } : {},
  );
const pub = (path: string) => f.request("GET", "/api/v1" + path);
async function create(name: string, data: any) {
  const r = await req("POST", "/admin/" + name, data);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
async function seed() {
  const gov = await create("governorates", { name_ar: "محافظة اختبار06" });
  const a = await create("branches", {
    name_ar: "فرع أ",
    governorate_id: gov.id,
    latitude: 15,
    longitude: 44,
  });
  const b = await create("branches", {
    name_ar: "فرع ب",
    governorate_id: gov.id,
    latitude: 15.1,
    longitude: 44.1,
  });
  assert.equal(
    (
      await req("PUT", "/admin/governorates/" + gov.id + "/catalog-branch", {
        branchId: a.id,
      })
    ).status,
    200,
  );
  const oil = await create("categories", { name_ar: "زيوت اختبار" }),
    tires = await create("categories", { name_ar: "إطارات اختبار" });
  const viscosity = await create("attributes", {
      name_ar: "اللزوجة",
      code: "viscosity",
    }),
    size = await create("attributes", { name_ar: "المقاس", code: "size" });
  const vv = await create("attribute-values", {
      attribute_id: viscosity.id,
      value_ar: "20W50",
    }),
    sv = await create("attribute-values", {
      attribute_id: size.id,
      value_ar: "205/55",
    });
  for (const [cat, attr] of [
    [oil, viscosity],
    [tires, size],
  ])
    assert.equal(
      (
        await req("PUT", "/admin/categories/" + cat.id + "/attributes", {
          items: [
            {
              attribute_id: attr.id,
              required: true,
              filterable: true,
              sort_order: 0,
            },
          ],
        })
      ).status,
      200,
    );
  const product = await create("products", {
    sku: "OIL06",
    name_ar: "زيت اختبار06",
    category_id: oil.id,
    attributes: [{ attribute_id: viscosity.id, value_id: vv.id }],
  });
  const piece = (
      await req("POST", "/admin/products/" + product.id + "/units", {
        unit_kind: "piece",
        pieces_per_unit: 1,
        price_yer: "500",
      })
    ).body,
    carton = (
      await req("POST", "/admin/products/" + product.id + "/units", {
        unit_kind: "carton",
        pieces_per_unit: 12,
        price_yer: "5500",
      })
    ).body;
  assert(piece.id && carton.id);
  return {
    gov,
    a,
    b,
    oil,
    tires,
    viscosity,
    size,
    vv,
    sv,
    product,
    piece,
    carton,
  };
}
const adjust = (
  s: any,
  quantity: number,
  unit = s.piece,
  branch = s.a,
  key = randomUUID(),
) =>
  req(
    "POST",
    "/admin/inventory/adjustments",
    {
      branch_id: branch.id,
      product_id: s.product.id,
      unit_id: unit.id,
      quantity,
      reason: "adjustment",
      note: "جرد اختبار",
    },
    key,
  );
test("category properties are authoritative; oils reject tire size and required omissions", async () => {
  const s = await seed();
  for (const attrs of [
    [],
    [{ attribute_id: s.size.id, value_id: s.sv.id }],
    [{ attribute_id: s.viscosity.id, value_id: s.sv.id }],
  ])
    assert.equal(
      (
        await req("POST", "/admin/products", {
          sku: randomUUID(),
          name_ar: "رفض",
          category_id: s.oil.id,
          attributes: attrs,
        })
      ).status,
      422,
    );
  const filters = await pub("/catalog/categories/" + s.oil.id + "/filters");
  assert.deepEqual(
    filters.body.items.map((x: any) => x.code),
    ["viscosity"],
  );
  assert.equal(
    (
      await pub(
        "/catalog/products?governorateId=" +
          s.gov.id +
          "&categoryId=" +
          s.oil.id +
          "&attributeValueIds=" +
          s.sv.id,
      )
    ).status,
    422,
  );
});
test("piece/carton share one ledger: 2 cartons plus3 pieces is27 and overselling26 rejects atomically", async () => {
  const s = await seed();
  assert.equal((await adjust(s, 2, s.carton)).status, 200);
  assert.equal((await adjust(s, 3)).status, 200);
  const inv = await req("GET", "/admin/inventory?branchId=" + s.a.id);
  assert.equal(inv.body.items[0].on_hand, "27");
  assert.equal((await adjust(s, -28)).status, 409);
  assert.equal(
    (
      await f.owner.query(
        "SELECT sum(delta_pieces)::text n FROM stock_movements",
      )
    ).rows[0].n,
    "27",
  );
});
test("catalog uses only configured branch prices and booleans, never aggregates or exposes stock counts", async () => {
  const s = await seed();
  await adjust(s, 1, s.carton, s.b);
  await req("PUT", "/admin/branch-prices", {
    branch_id: s.a.id,
    unit_id: s.carton.id,
    price_yer: "4321",
  });
  const r = await pub("/catalog/products?governorateId=" + s.gov.id);
  assert.equal(r.status, 200);
  assert.equal(r.body.catalogBranchId, s.a.id);
  const u = r.body.items[0].units.find((u: any) => u.kind === "carton");
  assert.equal(u.price_yer, "4321");
  assert.equal(u.available, false);
  assert(!/on_hand|reserved|delta_pieces/.test(r.text));
  await adjust(s, 12);
  const r2 = await pub(
    "/catalog/products/" + s.product.id + "?governorateId=" + s.gov.id,
  );
  assert(r2.body.units.every((u: any) => u.available));
});
test("inventory adjustments replay exactly once and a changed body with same key rejects", async () => {
  const s = await seed(),
    key = randomUUID();
  const results = await Promise.all([
    adjust(s, 2, s.carton, s.a, key),
    adjust(s, 2, s.carton, s.a, key),
  ]);
  assert(results.every((r) => r.status === 200));
  assert.equal((await adjust(s, 3, s.carton, s.a, key)).status, 409);
  assert.equal(
    (await f.owner.query("SELECT count(*)::int n FROM stock_movements")).rows[0]
      .n,
    1,
  );
  assert.equal(
    (await f.owner.query("SELECT count(*)::int n FROM outbox_events")).rows[0]
      .n,
    1,
  );
});
test("concurrent withdrawals on final stock permit one, with no counter/ledger drift", async () => {
  const s = await seed();
  await adjust(s, 12);
  const r = await Promise.all([adjust(s, -12), adjust(s, -12)]);
  assert.deepEqual(r.map((x) => x.status).sort(), [200, 409]);
  assert.equal(
    (await f.owner.query("SELECT on_hand::text FROM stock_levels")).rows[0]
      .on_hand,
    "0",
  );
});
test("transfer is atomic and idempotent; requires both branches and preserves total pieces", async () => {
  const s = await seed();
  await adjust(s, 2, s.carton);
  const body = {
      from_branch_id: s.a.id,
      to_branch_id: s.b.id,
      reason: "نقل اختبار",
      items: [{ product_id: s.product.id, unit_id: s.carton.id, quantity: 1 }],
    },
    key = randomUUID();
  const r = await req("POST", "/admin/inventory/transfers", body, key);
  assert.equal(r.status, 200);
  assert.deepEqual(
    (await req("POST", "/admin/inventory/transfers", body, key)).body,
    r.body,
  );
  const levels = (
    await f.owner.query(
      "SELECT on_hand::text FROM stock_levels ORDER BY branch_id",
    )
  ).rows;
  assert(levels.every((x) => x.on_hand === "12"));
  assert.equal(
    (await f.owner.query("SELECT count(*)::int n FROM stock_transfers")).rows[0]
      .n,
    1,
  );
  await f.owner.query(
    "UPDATE staff_grants SET global_scope=false,branch_id=$1 WHERE user_id=$2",
    [s.a.id, actor.id],
  );
  assert.equal(
    (await req("POST", "/admin/inventory/transfers", body, randomUUID()))
      .status,
    403,
  );
});
test("catalog prevents category cycles, unconfigured governorate fallback and cross-governorate pointers", async () => {
  const s = await seed();
  assert.equal(
    (
      await req("PUT", "/admin/categories/" + s.oil.id, {
        name_ar: "دورة",
        parent_id: s.oil.id,
      })
    ).status,
    409,
  );
  const other = await create("governorates", { name_ar: "محافظة أخرى" });
  assert.equal(
    (await pub("/catalog/products?governorateId=" + other.id)).status,
    409,
  );
  assert.equal(
    (
      await req("PUT", "/admin/governorates/" + other.id + "/catalog-branch", {
        branchId: s.a.id,
      })
    ).status,
    422,
  );
});
test("pagination has a stable cursor, filters do not cross categories, and inactive products disappear", async () => {
  const s = await seed();
  await create("products", {
    sku: "OIL06B",
    name_ar: "زيت ثان",
    category_id: s.oil.id,
    attributes: [{ attribute_id: s.viscosity.id, value_id: s.vv.id }],
  });
  const r = await pub(
    "/catalog/products?governorateId=" + s.gov.id + "&limit=1",
  );
  assert(r.body.nextCursor);
  const next = await pub(
    "/catalog/products?governorateId=" +
      s.gov.id +
      "&limit=1&cursor=" +
      r.body.nextCursor,
  );
  assert.notEqual(r.body.items[0].id, next.body.items[0].id);
  assert.equal(next.body.nextCursor, null);
  assert.equal(
    (await pub("/catalog/products?governorateId=" + s.gov.id + "&limit=101"))
      .status,
    422,
  );
  assert.equal(
    (
      await req("PUT", "/admin/products/" + s.product.id, {
        sku: s.product.sku,
        name_ar: s.product.name_ar,
        category_id: s.oil.id,
        active: false,
        expected_version: 1,
        attributes: [{ attribute_id: s.viscosity.id, value_id: s.vv.id }],
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await pub(
        "/catalog/products/" + s.product.id + "?governorateId=" + s.gov.id,
      )
    ).status,
    404,
  );
});
test("protected holds never expire, timed expiry reconciles counters, and history fixes carton conversion", async () => {
  const s = await seed();
  await adjust(s, 30);
  const order = (
    await f.owner.query(
      `INSERT INTO orders(customer_id,governorate_id,catalog_branch_id,kind) VALUES($1,$2,$3,'retail') RETURNING id`,
      [actor.id, s.gov.id, s.a.id],
    )
  ).rows[0];
  const details = (
    await f.owner.query(
      "INSERT INTO order_private_details(order_id,revision,address_snapshot,contact_snapshot) VALUES($1,1,'{}','{}') RETURNING id",
      [order.id],
    )
  ).rows[0];
  const quote = (
    await f.owner.query(
      `INSERT INTO order_quotes(order_id,revision,branch_id,private_details_id,subtotal_yer,delivery_yer,total_yer,distance_m,base_yer,per_km_yer,routing_source,delivery_rule_snapshot,expires_at) VALUES($1,1,$2,$3,0,0,0,0,0,0,'isolated-test','{}',now()+interval '30 minutes') RETURNING id`,
      [order.id, s.a.id, details.id],
    )
  ).rows[0];
  // Same quote can hold only one active reservation per product; check timed then protected sequentially.
  await f.owner.query(
    `INSERT INTO stock_reservations(order_id,branch_id,product_id,quote_id,pieces,expires_at) VALUES($1,$2,$3,$4,10,now()-interval '1 second')`,
    [order.id, s.a.id, s.product.id, quote.id],
  );
  await f.owner.query("UPDATE stock_levels SET reserved=10");
  assert.equal(await expireTimed(f.pool), 1);
  assert.equal(
    (await f.owner.query("SELECT reserved::text FROM stock_levels")).rows[0]
      .reserved,
    "0",
  );
  await f.owner.query(
    `INSERT INTO stock_reservations(order_id,branch_id,product_id,quote_id,pieces,hold_kind,protected_at) VALUES($1,$2,$3,$4,12,'receipt_review',now()-interval '1 day')`,
    [order.id, s.a.id, s.product.id, quote.id],
  );
  await f.owner.query("UPDATE stock_levels SET reserved=12");
  assert.equal(await expireTimed(f.pool), 0);
  assert.equal((await adjust(s, -19)).status, 409);
  await f.owner.query(
    "INSERT INTO order_request_items(order_id,product_id,unit_id,quantity) VALUES($1,$2,$3,1)",
    [order.id, s.product.id, s.carton.id],
  );
  assert.equal(
    (
      await req(
        "PUT",
        "/admin/products/" + s.product.id + "/units/" + s.carton.id,
        { unit_kind: "carton", pieces_per_unit: 24, price_yer: "5000" },
      )
    ).status,
    409,
  );
});
test("maintenance affects public catalog only; authentication and admin remain available", async () => {
  const s = await seed();
  await f.owner.query(
    "INSERT INTO customer_maintenance(enabled) VALUES(true) ON CONFLICT(singleton) DO UPDATE SET enabled=true",
  );
  assert.equal(
    (await pub("/catalog/products?governorateId=" + s.gov.id)).status,
    503,
  );
  assert.equal((await req("GET", "/admin/products")).status, 200);
  await f.owner.query("UPDATE customer_maintenance SET enabled=false");
});
async function uploadCustomer(bytes: Buffer, mime = "image/png") {
  const customer = await f.user("770006002");
  const t = await f.login(customer, "customer", device + "customer");
  const start = await f.request(
    "POST",
    "/api/v1/media/uploads",
    { purpose: "receipt", mime, size: bytes.length },
    t.accessToken,
  );
  assert.equal(start.status, 201);
  const m = (
    await f.owner.query("SELECT * FROM media_objects WHERE id=$1", [
      start.body.uploadId,
    ])
  ).rows[0];
  store.files.set(m.staging_key, bytes);
  return { customer, t, m };
}
test("direct private uploads verify real image bytes, strip EXIF, create thumbnails, and enforce owner access", async () => {
  const bytes = await sharp({
    create: { width: 30, height: 20, channels: 3, background: "#ff7700" },
  })
    .withMetadata({ exif: { IFD0: { Artist: "Remove this test metadata" } } })
    .jpeg()
    .toBuffer();
  assert((await sharp(bytes).metadata()).exif);
  const x = await uploadCustomer(bytes, "image/jpeg");
  const complete = await f.request(
    "POST",
    "/api/v1/media/uploads/" + x.m.id + "/complete",
    {},
    x.t.accessToken,
  );
  assert.equal(complete.status, 200);
  const m = (await f.owner.query("SELECT * FROM media_objects")).rows[0];
  assert.equal(m.visibility, "private");
  assert.equal(m.mime_type, "image/webp");
  assert(store.files.has(m.thumbnail_key));
  assert(!store.files.has(m.staging_key));
  assert.equal(
    (await sharp(store.files.get(m.object_key)!).metadata()).exif,
    undefined,
  );
  const other = await f.login(
    await f.user("770006003"),
    "customer",
    device + "other",
  );
  assert.equal(
    (
      await f.request(
        "GET",
        "/api/v1/media/" + m.id + "/access",
        undefined,
        other.accessToken,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await f.request(
        "POST",
        "/api/v1/media/uploads/" + m.id + "/complete",
        {},
        other.accessToken,
      )
    ).status,
    404,
  );
  assert.equal((await pub("/media/" + m.id + "/public")).status, 404);
  assert.equal(
    (
      await f.request(
        "GET",
        "/api/v1/media/" + m.id + "/access",
        undefined,
        x.t.accessToken,
      )
    ).status,
    200,
  );
  assert.equal((await req("GET", "/media/" + m.id + "/access")).status, 404);
});
test("MIME spoofing, oversized declaration and expired upload are rejected without publishing", async () => {
  const x = await uploadCustomer(Buffer.from("<script>evil</script>"));
  assert.equal(
    (
      await f.request(
        "POST",
        "/api/v1/media/uploads/" + x.m.id + "/complete",
        {},
        x.t.accessToken,
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await f.request(
        "POST",
        "/api/v1/media/uploads",
        { purpose: "receipt", mime: "image/png", size: 9000000 },
        x.t.accessToken,
      )
    ).status,
    422,
  );
  await f.owner.query(
    "UPDATE media_objects SET upload_expires_at=now()-interval '1 second'",
  );
  assert.equal(
    (
      await f.request(
        "POST",
        "/api/v1/media/uploads/" + x.m.id + "/complete",
        {},
        x.t.accessToken,
      )
    ).status,
    409,
  );
  assert.equal(
    [...store.files.keys()].filter((k) => k.startsWith("public/")).length,
    0,
  );
});

test("abandoned uploads clean only expired pending keys and preserve verified receipts", async () => {
  const bytes = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#ff7700" },
  })
    .png()
    .toBuffer();
  const x = await uploadCustomer(bytes);
  await f.owner.query(
    "UPDATE media_objects SET upload_expires_at=now()-interval '25 hours'",
  );
  assert.equal(await prunePendingMedia(f.pool, store), 1);
  assert.equal(store.files.size, 0);
  const start = await f.request(
    "POST",
    "/api/v1/media/uploads",
    { purpose: "receipt", mime: "image/png", size: bytes.length },
    x.t.accessToken,
  );
  assert.equal(start.status, 201);
  const media = (
    await f.owner.query("SELECT * FROM media_objects WHERE id=$1", [
      start.body.uploadId,
    ])
  ).rows[0];
  store.files.set(media.staging_key, bytes);
  assert.equal(
    (
      await f.request(
        "POST",
        "/api/v1/media/uploads/" + media.id + "/complete",
        {},
        x.t.accessToken,
      )
    ).status,
    200,
  );
  // Replayed PUT writes only staging; later cleanup must preserve the verified final image and thumbnail.
  store.files.set(media.staging_key, bytes);
  await f.owner.query(
    "UPDATE media_objects SET upload_expires_at=now()-interval '25 hours' WHERE id=$1",
    [media.id],
  );
  assert.equal(await prunePendingMedia(f.pool, store), 1);
  assert(!store.files.has(media.staging_key));
  assert(store.files.has(media.object_key));
  assert.equal(
    (
      await f.owner.query("SELECT status FROM media_objects WHERE id=$1", [
        media.id,
      ])
    ).rows[0].status,
    "verified",
  );

  assert.equal(
    (
      await f.owner.query("SELECT status FROM media_objects WHERE id=$1", [
        x.m.id,
      ])
    ).rows[0].status,
    "deleted",
  );
});
test("branch-scoped stock options and price writes require their exact branch permission", async () => {
  const s = await seed();
  await f.owner.query(
    "UPDATE staff_grants SET global_scope=false,branch_id=$1 WHERE user_id=$2",
    [s.a.id, actor.id],
  );
  assert.equal(
    (
      await req(
        "GET",
        "/admin/stock-products?branchId=" +
          s.a.id +
          "&permission=inventory.adjust",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await req(
        "GET",
        "/admin/stock-products?branchId=" +
          s.b.id +
          "&permission=inventory.adjust",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await req(
        "PUT",
        "/admin/branches/" + s.a.id + "/unit-prices/" + s.piece.id,
        { price_yer: "625" },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await req(
        "PUT",
        "/admin/branches/" + s.b.id + "/unit-prices/" + s.piece.id,
        { price_yer: "625" },
      )
    ).status,
    403,
  );
  const role = (
    await f.owner.query(
      "INSERT INTO roles(code,name_ar) VALUES('catalog_only_06','محرر كتالوج') RETURNING id",
    )
  ).rows[0];
  await f.owner.query(
    "INSERT INTO role_permissions(role_id,permission_code) VALUES($1,'catalog.write')",
    [role.id],
  );
  await f.owner.query(
    "UPDATE staff_grants SET role_id=$1,global_scope=true,branch_id=NULL WHERE user_id=$2",
    [role.id, actor.id],
  );
  assert.equal((await req("GET", "/admin/attributes")).status, 200);
  assert.equal(
    (await req("GET", "/admin/categories/" + s.oil.id + "/attributes")).status,
    200,
  );
  assert.equal(
    (
      await req("PUT", "/admin/attributes/" + s.viscosity.id, {
        code: "viscosity",
        name_ar: "تغيير مرفوض",
      })
    ).status,
    403,
  );
});
