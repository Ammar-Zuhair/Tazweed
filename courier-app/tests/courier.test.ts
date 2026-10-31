import assert from "node:assert/strict";
import { test } from "node:test";
import {
  active,
  CACHE_TTL,
  COURIER_ID,
  collected,
  DEMO_PASSWORD,
  DEMO_PHONE,
  earningPaid,
  execute,
  externalLinks,
  finances,
  login,
  paymentState,
  project,
  prune,
  resend,
  verify,
} from "../src/domain/courier-model";
import type { Command, ServerState } from "../src/domain/types";
import { fixtures } from "../src/fixtures/courier-fixtures";
import { FakeCourierRepository } from "../src/data/courier-repository";
const now = Date.UTC(2026, 9, 31, 10);
const actor = COURIER_ID;
function command(
  state: ServerState,
  type: Command["type"],
  extra: object = {},
  id = "t1",
): Command {
  const t = state.tasks.find((x) => x.id === id)!;
  return {
    key: `key-${type}-${t.version}`,
    orderId: id,
    assignmentId: t.assignmentId,
    expectedVersion: t.version,
    type,
    ...extra,
  } as Command;
}
const start = (s: ServerState, id = "t1") =>
  execute(s, actor, command(s, "start", {}, id), now);
test("internal preview login only, OTP is single use with five attempts and expiry", () => {
  assert.throws(() => login("770000000", DEMO_PASSWORD, now), /غير صحيحة/);
  assert.throws(() => login(DEMO_PHONE, "wrong", now), /غير صحيحة/);
  const c = login(DEMO_PHONE, DEMO_PASSWORD, now);
  for (let i = 0; i < 5; i++) assert.equal(verify(c, "111111", now), false);
  assert.throws(() => verify(c, "000000", now), /حد محاولات/);
  const d = login(DEMO_PHONE, DEMO_PASSWORD, now);
  assert.equal(verify(d, "000000", now), true);
  assert.throws(() => verify(d, "000000", now), /انتهى/);
  assert.throws(
    () =>
      verify(login(DEMO_PHONE, DEMO_PASSWORD, now), "000000", now + 300_000),
    /انتهى/,
  );
});
test("resend has a deadline and issues a fresh limited challenge", () => {
  const c = login(DEMO_PHONE, DEMO_PASSWORD, now);
  assert.throws(() => resend(c, now), /انتظر/);
  assert.equal(resend(c, now + 60_000).expiresAt, now + 360_000);
});
test("projection exposes only current assigned private snapshots, not another courier or expired assignment", () => {
  const s = fixtures(now);
  s.tasks[0]!.expiresAt = now;
  const p = project(s, actor, now);
  assert(!p.tasks.some((t) => t.id === "other" || t.id === "t1"));
  assert(!JSON.stringify(p).includes("770000099"));
  assert(!("receipts" in p));
});
test("cache expires fully and task expiry prunes dependent reports and notices", () => {
  const p = project(fixtures(now), actor, now);
  p.tasks[0]!.expiresAt = now + 1;
  p.reports.push({
    id: "r",
    orderId: "t1",
    courierId: actor,
    kind: "customer_flag",
    reason: "سبب",
    details: "تفاصيل خاصة",
    status: "open",
    at: now,
  });
  const result = prune(p, now + 2)!;
  assert(!result.tasks.some((t) => t.id === "t1"));
  assert.equal(result.reports.length, 0);
  assert(!result.notices.some((x) => x.orderId === "t1"));
  assert.equal(prune(p, now + CACHE_TTL), null);
});
test("invalid ownership, assignment replacement and version conflicts cannot mutate orders", () => {
  const s = fixtures(now);
  const c = command(s, "start");
  for (const x of [
    () => execute(s, "other", c, now),
    () => execute(s, actor, { ...c, assignmentId: "reassigned" }, now),
    () => execute(s, actor, { ...c, expectedVersion: 99 }, now),
  ])
    assert.throws(x);
  assert.equal(s.tasks[0]!.status, "confirmed");
});
test("start preserves frozen total and assignment commission; no reject or accept command", () => {
  const s = fixtures(now);
  const n = start(s);
  assert.equal(n.tasks[0]!.status, "on_the_way");
  assert.equal(s.tasks[0]!.status, "confirmed");
  assert.equal(n.tasks[0]!.total, 24400);
  assert.equal(n.tasks[0]!.commission, 100);
  assert.equal(n.earnings.length, s.earnings.length);
});
test("deliver requires on the way; no cash auto-created by start or delivery", () => {
  const s = fixtures(now);
  assert.throws(() => execute(s, actor, command(s, "deliver"), now), /ابدأ/);
  const n = start(s);
  assert.throws(
    () => execute(n, actor, command(n, "deliver"), now),
    /النقد الحقيقي/,
  );
  assert.equal(n.cash.length, s.cash.length);
});
test("transfer delivery never exposes receipt or invents collection; earns once from fee before discount", () => {
  let s = start(fixtures(now), "t2");
  const c = command(s, "deliver", {}, "t2");
  const n = execute(s, actor, c, now);
  assert.equal(n.cash.length, s.cash.length);
  assert.equal(n.earnings.find((x) => x.orderId === "t2")!.amount, 75);
  assert.equal(execute(n, actor, c, now).earnings.length, n.earnings.length);
  assert.throws(() => execute(n, actor, command(n, "deliver", {}, "t2"), now));
});
test("cash collection is explicit exact amount and reference, independent from earning/delivery", () => {
  const s = start(fixtures(now));
  const c = command(s, "collect", { amount: 24400, reference: "ACTUAL-01" });
  const n = execute(s, actor, c, now);
  assert.equal(collected(n.cash, "t1"), 24400);
  assert.equal(n.tasks[0]!.status, "on_the_way");
  assert.equal(n.earnings.length, s.earnings.length);
  assert.equal(paymentState(n, n.tasks[0]!), "محصل بالكامل");
});
test("invalid amount or reference never writes cash; a transfer cannot collect cash", () => {
  const s = start(fixtures(now));
  for (const amount of [0, -1, 2.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])
    assert.throws(() =>
      execute(
        s,
        actor,
        command(s, "collect", { amount, reference: "VALID" }),
        now,
      ),
    );
  assert.throws(() =>
    execute(
      s,
      actor,
      command(s, "collect", { amount: 100, reference: " " }),
      now,
    ),
  );
  const t = start(fixtures(now), "t2");
  assert.throws(() =>
    execute(
      t,
      actor,
      command(t, "collect", { amount: 100, reference: "VALID" }, "t2"),
      now,
    ),
  );
});
test("collection idempotency replays same payload, rejects changed contents and duplicate references", () => {
  const s = start(fixtures(now));
  const c = command(s, "collect", { amount: 24400, reference: "VALID" });
  const n = execute(s, actor, c, now);
  assert.deepEqual(execute(n, actor, c, now), n);
  assert.throws(
    () =>
      execute(
        n,
        actor,
        { ...c, type: "collect", amount: 200, reference: "VALID" },
        now,
      ),
    /تعارض/,
  );
  assert.throws(
    () =>
      execute(
        n,
        actor,
        command(n, "collect", { amount: 24400, reference: "OTHER" }),
        now,
      ),
    /التحصيل مسجل/,
  );
  const t = n.tasks.find((x) => x.id === "t3")!;
  assert.throws(
    () =>
      execute(
        n,
        actor,
        command(n, "collect", { amount: 100, reference: "VALID" }, t.id),
        now,
      ),
    /مرجع التحصيل مستخدم/,
  );
});
for (const [amount, kind] of [
  [0, "cash_uncollected"],
  [24000, "cash_shortfall"],
  [25000, "overpayment"],
] as const)
  test(`explicit ${kind} allows actual delivery without hiding financial exception`, () => {
    let s = start(fixtures(now));
    if (amount)
      s = execute(
        s,
        actor,
        command(s, "collect", { amount, reference: "ACTUAL" }),
        now,
      );
    s = execute(
      s,
      actor,
      command(s, "cash_exception", { reason: "سبب نقدي تجريبي موثق" }),
      now,
    );
    assert.equal(s.exceptions[0]!.kind, kind);
    const n = execute(s, actor, command(s, "deliver"), now);
    assert.equal(n.tasks[0]!.status, "delivered");
    assert.equal(collected(n.cash, "t1"), amount);
    assert.equal(paymentState(n, n.tasks[0]!), "استثناء نقدي مسجل للإدارة");
    assert.equal(n.earnings.find((x) => x.orderId === "t1")!.amount, 100);
  });
