import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { root, baseline, courierFingerprint } from "./courier-evidence.mjs";
import { adminFingerprint } from "./admin-evidence.mjs";
const json = async (p) => JSON.parse(await readFile(`${root}/${p}`, "utf8"));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const git = (args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
const output = `${root}/backend/docs/progress/phase-04-evidence`;
await mkdir(output, { recursive: true });
const tests = [];
for (const [app, count] of [
  ["courier", 31],
  ["customer", 34],
  ["admin", 43],
  ["backend", 1],
]) {
  const log = await readFile(`${root}/.phase04-work/${app}-tests.txt`, "utf8");
  assert.match(log, /# fail 0/);
  assert.equal(Number(log.match(/# pass (\d+)/)?.[1]), count);
  tests.push({ app, passed: count });
  await writeFile(`${output}/${app}-tests.txt`, log.trimEnd() + "\n");
  const types = await readFile(
    `${root}/.phase04-work/${app}-types.txt`,
    "utf8",
  );
  assert.match(types, /tsc --noEmit/);
  assert.doesNotMatch(types, /error TS/);
  await writeFile(`${output}/${app}-types.txt`, types.trimEnd() + "\n");
}
const fingerprint = await courierFingerprint();
const browser = await json(
  "backend/docs/progress/phase-04-evidence/browser-results.json",
);
assert.equal(browser.sourceFingerprint, fingerprint);
assert.equal(browser.runs.length, 4);
assert(browser.passed);
for (const run of browser.runs) {
  assert(run.passed);
  assert.deepEqual(run.pageErrors, []);
  assert.deepEqual(run.externalRequests, []);
}
const admin = await json(
  "backend/docs/progress/phase-04-admin-evidence/run-1.json",
);
assert(admin.passed);
assert.equal(admin.sourceFingerprint, await adminFingerprint());
assert.deepEqual(admin.pageErrors, []);
assert.deepEqual(admin.externalRequests, []);
const customer = await json(
  "backend/docs/progress/phase-04-customer-evidence/browser-results.json",
);
assert.equal(customer.runs.length, 1);
assert(customer.runs[0].passed);
assert.deepEqual(customer.runs[0].runtimeErrors, []);
assert.deepEqual(customer.runs[0].externalRequests, []);
// Customer/admin sources are the reviewed phase03 versions; preserve their previous UI evidence.
assert.equal(
  git([
    "diff",
    baseline,
    "--",
    "customer-app/src",
    "customer-app/integration",
    "customer-app/package.json",
    "customer-app/package-lock.json",
    "admin-app/src",
    "admin-app/package.json",
    "admin-app/package-lock.json",
    "backend/src",
    "backend/database",
  ]),
  "",
);
const originals = git([
  "ls-tree",
  "-r",
  "--name-only",
  baseline,
  "--",
  "customer-app/assets",
  "customer-app/brand-source",
  "customer-app/media",
  "customer-app/video",
  "admin-app/assets",
  "courier-app/assets",
])
  .trim()
  .split("\n");
const originalFiles = [];
for (const path of originals) {
  const hash = sha(await readFile(`${root}/${path}`));
  assert.equal(
    hash,
    sha(
      execFileSync("git", ["show", `${baseline}:${path}`], {
        cwd: root,
        maxBuffer: 64 * 1024 * 1024,
      }),
    ),
  );
  originalFiles.push({ file: path, sha256: hash });
}
const referenceTokens = await readFile(
  `${root}/customer-app/assets/theme-tokens.json`,
  "utf8",
);
for (const app of ["admin", "courier"])
  assert.equal(
    await readFile(`${root}/${app}-app/assets/theme-tokens.json`, "utf8"),
    referenceTokens,
  );
const pkg = await json("courier-app/package.json"),
  lock = await json("courier-app/package-lock.json");
for (const [name, version] of Object.entries({
  ...pkg.dependencies,
  ...pkg.devDependencies,
})) {
  assert(/^\d+\.\d+\.\d+$/.test(version));
  assert.equal(lock.packages[`node_modules/${name}`].version, version);
}
assert(!pkg.dependencies["expo-dev-client"]);
assert.match(pkg.scripts.start, /--tunnel --go/);
const meta = await json("courier-app/dist-native/metadata.json"),
  nativeExports = [];
for (const platform of ["android", "ios"]) {
  const entry = meta.fileMetadata[platform];
  const bundle = await readFile(
    `${root}/courier-app/dist-native/${entry.bundle}`,
  );
  assert(bundle.length > 100000);
  const hashes = new Set(
    await Promise.all(
      entry.assets.map(async (a) =>
        sha(await readFile(`${root}/courier-app/dist-native/${a.path}`)),
      ),
    ),
  );
  for (const font of ["Regular", "Medium", "Bold"])
    assert(
      hashes.has(
        sha(
          await readFile(
            `${root}/courier-app/assets/fonts/Tajawal-${font}.ttf`,
          ),
        ),
      ),
    );
  assert(
    hashes.has(sha(await readFile(`${root}/courier-app/assets/task-tone.wav`))),
  );
  nativeExports.push({
    platform,
    bundleBytes: bundle.length,
    sha256: sha(bundle),
    originalFontsAndTaskToneIncluded: true,
    apkOrIpaBuilt: false,
  });
}
const config = await json(".phase04-work/courier-introspect.json");
assert.equal(config.extra.phase, "04");
const permissions =
  config._internal.modResults.android.manifest.manifest["uses-permission"];
assert(
  !permissions.some((x) =>
    /ACCESS_(?:FINE|COARSE|BACKGROUND)_LOCATION|FOREGROUND_SERVICE_LOCATION/.test(
      x.$["android:name"],
    ),
  ),
);
assert(
  permissions.some(
    (x) =>
      x.$["android:name"] === "android.permission.RECORD_AUDIO" &&
      x.$["tools:node"] === "remove",
  ),
);
assert(!config.ios.infoPlist.NSMicrophoneUsageDescription);
assert(!config.ios.infoPlist.NSLocationWhenInUseUsageDescription);
assert(!config.ios.infoPlist.UIBackgroundModes?.includes("location"));
const regression = await json(
  "backend/docs/progress/phase-04-preview-checks.json",
);
assert(regression.passed);
const tunnels = await json("backend/docs/progress/phase-04-tunnels.json");
assert(tunnels.passed);
assert.equal(tunnels.tunnels.length, 3);
const services = [];
for (const [i, role] of ["customer", "admin", "courier"].entries()) {
  const port = 8081 + i,
    unit = `tazweed-${role}-preview-${port}`;
  const state = execFileSync(
    "systemctl",
    ["show", unit, "--property=ActiveState,SubState,NRestarts"],
    { encoding: "utf8" },
  );
  assert(
    state.includes("ActiveState=active") && state.includes("SubState=running"),
  );
  const listener = execFileSync("ss", ["-H", "-ltnp", `sport = :${port}`], {
    encoding: "utf8",
  });
  assert(listener.includes(`0.0.0.0:${port}`));
  const response = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.equal(
    html,
    await readFile(`${root}/${role}-app/dist/index.html`, "utf8"),
  );
  assert.match(html, /<script[^>]+src=/);
  const unknownHost = Number(
    execFileSync(
      "curl",
      [
        "-sS",
        "-o",
        "/dev/null",
        "-w",
        "%{http_code}",
        "-H",
        "Host: untrusted.example",
        `http://127.0.0.1:${port}/`,
      ],
      { encoding: "utf8" },
    ),
  );
  assert.equal(unknownHost, 403);
  const routedUrl = `https://tazweed--${port}.dev.remote-ammar.duckdns.org/`;
  const routed = await fetch(routedUrl, {
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
  assert([200, 302].includes(routed.status));
  const logs = execFileSync(
    "journalctl",
    ["-u", unit, "-b", "-n", "20", "--no-pager"],
    { encoding: "utf8" },
  );
  assert.doesNotMatch(logs, /EADDRINUSE|uncaught|Failed with result/);
  services.push({
    unit,
    port,
    route: "/",
    state: state.trim(),
    listener: listener.trim(),
    localHttp: 200,
    exportHtmlSha256: sha(html),
    unknownHostHttp: 403,
    routedUrl,
    routedHttp: routed.status,
    publicProof:
      routed.status === 302
        ? "ingress/auth only, no authenticated user browser check"
        : "HTTP response",
    recentLogsChecked: true,
  });
}
const expoServices = [];
for (const { role, port, unit, restarts } of tunnels.tunnels) {
  const listener = execFileSync("ss", ["-H", "-ltnp", `sport = :${port}`], {
    encoding: "utf8",
  });
  assert(
    listener.includes(`0.0.0.0:${port}`) || listener.includes(`*:${port}`),
  );
  const state = execFileSync(
    "systemctl",
    ["show", unit, "--property=ActiveState,SubState"],
    { encoding: "utf8" },
  );
  assert(
    state.includes("ActiveState=active") && state.includes("SubState=running"),
  );
  const logs = execFileSync(
    "journalctl",
    ["-u", unit, "-n", "15", "--no-pager"],
    { encoding: "utf8" },
  );
  assert.doesNotMatch(
    logs,
    /Unable to resolve|SyntaxError|TransformError|Cannot find module/,
  );
  expoServices.push({
    role,
    unit,
    port,
    route: "/status",
    restarts,
    listener: listener.trim(),
    recentLogsChecked: true,
  });
}
for (const file of [
  "courier-compat",
  "courier-web",
  "courier-native",
  "production-block",
]) {
  const log = await readFile(`${root}/.phase04-work/${file}.txt`, "utf8");
  if (file === "courier-compat")
    assert.match(log, /Dependencies are up to date/);
  if (file === "production-block")
    assert.match(log, /Production builds are disabled/);
  if (file === "courier-web" || file === "courier-native")
    assert.match(log, /Exported: dist/);
  await writeFile(`${output}/${file}.txt`, log.trimEnd() + "\n");
}
const format = await readFile(`${root}/.phase04-work/format-check.txt`, "utf8");
assert.match(format, /All matched files use Prettier code style/);
await writeFile(`${output}/format-check.txt`, format.trimEnd() + "\n");
const deps = await readFile(`${root}/.phase04-work/courier-deps.txt`, "utf8");
assert.doesNotMatch(deps, /npm error|invalid:|UNMET DEPENDENCY/);
await writeFile(`${output}/courier-deps.txt`, deps.trimEnd() + "\n");
const imageCounts = {};
for (const dir of ["phase-04", "phase-04-admin", "phase-04-customer"])
  imageCounts[dir] = (
    await readdir(`${root}/backend/docs/progress/${dir}-evidence`)
  ).filter((x) => x.endsWith(".png") && !x.startsWith("failure")).length;
const result = {
  checkedAt: new Date().toISOString(),
  startingCommit: baseline,
  scope: "phase04 local courier UI and cross-app review only",
  sourceFingerprint: fingerprint,
  sdk: 57,
  tests,
  totalTests: tests.reduce((n, x) => n + x.passed, 0),
  typechecked: ["customer", "admin", "courier", "backend"],
  dependenciesExactAndLocked: true,
  originalFiles,
  sharedThemeTokensIdentical: true,
  nativeExports,
  courierPermissions: {
    configIntrospectedOnly: true,
    noLocationOrBackgroundTracking: true,
    microphoneDisabled: true,
    nativeDeviceTested: false,
  },
  browserMatrix: browser.runs.map(
    ({ index, theme, width, passed, images }) => ({
      index,
      theme,
      width,
      passed,
      screenshotCount: images.length,
    }),
  ),
  crossAppReviews: {
    customer: {
      theme: "light",
      width: 390,
      passed: true,
      coverage: "complete phase02 journey rerun",
    },
    admin: {
      theme: "dark",
      width: 390,
      passed: true,
      coverage: "phase03 screen/state/permission review rerun",
    },
  },
  imageCounts,
  regressionChecks: regression.checks.map(({ role, passed }) => ({
    role,
    passed,
  })),
  services,
  expoServices,
  tunnelEvidence: "phase-04-tunnels.json",
  nativeDeviceTested: false,
  realBusinessServicesConnected: false,
  productionBlocked: true,
  phase05Started: false,
  ownerUiApprovalRecorded: false,
  passed: true,
};
await writeFile(
  `${root}/backend/docs/progress/phase-04-checks.json`,
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  `Phase04 verified: ${result.totalTests} tests, four courier UI runs, two cross-app reviews, ${originalFiles.length} unchanged assets, three Expo Go tunnels.`,
);
