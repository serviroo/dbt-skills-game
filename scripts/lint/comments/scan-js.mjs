import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lineStarts, rangePieces } from './pieces.mjs';

const require = createRequire(import.meta.url);
const oxlintPackage = require.resolve('oxlint/package.json');
const oxlint = path.join(path.dirname(oxlintPackage), require(oxlintPackage).bin.oxlint);
const plugin = fileURLToPath(new URL('./oxlint-plugin.mjs', import.meta.url));

export function oxlintScan(items, scratch) {
  if (!items.length) return new Map();
  const dir = fs.mkdtempSync(path.join(scratch, 'js-'));
  const byFile = new Map();
  for (const [i, item] of items.entries()) {
    const file = path.join(dir, `${i}${item.ext}`);
    fs.writeFileSync(file, item.text);
    byFile.set(file, item);
  }
  const config = path.join(dir, 'oxlintrc.json');
  const out = path.join(dir, 'found.jsonl');
  const rules = { 'nnc/found': 'error' };
  fs.writeFileSync(config, JSON.stringify({ categories: { correctness: 'off' }, jsPlugins: [plugin], rules }));
  const args = ['-c', config, '--disable-nested-config', '--no-ignore', '-f', 'json', ...byFile.keys()];
  const env = { ...process.env, NNC_OUT: out };
  const run = spawnSync(oxlint, args, { cwd: dir, env, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (run.error || !run.stdout) throw new Error(`oxlint didn't run: ${run.error?.message ?? run.stderr}`);
  const unread = { pieces: [], templates: [], error: "oxlint didn't read it" };
  const results = new Map(items.map((item) => [item.id, { ...unread }]));
  const found = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('\n').filter(Boolean) : [];
  for (const { file, comments, templates } of found.map((row) => JSON.parse(row))) {
    const item = byFile.get(path.resolve(dir, file));
    const starts = lineStarts(item.text);
    const pieces = comments.flatMap(([start, end]) => rangePieces(item.text, starts, start, end));
    results.set(item.id, { pieces, templates, error: null });
  }
  for (const diagnostic of JSON.parse(run.stdout).diagnostics) {
    const item = byFile.get(path.resolve(dir, diagnostic.filename));
    if (item) results.get(item.id).error = diagnostic.message;
  }
  return results;
}