test("stale zero-cash exception cannot hide a later unmatched collection", () => {
  let s = start(fixtures(now));
  s = execute(
    s,
    actor,
    command(s, "cash_exception", { reason: "العميل لا يحمل النقد" }),
    now,
  );
  s = execute(
    s,
    actor,
    command(s, "collect", { amount: 20000, reference: "LATE" }),
    now,
  );
  assert.throws(
    () => execute(s, actor, command(s, "deliver"), now),
    /الاستثناء/,
  );
});
test("exact cash delivery earns 100 on base 500 despite discount 100; never nets cash", () => {
  let s = start(fixtures(now));
  s = execute(
    s,
    actor,
    command(s, "collect", { amount: 24400, reference: "ACTUAL" }),
    now,
  );
  const c = command(s, "deliver");
  const n = execute(s, actor, c, now);
  const f = finances(project(n, actor, now), "2026-10-31");
  assert.equal(f.outstanding, 48800);
  assert.equal(f.unpaid, 300);
  assert.equal(n.earnings.find((x) => x.orderId === "t1")!.amount, 100);
  assert.equal(n.earnings.filter((x) => x.orderId === "t1").length, 1);
  assert.deepEqual(execute(n, actor, c, now), n);
});
test("zero commission does not create a zero earning", () => {
  let s = fixtures(now);
  const t = s.tasks.find((x) => x.id === "t2")!;
  t.bps = 0;
  t.commission = 0;
  s = start(s, "t2");
  s = execute(s, actor, command(s, "deliver", {}, "t2"), now);
  assert(!s.earnings.some((x) => x.orderId === "t2"));
});
test("daily totals use earning delivery date, reversal is unpaid credit rather than new earnings", () => {
  const p = project(fixtures(now), actor, now);
  const f = finances(p, "2026-10-31");
  assert.deepEqual(f, {
    daily: 200,
    earned: 300,
    paid: 100,
    unpaid: 200,
    cash: 48800,
    remitted: 24400,
    outstanding: 24400,
  });
  assert.equal(finances(p, "2026-10-30").daily, 100);
  assert.equal(
    earningPaid(p, p.earnings.find((x) => x.orderId === "t4")!),
    false,
  );
});
test("report with optional local image never blocks customer or changes total/status", () => {
  const s = fixtures(now);
  const n = execute(
    s,
    actor,
    command(s, "report", {
      kind: "customer_flag",
      reason: "مشكلة",
      details: "تفاصيل بلاغ تجريبي",
      image: "data:image/png;base64,AA==",
    }),
    now,
  );
  assert.equal(n.reports[0]!.status, "open");
  assert.equal(n.tasks[0]!.status, "confirmed");
  assert.equal(n.tasks[0]!.total, 24400);
  assert(!("blocked" in n.tasks[0]!));
  assert.equal(s.reports.length, 0);
});
test("report validates detail and refuses remote images or ownership bypass", () => {
  const s = fixtures(now);
  assert.throws(() =>
    execute(
      s,
      actor,
      command(s, "report", {
        kind: "delivery_issue",
        reason: "سبب",
        details: "قصير",
      }),
      now,
    ),
  );
  assert.throws(() =>
    execute(
      s,
      actor,
      command(s, "report", {
        kind: "delivery_issue",
        reason: "سبب",
        details: "تفاصيل كافية",
        image: "https://external.invalid/file.png",
      }),
      now,
    ),
  );
});
test("external routes preserve exact address pin and Yemen phone; no location permission", () => {
  const t = fixtures(now).tasks[0]!;
  const x = externalLinks(t);
  assert.equal(x.call, "tel:+967770000000");
  assert.match(x.whatsapp, /wa.me\/967770000000/);
  assert.match(x.navigation, /destination=12.8531,44.9772/);
  t.address.latitude = NaN;
  assert.throws(() => externalLinks(t));
});
test("fake reads distinguish empty/error/offline and cancel old reads", async () => {
  const repo = new FakeCourierRepository(fixtures(now));
  assert.equal(
    (await repo.read(actor, "empty", now, undefined, 0)).tasks.length,
    0,
  );
  for (const mode of ["error", "offline"] as const)
    await assert.rejects(repo.read(actor, mode, now, undefined, 0));
  const controller = new AbortController();
  const p = repo.read(actor, "loading", now, controller.signal);
  controller.abort();
  await assert.rejects(p, /aborted/);
});
test("network pending is not success; retry after lost ack applies exactly once", async () => {
  const repo = new FakeCourierRepository(fixtures(now));
  const c = command(repo.state, "start");
  await assert.rejects(
    repo.send(actor, c, "offline", now, 0),
    /pending_network/,
  );
  assert.equal(repo.state.tasks[0]!.status, "confirmed");
  await assert.rejects(
    repo.send(actor, c, "lost_ack", now, 0),
    /pending_network/,
  );
  assert.equal(repo.state.tasks[0]!.status, "on_the_way");
  const result = await repo.send(actor, c, "online", now, 0);
  assert.equal(result.tasks[0]!.version, 2);
});
test("assignment expiration while queued refuses action and prevents cache resurrection", async () => {
  const repo = new FakeCourierRepository(fixtures(now));
  const c = command(repo.state, "start");
  repo.state.tasks[0]!.expiresAt = now;
  await assert.rejects(repo.send(actor, c, "online", now, 0), /الإسناد/);
  assert(!project(repo.state, actor, now).tasks.some((x) => x.id === "t1"));
});
test("production fake adapter is blocked", () =>
  assert.throws(
    () => new FakeCourierRepository(fixtures(now), "production"),
    /production/,
  ));
