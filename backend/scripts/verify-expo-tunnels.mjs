import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const prefix = process.env.TAZWEED_EVIDENCE_PREFIX ?? 'phase-04';
if (!/^phase-(?:01-sdk57|02(?:-native-fix)?|03|04)$/.test(prefix)) throw new Error('Invalid evidence prefix');
const output = fileURLToPath(new URL(`../docs/progress/${prefix}-evidence/`, import.meta.url));
await mkdir(output, { recursive: true });
const results = { checkedAt: new Date().toISOString(), projectSlug: 'tazweed', sdk: 57, nativePhoneTested: false, tunnels: [] };
async function get(url, headers = {}, timeout = 120000) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
  assert.equal(response.status, 200, `${url}: HTTP ${response.status}`);
  return response;
}
async function checkWebSocket(origin) {
  const socket = new WebSocket(origin.replace(/^https:/, 'wss:') + '/hot');
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.close(); reject(new Error('public HMR WebSocket timed out')); }, 15000);
    socket.addEventListener('open', () => { clearTimeout(timeout); socket.close(); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('public HMR WebSocket failed')); }, { once: true });
  });
}
for (const [index, role] of ['customer', 'admin', 'courier'].entries()) {
  const port = 8091 + index;
  const unit = `tazweed-${role}-expo-${port}`;
  const state = execFileSync('systemctl', ['show', unit, '--property=ActiveState,SubState,NRestarts'], { encoding: 'utf8' });
  assert(state.includes('ActiveState=active') && state.includes('SubState=running'));
  assert.equal(await (await get(`http://127.0.0.1:${port}/status`)).text(), 'packager-status:running');
  const link = await (await get(`http://127.0.0.1:${port}/_expo/open?platform=android&runtime=expo`)).json();
  assert.equal(link.runtime, 'expo'); assert.deepEqual(link.availableRuntimes, ['expo']);
  const url = new URL(link.url); assert.equal(url.protocol, 'exp:'); assert(url.hostname.endsWith('.exp.direct'));
  const origin = `https://${url.host}`;
  assert.equal(await (await get(origin + '/status')).text(), 'packager-status:running');
  const manifests = [];
  for (const platform of ['android', 'ios']) {
    const manifest = await (await get(origin + '/', { accept: 'application/expo+json', 'expo-platform': platform, 'expo-protocol-version': '1' })).json();
    const client = manifest.extra.expoClient;
    if (role === 'customer' && (prefix.startsWith('phase-02') || ['phase-03', 'phase-04'].includes(prefix))) { assert.equal(client.extra.phase, '02'); assert.equal(client.extra.dataMode, 'fake'); }
    if (role === 'admin' && ['phase-03', 'phase-04'].includes(prefix)) assert.equal(client.extra.phase, '03');
    if (role === 'courier' && prefix === 'phase-04') assert.equal(client.extra.phase, '04');
    assert.equal(client.sdkVersion, '57.0.0'); assert.equal(manifest.runtimeVersion, 'exposdk:57.0.0');
    assert.equal(client.extra.appKind, role); assert.equal(client.extra.dataMode, 'fake');
    assert.equal(client.extra.supportsRTL, true); assert.equal(client.extra.forcesRTL, true);
    const launchUrl = new URL(manifest.launchAsset.url);
    assert.equal(launchUrl.origin, origin); assert.equal(launchUrl.searchParams.get('platform'), platform);
    const response = await get(launchUrl.toString(), {}, 180000);
    const bundle = Buffer.from(await response.arrayBuffer());
    assert(bundle.length > 1000, 'development bundle must contain code');
    manifests.push({ platform, sdkVersion: client.sdkVersion, runtimeVersion: manifest.runtimeVersion, manifestHttp: 200, launchAssetUrl: launchUrl.toString(), bundleHttp: 200, bundleBytes: bundle.length, bundleSha256: createHash('sha256').update(bundle).digest('hex'), rtlManifestFlags: true });
    console.log(`${role}: ${platform} manifest and development bundle verified through public tunnel`);
  }
  await checkWebSocket(origin);
  await QRCode.toFile(output + `${role}-qr.png`, link.url, { width: 360, margin: 4, errorCorrectionLevel: 'M' });
  const finalState = execFileSync('systemctl', ['show', unit, '--property=ActiveState,SubState,NRestarts'], { encoding: 'utf8' });
  assert.equal(finalState, state, 'service must remain active without restarting during verification');
  const restarts = Number(state.match(/NRestarts=(\d+)/)?.[1]);
  results.tunnels.push({ role, port, unit, active: true, restarts, stableDuringVerification: true, provider: 'ngrok via Expo CLI --tunnel', runtime: 'expo', expoGoUrl: link.url, httpsOrigin: origin, publicStatusHttp: 200, publicWebSocket: 'opened', manifests });
}
results.passed = true;
await writeFile(fileURLToPath(new URL(`../docs/progress/${prefix}-tunnels.json`, import.meta.url)), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results.tunnels.map(({ role, expoGoUrl, unit }) => ({ role, expoGoUrl, unit })), null, 2));
