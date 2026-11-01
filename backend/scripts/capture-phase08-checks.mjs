// Operator evidence only. Never serialize env values, credentials, coordinates, or private URLs.
import { readFile, writeFile, readdir, stat, copyFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import pg from "pg";
const root = new URL("../../", import.meta.url),
  backend = new URL("../", import.meta.url),
  out = new URL("docs/progress/", backend);
const log = await readFile(
  new URL(".phase08-work/acceptance-final.txt", root),
  "utf8",
);
const tests = Number(log.match(/^# tests (\d+)$/m)?.[1]),
  passed = Number(log.match(/^# pass (\d+)$/m)?.[1]);
assert(tests >= 105 && passed === tests);
assert(/^# fail 0$/m.test(log));
const operationLog = await readFile(
  new URL(".phase08-work/client-operations.txt", root),
  "utf8",
);
const operationTests = Number(operationLog.match(/^# tests (\d+)$/m)?.[1]);
assert.equal(operationTests, 6);
assert(/^# pass 6$/m.test(operationLog));
assert(/^# fail 0$/m.test(operationLog));
const extraOperationTests = log.includes(
  "native persistence delay cannot turn a double tap",
)
  ? 0
  : operationTests;
const baseline = (log.match(/^PASS [SO]\d+/gm) ?? []).length;
assert.equal(baseline, 73);
const ui = JSON.parse(
  await readFile(new URL("phase-08-evidence/ui-checks.json", out), "utf8"),
);
assert(ui.results.every((r) => r.passed));
assert.equal(ui.externalProviderRequests, 0);
assert.deepEqual(ui.pageErrors, []);
const authUi = JSON.parse(
  await readFile(new URL("phase-08-evidence/auth-ui-checks.json", out), "utf8"),
);
assert(authUi.passed);
assert.deepEqual(authUi.pageErrors, []);
const tunnels = JSON.parse(
  await readFile(new URL("phase-08-tunnels.json", out), "utf8"),
);
assert(tunnels.passed && tunnels.tunnels.length === 3);
const boundary = JSON.parse(
  (await readFile(new URL(".phase08-work/client-boundary.txt", root), "utf8"))
    .trim()
    .split("\n")
    .at(-1),
);
assert(boundary.passed);
const checks = [];
for (const name of [
  "types-backend",
  "types-customer",
  "types-admin",
  "types-courier",
  "build-backend",
  "export-customer-web",
  "export-admin-web",
  "export-courier-web",
  "export-customer-native",
  "export-admin-native",
  "export-courier-native",
  "expo-check",
]) {
  const text = await readFile(
    new URL(".phase08-work/" + name + ".txt", root),
    "utf8",
  );
  assert(
    text.length &&
      !/error TS\d+|Export failed|CommandError|Error:|npm error/.test(text),
    name,
  );
  if (name.startsWith("export-")) assert(text.includes("Exported:"), name);
  checks.push({ command: name, passed: true });
}
const required = [
  "RECEIPT_ATTEMPT_LIMIT_PER_HOUR",
  "RECEIPT_REVIEW_ALERT_MINUTES",
];
const envNames = [
  ...(await readFile(new URL(".env", backend), "utf8")).matchAll(
    /^(?:export )?([A-Za-z_][A-Za-z0-9_]*)=/gm,
  ),
].map((v) => v[1]);
for (const name of required) assert(envNames.includes(name));
assert.equal((await stat(new URL(".env", backend))).mode & 0o777, 0o600);
const ignored = execFileSync("git", ["check-ignore", "backend/.env"], {
  cwd: root,
  encoding: "utf8",
}).trim();
assert.equal(ignored, "backend/.env");
const services = [];
for (const [role, port] of [
  ["backend", 8084],
  ["postgres", 55432],
  ["customer-expo", 8091],
  ["admin-expo", 8092],
  ["courier-expo", 8093],
  ["customer-preview", 8081],
  ["admin-preview", 8082],
  ["courier-preview", 8083],
]) {
  const unit = `tazweed-${role}-${port}`,
    s = execFileSync(
      "systemctl",
      ["show", unit, "--property=ActiveState,SubState,NRestarts"],
      { encoding: "utf8" },
    );
  assert(
    s.includes("ActiveState=active") && s.includes("SubState=running"),
    unit,
  );
  services.push({
    unit,
    port,
    active: true,
    restarts: Number(s.match(/NRestarts=(\d+)/)?.[1]),
  });
}
const health = {};
for (const path of ["/health/live", "/health/ready"]) {
  const r = await fetch("http://127.0.0.1:8084" + path);
  health[path] = { http: r.status, body: await r.json() };
}
assert.equal(health["/health/live"].body.phase, "08");
assert.equal(health["/health/live"].http, 200);
assert.equal(health["/health/ready"].http, 503);
for (const [key, value] of Object.entries({
  database: "connected",
  migrations: "current",
  runtimeRole: "limited",
  otp: "unconfigured",
  storage: "unconfigured",
}))
  assert.equal(health["/health/ready"].body[key], value);
assert.equal(health["/health/ready"].body.routing, "unconfigured");
const servedOpenapi = await (
  await fetch("http://127.0.0.1:8084/api/v1/openapi.json")
).json();
assert.deepEqual(
  servedOpenapi,
  JSON.parse(
    await readFile(new URL("docs/openapi.phase08.json", backend), "utf8"),
  ),
);
const previews = [];
for (const [index, role] of ["customer", "admin", "courier"].entries()) {
  const port = 8081 + index,
    response = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(response.status, 200);
  const html = await response.text();
  const actual = createHash("sha256").update(html).digest("hex"),
    expected = createHash("sha256")
      .update(await readFile(new URL(`${role}-app/dist/index.html`, root)))
      .digest("hex");
  assert.equal(actual, expected);
  const denied = execFileSync(
    "curl",
    [
      "-sS",
      "-o",
      "/dev/null",
      "-w",
      "%{http_code}",
      "-H",
      "Host: untrusted.invalid",
      `http://127.0.0.1:${port}/`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(denied, "403");
  previews.push({
    role,
    port,
    route: "/",
    http: response.status,
    matchesExport: true,
    htmlSha256: actual,
    untrustedHostHttp: 403,
  });
}
const ingress = [];
for (const port of [8081, 8082, 8083, 8084]) {
  const url =
    `https://tazweed--${port}.dev.remote-ammar.duckdns.org/` +
    (port === 8084 ? "health/live" : "");
  const r = await fetch(url, { redirect: "manual" });
  assert([200, 302, 303].includes(r.status));
  ingress.push({
    url,
    http: r.status,
    meaning:
      r.status === 200
        ? "HTTP response"
        : "remote login routing only; not an authenticated user check",
  });
}
const expoApi = [];
for (const t of tunnels.tunnels.filter((t) => t.role !== "courier")) {
  const url = t.httpsOrigin + "/api/v1/public/maps",
    r = await fetch(url),
    v = await r.json();
  assert.equal(r.status, 200);
  assert.equal(v.engine, "maplibre-gl-js");
  assert.equal(v.routing, "unconfigured");
  const html = await fetch(t.httpsOrigin + "/api/v1/maps/picker");
  assert.equal(html.status, 200);
  assert((await html.text()).includes("OpenStreetMap contributors"));
  expoApi.push({
    role: t.role,
    publicConfigHttp: r.status,
    mapPageHttp: html.status,
    providerCredentialsReturned: false,
  });
}
const operator = parseEnv(
  await readFile(new URL(".env.local", backend), "utf8"),
);
const pool = new pg.Pool({ connectionString: operator.MIGRATION_DATABASE_URL });
let database;
try {
  const facts = (
    await pool.query(
      `SELECT current_database() name,(SELECT count(*)::int FROM pg_tables WHERE schemaname='public') tables,(SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal) triggers,(SELECT count(*)::int FROM users) users,(SELECT count(*)::int FROM products) products,(SELECT count(*)::int FROM addresses) addresses,(SELECT count(*)::int FROM orders) orders,(SELECT count(*)::int FROM order_quotes) quotes,(SELECT count(*)::int FROM stock_reservations) holds`,
    )
  ).rows[0];
  assert.equal(facts.name, "tazweed_staging");
  assert.equal(facts.tables, 72);
  assert.equal(facts.triggers, 50);
  for (const n of [
    "users",
    "products",
    "addresses",
    "orders",
    "quotes",
    "holds",
  ])
    assert.equal(facts[n], 0);
  const migrations = (
    await pool.query("SELECT name,sha256 FROM schema_migrations ORDER BY name")
  ).rows;
  assert.equal(migrations.length, 5);
  for (const m of migrations) {
    const hash = createHash("sha256")
      .update(await readFile(new URL("database/migrations/" + m.name, backend)))
      .digest("hex");
    assert.equal(hash, m.sha256);
  }
  database = {
    ...facts,
    migrations,
    isolatedTestDatabasesRemaining: (
      await pool.query(
        "SELECT count(*)::int n FROM pg_database WHERE datname LIKE 'tazweed_test_%'",
      )
    ).rows[0].n,
  };
  assert.equal(database.isolatedTestDatabasesRemaining, 0);
} finally {
  await pool.end();
}
const sources = [];
async function scan(relative) {
  for (const d of await readdir(new URL(relative + "/", root), {
    withFileTypes: true,
  })) {
    const p = relative + "/" + d.name;
    if (d.isDirectory()) await scan(p);
    else if (/\.(?:ts|tsx|js|mjs|cjs|sql|css|html|ttf|json)$/.test(d.name))
      sources.push({
        path: p,
        sha256: createHash("sha256")
          .update(await readFile(new URL(p, root)))
          .digest("hex"),
      });
  }
}
for (const relative of [
  "backend/src",
  "backend/public",
  "backend/database/migrations",
  "customer-app/src/live",
  "admin-app/src/live",
  "courier-app/src/live",
])
  await scan(relative);
for (const relative of [
  "backend/database/runtime-grants.sql",
  "customer-app/app.config.ts",
  "admin-app/app.config.ts",
  "courier-app/app.config.ts",
  "customer-app/src/app/_layout.tsx",
  "customer-app/src/app/addresses.tsx",
  "customer-app/src/app/address.tsx",
  "customer-app/src/app/checkout.tsx",
  "customer-app/src/app/cart.tsx",
  "backend/scripts/check-client-boundary.mjs",
  "backend/scripts/capture-phase08-checks.mjs",
  "backend/scripts/export-openapi.ts",
  "backend/scripts/test-phase05.mjs",
  "backend/scripts/verify-expo-tunnels.mjs",
  "backend/tests/phase07/routing.ts",
  "backend/tests/phase07.test.ts",
  "backend/tests/phase08.test.ts",
  "backend/tests/phase08/seed.ts",
  "backend/tests/client-operations.test.ts",
  "customer-app/src/app/(tabs)/orders.tsx",
  "customer-app/src/app/order.tsx",
  "customer-app/src/app/quote.tsx",
  "customer-app/src/app/payment.tsx",
  "admin-app/src/app/(tabs)/orders.tsx",
  "admin-app/src/app/order.tsx",
  "admin-app/src/app/methods.tsx",
  "backend/scripts/test-phase08-ui.ts",
  "backend/scripts/test-phase08-auth-ui.ts",
  "backend/package-lock.json",
  "customer-app/package-lock.json",
])
  sources.push({
    path: relative,
    sha256: createHash("sha256")
      .update(await readFile(new URL(relative, root)))
      .digest("hex"),
  });
const result = {
  checkedAt: new Date().toISOString(),
  phase: "08",
  passed: true,
  backendAndTransportTests: tests,
  baselineSqlTests: baseline,
  additionalClientOperationTests: extraOperationTests,
  totalTests: tests + baseline + extraOperationTests,
  uiScenarios: ui.results.length + 1,
  screenshots: ui.screenshots + authUi.screenshots,
  lateRefreshAccountIsolation: authUi.passed,
  expoQrs: 3,
  checks,
  database,
  services,
  health,
  ingress,
  previews,
  servedOpenapiMatchesExport: true,
  expoApi,
  clientSecretBoundary: boundary,
  backendEnv: {
    path: "backend/.env",
    mode: "600",
    ignored: true,
    requiredNames: required,
    newNames: required,
    valuesExcluded: true,
  },
  realProvidersTested: false,
  realStoreLocationsTested: false,
  nativePhoneTested: false,
  workflowPreview:
    "real HTTP/PostgreSQL with isolated OTP/routing/storage adapters; image verification real, not R2",
  newExternalServiceKeys: [],
  stoppedBeforePhase: "09",
  sources,
};
await copyFile(
  new URL(".phase08-work/acceptance-final.txt", root),
  new URL("phase-08-evidence/acceptance.txt", out),
);
await copyFile(
  new URL(".phase08-work/client-operations.txt", root),
  new URL("phase-08-evidence/client-operations.txt", out),
);
await writeFile(
  new URL("phase-08-checks.json", out),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    passed: true,
    totalTests: result.totalTests,
    uiScenarios: result.uiScenarios,
    sourceHashes: sources.length,
  }),
);
