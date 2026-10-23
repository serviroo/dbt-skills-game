import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v = 'true'] = a.slice(2).split('='); return [k, v]; }));
const root = path.resolve(flags.dir ?? 'dist');
const mount = (flags.base ?? '/').replace(/\/*$/, '/');
const host = flags.host ?? '127.0.0.1';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.txt': 'text/plain; charset=utf-8',
};

if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error(`serve-static: no index.html in ${root}`);

const server = http.createServer((req, res) => {
  const send = (status, body = '', headers = {}) => {
    res.writeHead(status, { 'Cache-Control': 'max-age=600', ...headers });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  const missing = () => send(404, '<!doctype html><title>404</title><p>File not found</p>', { 'Content-Type': 'text/html; charset=utf-8' });
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method not allowed', { Allow: 'GET, HEAD', 'Content-Type': 'text/plain' });
  const url = new URL(req.url ?? '/', 'http://localhost');
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    return send(400, 'Bad request', { 'Content-Type': 'text/plain' });
  }
  if (rel + '/' === mount) return send(301, '', { Location: url.pathname + '/' + url.search });
  if (!rel.startsWith(mount)) return missing();
  let file = path.join(root, rel.slice(mount.length));
  if (file !== root && !file.startsWith(root + path.sep)) return missing();
  let st = fs.statSync(file, { throwIfNoEntry: false });
  if (st?.isDirectory()) {
    if (!rel.endsWith('/')) return send(301, '', { Location: url.pathname + '/' + url.search });
    file = path.join(file, 'index.html');
    st = fs.statSync(file, { throwIfNoEntry: false });
  }
  if (!st?.isFile()) return missing();
  send(200, fs.readFileSync(file), { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Content-Length': String(st.size) });
});

server.listen(Number(flags.port ?? 4180), host, () => {
  const { port } = server.address();
  console.log(`serving ${path.relative(process.cwd(), root) || '.'} at http://${host}:${port}${mount}`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
