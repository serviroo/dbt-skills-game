// What a failed E2E scenario wrote, kept for CI to upload. keep() copies every file a scenario wrote to its run's folder
// since it started into failed/<scenario>/ there. scripts/e2e.mjs marks each scenario in running/ of the run's folder
// while it runs, and calls keep() when one fails. Run on its own, this keeps what each scenario still marked there wrote:
// one the runner never got to, because it hung where closing the browser can't reach and its CI step ran out of time.
//   node scripts/e2e/keep.mjs [<run folder>...]   (default: every run folder in artifacts/e2e)
// It exits 1 when something couldn't be kept, and then leaves that scenario's mark.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const safe = (name) => name.replace(/[^\w-]+/g, '-');

/**
 * Marks the scenario `name` as running in the run folder `out`, and returns the mark. Its own time on the disk is when
 * the scenario started, by the clock the disk stamps every file with (Date.now() is finer, so a file written in the
 * same tick can look older than it).
 */
export function mark(out, name) {
  const file = path.join(out, 'running', `${safe(name)}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ name }));
  return file;
}

/**
 * Copies what the scenario `name` wrote to the run folder `out` since its mark (`since`, the mark's mtimeMs) to
 * failed/<name>/ there: every file stamped at that time or later. File by file and folder by folder, so one that can't
 * be read (another browser's, gone meanwhile) costs only itself. With more than one browser at once (--jobs) it holds
 * what the others wrote meanwhile too. Returns what it couldn't read or copy.
 */
export function keep(out, name, since) {
  const to = path.join(out, 'failed', safe(name));
  const missed = [];
  const walk = (rel) => {
    let entries;
    try {
      entries = fs.readdirSync(path.join(out, rel), { withFileTypes: true });
    } catch (e) {
      missed.push(`${rel || '.'}: ${e?.message ?? e}`);
      return;
    }
    for (const entry of entries) {
      const f = path.join(rel, entry.name);
      if (!rel && (entry.name === 'failed' || entry.name === 'running')) continue;
      if (entry.isDirectory()) {
        walk(f);
        continue;
      }
      try {
        const st = fs.statSync(path.join(out, f));
        if (!st.isFile() || st.mtimeMs < since) continue;
        fs.mkdirSync(path.dirname(path.join(to, f)), { recursive: true });
        fs.copyFileSync(path.join(out, f), path.join(to, f));
      } catch (e) {
        missed.push(`${f}: ${e?.message ?? e}`);
      }
    }
  };
  walk('');
  return missed;
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
        const missed = keep(out, name, fs.statSync(at).mtimeMs);
        const where = path.relative(root, path.join(out, 'failed', safe(name)));
        if (missed.length) {
          incomplete = true;
          console.log(`${name} was cut off midway: what it wrote is kept in ${where}, but not ${missed.join('; ')}`);
        } else {
          console.log(`${name} was cut off midway: what it wrote is kept in ${where}`);
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
