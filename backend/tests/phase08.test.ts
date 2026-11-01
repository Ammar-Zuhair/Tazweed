import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture, type Fixture } from "./phase05/helpers.js";
import { TestRouting } from "./phase07/routing.js";
import { TestStore } from "./phase06/store.js";
import { seed } from "./phase08/seed.js";
import { expireTimed } from "../src/catalog/stock.js";
import { alertOverdueReceipts } from "../src/orders/worker.js";
import { normalizeReceipt } from "../src/orders/service.js";
let f: Fixture, h: Awaited<ReturnType<typeof seed>>;
const routing = new TestRouting(),
  store = new TestStore();
before(async () => {
  f = await fixture({ routingProvider: routing, objectStore: store });
});
after(async () => f?.close());
beforeEach(async () => {
  routing.reset();
  h = await seed(f);
});
test("receipt normalization accepts Arabic/Persian digits; money contracts reject fractional or forged fields", async () => {
  assert.equal(normalizeReceipt("۱۲٣- abc"), "123ABC");
  const id = await ready("transfer"),
    ins = await h.instructions(id),
    d = await h.get(id);
  assert.equal(
    (
      await h.post(`/orders/${id}/receipts`, {
        expectedVersion: d.order.version,
        instructionId: ins,
        receiptNumber: "N",
        amountYer: "1.5",
        mediaId: await h.media(),
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await h.post(
        `/admin/orders/${id}/confirm`,
        { expectedVersion: d.order.version, total_yer: "0" },
        true,
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await h.post(
        `/admin/orders/${id}/payments/${randomUUID()}/review`,
        {
          expectedVersion: d.order.version,
          attemptId: randomUUID(),
          outcome: "transfer_verified",
          verifiedAmountYer: "1.5",
          note: "رفض مبلغ كسري",
          stockAction: "consume_on_confirmation",
        },
        true,
      )
    ).status,
    422,
  );
});
test("manual road failure needs explicit fee and reason; quote address revision preserves old private snapshot", async () => {
  const id = await h.submit();
  routing.fail = "NO_ROUTE";
  let d = await h.get(id);
  let r = await h.post(
    `/admin/orders/${id}/quotes`,
    { expectedVersion: d.order.version, branchId: h.b, reason: "تعذر الطريق" },
    true,
  );
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, "NO_ROUTE");
  await h.quote(id, h.b, { manualDeliveryYer: "420" });
  await h.accept(id);
  const old = (await h.get(id)).quotes[0];
  await f.owner.query(
    "UPDATE addresses SET latitude=15.02,description='عنوان مصحح' WHERE id=$1",
    [h.address],
  );
  await h.quote(id, h.b, { manualDeliveryYer: "420", addressId: h.address });
  d = await h.get(id);
  assert.notEqual(d.quotes[0].private_details_id, old.private_details_id);
  assert.equal(d.privateDetails.address_snapshot.description, "عنوان مصحح");
  const facts = JSON.stringify(d.quotes[0].delivery_rule_snapshot);
  assert(!facts.includes("15.02"));
  assert(!facts.includes(h.customer.phone_e164));
  assert.equal(d.quotes[0].status, "sent");
});
test("receipt limit is enforced without saving an extra transfer", async () => {
  const id = await ready("transfer"),
    ins = await h.instructions(id);
  const limit = f.config.RECEIPT_ATTEMPT_LIMIT_PER_HOUR;
  for (let n = 0; n < limit; n++) {
    const d = await h.get(id);
    const r = await h.post(`/orders/${id}/receipts`, {
      expectedVersion: d.order.version,
      instructionId: ins,
      receiptNumber: "LIMIT-" + n,
      amountYer: "1",
      mediaId: await h.media(),
    });
    assert.equal(r.status, 200);
  }
  const d = await h.get(id),
    r = await h.post(`/orders/${id}/receipts`, {
      expectedVersion: d.order.version,
      instructionId: ins,
      receiptNumber: "LIMIT-MORE",
      amountYer: "1",
      mediaId: await h.media(),
    });
  assert.equal(r.status, 429);
  assert.equal((await h.get(id)).payments.length, limit);
});
test("same normalized bank transfer cannot be reused on another order", async () => {
  const first = await ready("transfer");
  await h.receipt(first, "500", "٧٧٧-ABC");
  const second = await ready("transfer"),
    ins = await h.instructions(second),
    d = await h.get(second);
  const r = await h.post(`/orders/${second}/receipts`, {
    expectedVersion: d.order.version,
    instructionId: ins,
    receiptNumber: "777 abc",
    amountYer: "500",
    mediaId: await h.media(),
  });
  assert.equal(r.status, 409);
  assert.equal((await h.get(second)).payments.length, 0);
});
test("confirmed invoice cannot be changed by exception settlement; proof and monetary ledger remain private/append-only", async () => {
  const id = await ready("transfer"),
    pid = await h.receipt(id);
  await h.review(id, pid);
  assert.equal((await h.confirm(id)).status, 200);
  const d = await h.get(id),
    e = await h.post(
      `/admin/orders/${id}/exceptions`,
      {
        expectedVersion: d.order.version,
        kind: "other",
        amountYer: "100",
        reason: "طلب تغيير مرفوض للمبلغ",
      },
      true,
    );
  assert.equal(e.status, 200);
  assert.equal(
    (await settle(id, e.body.exceptionId, "received_from_customer", "100"))
      .status,
    409,
  );
  assert.equal(
    (await settle(id, e.body.exceptionId, "refund_to_customer", "100")).status,
    409,
  );
  const after = await h.get(id);
  assert.equal(after.quotes[0].total_yer, "500");
  assert.equal(after.order.status, "confirmed");
});
test("rejected corrected image after explicit release opens a late-transfer exception without restoring stock", async () => {
  const id = await ready("transfer"),
    pid = await h.receipt(id);
  await h.review(id, pid, "image_rejected", "0", "release_after_review");
  const d = await h.get(id);
  const r = await h.post(`/orders/${id}/payments/${pid}/images`, {
    expectedVersion: d.order.version,
    mediaId: await h.media(),
  });
  assert.equal(r.status, 200);
  const after = await h.get(id);
  assert.equal(after.openExceptions, 1);
  assert.equal(after.holds.filter((h: any) => h.state === "active").length, 0);
});
test("duplicate external monetary reference cannot be recorded twice with a different key", async () => {
  const id = await ready("transfer"),
    pid = await h.receipt(id, "600");
  await h.review(id, pid, "transfer_verified", "600");
  let d = await h.get(id);
  const e = d.exceptions[0],
    ref = "EXTERNAL-REF-08";
  const body = {
    exceptionId: e.id,
    direction: "refund_to_customer",
    amountYer: "50",
    reason: "رد جزئي موثق",
    reference: ref,
    proofMediaId: await h.media(h.staff.id, "financial_proof"),
    occurredAt: new Date().toISOString(),
  };
  assert.equal(
    (
      await h.post(
        `/admin/orders/${id}/settlements`,
        { ...body, expectedVersion: d.order.version },
        true,
      )
    ).status,
    200,
  );
  d = await h.get(id);
  assert.equal(
    (
      await h.post(
        `/admin/orders/${id}/settlements`,
        { ...body, expectedVersion: d.order.version },
        true,
      )
    ).status,
    409,
  );
});
test("linked private proof and an idempotent settlement replay recheck live branch grants even for the uploader", async () => {
  const id = await ready("transfer"),
    pid = await h.receipt(id, "600");
  await h.review(id, pid, "transfer_verified", "600");
  let d = await h.get(id);
  const proof = await h.media(h.staff.id, "financial_proof"),
    key = randomUUID();
  const body = {
    expectedVersion: d.order.version,
    exceptionId: d.exceptions[0].id,
    direction: "refund_to_customer",
    amountYer: "100",
    reason: "رد زيادة موثق",
    reference: "PROOF-08-LIVE-SCOPE",
    proofMediaId: proof,
    occurredAt: new Date().toISOString(),
  };
  assert.equal(
    (await h.post(`/admin/orders/${id}/settlements`, body, true, key)).status,
    200,
  );
  assert.equal(
    (
      await f.request(
        "GET",
        `/api/v1/media/${proof}/access`,
        undefined,
        h.admin,
        "admin",
      )
    ).status,
    200,
  );
  d = await h.get(id);
  assert(!("proof_media_id" in d.exceptions[0].resolutions[0]));
  const role = (
    await f.owner.query(
      "INSERT INTO roles(code,name_ar) VALUES('proof08_scope','نطاق إثبات08') RETURNING id",
    )
  ).rows[0].id;
  await f.owner.query(
    "INSERT INTO role_permissions(role_id,permission_code) VALUES($1,'financial-exceptions.resolve')",
    [role],
  );
  await f.owner.query("DELETE FROM staff_grants WHERE user_id=$1", [
    h.staff.id,
  ]);
  await f.owner.query(
    "INSERT INTO staff_grants(user_id,role_id,branch_id) VALUES($1,$2,$3)",
    [h.staff.id, role, h.b2],
  );
  assert.equal(
    (
      await f.request(
        "GET",
        `/api/v1/media/${proof}/access`,
        undefined,
        h.admin,
        "admin",
      )
    ).status,
    403,
  );
  assert.equal(
    (await h.post(`/admin/orders/${id}/settlements`, body, true, key)).status,
    403,
  );
  assert.equal(
    (
      await f.owner.query(
        "SELECT count(*)::int n FROM financial_exception_resolutions",
      )
    ).rows[0].n,
    1,
  );
});
test("reviewed funded branch replacement requires explicit carry, new acceptance and preserves protected stock without a fictitious refund", async () => {
  const id = await ready("transfer"),
    pid = await h.receipt(id);
  assert.equal(
    (
      await h.review(
        id,
        pid,
        "transfer_verified",
        "500",
        "release_after_review",
      )
    ).status,
    200,
  );
  let d = await h.get(id);
  const e = d.exceptions[0];
  assert.equal((await settle(id, e.id, "other", "0")).status, 200);
  d = await h.get(id);
  assert.equal(
    (
      await h.post(
        `/admin/orders/${id}/resolve`,
        {
          expectedVersion: d.order.version,
          exceptionId: e.id,
          reason: "مخزون الفرع البديل متاح والرصيد محفوظ للطلب",
        },
        true,
      )
    ).status,
    200,
  );
  d = await h.get(id);
  assert.equal(
    (
      await h.post(
        `/admin/orders/${id}/quotes`,
        {
          expectedVersion: d.order.version,
          branchId: h.b2,
          reason: "نقل بعد المراجعة",
        },
        true,
      )
    ).status,
    409,
  );
  await h.quote(id, h.b2, { carryVerifiedMoney: true });
  assert.equal((await h.confirm(id)).status, 409);
  await h.accept(id);
  await ageQuote(id);
  d = await h.get(id);
  assert(
    d.holds.some(
      (r: any) =>
        r.branch_id === h.b2 &&
        r.state === "active" &&
        r.hold_kind === "receipt_review",
    ),
  );
  assert.equal((await h.confirm(id)).status, 200);
  d = await h.get(id);
  assert.equal(d.payments.length, 1);
  assert.equal(d.quotes[1].branch_id, h.b);
  assert.equal(d.quotes[0].branch_id, h.b2);
  assert.equal(d.order.status, "confirmed");
  assert.equal(d.exceptions[0].resolutions[0].amount_yer, "0");
});
async function ready(payment = "cash_on_delivery", kind = "retail") {
  const id = await h.submit(kind, payment);
  await h.quote(
    id,
    h.b,
    kind === "wholesale"
      ? { unitPrices: [{ unitId: h.piece, priceYer: "80" }] }
      : {},
  );
  await h.accept(id);
  return id;
}
async function settle(
  id: string,
  eid: string,
  direction: string,
  amountYer: string,
) {
  return h.post(
    `/admin/orders/${id}/settlements`,
    {
      expectedVersion: (await h.get(id)).order.version,
      exceptionId: eid,
      direction,
      amountYer,
      reason: "تسوية موثقة اختبار",
      reference: randomUUID(),
      proofMediaId: await h.media(h.staff.id, "financial_proof"),
      occurredAt: new Date().toISOString(),
    },
    true,
  );
}
test("submission has no hold; issue creates exact 30 minute hold and outbox atomically", async () => {
  const id = await h.submit();
  assert.equal((await h.get(id)).holds.length, 0);
  await h.quote(id);
  const d = await h.get(id);
  assert.equal(d.quotes[0].total_yer, "500");
  assert.equal(d.holds[0].pieces, "1");
  assert.equal(
    new Date(d.holds[0].expires_at).getTime() -
      new Date(d.quotes[0].created_at).getTime(),
    1800000,
  );
  assert.equal(d.quotes[0].billed_km, 2);
  assert(
    (
      await f.pool.query("SELECT 1 FROM outbox_events WHERE aggregate_id=$1", [
        id,
      ])
    ).rowCount,
  );
});
test("COD confirms without any transfer or receipt and never records collected cash/commission/assignment", async () => {
  const id = await ready();
  const r = await h.confirm(id);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const d = await h.get(id);
  assert.equal(d.order.status, "confirmed");
  assert.equal(d.payments.length, 0);
  assert.equal(d.cashCollected, false);
  assert.equal(d.holds[0].state, "consumed");
  for (const t of ["cash_collections", "order_assignments", "courier_earnings"])
    assert.equal(
      Number((await f.owner.query(`SELECT count(*) n FROM ${t}`)).rows[0].n),
      0,
    );
});
test("wholesale prices are explicit and quote retains requested retail unit identity", async () => {
  const id = await h.submit("wholesale");
  let d = await h.get(id);
  assert.equal(
    (
      await h.post(
        `/admin/orders/${id}/quotes`,
        { expectedVersion: d.order.version, branchId: h.b, reason: "جملة" },
        true,
      )
    ).status,
    422,
  );
  await h.quote(id, h.b, { unitPrices: [{ unitId: h.piece, priceYer: "80" }] });
  await h.accept(id);
  assert.equal((await h.get(id)).quotes[0].total_yer, "480");
  assert.equal((await h.confirm(id)).status, 200);
});
test("equal-price branch change produces new revision requiring a fresh customer acceptance; old acceptance retained", async () => {
  const id = await ready();
  const old = (await h.get(id)).quotes[0];
  await h.quote(id, h.b2);
  let d = await h.get(id);
  assert.equal(d.quotes[0].total_yer, old.total_yer);
  assert.equal(d.quotes[1].status, "superseded");
  assert(d.quotes[1].accepted_at);
  assert.equal((await h.confirm(id)).status, 409);
  assert.equal(
    (
      await h.post(`/orders/${id}/decision`, {
        expectedVersion: d.order.version,
        quoteId: old.id,
        accept: true,
      })
    ).status,
    409,
  );
  await h.accept(id);
  assert.equal((await h.confirm(id)).status, 200);
});
test("immutable instructions retain destination after payment method edit", async () => {
  const id = await ready("transfer");
  const ins = await h.instructions(id);
  await f.owner.query(
    "UPDATE payment_methods SET destination_number='CHANGED' WHERE id=$1",
    [h.method],
  );
  const d = await h.get(id);
  assert.equal(
    d.instructions.find((x: any) => x.id === ins).method_snapshot
      .destination_number,
    "TEST-08-NOT-PAYABLE",
  );
});
test("verified exact transfer confirms once; repeated idempotency key cannot double sale or outbox", async () => {
  const id = await ready("transfer"),
    pid = await h.receipt(id);
  assert.equal((await h.confirm(id)).status, 409);
  assert.equal((await h.review(id, pid)).status, 200);
  const d = await h.get(id),
    v = { expectedVersion: d.order.version },
    key = randomUUID();
  const rs = await Promise.all([
    h.post(`/admin/orders/${id}/confirm`, v, true, key),
    h.post(`/admin/orders/${id}/confirm`, v, true, key),
  ]);
  assert.deepEqual(
    rs.map((r) => r.status),
    [200, 200],
  );
  assert.deepEqual(rs[0].body, rs[1].body);
  assert.equal(
    (
      await f.owner.query(
        "SELECT count(*)::int n FROM stock_movements WHERE order_id=$1 AND reason='sale'",
        [id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await h.post(
        `/admin/orders/${id}/confirm`,
        { expectedVersion: d.order.version + 1 },
        true,
        key,
      )
    ).status,
    409,
  );
});
test("receipt protects stock and price beyond initial deadline; overdue alert is deduplicated", async () => {
  const id = await ready("transfer"),
    pid = await h.receipt(id);
  await ageQuote(id);
  await f.owner.query(
    "UPDATE stock_reservations SET protected_at=now()-interval '3 days' WHERE order_id=$1",
    [id],
  );
  await expireTimed(f.pool);
  await alertOverdueReceipts(f.pool, 60);
  await alertOverdueReceipts(f.pool, 60);
  const d = await h.get(id);
  assert.equal(d.holds[0].state, "active");
  assert.equal(d.holds[0].hold_kind, "receipt_review");
  assert.equal(d.holds[0].expires_at, null);
  assert.equal(d.holds[0].overdue, true);
  assert.equal(
    (
      await f.pool.query(
        "SELECT count(*)::int n FROM outbox_events WHERE dedupe_key=$1",
        ["receipt-overdue:" + d.order.current_quote_id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal((await h.review(id, pid)).status, 200);
  assert.equal((await h.confirm(id)).status, 200);
});
test("image rejection keeps protected hold; correction appends image to same transfer and preserves review history", async () => {
  const id = await ready("transfer"),
    pid = await h.receipt(id);
  assert.equal(
    (await h.review(id, pid, "image_rejected", "0", "keep_for_correction"))
      .status,
    200,
  );
  let d = await h.get(id);
  assert.equal(d.holds[0].hold_kind, "receipt_review");
  assert.equal(
    (
      await h.post(`/orders/${id}/payments/${pid}/images`, {
        expectedVersion: d.order.version,
        mediaId: await h.media(),
      })
    ).status,
    200,
  );
  d = await h.get(id);
  assert.equal(d.payments.length, 1);
  assert.equal(d.payments[0].attempts.length, 2);
  assert.equal(d.payments[0].attempts[0].outcome, "image_rejected");
  assert.equal((await h.review(id, pid)).status, 200);
  assert.equal((await h.confirm(id)).status, 200);
});
for (const amount of ["400", "600"])
  test(`verified ${amount} under/excess cannot confirm before documented external settlement`, async () => {
    const id = await ready("transfer"),
      pid = await h.receipt(id, amount);
    assert.equal(
      (await h.review(id, pid, "transfer_verified", amount)).status,
      200,
    );
    assert.equal((await h.confirm(id)).status, 409);
    let d = await h.get(id);
    assert.equal(d.openExceptions, 1);
    const e = d.exceptions[0];
    assert.equal(
      (
        await settle(
          id,
          e.id,
          amount === "400" ? "received_from_customer" : "refund_to_customer",
          "100",
        )
      ).status,
      200,
    );
    d = await h.get(id);
    assert.equal(
      (
        await h.post(
          `/admin/orders/${id}/resolve`,
          {
            expectedVersion: d.order.version,
            exceptionId: e.id,
            reason: "مطابقة الصافي",
          },
          true,
        )
      ).status,
      200,
    );
    assert.equal((await h.confirm(id)).status, 200);
  });
test("normalized duplicate transfer is rejected globally; duplicate image and foreign image are rejected", async () => {
  const id = await ready("transfer");
  await h.receipt(id, "500", "۱۲٣-ABC");
  const ins = (await h.get(id)).instructions[0].id,
    d = await h.get(id);
  assert.equal(
    (
      await h.post(`/orders/${id}/receipts`, {
        expectedVersion: d.order.version,
        instructionId: ins,
        receiptNumber: "123 abc",
        amountYer: "500",
        mediaId: await h.media(),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await h.post(`/orders/${id}/receipts`, {
        expectedVersion: d.order.version,
        instructionId: ins,
        receiptNumber: "OTHER",
        amountYer: "500",
        mediaId: await h.media(h.staff.id),
      })
    ).status,
    409,
  );
});
test("protected receipt prevents quote replacement even after image rejection until explicit release action", async () => {
  const id = await ready("transfer"),
    pid = await h.receipt(id);
  await h.review(id, pid, "image_rejected", "0", "keep_for_correction");
  const d = await h.get(id);
  assert.equal(
    (
      await h.post(
        `/admin/orders/${id}/quotes`,
        {
          expectedVersion: d.order.version,
          branchId: h.b2,
          reason: "تغيير الفرع",
        },
        true,
      )
    ).status,
    409,
  );
});
test("last stock concurrent quotes never over-reserve and losing transaction leaves no partial quote", async () => {
  await f.owner.query("UPDATE stock_levels SET on_hand=1");
  await f.owner.query(
    "INSERT INTO stock_movements(branch_id,product_id,delta_pieces,reason,actor_id,note) VALUES($1,$2,-99,'adjustment',$3,'اختبار آخر حبة')",
    [h.b, h.product, h.staff.id],
  );
  await f.owner.query(
    "INSERT INTO stock_movements(branch_id,product_id,delta_pieces,reason,actor_id,note) VALUES($1,$2,-99,'adjustment',$3,'اختبار آخر حبة')",
    [h.b2, h.product, h.staff.id],
  );
  const ids = await Promise.all([h.submit(), h.submit()]);
  const ds = await Promise.all(ids.map((id) => h.get(id)));
  const rs = await Promise.all(
    ids.map((id, n) =>
      h.post(
        `/admin/orders/${id}/quotes`,
        {
          expectedVersion: ds[n].order.version,
          branchId: h.b,
          reason: "آخر حبة",
        },
        true,
      ),
    ),
  );
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (await f.owner.query("SELECT count(*)::int n FROM order_quotes")).rows[0].n,
    1,
  );
  assert.equal(
    (
      await f.pool.query(
        "SELECT reserved::text FROM stock_levels WHERE branch_id=$1",
        [h.b],
      )
    ).rows[0].reserved,
    "1",
  );
});
test("expired COD with unchanged facts revalidates and reserves atomically before confirmation", async () => {
  const id = await ready();
  await ageQuote(id);
  const r = await h.confirm(id);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(
    (await f.pool.query("SELECT count(*)::int n FROM quote_revalidations"))
      .rows[0].n,
    1,
  );
});
test("expired quote with changed price cannot silently revalidate; requires new acceptance", async () => {
  const id = await ready();
  await ageQuote(id);
  await f.owner.query("UPDATE product_units SET price_yer=101 WHERE id=$1", [
    h.piece,
  ]);
  const r = await h.confirm(id);
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, "NEW_QUOTE_REQUIRED");
  assert.equal(
    (await f.pool.query("SELECT count(*)::int n FROM quote_revalidations"))
      .rows[0].n,
    0,
  );
});
async function ageQuote(id: string) {
  await f.owner.query("ALTER TABLE order_quotes DISABLE TRIGGER quote_history");
  try {
    await f.owner.query(
      "UPDATE order_quotes SET expires_at=now()-interval '1 second' WHERE order_id=$1",
      [id],
    );
  } finally {
    await f.owner.query(
      "ALTER TABLE order_quotes ENABLE TRIGGER quote_history",
    );
  }
  await f.owner.query(
    "UPDATE stock_reservations SET expires_at=now()-interval '1 second' WHERE order_id=$1 AND hold_kind='timed'",
    [id],
  );
  await expireTimed(f.pool);
}
test("late receipt records liability without recreating an expired hold", async () => {
  const id = await ready("transfer"),
    ins = await h.instructions(id);
  await ageQuote(id);
  const d = await h.get(id);
  const r = await h.post(`/orders/${id}/receipts`, {
    expectedVersion: d.order.version,
    instructionId: ins,
    receiptNumber: "LATE-08",
    amountYer: "500",
    mediaId: await h.media(),
  });
  assert.equal(r.status, 200);
  const after = await h.get(id);
  assert.equal(after.openExceptions, 1);
  assert.equal(after.holds.filter((x: any) => x.state === "active").length, 0);
  assert.equal((await h.confirm(id)).status, 409);
});
test("client cancels before receipt; after receipt only an admin request; after confirmation cannot cancel", async () => {
  let id = await h.submit();
  let d = await h.get(id);
  assert.equal(
    (
      await h.post(`/orders/${id}/cancel`, {
        expectedVersion: d.order.version,
        reason: "إلغاء قبل التحويل",
      })
    ).status,
    200,
  );
  id = await ready("transfer");
  await h.receipt(id);
  d = await h.get(id);
  assert.equal(
    (
      await h.post(`/orders/${id}/cancel`, {
        expectedVersion: d.order.version,
        reason: "طلب مراجعة الإلغاء",
      })
    ).status,
    200,
  );
  assert.equal((await h.get(id)).order.status, "pending_review");
  id = await ready();
  await h.confirm(id);
  d = await h.get(id);
  assert.equal(
    (
      await h.post(`/orders/${id}/cancel`, {
        expectedVersion: d.order.version,
        reason: "مرفوض",
      })
    ).status,
    409,
  );
});
test("receipt rejection with explicit release permits admin cancellation and retains history", async () => {
  const id = await ready("transfer"),
    pid = await h.receipt(id);
  let d = await h.get(id);
  const req = await h.post(`/orders/${id}/cancel`, {
    expectedVersion: d.order.version,
    reason: "طلب إلغاء",
  });
  await h.review(id, pid, "transfer_rejected", "0", "release_after_review");
  d = await h.get(id);
  const r = await h.post(
    `/admin/orders/${id}/cancel-review`,
    {
      expectedVersion: d.order.version,
      requestId: req.body.requestId,
      approve: true,
      reason: "مراجعة التحويل والإلغاء",
    },
    true,
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await h.get(id)).holds[0].state, "released");
});
test("maintenance blocks submission but allows ongoing tracking and cancellation", async () => {
  const id = await h.submit();
  await f.owner.query(
    "INSERT INTO customer_maintenance(enabled,message_ar) VALUES(true,'صيانة') ON CONFLICT(singleton) DO UPDATE SET enabled=true",
  );
  const r = await h.post("/orders", {
    governorateId: h.g,
    addressId: h.address,
    kind: "retail",
    paymentKind: "cash_on_delivery",
    items: [{ unitId: h.piece, quantity: 1 }],
  });
  assert.equal(r.status, 503);
  const d = await h.get(id);
  assert.equal(
    (
      await h.post(`/orders/${id}/cancel`, {
        expectedVersion: d.order.version,
        reason: "أثناء الصيانة",
      })
    ).status,
    200,
  );
  await f.owner.query("UPDATE customer_maintenance SET enabled=false");
});
test("other customer and courier cannot read or mutate order; runtime cannot mutate financial history", async () => {
  const id = await ready();
  const other = await f.user("770008003"),
    t = (await f.login(other)).accessToken;
  assert.equal(
    (await f.request("GET", "/api/v1/orders/" + id, undefined, t)).status,
    404,
  );
  assert.equal(
    (
      await h.post(
        `/admin/orders/${id}/confirm`,
        { expectedVersion: (await h.get(id)).order.version },
        false,
      )
    ).status,
    403,
  );
  for (const prefix of ["/api/v1/ADMIN", "/API/v1/AdMiN"])
    assert.equal(
      (
        await f.request(
          "POST",
          prefix + "/orders/" + id + "/confirm",
          { expectedVersion: (await h.get(id)).order.version },
          h.token,
          "customer",
          { "Idempotency-Key": randomUUID() },
        )
      ).status,
      403,
    );
  for (const t of [
    "payment_instructions",
    "payment_receipt_attempts",
    "payment_receipt_reviews",
    "financial_exception_resolutions",
    "order_events",
  ])
    await assert.rejects(f.pool.query(`DELETE FROM ${t}`));
  await assert.rejects(
    f.pool.query("INSERT INTO cash_collections DEFAULT VALUES"),
  );
});
test("staff branch scope blocks new branch issue and historical receipt disclosure after branch changes", async () => {
  const id = await ready("transfer"),
    pid = await h.receipt(id);
  await h.review(id, pid, "transfer_rejected", "0", "release_after_review");
  await h.quote(id, h.b2);
  const staff = await f.user("770008004", "staff"),
    role = (
      await f.owner.query(
        "INSERT INTO roles(code,name_ar) VALUES('scope08','مراجع فرع08') RETURNING id",
      )
    ).rows[0].id;
  for (const p of ["orders.review", "orders.reprice", "payments.verify"])
    await f.owner.query(
      "INSERT INTO role_permissions(role_id,permission_code) VALUES($1,$2)",
      [role, p],
    );
  await f.owner.query(
    "INSERT INTO staff_grants(user_id,role_id,branch_id) VALUES($1,$2,$3)",
    [staff.id, role, h.b2],
  );
  const t = (await f.login(staff, "admin")).accessToken,
    r = await f.request(
      "GET",
      "/api/v1/admin/orders/" + id,
      undefined,
      t,
      "admin",
    );
  assert.equal(r.status, 200);
  assert.equal(r.body.payments.length, 0);
  const media = (await h.get(id)).payments[0].attempts[0].media_id;
  assert.equal(
    (
      await f.request(
        "GET",
        "/api/v1/media/" + media + "/access",
        undefined,
        t,
        "admin",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await h.post(
        `/admin/orders/${id}/quotes`,
        {
          expectedVersion: r.body.order.version,
          branchId: h.b,
          reason: "خارج النطاق",
        },
        true,
        randomUUID(),
        t,
      )
    ).status,
    403,
  );
});
