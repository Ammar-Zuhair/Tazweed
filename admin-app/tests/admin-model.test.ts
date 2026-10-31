import assert from "node:assert/strict";
import { test } from "node:test";
import { createAdminState } from "../src/fixtures/admin-fixtures";
import {
  availableSources,
  bestPromotion,
  can,
  commission,
  currentQuote,
  netApproved,
  transition,
  visibleOrders,
  clientFlags,
} from "../src/domain/admin-model";
import { readOrders } from "../src/data/admin-repository";
import type { AdminState, Command, Product } from "../src/domain/types";
const epoch = Date.UTC(2026, 9, 29, 12);
const go = (s: AdminState, c: Command) => transition(s, c, s.now).state;
function login(phone = "770000001") {
  let s = createAdminState(epoch);
  s = go(s, { type: "login", phone, password: "Tazweed123!" });
  return go(s, { type: "otp", code: "000000" });
}
const o = (s: AdminState, id = "TZ-1001") => s.orders.find((x) => x.id === id)!;
function fail(s: AdminState, c: Command, re: RegExp) {
  const before = JSON.stringify(s);
  assert.throws(() => go(s, c), re);
  assert.equal(
    JSON.stringify(s),
    before,
    "failed command must preserve all state",
  );
}
function issued(s = login(), id = "TZ-1001", branchId = "aden") {
  return go(s, {
    type: "quote",
    orderId: id,
    expectedVersion: o(s, id).version,
    branchId,
    prices: o(s, id).items.map((i) => i.price),
    deliveryMode: "road",
    manualDelivery: 0,
    reason: "تسعيرة اختبار",
    confirmed: true,
  });
}
function cashAccepted() {
  let s = issued();
  return go(s, {
    type: "preview-accept",
    orderId: "TZ-1001",
    paymentKind: "cash",
  });
}
const meta = {
  reference: "DEMO-REF",
  reason: "سبب موثق",
  proof: "LOCAL-PROOF",
  confirmed: true,
};
test("staff login has password then purpose-bound one-use OTP; no command without a session", () => {
  const s = createAdminState(epoch);
  fail(s, { type: "scope", branchId: "aden" }, /سجل الدخول/);
  fail(
    s,
    { type: "login", phone: "770000001", password: "wrong" },
    /تعذر الدخول/,
  );
  let next = go(s, {
    type: "login",
    phone: "770000001",
    password: "Tazweed123!",
  });
  assert.equal(next.session, null);
  fail(
    next,
    {
      type: "stock",
      branchId: "aden",
      productId: "oil-1",
      mode: "receive",
      pieces: 1,
      reason: "x",
      confirmed: true,
    },
    /لا تملك/,
  );
  next = go(next, { type: "otp", code: "000000" });
  assert.equal(next.session, "staff-owner");
  fail(next, { type: "otp", code: "000000" }, /رمز الاختبار/);
  assert(!JSON.stringify(next.audit).includes("Tazweed123!"));
  assert(!JSON.stringify(next.audit).includes("000000"));
});
test("OTP attempts/expiry/resend enforce limits while wrong attempts remain in state", () => {
  let s = go(createAdminState(epoch), {
    type: "login",
    phone: "770000001",
    password: "Tazweed123!",
  });
  for (let i = 0; i < 5; i++) s = go(s, { type: "otp", code: "111111" });
  assert.equal(s.challenge!.attempts, 5);
  fail(s, { type: "otp", code: "000000" }, /نفدت/);
  fail(s, { type: "resend" }, /انتظر/);
  s = { ...s, now: s.now + 60000 };
  s = go(s, { type: "resend" });
  assert.equal(s.challenge!.attempts, 0);
  s = { ...s, now: s.now + 300001 };
  fail(s, { type: "otp", code: "000000" }, /انتهى/);
});
test("permissions pair action with its own grant branch, never union action and scope from different roles", () => {
  let s = login("770000003");
  assert(can(s, "orders.review", "aden"));
  assert(!can(s, "payments.verify", "aden"));
  assert(!can(s, "orders.review", "sanaa"));
  assert(
    visibleOrders(s).every((x) => (x.branchId ?? x.catalogBranchId) === "aden"),
  );
  s.staff
    .find((x) => x.id === s.session)!
    .grants.push({ roleId: "warehouse", branchId: "sanaa" });
  assert(!can(s, "inventory.adjust", "aden"));
  assert(!can(s, "orders.confirm", "sanaa"));
  fail(s, { type: "scope", branchId: "all" }, /خارج/);
  fail(
    s,
    { type: "maintenance", enabled: true, message: "x", confirmed: true },
    /لا تملك/,
  );
});
test("new attributes enforce unique keys and value lists; historical keys/values are preserved", () => {
  const s = login();
  const a = structuredClone(s.attributes[0]!);
  fail(s, { type: "attribute", value: { ...a, code: "new_key" } }, /ثابت/);
  fail(
    s,
    {
      type: "attribute",
      value: {
        ...a,
        values: [...a.values, { ...a.values[0]!, id: "duplicate" }],
      },
    },
    /فريدة/,
  );
  fail(s, { type: "attribute", value: { ...a, values: [] } }, /تاريخها/);
  const next = go(s, {
    type: "attribute",
    value: {
      id: "size",
      name: "المقاس",
      code: "size",
      active: true,
      values: [{ id: "size1", name: "16", active: true, order: 1 }],
    },
  });
  assert.equal(next.attributes.length, s.attributes.length + 1);
});
test("category links own required/filterable/order; cycles and duplicate links are rejected", () => {
  let s = login();
  const c = structuredClone(s.categories[0]!);
  c.attributes[0]!.filterable = false;
  c.attributes[1]!.order = 7;
  s = go(s, { type: "category", value: c });
  assert.equal(s.categories[0]!.attributes[1]!.order, 7);
  fail(s, { type: "category", value: { ...c, parentId: c.id } }, /دورة/);
  fail(
    s,
    {
      type: "category",
      value: { ...c, attributes: [...c.attributes, c.attributes[0]!] },
    },
    /مرة واحدة/,
  );
});
test("product requires category values from the right active lists, not free text or inherited fields", () => {
  const s = login();
  const p = structuredClone(s.products[0]!);
  delete p.values.brand;
  fail(s, { type: "product", value: p }, /المطلوبة/);
  p.values.brand = "unregistered";
  fail(s, { type: "product", value: p }, /مسجلة/);
  p.values.brand = "brand-1";
  p.values.capacity = "cap70";
  fail(s, { type: "product", value: p }, /ليست مرتبطة/);
});
test("used conversion and SKU cannot change, future prices and archived units can", () => {
  const s = login();
  const p = structuredClone(s.products[0]!);
  p.units[1]!.pieces = 24;
  fail(s, { type: "product", value: p }, /معاملها ثابت/);
  p.units[1]!.pieces = 12;
  p.sku = "NEW";
  fail(s, { type: "product", value: p }, /SKU ثابت/);
  p.sku = s.products[0]!.sku;
  p.units[1]!.active = false;
  p.units[1]!.price = 20000;
  p.units.push({
    id: "replacement",
    kind: "carton",
    pieces: 24,
    price: 36000,
    active: true,
    used: false,
  });
  const next = go(s, { type: "product", value: p });
  assert.equal(next.products[0]!.units[1]!.pieces, 12);
  assert.equal(next.products[0]!.units.at(-1)!.pieces, 24);
});
test("stock receipt 2 cartons x12 +3 pieces is27 and every balance change has movement evidence", () => {
  const s = login();
  const next = go(s, {
    type: "stock",
    branchId: "aden",
    productId: "oil-1",
    mode: "receive",
    pieces: 2 * 12 + 3,
    ...meta,
  });
  assert.equal(
    next.stock.find((x) => x.branchId === "aden" && x.productId === "oil-1")!
      .onHand,
    267,
  );
  assert.equal(next.movements.at(-1)!.delta, 27);
  for (const x of next.stock)
    assert.equal(
      x.onHand,
      next.movements
        .filter((m) => m.branchId === x.branchId && m.productId === x.productId)
        .reduce((n, m) => n + m.delta, 0),
    );
});
test("count writes a delta and transfer preserves totals; reserved pieces and two-branch permission enforced", () => {
  let s = login();
  const initial = s.stock
    .filter((x) => x.productId === "oil-1")
    .reduce((n, x) => n + x.onHand, 0);
  s = go(s, {
    type: "stock",
    branchId: "aden",
    productId: "oil-1",
    mode: "transfer",
    pieces: 27,
    toBranchId: "sanaa",
    ...meta,
  });
  assert.equal(
    s.stock
      .filter((x) => x.productId === "oil-1")
      .reduce((n, x) => n + x.onHand, 0),
    initial,
  );
  const group = s.movements.slice(-2);
  assert.equal(group[0]!.transferId, group[1]!.transferId);
  assert.equal(group[0]!.delta + group[1]!.delta, 0);
  s = go(s, {
    type: "stock",
    branchId: "aden",
    productId: "oil-1",
    mode: "count",
    pieces: 210,
    ...meta,
  });
  assert.equal(s.movements.at(-1)!.delta, -3);
  fail(
    login(),
    {
      type: "stock",
      branchId: "aden",
      productId: "battery-1",
      mode: "count",
      pieces: 0,
      ...meta,
    },
    /المحجوز/,
  );
  fail(
    login("770000004"),
    {
      type: "stock",
      branchId: "aden",
      productId: "oil-1",
      mode: "transfer",
      pieces: 1,
      toBranchId: "sanaa",
      ...meta,
    },
    /لا تملك/,
  );
});
test("critical operations require extra confirmation and a reason", () => {
  const s = login();
  fail(
    s,
    {
      type: "stock",
      branchId: "aden",
      productId: "oil-1",
      mode: "receive",
      pieces: 1,
      ...meta,
      confirmed: false,
    },
    /التأكيد الإضافي/,
  );
  fail(
    s,
    {
      type: "stock",
      branchId: "aden",
      productId: "oil-1",
      mode: "receive",
      pieces: 1,
      ...meta,
      reason: "",
    },
    /سبب/,
  );
});
test("quote issuance reserves whole-order pieces and custom wholesale prices never change catalog", () => {
  const s = login();
  const next = issued(s);
  assert.equal(
    next.reservations
      .filter((r) => r.orderId === "TZ-1001" && r.state === "active")
      .reduce((n, r) => n + r.pieces, 0),
    27,
  );
  assert.deepEqual(s.products, next.products);
  assert.equal(currentQuote(o(next))!.productDiscount, 0);
  assert.equal(currentQuote(o(next))!.deliveryDiscount, 0);
  assert.equal(s.orders[0]!.quotes.length, 0);
});
test("branch change at the same total still creates revision and requires new acceptance with old acceptance retained", () => {
  let s = cashAccepted();
  const old = structuredClone(currentQuote(o(s))!);
  s = issued(s, "TZ-1001", "sanaa");
  const order = o(s);
  assert.equal(order.quotes.length, 2);
  assert.equal(order.quotes[0]!.acceptedAt, old.acceptedAt);
  assert.equal(order.quotes[0]!.status, "superseded");
  assert.equal(currentQuote(order)!.total, old.total);
  assert.equal(currentQuote(order)!.status, "sent");
  assert(
    s.reservations
      .filter((r) => r.orderId === order.id && r.branchId === "aden")
      .every((r) => r.state === "released"),
  );
  fail(
    s,
    {
      type: "confirm",
      orderId: order.id,
      expectedVersion: order.version,
      flagAcknowledged: true,
      confirmed: true,
    },
    /قبول آخر/,
  );
});
test("stale expectedVersion rejects revisions atomically", () => {
  const s = issued();
  fail(
    s,
    {
      type: "quote",
      orderId: "TZ-1001",
      expectedVersion: 1,
      branchId: "aden",
      prices: [19000, 1800],
      deliveryMode: "manual",
      manualDelivery: 500,
      ...meta,
    },
    /تغير الطلب/,
  );
});
test("floor_km stores original road meters and manual fallback needs reason and acceptance", () => {
  let s = login();
  s.branches.find((b) => b.id === "aden")!.perKm = 50;
  s = issued(s);
  assert.equal(currentQuote(o(s))!.distance, 2800);
  assert.equal(currentQuote(o(s))!.delivery, 400);
  const next = go(login(), {
    type: "quote",
    orderId: "TZ-1001",
    expectedVersion: 1,
    branchId: "aden",
    prices: [19000, 1700],
    deliveryMode: "manual",
    manualDelivery: 600,
    ...meta,
  });
  assert.equal(currentQuote(o(next))!.distance, null);
  assert.equal(currentQuote(o(next))!.delivery, 600);
  assert.equal(currentQuote(o(next))!.status, "sent");
});
test("one eligible promotion chooses greatest saving with stable id tie and no wholesale auto-discount", () => {
  const s = login();
  const base = s.promotions[0]!;
  s.promotions.push(
    {
      ...base,
      id: "a-product",
      target: "products",
      discountKind: "fixed",
      value: 100,
    },
    {
      ...base,
      id: "b-product",
      target: "products",
      discountKind: "fixed",
      value: 100,
    },
  );
  const pick = bestPromotion(s, "aden", o(s, "TZ-1002").items, 500, "retail");
  assert.equal(pick.id, "a-product");
  assert.equal(pick.productDiscount, 100);
  assert.equal(pick.deliveryDiscount, 0);
  assert.equal(bestPromotion(s, "aden", o(s).items, 500, "wholesale").id, null);
});
test("receipt-protected holds cannot expire or be superseded after clock advance", () => {
  let s = login();
  const before = s.reservations.filter((r) => r.orderId === "TZ-1003");
  s = go(s, { type: "preview-time", minutes: 31 });
  assert.deepEqual(
    s.reservations.filter((r) => r.orderId === "TZ-1003"),
    before,
  );
  assert(before.every((r) => r.expiresAt === null));
  fail(
    s,
    {
      type: "quote",
      orderId: "TZ-1003",
      expectedVersion: o(s, "TZ-1003").version,
      branchId: "aden",
      prices: [24000],
      deliveryMode: "road",
      manualDelivery: 0,
      ...meta,
    },
    /يحمي العرض/,
  );
});
test("image rejection keeps the same payment, instructions and reservation across a corrected photo", () => {
  let s = login();
  const orderId = "TZ-1003";
  const before = structuredClone(o(s, orderId).payments[0]!);
  const holds = structuredClone(
    s.reservations.filter((r) => r.orderId === orderId),
  );
  s = go(s, {
    type: "receipt-review",
    orderId,
    outcome: "image_rejected",
    amount: 0,
    externalChecked: false,
    holdAction: "keep",
    ...meta,
  });
  s = go(s, {
    type: "preview-receipt",
    orderId,
    number: before.number,
    amount: before.reported,
    methodId: before.methodId,
  });
  const p = o(s, orderId).payments[0]!;
  assert.equal(o(s, orderId).payments.length, 1);
  assert.equal(p.attempts.length, 3);
  assert.deepEqual(p.instructions, before.instructions);
  assert.deepEqual(
    s.reservations.filter((r) => r.orderId === orderId),
    holds,
  );
});
test("editing future method never changes previously issued beneficiary instructions", () => {
  let s = login();
  const snapshot = structuredClone(o(s, "TZ-1003").payments[0]!.instructions);
  s = go(s, {
    type: "method",
    value: { ...s.methods[0]!, beneficiary: "مستفيد جديد" },
  });
  assert.deepEqual(o(s, "TZ-1003").payments[0]!.instructions, snapshot);
});
test("duplicate transfer number from another order and changed amount on re-upload are blocked", () => {
  let s = issued(login(), "TZ-1002");
  s = go(s, {
    type: "preview-accept",
    orderId: "TZ-1002",
    paymentKind: "transfer",
  });
  s = go(s, {
    type: "preview-instructions",
    orderId: "TZ-1002",
    methodId: "wallet-demo",
  });
  fail(
    s,
    {
      type: "preview-receipt",
      orderId: "TZ-1002",
      number: " demo-1003 ",
      amount: 24400,
      methodId: "wallet-demo",
    },
    /تكرار/,
  );
  s = go(s, {
    type: "receipt-review",
    orderId: "TZ-1003",
    outcome: "image_rejected",
    amount: 0,
    externalChecked: false,
    holdAction: "keep",
    ...meta,
  });
  fail(
    s,
    {
      type: "preview-receipt",
      orderId: "TZ-1003",
      number: "DEMO-1003",
      amount: 1,
      methodId: "wallet-demo",
    },
    /بياناتها ثابتة/,
  );
});
test("transfer confirmation needs externally verified exact net amount and acknowledged flag", () => {
  let s = login();
  const id = "TZ-1003";
  fail(
    s,
    {
      type: "confirm",
      orderId: id,
      expectedVersion: o(s, id).version,
      flagAcknowledged: true,
      confirmed: true,
    },
    /المال المعتمد/,
  );
  fail(
    s,
    {
      type: "receipt-review",
      orderId: id,
      outcome: "transfer_verified",
      amount: 24400,
      externalChecked: false,
      holdAction: "keep",
      ...meta,
    },
    /خارجي/,
  );
  s = go(s, {
    type: "receipt-review",
    orderId: id,
    outcome: "transfer_verified",
    amount: 24400,
    externalChecked: true,
    holdAction: "keep",
    ...meta,
  });
  fail(
    s,
    {
      type: "confirm",
      orderId: id,
      expectedVersion: o(s, id).version,
      flagAcknowledged: false,
      confirmed: true,
    },
    /بلاغ/,
  );
  s = go(s, {
    type: "confirm",
    orderId: id,
    expectedVersion: o(s, id).version,
    flagAcknowledged: true,
    confirmed: true,
  });
  assert.equal(o(s, id).status, "confirmed");
  assert.equal(netApproved(s, o(s, id)), 24400);
  assert.equal(o(s, id).payments.length, 1);
  assert.equal(s.cash.filter((c) => c.orderId === id).length, 0);
  fail(
    s,
    {
      type: "receipt-review",
      orderId: id,
      outcome: "transfer_verified",
      amount: 24400,
      externalChecked: true,
      holdAction: "keep",
      ...meta,
    },
    /ثابت/,
  );
});
test("overpayment creates exception; only documented external adjustment permits exact-net confirmation", () => {
  let s = go(login(), {
    type: "receipt-review",
    orderId: "TZ-1003",
    outcome: "transfer_verified",
    amount: 24500,
    externalChecked: true,
    holdAction: "keep",
    ...meta,
  });
  const e = s.exceptions.at(-1)!;
  assert.equal(e.kind, "overpayment");
  assert.equal(e.amount, 100);
  fail(
    s,
    {
      type: "confirm",
      orderId: "TZ-1003",
      expectedVersion: o(s, "TZ-1003").version,
      flagAcknowledged: true,
      confirmed: true,
    },
    /استثناء/,
  );
  fail(
    s,
    {
      type: "resolve-exception",
      id: e.id,
      direction: "refund",
      amount: 100,
      ...meta,
      proof: "",
    },
    /الإثبات/,
  );
  s = go(s, {
    type: "resolve-exception",
    id: e.id,
    direction: "refund",
    amount: 100,
    ...meta,
  });
  assert.equal(netApproved(s, o(s, "TZ-1003")), 24400);
  s = go(s, {
    type: "confirm",
    orderId: "TZ-1003",
    expectedVersion: o(s, "TZ-1003").version,
    flagAcknowledged: true,
    confirmed: true,
  });
  assert.equal(o(s, "TZ-1003").status, "confirmed");
});
test("cash confirms without any receipt and consumes reservation exactly once without collecting money", () => {
  let s = cashAccepted();
  const id = "TZ-1001";
  const cashBefore = s.cash.length;
  s = go(s, {
    type: "confirm",
    orderId: id,
    expectedVersion: o(s, id).version,
    flagAcknowledged: false,
    confirmed: true,
  });
  assert.equal(o(s).status, "confirmed");
  assert.equal(o(s).payments.length, 0);
  assert.equal(s.cash.length, cashBefore);
  assert.equal(
    s.movements
      .filter((m) => m.orderId === id)
      .reduce((n, m) => n - m.delta, 0),
    27,
  );
  fail(
    s,
    {
      type: "confirm",
      orderId: id,
      expectedVersion: o(s, id).version,
      flagAcknowledged: true,
      confirmed: true,
    },
    /ثابت/,
  );
  fail(
    s,
    { type: "close-order", orderId: id, status: "cancelled", ...meta },
    /ثابت/,
  );
});
test("expired cash needs revalidation; snapshot is immutable and live rate/price changes need revision", () => {
  let s = login();
  const id = "TZ-1004",
    q = structuredClone(currentQuote(o(s, id))!);
  fail(
    s,
    {
      type: "confirm",
      orderId: id,
      expectedVersion: o(s, id).version,
      flagAcknowledged: true,
      confirmed: true,
    },
    /منته/,
  );
  s = go(s, { type: "revalidate", orderId: id, ...meta });
  assert.deepEqual(currentQuote(o(s, id)), q);
  assert.equal(o(s, id).revalidations.length, 1);
  const changed = structuredClone(s);
  changed.products[1]!.units[0]!.price++;
  fail(changed, { type: "revalidate", orderId: id, ...meta }, /تغير السعر/);
  const changedRate = structuredClone(s);
  changedRate.branches[0]!.perKm++;
  fail(changedRate, { type: "revalidate", orderId: id, ...meta }, /تعرفة/);
});
test("assignment requires active courier branch/rate; commission freezes pre-discount, no reassign on the road", () => {
  let s = cashAccepted();
  s = go(s, {
    type: "confirm",
    orderId: "TZ-1001",
    expectedVersion: o(s).version,
    flagAcknowledged: false,
    confirmed: true,
  });
  fail(
    s,
    { type: "assign", orderId: "TZ-1001", courierId: "courier-unset", ...meta },
    /نسبة/,
  );
  s = go(s, {
    type: "assign",
    orderId: "TZ-1001",
    courierId: "courier-1",
    ...meta,
  });
  const snapshot = structuredClone(o(s).assignments[0]!);
  s = go(s, {
    type: "courier",
    value: { ...s.couriers[0]!, bps: 5000 },
    reason: "تعديل مستقبلي",
    confirmed: true,
  });
  assert.deepEqual(o(s).assignments[0], snapshot);
  assert.equal(commission(500, 2000), 100);
  s = go(s, {
    type: "assign",
    orderId: "TZ-1001",
    courierId: "courier-2",
    ...meta,
  });
  assert(o(s).assignments[0]!.endedAt);
  s = go(s, {
    type: "preview-courier",
    orderId: "TZ-1001",
    stage: "on_the_way",
    collected: 0,
    reference: "",
    reason: "",
  });
  fail(
    s,
    { type: "assign", orderId: "TZ-1001", courierId: "courier-1", ...meta },
    /قبل الطريق/,
  );
});
test("delivery records explicit cash or a shortfall exception, with one commission earning only", () => {
  const s = login();
  const next = go(s, {
    type: "preview-courier",
    orderId: "TZ-1005",
    stage: "delivered",
    collected: 24000,
    reference: "CASH-DEMO",
    reason: "نقص تحصيل موثق",
  });
  assert.equal(next.cash.at(-1)!.amount, 24000);
  assert.equal(next.exceptions.at(-1)!.kind, "cash_shortfall");
  assert.equal(next.exceptions.at(-1)!.amount, 400);
  assert.equal(next.earnings.filter((e) => e.orderId === "TZ-1005").length, 1);
  assert.equal(next.earnings.at(-1)!.amount, 100);
  fail(
    next,
    {
      type: "preview-courier",
      orderId: "TZ-1005",
      stage: "delivered",
      collected: 24400,
      reference: "x",
      reason: "x",
    },
    /مرة واحدة/,
  );
});
test("cash remittance and commission settlement are separate complete allocations, with no implicit netting", () => {
  let s = login();
  s = go(s, {
    type: "payout",
    kind: "commission",
    courierId: "courier-1",
    sourceIds: ["earning-delivered"],
    ...meta,
  });
  assert.equal(s.settlements[0]!.amount, 100);
  assert.equal(availableSources(s, "cash", "courier-1")[0]!.amount, 24400);
  s = go(s, {
    type: "payout",
    kind: "cash",
    courierId: "courier-1",
    sourceIds: ["cash-delivered"],
    ...meta,
  });
  assert.equal(s.remittances[0]!.amount, 24400);
  fail(
    s,
    {
      type: "payout",
      kind: "commission",
      courierId: "courier-1",
      sourceIds: ["earning-delivered"],
      ...meta,
    },
    /سبق تخصيصه/,
  );
  fail(
    login(),
    {
      type: "payout",
      kind: "commission",
      courierId: "courier-2",
      sourceIds: ["earning-delivered"],
      ...meta,
    },
    /خارج/,
  );
});
test("reversal is once, preserves original allocations, and funds resettlement via a credit without extra earning", () => {
  let s = go(login(), {
    type: "payout",
    kind: "commission",
    courierId: "courier-1",
    sourceIds: ["earning-delivered"],
    ...meta,
  });
  const original = structuredClone(s.settlements[0]!);
  s = go(s, {
    type: "reverse",
    kind: "commission",
    payoutId: original.id,
    ...meta,
  });
  const credit = s.commissionReversals[0]!;
  assert.deepEqual(s.settlements[0], original);
  assert.equal(s.earnings.length, 1);
  fail(
    s,
    { type: "reverse", kind: "commission", payoutId: original.id, ...meta },
    /سابق/,
  );
  s = go(s, {
    type: "payout",
    kind: "commission",
    courierId: "courier-1",
    sourceIds: [credit.id],
    ...meta,
  });
  assert.deepEqual(s.settlements[1]!.sourceIds, [credit.id]);
  assert.equal(availableSources(s, "commission", "courier-1").length, 0);
  assert.equal(s.earnings.length, 1);
});
test("branch and delivery configuration require proper coverage; no automatic second active branch in same province", () => {
  const s = login();
  fail(
    s,
    { type: "branch", value: { ...s.branches[0]!, coverage: 0 } },
    /النطاق/,
  );
  fail(
    s,
    { type: "branch", value: { ...s.branches[0]!, id: "duplicate" } },
    /واحد/,
  );
  fail(
    s,
    {
      type: "province",
      value: { ...s.provinces[0]!, catalogBranchId: "sanaa" },
    },
    /المحافظة نفسها/,
  );
});
test("general maintenance and releases require global scope; builds compare numerically, data stays a preview", () => {
  const s = login("770000002");
  fail(
    s,
    { type: "maintenance", enabled: true, message: "صيانة", confirmed: true },
    /لا تملك/,
  );
  let owner = login();
  owner = go(owner, {
    type: "maintenance",
    enabled: true,
    message: "صيانة",
    confirmed: true,
  });
  assert(can(owner, "orders.review", "aden"));
  assert.equal(owner.session, "staff-owner");
  fail(
    owner,
    {
      type: "release",
      value: {
        app: "customer",
        platform: "android",
        environment: "staging",
        minimum: 10,
        latest: 9,
        version: "x",
        url: "https://example.invalid",
        message: "",
      },
      confirmed: true,
    },
    /build/,
  );
  owner = go(owner, {
    type: "release",
    value: {
      app: "customer",
      platform: "ios",
      environment: "staging",
      minimum: 9,
      latest: 10,
      version: "x",
      url: "https://example.invalid",
      message: "",
    },
    confirmed: true,
  });
  assert.equal(owner.releases[0]!.latest, 10);
  fail(
    owner,
    {
      type: "settings",
      value: { ...owner.settings, holdMinutes: 45 },
      confirmed: true,
    },
    /30 دقيقة/,
  );
});
test("staff changes cannot lock the current owner out, and private quality cannot be read by a reviewer", () => {
  const s = login();
  fail(
    s,
    {
      type: "staff",
      value: { ...s.staff[0]!, active: false },
      confirmed: true,
    },
    /لا تعطل/,
  );
  const reviewer = login("770000003");
  fail(
    reviewer,
    { type: "complaint", id: "flag-1", status: "resolved", response: "x" },
    /لا تملك/,
  );
  fail(
    reviewer,
    {
      type: "receipt-review",
      orderId: "TZ-1003",
      outcome: "transfer_verified",
      amount: 24400,
      externalChecked: true,
      holdAction: "keep",
      ...meta,
    },
    /لا تملك/,
  );
});
test("local repository distinguishes empty/error/offline, cancels stale work, and recovers", async () => {
  const s = login();
  assert(
    (await readOrders(s, "TZ-1001", "all", "ready", undefined, 0)).length === 1,
  );
  assert.equal(
    (await readOrders(s, "", "all", "empty", undefined, 0)).length,
    0,
  );
  await assert.rejects(
    readOrders(s, "", "all", "error", undefined, 0),
    /error/,
  );
  await assert.rejects(
    readOrders(s, "", "all", "offline", undefined, 0),
    /offline/,
  );
  const c = new AbortController();
  const work = readOrders(s, "", "all", "loading", c.signal, 10000);
  c.abort();
  await assert.rejects(work, /aborted/);
  assert((await readOrders(s, "", "all", "ready", undefined, 0)).length > 0);
});

