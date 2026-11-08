import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COMMENT_EXCEPTIONS, directive, licenseLine, normalize, strip } from './rules.mjs';
import { languageOf, scanner } from './scan.mjs';

const USAGE = 'usage: node scripts/lint/comments/check.mjs [--base REF] [--head REF]';

function fail(message) {
  console.error(message);
  process.exit(2);
}

function readOptions(argv) {
  const options = {
    base: process.env.BASE_SHA || '',
    head: process.env.HEAD_SHA || 'HEAD',
  };
  for (let i = 0; i < argv.length; i += 2) {
    const value = argv[i + 1];
    if (value === undefined) fail(USAGE);
    if (argv[i] === '--base') options.base = value;
    else if (argv[i] === '--head') options.head = value;
    else fail(USAGE);
  }
  return options;
}

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });

function show(ref, file) {
  try {
    return git('cat-file', '-p', `${ref}:${file}`);
  } catch {
    return null;
  }
}

function changedFiles(from, to) {
  const fields = git('diff', '--name-status', '-z', '-M', from, to).split('\0');
  const files = [];
  for (let i = 0; i < fields.length - 1; ) {
    const status = fields[i++];
    const before = fields[i++];
    const after = /^[RC]/.test(status) ? fields[i++] : before;
    files.push({ before: status === 'A' ? null : before, after: status === 'D' ? null : after });
  }
  return files;
}

function hunks(from, to, before, after) {
  const paths = [...new Set([before, after].filter(Boolean))];
  const diff = git('diff', '--no-color', '--no-ext-diff', '-M', '-U0', from, to, '--', ...paths);
  const added = new Map();
  const removed = new Set();
  let [oldLine, newLine, inHunk] = [0, 0, false];
  for (const line of diff.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) [oldLine, newLine, inHunk] = [Number(hunk[1]), Number(hunk[2]), true];
    else if (inHunk && line.startsWith('+')) added.set(newLine++, line.slice(1));
    else if (inHunk && line.startsWith('-')) removed.add(oldLine++);
  }
  return { added, removed };
}

function byLine(pieces) {
  const lines = new Map();
  for (const piece of pieces) {
    if (piece.line === 1 && piece.text.startsWith('#!')) continue;
    const seen = lines.get(piece.line) ?? { text: '' };
    lines.set(piece.line, { text: `${seen.text} ${piece.text}`.trim() });
  }
  return lines;
}

function firstCodeLine(text, comments) {
  const lines = text.split('\n');
  for (const [i, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed || (i === 0 && trimmed.startsWith('#!'))) continue;
    if (comments.get(i + 1)?.text.trim() !== trimmed) return i + 1;
  }
  return lines.length + 1;
}

const short = (text) => {
  const trimmed = text.trim();
  return trimmed.length > 90 ? `${trimmed.slice(0, 87)}...` : trimmed;
};

const options = readOptions(process.argv.slice(2));
const base = options.base || 'origin/main';
let mergeBase = '';
try {
  mergeBase = git('merge-base', base, options.head).trim();
} catch {
  fail(`Can't find where ${options.head} branched off ${base}.`);
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'no-new-comments-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const scan = scanner(scratch);
const problems = [];
const say = (where, why, text) => problems.push(`${where}: ${why}: ${short(text)}`);

const changes = changedFiles(mergeBase, options.head).map((change) => ({
  ...change,
  ...hunks(mergeBase, options.head, change.before, change.after),
}));

function codeFiles(ref, pick) {
  const files = [];
  for (const [id, change] of changes.entries()) {
    const file = pick === 'before' ? change.before : change.after;
    const wanted = pick === 'before' ? [...change.removed] : [...change.added.keys()];
    if (!file || !wanted.length || (pick === 'after' && COMMENT_EXCEPTIONS.has(file))) continue;
    const text = show(ref, file);
    const lang = text === null ? null : languageOf(file);
    if (lang) files.push({ id, path: file, lang, text, wanted });
  }
  return files;
}

const oldFiles = codeFiles(mergeBase, 'before');
const oldScan = scan(oldFiles);
let movedText = ' ';
for (const file of oldFiles) {
  const comments = byLine(oldScan.get(file.id).pieces);
  for (const line of file.wanted) {
    const words = comments.has(line) ? normalize(comments.get(line).text) : '';
    if (words) movedText += `${words} `;
  }
}

function moved(words) {
  const at = movedText.indexOf(` ${words} `);
  if (at < 0) return false;
  movedText = movedText.slice(0, at) + movedText.slice(at + words.length + 1);
  return true;
}

const licenseText = ` ${(show(options.head, 'LICENSE') ?? '').toLowerCase().replace(/\s+/g, ' ')} `;
const newFiles = codeFiles(options.head, 'after');
const newScan = scan(newFiles);
for (const file of newFiles) {
  const { pieces, error } = newScan.get(file.id);
  if (error) {
    problems.push(`${file.path}: can't be read as ${file.lang} (${error}), so its comments can't be checked`);
    continue;
  }
  const comments = byLine(pieces);
  const header = firstCodeLine(file.text, comments);
  for (const line of file.wanted) {
    const comment = comments.get(line);
    const words = comment ? normalize(comment.text) : '';
    if (!words) continue;
    const stripped = strip(comment.text);
    if (directive(stripped, comment.text)) continue;
    if (line < header && licenseLine(comment.text, licenseText)) continue;
    if (moved(words)) continue;
    say(`${file.path}:${line}`, 'adds a comment', stripped);
  }
}

if (problems.length) {
  console.log(problems.join('\n'));
  const count = `${problems.length} problem${problems.length === 1 ? '' : 's'}`;
  console.log(`\n${count}. Write the code so it reads without a comment (a clearer name, a smaller function, a test),`);
  console.log('and keep existing comments as they are.');
  process.exit(1);
}
console.log('No new comments.');
