import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture, type Fixture } from "./phase05/helpers.js";
import { TestRouting } from "./phase07/routing.js";
import { TestStore } from "./phase06/store.js";
import { seed } from "./phase09/seed.js";
let f: Fixture;
before(async () => {
  f = await fixture({
    routingProvider: new TestRouting(),
    objectStore: new TestStore(),
  });
});
after(async () => {
  await f?.close();
});
const ok = (r: any) => assert.equal(r.status, 200, JSON.stringify(r.body));
test("multiple assignments freeze pre-discount commission; delivery repeated and concurrent earns once", async () => {
  const h = await seed(f);
  await f.owner.query("UPDATE delivery_rules SET base_yer=400");
  await f.owner.query(
    "INSERT INTO promotions(name_ar,target,discount_kind,value,starts_at,ends_at) VALUES('خصم اختبار09','delivery','fixed',100,now()-interval '1 hour',now()+interval '1 hour')",
  );
  const a = await h.confirmed(),
    b = await h.confirmed();
  await h.assign(a);
  await h.assign(b);
  let d = await h.task(a);
  assert.equal(d.assignment.delivery_fee_before_discount_yer, "500");
  assert.equal(d.assignment.customer_delivery_yer, "400");
  assert.equal(d.assignment.commission_yer, "100");
  await f.owner.query(
    "UPDATE courier_profiles SET commission_bps=1000 WHERE user_id=$1",
    [h.courier.id],
  );
  ok(await h.cmd(a, "start"));
  ok(
    await h.cmd(a, "cash-collections", {
      amountYer: "500",
      reference: "ACTUAL09",
      collectedAt: new Date().toISOString(),
    }),
  );
  const v = { expectedVersion: (await h.task(a)).order.version },
    key = randomUUID();
  const rs = await Promise.all([
    h.req("/courier/orders/" + a + "/deliver", v, false, key),
    h.req("/courier/orders/" + a + "/deliver", v, false, key),
  ]);
  rs.forEach(ok);
  assert.deepEqual(rs[0].body, rs[1].body);
  const l = await h.req("/courier/earnings");
  ok(l);
  assert.equal(l.body.balanceYer, "100");
  assert.equal(l.body.sources.length, 1);
  assert.equal((await h.req("/courier/orders")).body.items.length, 2);
  assert.equal((await h.req("/courier/cash-balance")).body.balanceYer, "500");
  assert.equal((await h.cmd(a, "deliver")).status, 409);
});
test("delivery never manufactures cash; shortfall exception is explicit and matching current difference", async () => {
  const h = await seed(f),
    id = await h.confirmed();
  await h.assign(id);
  ok(await h.cmd(id, "start"));
  assert.equal((await h.cmd(id, "deliver")).status, 409);
  assert.equal(
    (await f.owner.query("SELECT count(*) FROM cash_collections")).rows[0]
      .count,
    "0",
  );
  ok(
    await h.cmd(id, "cash-collections", {
      amountYer: "400",
      reference: "SHORT09",
      collectedAt: new Date().toISOString(),
    }),
  );
  const e = await h.cmd(id, "cash-exceptions", {
    reason: "تعذر تحصيل مئة ريال؛ مراجعة الإدارة",
  });
  ok(e);
  ok(await h.cmd(id, "deliver", { cashExceptionId: e.body.exceptionId }));
  const d = await h.get(id);
  assert.equal(d.paymentStatus, "cash_exception");
  assert.equal(d.cashCollectedYer, "400");
});
test("commission concurrent payouts and reversal credits preserve allocations and can be spent once", async () => {
  const h = await seed(f);
  await h.delivered();
  const l = (await h.req("/courier/earnings")).body;
  const body = {
    courierId: h.courier.id,
    sourceIds: [l.sources[0].id],
    totalYer: "80",
    reference: "PAY09",
  };
  const rs = await Promise.all([
    h.req("/admin/settlements", body, true),
    h.req("/admin/settlements", { ...body, reference: "PAY09B" }, true),
  ]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  const payout = rs.find((r) => r.status === 200)!.body.id,
    proof = await h.media(h.staff.id, "financial_proof");
  const rev = await h.req(
    "/admin/settlements/" + payout + "/reversals",
    { reason: "عكس دفع خاطئ مثبت", reference: "REV09", proofMediaId: proof },
    true,
  );
  ok(rev);
  const again = await h.req(
    "/admin/settlements",
    {
      courierId: h.courier.id,
      reversalCreditIds: [rev.body.id],
      totalYer: "80",
      reference: "REPAY09",
    },
    true,
  );
  ok(again);
  assert.equal(
    (
      await h.req(
        "/admin/settlements",
        {
          courierId: h.courier.id,
          reversalCreditIds: [rev.body.id],
          totalYer: "80",
          reference: "REPAY09B",
        },
        true,
      )
    ).status,
    409,
  );
  const after = (await h.req("/courier/earnings")).body;
  assert.equal(after.totalYer, "80");
  assert.equal(after.paidYer, "160");
  assert.equal(after.reversedYer, "80");
  assert.equal(after.balanceYer, "0");
  assert.equal(after.payouts.length, 2);
  assert.equal(after.payouts[0].allocations.length, 1);
});
test("cash remittance is full store money without commission offset, concurrent allocations and reversal credit once", async () => {
  const h = await seed(f);
  await h.delivered();
  const l = (await h.req("/courier/cash-balance")).body;
  const body = {
    courierId: h.courier.id,
    sourceIds: [l.sources[0].id],
    totalYer: "420",
    reference: "REMIT09",
  };
  assert.equal(
    (await h.req("/admin/cash-remittances", body, true)).status,
    409,
  );
  const rs = await Promise.all([
    h.req("/admin/cash-remittances", { ...body, totalYer: "500" }, true),
    h.req(
      "/admin/cash-remittances",
      { ...body, totalYer: "500", reference: "REMIT09B" },
      true,
    ),
  ]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  const payout = rs.find((r) => r.status === 200)!.body.id;
  const rev = await h.req(
    "/admin/cash-remittances/" + payout + "/reversals",
    {
      reason: "تصحيح توريد موثق",
      reference: "REMITREV09",
      proofMediaId: await h.media(h.staff.id, "financial_proof"),
    },
    true,
  );
  ok(rev);
  const repay = {
    courierId: h.courier.id,
    reversalCreditIds: [rev.body.id],
    totalYer: "500",
    reference: "REREMIT09",
  };
  ok(await h.req("/admin/cash-remittances", repay, true));
  assert.equal(
    (
      await h.req(
        "/admin/cash-remittances",
        { ...repay, reference: "TWICE09" },
        true,
      )
    ).status,
    409,
  );
  assert.equal((await h.req("/courier/cash-balance")).body.balanceYer, "0");
  assert.equal((await h.req("/courier/earnings")).body.balanceYer, "80");
});
test("courier can only access current assignment and no transfer receipts, flags archive, or administrative paths", async () => {
  const h = await seed(f),
    id = await h.confirmed();
  await h.assign(id);
  for (const p of [
    "/courier/orders/" + id,
    "/admin/orders/" + id,
    "/AdMiN/OrDeRs/" + id,
  ]) {
    const r = await f.request(
      "GET",
      "/api/v1" + p,
      undefined,
      h.otherToken,
      "courier",
    );
    assert([403, 404].includes(r.status), JSON.stringify(r));
  }
  const d = await h.task(id);
  assert(!("payments" in d));
  assert(!("flags" in d));
  assert(!("instructions" in d));
  assert(!("customer_id" in d.order));
  await h.assign(id, h.other.id);
  assert.equal((await h.req("/courier/orders/" + id)).status, 404);
});
test("reassignment prohibited after start, inactive or unconfigured courier cannot be assigned", async () => {
  const h = await seed(f),
    id = await h.confirmed();
  await f.owner.query(
    "UPDATE courier_profiles SET commission_bps=NULL WHERE user_id=$1",
    [h.courier.id],
  );
  const body = {
    expectedVersion: (await h.get(id)).order.version,
    courierId: h.courier.id,
    reason: "اختبار إعداد ناقص",
  };
  assert.equal(
    (await h.req("/admin/orders/" + id + "/assign", body, true)).status,
    409,
  );
  await h.assign(id, h.other.id);
  const r = await f.request(
    "POST",
    "/api/v1/courier/orders/" + id + "/start",
    { expectedVersion: (await h.get(id)).order.version },
    h.otherToken,
    "courier",
    { "Idempotency-Key": randomUUID() },
  );
  ok(r);
  assert.equal(
    (
      await h.req(
        "/admin/orders/" + id + "/assign",
        { ...body, expectedVersion: (await h.get(id)).order.version },
        true,
      )
    ).status,
    409,
  );
});
test("delivered customer reviews once; complaint response is versioned; previous flag warns on next order without automatic block", async () => {
  const h = await seed(f),
    id = await h.delivered();
  let r = await h.cmd(id, "customer-flags", {
    details: "بلاغ اختبار يظهر عند الطلب التالي",
    kind: "delivery_problem",
  });
  ok(r);
  const next = await h.submit(),
    ad = await h.get(next, true);
  assert.equal(ad.hasCustomerFlag, true);
  assert.equal(ad.flags.length, 1);
  assert.equal(ad.order.status, "pending_review");
  assert.equal((await h.get(next)).flags.length, 0);
  ok(
    await h.post("/orders/" + id + "/review", {
      expectedVersion: (await h.get(id)).order.version,
      rating: 5,
      comment: "تقييم اختبار09",
    }),
  );
  assert.equal(
    (
      await h.post("/orders/" + id + "/review", {
        expectedVersion: (await h.get(id)).order.version,
        rating: 1,
      })
    ).status,
    409,
  );
  r = await h.post("/orders/" + id + "/complaints", {
    expectedVersion: (await h.get(id)).order.version,
    details: "شكوى اختبار مفصلة",
  });
  ok(r);
  ok(
    await h.req(
      "/admin/complaints/" + r.body.complaintId + "/review",
      {
        expectedVersion: 1,
        status: "resolved",
        response: "رد إداري موثق للعميل",
      },
      true,
    ),
  );
  assert.equal(
    (await h.get(id)).complaints[0].admin_response,
    "رد إداري موثق للعميل",
  );
  assert.equal(
    (
      await h.post("/orders/" + next + "/review", {
        expectedVersion: 1,
        rating: 4,
      })
    ).status,
    409,
  );
});
test("COD external receipt resolves shortage without increasing courier cash or commission", async () => {
  const h = await seed(f),
    id = await h.confirmed();
  await h.assign(id);
  ok(await h.cmd(id, "start"));
  ok(
    await h.cmd(id, "cash-collections", {
      amountYer: "400",
      reference: "GAPCOL09",
      collectedAt: new Date().toISOString(),
    }),
  );
  const e = await h.cmd(id, "cash-exceptions", {
    reason: "باقي مئة لدى العميل",
  });
  ok(e);
  ok(await h.cmd(id, "deliver", { cashExceptionId: e.body.exceptionId }));
  let v = (await h.get(id)).order.version;
  const proof = await h.media(h.staff.id, "financial_proof");
  ok(
    await h.post(
      "/admin/orders/" + id + "/settlements",
      {
        expectedVersion: v,
        exceptionId: e.body.exceptionId,
        direction: "received_from_customer",
        amountYer: "100",
        reason: "تحقق استلام خارجي للإدارة",
        reference: "EXTERNALCOD09",
        proofMediaId: proof,
        occurredAt: new Date().toISOString(),
      },
      true,
    ),
  );
  ok(
    await h.post(
      "/admin/orders/" + id + "/resolve",
      {
        expectedVersion: (await h.get(id)).order.version,
        exceptionId: e.body.exceptionId,
        reason: "طابق المال مع الفاتورة",
      },
      true,
    ),
  );
  const d = await h.get(id);
  assert.equal(d.paymentStatus, "cash_resolved");
  assert.equal(d.cashExternalReceivedYer, "100");
  assert.equal((await h.req("/courier/cash-balance")).body.totalYer, "400");
  assert.equal((await h.req("/courier/earnings")).body.totalYer, "80");
});
test("cash adjustment is compensating with proof, cannot be negative net, and original allocation stays", async () => {
  const h = await seed(f),
    id = await h.delivered(),
    l = (await h.req("/courier/cash-balance")).body,
    source = l.sources[0];
  ok(
    await h.req(
      "/admin/cash-remittances",
      {
        courierId: h.courier.id,
        sourceIds: [source.id],
        totalYer: "500",
        reference: "ADJPAID09",
      },
      true,
    ),
  );
  const proof = await h.media(h.staff.id, "financial_proof"),
    body = {
      amountYer: "-20",
      reason: "تصحيح مبلغ محصل من الأصل",
      reference: "ADJUST09",
      proofMediaId: proof,
      collectedAt: new Date().toISOString(),
    };
  ok(
    await h.req(
      "/admin/cash-collections/" + source.id + "/adjustments",
      body,
      true,
    ),
  );
  assert.equal(
    (
      await h.req(
        "/admin/cash-collections/" + source.id + "/adjustments",
        { ...body, amountYer: "-501", reference: "BADNEG09" },
        true,
      )
    ).status,
    409,
  );
  const after = (await h.req("/courier/cash-balance")).body;
  assert.equal(after.totalYer, "480");
  assert.equal(after.balanceYer, "-20");
  assert.equal(after.sources.length, 2);
  assert(after.sources.find((s: any) => s.id === source.id).allocated_to);
  assert.equal((await h.get(id)).quotes[0].total_yer, "500");
});
test("zero commission delivers without zero earning and transfer delivery does not collect cash", async () => {
  const h = await seed(f);
  await f.owner.query(
    "UPDATE courier_profiles SET commission_bps=0 WHERE user_id=$1",
    [h.courier.id],
  );
  const id = await h.submit("retail", "transfer");
  await h.quote(id);
  await h.accept(id);
  const pid = await h.receipt(id);
  ok(await h.review(id, pid));
  ok(await h.confirm(id));
  await h.assign(id);
  ok(await h.cmd(id, "start"));
  assert.equal(
    (
      await h.cmd(id, "cash-collections", {
        amountYer: "500",
        reference: "NO-CASH09",
        collectedAt: new Date().toISOString(),
      })
    ).status,
    409,
  );
  ok(await h.cmd(id, "deliver"));
  assert.equal((await h.req("/courier/earnings")).body.totalYer, "0");
  assert.equal((await h.req("/courier/earnings")).body.sources.length, 0);
  assert.equal((await h.req("/courier/cash-balance")).body.totalYer, "0");
});
test("live permissions are checked before payout replay and historical branch scope cannot be removed to reveal a ledger", async () => {
  const h = await seed(f);
  await h.delivered();
  const earning = (await h.req("/courier/earnings")).body.sources[0];
  const staff = await f.user("770009003", "staff"),
    role = (
      await f.owner.query(
        "INSERT INTO roles(code,name_ar) VALUES('cash09scope','نطاق مالي') RETURNING id",
      )
    ).rows[0].id;
  await f.owner.query(
    "INSERT INTO role_permissions(role_id,permission_code) VALUES($1,'commissions.settle')",
    [role],
  );
  await f.owner.query(
    "INSERT INTO staff_grants(user_id,role_id,branch_id) VALUES($1,$2,$3)",
    [staff.id, role, h.b],
  );
  const token = (await f.login(staff, "admin")).accessToken;
  assert.equal(
    (
      await f.request(
        "GET",
        "/api/v1/admin/couriers/" + h.courier.id + "/earnings",
        undefined,
        token,
        "admin",
      )
    ).status,
    403,
  );
  await f.owner.query(
    "DELETE FROM courier_branches WHERE courier_id=$1 AND branch_id=$2",
    [h.courier.id, h.b2],
  );
  const key = randomUUID(),
    body = {
      courierId: h.courier.id,
      sourceIds: [earning.id],
      totalYer: "80",
      reference: "RBACPAY09",
    };
  ok(
    await f.request("POST", "/api/v1/admin/settlements", body, token, "admin", {
      "Idempotency-Key": key,
    }),
  );
  await f.owner.query("DELETE FROM staff_grants WHERE user_id=$1", [staff.id]);
  assert.equal(
    (
      await f.request(
        "POST",
        "/api/v1/admin/settlements",
        body,
        token,
        "admin",
        { "Idempotency-Key": key },
      )
    ).status,
    403,
  );
});
test("same idempotency key conflicting cash payload is rejected; cross-courier allocation rejected", async () => {
  const h = await seed(f),
    id = await h.confirmed();
  await h.assign(id);
  ok(await h.cmd(id, "start"));
  const key = randomUUID(),
    v = {
      expectedVersion: (await h.task(id)).order.version,
      amountYer: "500",
      reference: "IDEMCOL09",
      collectedAt: new Date().toISOString(),
    };
  const r = await h.req(
    "/courier/orders/" + id + "/cash-collections",
    v,
    false,
    key,
  );
  ok(r);
  assert.deepEqual(
    (await h.req("/courier/orders/" + id + "/cash-collections", v, false, key))
      .body,
    r.body,
  );
  assert.equal(
    (
      await h.req(
        "/courier/orders/" + id + "/cash-collections",
        { ...v, amountYer: "400" },
        false,
        key,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await h.req(
        "/admin/cash-remittances",
        {
          courierId: h.other.id,
          sourceIds: [r.body.collectionId],
          totalYer: "500",
          reference: "CROSS09",
        },
        true,
      )
    ).status,
    404,
  );
});
test("courier account management configures an explicit rate and branch; cannot disable courier with active task", async () => {
  const h = await seed(f);
  const create = await h.req(
    "/admin/couriers",
    {
      name: "موصل اختبار جديد09",
      phone: "770009004",
      password: "Isolated-Password-09!",
      branchIds: [h.b],
      commissionBps: null,
      active: true,
    },
    true,
  );
  ok(create);
  const cid = create.body.id;
  const configured = await h.req(
    "/admin/couriers/" + cid + "/configure",
    {
      name: "موصل اختبار جديد09",
      branchIds: [h.b],
      commissionBps: 2000,
      active: true,
    },
    true,
  );
  ok(configured);
  const history = await h.req(
    "/admin/couriers/" + cid + "/configuration-history?limit=1",
    undefined,
    true,
  );
  ok(history);
  assert.equal(history.body.items[0].commission_bps, 2000);
  assert(history.body.nextCursor);
  const older = await h.req(
    "/admin/couriers/" +
      cid +
      "/configuration-history?limit=1&cursor=" +
      history.body.nextCursor,
    undefined,
    true,
  );
  ok(older);
  assert.equal(older.body.items[0].commission_bps, null);
  assert(!JSON.stringify(history.body).includes("password"));
  assert.equal(
    (await h.req("/admin/couriers/" + cid + "/configuration-history")).status,
    403,
  );
  const id = await h.confirmed();
  await h.assign(id, cid);
  assert.equal(
    (
      await h.req(
        "/admin/couriers/" + cid + "/configure",
        {
          name: "موصل اختبار جديد09",
          branchIds: [h.b],
          commissionBps: 2000,
          active: false,
        },
        true,
      )
    ).status,
    409,
  );
});
test("quality attachment ownership and private proof access do not leak across courier or branch", async () => {
  const h = await seed(f),
    id = await h.delivered(),
    foreign = await h.media(h.other.id, "customer_flag");
  assert.equal(
    (
      await h.cmd(id, "customer-flags", {
        details: "مرفق لشخص آخر",
        attachmentId: foreign,
      })
    ).status,
    422,
  );
  const proof = await h.media(h.staff.id, "financial_proof"),
    source = (await h.req("/courier/earnings")).body.sources[0].id;
  const pay = await h.req(
    "/admin/settlements",
    {
      courierId: h.courier.id,
      sourceIds: [source],
      totalYer: "80",
      reference: "MEDIA09",
    },
    true,
  );
  ok(pay);
  ok(
    await h.req(
      "/admin/settlements/" + pay.body.id + "/reversals",
      {
        reason: "توثيق إثبات خاص",
        reference: "MEDIAREV09",
        proofMediaId: proof,
      },
      true,
    ),
  );
  assert.equal((await h.req("/media/" + proof + "/access")).status, 403);
  ok(await h.req("/media/" + proof + "/access", undefined, true));
});
test("two concurrent dispatches leave one active assignment and reject stale version", async () => {
  const h = await seed(f),
    id = await h.confirmed(),
    v = (await h.get(id)).order.version;
  const rs = await Promise.all([
    h.req(
      "/admin/orders/" + id + "/assign",
      {
        courierId: h.courier.id,
        expectedVersion: v,
        reason: "إسناد أول متزامن",
      },
      true,
    ),
    h.req(
      "/admin/orders/" + id + "/assign",
      { courierId: h.other.id, expectedVersion: v, reason: "إسناد ثان متزامن" },
      true,
    ),
  ]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (
      await f.owner.query(
        "SELECT count(*) FROM order_assignments WHERE order_id=$1 AND ended_at IS NULL",
        [id],
      )
    ).rows[0].count,
    "1",
  );
});
test("private flag warning survives restricted historical branch without revealing its text or attachment", async () => {
  const h = await seed(f),
    id = await h.confirmed();
  await h.assign(id);
  ok(await h.cmd(id, "customer-flags", { details: "بلاغ خاص في الفرع الأول" }));
  const next = await h.submit();
  await h.quote(next, h.b2);
  const u = await f.user("770009005", "staff"),
    role = (
      await f.owner.query(
        "INSERT INTO roles(code,name_ar) VALUES('flags09limited','بلاغات محدودة') RETURNING id",
      )
    ).rows[0].id;
  await f.owner.query(
    "INSERT INTO role_permissions(role_id,permission_code) VALUES($1,'orders.review'),($1,'customer-flags.read')",
    [role],
  );
  await f.owner.query(
    "INSERT INTO staff_grants(user_id,role_id,branch_id) VALUES($1,$2,$3)",
    [u.id, role, h.b2],
  );
  const t = (await f.login(u, "admin")).accessToken;
  const r = await f.request(
    "GET",
    "/api/v1/admin/orders/" + next,
    undefined,
    t,
    "admin",
  );
  ok(r);
  assert(r.body.hasCustomerFlag);
  assert.deepEqual(r.body.flags, []);
  assert(!JSON.stringify(r.body).includes("بلاغ خاص في الفرع الأول"));
});
test("cash write-off requires proof and exact remaining shortage, never marks cash collected", async () => {
  const h = await seed(f),
    id = await h.confirmed();
  await h.assign(id);
  ok(await h.cmd(id, "start"));
  const e = await h.cmd(id, "cash-exceptions", {
    reason: "تعذر التحصيل بالكامل",
  });
  ok(e);
  ok(await h.cmd(id, "deliver", { cashExceptionId: e.body.exceptionId }));
  const body = {
    expectedVersion: (await h.get(id)).order.version,
    exceptionId: e.body.exceptionId,
    direction: "write_off",
    amountYer: "501",
    reason: "شطب موثق",
    reference: "WRITEOFF09",
    proofMediaId: await h.media(h.staff.id, "financial_proof"),
    occurredAt: new Date().toISOString(),
  };
  assert.equal(
    (await h.post("/admin/orders/" + id + "/settlements", body, true)).status,
    409,
  );
  ok(
    await h.post(
      "/admin/orders/" + id + "/settlements",
      { ...body, amountYer: "500" },
      true,
    ),
  );
  ok(
    await h.post(
      "/admin/orders/" + id + "/resolve",
      {
        expectedVersion: (await h.get(id)).order.version,
        exceptionId: e.body.exceptionId,
        reason: "تسوية العجز بإثبات",
      },
      true,
    ),
  );
  const d = await h.get(id);
  assert.equal(d.cashCollected, false);
  assert.equal(d.cashWrittenOffYer, "500");
  assert.equal(d.paymentStatus, "cash_resolved");
  assert.equal((await h.req("/courier/cash-balance")).body.totalYer, "0");
});
test("runtime cannot rewrite or delete any payout or cash source, assignment facts or quality original", async () => {
  await seed(f);
  for (const sql of [
    "UPDATE cash_collections SET amount_yer=1",
    "DELETE FROM cash_collections",
    "UPDATE courier_earnings SET amount_yer=1",
    "DELETE FROM courier_settlements",
    "UPDATE settlement_items SET earning_id=NULL",
    "DELETE FROM cash_remittance_items",
    "UPDATE order_assignments SET commission_bps=1",
    "UPDATE complaints SET details_ar='بديل'",
    "UPDATE customer_flags SET details_ar='بديل'",
    "UPDATE order_reviews SET rating=1",
  ]) {
    await assert.rejects(f.pool.query(sql), (e: any) => e.code === "42501");
  }
});
test("cash and quality reject fractions, unexpected fields and future occurrence without partial commit", async () => {
  const h = await seed(f),
    id = await h.confirmed();
  await h.assign(id);
  ok(await h.cmd(id, "start"));
  for (const extra of [
    {
      amountYer: "1.5",
      reference: "FRACTION09",
      collectedAt: new Date().toISOString(),
    },
    {
      amountYer: "500",
      reference: "FUTURE09",
      collectedAt: new Date(Date.now() + 86400000).toISOString(),
    },
    {
      amountYer: "500",
      reference: "EXTRA09",
      collectedAt: new Date().toISOString(),
      courierId: h.other.id,
    },
  ])
    assert.equal((await h.cmd(id, "cash-collections", extra)).status, 422);
  assert.equal(
    (await f.owner.query("SELECT count(*) FROM cash_collections")).rows[0]
      .count,
    "0",
  );
});
test("late actual collection after an external resolution opens a new overpayment without another earning", async () => {
  const h = await seed(f),
    id = await h.confirmed();
  await h.assign(id);
  ok(await h.cmd(id, "start"));
  const e = await h.cmd(id, "cash-exceptions", { reason: "تعذر التحصيل" });
  ok(e);
  ok(await h.cmd(id, "deliver", { cashExceptionId: e.body.exceptionId }));
  ok(
    await h.post(
      "/admin/orders/" + id + "/settlements",
      {
        expectedVersion: (await h.get(id)).order.version,
        exceptionId: e.body.exceptionId,
        direction: "received_from_customer",
        amountYer: "500",
        reason: "استلام خارجي موثق",
        reference: "LATE-EXTERNAL09",
        proofMediaId: await h.media(h.staff.id, "financial_proof"),
        occurredAt: new Date().toISOString(),
      },
      true,
    ),
  );
  ok(
    await h.post(
      "/admin/orders/" + id + "/resolve",
      {
        expectedVersion: (await h.get(id)).order.version,
        exceptionId: e.body.exceptionId,
        reason: "إغلاق بعد المطابقة",
      },
      true,
    ),
  );
  assert.equal((await h.task(id)).cashDueYer, "0");
  ok(
    await h.cmd(id, "cash-collections", {
      amountYer: "500",
      reference: "LATE-ACTUAL09",
      collectedAt: new Date().toISOString(),
    }),
  );
  const d = await h.get(id);
  assert.equal(d.cashCollectedYer, "500");
  assert.equal(d.cashExternalReceivedYer, "500");
  assert.equal(d.paymentStatus, "cash_exception");
  assert.equal((await h.task(id)).cashDueYer, "-500");
  assert(
    d.exceptions.some(
      (x: any) =>
        x.kind === "overpayment" &&
        x.status === "open" &&
        x.amount_yer === "500",
    ),
  );
  assert.equal((await h.req("/courier/earnings")).body.sources.length, 1);
});
