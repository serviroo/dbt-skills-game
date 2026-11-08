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
  if (run.error || run.status !== 0) return { error: (run.stderr || String(run.error)).trim().split('\n').at(-1) };
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
    if (atStart && opensString(token)) {
      const end = stringRunEnd(tokens, i);
      let next = end;
      while (tokens[next]?.type === 'COMMENT' || tokens[next]?.type === 'NL') next++;
      const after = tokens[next];
      if (!after || /^(NEWLINE|ENDMARKER)$/.test(after.type) || after.text === ';') {
        pieces.push(...rangeText(lines, token, tokens[end - 1], 'd'));
      }
      [atStart, i] = [false, end - 1];
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
