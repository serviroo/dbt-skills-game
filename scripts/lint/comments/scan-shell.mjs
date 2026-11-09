import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const HEREDOC = /^<<(-?)[ \t]*(?:\\?([A-Za-z0-9_.-]+)|(['"])(.+?)\3)/;
const LANGS = { sh: 'sh', bash: 'sh', dash: 'sh', python: 'py', python3: 'py', node: 'js', deno: 'js', bun: 'js' };
const WRAPPERS = new Set([
  ...['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!'],
  ...['time', 'exec', 'command', 'nohup', 'sudo', 'env', 'timeout'],
]);
const REMOTE = new Set(['ssh', 'docker', 'podman', 'kubectl']);
const CODE_FLAG = { js: /^(-e|--eval|-p|--print)$/, sh: /^-[a-z]*c[a-z]*$/, py: /^-[A-Za-z]*c$/ };

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
  return { declared };
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

const toolOf = (word) => LANGS[path.basename(word).replace(/^(python3?)\.[0-9]+$/, '$1')];

function commandOf(part) {
  const words = part.trim().split(/\s+/).filter(Boolean);
  let k = 0;
  const skippable = (word) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(word) || WRAPPERS.has(word) || word[0] === '-';
  while (k < words.length && skippable(words[k])) {
    k += words[k] === 'timeout' ? 2 : 1;
  }
  const lang = toolOf(words[k] ?? '');
  if (lang || !REMOTE.has(path.basename(words[k] ?? ''))) return lang ?? null;
  const tools = words.slice(k + 1).map(toolOf).filter(Boolean);
  if (tools.length) return tools.at(-1);
  return words[k] === 'ssh' && words.slice(k + 1).filter((w) => w[0] !== '-').length < 2 ? 'sh' : null;
}

function consumer(plain, at) {
  const parts = plain.slice(0, at).split(/(\|\||&&|;|\||\$\(|\(|`)/);
  const after = plain.slice(at).split(/(\|\||&&|;|\|)/);
  return commandOf(parts.at(-1)) ?? (after[1] === '|' ? commandOf(after[2] ?? '') : null);
}

function unquote(word, firstLine) {
  const out = { text: '', lines: [firstLine] };
  const double = word[0] === '"';
  const body = word.slice(1, -1);
  for (let k = 0, line = firstLine; k < body.length; k++) {
    let char = body[k];
    if (double && char === '\\' && /[\\"$`\n]/.test(body[k + 1] ?? '')) char = body[++k];
    if (char === '\n') line++;
    if (char === '\n' && body[k - 1] === '\\' && double) continue;
    out.text += char;
    if (char === '\n') out.lines.push(line);
  }
  return out;
}

function inlinePrograms(lines, i, plain) {
  const rest = lines.slice(i).join('\n');
  const words = rest.matchAll(/'[^']*'|"(?:\\[\s\S]|[^"\\])*"|[^\s'"]+/g);
  const tokens = [...words].filter((t) => t.index <= lines[i].length);
  const found = [];
  for (const [k, token] of tokens.entries()) {
    const word = token[0].replace(/^[$;&|(`]+/, '');
    const lang = plain[token.index] === token[0][0] ? toolOf(word) : null;
    for (let j = k + 1; lang && CODE_FLAG[lang] && tokens[j]?.[0][0] === '-'; j++) {
      if (!CODE_FLAG[lang].test(tokens[j][0])) continue;
      const code = tokens[j + 1];
      const line = i + 1 + (rest.slice(0, code?.index ?? 0).match(/\n/g) ?? []).length;
      if (code && /^['"]/.test(code[0])) found.push({ lang, ...unquote(code[0], line) });
      break;
    }
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
      const delimiter = doc[2] ?? doc[4];
      const end = lines.findIndex((line, j) => j >= next && (doc[1] ? line.replace(/^\t+/, '') : line) === delimiter);
      if (end < 0) break;
      const lang = consumer(plain, index);
      if (lang) found.push({ lang, lines: next + 1, text: lines.slice(next, end).join('\n') });
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
  for (const doc of embeddedCode(lines)) pieces.push(...embed(doc.lang, doc.text, doc.lines));
  return { pieces, error: null };
}
