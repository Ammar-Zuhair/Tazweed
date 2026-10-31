import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../..', import.meta.url));
const progress = `${root}/backend/docs/progress`;
const json = async path => JSON.parse(await readFile(`${progress}/${path}`, 'utf8'));
const sha256 = data => createHash('sha256').update(data).digest('hex');
const hash = createHash('sha256');
for (const path of execFileSync('git', ['ls-files', '-co', '--exclude-standard', '--', 'customer-app/src', 'customer-app/integration'], { cwd: root, encoding: 'utf8' }).trim().split('\n').sort()) hash.update(path).update(await readFile(`${root}/${path}`));
const sourceFingerprint = hash.digest('hex');
const browser = await json('customer-ui-refresh-evidence/browser-results.json');
assert.equal(browser.sourceFingerprint, sourceFingerprint); assert.equal(browser.runs.length, 6);
assert.equal(new Set(browser.runs.map(run => `${run.width}-${run.theme}`)).size, 6);
for (const run of browser.runs) { assert.equal(run.sourceFingerprint, sourceFingerprint); assert(run.passed); assert.deepEqual(run.runtimeErrors, []); assert.deepEqual(run.externalRequests, []); }
const intro = await json('customer-ui-refresh-preview-checks.json'); assert(intro.passed); assert.equal(intro.checks.length, 5); assert(intro.checks.every(row => row.passed));
const regression = await json('customer-ui-refresh-regression-evidence/browser-results.json'); assert.equal(regression.runs.length, 1); assert(regression.runs.every(run => run.passed));
const regressionScope = ['customer-app/src', 'customer-app/app.config.ts', 'customer-app/package.json', 'customer-app/package-lock.json'];
const baseline = execFileSync('git', ['ls-tree', '-r', '--name-only', '73b10b485f833e77a124bcdcf8c035bf26791aa5', '--', ...regressionScope], { cwd: root, encoding: 'utf8' }).trim().split('\n');
const current = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '--', ...regressionScope], { cwd: root, encoding: 'utf8' }).trim().split('\n');
const regressionHash = createHash('sha256');
for (const path of [...new Set([...baseline, ...current])].sort()) { try { regressionHash.update(path).update(await readFile(`${root}/${path}`)); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
assert.equal(regression.sourceFingerprint, regressionHash.digest('hex'), 'order regression must match the final application source');
const tunnels = await json('customer-ui-refresh-tunnels.json'); assert(tunnels.passed); assert.equal(tunnels.tunnels.length, 3);
for (const tunnel of tunnels.tunnels) { assert(tunnel.stableDuringVerification); assert.equal(tunnel.manifests.length, 2); }
const typecheck = execFileSync('npm', ['--prefix', 'customer-app', 'run', 'typecheck'], { cwd: root, encoding: 'utf8', timeout: 120000 });
const tests = execFileSync('npm', ['--prefix', 'customer-app', 'test'], { cwd: root, encoding: 'utf8', timeout: 120000 });
assert.match(tests, /# tests 43/); assert.match(tests, /# pass 43/); assert.match(tests, /# fail 0/);
const metadata = JSON.parse(await readFile(`${root}/customer-app/dist-native/metadata.json`, 'utf8'));
const nativeExports = [];
for (const platform of ['android', 'ios']) { const path = metadata.fileMetadata[platform].bundle; const bundle = await readFile(`${root}/customer-app/dist-native/${path}`); assert(bundle.length > 1_000_000); nativeExports.push({ platform, path, bytes: bundle.length, sha256: sha256(bundle) }); }
const html = await readFile(`${root}/customer-app/dist/index.html`, 'utf8'); assert.match(html, /lang="ar" dir="rtl"/);
const bundlePath = html.match(/src="(\/_expo\/static\/js\/web\/entry-[^"]+\.js)"/)[1];
const webBundle = await readFile(`${root}/customer-app/dist${bundlePath}`);
const webText = webBundle.toString().replace(/\\u([0-9a-f]{4})/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
assert(webText.includes('الأكثر طلبًا اليوم'), 'export must include the daily products heading');
assert(webText.includes('تحديث الكمية'), 'export must include absolute quantity updates');
assert.equal(await (await fetch('http://127.0.0.1:8081/')).text(), html);
const rejected = execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '10', '-H', 'Host: untrusted.example', 'http://127.0.0.1:8081/'], { encoding: 'utf8' }); assert.equal(rejected, '403');
const ingress = execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '30', 'https://tazweed--8081.dev.remote-ammar.duckdns.org/'], { encoding: 'utf8' }); assert.equal(ingress, '302');
const units = [];
for (const unit of ['tazweed-customer-preview-8081', 'tazweed-customer-expo-8091', 'tazweed-admin-expo-8092', 'tazweed-courier-expo-8093']) {
 const status = execFileSync('systemctl', ['show', unit, '--property=ActiveState,SubState,NRestarts'], { encoding: 'utf8' }); assert(status.includes('ActiveState=active') && status.includes('SubState=running')); units.push({ unit, status: status.trim().split('\n') });
}
execFileSync('git', ['diff', '--exit-code', '--', 'customer-app/video', 'customer-app/assets', 'admin-app', 'courier-app'], { cwd: root });
const images = (await readdir(`${progress}/customer-ui-refresh-evidence`)).filter(path => path.endsWith('.png') && path !== 'failure.png');
const results = { checkedAt: new Date().toISOString(), passed: true, scope: 'approved customer UI follow-up after04; no phase05', sourceFingerprint, nativeDeviceTested: false, typecheck: { passed: true, outputSha256: sha256(typecheck) }, tests: { count: 43, passed: 43, failed: 0, outputSha256: sha256(tests) }, browserRuns: browser.runs.map(({ width, theme, passed }) => ({ width, theme, passed })), introScenarios: intro.checks.map(row => row.role), customerOrderRegression: true, nativeExports, webExport: { bundlePath, bytes: webBundle.length, sha256: sha256(webBundle) }, expoTunnels: tunnels.tunnels.map(({ role, expoGoUrl, unit }) => ({ role, expoGoUrl, unit })), services: units, hostValidation: { invalidHostHttp: 403, routedHttpsHttp: 302, authenticatedIngressBrowserTested: false }, unchangedOriginalAssetsAndOtherApps: true, screenshotCount: images.length };
await writeFile(`${progress}/customer-ui-refresh-checks.json`, JSON.stringify(results, null, 2) + '\n'); console.log(JSON.stringify(results, null, 2));
