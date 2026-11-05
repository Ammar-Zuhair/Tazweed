import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture, type Fixture } from "./phase05/helpers.js";
import { seed } from "./phase09/seed.js";
import { TestStore } from "./phase06/store.js";
import { TestRouting } from "./phase07/routing.js";
import {
  projectOutbox,
  dispatchCampaigns,
  deliverPush,
} from "../src/engagement/worker.js";
import {
  ExpoPush,
  type PushProvider,
  type PushMessage,
  type PushResult,
} from "../src/engagement/provider.js";
import { configuration } from "../src/engagement/configuration.js";
import { readConfig } from "../src/config.js";
let f: Fixture;
const projects = {
  customer: randomUUID(),
  admin: randomUUID(),
  courier: randomUUID(),
};
before(async () => {
  f = await fixture({
    configOverrides: {
      EXPO_CUSTOMER_PROJECT_ID: projects.customer,
      EXPO_ADMIN_PROJECT_ID: projects.admin,
      EXPO_COURIER_PROJECT_ID: projects.courier,
    },
    objectStore: new TestStore(),
    routingProvider: new TestRouting(),
  });
});
after(async () => {
  await f?.close();
});
const ok = (r: any) => assert.equal(r.status, 200, JSON.stringify(r.body));
const req = (
  h: any,
  path: string,
  body?: any,
  admin = false,
  method = body === undefined ? "GET" : "POST",
  key = randomUUID(),
) =>
  f.request(
    method,
    "/api/v1" + path,
    body,
    admin ? h.admin : h.token,
    admin ? "admin" : "courier",
    { "Idempotency-Key": key },
  );
const customer = (
  h: any,
  path: string,
  body?: any,
  method = body === undefined ? "GET" : "POST",
) =>
  f.request(method, "/api/v1" + path, body, h.customerToken, "customer", {
    "Idempotency-Key": randomUUID(),
  });
