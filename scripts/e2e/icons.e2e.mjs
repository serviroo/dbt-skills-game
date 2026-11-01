// The build draws icons on the requested renderer: one lost context recovers, repeated loss fails, a full draw stamps
// the code it drew with, and a build redraws any image that is not the one stamped.
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { copyFiles, nodeImports, viteConfigFiles } from './harness.mjs';

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
// Fills `copy` with the drawing code, and any other repo files given, set to draw one small icon, so the full draws that
// write the stamp stay short. Returns the copy's scripts/pwa-spec.mjs.
async function smallIconCopy(copy, expect, files = []) {
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(copy, 'node_modules'));
  copyFiles(copy, [...nodeImports('scripts/icons.mjs'), ...files]);
  let source = fs.readFileSync(path.join(root, 'scripts/pwa-spec.mjs'), 'utf8');
  for (const [list, keep] of [['ICONS', "[{ file: 'icons/favicon-32.png', size: 32, kind: 'tiny' }]"], ['SPLASH_DEVICES', '[]']]) {
    const whole = new RegExp(`export const ${list} = \\[[\\s\\S]*?\\n\\];`);
    expect(whole.test(source), `scripts/pwa-spec.mjs no longer writes ${list} as one array, so this copy can't shorten it`);
    source = source.replace(whole, `export const ${list} = ${keep};`);
  }
  fs.writeFileSync(path.join(copy, 'scripts/pwa-spec.mjs'), source);
  return import(pathToFileURL(path.join(copy, 'scripts/pwa-spec.mjs')).href);
}

export const scenarios = {
  async 'icons-stop-on-repeated-lost-context'({ out, expect }) {
    let error;
    try {
      await draw(path.join(out, 'icons-repeated-loss'), '--lose-context-at=2', '--lose-context-times=2');
    } catch (e) {
      error = e;
    }
    expect(error, 'losing the context twice did not fail the icon build');
    expect(/^Error: \S+: page\.evaluate: Error: context lost/m.test(error.message), 'the failure did not name the lost context: ' + error.message);
    expect(!/software GL/.test(error.message), 'the icon build switched to software: ' + error.message);
  },

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
    expect(/WebGL context lost, drawing it again \(fresh page\)/.test(run.stderr), 'the context was never lost, so the retry went untested: ' + run.stderr);
    expect(/wrote \d+ images/.test(run.stdout), 'the icon run did not finish: ' + run.stdout);
  },

  async 'icons-stamp-the-code-they-were-drawn-with'({ expect }) {
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-icons-stamp-'));
    try {
      const spec = await smallIconCopy(copy, expect);
      const script = path.join(copy, 'scripts/icons.mjs');
      const stamp = () => fs.readFileSync(spec.DRAWN_FROM, 'utf8').split('\n')[0];

      await runIconChild([script, '--quiet']);
      const drawn = spec.drawnFrom();
      expect(stamp() === drawn, 'a full draw did not stamp the code it drew with');

      // edited once the drawing has begun, the images are still the old code's, so the stamp has to stay the old code's
      let edited = false;
      await new Promise((resolve, reject) => {
        const child = execFile(process.execPath, [script, '--quiet'], { cwd: root, encoding: 'utf8', timeout: ICON_DRAW_TIMEOUT_MS, killSignal: 'SIGKILL' }, (e, stdout, stderr) =>
          e ? reject(new Error(`icon child failed\nstdout:\n${stdout}\nstderr:\n${stderr}`, { cause: e })) : resolve());
        let said = '';
        child.stdout.on('data', (d) => {
          said += d;
          if (!edited && /renderer:/.test(said)) {
            fs.appendFileSync(script, '// edited while it draws\n');
            edited = true;
          }
        });
      });
      expect(edited, 'the second draw never said which renderer it drew with, so it was never edited mid-draw');
      expect(spec.drawnFrom() !== drawn, 'the edit did not change what the images are drawn from');
      expect(stamp() === drawn, 'an edit made while the icons were drawn was stamped as drawn, so no build would redraw them');
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  },

  async 'icons-redraw-an-image-the-stamp-does-not-hold'({ expect }) {
    // a checkout whose stamp matches the code, building once as committed and once with its icon swapped for another
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-icons-build-'));
    try {
      await smallIconCopy(copy, expect, ['package.json', 'src/pwa/sw-template.js', ...(await viteConfigFiles())]);
      fs.writeFileSync(path.join(copy, 'index.html'), '<!doctype html><title>icons</title>\n');
      await runIconChild([path.join(copy, 'scripts/icons.mjs'), '--quiet']);
      const icon = path.join(copy, 'public/icons/favicon-32.png');
      const drawn = fs.readFileSync(icon);
      const build = () => runIconChild([path.join(root, 'node_modules/vite/bin/vite.js'), 'build', copy]);

      const kept = await build();
      expect(!/wrote \d+ images/.test(kept.stdout), 'a build redrew images that match the stamp: ' + kept.stdout);

      fs.copyFileSync(path.join(root, 'public/icons/icon-192.png'), icon);
      const redrawn = await build();
      expect(/wrote 1 images/.test(redrawn.stdout), 'a build kept an image the stamp does not hold: ' + redrawn.stdout);
      expect(fs.readFileSync(icon).equals(drawn), 'the build did not put back the image the code draws');
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  },

};
