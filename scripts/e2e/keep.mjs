// What a failed E2E scenario wrote, kept for CI to upload. keep() copies every file a scenario wrote to its run's folder
// since it started into failed/<scenario>/ there. scripts/e2e.mjs calls it when a scenario fails, and marks each scenario
// in running/ of the run's folder while it runs. Run on its own, this keeps what each scenario still marked there wrote:
// one the runner never got to, because it hung where closing the browser can't reach and its CI step ran out of time.
//   node scripts/e2e/keep.mjs [<run folder>...]   (default: every run folder in artifacts/e2e)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const safe = (name) => name.replace(/[^\w-]+/g, '-');

/** The mark of a scenario running in the run folder `out` */
export const markOf = (out, name) => path.join(out, 'running', `${safe(name)}.json`);

/**
 * Copies what the scenario `name` wrote to the run folder `out` since `since` (ms) to failed/<name>/ there, file by
 * file, so one that can't be read (another browser's, gone meanwhile) costs only itself. With more than one browser at
 * once (--jobs) it holds what the others wrote meanwhile too. Returns what it couldn't copy.
 */
export function keep(out, name, since) {
  const to = path.join(out, 'failed', safe(name));
  const missed = [];
  let files = [];
  try {
    files = fs.readdirSync(out, { recursive: true });
  } catch (e) {
    missed.push(String(e?.message ?? e));
  }
  for (const f of files) {
    if (['failed', 'running'].includes(f.split(path.sep)[0])) continue;
    try {
      const from = path.join(out, f);
      const st = fs.statSync(from);
      if (!st.isFile() || st.mtimeMs < since) continue;
      fs.mkdirSync(path.dirname(path.join(to, f)), { recursive: true });
      fs.copyFileSync(from, path.join(to, f));
    } catch (e) {
      missed.push(`${f}: ${e?.message ?? e}`);
    }
  }
  return missed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = path.join(root, 'artifacts/e2e');
  const runs = process.argv.length > 2 ? process.argv.slice(2).map((d) => path.resolve(d)) : fs.existsSync(base) ? fs.readdirSync(base).map((d) => path.join(base, d)) : [];
  let failed = false;
  for (const out of runs) {
    const marks = path.join(out, 'running');
    if (!fs.existsSync(marks)) continue;
    for (const f of fs.readdirSync(marks)) {
      try {
        const { name, since } = JSON.parse(fs.readFileSync(path.join(marks, f), 'utf8'));
        const missed = keep(out, name, since);
        console.log(`${name} was cut off midway: what it wrote is kept in ${path.relative(root, path.join(out, 'failed', safe(name)))}${missed.length ? `, but for ${missed.join('; ')}` : ''}`);
        fs.rmSync(path.join(marks, f));
      } catch (e) {
        failed = true;
        console.log(`${path.relative(root, path.join(marks, f))}: ${e?.message ?? e}`);
      }
    }
  }
  process.exitCode = failed ? 1 : 0;
}
