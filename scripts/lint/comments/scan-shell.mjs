import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const HEREDOC = /^<<(-?)[ \t]*\\?(['"]?)([A-Za-z_][A-Za-z0-9_-]*)\2/;
const INLINE = /(^|[\s;|&(])(node|deno|bun|bash|sh|python3?) +(-e|--eval|-p|--print|-c) +(['"])/g;
const LANGS = { sh: 'sh', bash: 'sh', dash: 'sh', python: 'py', python3: 'py', node: 'js', deno: 'js', bun: 'js' };

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

function bare(line) {
  let out = '';
  for (let at = 0; at < line.length; ) {
    const quote = line[at] === "'" || line[at] === '"' ? line[at] : null;
    const math = line.startsWith('$((', at) || line.startsWith('((', at);
    if (line[at] === '#' && startsComment(line, at)) break;
    let stop = at + 1;
    if (quote) {
      while (stop < line.length && line[stop] !== quote) stop += quote === '"' && line[stop] === '\\' ? 2 : 1;
      stop = Math.min(stop + 1, line.length);
    }
    if (math) stop = line.indexOf('))', at) < 0 ? line.length : line.indexOf('))', at) + 2;
    out += quote || math ? ' '.repeat(stop - at) : line[at];
    at = stop;
  }
  return out;
}

function consumer(plain, at) {
  const parts = plain.split(/(\|\||&&|;|\|)/);
  let start = 0;
  let index = 0;
  while (index < parts.length - 1 && start + parts[index].length < at) start += parts[index++].length;
  const commandOf = (part) => {
    const words = (part ?? '').trim().split(/\s+/).filter((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
    const remote = words[0] === 'ssh' ? words.slice(1).filter((w) => !w.startsWith('-')) : null;
    return remote ? (remote[1] ?? 'sh') : path.basename(words[0] ?? '');
  };
  return LANGS[commandOf(parts[index])] ?? (parts[index + 1] === '|' ? LANGS[commandOf(parts[index + 2])] : null);
}

function inlinePrograms(lines, i, plain) {
  const found = [];
  const rest = lines.slice(i).join('\n');
  for (const match of lines[i].matchAll(INLINE)) {
    const open = match.index + match[0].length - 1;
    if (plain[match.index + match[1].length] !== match[2][0]) continue;
    const quote = match[4];
    let close = open + 1;
    while (close < rest.length && rest[close] !== quote) close += quote === '"' && rest[close] === '\\' ? 2 : 1;
    if (close < rest.length) found.push({ lang: LANGS[match[2]], line: i + 1, text: rest.slice(open + 1, close) });
  }
  return found;
}

export function embeddedCode(lines) {
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const plain = bare(lines[i]);
    found.push(...inlinePrograms(lines, i, plain));
    let next = i + 1;
    for (const { index } of plain.matchAll(/(?<!<)<<(?!<)/g)) {
      const doc = HEREDOC.exec(lines[i].slice(index));
      if (!doc) continue;
      const end = lines.findIndex((line, j) => j >= next && (doc[1] ? line.replace(/^\t+/, '') : line) === doc[3]);
      if (end < 0) break;
      const lang = consumer(plain, index);
      if (lang) found.push({ lang, line: next + 1, text: lines.slice(next, end).join('\n') });
      next = end + 1;
    }
    i = next - 1;
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
      pieces.push({ line: n, text: line.slice(at), group: `l${n}` });
      break;
    }
  }
  for (const doc of embeddedCode(lines)) pieces.push(...embed(doc.lang, doc.text, doc.line));
  return { pieces, error: null };
}
