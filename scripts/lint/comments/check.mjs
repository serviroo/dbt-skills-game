import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { creditProblems } from './credits.mjs';
import { directive, licenseLine, normalize, strip } from './rules.mjs';
import { languageOf, scanner } from './scan.mjs';

function fail(message) {
  console.error(message);
  process.exit(2);
}

function readOptions() {
  const names = ['base', 'head', 'title', 'body-file'];
  const options = Object.fromEntries(names.map((name) => [name, { type: 'string' }]));
  let values = {};
  try {
    ({ values } = parseArgs({ options }));
  } catch (error) {
    fail(error.message);
  }
  return {
    base: values.base ?? process.env.BASE_SHA ?? '',
    head: values.head ?? process.env.HEAD_SHA ?? 'HEAD',
    title: values.title ?? process.env.PR_TITLE ?? '',
    body: values['body-file'] ? fs.readFileSync(values['body-file'], 'utf8') : (process.env.PR_BODY ?? ''),
  };
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
  const flags = ['--no-color', '--no-ext-diff', '--no-textconv', '--text', '-M', '-U0'];
  const diff = git('diff', ...flags, from, to, '--', ...paths);
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

const options = readOptions();
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
    if (!file || !wanted.length) continue;
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
  const removed = new Set(file.wanted);
  for (const piece of oldScan.get(file.id).pieces) {
    const words = removed.has(piece.line) ? normalize(piece.text) : '';
    if (words) movedText += `${words} `;
  }
}

function moved(words) {
  const at = movedText.indexOf(` ${words} `);
  if (at < 0) return false;
  movedText = movedText.slice(0, at) + movedText.slice(at + words.length + 1);
  return true;
}

const licenseText = show(options.head, 'LICENSE') ?? '';

function groups(pieces) {
  const found = new Map();
  for (const piece of pieces) {
    if (piece.line === 1 && piece.text.startsWith('#!')) continue;
    found.set(piece.group, [...(found.get(piece.group) ?? []), piece]);
  }
  return found.values();
}

function verdict(group, header, added) {
  const content = group.filter((p) => normalize(p.text));
  for (const piece of content.filter((p) => added.has(p.line))) {
    const stripped = strip(piece.text);
    if (directive(stripped, piece.text)) continue;
    if (piece.line < header && licenseLine(piece.text, licenseText)) continue;
    if (moved(normalize(piece.text))) continue;
    return [piece.line, stripped];
  }
  if (content.some((p) => added.has(p.line))) return null;
  const opened = group.find((p) => added.has(p.line));
  return [opened.line, content.length ? strip(content[0].text) : opened.text.trim()];
}

const newFiles = codeFiles(options.head, 'after');
const newScan = scan(newFiles);
for (const file of newFiles) {
  const { pieces, error } = newScan.get(file.id);
  if (error) {
    problems.push(`${file.path}: can't be read as ${file.lang} (${error}), so its comments can't be checked`);
    continue;
  }
  const header = firstCodeLine(file.text, byLine(pieces));
  const added = new Set(file.wanted);
  for (const group of groups(pieces)) {
    if (!group.some((p) => added.has(p.line))) continue;
    const found = verdict(group, header, added);
    if (found) say(`${file.path}:${found[0]}`, 'adds a comment', found[1]);
  }
}

const log = git('log', '-z', '--format=%H%n%an <%ae>%n%cn <%ce>%n%B', `${mergeBase}..${options.head}`);
for (const [where, why, text] of creditProblems({ changes, log, title: options.title, body: options.body })) {
  say(where, why, text);
}

if (problems.length) {
  console.log(problems.join('\n'));
  const count = `${problems.length} problem${problems.length === 1 ? '' : 's'}`;
  console.log(`\n${count}. Write the code so it reads without a comment (a clearer name, a smaller function, a test),`);
  console.log('keep existing comments, and keep authorship credits out of the repo and the PR.');
  process.exitCode = 1;
} else {
  console.log('No new comments and no authorship credits.');
}
