import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import lantern from './rules.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const fixtures = path.join(here, 'fixtures');
const bin = (name) => path.join(root, 'node_modules', '.bin', name);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-selftest-'));
const failures = [];
const expect = (ok, message) => ok || failures.push(message);

const RULE_FINDINGS = {
  'audio-times-from-soon': 2,
  'animations-share-start-time': 1,
  'follow-device-preferences': 1,
  'no-soft-hyphen-characters': 1,
  'stored-writes-go-through-cleared': 2,
  'tap-elements-not-points': 3,
  'handle-lost-gpu-context': 3,
  'schedule-before-echo-loads': 9,
};

function checkRules() {
  const names = Object.keys(lantern.rules);
  expect(names.sort().join() === Object.keys(RULE_FINDINGS).sort().join(), `every rule needs a fixture: ${names}`);
  const config = path.join(scratch, 'oxlintrc.json');
  const rules = Object.fromEntries(names.map((name) => [`lantern/${name}`, 'error']));
  const plugin = path.join(here, 'rules.mjs');
  fs.writeFileSync(config, JSON.stringify({ categories: { correctness: 'off' }, jsPlugins: [plugin], rules }));
  const args = ['-c', config, '--disable-nested-config', '-f', 'json', fixtures];
  const run = spawnSync(bin('oxlint'), args, { encoding: 'utf8' });
  const found = JSON.parse(run.stdout).diagnostics;
  for (const [name, count] of Object.entries(RULE_FINDINGS)) {
    const inFixture = found.filter((d) => path.basename(d.filename).startsWith(`${name}.`));
    const hits = inFixture.filter((d) => d.code === `lantern(${name})`).length;
    expect(hits === count && inFixture.length === count, `${name}: ${hits} of ${count} expected findings`);
  }
}

function checkStyles() {
  const run = spawnSync(bin('stylelint'), [path.join(fixtures, 'word-break.css'), '-f', 'json'], {
    cwd: root,
    encoding: 'utf8',
  });
  const warnings = JSON.parse(run.stdout || run.stderr)[0].warnings;
  const lines = warnings.filter((w) => w.rule === 'declaration-property-value-disallowed-list').map((w) => w.line);
  expect(lines.join() === '2', `word-break: expected a finding on line 2 only, got ${lines.join() || 'none'}`);
}

function checkWorkflows() {
  const script = path.join(here, 'jobs-read-artifacts-from-their-own-run.mjs');
  const fixture = path.join(fixtures, 'jobs-read-artifacts-from-their-own-run.yml');
  const workflows = path.join(scratch, '.github/workflows');
  fs.mkdirSync(workflows, { recursive: true });
  const ci = path.join(workflows, 'ci.yml');
  const source = fs.readFileSync(fixture, 'utf8');
  fs.writeFileSync(ci, source);
  const check = (file) => spawnSync('node', [script, file], { cwd: scratch, encoding: 'utf8' });
  const run = check(ci);
  const found = run.stderr.trim().split('\n');
  expect(run.status === 1 && found.length === 15, `own-run artifacts: expected 15 findings:\n${run.stderr}`);
  for (const job of ['null_job', 'scalar_job', 'array_job']) {
    expect(found.includes(`${ci}: ${job}: expected a job mapping`), `own-run artifacts: missed invalid ${job}`);
  }
  expect(!run.stderr.includes('    at '), `own-run artifacts: invalid jobs threw:\n${run.stderr}`);
  for (const job of ['plan', 'e2e', 'timings', 'by_id', 'shell_download', 'shell_api', 'multiline_api']) {
    expect(found.some((line) => line.includes(`: ${job} step `)), `own-run artifacts: missed ${job}`);
  }
  expect(!found.some((line) => line.includes(': plan step 1 ')), 'own-run artifacts: plan find was rejected');
  const other = path.join(workflows, 'other.yml');
  fs.writeFileSync(other, source);
  const elsewhere = check(other);
  expect(elsewhere.status === 1 && elsewhere.stderr.trim().split('\n').length === 17,
    `own-run artifacts: another workflow's plan find was allowed:\n${elsewhere.stderr}`);
  for (const [before, after] of [
    ['-n e2e-timings', "--pattern '*'"],
    ['?name=e2e-timings&per_page=50', '/123/zip'],
  ]) {
    fs.writeFileSync(ci, source.replace(before, after));
    const unnamed = check(ci);
    expect(unnamed.status === 1 && unnamed.stderr.includes(': plan step 1 '),
      `own-run artifacts: plan find allowed an unnamed download:\n${unnamed.stderr}`);
  }
  const local = path.join(scratch, 'local.yml');
  fs.writeFileSync(local, 'jobs:\n  e2e:\n    steps:\n      - uses: actions/download-artifact@v8\n' +
    '        with:\n          name: e2e-plan-timings\n');
  const allowed = check(local);
  expect(allowed.status === 0, `own-run artifacts: a same-run download failed:\n${allowed.stderr}`);
  for (const source of ['', 'name: no jobs\n', 'jobs: []\n']) {
    fs.writeFileSync(local, source);
    const missing = check(local);
    expect(missing.status === 1 && missing.stderr.includes('expected a jobs mapping') &&
      !missing.stderr.includes('    at '), `own-run artifacts: missing jobs threw:\n${missing.stderr}`);
  }
}

