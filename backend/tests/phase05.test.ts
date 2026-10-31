import { test, before, after, beforeEach } from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, type Fixture, device, pass } from "./phase05/helpers.js";
import { migrate, migrationsDirectory } from "../src/migrate.js";
import { digest } from "../src/identity/security.js";
import { AuthService } from "../src/identity/auth.js";
import { requirePermission, type Identity } from "../src/identity/access.js";
import { readConfig } from "../src/config.js";
import { createApp } from "../src/app.js";
import { createPool } from "../src/db.js";
import { UnconfiguredOtpProvider } from "../src/identity/provider.js";
let f: Fixture;
before(async () => {
  f = await fixture();
});
after(async () => {
  await f?.close();
});
beforeEach(async () => {
  await f.reset();
});
const route = "/api/v1";
const startRegister = (phone = "770001001", more = {}) =>
  f.request("POST", route + "/auth/register/start", {
    phone,
    name: "عميل اختبار",
    password: pass,
    app: "customer",
    deviceId: device,
    ...more,
  });
const proof = (s: any, more = {}) => ({
  challengeId: s.body.challengeId,
  preauthToken: s.body.preauthToken,
  code: f.provider.code(s.body.challengeId),
  deviceId: device,
  app: "customer",
  ...more,
});
async function branches() {
  const g = (
    await f.owner.query(
      "INSERT INTO governorates(name_ar) VALUES('محافظة اختبار فقط') RETURNING id",
    )
  ).rows[0];
  const rows = [];
  for (const n of ["أ", "ب"])
    rows.push(
      (
        await f.owner.query(
          "INSERT INTO branches(governorate_id,name_ar,latitude,longitude) VALUES($1,$2,15,44) RETURNING id",
          [g.id, n],
        )
      ).rows[0],
    );
  return { gov: g.id, a: rows[0].id, b: rows[1].id };
}
async function admin(
  global = true,
  permissions = ["staff.manage", "audit.read"],
) {
  const u = await f.user("770002001", "staff");
  const role = (
    await f.owner.query(
      "INSERT INTO roles(code,name_ar) VALUES('test_admin','اختبار') RETURNING id",
    )
  ).rows[0];
  for (const p of permissions)
    await f.owner.query(
      "INSERT INTO role_permissions(role_id,permission_code) VALUES($1,$2)",
      [role.id, p],
    );
  const b = await branches();
  const grant = (
    await f.owner.query(
      "INSERT INTO staff_grants(user_id,role_id,branch_id,global_scope) VALUES($1,$2,$3,$4) RETURNING id",
      [u.id, role.id, global ? null : b.a, global],
    )
  ).rows[0];
  return {
    ...(await f.login(u, "admin")),
    ...b,
    roleId: role.id,
    grantId: grant.id,
  };
}
test("migrations retain all 69 tables and guards and reapplication is empty", async () => {
  assert.deepEqual(await migrate(f.ownerUrl), []);
  const rows = (
    await f.owner.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public'",
    )
  ).rows;
  assert.equal(rows.length, 72);
  const ref = await readFile(
    new URL("../database/schema.sql", import.meta.url),
    "utf8",
  );
  const baseline = await readFile(
    new URL("../database/migrations/0001_reference_69.sql", import.meta.url),
    "utf8",
  );
  assert(baseline.includes(ref.replace("BEGIN;\n", "").split("COMMIT;")[0]!));
  const functions = (
    await f.owner.query(
      "SELECT proname FROM pg_proc JOIN pg_namespace n ON n.oid=pronamespace WHERE n.nspname='public'",
    )
  ).rows.map((r) => r.proname);
  assert(functions.includes("guard_private_redaction"));
  assert(functions.includes("guard_protected_reservation"));
});
test("migration checksum tampering and a failing additive migration are rejected atomically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tazweed-migrations-"));
  try {
    await cp(migrationsDirectory, dir, { recursive: true });
    await writeFile(join(dir, "0001_reference_69.sql"), "-- tampered");
    await assert.rejects(migrate(f.ownerUrl, dir), /checksum/);
    await cp(migrationsDirectory, dir, { recursive: true });
    await writeFile(
      join(dir, "0003_test_failure.sql"),
      "CREATE TABLE should_rollback(id integer); SELECT missing_column;",
    );
    await assert.rejects(migrate(f.ownerUrl, dir));
    assert.equal(
      (await f.owner.query("SELECT to_regclass('public.should_rollback') AS t"))
        .rows[0].t,
      null,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("runtime DB role cannot mutate financial ledgers, read private snapshots, redact, or assume privacy role", async () => {
  for (const sql of [
    "UPDATE courier_earnings SET amount_yer=1",
    "DELETE FROM cash_collections",
    "SELECT * FROM order_private_details",
    "UPDATE order_private_details SET address_snapshot='{}'",
    "SET ROLE tazweed_privacy",
    "CREATE TABLE unauthorized(id int)",
  ])
    await assert.rejects(f.pool.query(sql), (e) => (e as any).code === "42501");
  const r = (
    await f.pool.query(
      "SELECT rolname,rolsuper,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user",
    )
  ).rows[0];
  assert.equal(r.rolname, "tazweed_app");
  assert.equal(r.rolsuper, false);
  assert.equal(r.rolcreaterole, false);
  assert.equal(r.rolbypassrls, false);
});
test("NOLOGIN privacy role has only column redaction rights and no financial UPDATE", async () => {
  const r = (
    await f.owner.query(
      `SELECT rolcanlogin,has_table_privilege('tazweed_privacy','courier_earnings','UPDATE') AS financial,has_column_privilege('tazweed_privacy','order_private_details','address_snapshot','UPDATE') AS redact,has_column_privilege('tazweed_privacy','order_private_details','revision','UPDATE') AS revision FROM pg_roles WHERE rolname='tazweed_privacy'`,
    )
  ).rows[0];
  assert.deepEqual(r, {
    rolcanlogin: false,
    financial: false,
    redact: true,
    revision: false,
  });
});
test("registration creates no active account before OTP and stores only keyed/encrypted challenge material", async () => {
  const s = await startRegister();
  assert.equal(s.status, 202);
  assert.equal(
    (await f.owner.query("SELECT count(*)::int n FROM users")).rows[0].n,
    0,
  );
  const r = (await f.owner.query("SELECT * FROM otp_challenges")).rows[0];
  assert.notEqual(r.code_hmac, digest(f.provider.code(r.id)));
  assert(!r.pending_payload_encrypted.includes(pass));
  assert(!s.text.includes(f.provider.code(r.id)));
  assert.equal(r.attempts, 0);
  const v = await f.request("POST", route + "/auth/register/verify", proof(s));
  assert.equal(v.status, 200);
  assert(v.body.accessToken);
  const u = (await f.owner.query("SELECT * FROM users")).rows[0];
  assert.equal(u.status, "active");
  assert.match(u.password_hash, /^\$argon2id\$v=19\$/);
  assert.deepEqual(u.password_hash.split("$")[3].split(",").sort(), [
    "m=65536",
    "p=1",
    "t=3",
  ]);
  assert(u.phone_verified_at);
  const me = await f.request(
    "GET",
    route + "/me",
    undefined,
    v.body.accessToken,
  );
  assert.equal(me.body.id, u.id);
  assert(!me.text.includes("password_hash"));
});
test("public signup rejects staff/admin app and mass assigned identity fields", async () => {
  for (const more of [
    { app: "admin" },
    { kind: "staff" },
    { status: "active" },
    { customerId: randomUUID() },
    { password: "short" },
  ])
    assert.equal((await startRegister("770001001", more)).status, 422);
});
test("OTP is single-use under concurrent independent HTTP connections", async () => {
  const s = await startRegister(),
    p = proof(s);
  const results = await Promise.all([
    f.request("POST", route + "/auth/register/verify", p),
    f.request("POST", route + "/auth/register/verify", p),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
  assert.equal(
    (await f.owner.query("SELECT count(*)::int n FROM sessions")).rows[0].n,
    1,
  );
  assert.equal(
    (await f.owner.query("SELECT count(*)::int n FROM users")).rows[0].n,
    1,
  );
});
test("challenge binding rejects wrong purpose, app, device and preauth without consuming a valid challenge", async () => {
  const s = await startRegister(),
    p = proof(s);
  for (const [path, more] of [
    ["login", {}],
    ["register", { app: "admin" }],
    ["register", { deviceId: device + "x" }],
    ["register", { preauthToken: "x".repeat(43) }],
  ] as const)
    assert.equal(
      (
        await f.request("POST", route + "/auth/" + path + "/verify", {
          ...p,
          ...more,
        })
      ).status,
      401,
    );
  assert.equal(
    (await f.request("POST", route + "/auth/register/verify", p)).status,
    200,
  );
});
test("five wrong OTP attempts commit atomically, block correct code, and cannot be reset by resend", async () => {
  const s = await startRegister(),
    p = proof(s),
    wrong = p.code === "999999" ? "111111" : "999999";
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      f.request("POST", route + "/auth/register/verify", { ...p, code: wrong }),
    ),
  );
  assert(results.every((r) => r.status === 401));
  assert.equal(
    (await f.owner.query("SELECT attempts FROM otp_challenges")).rows[0]
      .attempts,
    5,
  );
  assert.equal(
    (await f.request("POST", route + "/auth/register/verify", p)).status,
    401,
  );
  await f.owner.query(
    "UPDATE otp_challenges SET resend_after=now()-interval '1 second'",
  );
  const { code, ...r } = p;
  assert.equal(
    (await f.request("POST", route + "/auth/otp/resend", r)).status,
    401,
  );
});
test("expired OTP fails; resend enforces cooldown and invalidates previous code while preserving attempts", async () => {
  const s = await startRegister(),
    p = proof(s),
    { code, ...r } = p;
  assert.equal(
    (await f.request("POST", route + "/auth/otp/resend", r)).status,
    429,
  );
  await f.owner.query(
    "UPDATE otp_challenges SET resend_after=now()-interval '1 second',attempts=2",
  );
  assert.equal(
    (await f.request("POST", route + "/auth/otp/resend", r)).status,
    202,
  );
  let latest = f.provider.code(p.challengeId);
  assert.equal(
    (await f.owner.query("SELECT attempts FROM otp_challenges")).rows[0]
      .attempts,
    2,
  );
  // A random new code could equal the previous value; the HMAC generation still changes.
  if (latest !== code)
    assert.equal(
      (await f.request("POST", route + "/auth/register/verify", p)).status,
      401,
    );
  await f.owner.query(
    "UPDATE otp_challenges SET expires_at=now()-interval '1 second'",
  );
  assert.equal(
    (
      await f.request("POST", route + "/auth/register/verify", {
        ...p,
        code: latest,
      })
    ).status,
    401,
  );
});
test("repeated starts enforce phone cooldown even with changed device; duplicate signup stays generic", async () => {
  const s = await startRegister();
  assert.equal(s.status, 202);
  assert.equal(
    (await startRegister("770001001", { deviceId: device + "x" })).status,
    429,
  );
  await f.owner.query(
    "UPDATE otp_challenges SET resend_after=now()-interval '1 second'",
  );
  const next = await startRegister();
  assert.equal(next.status, 202);
  assert.equal(
    (await f.request("POST", route + "/auth/register/verify", proof(s))).status,
    401,
  );
  await f.reset();
  await f.user();
  const duplicate = await startRegister();
  assert.equal(duplicate.status, 202);
  assert.equal(
    (await f.request("POST", route + "/auth/register/verify", proof(duplicate)))
      .status,
    401,
  );
  assert.equal(
    (await f.owner.query("SELECT count(*)::int n FROM users")).rows[0].n,
    1,
  );
});
test("provider failure leaves no active account, session or consumed/new challenge", async () => {
  f.provider.fail = true;
  const s = await startRegister();
  assert.equal(s.status, 503);
  assert.equal(
    (await f.owner.query("SELECT count(*)::int n FROM otp_challenges")).rows[0]
      .n,
    0,
  );
  assert.equal(
    (await f.owner.query("SELECT count(*)::int n FROM users")).rows[0].n,
    0,
  );
});
test("password + OTP is required for customer, internal staff and courier; X-App cannot elevate", async () => {
  for (const [index, kind, app] of [
    [1, "customer", "customer"],
    [2, "staff", "admin"],
    [3, "courier", "courier"],
  ] as const) {
    const u = await f.user(
      "77000300" + index,
      kind,
      kind === "customer" ? "active" : "pending",
    );
    if (kind === "courier")
      await f.owner.query("INSERT INTO courier_profiles(user_id) VALUES($1)", [
        u.id,
      ]);
    const t = await f.login(u, app);
    assert.equal(
      (await f.request("GET", route + "/me", undefined, t.accessToken, app))
        .status,
      200,
    );
    assert.equal(
      (
        await f.request(
          "GET",
          route + "/me",
          undefined,
          t.accessToken,
          app === "admin" ? "customer" : "admin",
          { "X-App": "admin" },
        )
      ).status,
      401,
    );
    assert.equal(
      (await f.owner.query("SELECT status FROM users WHERE id=$1", [u.id]))
        .rows[0].status,
      "active",
    );
  }
});
test("unknown account, wrong password, disabled user and wrong app share login failure", async () => {
  const u = await f.user();
  const responses = [];
  for (const v of [
    { phone: "770009999", password: pass, app: "customer" },
    { phone: "770001001", password: pass + "bad", app: "customer" },
    { phone: "770001001", password: pass, app: "admin" },
  ])
    responses.push(
      await f.request("POST", route + "/auth/login/start", {
        ...v,
        deviceId: device,
      }),
    );
  await f.owner.query("UPDATE users SET status='disabled' WHERE id=$1", [u.id]);
  responses.push(
    await f.request("POST", route + "/auth/login/start", {
      phone: "770001001",
      password: pass,
      app: "customer",
      deviceId: device,
    }),
  );
  assert(
    responses.every(
      (r) => r.status === 401 && r.body.error.code === "AUTH_FAILED",
    ),
  );
  assert.equal(f.provider.messages.length, 0);
});
test("refresh rotates hashed tokens without OTP; replay revokes the entire family immediately", async () => {
  const t = await f.login(await f.user());
  const before = f.provider.messages.length;
  const next = await f.request("POST", route + "/auth/refresh", {
    app: "customer",
    deviceId: device,
    refreshToken: t.refreshToken,
  });
  assert.equal(next.status, 200);
  assert.notEqual(next.body.refreshToken, t.refreshToken);
  assert.equal(f.provider.messages.length, before);
  const stored = (
    await f.owner.query("SELECT refresh_token_hash FROM sessions")
  ).rows[0].refresh_token_hash;
  assert.equal(stored, digest(next.body.refreshToken));
  assert(
    !JSON.stringify(
      (await f.owner.query("SELECT * FROM session_refresh_tokens")).rows,
    ).includes(t.refreshToken),
  );
  assert.equal(
    (
      await f.request("POST", route + "/auth/refresh", {
        app: "customer",
        deviceId: device,
        refreshToken: t.refreshToken,
      })
    ).status,
    401,
  );
  assert.equal(
    (await f.request("GET", route + "/me", undefined, next.body.accessToken))
      .status,
    401,
  );
});
test("parallel refresh permits one rotation then detects reuse and revokes that family", async () => {
  const t = await f.login(await f.user());
  const p = { app: "customer", deviceId: device, refreshToken: t.refreshToken };
  const results = await Promise.all([
    f.request("POST", route + "/auth/refresh", p),
    f.request("POST", route + "/auth/refresh", p),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
  assert.equal(
    (
      await f.request(
        "GET",
        route + "/me",
        undefined,
        results.find((r) => r.status === 200)!.body.accessToken,
      )
    ).status,
    401,
  );
});
test("wrong refresh app/device cannot steal or revoke the valid family", async () => {
  const t = await f.login(await f.user());
  for (const more of [{ app: "admin" }, { deviceId: device + "bad" }])
    assert.equal(
      (
        await f.request("POST", route + "/auth/refresh", {
          app: "customer",
          deviceId: device,
          refreshToken: t.refreshToken,
          ...more,
        })
      ).status,
      401,
    );
  assert.equal(
    (await f.request("GET", route + "/me", undefined, t.accessToken)).status,
    200,
  );
});
test("logout invalidates access and refresh; token tampering and unsigned JWT fail", async () => {
  const t = await f.login(await f.user());
  for (const token of [
    t.accessToken.slice(0, -10) + "AAAAAAAAAA",
    "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.",
  ])
    assert.equal(
      (await f.request("GET", route + "/me", undefined, token)).status,
      401,
    );
  assert.equal(
    (await f.request("POST", route + "/auth/logout", {}, t.accessToken)).status,
    204,
  );
  assert.equal(
    (await f.request("GET", route + "/me", undefined, t.accessToken)).status,
    401,
  );
  assert.equal(
    (
      await f.request("POST", route + "/auth/refresh", {
        app: "customer",
        deviceId: device,
        refreshToken: t.refreshToken,
      })
    ).status,
    401,
  );
});
test("password reset has its own purpose, revokes all sessions and outstanding challenges, and requires login again", async () => {
  const u = await f.user(),
    t = await f.login(u),
    newPassword = "Changed-Password-05!";
  const s = await f.request("POST", route + "/auth/password-reset/start", {
    phone: u.phone_e164,
    app: "customer",
    deviceId: device,
  });
  assert.equal(s.status, 202);
  assert.equal(
    (await f.request("POST", route + "/auth/login/verify", proof(s))).status,
    401,
  );
  const v = await f.request("POST", route + "/auth/password-reset/verify", {
    ...proof(s),
    newPassword,
  });
  assert.deepEqual(v.body, { passwordReset: true });
  assert.equal(
    (await f.request("GET", route + "/me", undefined, t.accessToken)).status,
    401,
  );
  assert.equal(
    (
      await f.request("POST", route + "/auth/login/start", {
        phone: u.phone_e164,
        password: pass,
        app: "customer",
        deviceId: device,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await f.request("POST", route + "/auth/login/start", {
        phone: u.phone_e164,
        password: newPassword,
        app: "customer",
        deviceId: device,
      })
    ).status,
    202,
  );
});
test("unknown password reset has the same accepted shape and cannot create an account", async () => {
  const s = await f.request("POST", route + "/auth/password-reset/start", {
    phone: "770001099",
    app: "customer",
    deviceId: device,
  });
  assert.equal(s.status, 202);
  assert.equal(
    (
      await f.request("POST", route + "/auth/password-reset/verify", {
        ...proof(s),
        newPassword: pass + "2",
      })
    ).status,
    401,
  );
  assert.equal(
    (await f.owner.query("SELECT count(*)::int n FROM users")).rows[0].n,
    0,
  );
});
test("profile and addresses enforce ownership and reject mass assignment; concurrent defaults serialize", async () => {
  const b = await branches(),
    t = await f.login(await f.user()),
    other = await f.login(await f.user("770001002"), undefined, device + "2");
  assert.equal(
    (
      await f.request(
        "PATCH",
        route + "/me",
        { name: "اسم معدل", kind: "staff" },
        t.accessToken,
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await f.request(
        "PATCH",
        route + "/me",
        { name: "اسم معدل" },
        t.accessToken,
      )
    ).status,
    200,
  );
  const address = {
    governorateId: b.gov,
    label: "اختبار",
    latitude: 15,
    longitude: 44,
    isDefault: true,
  };
  const made = await f.request(
    "POST",
    route + "/me/addresses",
    address,
    t.accessToken,
  );
  assert.equal(made.status, 201);
  for (const method of ["PATCH", "DELETE"])
    assert.equal(
      (
        await f.request(
          method,
          route + "/me/addresses/" + made.body.id,
          method === "PATCH" ? address : undefined,
          other.accessToken,
        )
      ).status,
      404,
    );
  assert.equal(
    (
      await f.request(
        "GET",
        route + "/me/addresses",
        undefined,
        other.accessToken,
      )
    ).body.items.length,
    0,
  );
  const results = await Promise.all([
    f.request("POST", route + "/me/addresses", address, t.accessToken),
    f.request("POST", route + "/me/addresses", address, t.accessToken),
  ]);
  assert(results.every((r) => r.status === 201));
  assert.equal(
    (
      await f.owner.query(
        "SELECT count(*)::int n FROM addresses WHERE is_default",
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await f.request(
        "DELETE",
        route + "/me/addresses/" + made.body.id,
        undefined,
        t.accessToken,
      )
    ).status,
    204,
  );
});
test("branch-scoped staff cannot read another branch, list global roles, provision accounts, or self-escalate", async () => {
  const a = await admin(false);
  assert.equal(
    (
      await f.request(
        "GET",
        route + "/admin/staff?branchId=" + a.a,
        undefined,
        a.accessToken,
        "admin",
      )
    ).status,
    200,
  );
  for (const path of [
    "/admin/staff?branchId=" + a.b,
    "/admin/staff",
    "/admin/roles",
    "/admin/permissions",
  ])
    assert.equal(
      (await f.request("GET", route + path, undefined, a.accessToken, "admin"))
        .status,
      403,
    );
  assert.equal(
    (
      await f.request(
        "POST",
        route + "/admin/staff",
        {
          phone: "770004001",
          password: pass,
          name: "موظف اختبار",
          kind: "staff",
        },
        a.accessToken,
        "admin",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request(
        "POST",
        route + "/admin/staff/" + a.user.id + "/grants",
        { roleId: a.roleId, branchId: null },
        a.accessToken,
        "admin",
      )
    ).status,
    403,
  );
  const scope = await f.request(
    "GET",
    route + "/admin/access/branches?permission=staff.manage",
    undefined,
    a.accessToken,
    "admin",
  );
  assert.deepEqual(
    scope.body.items.map((x: any) => x.id),
    [a.a],
  );
});
test("cross-branch action guard requires every source/destination branch and the exact permission", async () => {
  const a = await admin(false, ["inventory.transfer"]);
  const i = { id: a.user.id, kind: "staff", app: "admin" } as Identity;
  await requirePermission(f.pool, i, "inventory.transfer", [a.a]);
  await assert.rejects(
    requirePermission(f.pool, i, "inventory.transfer", [a.a, a.b]),
  );
  await assert.rejects(requirePermission(f.pool, i, "inventory.adjust", [a.a]));
  await assert.rejects(
    requirePermission(f.pool, i, "inventory.transfer", null),
  );
});
test("role CRUD and grants work internally; live permission changes apply to an existing access token", async () => {
  const a = await admin();
  const r = await f.request(
    "POST",
    route + "/admin/roles",
    { code: "reviewer", name: "مراجع اختبار", permissions: ["reports.read"] },
    a.accessToken,
    "admin",
  );
  assert.equal(r.status, 201);
  assert.equal(
    (
      await f.request(
        "POST",
        route + "/admin/roles",
        {
          code: "bad_role",
          name: "دور اختبار",
          permissions: ["invented.superuser"],
        },
        a.accessToken,
        "admin",
      )
    ).status,
    422,
  );
  const s = await f.request(
    "POST",
    route + "/admin/staff",
    { phone: "770004001", password: pass, name: "موظف جديد", kind: "staff" },
    a.accessToken,
    "admin",
  );
  assert.equal(s.status, 201);
  assert.equal(s.body.status, "pending");
  const g = await f.request(
    "POST",
    route + "/admin/staff/" + s.body.id + "/grants",
    { roleId: r.body.id, branchId: a.a },
    a.accessToken,
    "admin",
  );
  assert.equal(g.status, 201);
  const t = await f.login(
    (await f.owner.query("SELECT * FROM users WHERE id=$1", [s.body.id]))
      .rows[0],
    "admin",
    device + "staff",
  );
  assert.equal(
    (
      await f.request(
        "GET",
        route + "/admin/audit",
        undefined,
        t.accessToken,
        "admin",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request(
        "PUT",
        route + "/admin/roles/" + r.body.id,
        { code: "reviewer", name: "مراجع اختبار", permissions: ["audit.read"] },
        a.accessToken,
        "admin",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await f.request(
        "GET",
        route + "/admin/audit?branchId=" + a.a,
        undefined,
        t.accessToken,
        "admin",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await f.request(
        "DELETE",
        route + "/admin/roles/" + r.body.id,
        undefined,
        a.accessToken,
        "admin",
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await f.request(
        "DELETE",
        route + "/admin/staff/" + s.body.id + "/grants/" + g.body.id,
        undefined,
        a.accessToken,
        "admin",
      )
    ).status,
    204,
  );
  assert.equal(
    (
      await f.request(
        "GET",
        route + "/admin/audit",
        undefined,
        t.accessToken,
        "admin",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request(
        "DELETE",
        route + "/admin/roles/" + r.body.id,
        undefined,
        a.accessToken,
        "admin",
      )
    ).status,
    204,
  );
});
test("disabling staff revokes access/refresh/challenges and customer tokens never authorize admin routes", async () => {
  const a = await admin(),
    u = await f.user("770004003", "staff"),
    t = await f.login(u, "admin", device + "staff");
  assert.equal(
    (
      await f.request(
        "PATCH",
        route + "/admin/staff/" + u.id + "/status",
        { status: "disabled" },
        a.accessToken,
        "admin",
      )
    ).status,
    204,
  );
  assert.equal(
    (await f.request("GET", route + "/me", undefined, t.accessToken, "admin"))
      .status,
    401,
  );
  assert.equal(
    (
      await f.request("POST", route + "/auth/refresh", {
        app: "admin",
        deviceId: device + "staff",
        refreshToken: t.refreshToken,
      })
    ).status,
    401,
  );
  const customer = await f.login(await f.user());
  assert.equal(
    (
      await f.request(
        "GET",
        route + "/admin/staff",
        undefined,
        customer.accessToken,
        "customer",
      )
    ).status,
    403,
  );
});
test("audit is immutable, branch-filtered including null/global events, and contains no identity secrets", async () => {
  const a = await admin(false);
  for (const branchId of [a.a, a.b, null])
    await f.owner.query(
      "INSERT INTO audit_logs(action,entity_type,branch_id,request_id) VALUES('test.audit','test',$1,'test-only')",
      [branchId],
    );
  const r = await f.request(
    "GET",
    route + "/admin/audit",
    undefined,
    a.accessToken,
    "admin",
  );
  assert.equal(r.status, 200);
  assert(r.body.items.every((v: any) => v.branch_id === a.a));
  assert.equal(r.body.items.length, 1);
  assert.equal(
    (
      await f.request(
        "GET",
        route + "/admin/audit?branchId=" + a.b,
        undefined,
        a.accessToken,
        "admin",
      )
    ).status,
    403,
  );
  await assert.rejects(
    f.pool.query("UPDATE audit_logs SET action='tamper'"),
    (e) => (e as any).code === "42501",
  );
  await assert.rejects(
    f.owner.query("DELETE FROM audit_logs"),
    (e) => (e as any).code === "P0001",
  );
  const serialized =
    JSON.stringify((await f.owner.query("SELECT * FROM audit_logs")).rows) +
    JSON.stringify(f.logs);
  for (const value of [
    pass,
    a.accessToken,
    a.refreshToken,
    f.provider.messages[0]!.code,
    a.user.phone_e164,
  ])
    assert(!serialized.includes(value));
});
test("rate limits persist in PostgreSQL; spoofed forwarding headers cannot bypass IP limits", async () => {
  const u = await f.user();
  for (let i = 0; i < 11; i++) {
    const r = await f.request(
      "POST",
      route + "/auth/login/start",
      {
        phone: u.phone_e164,
        password: pass + "bad",
        app: "customer",
        deviceId: device + i,
      },
      undefined,
      "customer",
      { "X-Forwarded-For": `203.0.113.${i + 1}` },
    );
    if (i === 10) assert.equal(r.status, 429);
  }
  const db = (
    await f.owner.query("SELECT bucket_key,hits FROM auth_rate_buckets")
  ).rows;
  assert(
    db.some(
      (x) =>
        x.bucket_key === f.security.hmac("rate", "start", "ip", "127.0.0.1") &&
        x.hits === 11,
    ),
  );
  assert(!JSON.stringify(db).includes(u.phone_e164));
});
test("Helmet, exact CORS, JSON/body validation and request IDs remain safe; no phase06 endpoints", async () => {
  const live = await f.request("GET", "/health/live");
  assert.equal(live.status, 200);
  assert.equal(live.body.phase, "05");
  assert(live.headers.get("content-security-policy"));
  assert.equal(live.headers.get("x-powered-by"), null);
  assert.equal(live.headers.get("cache-control"), "no-store");
  assert.equal(
    (
      await f.request("GET", "/health/live", undefined, undefined, undefined, {
        Origin: "https://hostile.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request("GET", "/health/live", undefined, undefined, undefined, {
        Origin: "https://test.example",
      })
    ).headers.get("access-control-allow-origin"),
    "https://test.example",
  );
  const invalid = await fetch(f.origin + route + "/auth/login/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{oops",
  });
  assert.equal(invalid.status, 400);
  assert.equal(
    (await startRegister("770001001", { name: "x".repeat(20000) })).status,
    413,
  );
  assert.equal((await f.request("GET", route + "/catalog")).status, 404);
});
test("readiness checks real DB role and OTP independently; an unconfigured provider cannot issue OTP", async () => {
  const ready = await f.request("GET", "/health/ready");
  assert.equal(ready.status, 200);
  assert.equal(ready.body.database, "connected");
  assert.equal(ready.body.runtimeRole, "limited");
  const auth = new AuthService(
    f.pool,
    f.security,
    new UnconfiguredOtpProvider(),
  );
  await assert.rejects(
    auth.start(
      "register",
      {
        app: "customer",
        phone: "+967770009991",
        password: pass,
        name: "اختبار",
        deviceId: device,
      },
      { requestId: randomUUID(), ip: "127.0.0.1" },
    ),
    (e) => (e as any).code === "OTP_UNAVAILABLE",
  );
  assert.throws(
    () =>
      createApp({
        pool: f.pool,
        security: f.security,
        provider: f.provider,
        config: { ...f.config, NODE_ENV: "development" },
      }),
    /Test OTP/,
  );
  assert.throws(
    () =>
      readConfig({
        ...process.env,
        NODE_ENV: "production",
        APP_ENV: "production",
        DATABASE_URL: f.config.DATABASE_URL,
        JWT_PRIVATE_KEY: f.config.JWT_PRIVATE_KEY,
        JWT_PUBLIC_KEY: f.config.JWT_PUBLIC_KEY,
        OTP_HMAC_SECRET: f.config.OTP_HMAC_SECRET,
        OTP_PROVIDER: "UNCONFIGURED",
        PUBLIC_BASE_URL: "https://backend.example",
        CORS_ALLOWED_ORIGINS: "https://web.example",
      }),
    /Production/,
  );
});
test("OpenAPI exposes the implemented subset with strict inputs and no code/debug backdoor", async () => {
  const r = await f.request("GET", route + "/openapi.json");
  assert.equal(r.status, 200);
  assert.equal(r.body.openapi, "3.1.0");
  assert(
    r.body.paths[route + "/auth/register/start"].post.requestBody.content[
      "application/json"
    ].schema.additionalProperties === false,
  );
  assert(!Object.keys(r.body.paths).some((p) => p.includes("catalog")));
  assert.equal((await f.request("GET", route + "/auth/debug-otp")).status, 404);
});
test("every protected sub-route rejects missing identity before any read or mutation", async () => {
  for (const [method, path, body] of [
    ["GET", "/me/addresses", undefined],
    ["POST", "/me/addresses", {}],
    ["GET", "/admin/roles", undefined],
    ["POST", "/admin/staff", {}],
    ["GET", "/admin/audit", undefined],
    ["GET", "/admin/staff/" + randomUUID() + "/grants", undefined],
  ] as const)
    assert.equal((await f.request(method, route + path, body)).status, 401);
});
test("last general admin grant and role cannot be removed or disabled by another manager", async () => {
  const a = await admin(),
    u = await f.user("770008888", "staff"),
    role = (
      await f.owner.query("SELECT id FROM roles WHERE code='general_admin'")
    ).rows[0],
    g = (
      await f.owner.query(
        "INSERT INTO staff_grants(user_id,role_id,global_scope) VALUES($1,$2,true) RETURNING id",
        [u.id, role.id],
      )
    ).rows[0];
  assert.equal(
    (
      await f.request(
        "DELETE",
        route + "/admin/staff/" + u.id + "/grants/" + g.id,
        undefined,
        a.accessToken,
        "admin",
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await f.request(
        "PATCH",
        route + "/admin/staff/" + u.id + "/status",
        { status: "disabled" },
        a.accessToken,
        "admin",
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await f.request(
        "PUT",
        route + "/admin/roles/" + role.id,
        {
          code: "general_admin",
          name: "تغيير ممنوع",
          permissions: ["audit.read"],
        },
        a.accessToken,
        "admin",
      )
    ).status,
    409,
  );
  const local = await f.request(
    "GET",
    route + "/admin/staff/" + a.user.id + "/grants",
    undefined,
    a.accessToken,
    "admin",
  );
  assert.equal(local.status, 200);
  assert.equal(local.body.items.length, 1);
});
test("readiness fails closed for unconfigured OTP, unavailable DB and unsafe migration owner", async () => {
  const servers = [];
  const unavailable = createPool(
    f.config.DATABASE_URL.replace(":55432/", ":9/"),
  );
  try {
    for (const [pool, provider, expected] of [
      [f.pool, new UnconfiguredOtpProvider(), "unconfigured"],
      [f.owner, f.provider, "test"],
      [unavailable, f.provider, "test"],
    ] as const) {
      const s = createApp({
        config: f.config,
        pool,
        security: f.security,
        provider,
      }).listen(0, "127.0.0.1");
      servers.push(s);
      await new Promise<void>((resolve) => s.once("listening", resolve));
      const addr = s.address();
      assert(addr && typeof addr !== "string");
      const r = await fetch(`http://127.0.0.1:${addr.port}/health/ready`);
      assert.equal(r.status, 503);
      const b = await r.json();
      assert.equal(b.otp, expected);
      if (pool === f.owner)
        assert.equal(b.runtimeRole, "unsafe-or-unavailable");
    }
  } finally {
    await Promise.all(
      servers.map(
        (s) => new Promise<void>((resolve) => s.close(() => resolve())),
      ),
    );
    await unavailable.end();
  }
});
test("failed resend preserves the old OTP and pending registration instead of reporting delivery success", async () => {
  const s = await startRegister(),
    p = proof(s),
    { code, ...r } = p;
  await f.owner.query(
    "UPDATE otp_challenges SET resend_after=now()-interval '1 second'",
  );
  f.provider.fail = true;
  assert.equal(
    (await f.request("POST", route + "/auth/otp/resend", r)).status,
    503,
  );
  f.provider.fail = false;
  assert.equal(
    (await f.request("POST", route + "/auth/register/verify", p)).status,
    200,
  );
});
test("deleted identities, revoked sessions and expired refresh families reject access", async () => {
  const t = await f.login(await f.user());
  await f.owner.query(
    "UPDATE sessions SET expires_at=now()-interval '1 second'",
  );
  assert.equal(
    (await f.request("GET", route + "/me", undefined, t.accessToken)).status,
    401,
  );
  assert.equal(
    (
      await f.request("POST", route + "/auth/refresh", {
        app: "customer",
        deviceId: device,
        refreshToken: t.refreshToken,
      })
    ).status,
    401,
  );
  await f.owner.query("UPDATE sessions SET expires_at=now()+interval '1 day'");
  await f.owner.query(
    "UPDATE users SET status='deleted',deleted_at=now(),phone_e164=NULL,password_hash=NULL",
  );
  assert.equal(
    (await f.request("GET", route + "/me", undefined, t.accessToken)).status,
    401,
  );
});
test("grant provisioning removes stale column-level privacy privileges as well as table privileges", async () => {
  await f.owner.query(
    "GRANT UPDATE(revision) ON order_private_details TO tazweed_privacy",
  );
  await f.owner.query(
    await readFile(
      new URL("../database/runtime-grants.sql", import.meta.url),
      "utf8",
    ),
  );
  const r = (
    await f.owner.query(
      "SELECT has_column_privilege('tazweed_privacy','order_private_details','revision','UPDATE') AS revision,has_column_privilege('tazweed_privacy','order_private_details','address_snapshot','UPDATE') AS redact",
    )
  ).rows[0];
  assert.deepEqual(r, { revision: false, redact: true });
});
test("environment rejects wildcard CORS and accepts an empty unused gateway URL without enabling a provider", () => {
  const base = {
    NODE_ENV: "test",
    APP_ENV: "test",
    DATABASE_URL: f.config.DATABASE_URL,
    JWT_PRIVATE_KEY: f.config.JWT_PRIVATE_KEY,
    JWT_PUBLIC_KEY: f.config.JWT_PUBLIC_KEY,
    OTP_HMAC_SECRET: f.config.OTP_HMAC_SECRET,
    OTP_PROVIDER: "UNCONFIGURED",
  };
  assert.throws(
    () => readConfig({ ...base, CORS_ALLOWED_ORIGINS: "https://*.example" }),
    /CORS/,
  );
  assert.equal(
    readConfig({ ...base, OTP_PROVIDER_URL: "" }).OTP_PROVIDER,
    "UNCONFIGURED",
  );
});
test("address PATCH changes only supplied fields and rejects an empty patch or forged owner", async () => {
  const b = await branches(),
    t = await f.login(await f.user());
  const made = await f.request(
    "POST",
    route + "/me/addresses",
    {
      governorateId: b.gov,
      label: "عنوان أول",
      latitude: 15,
      longitude: 44,
      isDefault: true,
    },
    t.accessToken,
  );
  assert.equal(made.status, 201);
  assert.equal(
    (
      await f.request(
        "PATCH",
        route + "/me/addresses/" + made.body.id,
        { label: "عنوان معدل" },
        t.accessToken,
      )
    ).status,
    200,
  );
  const address = (
    await f.request("GET", route + "/me/addresses", undefined, t.accessToken)
  ).body.items[0];
  assert.equal(address.label, "عنوان معدل");
  assert.equal(address.latitude, 15);
  assert.equal(address.is_default, true);
  for (const patch of [{}, { userId: randomUUID() }])
    assert.equal(
      (
        await f.request(
          "PATCH",
          route + "/me/addresses/" + made.body.id,
          patch,
          t.accessToken,
        )
      ).status,
      422,
    );
});

test("real HTTP responses exercised by the suite conform to the published OpenAPI schemas", () => {
  assert(f.contracts.checked > 100);
});

async function operatorCommand(
  file: string,
  extra: Record<string, string> = {},
) {
  return new Promise<{ status: number | null; output: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", file], {
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        env: { ...process.env, MIGRATION_DATABASE_URL: f.ownerUrl, ...extra },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (b) => (output += b.toString()));
      child.stderr.on("data", (b) => (output += b.toString()));
      child.once("error", reject);
      child.once("exit", (status) => resolve({ status, output }));
    },
  );
}
test("explicit bootstrap provisions one pending general admin without a default password or bypassing OTP", async () => {
  const input = {
    BOOTSTRAP_PHONE: "770005555",
    BOOTSTRAP_NAME: "مدير اختبار أمر داخلي",
    BOOTSTRAP_PASSWORD: pass,
  };
  const r = await operatorCommand("src/bootstrap.ts", input);
  assert.equal(r.status, 0);
  assert(!r.output.includes(pass));
  assert(!r.output.includes(input.BOOTSTRAP_PHONE));
  const info = JSON.parse(r.output),
    u = (await f.owner.query("SELECT * FROM users WHERE id=$1", [info.userId]))
      .rows[0];
  assert.equal(u.status, "pending");
  assert.equal(
    (await f.owner.query("SELECT count(*)::int AS n FROM sessions")).rows[0].n,
    0,
  );
  assert.equal((await operatorCommand("src/bootstrap.ts", input)).status, 1);
  const t = await f.login(u, "admin");
  assert.equal(
    (
      await f.request(
        "GET",
        route + "/admin/roles",
        undefined,
        t.accessToken,
        "admin",
      )
    ).status,
    200,
  );
});
test("operator auth housekeeping clears expired secrets and rate buckets while retaining audit and identities", async () => {
  const s = await startRegister();
  await f.owner.query(
    "UPDATE otp_challenges SET expires_at=now()-interval '1 second'",
  );
  await f.owner.query(
    "UPDATE auth_rate_buckets SET expires_at=now()-interval '1 second'",
  );
  const audits = (await f.owner.query("SELECT count(*)::int n FROM audit_logs"))
    .rows[0].n;
  const r = await operatorCommand("src/prune-auth.ts");
  assert.equal(r.status, 0);
  assert(!r.output.includes(f.provider.code(s.body.challengeId)));
  assert.equal(JSON.parse(r.output).expiredPendingPayloadsCleared, 1);
  assert.equal(
    (
      await f.owner.query(
        "SELECT pending_payload_encrypted FROM otp_challenges",
      )
    ).rows[0].pending_payload_encrypted,
    null,
  );
  assert.equal(
    (await f.owner.query("SELECT count(*)::int n FROM audit_logs")).rows[0].n,
    audits,
  );
  assert.equal(
    (await f.owner.query("SELECT count(*)::int n FROM auth_rate_buckets"))
      .rows[0].n,
    0,
  );
});
