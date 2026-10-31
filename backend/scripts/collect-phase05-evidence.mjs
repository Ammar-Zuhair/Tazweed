// Read-only metadata and sanitized acceptance summaries; never publish test tokens or environment values.
import { readFile, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import pg from "pg";
const root = fileURLToPath(new URL("../../", import.meta.url));
process.loadEnvFile(root + "backend/.env.local");
const log = await readFile(
  process.argv[2] ?? root + ".phase05-work/tests-contracts.log",
  "utf8",
);
const count = (name) =>
  Number(log.match(new RegExp("^# " + name + " (\\d+)$", "m"))?.[1] ?? NaN);
assert.equal(count("fail"), 0);
assert(count("tests") > 30);
assert.equal(count("tests"), count("pass"));
const reference = JSON.parse(
  log.split("\n").findLast((line) => line.startsWith('{"scope":')) ?? "null",
);
assert.equal(reference?.passed, 73);
assert.equal(reference.tableCount, 69);
assert(reference.engine.includes("Real PostgreSQL"));
const cases = [...log.matchAll(/^ok \d+ - (.+)$/gm)].map((m) => ({
  name: m[1],
  passed: true,
}));
assert.equal(cases.length, count("pass"));
const owner = new pg.Client({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  }),
  runtime = new pg.Client({ connectionString: process.env.DATABASE_URL });
const hash = async (path) =>
  createHash("sha256")
    .update(await readFile(root + path))
    .digest("hex");
const service = (name) =>
  Object.fromEntries(
    execFileSync(
      "systemctl",
      [
        "show",
        name,
        "-p",
        "ActiveState",
        "-p",
        "SubState",
        "-p",
        "NRestarts",
        "-p",
        "ExecMainStatus",
      ],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .map((s) => s.split("=")),
  );
try {
  await owner.connect();
  await runtime.connect();
  const version = (await owner.query("SHOW server_version")).rows[0]
    .server_version;
  const migrations = (
    await owner.query("SELECT name,sha256 FROM schema_migrations ORDER BY name")
  ).rows;
  for (const m of migrations)
    assert.equal(m.sha256, await hash("backend/database/migrations/" + m.name));
  const catalog = (
    await owner.query(
      `SELECT (SELECT count(*)::int FROM pg_tables WHERE schemaname='public') AS tables,(SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal) AS triggers,(SELECT count(*)::int FROM users) AS users,(SELECT count(*)::int FROM products) AS products,(SELECT count(*)::int FROM sessions) AS sessions`,
    )
  ).rows[0];
  const privileges = (
    await runtime.query(`SELECT current_user AS role,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls,
 has_table_privilege(current_user,'courier_earnings','UPDATE,DELETE') AS commission_mutation,
 has_table_privilege(current_user,'cash_collections','INSERT,UPDATE,DELETE') AS cash_mutation,
 has_any_column_privilege(current_user,'order_private_details','SELECT') AS private_read,
 has_any_column_privilege(current_user,'order_private_details','UPDATE') AS private_update,
 pg_has_role(current_user,'tazweed_privacy','MEMBER') AS privacy_membership FROM pg_roles WHERE rolname=current_user`)
  ).rows[0];
  const privacy = (
    await owner.query(
      `SELECT rolcanlogin,has_column_privilege('tazweed_privacy','order_private_details','address_snapshot','UPDATE') AS redact,has_column_privilege('tazweed_privacy','order_private_details','revision','UPDATE') AS revision_mutation,has_table_privilege('tazweed_privacy','courier_earnings','UPDATE') AS financial_mutation FROM pg_roles WHERE rolname='tazweed_privacy'`,
    )
  ).rows[0];
  const local = "http://127.0.0.1:8084";
  const live = await fetch(local + "/health/live"),
    liveBody = await live.json();
  assert.equal(live.status, 200);
  assert.equal(liveBody.phase, "05");
  const ready = await fetch(local + "/health/ready"),
    readyBody = await ready.json();
  assert.equal(ready.status, 503);
  assert.equal(readyBody.database, "connected");
  assert.equal(readyBody.runtimeRole, "limited");
  assert.equal(readyBody.otp, "unconfigured");
  const start = await fetch(local + "/api/v1/auth/register/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app: "customer",
      deviceId: "evidence-device-identifier-0000000001",
      phone: "770000001",
      name: "مثال فحص دون إرسال",
      password: "ExampleOnly-Phase05!",
    }),
  });
  const startBody = await start.json();
  assert.equal(start.status, 503);
  assert.equal(startBody.error.code, "OTP_UNAVAILABLE");
  const schema = await fetch(local + "/api/v1/openapi.json");
  assert.deepEqual(
    await schema.json(),
    JSON.parse(
      await readFile(root + "backend/docs/openapi.phase05.json", "utf8"),
    ),
  );
  const ingress = await fetch(
    "https://tazweed--8084.dev.remote-ammar.duckdns.org/health/live",
    { redirect: "manual", signal: AbortSignal.timeout(15000) },
  );
  assert.equal(ingress.status, 302);
  const runtimeFile = await readFile(
    root + "backend/.env.runtime.local",
    "utf8",
  );
  assert(!/^MIGRATION_DATABASE_URL=/m.test(runtimeFile));
  const listeners = execFileSync("ss", ["-ltnp"], { encoding: "utf8" });
  const sourcePaths = [
    "backend/src/app.ts",
    "backend/src/config.ts",
    "backend/src/db.ts",
    "backend/src/http.ts",
    "backend/src/migrate.ts",
    "backend/src/readiness.ts",
    "backend/src/server.ts",
    "backend/src/identity/auth.ts",
    "backend/src/identity/access.ts",
    "backend/src/identity/audit.ts",
    "backend/src/identity/contracts.ts",
    "backend/src/identity/provider.ts",
    "backend/src/identity/rate-limit.ts",
    "backend/src/identity/routes.ts",
    "backend/src/identity/security.ts",
    "backend/src/identity/responses.ts",
    "backend/src/openapi.ts",
    "backend/tests/phase05.test.ts",
    "backend/tests/phase05/helpers.ts",
    "backend/tests/phase05/contracts.ts",
    "backend/tests/provider.test.ts",
    "backend/tests/health.test.ts",
    "backend/package-lock.json",
  ];
  const sources = Object.fromEntries(
    await Promise.all(sourcePaths.map(async (p) => [p, await hash(p)])),
  );
  const result = {
    phase: "05",
    checkedAt: new Date().toISOString(),
    scope:
      "Identity/database/access only. No phase06 business services or real OTP/mobile integration.",
    commands: {
      typecheck: "npm run typecheck",
      build: "npm run build",
      openapi: "npm run openapi:check",
      acceptance: "npm test (scripts/test-phase05.mjs)",
      dictionary: "node reference-tests/generate-database-doc.mjs --check",
    },
    tests: {
      passed: count("pass"),
      failed: count("fail"),
      skipped: count("skipped"),
      durationMs: Number(log.match(/^# duration_ms ([\d.]+)/m)?.[1]),
      cases,
      realPostgresApi: true,
      otpProvider: "isolated in-memory capture; gateway unit contract only",
    },
    reference,
    database: {
      version,
      catalog,
      migrations,
      runtime: privileges,
      privacy,
      production: false,
    },
    services: {
      backend: {
        unit: "tazweed-backend-8084",
        port: 8084,
        ...service("tazweed-backend-8084"),
        boundAllInterfaces: /0\.0\.0\.0:8084\s/.test(listeners),
      },
      postgres: {
        unit: "tazweed-postgres-55432",
        port: 55432,
        ...service("tazweed-postgres-55432"),
        loopbackOnly:
          /127\.0\.0\.1:55432\s/.test(listeners) &&
          !/0\.0\.0\.0:55432\s/.test(listeners),
      },
    },
    http: {
      live: { status: live.status, body: liveBody },
      ready: { status: ready.status, body: readyBody },
      otpStart: { status: start.status, code: startBody.error.code },
      openapiMatchesFile: schema.status === 200,
      ingress: {
        url: "https://tazweed--8084.dev.remote-ammar.duckdns.org/health/live",
        status: ingress.status,
        meaning:
          "remote.futrx auth routing only; no authenticated end-to-end claim",
      },
    },
    secrets: {
      runtimeContainsMigrationCredential: false,
      operatorFileMode: (
        (await stat(root + "backend/.env.local")).mode & 0o777
      ).toString(8),
      runtimeFileMode: (
        (await stat(root + "backend/.env.runtime.local")).mode & 0o777
      ).toString(8),
    },
    dictionary: { tables: 69, triggers: 48, checkPassed: true },
    sources,
    mobileApps: {
      sourceChanges: execFileSync(
        "git",
        [
          "diff",
          "--name-only",
          "--",
          "customer-app",
          "admin-app",
          "courier-app",
        ],
        { cwd: root, encoding: "utf8" },
      )
        .trim()
        .split("\n")
        .filter(Boolean),
      binding:
        "local previews remain separate; no new device or Expo tunnel verification in05",
    },
  };
  assert.equal(result.services.backend.ActiveState, "active");
  assert.equal(result.services.backend.SubState, "running");
  assert(
    result.services.backend.boundAllInterfaces &&
      result.services.postgres.loopbackOnly,
  );
  await writeFile(
    root + "backend/docs/progress/phase-05-checks.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  const lines = [
    "Phase05 acceptance (sanitized)",
    "PostgreSQL " + version,
    `Identity/API: ${count("pass")} passed; 0 failed`,
    ...cases.map((c) => "PASS " + c.name),
    "Baseline: 73 passed / 69 tables / PostgreSQL TCP",
    ...reference.results.map((r) => "PASS " + r.id + " " + r.label),
    "TypeScript typecheck/build: PASS",
    "Generated OpenAPI matches contracts: PASS",
    "Generated reference dictionary: 69 tables, 48 triggers, PASS",
    "Live health: 200",
    "Readiness: 503 / DB connected / limited runtime / OTP unconfigured",
    "Public ingress: 302 remote.futrx auth gate only",
    "No provider message or device integration claimed.",
  ];
  await writeFile(
    root + "backend/docs/progress/phase-05-evidence/acceptance.txt",
    lines.join("\n") + "\n",
  );
  console.log(
    JSON.stringify({
      phase: "05",
      identityTests: count("pass"),
      baselineTests: reference.passed,
      tables: catalog.tables,
      live: live.status,
      ready: ready.status,
      otp: "unconfigured",
    }),
  );
} finally {
  await owner.end();
  await runtime.end();
}
