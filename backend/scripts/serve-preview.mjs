// Serves an Expo web export for reviewing the same native application's UI.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const [role, rawPort, publicHost] = process.argv.slice(2);
if (!['customer', 'admin', 'courier'].includes(role)) throw new Error('Expected role: customer, admin, or courier');
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
if (publicHost && !/^[a-z0-9-]+\.dev\.remote-ammar\.duckdns\.org$/.test(publicHost)) throw new Error('Invalid routed preview hostname');
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)), `${role}-app/dist`);
const allowedHosts = new Set(['localhost', '127.0.0.1', ...(publicHost ? [publicHost] : [])]);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.mp4': 'video/mp4' };
const server = http.createServer(async (request, response) => {
  let hostname;
  try { hostname = new URL(`http://${request.headers.host}`).hostname; } catch { response.writeHead(400).end(); return; }
  if (!allowedHosts.has(hostname)) { response.writeHead(403).end('Host not allowed'); return; }
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let target = resolve(root, '.' + pathname);
    if (target !== root && !target.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    if (!extname(target)) target = target === root ? resolve(root, 'index.html') : target + '.html';
    if (!(await stat(target)).isFile()) throw new Error('not a file');
    const body = await readFile(target);
    const headers = { 'Content-Type': types[extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes' };
    // expo-video seeks via range requests; preserve correct media behavior.
    const range = request.headers.range;
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      const start = match ? Number(match[1]) : NaN;
      const end = match?.[2] ? Math.min(Number(match[2]), body.length - 1) : body.length - 1;
      if (!Number.isInteger(start) || start < 0 || start >= body.length || end < start) { response.writeHead(416, { 'Content-Range': `bytes */${body.length}` }).end(); return; }
      response.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Content-Length': end - start + 1 });
      response.end(request.method === 'HEAD' ? undefined : body.subarray(start, end + 1)); return;
    }
    response.writeHead(200, { ...headers, 'Content-Length': body.length });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('الصفحة غير موجودة'); }
});
server.listen(port, '0.0.0.0', () => console.log(`Tazweed ${role} preview on port ${port}; allowed public host: ${publicHost ?? 'pending-project-slug'}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close());
