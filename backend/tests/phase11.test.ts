import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fixture, device, type Fixture } from "./phase05/helpers.js";
import { seed } from "./phase09/seed.js";
import { TestStore } from "./phase06/store.js";
import { TestRouting } from "./phase07/routing.js";
import { AuthService } from "../src/identity/auth.js";
import { DeletionService } from "../src/privacy/service.js";
import {
  processReport,
  monthlySummary,
  renderPdf,
} from "../src/reports/service.js";
import { transaction } from "../src/db.js";
const approved = {
  STORE_LEGAL_NAME: "جهة اختبار معزولة",
  STORE_SUPPORT_PHONE: "+967770000000",
  PRIVACY_CONTACT_EMAIL: "privacy@example.test",
  PRIVACY_POLICY_VERSION: "isolated-11",
  PRIVACY_POLICY_APPROVED_AT: "2026-11-06",
  PRIVACY_PERSONAL_RETENTION_DAYS: "0",
  TRANSACTION_RETENTION_DAYS: "0",
  PRIVACY_SECURITY_RETENTION_DAYS: "1",
  PRIVACY_BACKUP_RETENTION_DAYS: "1",
  PRIVACY_REQUEST_TARGET_DAYS: "1",
};
let f: Fixture, s: DeletionService, store: TestStore;
before(async () => {
  store = new TestStore();
  f = await fixture({
    objectStore: store,
    routingProvider: new TestRouting(),
    configOverrides: approved,
  });
  s = new DeletionService(
    new AuthService(f.pool, f.security, f.provider),
    f.config,
    store,
  );
});
after(async () => {
  await f?.close();
});
const ctx = { ip: "127.0.0.1", requestId: randomUUID() };
async function start(phone: string, app = "web", token?: string) {
  const path = token
    ? "/api/v1/me/deletion-requests/start"
    : "/web/account-deletion/start";
  const r = await f.request(
    "POST",
    path,
    { phone, app, deviceId: device, confirm: true },
    token,
    app,
    token ? {} : { "X-Deletion-Flow": "1" },
  );
  assert.equal(r.status, 202, JSON.stringify(r.body));
  return r.body;
}
function proof(ch: any, app = "web") {
  return {
    challengeId: ch.challengeId,
    preauthToken: ch.preauthToken,
    code: f.provider.code(ch.challengeId),
    deviceId: device,
    app,
    confirm: true,
  };
}
async function verify(ch: any, app = "web") {
  const p = proof(ch, app),
    r = await f.request(
      "POST",
      app === "web"
        ? "/web/account-deletion/verify"
        : "/api/v1/account-deletion/verify",
      p,
      undefined,
      "customer",
      app === "web" ? { "X-Deletion-Flow": "1" } : {},
    );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { r: r.body, p };
}
async function identity(h: any) {
  return {
    id: h.staff.id,
    kind: "staff",
    app: "admin",
    sessionId: (
      await f.owner.query("SELECT id FROM sessions WHERE user_id=$1", [
        h.staff.id,
      ])
    ).rows[0].id,
    name_ar: h.staff.name_ar,
    phone_e164: h.staff.phone_e164,
  } as any;
}
const current = () => ({
  year: new Date().getUTCFullYear(),
  month: new Date().getUTCMonth() + 1,
});
test("public Arabic pages, legal status, cookie-free deletion and no static private report", async () => {
  await seed(f);
  for (const p of ["/privacy", "/terms", "/support", "/delete-account"]) {
    const r = await fetch(f.origin + p);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /lang="ar" dir="rtl"/);
    assert(!r.headers.has("set-cookie"));
    assert(
      r.headers.get("content-security-policy")?.includes("script-src 'self'"),
    );
  }
  const r = await f.request("GET", "/api/v1/public/legal");
  assert.equal(r.body.policy.approved, true);
  assert.equal((await fetch(f.origin + "/reports/monthly.pdf")).status, 404);
});
test("web deletion verifies once, erases identity and addresses, revokes sessions and supports lost ACK replay", async () => {
  const h = await seed(f),
    ch = await start(h.customer.phone_e164),
    { r, p } = await verify(ch);
  assert.equal(r.id, ch.requestId);
  assert.equal(r.receiptToken, ch.receiptToken);
  assert.equal(
    (
      await f.request(
        "GET",
        "/api/v1/me",
        undefined,
        (
          await f.owner.query("SELECT id FROM sessions WHERE user_id=$1", [
            h.customer.id,
          ])
        ).rows[0]
          ? await f.security.access(
              h.customer.id,
              (
                await f.owner.query(
                  "SELECT id FROM sessions WHERE user_id=$1",
                  [h.customer.id],
                )
              ).rows[0].id,
              "customer",
            )
          : "",
      )
    ).status,
    401,
  );
  await s.processOne(r.id);
  const u = (
    await f.owner.query("SELECT * FROM users WHERE id=$1", [h.customer.id])
  ).rows[0];
  assert.equal(u.status, "deleted");
  assert.equal(u.phone_e164, null);
  assert.equal(u.password_hash, null);
  assert.equal(
    (await f.owner.query("SELECT 1 FROM addresses WHERE user_id=$1", [u.id]))
      .rowCount,
    0,
  );
  const again = await f.request(
    "POST",
    "/web/account-deletion/verify",
    p,
    undefined,
    "customer",
    { "X-Deletion-Flow": "1" },
  );
  assert.equal(again.status, 200);
  assert.equal(again.body.id, r.id);
  assert.equal((await s.status(r.id, r.receiptToken)).status, "completed");
  assert.equal(
    (await f.owner.query("SELECT 1 FROM sessions WHERE user_id=$1", [u.id]))
      .rowCount,
    0,
  );
});
test("wrong OTP attempts commit, purpose and device cannot cross and status needs secret", async () => {
  const h = await seed(f),
    ch = await start(h.customer.phone_e164),
    p = proof(ch);
  for (let n = 0; n < 5; n++)
    assert.equal(
      (
        await f.request(
          "POST",
          "/web/account-deletion/verify",
          { ...p, code: p.code === "000000" ? "111111" : "000000" },
          undefined,
          "customer",
          { "X-Deletion-Flow": "1" },
        )
      ).status,
      401,
    );
  assert.equal(
    (
      await f.request(
        "POST",
        "/web/account-deletion/verify",
        p,
        undefined,
        "customer",
        { "X-Deletion-Flow": "1" },
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await f.owner.query("SELECT attempts FROM otp_challenges WHERE id=$1", [
        ch.challengeId,
      ])
    ).rows[0].attempts,
    5,
  );
  assert.equal(
    (
      await f.request(
        "POST",
        "/web/account-deletion/status",
        { requestId: ch.requestId, receiptToken: "0".repeat(64) },
        undefined,
        "customer",
        { "X-Deletion-Flow": "1" },
      )
    ).status,
    404,
  );
});
test("deletion accepts open orders, blocks new submit, keeps original order and financial facts", async () => {
  const h = await seed(f),
    id = await h.confirmed(),
    ch = await start(h.customer.phone_e164),
    { r } = await verify(ch);
  await s.processOne(r.id);
  assert.equal((await s.status(r.id, r.receiptToken)).status, "needs_review");
  assert.equal(
    (await f.owner.query("SELECT status FROM orders WHERE id=$1", [id])).rows[0]
      .status,
    "confirmed",
  );
  assert.equal(
    (
      await f.owner.query("SELECT status FROM users WHERE id=$1", [
        h.customer.id,
      ])
    ).rows[0].status,
    "active",
  );
  const ss = await f.login(
    h.customer,
    "customer",
    "new-device-11-000000000000000000000000000",
  );
  const x = await f.request(
    "POST",
    "/api/v1/orders",
    {
      governorateId: h.g,
      addressId: h.address,
      kind: "retail",
      paymentKind: "cash_on_delivery",
      items: [{ unitId: h.piece, quantity: 1 }],
    },
    ss.accessToken,
    "customer",
    { "Idempotency-Key": randomUUID() },
  );
  assert.equal(x.body.error.code, "DELETION_PENDING");
});
test("unconfigured policy receives request without claiming completion; unconfigured OTP fails without writes", async () => {
  const h = await seed(f);
  const incomplete = new DeletionService(
    s.auth,
    { ...f.config, PRIVACY_POLICY_VERSION: "" },
    store,
  );
  const ch = await incomplete.start(
      { phone: h.customer.phone_e164, deviceId: device, app: "web" },
      ctx,
    ),
    r = await incomplete.verify(proof(ch), ctx);
  await incomplete.processOne(r.id);
  assert.equal(
    (await incomplete.status(r.id, r.receiptToken)).status,
    "needs_review",
  );
  assert.equal(
    (
      await f.owner.query("SELECT status FROM users WHERE id=$1", [
        h.customer.id,
      ])
    ).rows[0].status,
    "active",
  );
  f.provider.fail = true;
  await assert.rejects(
    () =>
      s.start({ phone: "+967770007777", deviceId: device, app: "web" }, ctx),
    /تعذر إرسال/,
  );
  f.provider.fail = false;
  assert.equal(
    (
      await f.owner.query(
        "SELECT 1 FROM otp_challenges WHERE phone_e164='+967770007777'",
      )
    ).rowCount,
    0,
  );
});
test("private media deletion retries failure and cannot report completed before R2 removal", async () => {
  const h = await seed(f),
    m = await h.media(h.customer.id, "complaint"),
    ch = await start(h.customer.phone_e164),
    { r } = await verify(ch);
  await s.processOne(r.id);
  assert.equal((await s.status(r.id, r.receiptToken)).status, "processing");
  const original = store.remove.bind(store);
  store.remove = async () => {
    throw Error("isolated outage");
  };
  await s.removeFiles();
  assert.equal(
    (
      await f.owner.query(
        "SELECT state,attempts FROM privacy_file_deletions WHERE media_id=$1",
        [m],
      )
    ).rows[0].attempts,
    1,
  );
  assert.equal((await s.status(r.id, r.receiptToken)).status, "processing");
  store.remove = original;
  await f.owner.query(
    "UPDATE privacy_file_deletions SET next_attempt_at=now()",
  );
  await s.removeFiles();
  await s.processOne(r.id);
  assert.equal((await s.status(r.id, r.receiptToken)).status, "completed");
  assert.equal(
    (await f.owner.query("SELECT status FROM media_objects WHERE id=$1", [m]))
      .rows[0].status,
    "deleted",
  );
});
test("closed order snapshots redact one way while financial ledgers and quote bytes remain unchanged", async () => {
  const h = await seed(f),
    id = await h.delivered(),
    before = (
      await f.owner.query(
        "SELECT row_to_json(q) data FROM order_quotes q WHERE order_id=$1",
        [id],
      )
    ).rows;
  const ch = await start(h.customer.phone_e164),
    { r } = await verify(ch);
  await s.processOne(r.id);
  assert.equal((await s.status(r.id, r.receiptToken)).status, "completed");
  assert.deepEqual(
    (
      await f.owner.query(
        "SELECT row_to_json(q) data FROM order_quotes q WHERE order_id=$1",
        [id],
      )
    ).rows,
    before,
  );
  const d = (
    await f.owner.query(
      "SELECT * FROM order_private_details WHERE order_id=$1",
      [id],
    )
  ).rows[0];
  assert.deepEqual(d.address_snapshot, {});
  assert(d.redacted_at);
  await assert.rejects(
    () =>
      f.pool.query(
        "UPDATE order_private_details SET address_snapshot='{}' WHERE id=$1",
        [d.id],
      ),
    /permission denied/,
  );
  await assert.rejects(
    () => f.pool.query("DELETE FROM cash_collections WHERE order_id=$1", [id]),
    /permission denied/,
  );
});
test("courier balance and last administrator need review instead of abandoning money or admin access", async () => {
  const h = await seed(f);
  await h.delivered();
  const ch = await start(h.courier.phone_e164),
    { r } = await verify(ch);
  await s.processOne(r.id);
  assert.equal(
    (
      await f.owner.query(
        "SELECT review_code FROM deletion_requests WHERE id=$1",
        [r.id],
      )
    ).rows[0].review_code,
    "courier_balance",
  );
  const a = await start(h.staff.phone_e164),
    x = await verify(a);
  await s.processOne(x.r.id);
  assert.equal(
    (
      await f.owner.query(
        "SELECT review_code FROM deletion_requests WHERE id=$1",
        [x.r.id],
      )
    ).rows[0].review_code,
    "last_admin",
  );
});
test("monthly summary separates actual money from delivered sales and includes empty selected branch", async () => {
  const h = await seed(f);
  await h.delivered();
  await h.confirmed();
  const summary = await transaction(f.pool, (db) =>
    monthlySummary(db, { ...current(), branchIds: [h.b, h.b2] }, "UTC"),
  );
  assert.equal(summary.totals.deliveredOrders, "1");
  assert.equal(summary.totals.salesTotal, "500");
  assert.equal(summary.totals.deliveryBefore, "400");
  assert.equal(summary.totals.deliveryDiscount, "0");
  assert.equal(summary.totals.commissionEarned, "80");
  assert.equal(summary.totals.cashCollected, "500");
  assert.equal(summary.totals.cashRemitted, "0");
  assert.equal(summary.rows.find((x) => x.branchId === h.b2)?.salesTotal, "0");
});
test("Arabic PDF renders and is downloadable only by its requester with live branch permission", async () => {
  const h = await seed(f);
  await h.delivered();
  const key = randomUUID(),
    input = { ...current(), branchIds: [h.b] };
  const req = () =>
    f.request(
      "POST",
      "/api/v1/admin/reports/monthly-sales",
      input,
      h.admin,
      "admin",
      { "Idempotency-Key": key },
    );
  const r = await req();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await req()).body.id, r.body.id);
  await processReport(f.pool);
  const j = await f.request(
    "GET",
    "/api/v1/admin/reports/" + r.body.id,
    undefined,
    h.admin,
    "admin",
  );
  assert.equal(j.body.state, "ready", JSON.stringify(j.body));
  const pdf = await fetch(
    f.origin + "/api/v1/admin/reports/" + r.body.id + "/download",
    {
      headers: { Authorization: "Bearer " + h.admin, "X-Client-App": "admin" },
    },
  );
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get("content-type")!, /application\/pdf/);
  const bytes = Buffer.from(await pdf.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  await writeFile("/workspace/.phase11-work/monthly-sales.pdf", bytes);
  assert.equal(
    (await fetch(f.origin + "/api/v1/admin/reports/" + r.body.id + "/download"))
      .status,
    401,
  );
  await f.owner.query("DELETE FROM staff_grants WHERE user_id=$1", [
    h.staff.id,
  ]);
  assert.equal(
    (
      await f.request(
        "GET",
        "/api/v1/admin/reports/" + r.body.id,
        undefined,
        h.admin,
        "admin",
      )
    ).status,
    403,
  );
});
test("PDF renderer failure records failed state without exposing exception, and denies cross-branch report", async () => {
  const h = await seed(f);
  const r = await f.request(
    "POST",
    "/api/v1/admin/reports/monthly-sales",
    { ...current(), branchIds: [h.b] },
    h.admin,
    "admin",
    { "Idempotency-Key": randomUUID() },
  );
  await processReport(f.pool, async () => {
    throw Error("sensitive internal details");
  });
  const j = await f.request(
    "GET",
    "/api/v1/admin/reports/" + r.body.id,
    undefined,
    h.admin,
    "admin",
  );
  assert.equal(j.body.state, "failed");
  assert(!JSON.stringify(j.body).includes("sensitive internal"));
  await f.owner.query("DELETE FROM staff_grants WHERE user_id=$1;", [
    h.staff.id,
  ]);
  assert.equal(
    (
      await f.request(
        "POST",
        "/api/v1/admin/reports/monthly-sales",
        { ...current(), branchIds: [h.b2] },
        h.admin,
        "admin",
        { "Idempotency-Key": randomUUID() },
      )
    ).status,
    403,
  );
});
test("monthly UTC and Asia/Aden boundaries include half-open next month accurately", async () => {
  const h = await seed(f);
  const utc = await transaction(f.pool, (db) =>
    monthlySummary(db, { year: 2026, month: 11, branchIds: [h.b] }, "UTC"),
  );
  const aden = await transaction(f.pool, (db) =>
    monthlySummary(
      db,
      { year: 2026, month: 11, branchIds: [h.b] },
      "Asia/Aden",
    ),
  );
  assert.equal(utc.periodStart, "2026-11-01T00:00:00.000Z");
  assert.equal(aden.periodStart, "2026-10-31T21:00:00.000Z");
  assert.equal(aden.periodEnd, "2026-11-30T21:00:00.000Z");
});
test("cash and commission reversal credits are reported separately without new earnings or duplicated payout headers", async () => {
  const h = await seed(f);
  await h.delivered();
  const money = (await h.req("/courier/cash-balance")).body.sources[0],
    earning = (await h.req("/courier/earnings")).body.sources[0];
  const a = await h.req(
    "/admin/cash-remittances",
    {
      courierId: h.courier.id,
      sourceIds: [money.id],
      totalYer: "500",
      reference: randomUUID(),
    },
    true,
  );
  assert.equal(a.status, 200);
  const b = await h.req(
    "/admin/settlements",
    {
      courierId: h.courier.id,
      sourceIds: [earning.id],
      totalYer: "80",
      reference: randomUUID(),
    },
    true,
  );
  assert.equal(b.status, 200);
  const proofMediaId = await h.media(h.staff.id, "financial_proof");
  const ar = await h.req(
    "/admin/cash-remittances/" + a.body.id + "/reversals",
    { reason: "عكس اختبار11", reference: randomUUID(), proofMediaId },
    true,
  );
  assert.equal(ar.status, 200);
  const br = await h.req(
    "/admin/settlements/" + b.body.id + "/reversals",
    { reason: "عكس اختبار11", reference: randomUUID(), proofMediaId },
    true,
  );
  assert.equal(br.status, 200);
  assert.equal(
    (
      await h.req(
        "/admin/cash-remittances",
        {
          courierId: h.courier.id,
          reversalCreditIds: [ar.body.id],
          totalYer: "500",
          reference: randomUUID(),
        },
        true,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await h.req(
        "/admin/settlements",
        {
          courierId: h.courier.id,
          reversalCreditIds: [br.body.id],
          totalYer: "80",
          reference: randomUUID(),
        },
        true,
      )
    ).status,
    200,
  );
  const x = await transaction(f.pool, (db) =>
    monthlySummary(db, { ...current(), branchIds: [h.b] }, "UTC"),
  );
  assert.equal(x.totals.commissionEarned, "80");
  assert.equal(x.totals.commissionPaid, "160");
  assert.equal(x.totals.commissionReversals, "80");
  assert.equal(x.totals.commissionPaidNet, "80");
  assert.equal(x.totals.cashRemitted, "1000");
  assert.equal(x.totals.cashRemittanceReversals, "500");
  assert.equal(x.totals.cashRemittedNet, "500");
});
test("pre-discount delivery basis, discount and commission remain independent in monthly PDF facts", async () => {
  const h = await seed(f);
  await f.owner.query("UPDATE delivery_rules SET base_yer=400");
  await f.owner.query(
    "INSERT INTO promotions(name_ar,target,discount_kind,value,starts_at,ends_at) VALUES('خصم معزول11','delivery','fixed',100,now()-interval '1 hour',now()+interval '1 hour')",
  );
  await h.delivered();
  const x = await transaction(f.pool, (db) =>
    monthlySummary(db, { ...current(), branchIds: [h.b] }, "UTC"),
  );
  assert.equal(x.totals.deliveryBefore, "500");
  assert.equal(x.totals.deliveryDiscount, "100");
  assert.equal(x.totals.customerDelivery, "400");
  assert.equal(x.totals.commissionEarned, "100");
  assert.equal(x.totals.cashCollected, "500");
});
test("concurrent deletion verification creates one request and one receipt without replaying deletion", async () => {
  const h = await seed(f),
    ch = await start(h.customer.phone_e164),
    p = proof(ch);
  const results = await Promise.all(
    [1, 2, 3].map(() =>
      f.request(
        "POST",
        "/web/account-deletion/verify",
        p,
        undefined,
        "customer",
        { "X-Deletion-Flow": "1" },
      ),
    ),
  );
  results.forEach((x) => assert.equal(x.status, 200));
  assert.equal(new Set(results.map((x) => x.body.id)).size, 1);
  assert.equal(
    (await f.owner.query("SELECT count(*)::int n FROM deletion_requests"))
      .rows[0].n,
    1,
  );
  await Promise.all([s.processOne(ch.requestId), s.processOne(ch.requestId)]);
  assert.equal(
    (
      await f.owner.query(
        "SELECT count(*)::int n FROM audit_logs WHERE action='privacy.account_erased'",
      )
    ).rows[0].n,
    1,
  );
});
test("approved future personal retention delays snapshot redaction but removes account identity immediately", async () => {
  const h = await seed(f),
    id = await h.delivered();
  const long = new DeletionService(
      s.auth,
      { ...f.config, PRIVACY_PERSONAL_RETENTION_DAYS: 30 },
      store,
    ),
    ch = await long.start(
      { phone: h.customer.phone_e164, deviceId: device, app: "web" },
      ctx,
    ),
    r = await long.verify(proof(ch), ctx);
  await long.processOne(r.id);
  const status = await long.status(r.id, r.receiptToken);
  assert.equal(status.status, "processing");
  assert(status.accountErasedAt);
  assert(status.retainedUntil);
  assert.equal(
    (
      await f.owner.query(
        "SELECT redacted_at FROM order_private_details WHERE order_id=$1",
        [id],
      )
    ).rows[0].redacted_at,
    null,
  );
  assert.equal(
    (
      await f.owner.query("SELECT phone_e164 FROM users WHERE id=$1", [
        h.customer.id,
      ])
    ).rows[0].phone_e164,
    null,
  );
});
test("web rejects cross-origin and missing custom header; verified status never discloses phone or internal reasons", async () => {
  const h = await seed(f),
    body = {
      phone: h.customer.phone_e164,
      deviceId: device,
      app: "web",
      confirm: true,
    };
  assert.equal(
    (await f.request("POST", "/web/account-deletion/start", body)).status,
    403,
  );
  assert.equal(
    (
      await f.request(
        "POST",
        "/web/account-deletion/start",
        body,
        undefined,
        "customer",
        { "X-Deletion-Flow": "1", Origin: "https://hostile.example" },
      )
    ).status,
    403,
  );
  const ch = await start(h.customer.phone_e164),
    { r } = await verify(ch);
  const data = JSON.stringify(await s.status(r.id, r.receiptToken));
  assert(!data.includes(h.customer.phone_e164));
  assert(!data.includes("proof_digest"));
  assert(!data.includes("user_id"));
});
test("multi-branch payout attributes each source once, including a full reversal and reallocation", async () => {
  const h = await seed(f);
  await h.delivered();
  const id = await h.submit();
  await h.quote(id, h.b2);
  await h.accept(id);
  assert.equal((await h.confirm(id)).status, 200);
  await h.assign(id);
  assert.equal((await h.cmd(id, "start")).status, 200);
  assert.equal(
    (
      await h.cmd(id, "cash-collections", {
        amountYer: "500",
        reference: randomUUID(),
        collectedAt: new Date().toISOString(),
      })
    ).status,
    200,
  );
  assert.equal((await h.cmd(id, "deliver")).status, 200);
  const src = (await h.req("/courier/earnings")).body.sources,
    pay = await h.req(
      "/admin/settlements",
      {
        courierId: h.courier.id,
        sourceIds: src.map((x: any) => x.id),
        totalYer: "160",
        reference: randomUUID(),
      },
      true,
    );
  assert.equal(pay.status, 200);
  const ar = await h.req(
    "/admin/settlements/" + pay.body.id + "/reversals",
    {
      reason: "عكس دفعة فرعين",
      reference: randomUUID(),
      proofMediaId: await h.media(h.staff.id, "financial_proof"),
    },
    true,
  );
  assert.equal(ar.status, 200);
  assert.equal(
    (
      await h.req(
        "/admin/settlements",
        {
          courierId: h.courier.id,
          reversalCreditIds: [ar.body.id],
          totalYer: "160",
          reference: randomUUID(),
        },
        true,
      )
    ).status,
    200,
  );
  const all = await transaction(f.pool, (db) =>
      monthlySummary(db, { ...current(), branchIds: [h.b, h.b2] }, "UTC"),
    ),
    one = await transaction(f.pool, (db) =>
      monthlySummary(db, { ...current(), branchIds: [h.b] }, "UTC"),
    );
  assert.equal(all.totals.salesTotal, "1000");
  assert.equal(all.totals.commissionPaid, "320");
  assert.equal(all.totals.commissionReversals, "160");
  assert.equal(one.totals.commissionPaid, "160");
  assert.equal(one.totals.commissionReversals, "80");
  assert.equal(one.totals.commissionEarned, "80");
});
test("native deletion proof survives lost acknowledgement and its pending receipt can query after session invalidation", async () => {
  const h = await seed(f),
    sid = (
      await f.owner.query("SELECT id FROM sessions WHERE user_id=$1", [
        h.customer.id,
      ])
    ).rows[0].id,
    token = await f.security.access(h.customer.id, sid, "customer"),
    ch = await start(h.customer.phone_e164, "customer", token),
    p = proof(ch, "customer");
  const r = await f.request(
    "POST",
    "/api/v1/account-deletion/verify",
    p,
    token,
  );
  assert.equal(r.status, 200);
  await s.processOne(r.body.id);
  const replay = await f.request(
    "POST",
    "/api/v1/account-deletion/verify",
    p,
    token,
  );
  assert.equal(replay.status, 200);
  const st = await f.request(
    "POST",
    "/api/v1/account-deletion/status",
    { requestId: ch.requestId, receiptToken: ch.receiptToken },
    token,
  );
  assert.equal(st.status, 200);
  assert.equal(st.body.status, "completed");
});
test("pending signed upload is not marked deleted before its URL expires", async () => {
  const h = await seed(f),
    id = await h.media(h.customer.id, "complaint");
  await f.owner.query(
    "UPDATE media_objects SET status='pending',staging_key='staging/isolated11',upload_expires_at=now()+interval '5 minutes' WHERE id=$1",
    [id],
  );
  const ch = await start(h.customer.phone_e164),
    { r } = await verify(ch);
  await s.processOne(r.id);
  await s.removeFiles();
  assert.equal((await s.status(r.id, r.receiptToken)).status, "processing");
  assert.equal(
    (
      await f.owner.query(
        "SELECT state FROM privacy_file_deletions WHERE media_id=$1",
        [id],
      )
    ).rows[0].state,
    "pending",
  );
});
test("privacy-role capability cannot erase an unverified request or rewrite a financial ledger", async () => {
  const h = await seed(f),
    r = (
      await f.owner.query(
        "INSERT INTO deletion_requests(user_id,source,status) VALUES($1,'web','requested') RETURNING id",
        [h.customer.id],
      )
    ).rows[0];
  assert.equal(
    (await f.pool.query("SELECT privacy_erase_account($1) code", [r.id]))
      .rows[0].code,
    "ineligible",
  );
  assert.equal(
    (
      await f.owner.query("SELECT status FROM users WHERE id=$1", [
        h.customer.id,
      ])
    ).rows[0].status,
    "active",
  );
  const rights = (
    await f.owner.query(
      "SELECT has_table_privilege('tazweed_privacy','cash_collections','UPDATE,DELETE') mutate,has_schema_privilege('tazweed_privacy','public','CREATE') ddl, pg_has_role('tazweed_app','tazweed_privacy','MEMBER') member",
    )
  ).rows[0];
  assert.deepEqual(rights, { mutate: false, ddl: false, member: false });
});
test("queued private file cannot acquire a new complaint, receipt or financial-proof reference", async () => {
  const h = await seed(f),
    id = await h.media(h.customer.id, "customer_flag"),
    ch = await start(h.customer.phone_e164),
    { r } = await verify(ch);
  await s.processOne(r.id);
  await assert.rejects(
    () =>
      f.pool.query(
        "INSERT INTO customer_flags(customer_id,reporter_id,details_ar,attachment_id) VALUES($1,$2,'اختبار مرجع بعد طلب المحو',$3)",
        [h.customer.id, h.staff.id, id],
      ),
    /Private media unavailable/,
  );
});
test("approved transfer and external resolutions have distinct monthly columns from cash and sales", async () => {
  const h = await seed(f),
    id = await h.submit("retail", "transfer");
  await h.quote(id);
  await h.accept(id);
  const payment = await h.receipt(id);
  assert.equal((await h.review(id, payment)).status, 200);
  assert.equal((await h.confirm(id)).status, 200);
  await h.assign(id);
  assert.equal((await h.cmd(id, "start")).status, 200);
  assert.equal((await h.cmd(id, "deliver")).status, 200);
  const proofId = await h.media(h.staff.id, "financial_proof"),
    e = (
      await f.owner.query(
        "INSERT INTO financial_exceptions(order_id,kind,amount_yer,reason,opened_by,branch_id) VALUES($1,'other',100,'تسوية اختبار11',$2,$3) RETURNING id",
        [id, h.staff.id, h.b],
      )
    ).rows[0];
  for (const [direction, amount] of [
    ["received_from_customer", 100],
    ["refund_to_customer", 30],
    ["write_off", 20],
    ["other", 5],
  ])
    await f.owner.query(
      "INSERT INTO financial_exception_resolutions(exception_id,direction,amount_yer,reason,reference,proof_media_id,actor_id,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,now())",
      [
        e.id,
        direction,
        amount,
        "حركة خارجية معزولة",
        randomUUID(),
        proofId,
        h.staff.id,
      ],
    );
  const x = await transaction(f.pool, (db) =>
    monthlySummary(db, { ...current(), branchIds: [h.b] }, "UTC"),
  );
  assert.equal(x.totals.approvedTransfers, "500");
  assert.equal(x.totals.cashCollected, "0");
  assert.equal(x.totals.salesTotal, "500");
  assert.equal(x.totals.externalReceived, "100");
  assert.equal(x.totals.externalRefunded, "30");
  assert.equal(x.totals.externalWriteOff, "20");
  assert.equal(x.totals.externalOther, "5");
});
test("same-origin browser JSON flow is allowed while unrelated origins remain forbidden", async () => {
  const h = await seed(f);
  const r = await f.request(
    "POST",
    "/web/account-deletion/start",
    {
      phone: h.customer.phone_e164,
      app: "web",
      deviceId: device,
      confirm: true,
    },
    undefined,
    "customer",
    { "X-Deletion-Flow": "1", Origin: f.origin },
  );
  assert.equal(r.status, 202);
});
