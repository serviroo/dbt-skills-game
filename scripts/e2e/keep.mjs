// What a failed E2E scenario wrote, kept for CI to upload. Each scenario writes to a folder of its own in the run's
// folder (scripts/e2e.mjs gives its browser one as it starts), and keep() moves a failed scenario's folder into failed/
// there, the one folder CI uploads. scripts/e2e.mjs marks each scenario in running/ of the run's folder while it runs,
// and keeps it when it fails. Run on its own, this keeps every scenario still marked there: one the runner never got to,
// because it hung where closing the browser can't reach and its CI step ran out of time.
//   node scripts/e2e/keep.mjs [<run folder>...]   (default: every run folder in artifacts/e2e)
// It exits 1 when a scenario couldn't be kept, and then leaves its mark.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const safe = (name) => name.replace(/[^\w-]+/g, '-');

/** The folder the scenario `name` writes to in the run folder `out` */
export const folderOf = (out, name) => path.join(out, safe(name));

/** Marks the scenario `name` as running in the run folder `out`, and returns the mark */
export function mark(out, name) {
  const file = path.join(out, 'running', `${safe(name)}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ name }));
  return file;
}

/** Moves the folder of the scenario `name` in the run folder `out` into failed/ there; returns why it couldn't, or null */
export function keep(out, name) {
  const from = folderOf(out, name);
  const to = path.join(out, 'failed', safe(name));
  try {
    if (!fs.existsSync(from)) return fs.existsSync(to) ? null : `${path.relative(root, from)} isn't there`;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.rmSync(to, { recursive: true, force: true });
    fs.renameSync(from, to);
    return null;
  } catch (e) {
    return String(e?.message ?? e);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = path.join(root, 'artifacts/e2e');
  const runs = process.argv.length > 2 ? process.argv.slice(2).map((d) => path.resolve(d)) : fs.existsSync(base) ? fs.readdirSync(base).map((d) => path.join(base, d)) : [];
  let incomplete = false;
  for (const out of runs) {
    const marks = path.join(out, 'running');
    if (!fs.existsSync(marks)) continue;
    for (const f of fs.readdirSync(marks)) {
      const at = path.join(marks, f);
      try {
        const { name } = JSON.parse(fs.readFileSync(at, 'utf8'));
        const why = keep(out, name);
        if (why) {
          incomplete = true;
          console.log(`${name} was cut off midway, and what it wrote couldn't be kept: ${why}`);
        } else {
          console.log(`${name} was cut off midway: what it wrote is kept in ${path.relative(root, path.join(out, 'failed', safe(name)))}`);
          fs.rmSync(at);
        }
      } catch (e) {
        incomplete = true;
        console.log(`${path.relative(root, at)}: ${e?.message ?? e}`);
      }
    }
  }
  process.exitCode = incomplete ? 1 : 0;
}
