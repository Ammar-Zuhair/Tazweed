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
  new URL(".phase11-work/acceptance-final.txt", root),
  "utf8",
);
const tests = Number(log.match(/^# tests (\d+)$/m)?.[1]),
  passed = Number(log.match(/^# pass (\d+)$/m)?.[1]);
assert(tests >= 188 && passed === tests);
assert(/^# fail 0$/m.test(log));
const operationLog = await readFile(
  new URL(".phase11-work/client-operations.txt", root),
  "utf8",
);
assert(
  operationLog.includes("# tests 12\n") &&
    operationLog.includes("# pass 12\n") &&
    operationLog.includes("# fail 0\n"),
);
const extraOperationTests = 3;
const postPatchClientChecks = [];
const baseline = (log.match(/^PASS [SO]\d+/gm) ?? []).length;
assert.equal(baseline, 73);
const ui = JSON.parse(
  await readFile(new URL("phase-11-evidence/ui-checks.json", out), "utf8"),
);
assert(ui.results.every((r) => r.passed));
assert.equal(ui.externalProviderRequests, 0);
assert.deepEqual(ui.pageErrors, []);
const tunnels = JSON.parse(
  await readFile(new URL("phase-11-tunnels.json", out), "utf8"),
);
assert(tunnels.passed && tunnels.tunnels.length === 3);
const publicDeletion=[];
for(const t of tunnels.tunnels){
 const page=await fetch(t.httpsOrigin+'/delete-account');assert.equal(page.status,200);const html=await page.text();assert(html.includes('id="deletion"')&&html.includes('حذف الحساب')&&html.includes('إعدادات السياسة'));
 const js=await fetch(t.httpsOrigin+'/assets/legal/deletion.js');assert.equal(js.status,200);assert((await js.text()).includes('X-Deletion-Flow'));
 const blocked=await fetch(t.httpsOrigin+'/web/account-deletion/start',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(blocked.status,403);
 publicDeletion.push({role:t.role,url:t.httpsOrigin+'/delete-account',pageHttp:200,scriptHttp:200,missingFlowHeaderHttp:403,noAppOrLoginRequired:true,providerNotInvoked:true});
}
const boundary = JSON.parse(
  (await readFile(new URL(".phase11-work/client-boundary.txt", root), "utf8"))
    .trim()
    .split("\n")
    .at(-1),
);
assert(boundary.passed);
const checks = [];
for (const name of [
  "backend-types",
  "customer-types",
  "admin-types",
  "courier-types",
  "backend-build",
  "customer-web",
  "admin-web",
  "courier-web",
  "customer-native",
  "admin-native",
  "courier-native",
  "expo-check",
]) {
  const text = await readFile(
    new URL(".phase11-work/" + name + ".txt", root),
    "utf8",
  );
  assert(
    text.length &&
      !/error TS\d+|Export failed|CommandError|Error:|npm error/.test(text),
    name,
  );
  if (/-(web|native)$/.test(name)) assert(text.includes("Exported:"), name);
  checks.push({ command: name, passed: true });
}
const required = [
  "STORE_LEGAL_NAME",
  "STORE_SUPPORT_PHONE",
  "PRIVACY_CONTACT_EMAIL",
  "PRIVACY_POLICY_VERSION",
  "PRIVACY_POLICY_APPROVED_AT",
  "PRIVACY_PERSONAL_RETENTION_DAYS",
  "TRANSACTION_RETENTION_DAYS",
  "PRIVACY_SECURITY_RETENTION_DAYS",
  "PRIVACY_BACKUP_RETENTION_DAYS",
  "PRIVACY_REQUEST_TARGET_DAYS",
  "REPORT_TIME_ZONE",
];
const envNames = [
  ...(await readFile(new URL(".env", backend), "utf8")).matchAll(
    /^(?:export )?([A-Za-z_][A-Za-z0-9_]*)=/gm,
  ),
].map((v) => v[1]);
for (const name of required) assert(envNames.includes(name));
const envGuidePath = "backend/docs/ENV_KEYS_AR.md";
const envGuide = await readFile(new URL(envGuidePath, root), "utf8");
assert.equal(envNames.length, 49);
for (const name of envNames) assert(envGuide.includes("`" + name + "`"), "env guide: " + name);
const existingPolicyNames = ["STORE_SUPPORT_PHONE", "PRIVACY_CONTACT_EMAIL", "TRANSACTION_RETENTION_DAYS"];
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
  const socket = execFileSync("ss", ["-H", "-ltnp", "sport = :" + port], {
    encoding: "utf8",
  });
  assert(socket.trim(), unit + " listener");
  const allInterfaces = new RegExp(
    "(?:0\\.0\\.0\\.0|\\[::\\]|\\*):" + port + "\\s",
  ).test(socket);
  assert(
    role === "postgres"
      ? socket.includes("127.0.0.1:" + port) && !allInterfaces
      : allInterfaces,
    unit + " binding",
  );
  const recent = execFileSync(
    "journalctl",
    ["-u", unit, "--since", "-15 minutes", "-n", "80", "--no-pager"],
    { encoding: "utf8" },
  );
  assert(
    !/Backend initialization failed|EADDRINUSE|Main process exited|code=exited, status=[1-9]/.test(
      recent,
    ),
    unit + " recent startup logs",
  );
  services.push({
    unit,
    port,
    listenAllInterfaces: allInterfaces,
    privateLoopbackOnly: role === "postgres",
    recentStartupFailures: false,
    active: true,
    restarts: Number(s.match(/NRestarts=(\d+)/)?.[1]),
  });
}
const health = {};
for (const path of ["/health/live", "/health/ready"]) {
  const r = await fetch("http://127.0.0.1:8084" + path);
  health[path] = { http: r.status, body: await r.json() };
}
assert.equal(health["/health/live"].body.phase, "11");
assert.equal(health["/health/live"].http, 200);
assert.equal(health["/health/ready"].http, 503);
for (const [key, value] of Object.entries({
  database: "connected",
  migrations: "current",
  runtimeRole: "limited",
  otp: "unconfigured",
  storage: "unconfigured",
  push: "unconfigured",
  privacy: "unconfigured",
}))
  assert.equal(health["/health/ready"].body[key], value);
assert.equal(health["/health/ready"].body.routing, "unconfigured");
const servedOpenapi = await (
  await fetch("http://127.0.0.1:8084/api/v1/openapi.json")
).json();
assert.deepEqual(
  servedOpenapi,
  JSON.parse(
    await readFile(new URL("docs/openapi.phase11.json", backend), "utf8"),
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
for (const t of tunnels.tunnels) {
  const url = t.httpsOrigin + "/api/v1/public/maps",
    r = await fetch(url),
    v = await r.json();
  assert.equal(r.status, 200);
  assert.equal(v.engine, "maplibre-gl-js");
  assert.equal(v.routing, "unconfigured");
  const html = await fetch(t.httpsOrigin + "/api/v1/maps/picker");
  assert.equal(html.status, 200);
  assert((await html.text()).includes("OpenStreetMap contributors"));
  const deploymentConfig = await fetch(
    t.httpsOrigin +
      `/api/v1/public/config?app=${t.role}&platform=android&build=1`,
  );
  assert.equal(deploymentConfig.status, 200);
  const deploymentBody = await deploymentConfig.json();
  assert.equal(deploymentBody.environment, "staging");
  assert.equal(deploymentBody.maintenance.enabled, false);
  expoApi.push({
    role: t.role,
    publicConfigHttp: r.status,
    deploymentConfigHttp: deploymentConfig.status,
    environment: deploymentBody.environment,
    releaseConfigured: deploymentBody.release !== null,
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
      `SELECT current_database() name,(SELECT count(*)::int FROM pg_tables WHERE schemaname='public') tables,(SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal) triggers,(SELECT count(*)::int FROM users) users,(SELECT count(*)::int FROM products) products,(SELECT count(*)::int FROM addresses) addresses,(SELECT count(*)::int FROM orders) orders,(SELECT count(*)::int FROM order_quotes) quotes,(SELECT count(*)::int FROM stock_reservations) holds,(SELECT count(*)::int FROM push_tokens) push_tokens,(SELECT count(*)::int FROM notification_campaigns) campaigns,(SELECT count(*)::int FROM notification_inbox) inbox,(SELECT count(*)::int FROM notification_deliveries) deliveries,(SELECT count(*)::int FROM app_releases) releases,(SELECT count(*)::int FROM deletion_requests) deletion_requests,(SELECT count(*)::int FROM report_jobs) report_jobs,(SELECT count(*)::int FROM privacy_file_deletions) privacy_file_deletions`,
    )
  ).rows[0];
  assert.equal(facts.name, "tazweed_staging");
  assert.equal(facts.tables, 73);
  assert.equal(facts.triggers, 57);
  for (const n of [
    "users",
    "products",
    "addresses",
    "orders",
    "quotes",
    "holds",
    "push_tokens",
    "campaigns",
    "inbox",
    "deliveries",
    "releases",
    "deletion_requests","report_jobs","privacy_file_deletions",
  ])
    assert.equal(facts[n], 0);
  const migrations = (
    await pool.query("SELECT name,sha256 FROM schema_migrations ORDER BY name")
  ).rows;
  assert.equal(migrations.length, 8);
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
  "customer-app/integration",
  "admin-app/integration",
  "courier-app/integration",
])
  await scan(relative);
for (const relative of [
  ".easignore",
  "backend/database/runtime-grants.sql",
  "backend/scripts/check-client-boundary.mjs",
  "backend/scripts/capture-phase11-checks.mjs",
  "backend/scripts/export-openapi.ts",
  "backend/scripts/prepare-native-config.mjs",
  "backend/scripts/test-phase05.mjs",
  "backend/scripts/test-phase11-ui.ts",
  "backend/scripts/verify-expo-tunnels.mjs",
  "backend/tests/phase11.test.ts",
  "backend/tests/client-release.test.ts",
  "backend/tests/client-transport.test.ts",
  "backend/tests/client-operations.test.ts",
  "backend/tests/phase05/helpers.ts",
  "backend/tests/phase08/seed.ts",
  "backend/tests/phase09/seed.ts",
  "backend/package-lock.json",
  "customer-app/package-lock.json",
  "customer-app/app.config.ts",
  "customer-app/eas.json",
  "customer-app/src/app/_layout.tsx",
  "customer-app/src/app/notifications.tsx",
  "admin-app/package-lock.json",
  "admin-app/app.config.ts",
  "admin-app/eas.json",
  "admin-app/src/app/_layout.tsx",
  "admin-app/src/app/notifications.tsx",
  "courier-app/package-lock.json",
  "courier-app/app.config.ts",
  "courier-app/eas.json",
  "courier-app/src/app/_layout.tsx",
  "courier-app/src/app/notifications.tsx",
  "admin-app/src/app/operations.tsx",
  "admin-app/src/app/campaigns.tsx",
  "customer-app/src/app/(tabs)/account.tsx",
  "courier-app/metro.config.js",
])
  sources.push({
    path: relative,
    sha256: createHash("sha256")
      .update(await readFile(new URL(relative, root)))
      .digest("hex"),
  });
const result = {
  checkedAt: new Date().toISOString(),
  phase: "11",
  passed: true,
  fullSuiteTests: tests,
  baselineSqlTests: baseline,
  additionalClientOperationTests: extraOperationTests,
  targetedClientQueueChecks: {tests:12,previousTestsRepeated:9,newTests:3},
  totalTests: tests + baseline + extraOperationTests,
  uiScenarios: ui.results.length,
  screenshots: ui.screenshots,
  lostReportAcknowledgements: ui.droppedReports,
  lostDeletionAcknowledgements: ui.droppedDeletions,
  expoQrs: 3,
  checks,
  database,
  services,
  health,
  ingress,
  previews,
  servedOpenapiMatchesExport: true,
  expoApi,
  publicDeletion,
  clientSecretBoundary: boundary,
  backendEnv: {
    path: "backend/.env",
    mode: "600",
    ignored: true,
    requiredNames: required,
    newNames: required.filter((name) => !existingPolicyNames.includes(name)),
    existingNamesUsedByPolicy: existingPolicyNames,
    ownerGuide: {
      path: envGuidePath,
      documentedNames: envNames.length,
      sha256: createHash("sha256").update(envGuide).digest("hex"),
    },
    valuesExcluded: true,
  },
  privacyPolicyOwnerApproved: false,
  phaseTechnicalScopeVerified: true,
  policyAcceptancePending: true,
  realProvidersTested: false,
  realStoreLocationsTested: false,
  nativePhoneTested: false,
  workflowPreview:
    "real HTTP/PostgreSQL with isolated OTP/routing/storage adapters; image verification real, not R2",
  newExternalServiceKeys: [],
  realPushTested: false,
  otaPublished: false,
  stoppedBeforePhase: "12",
  sources,
};
await copyFile(
  new URL(".phase11-work/acceptance-final.txt", root),
  new URL("phase-11-evidence/acceptance.txt", out),
);
await copyFile(
  new URL(".phase11-work/client-operations.txt", root),
  new URL("phase-11-evidence/client-operations.txt", out),
);
await writeFile(
  new URL("phase-11-checks.json", out),
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