test("payment instructions exist before receipt and later method edits cannot change their snapshot", () => {
  let s = go(issued(), {
    type: "preview-accept",
    orderId: "TZ-1001",
    paymentKind: "transfer",
  });
  const receipt: Command = {
    type: "preview-receipt",
    orderId: "TZ-1001",
    methodId: "wallet-demo",
    number: "DEMO-FIRST",
    amount: currentQuote(o(s))!.total,
  };
  fail(s, receipt, /ثبت تعليمات/);
  s = go(s, {
    type: "preview-instructions",
    orderId: "TZ-1001",
    methodId: "wallet-demo",
  });
  const instruction = structuredClone(o(s).instructions[0]!);
  s = go(s, {
    type: "method",
    value: { ...s.methods[0]!, beneficiary: "مستفيد مستقبلي" },
  });
  s = go(s, receipt);
  assert.deepEqual(o(s).payments[0]!.instructions, instruction.snapshot);
  assert.equal(o(s).payments[0]!.instructionId, instruction.id);
  assert.equal(
    o(s).instructions[0]!.at <= o(s).payments[0]!.attempts[0]!.submittedAt,
    true,
  );
});

test("clock releases only expired timed holds and reconciles reserved counters without changing protected holds", () => {
  let s = cashAccepted();
  const protectedBefore = structuredClone(
    s.reservations.filter((r) => r.orderId === "TZ-1003"),
  );
  s = transition(s, { type: "clock" }, s.now + 31 * 60000).state;
  assert(
    s.reservations
      .filter((r) => r.orderId === "TZ-1001")
      .every((r) => r.state === "expired"),
  );
  assert.deepEqual(
    s.reservations.filter((r) => r.orderId === "TZ-1003"),
    protectedBefore,
  );
  for (const stock of s.stock)
    assert.equal(
      stock.reserved,
      s.reservations
        .filter(
          (r) =>
            r.state === "active" &&
            r.branchId === stock.branchId &&
            r.productId === stock.productId,
        )
        .reduce((n, r) => n + r.pieces, 0),
    );
});