// seed09 token is courier; retain the seed08 customer token by its authenticated operation helper.
async function state() {
  const h = await seed(f);
  let t = "";
  const session = (
    await f.owner.query(
      "SELECT * FROM sessions WHERE user_id=$1 AND app='customer'",
      [h.customer.id],
    )
  ).rows[0];
  t = await f.security.access(h.customer.id, session.id, "customer");
  return { ...h, customerToken: t };
}
async function register(
  h: any,
  app: "customer" | "admin" | "courier" = "courier",
  token = "ExpoPushToken[" + randomUUID().replaceAll("-", "") + "]",
) {
  const r = await f.request(
    "POST",
    "/api/v1/devices/push-tokens",
    {
      token,
      projectId: projects[app],
      platform: "android",
      soundEnabled: true,
    },
    app === "admin" ? h.admin : app === "customer" ? h.customerToken : h.token,
    app,
  );
  ok(r);
  return { id: r.body.id, token };
}
class Push implements PushProvider {
  readonly mode = "test" as const;
  messages: PushMessage[] = [];
  response: PushResult = { status: "ok", id: "ticket-test-10" };
  receipts: PushResult | null = { status: "ok" };
  async send(m: PushMessage) {
    this.messages.push(m);
    return this.response;
  }
  async receipt() {
    return this.receipts;
  }
}
async function campaign(
  h: any,
  audience: any = { kind: "customers", branchId: null },
  key = randomUUID(),
) {
  const v = {
    title: "بث اختبار10",
    body: "رسالة عربية من قاعدة اختبار معزولة.",
    audience,
  };
  const r = await req(h, "/admin/campaigns", v, true, "POST", key);
  ok(r);
  return { id: r.body.id, version: r.body.version, v, key };
}
async function schedule(h: any, c: any, at = new Date().toISOString()) {
  const r = await req(
    h,
    "/admin/campaigns/" + c.id + "/schedule",
    { expectedVersion: c.version, scheduledAt: at },
    true,
  );
  ok(r);
  return r.body;
}
async function due() {
  await f.owner.query(
    "UPDATE notification_deliveries SET next_attempt_at=now()-interval '1 second'",
  );
}
test("public configuration trusts server environment, uses numeric native builds and validates query", async () => {
  const h = await state();
  const b = {
    app: "customer",
    platform: "android",
    minimumBuild: 9,
    latestBuild: 11,
    latestVersion: "1.1",
    storeUrl:
      "https://play.google.com/store/apps/details?id=com.owner.customer",
    message: "حدث التطبيق",
    binaryConfirmed: true,
    expectedVersion: 0,
  };
  ok(await req(h, "/admin/app-releases", b, true, "PUT"));
  const get = async (build: number) => {
    const r = await f.request(
      "GET",
      `/api/v1/public/config?app=customer&platform=android&build=${build}`,
    );
    ok(r);
    return r.body;
  };
  assert.equal((await get(8)).release.required, true);
  assert.equal((await get(10)).release.optional, true);
  assert.equal((await get(11)).release.optional, false);
  assert.equal((await get(0)).release.required, false);
  assert.equal(
    (
      await f.request(
        "GET",
        "/api/v1/public/config?app=customer&platform=android&build=8&environment=production",
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await configuration(
        f.pool,
        { ...f.config, APP_ENV: "production" },
        { app: "customer", platform: "android", build: 1 },
      )
    ).release,
    null,
  );
  assert.equal(
    (await req(h, "/admin/app-releases", b, true, "PUT")).status,
    409,
  );
  assert.equal(
    (
      await req(
        h,
        "/admin/app-releases",
        { ...b, platform: "ios", storeUrl: "https://attacker.example/fake" },
        true,
        "PUT",
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await req(
        h,
        "/admin/app-releases",
        { ...b, binaryConfirmed: false },
        true,
        "PUT",
      )
    ).status,
    422,
  );
});
test("maintenance blocks catalog, preview and new submissions despite forged app header; ongoing and staff/courier survive", async () => {
  const h = await state(),
    id = await h.confirmed();
  await h.assign(id);
  const m = await req(h, "/admin/customer-maintenance", undefined, true);
  ok(m);
  ok(
    await req(
      h,
      "/admin/customer-maintenance",
      {
        enabled: true,
        message: "صيانة اختبار10",
        expectedVersion: m.body.version,
      },
      true,
      "PUT",
    ),
  );
  const catalog = await f.request(
    "GET",
    "/api/v1/catalog/categories",
    undefined,
    undefined,
    "admin",
    { "X-Client-App": "admin" },
  );
  assert.equal(catalog.status, 503);
  assert.equal(catalog.headers.get("retry-after"), "60");
  assert.equal(
    (
      await customer(h, "/checkout/preview", {
        governorateId: h.g,
        addressId: h.address,
        kind: "retail",
        items: [{ unitId: h.piece, quantity: 1 }],
      })
    ).status,
    503,
  );
  const count = (await f.owner.query("SELECT count(*)::int n FROM orders"))
    .rows[0].n;
  assert.equal(
    (
      await customer(h, "/orders", {
        governorateId: h.g,
        addressId: h.address,
        kind: "retail",
        paymentKind: "cash_on_delivery",
        items: [{ unitId: h.piece, quantity: 1 }],
      })
    ).status,
    503,
  );
  assert.equal(
    (await f.owner.query("SELECT count(*)::int n FROM orders")).rows[0].n,
    count,
  );
  ok(await customer(h, "/orders/" + id));
  ok(await req(h, "/admin/orders/" + id, undefined, true));
  ok(await h.req("/courier/orders"));
  ok(await h.cmd(id, "start"));
  ok(await customer(h, "/me"));
  ok(
    await f.request(
      "GET",
      "/api/v1/public/config?app=customer&platform=android&build=1",
    ),
  );
  assert.equal(
    (
      await f.request(
        "GET",
        "/api/v1/public/config?app=courier&platform=android&build=1",
      )
    ).body.maintenance.enabled,
    false,
  );
  assert.equal(
    (
      await req(
        h,
        "/admin/customer-maintenance",
        { enabled: false, message: "قديم", expectedVersion: m.body.version },
        true,
        "PUT",
      )
    ).status,
    409,
  );
});
test("campaign creation/scheduling is idempotent, frozen and requires live global permission before replay", async () => {
  const h = await state(),
    c = await campaign(h);
  const repeat = await req(h, "/admin/campaigns", c.v, true, "POST", c.key);
  ok(repeat);
  assert.equal(repeat.body.id, c.id);
  assert.equal(
    (
      await req(
        h,
        "/admin/campaigns",
        { ...c.v, body: "مختلف" },
        true,
        "POST",
        c.key,
      )
    ).status,
    409,
  );
  await f.owner.query(
    "UPDATE staff_grants SET global_scope=false,branch_id=$2 WHERE user_id=$1",
    [h.staff.id, h.b],
  );
  assert.equal(
    (await req(h, "/admin/campaigns", c.v, true, "POST", c.key)).status,
    403,
  );
  assert.equal(
    (
      await f.request(
        "POST",
        "/api/v1/AdMiN/campaigns",
        c.v,
        h.customerToken,
        "customer",
        { "Idempotency-Key": randomUUID() },
      )
    ).status,
    403,
  );
});
test("scheduled and cancelled campaigns never dispatch early; multiple schedulers create one inbox item per user", async () => {
  const h = await state(),
    c = await campaign(h);
  await schedule(h, c, new Date(Date.now() + 86400000).toISOString());
  assert.equal(await dispatchCampaigns(f.pool, f.config), 0);
  const v = (await req(h, "/admin/campaigns", undefined, true)).body.items[0]
    .version;
  ok(
    await req(
      h,
      "/admin/campaigns/" + c.id + "/cancel",
      { expectedVersion: v },
      true,
    ),
  );
  await f.owner.query(
    "UPDATE notification_campaigns SET scheduled_at=now()-interval '1 minute'",
  );
  assert.equal(await dispatchCampaigns(f.pool, f.config), 0);
  const live = await campaign(h);
  await schedule(h, live);
  await Promise.all([
    dispatchCampaigns(f.pool, f.config),
    dispatchCampaigns(f.pool, f.config),
  ]);
  const n = (
    await f.owner.query(
      "SELECT count(*)::int n FROM notification_inbox WHERE event_key=$1",
      ["campaign:" + live.id],
    )
  ).rows[0].n;
  assert.equal(n, 1);
  assert.equal((await customer(h, "/notifications")).body.items.length, 1);
});
test("targeted branch audience excludes unrelated customers and author revocation stops queued broadcast", async () => {
  const h = await state();
  await h.submit();
  const other = await f.user("770010010");
  const c = await campaign(h, { kind: "customers", branchId: h.b });
  await schedule(h, c);
  await dispatchCampaigns(f.pool, f.config);
  assert.equal(
    (
      await f.owner.query(
        "SELECT user_id FROM notification_inbox WHERE event_key=$1",
        ["campaign:" + c.id],
      )
    ).rows[0].user_id,
    h.customer.id,
  );
  assert.equal(
    (
      await f.owner.query("SELECT 1 FROM notification_inbox WHERE user_id=$1", [
        other.id,
      ])
    ).rowCount,
    0,
  );
  const c2 = await campaign(h);
  await schedule(h, c2);
  await f.owner.query("DELETE FROM staff_grants WHERE user_id=$1", [
    h.staff.id,
  ]);
  await dispatchCampaigns(f.pool, f.config);
  assert.equal(
    (
      await f.owner.query(
        "SELECT status,error_code FROM notification_campaigns WHERE id=$1",
        [c2.id],
      )
    ).rows[0].error_code,
    "AUTHOR_REVOKED",
  );
});
test("outbox concurrent projection is atomic and dedupes, and keeps push generic without address/payment details", async () => {
  const h = await state();
  await register(h, "customer");
  const id = await h.confirmed();
  await Promise.all([
    projectOutbox(f.pool, f.config, 100),
    projectOutbox(f.pool, f.config, 100),
  ]);
  const before = (
    await f.owner.query("SELECT count(*)::int n FROM notification_inbox")
  ).rows[0].n;
  await projectOutbox(f.pool, f.config, 100);
  assert.equal(
    (await f.owner.query("SELECT count(*)::int n FROM notification_inbox"))
      .rows[0].n,
    before,
  );
  const p = new Push();
  await deliverPush(f.pool, f.config, p, 50);
  assert(p.messages.length > 0);
  const text = JSON.stringify(p.messages);
  assert(!text.includes(h.customer.phone_e164));
  assert(!text.includes("address_snapshot"));
  assert(!text.includes("approved_amount"));
  const items = (await customer(h, "/notifications")).body.items;
  assert(items.some((n: any) => n.data.orderId === id));
  const own = items[0];
  ok(await customer(h, "/notifications/" + own.id + "/read", {}, "PATCH"));
  ok(await customer(h, "/notifications/" + own.id + "/read", {}, "PATCH"));
  assert((await customer(h, "/notifications/" + own.id)).body.readAt);
  assert.equal((await req(h, "/notifications/" + own.id)).status, 404);
});
test("assignment notifications are hidden and cancelled when current assignment or branch access is revoked", async () => {
  const h = await state();
  await register(h);
  const id = await h.confirmed();
  await h.assign(id);
  await projectOutbox(f.pool, f.config, 100);
  assert.equal((await h.req("/notifications")).body.items.length, 1);
  await f.owner.query(
    "UPDATE order_assignments SET ended_at=now() WHERE order_id=$1",
    [id],
  );
  assert.equal((await h.req("/notifications")).body.items.length, 0);
  const p = new Push();
  await deliverPush(f.pool, f.config, p, 100);
  assert.equal(p.messages.length, 0);
});
test("push registration is app/project scoped, repeated activation preserves pending deliveries and denied permission revokes", async () => {
  const h = await state(),
    r = await register(h);
  const before = (
    await f.owner.query("SELECT version FROM push_tokens WHERE id=$1", [r.id])
  ).rows[0].version;
  ok(
    await f.request(
      "POST",
      "/api/v1/devices/push-tokens",
      {
        token: r.token,
        projectId: projects.courier,
        platform: "android",
        soundEnabled: true,
      },
      h.token,
      "courier",
    ),
  );
  assert.equal(
    (await f.owner.query("SELECT version FROM push_tokens WHERE id=$1", [r.id]))
      .rows[0].version,
    before,
  );
  assert.equal(
    (
      await f.request(
        "POST",
        "/api/v1/devices/push-tokens",
        {
          token: r.token,
          projectId: projects.customer,
          platform: "android",
          soundEnabled: true,
        },
        h.token,
        "courier",
      )
    ).status,
    503,
  );
  ok(await req(h, "/devices/push-tokens", {}, false, "DELETE"));
  assert.equal(
    (await f.owner.query("SELECT active FROM push_tokens WHERE id=$1", [r.id]))
      .rows[0].active,
    false,
  );
});
test("logout invalidates token immediately; a different user cannot steal an active token", async () => {
  const h = await state(),
    r = await register(h);
  const denied = await f.request(
    "POST",
    "/api/v1/devices/push-tokens",
    {
      token: r.token,
      projectId: projects.courier,
      platform: "android",
      soundEnabled: true,
    },
    h.otherToken,
    "courier",
  );
  assert.equal(denied.status, 409);
  assert.equal((await req(h, "/auth/logout", {})).status, 204);
  assert.equal(
    (await f.owner.query("SELECT active FROM push_tokens WHERE id=$1", [r.id]))
      .rows[0].active,
    false,
  );
});
test("tickets require receipt processing and DeviceNotRegistered deactivates exactly the matching token generation", async () => {
  const h = await state(),
    r = await register(h, "customer"),
    c = await campaign(h);
  await schedule(h, c);
  await dispatchCampaigns(f.pool, f.config);
  const p = new Push();
  assert.equal(await deliverPush(f.pool, f.config, p), 1);
  assert.equal(
    (await f.owner.query("SELECT status FROM notification_deliveries")).rows[0]
      .status,
    "sent",
  );
  await due();
  p.receipts = {
    status: "error",
    code: "DeviceNotRegistered",
    retryable: false,
  };
  await deliverPush(f.pool, f.config, p);
  assert.equal(
    (await f.owner.query("SELECT active FROM push_tokens WHERE id=$1", [r.id]))
      .rows[0].active,
    false,
  );
  assert.equal((await customer(h, "/notifications")).body.items.length, 1);
});
test("concurrent push workers claim one lease; expired lease recovers; receipt ok means provider handoff only", async () => {
  const h = await state();
  await register(h, "customer");
  const c = await campaign(h);
  await schedule(h, c);
  await dispatchCampaigns(f.pool, f.config);
  const p = new Push();
  await Promise.all([
    deliverPush(f.pool, f.config, p),
    deliverPush(f.pool, f.config, p),
  ]);
  assert.equal(p.messages.length, 1);
  await f.owner.query(
    "UPDATE notification_deliveries SET locked_until=now()-interval '1 minute',lease_id=$1,next_attempt_at=now()",
    [randomUUID()],
  );
  await deliverPush(f.pool, f.config, p);
  assert.equal(
    (await f.owner.query("SELECT status FROM notification_deliveries")).rows[0]
      .status,
    "delivered",
  );
  assert.equal(p.messages.length, 1);
});
test("transient provider failures retry with backoff and finite budget; denied/revoked tokens do not reach transport", async () => {
  const h = await state();
  await register(h, "customer");
  const c = await campaign(h);
  await schedule(h, c);
  await dispatchCampaigns(f.pool, f.config);
  const p = new Push();
  p.response = { status: "error", code: "TRANSPORT_UNKNOWN", retryable: true };
  for (let n = 0; n < 5; n++) {
    await due();
    await deliverPush(f.pool, f.config, p);
  }
  const d = (await f.owner.query("SELECT * FROM notification_deliveries"))
    .rows[0];
  assert.equal(d.status, "failed");
  assert.equal(d.attempts, 5);
  assert.equal(p.messages.length, 5);
  assert((await customer(h, "/notifications")).body.items.length === 1);
});
test("sound disabled uses silent Android channel and no sound field, without altering inbox", async () => {
  const h = await state(),
    r = await register(h, "customer");
  ok(
    await f.request(
      "POST",
      "/api/v1/devices/push-tokens",
      {
        token: r.token,
        projectId: projects.customer,
        platform: "android",
        soundEnabled: false,
      },
      h.customerToken,
      "customer",
    ),
  );
  const c = await campaign(h);
  await schedule(h, c);
  await dispatchCampaigns(f.pool, f.config);
  const p = new Push();
  await deliverPush(f.pool, f.config, p);
  assert.equal(p.messages[0]?.channelId, "tazweed-silent-v1");
  assert.equal(p.messages[0]?.sound, undefined);
});
test("Expo adapter uses fixed HTTPS, enhanced-security Bearer, safe error codes and transport deadlines", async () => {
  const fake: typeof fetch = async (url, init) => {
    assert.equal(url, "https://exp.host/--/api/v2/push/send");
    assert.equal((init!.headers as any).Authorization, "Bearer test-key");
    assert.equal(init!.redirect, "error");
    return new Response(
      JSON.stringify({ data: { status: "ok", id: "ticket" } }),
      { status: 200 },
    );
  };
  const p = new ExpoPush("test-key", 500, fake);
  assert.deepEqual(
    await p.send({
      to: "ExpoPushToken[test-isolated]",
      title: "ع",
      body: "ن",
      data: {},
    }),
    { status: "ok", id: "ticket" },
  );
  const bad = new ExpoPush(
    "key",
    500,
    async () =>
      new Response(
        JSON.stringify({
          data: {
            status: "error",
            details: { error: "secret-server-message" },
          },
        }),
      ),
  );
  assert.equal(
    ((await bad.send({ to: "x", title: "x", body: "x", data: {} })) as any)
      .code,
    "PROVIDER_REJECTED",
  );
  const timeout = new ExpoPush(
    "key",
    500,
    async (_url, init) =>
      new Promise((_resolve, reject) =>
        init!.signal!.addEventListener("abort", () => reject(Error("private"))),
      ),
  );
  assert.equal(
    ((await timeout.send({ to: "x", title: "x", body: "x", data: {} })) as any)
      .code,
    "TRANSPORT_UNKNOWN",
  );
});
test("runtime grants keep notification contents and all financial originals immutable; readiness stays honest for missing push", async () => {
  await state();
  await assert.rejects(
    f.pool.query("UPDATE notification_inbox SET body_ar='forged'"),
    /permission denied/,
  );
  await assert.rejects(
    f.pool.query("DELETE FROM notification_campaigns"),
    /permission denied/,
  );
  await assert.rejects(
    f.pool.query("UPDATE courier_earnings SET amount_yer=0"),
    /permission denied/,
  );
  const r = await f.request("GET", "/health/ready");
  assert.equal(r.status, 503);
  assert.equal(r.body.push, "unconfigured");
  assert.equal(r.body.runtimeRole, "limited");
});
test("production worker cannot dispatch staging campaigns or consume staging transport jobs", async () => {
  const h = await state();
  await register(h, "customer");
  const c = await campaign(h);
  await schedule(h, c);
  const production = { ...f.config, APP_ENV: "production" as const };
  assert.equal(await dispatchCampaigns(f.pool, production), 0);
  await dispatchCampaigns(f.pool, f.config);
  const p = new Push();
  assert.equal(await deliverPush(f.pool, production, p), 0);
  assert.equal(
    (await f.owner.query("SELECT status FROM notification_deliveries")).rows[0]
      .status,
    "pending",
  );
});
test("late DeviceNotRegistered receipt cannot revoke a newly bound token generation", async () => {
  const h = await state(),
    r = await register(h, "customer"),
    c = await campaign(h);
  await schedule(h, c);
  await dispatchCampaigns(f.pool, f.config);
  const p = new Push();
  await deliverPush(f.pool, f.config, p);
  await f.owner.query("UPDATE push_tokens SET version=version+1 WHERE id=$1", [
    r.id,
  ]);
  await due();
  p.receipts = {
    status: "error",
    code: "DeviceNotRegistered",
    retryable: false,
  };
  await deliverPush(f.pool, f.config, p);
  assert.equal(
    (await f.owner.query("SELECT active FROM push_tokens WHERE id=$1", [r.id]))
      .rows[0].active,
    true,
  );
  assert.equal(
    (await f.owner.query("SELECT error_code FROM notification_deliveries"))
      .rows[0].error_code,
    "TOKEN_OR_SCOPE_REVOKED",
  );
});
test("paged campaign fanout resumes after 200 recipients and concurrency never duplicates messages", async () => {
  const h = await state();
  await f.owner.query(
    "INSERT INTO users(phone_e164,name_ar,password_hash,kind,status,phone_verified_at) SELECT '+96777001'||lpad(i::text,4,'0'),'عميل اختبار دفعة10',$1,'customer','active',now() FROM generate_series(1,205) i",
    [h.customer.password_hash],
  );
  const c = await campaign(h);
  await schedule(h, c);
  await dispatchCampaigns(f.pool, f.config, 1);
  const r = (
    await f.owner.query("SELECT * FROM notification_campaigns WHERE id=$1", [
      c.id,
    ])
  ).rows[0];
  assert.equal(r.status, "sending");
  assert(r.audience_cursor);
  await Promise.all([
    dispatchCampaigns(f.pool, f.config),
    dispatchCampaigns(f.pool, f.config),
  ]);
  assert.equal(
    (
      await f.owner.query(
        "SELECT count(*)::int n FROM notification_inbox WHERE event_key=$1",
        ["campaign:" + c.id],
      )
    ).rows[0].n,
    206,
  );
});
test("failed outbox fanout rolls back customer inbox with staff inbox, persists retry, then recovers once", async () => {
  const h = await state(),
    id = await h.submit();
  await f.owner.query(
    "CREATE FUNCTION isolated_fail_inbox10() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.app='admin' THEN RAISE EXCEPTION 'isolated failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER isolated_fail10 BEFORE INSERT ON notification_inbox FOR EACH ROW EXECUTE FUNCTION isolated_fail_inbox10()",
  );
  try {
    await projectOutbox(f.pool, f.config, 1);
    assert.equal(
      (await f.owner.query("SELECT 1 FROM notification_inbox")).rowCount,
      0,
    );
    const e = (
      await f.owner.query(
        "SELECT state,attempts FROM outbox_events WHERE aggregate_id=$1",
        [id],
      )
    ).rows[0];
    assert.equal(e.state, "pending");
    assert.equal(e.attempts, 1);
  } finally {
    await f.owner.query(
      "DROP TRIGGER isolated_fail10 ON notification_inbox; DROP FUNCTION isolated_fail_inbox10()",
    );
  }
  await f.owner.query("UPDATE outbox_events SET available_at=now()");
  await projectOutbox(f.pool, f.config);
  assert.equal(
    (await f.owner.query("SELECT count(*)::int n FROM notification_inbox"))
      .rows[0].n,
    2,
  );
});
test("revocation while transport is in flight prevents further work, and no token or private provider response reaches logs", async () => {
  const h = await state(),
    r = await register(h, "customer"),
    c = await campaign(h);
  await schedule(h, c);
  await dispatchCampaigns(f.pool, f.config);
  const p: PushProvider = {
    mode: "test",
    async send() {
      await f.owner.query(
        "UPDATE push_tokens SET active=false,version=version+1 WHERE id=$1",
        [r.id],
      );
      return { status: "ok", id: "in-flight" };
    },
    async receipt() {
      throw Error("Must not poll revoked token");
    },
  };
  await deliverPush(f.pool, f.config, p);
  assert.equal(
    (
      await f.owner.query(
        "SELECT status,error_code FROM notification_deliveries",
      )
    ).rows[0].status,
    "failed",
  );
  assert(!JSON.stringify(f.logs).includes(r.token));
});
test("version bounds are independent for all three apps and both native platforms", async () => {
  const h = await state();
  let build = 20;
  for (const app of ["customer", "admin", "courier"])
    for (const platform of ["android", "ios"]) {
      const min = build++;
      ok(
        await req(
          h,
          "/admin/app-releases",
          {
            app,
            platform,
            minimumBuild: min,
            latestBuild: min + 3,
            latestVersion: "2." + min,
            storeUrl:
              platform === "android"
                ? "https://play.google.com/store/apps/details?id=org.isolated." +
                  app
                : "https://apps.apple.com/app/id123456789",
            message: "اختبار عزل النسخة",
            binaryConfirmed: true,
            expectedVersion: 0,
          },
          true,
          "PUT",
        ),
      );
      const r = await f.request(
        "GET",
        `/api/v1/public/config?app=${app}&platform=${platform}&build=${min - 1}`,
      );
      ok(r);
      assert.equal(r.body.release.minimumBuild, min);
      assert.equal(r.body.release.required, true);
    }
});
