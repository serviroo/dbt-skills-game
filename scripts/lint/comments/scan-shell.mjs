import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const HEREDOC = /(^|[^<])<<(-?)[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\3/;
const INTERPRETER = /(^|[\s;|&(/])(sh|bash|dash|ssh|python[0-9.]*|node|deno|bun)(\s|$)/;
const HEREDOC_LANG = { python: 'py', node: 'js', deno: 'js', bun: 'js' };

const startsComment = (line, at) => at === 0 || /[\s;&|()]/.test(line[at - 1]);

const BASH = (process.env.PATH ?? '')
  .split(path.delimiter)
  .map((dir) => path.join(dir, 'bash'))
  .find((file) => fs.existsSync(file));

export function bashParser(scratch) {
  if (!BASH) throw new Error("can't find bash on the PATH");
  const cwd = fs.mkdtempSync(path.join(scratch, 'sh-'));
  const env = { PATH: path.join(cwd, 'none') };
  const bash = (args, input) =>
    spawnSync(BASH, ['--noprofile', '--norc', '-O', 'extglob', ...args], { cwd, env, input, encoding: 'utf8' });
  const memo = new Map();
  const wrap = (script) => `f() {\n${script}\n:\n}\n`;
  function declared(script) {
    if (memo.has(script)) return memo.get(script);
    let shown = null;
    if (bash(['-n'], script).status === 0 && bash(['-n'], wrap(script)).status === 0) {
      const run = bash(['-s'], `${wrap(script)}declare -f f\n`);
      if (run.status === 0) shown = run.stdout;
    }
    memo.set(script, shown);
    return shown;
  }
  return { declared, sameMeaning: (a, b) => declared(a) !== null && declared(a) === declared(b) };
}

export function heredocs(lines) {
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const match = HEREDOC.exec(lines[i]);
    if (!match) continue;
    const end = lines.findIndex((line, j) => j > i && (match[2] ? line.replace(/^\t+/, '') : line) === match[4]);
    const stop = end < 0 ? lines.length : end;
    const tool = INTERPRETER.exec(lines[i].replace(HEREDOC, ' '))?.[2];
    if (tool) {
      const lang = HEREDOC_LANG[tool.replace(/[0-9.]+$/, '')] ?? 'sh';
      found.push({ lang, line: i + 2, text: lines.slice(i + 1, stop).join('\n') });
    }
    i = stop;
  }
  return found;
}

export function shellPieces(text, wanted, parser, embed) {
  const lines = text.split('\n');
  const before = parser.declared(text);
  if (before === null) return { pieces: [], error: "bash can't parse it" };
  const pieces = [];
  for (const n of wanted) {
    const line = lines[n - 1] ?? '';
    for (let at = line.indexOf('#'); at >= 0; at = line.indexOf('#', at + 1)) {
      if (!startsComment(line, at)) continue;
      const trial = lines.with(n - 1, line.slice(0, at)).join('\n');
      if (parser.declared(trial) !== before) continue;
      pieces.push({ line: n, text: line.slice(at), kind: 'c' });
      break;
    }
  }
  for (const doc of heredocs(lines)) pieces.push(...embed(doc.lang, doc.text, doc.line));
  return { pieces, error: null };
}