test("rejecting a transfer requires external verification, while image rejection makes no money claim", () => {
  const s = login();
  fail(
    s,
    {
      type: "receipt-review",
      orderId: "TZ-1003",
      outcome: "transfer_rejected",
      amount: 0,
      externalChecked: false,
      holdAction: "release",
      ...meta,
    },
    /خارجي/,
  );
  const next = go(s, {
    type: "receipt-review",
    orderId: "TZ-1003",
    outcome: "image_rejected",
    amount: 0,
    externalChecked: false,
    holdAction: "keep",
    ...meta,
  });
  assert.equal(netApproved(next, o(next, "TZ-1003")), 0);
  fail(
    next,
    { type: "close-order", orderId: "TZ-1003", status: "cancelled", ...meta },
    /رفض الصورة/,
  );
});

test("a delivery promotion with category/product restrictions needs a matching item", () => {
  const s = login();
  s.promotions = [{ ...s.promotions[0]!, categoryId: "oil" }];
  assert.equal(
    bestPromotion(s, "aden", o(s, "TZ-1002").items, 500, "retail").id,
    null,
  );
  assert.equal(
    bestPromotion(s, "aden", o(s).items, 500, "retail").deliveryDiscount,
    100,
  );
});

test("delivery failure review preserves confirmed price, assignment and all ledgers", () => {
  let s = login();
  const before = structuredClone(o(s, "TZ-1005"));
  s = go(s, {
    type: "delivery-issue",
    orderId: "TZ-1005",
    preview: false,
    reason: "تنسيق إعادة تواصل دون تعديل المبلغ",
    confirmed: true,
  });
  assert.equal(o(s, "TZ-1005").status, "on_the_way");
  assert.deepEqual(o(s, "TZ-1005").quotes, before.quotes);
  assert.deepEqual(o(s, "TZ-1005").assignments, before.assignments);
  assert.equal(s.earnings.length, 1);
  assert.equal(s.cash.length, 1);
  assert(o(s, "TZ-1005").deliveryIssues[0]!.reviewedBy);
  fail(
    s,
    {
      type: "delivery-issue",
      orderId: "TZ-1005",
      preview: false,
      reason: "مرة أخرى",
      confirmed: true,
    },
    /لا بلاغ/,
  );
});

