// Operator evidence, no secrets or signed URLs are included in the output.
import { readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import pg from "pg";
const root = new URL("../../", import.meta.url),
  backend = new URL("../", import.meta.url);
const operator = parseEnv(
  await readFile(new URL(".env.local", backend), "utf8"),
);
const pool = new pg.Pool({ connectionString: operator.MIGRATION_DATABASE_URL });
const required = [
  "OTP_PROVIDER",
  "OTP_PROVIDER_URL",
  "OTP_PROVIDER_TOKEN",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_PUBLIC_BUCKET",
  "R2_PRIVATE_BUCKET",
  "R2_PUBLIC_BASE_URL",
];
const configured = parseEnv(await readFile(new URL(".env", backend), "utf8"));
for (const name of required)
  assert(
    Object.hasOwn(configured, name),
    "Missing backend environment name: " + name,
  );
const runtime = parseEnv(
  await readFile(new URL(".env.runtime.local", backend), "utf8"),
);
assert(!runtime.MIGRATION_DATABASE_URL);
const acceptance = await readFile(
  new URL(".phase06-work/acceptance-final.log", root),
  "utf8",
);
const count = Number(acceptance.match(/^# tests (\d+)$/m)?.[1]),
  pass = Number(acceptance.match(/^# pass (\d+)$/m)?.[1]);
assert(count > 50 && pass === count);
assert(/^# fail 0$/m.test(acceptance));
const baseline = (acceptance.match(/^PASS [SO]\d+/gm) ?? []).length;
assert.equal(baseline, 73);
const transport=await readFile(new URL('.phase06-work/transport.log',root),'utf8');
const clientTransportTests=Number(transport.match(/^# pass (\d+)$/m)?.[1]);assert.equal(clientTransportTests,2);assert(/^# fail 0$/m.test(transport));
const ui = JSON.parse(
  await readFile(
    new URL("docs/progress/phase-06-evidence/ui-checks.json", backend),
    "utf8",
  ),
);
assert(ui.results.every((r) => r.passed));
const tunnels = JSON.parse(
  await readFile(
    new URL("docs/progress/phase-06-tunnels.json", backend),
    "utf8",
  ),
);
assert(tunnels.passed && tunnels.tunnels.length === 3);
const boundaryRaw = await readFile(
  new URL(".phase06-work/client-boundary.json", root),
  "utf8",
);
const boundary = JSON.parse(boundaryRaw.trim().split("\n").at(-1));
assert(boundary.passed);
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
  const unit = "tazweed-" + role + "-" + port;
  const raw = execFileSync(
    "systemctl",
    ["show", unit, "--property=ActiveState,SubState,NRestarts"],
    { encoding: "utf8" },
  );
  assert(
    raw.includes("ActiveState=active") && raw.includes("SubState=running"),
    unit,
  );
  services.push({
    unit,
    port,
    state: "active/running",
    restarts: Number(raw.match(/NRestarts=(\d+)/)?.[1]),
  });
}
const health = {};
for (const path of ["/health/live", "/health/ready"]) {
  const r = await fetch("http://127.0.0.1:8084" + path);
  health[path] = { http: r.status, body: await r.json() };
}
assert.equal(health["/health/live"].body.phase, "06");
assert.equal(health["/health/ready"].http, 503);
assert.equal(health["/health/ready"].body.storage, "unconfigured");
const publicApi = [];
for (const t of tunnels.tunnels.filter((t) => t.role !== "courier")) {
  const r = await fetch(t.httpsOrigin + "/api/v1/public/governorates");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(body, { items: [], nextCursor: null });
  publicApi.push({
    role: t.role,
    url: t.httpsOrigin + "/api/v1/public/governorates",
    http: r.status,
    source: "actual backend, no fixtures",
    items: body.items.length,
  });
}
const ingress = [];
for (const port of [8081, 8082, 8083, 8084]) {
  const url =
    "https://tazweed--" +
    port +
    ".dev.remote-ammar.duckdns.org/" +
    (port === 8084 ? "health/live" : "");
  const r = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  ingress.push({ url, http: r.status, authenticatedBrowserProven: false });
  await r.body?.cancel();
}
const audits = {};
for (const role of ["customer", "admin"]) {
  const current = JSON.parse(
      await readFile(
        new URL(".phase06-work/" + role + "-audit.json", root),
        "utf8",
      ),
    ),
    previous = JSON.parse(
      await readFile(
        new URL(".phase06-work/" + role + "-baseline-audit.json", root),
        "utf8",
      ),
    );
  assert.deepEqual(
    current.metadata.vulnerabilities,
    previous.metadata.vulnerabilities,
  );
  audits[role] = {
    current: current.metadata.vulnerabilities,
    baseline: previous.metadata.vulnerabilities,
    newAdvisoryPackages: Object.keys(current.vulnerabilities).filter(
      (k) => !previous.vulnerabilities[k],
    ),
  };
}
const hashes = {};
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--modified", "--others", "--exclude-standard"],
  { cwd: root, encoding: "utf8" },
)
  .trim()
  .split("\n");
for (const f of new Set(files)) {
  if (
    !/^(backend\/src\/|backend\/database\/migrations\/|(?:customer|admin|courier)-app\/src\/(?:app|live)\/|(?:customer|admin|courier)-app\/metro\.config|(?:customer|admin|courier)-app\/app\.config|backend\/scripts\/metro-api-proxy)/.test(
      f,
    )
  )
    continue;
  try {
    hashes[f] = createHash("sha256")
      .update(await readFile(new URL(f, root)))
      .digest("hex");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
let database;
try {
  database = (
    await pool.query(
      `SELECT version() AS version,(SELECT count(*)::int FROM pg_tables WHERE schemaname='public') tables,(SELECT count(*)::int FROM information_schema.triggers WHERE trigger_schema='public') trigger_events,(SELECT count(DISTINCT trigger_name)::int FROM information_schema.triggers WHERE trigger_schema='public') triggers,(SELECT count(*)::int FROM users) users,(SELECT count(*)::int FROM products) products`,
    )
  ).rows[0];
  database.migrations = (
    await pool.query("SELECT name,sha256 FROM schema_migrations ORDER BY name")
  ).rows;
  assert.equal(database.users, 0);
  assert.equal(database.products, 0);
  assert.equal(database.migrations.length, 3);
} finally {
  await pool.end();
}
const report = {
  checkedAt: new Date().toISOString(),
  phase: "06",
  realProvidersTested: false,
  nativePhoneTested: false,
  acceptance: {
    apiTests: count,
    clientTransportTests,
    passed: pass,
    failed: 0,
    referencePostgresTests: baseline,
    uiScenarios: ui.results.length,
    screenshots: ui.screenshots,
  },
  database,
  environment: {
    file: "backend/.env",
    requiredNames: required,
    preservedExistingValues: true,
    migrationCredentialInRuntime: false,
    otpConfigured: false,
    r2Configured: false,
  },
  clientBoundary: boundary,
  audits,
  services,
  health,
  publicApi,
  ingress,
  sourceSha256: hashes,
};
await writeFile(
  new URL("docs/progress/phase-06-checks.json", backend),
  JSON.stringify(report, null, 2) + "\n",
);
const safeLines = (acceptance+"\nClient transport with actual React Native polyfill:\n"+transport)
  .split("\n")
  .filter((x) =>
    /^(Client transport|ok \d+ |# (?:tests|pass|fail|cancelled|skipped|duration_ms)|PASS [SO]\d+)/.test(
      x,
    ),
  );
await writeFile(
  new URL("docs/progress/phase-06-evidence/acceptance.txt", backend),
  safeLines.join("\n") + "\n",
);
console.log(
  JSON.stringify({
    passed: true,
    apiTests: count,
    clientTransportTests,
    baseline,
    uiScenarios: ui.results.length,
    screenshots: ui.screenshots,
    sourceFiles: Object.keys(hashes).length,
  }),
);
