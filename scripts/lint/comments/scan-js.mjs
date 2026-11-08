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
  const rules = { 'nnc/found': 'error' };
  fs.writeFileSync(config, JSON.stringify({ categories: { correctness: 'off' }, jsPlugins: [plugin], rules }));
  const args = ['-c', config, '--disable-nested-config', '--no-ignore', '-f', 'json', ...byFile.keys()];
  const run = spawnSync(oxlint, args, { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (run.error || !run.stdout) throw new Error(`oxlint didn't run: ${run.error?.message ?? run.stderr}`);
  const results = new Map(items.map((item) => [item.id, { pieces: [], templates: [], error: null }]));
  for (const found of JSON.parse(run.stdout).diagnostics) {
    const item = byFile.get(path.resolve(dir, found.filename));
    if (!item) throw new Error(`oxlint reported a file it wasn't given: ${found.filename}`);
    const result = results.get(item.id);
    if (found.code !== 'nnc(found)') {
      result.error ??= found.message;
      continue;
    }
    const { comment, template } = JSON.parse(found.message);
    if (template) result.templates.push(template);
    else result.pieces.push(...rangePieces(item.text, (item.starts ??= lineStarts(item.text)), ...comment));
  }
  return results;
}
