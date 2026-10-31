import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { root, baseline, adminFingerprint } from './admin-evidence.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
const json = async path => JSON.parse(await readFile(`${root}/${path}`, 'utf8'));
const output = `${root}/backend/docs/progress/phase-03-evidence`;
await mkdir(output, { recursive: true });
const tests = [];
for (const [app, log, expected] of [['admin', 'tests', 43], ['customer', 'customer-tests', 34], ['courier', 'courier-tests', 4], ['backend', 'backend-tests', 1]]) {
  const text = await readFile(`${root}/.phase03-work/${log}.log`, 'utf8');
  assert.match(text, /# fail 0/); assert.equal(Number(text.match(/# pass (\d+)/)?.[1]), expected);
  tests.push({ app, passed: expected }); await copyFile(`${root}/.phase03-work/${log}.log`, `${output}/${app}-tests.txt`);
}
for (const log of ['types', 'customer-types', 'courier-types', 'backend-types']) {
  const text = await readFile(`${root}/.phase03-work/${log}.log`, 'utf8');
  assert.match(text, /tsc --noEmit/); assert.doesNotMatch(text, /error TS/);
  await writeFile(`${output}/${log}.txt`, text.trimEnd() + '\n');
}
const fingerprint = await adminFingerprint();
const browser = await json('backend/docs/progress/phase-03-evidence/browser-results.json');
assert.equal(browser.sourceFingerprint, fingerprint); assert.equal(browser.passed, true); assert.equal(browser.runs.length, 4);
const regression = await json('backend/docs/progress/phase-03-preview-checks.json'); assert(regression.passed);
const tunnels = await json('backend/docs/progress/phase-03-tunnels.json'); assert(tunnels.passed);
const pkg = await json('admin-app/package.json'), lock = await json('admin-app/package-lock.json');
for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
  assert(/^\d+\.\d+\.\d+$/.test(version), `unlocked ${name}`); assert.equal(lock.packages[`node_modules/${name}`].version, version);
}
assert(!pkg.dependencies['expo-dev-client']); assert.match(pkg.scripts.start, /--tunnel --go/);
const originals = execFileSync('git', ['ls-tree', '-r', '--name-only', baseline, '--', 'customer-app/assets', 'customer-app/brand-source', 'customer-app/media', 'customer-app/video', 'admin-app/assets', 'courier-app/assets'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
const originalFiles = [];
for (const path of originals) {
  const hash = sha(await readFile(`${root}/${path}`));
  assert.equal(hash, sha(execFileSync('git', ['show', `${baseline}:${path}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 })), path);
  originalFiles.push({ file: path, sha256: hash });
}
assert.equal(execFileSync('git', ['diff', baseline, '--', 'customer-app/src', 'customer-app/integration', 'customer-app/package.json', 'customer-app/package-lock.json', 'courier-app/src', 'courier-app/package.json', 'backend/src', 'backend/database'], { cwd: root, encoding: 'utf8' }), '', 'phase04/backend/customer behavior must remain unchanged');
const metadata = await json('admin-app/dist-native/metadata.json'), nativeExports = [];
for (const platform of ['android', 'ios']) {
  const entry = metadata.fileMetadata[platform];
  const bundle = await readFile(`${root}/admin-app/dist-native/${entry.bundle}`);
  assert(bundle.length > 100000);
  const hashes = new Set(await Promise.all(entry.assets.map(async a => sha(await readFile(`${root}/admin-app/dist-native/${a.path}`)))));
  for (const font of ['Regular', 'Medium', 'Bold']) assert(hashes.has(sha(await readFile(`${root}/admin-app/assets/fonts/Tajawal-${font}.ttf`))));
  nativeExports.push({ platform, bundleBytes: bundle.length, sha256: sha(bundle), originalTajawalFontsIncluded: true, apkOrIpaBuilt: false });
}
const services = [];
for (const [i, role] of ['customer', 'admin', 'courier'].entries()) {
  const port = 8081 + i, unit = `tazweed-${role}-preview-${port}`;
  const status = execFileSync('systemctl', ['show', unit, '--property=ActiveState,SubState,NRestarts'], { encoding: 'utf8' });
  assert(status.includes('ActiveState=active') && status.includes('SubState=running'));
  const listener = execFileSync('ss', ['-H', '-ltnp', `sport = :${port}`], { encoding: 'utf8' }); assert(listener.includes(`0.0.0.0:${port}`));
  const local = await fetch(`http://127.0.0.1:${port}/`); assert.equal(local.status, 200);
  const html = await local.text(), expectedHtml = await readFile(`${root}/${role}-app/dist/index.html`, 'utf8');
  assert.equal(html, expectedHtml, 'must serve the actual current application export');
  assert.match(html, /<script[^>]+src=/, 'must load the exported application bundle');
  const url = `https://tazweed--${port}.dev.remote-ammar.duckdns.org/`;
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30000) }); assert([200, 302].includes(response.status));
  const denied = Number(execFileSync('curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code}', '-H', 'Host: untrusted.example', `http://127.0.0.1:${port}/`], { encoding: 'utf8' })); assert.equal(denied, 403);
  const logs = execFileSync('journalctl', ['-u', unit, '-b', '-n', '25', '--no-pager'], { encoding: 'utf8' });
  assert.doesNotMatch(logs, /EADDRINUSE|uncaught|Failed with result/);
  services.push({ unit, port, route: '/', status: status.trim(), listener: listener.trim(), localHttp: 200, exportHtmlSha256: sha(html), localHtmlMatchesCurrentExpoExport: true, unknownHostHttp: 403, routedUrl: url, routedHttp: response.status, publicProof: response.status === 302 ? 'ingress/auth routing only, no authenticated end-to-end session' : 'public HTTP response', recentLogsChecked: true });
}
const expoServices = tunnels.tunnels.map(({ role, port, unit, restarts }) => {
  const listener = execFileSync('ss', ['-H', '-ltnp', `sport = :${port}`], { encoding: 'utf8' });
  assert(listener.includes(`0.0.0.0:${port}`) || listener.includes(`*:${port}`));
  return { role, unit, port, route: '/status', restarts, listener: listener.trim() };
});
for (const log of ['expo-check', 'format', 'export-web', 'native-export', 'production-block']) await copyFile(`${root}/.phase03-work/${log}.log`, `${output}/${log}.txt`);
const production = await readFile(`${root}/.phase03-work/production-block.log`, 'utf8'); assert.match(production, /Production builds are disabled/);
const result = { checkedAt: new Date().toISOString(), startingCommit: baseline, scope: 'phase03 local admin UI only', sourceFingerprint: fingerprint, sdk: 57, tests, typechecked: ['admin', 'customer', 'courier', 'backend'], dependenciesExactAndLocked: true, originalFiles, nativeExports, browserMatrix: browser.runs.map(({ theme, width, passed }) => ({ theme, width, passed })), regressionChecks: regression.checks.map(({ role, passed }) => ({ role, passed })), services, expoServices, tunnelEvidence: 'phase-03-tunnels.json', nativeDeviceTested: false, realBusinessServicesConnected: false, productionBlocked: true, phase04Started: false, passed: true };
await writeFile(`${root}/backend/docs/progress/phase-03-checks.json`, JSON.stringify(result, null, 2) + '\n');
console.log(`Phase03 verified: ${tests.reduce((n, x) => n + x.passed, 0)} tests; 4 admin UI journeys; ${originalFiles.length} unchanged assets; Android+iOS JS exports; 3 preview and 3 Expo Go services.`);
