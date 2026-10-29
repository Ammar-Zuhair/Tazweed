import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../..', import.meta.url));
const json = async path => JSON.parse(await readFile(`${root}/${path}`, 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');
const baseline = '73b10b485f833e77a124bcdcf8c035bf26791aa5';
const pkg = await json('customer-app/package.json'); const lock = await json('customer-app/package-lock.json');
for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) { assert(/^\d+\.\d+\.\d+/.test(version) && !/^[~^*]/.test(version)); assert.equal(lock.packages[`node_modules/${name}`].version, version, name); }
const files = execFileSync('git', ['ls-files', 'customer-app/assets', 'customer-app/brand-source', 'customer-app/media', 'customer-app/video', 'admin-app/assets', 'courier-app/assets'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
const unchanged = [];
for (const file of files) { const hash = sha(await readFile(`${root}/${file}`)); assert.equal(hash, sha(execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 })), file); unchanged.push({ file, sha256: hash }); }
const metadata = await json('customer-app/dist-native/metadata.json'); const nativeExports = [];
for (const platform of ['android', 'ios']) {
  const entry = metadata.fileMetadata[platform]; const bundle = await readFile(`${root}/customer-app/dist-native/${entry.bundle}`); assert(bundle.length > 100_000);
  const hashes = new Set(await Promise.all(entry.assets.map(async asset => sha(await readFile(`${root}/customer-app/dist-native/${asset.path}`)))));
  for (const file of ['video/intro-light.mp4', 'video/intro-dark.mp4', 'assets/fonts/Tajawal-Regular.ttf', 'assets/fonts/Tajawal-Medium.ttf', 'assets/fonts/Tajawal-Bold.ttf']) assert(hashes.has(sha(await readFile(`${root}/customer-app/${file}`))), `missing original ${platform} ${file}`);
  nativeExports.push({ platform, bundle: entry.bundle, bytes: bundle.length, sha256: sha(bundle), originalFontsAndVideosBundled: true, apkOrIpaBuilt: false });
}
const browser = await json('backend/docs/progress/phase-02-evidence/browser-results.json');
const sourceHash = createHash('sha256');
// Keep baseline paths (including removed files) stable across git staging/commit.
const scope = ['customer-app/src', 'customer-app/app.config.ts', 'customer-app/package.json', 'customer-app/package-lock.json'];
const baselinePaths = execFileSync('git', ['ls-tree', '-r', '--name-only', '73b10b485f833e77a124bcdcf8c035bf26791aa5', '--', ...scope], { cwd: root, encoding: 'utf8' }).trim().split('\n');
const currentPaths = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '--', ...scope], { cwd: root, encoding: 'utf8' }).trim().split('\n');
const sourceFiles = [...new Set([...baselinePaths, ...currentPaths])].sort();
for (const file of new Set(sourceFiles)) { try { sourceHash.update(file).update(await readFile(`${root}/${file}`)); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
assert.equal(browser.sourceFingerprint, sourceHash.digest('hex'), 'UI evidence must match current customer source');
assert.equal(browser.runs.length, 4); assert(browser.runs.every(run => run.passed));
const edgeChecks = await json('backend/docs/progress/phase-02-evidence/edge-results.json'); assert(edgeChecks.passed);
const regression = await json('backend/docs/progress/phase-02-preview-checks.json'); assert(regression.passed);
const tunnels = await json('backend/docs/progress/phase-02-tunnels.json'); assert(tunnels.passed);
const units = [];
for (const [index, role] of ['customer', 'admin', 'courier'].entries()) {
  const port = 8081 + index; const unit = `tazweed-${role}-preview-${port}`;
  const status = execFileSync('systemctl', ['show', unit, '--property=ActiveState,SubState,NRestarts'], { encoding: 'utf8' }); assert(status.includes('ActiveState=active') && status.includes('SubState=running'));
  const listener = execFileSync('ss', ['-H', '-ltnp', `sport = :${port}`], { encoding: 'utf8' }); assert(listener.includes(`0.0.0.0:${port}`) || listener.includes(`*:${port}`), 'preview must bind wildcard');
  const local = await fetch(`http://127.0.0.1:${port}/`); assert.equal(local.status, 200); assert((await local.text()).includes('<html'));
  const host = `tazweed--${port}.dev.remote-ammar.duckdns.org`;
  const routed = await fetch(`https://${host}/`, { redirect: 'manual', signal: AbortSignal.timeout(30000) }); assert([200, 302].includes(routed.status));
  units.push({ unit, port, listener: listener.trim(), status: status.trim(), localHttp: 200, routedUrl: `https://${host}/`, publicHttp: routed.status, publicProof: routed.status === 302 ? 'ingress and auth routing only; not an authenticated end-to-end session' : 'public HTTP response' });
}
const tests = [];
for (const [role, filename, expected] of [['customer', 'tests.log', 29], ['admin', 'admin-tests.log', 4], ['courier', 'courier-tests.log', 4], ['backend', 'backend-tests.log', 1]]) {
  const log = await readFile(`${root}/.phase02-work/${filename}`, 'utf8'); assert.match(log, /# fail 0/); const passed = Number(log.match(/# pass (\d+)/)?.[1]); assert.equal(passed, expected); tests.push({ role, passed });
}
const result = { checkedAt: new Date().toISOString(), startingCommit: baseline, scope: 'phase02 customer local UI only', sdk: 57, sourceFingerprint: browser.sourceFingerprint, directDependenciesExactAndLocked: true, tests, originalSourceFilesCompared: unchanged.length, changedOriginalFiles: [], originalFiles: unchanged, nativeExports, browserMatrix: browser.runs.map(({ theme, width, passed }) => ({ theme, width, passed })), edgeChecks: edgeChecks.checks, regressionChecks: regression.checks.map(({ role, passed }) => ({ role, passed })), units, tunnelEvidence: 'phase-02-tunnels.json', nativePhoneTested: false, productionServicesConnected: false, phase03Started: false, passed: true };
await writeFile(`${root}/backend/docs/progress/phase-02-checks.json`, JSON.stringify(result, null, 2) + '\n');
console.log(`Phase02 verified: ${tests.reduce((sum, test) => sum + test.passed, 0)} unit tests, ${browser.runs.length} browser journeys, ${unchanged.length} unchanged original files, two native JS exports, three preview services.`);