test("a branch manager cannot edit a shared courier's other branch, and cross-product unit ownership is checked", () => {
  const manager = login("770000002");
  fail(
    manager,
    { type: "courier", value: { ...manager.couriers[1]!, bps: 1000 }, ...meta },
    /لا تملك/,
  );
  const s = login(),
    p = structuredClone(s.products[0]!);
  p.units.push({ ...s.products[1]!.units[1]!, used: false });
  fail(s, { type: "product", value: p }, /ملك منتج آخر/);
});

test("cash reversal preserves full remittance allocation and can be allocated once without touching earnings", () => {
  let s = go(login(), {
    type: "payout",
    kind: "cash",
    courierId: "courier-1",
    sourceIds: ["cash-delivered"],
    ...meta,
  });
  const original = structuredClone(s.remittances[0]!);
  s = go(s, { type: "reverse", kind: "cash", payoutId: original.id, ...meta });
  const credit = s.cashReversals[0]!;
  assert.deepEqual(s.remittances[0], original);
  assert.equal(credit.amount, 24400);
  s = go(s, {
    type: "payout",
    kind: "cash",
    courierId: "courier-1",
    sourceIds: [credit.id],
    ...meta,
  });
  assert.equal(availableSources(s, "cash", "courier-1").length, 0);
  assert.equal(s.cash.length, 1);
  assert.equal(s.earnings[0]!.amount, 100);
});

test("a prior flag from another branch shows an alert without exposing its private text", () => {
  const s = login("770000002");
  const current = o(s, "TZ-1002"),
    previous = o(s, "TZ-2001");
  previous.customerId = current.customerId;
  s.complaints = [
    {
      id: "private-other-branch",
      orderId: previous.id,
      type: "flag",
      text: "تفاصيل من فرع آخر",
      status: "open",
      response: "",
    },
  ];
  assert.equal(clientFlags(s, current).hasFlags, true);
  assert.equal(clientFlags(s, current).details.length, 0);
  s.session = "staff-owner";
  assert.equal(clientFlags(s, current).details[0]!.text, "تفاصيل من فرع آخر");
});