function checkDiffLimits() {
  const repo = path.join(scratch, 'repo');
  fs.mkdirSync(repo);
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
  const git = (...args) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' }).trim();
  const write = (file, lines) => fs.writeFileSync(path.join(repo, file), lines.join('\n') + '\n');
  const many = (n) => Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`);
  const long = (n) => `export const s = '${'x'.repeat(n - 20)}';`;
  const commit = (message) => {
    git('add', '-A');
    git('commit', '-q', '--no-verify', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  const limits = (base = '') =>
    spawnSync('node', [path.join(here, 'diff-limits.mjs')], {
      cwd: repo,
      env: { ...env, LINT_BASE: base },
      encoding: 'utf8',
    });

  git('init', '-q', '-b', 'main');
  write('big.ts', many(1001));
  write('lines.ts', [long(130), 'export const a = 1;']);
  const base = commit('base');

  write('big.ts', many(1002));
  write('lines.ts', [long(130), 'export const a = 1;', long(121)]);
  write('huge.ts', many(1001));
  commit('grows');
  const grows = limits(base);
  const said = grows.stderr;
  expect(grows.status === 1, 'diff limits: a growing pull request passed');
  expect(said.includes('lines.ts:3: 121 characters'), `diff limits: the new long line was missed:\n${said}`);
  expect(!said.includes('lines.ts:1:'), 'diff limits: a long line the pull request left alone was reported');
  expect(said.includes('big.ts grows from 1001 to 1002'), `diff limits: the growing file was missed:\n${said}`);
  expect(said.includes('huge.ts is new at 1001'), `diff limits: the new large file was missed:\n${said}`);

  git('checkout', '-q', '-b', 'shrinks', base);
  write('big.ts', many(1000).map((line, i) => (i === 5 ? 'export const changed = 5;' : line)));
  write('lines.ts', [long(130), 'export const a = 2;']);
  commit('shrinks');
  const shrinks = limits(base);
  expect(shrinks.status === 0, `diff limits: a pull request within the limits failed:\n${shrinks.stderr}`);

  for (const [missing, said] of [['', 'origin/main'], ['deadbeef', 'deadbeef']]) {
    const lost = limits(missing);
    expect(
      lost.status === 1 && lost.stderr.includes(`Can't find ${said}`) && !lost.stderr.includes('    at '),
      `diff limits: a missing ${said} did not say how to fix it:\n${lost.stderr}`,
    );
  }
}

try {
  checkRules();
  checkStyles();
  checkWorkflows();
  checkDiffLimits();
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Every lint rule fails on its fixture, and the line and file size limits hold.');
