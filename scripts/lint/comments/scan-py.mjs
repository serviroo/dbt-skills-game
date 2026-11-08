import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const COMPOUND = new Set([
  'def',
  'class',
  'if',
  'elif',
  'else',
  'for',
  'while',
  'try',
  'except',
  'finally',
  'with',
  'async',
]);
const STATEMENT_START = new Set(['NEWLINE', 'INDENT', 'DEDENT', 'ENCODING']);
const TOKEN = /^(\d+),(\d+)-(\d+),(\d+):\s+(\S+)/;

const opensString = (token) => token.type === 'STRING' || /^[FT]STRING_START$/.test(token.type);

function readTokens(text, scratch) {
  const file = path.join(fs.mkdtempSync(path.join(scratch, 'py-')), 'a.py');
  fs.writeFileSync(file, text);
  const run = spawnSync('python3', ['-I', '-m', 'tokenize', '-e', file], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const why = (run.stderr || String(run.error)).trim().split('\n').at(-1).replaceAll(`${file}:`, 'line ');
  if (run.error || run.status !== 0) return { error: why };
  const lines = text.split('\n');
  const tokens = [];
  for (const row of run.stdout.split('\n')) {
    const match = TOKEN.exec(row);
    if (!match) continue;
    const [r1, c1, r2, c2] = match.slice(1, 5).map(Number);
    const text = r1 === r2 ? [...(lines[r1 - 1] ?? '')].slice(c1, c2).join('') : '';
    tokens.push({ type: match[5], r1, c1, r2, c2, text });
  }
  return { tokens, lines };
}

function rangeText(lines, from, to, kind) {
  const pieces = [];
  for (let row = from.r1; row <= to.r2; row++) {
    const chars = [...(lines[row - 1] ?? '')];
    const start = row === from.r1 ? from.c1 : 0;
    const end = row === to.r2 ? to.c2 : chars.length;
    pieces.push({ line: row, text: chars.slice(start, end).join(''), kind, group: `${from.r1}:${from.c1}` });
  }
  return pieces;
}

function stringRunEnd(tokens, i) {
  let at = i;
  while (at < tokens.length && opensString(tokens[at])) {
    if (tokens[at].type !== 'STRING') {
      for (let depth = 0; at < tokens.length; at++) {
        if (/^[FT]STRING_START$/.test(tokens[at].type)) depth++;
        if (/^[FT]STRING_END$/.test(tokens[at].type) && --depth === 0) break;
      }
    }
    at++;
  }
  return at;
}

const skipNoise = (tokens, from) => {
  let at = from;
  while (tokens[at]?.type === 'NL' || tokens[at]?.type === 'COMMENT') at++;
  return at;
};

function docstringAt(tokens, i) {
  let at = i;
  let opens = 0;
  for (; tokens[at]?.text === '('; opens++) at = skipNoise(tokens, at + 1);
  if (!tokens[at] || !opensString(tokens[at])) return null;
  let end = stringRunEnd(tokens, at);
  while (opens > 0 && opensString(tokens[skipNoise(tokens, end)] ?? {})) {
    end = stringRunEnd(tokens, skipNoise(tokens, end));
  }
  let next = skipNoise(tokens, end);
  for (; opens > 0; opens--) {
    if (tokens[next]?.text !== ')') return null;
    next = skipNoise(tokens, next + 1);
  }
  const after = tokens[next];
  const ends = !after || /^(NEWLINE|ENDMARKER)$/.test(after.type) || after.text === ';';
  return ends ? { first: at, last: end - 1, next } : null;
}

export function pythonPieces(text, scratch) {
  const { tokens, lines, error } = readTokens(text, scratch);
  if (error) return { pieces: [], error };
  const pieces = [];
  let atStart = true;
  let first = null;
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'COMMENT') pieces.push(...rangeText(lines, token, token, 'c'));
    if (token.type === 'COMMENT' || token.type === 'NL') continue;
    if (STATEMENT_START.has(token.type)) {
      [atStart, first, depth] = [true, null, 0];
      continue;
    }
    const docstring = atStart ? docstringAt(tokens, i) : null;
    if (docstring) {
      pieces.push(...rangeText(lines, tokens[docstring.first], tokens[docstring.last], 'd'));
      const skipped = tokens.slice(i, docstring.next).filter((t) => t.type === 'COMMENT');
      for (const comment of skipped) pieces.push(...rangeText(lines, comment, comment, 'c'));
      [atStart, i] = [false, docstring.next - 1];
      continue;
    }
    if (atStart) first = token.text;
    atStart = false;
    if (/^[([{]$/.test(token.text)) depth++;
    if (/^[)\]}]$/.test(token.text)) depth--;
    if (depth === 0 && token.text === ';') [atStart, first] = [true, null];
    if (depth === 0 && token.text === ':' && COMPOUND.has(first)) [atStart, first] = [true, null];
  }
  return { pieces, error: null };
}
