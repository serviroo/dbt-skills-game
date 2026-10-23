import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const portFree = (p) => new Promise((res) => { const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(p, '127.0.0.1'); });

const live = new Set();
process.once('exit', () => live.forEach((c) => c.kill('SIGTERM')));
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sig, () => process.exit(130));

export async function startPreview(dir, { from = 4173, tries = 500, timeoutMs = 90000, probe = '/' } = {}) {
  for (let port = from; port < from + tries; port++) {
    if (!(await portFree(port))) continue;
    const child = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--outDir', dir], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    live.add(child);
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    let spawnError;
    child.once('error', (error) => { spawnError = error; live.delete(child); });
    const gone = () => spawnError || child.exitCode !== null || child.signalCode !== null;
    child.once('exit', () => live.delete(child));
    const stop = () =>
      new Promise((res) => {
        if (gone()) return res();
        const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
        child.once('exit', () => { clearTimeout(timer); res(); });
        child.kill('SIGTERM');
      });
    const url = `http://127.0.0.1:${port}/`;
    const t0 = Date.now();
    while (!gone() && Date.now() - t0 < timeoutMs) {
      if (log.includes(`127.0.0.1:${port}`)) {
        try {
          const response = await fetch(new URL(probe, url), { signal: AbortSignal.timeout(2000) });
          if (!response.ok) throw new Error(`preview answered HTTP ${response.status}`);
          return { url, port, stop };
        } catch {}
      }
      await sleep(150);
    }
    await stop();
    if (/already in use/i.test(log)) continue;
    throw new Error(`vite preview did not start on port ${port} within ${timeoutMs} ms:\n${spawnError?.message ?? log}`);
  }
  throw new Error(`no free port from ${from} to ${from + tries - 1}`);
}