test("lost delivery acknowledgement cannot duplicate cash, commission or timestamps", async () => {
  const repo = new FakeCourierRepository(start(fixtures(now)));
  const collect = command(repo.state, "collect", {
    amount: 24400,
    reference: "ACK-LOST-CASH",
  });
  await assert.rejects(repo.send(actor, collect, "lost_ack", now, 0));
  await repo.send(actor, collect, "online", now + 100, 0);
  const delivery = command(repo.state, "deliver");
  await assert.rejects(repo.send(actor, delivery, "lost_ack", now + 200, 0));
  const before = JSON.stringify(repo.state);
  await repo.send(actor, delivery, "online", now + 300, 0);
  assert.equal(JSON.stringify(repo.state), before);
  assert.equal(repo.state.cash.filter((x) => x.orderId === "t1").length, 1);
  assert.equal(repo.state.earnings.filter((x) => x.orderId === "t1").length, 1);
  assert.equal(repo.state.tasks[0]!.deliveredAt, now + 200);
});
test("forged reject/accept action cannot be executed at runtime", () => {
  const s = fixtures(now);
  const c = { ...command(s, "start"), type: "reject" } as unknown as Command;
  assert.throws(() => execute(s, actor, c, now), /إجراء غير متاح/);
  assert.equal(s.tasks[0]!.status, "confirmed");
});
