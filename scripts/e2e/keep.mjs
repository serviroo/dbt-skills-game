import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const safe = (name) => name.replace(/[^\w-]+/g, '-');

export const folderOf = (out, name) => path.join(out, safe(name));

export function mark(out, name, extra = {}) {
  const file = path.join(out, 'running', `${safe(name)}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ name, ...extra }));
  return file;
}

function moveInto(from, to) {
  if (!fs.existsSync(to)) {
    fs.renameSync(from, to);
    return;
  }
  for (const entry of fs.readdirSync(from)) {
    let target = path.join(to, entry);
    for (let n = 2; fs.existsSync(target); n++) target = path.join(to, `${n}-${entry}`);
    fs.renameSync(path.join(from, entry), target);
  }
  fs.rmdirSync(from);
}

export function keep(out, name) {
  const from = folderOf(out, name);
  const to = path.join(out, 'failed', safe(name));
  try {
    if (!fs.existsSync(from)) return fs.existsSync(to) ? null : `${path.relative(root, from)} isn't there`;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    moveInto(from, to);
    return null;
  } catch (e) {
    return String(e?.message ?? e);
  }
}

function runFolders(args) {
  if (args.length) return args.map((d) => path.resolve(d));
  const base = path.join(root, 'artifacts/e2e');
  return fs.existsSync(base) ? fs.readdirSync(base).map((d) => path.join(base, d)) : [];
}

function keepMarked(out, failedOnly) {
  const marks = path.join(out, 'running');
  if (!fs.existsSync(marks)) return true;
  let whole = true;
  for (const f of fs.readdirSync(marks)) {
    const at = path.join(marks, f);
    try {
      const { name, failed } = JSON.parse(fs.readFileSync(at, 'utf8'));
      if (failedOnly && !failed) continue;
      const why = keep(out, name);
      if (why) {
        whole = false;
        console.log(`${name} was cut off midway, and what it wrote couldn't be kept: ${why}`);
        continue;
      }
      const kept = path.relative(root, path.join(out, 'failed', safe(name)));
      console.log(`${name} was cut off midway: what it wrote is kept in ${kept}`);
      fs.rmSync(at);
    } catch (e) {
      whole = false;
      console.log(`${path.relative(root, at)}: ${e?.message ?? e}`);
    }
  }
  return whole;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const failedOnly = args.includes('--failed-only');
  const results = runFolders(args.filter((a) => a !== '--failed-only')).map((out) => keepMarked(out, failedOnly));
  process.exitCode = results.every(Boolean) ? 0 : 1;
}
