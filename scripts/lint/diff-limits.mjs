import { execFileSync } from 'node:child_process';

const LONGEST_LINE = 120;
const LARGEST_FILE = 1000;
const CHECKED = /\.(ts|tsx|js|mjs|cjs|css|html|sh|ya?ml)$/;

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
const lineCount = (text) => text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);

function linesAt(ref, file) {
  try {
    return lineCount(git('show', `${ref}:${file}`));
  } catch {
    return 0;
  }
}

function addedLines(base, paths) {
  const added = [];
  let at = 0;
  const diff = git('diff', '--no-color', '--no-ext-diff', '-M', '-U0', base, 'HEAD', '--', ...paths);
  for (const line of diff.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) at = Number(hunk[1]);
    else if (line.startsWith('+') && !line.startsWith('+++')) added.push({ at: at++, text: line.slice(1) });
  }
  return added;
}

const base = process.env.LINT_BASE || git('merge-base', 'HEAD', 'origin/main').trim();
const problems = [];

for (const row of git('diff', '--name-status', '-M', '--diff-filter=AMR', base, 'HEAD').split('\n')) {
  const [status, ...paths] = row.split('\t');
  const file = paths.at(-1);
  if (!status || !CHECKED.test(file)) continue;
  for (const { at, text } of addedLines(base, paths)) {
    const length = [...text].length;
    if (length > LONGEST_LINE) problems.push(`${file}:${at}: ${length} characters, over ${LONGEST_LINE}`);
  }
  const before = linesAt(base, paths[0]);
  const after = linesAt('HEAD', file);
  if (after > LARGEST_FILE && after > before) {
    const change = before ? `grows from ${before} to ${after} lines` : `is new at ${after} lines`;
    problems.push(`${file} ${change}: a file over ${LARGEST_FILE} lines doesn't grow, new code goes in a new module`);
  }
}

if (problems.length) {
  console.error(`Compared with ${base}:\n${problems.join('\n')}`);
  process.exit(1);
}
console.log(`Lines and file sizes are within limits (compared with ${base}).`);
