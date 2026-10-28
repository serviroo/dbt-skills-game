// The build draws the PWA icons in headless Chromium; a lost WebGL context (as on GPU-less CI runners) must not fail it.
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Hosted CI's slowest two-draw scenario took 25.6 s; allow over five times that per child.
const ICON_DRAW_TIMEOUT_MS = 150000;
// Keep draws asynchronous so other scenarios can run. Failures carry the exit code or signal and all child output.
export async function runIconChild(args, { timeout = ICON_DRAW_TIMEOUT_MS } = {}) {
  try {
    return await promisify(execFile)(process.execPath, args, { cwd: root, encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: Infinity });
  } catch (cause) {
    const reason = cause.killed && cause.signal === 'SIGKILL' ? `timed out after ${timeout} ms` : cause.signal ? `signal ${cause.signal}` : `exit code ${cause.code}`;
    throw new Error(`icon child ${reason}\nstdout:\n${cause.stdout ?? ''}\nstderr:\n${cause.stderr ?? ''}`, { cause });
  }
}
const draw = (out, ...extra) =>
  runIconChild([path.join(root, 'scripts/icons.mjs'), `--out=${out}`, '--only=icons', '--quiet', ...extra]);
const hashes = (dir) => {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    }
  };
  walk(dir);
  return out;
};

export const scenarios = {
  async 'icons-survive-lost-context'({ out, expect }) {
    const plain = path.join(out, 'icons-plain');
    const lost = path.join(out, 'icons-lost-context');
    await draw(plain);
    let run;
    try {
      run = await draw(lost, '--lose-context-at=3');
    } catch (e) {
      throw new Error('a lost WebGL context failed the icon build: ' + e.message, { cause: e });
    }
    const want = hashes(plain);
    const got = hashes(lost);
    expect(Object.keys(want).length > 0, 'no icons were drawn');
    expect(Object.keys(want).every((f) => got[f] === want[f]) && Object.keys(got).length === Object.keys(want).length, 'icons drawn after a lost context differ: ' + Object.keys(want).filter((f) => got[f] !== want[f]).join(', '));
    expect(/WebGL context lost, drawing it again \(fresh page\)/.test(run.stderr), 'the context was never lost, so the retry went untested: ' + run.stderr.slice(0, 200));
    expect(/wrote \d+ images/.test(run.stdout), 'the icon run did not finish: ' + run.stdout.slice(0, 200));
  },

  /** the GPU process stays broken: a fresh page loses it again, so the image is drawn in a software-GL browser */
  async 'icons-fall-back-to-software-gl'({ out, expect }) {
    const plain = path.join(out, 'icons-plain-2');
    const lost = path.join(out, 'icons-software');
    await draw(plain);
    let run;
    try {
      run = await draw(lost, '--lose-context-at=2', '--lose-context-times=2');
    } catch (e) {
      throw new Error('losing the context twice failed the icon build: ' + e.message, { cause: e });
    }
    const want = hashes(plain);
    const got = hashes(lost);
    expect(/drawing it again \(software GL\)/.test(run.stderr), 'the software-GL fallback never ran: ' + run.stderr.slice(0, 200));
    expect(Object.keys(want).length > 0 && Object.keys(want).every((f) => got[f]), 'an icon is missing after the software-GL fallback');
  },
};
