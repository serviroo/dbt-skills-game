import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = `runner-check-${process.pid}`;
const out = path.join(root, 'artifacts/e2e', `${name}-${Date.now()}`);
const fixture = path.join(root, 'scripts/e2e', `${name}.e2e.mjs`);
const duplicate = path.join(root, 'scripts/e2e', `${name}-duplicate.e2e.mjs`);
const state = path.join(out, 'state.json');
const results = [];
fs.mkdirSync(out, { recursive: true });

async function run(label, args, interrupt = false) {
  fs.rmSync(state, { force: true });
  const child = spawn(process.execPath, [path.join(root, 'scripts/e2e.mjs'), ...args], { cwd: out, env: { ...process.env, DEBUG: 'pw:browser' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, 90000);
  const killTimer = setTimeout(() => child.kill('SIGKILL'), 100000);
  const collect = (data) => {
    log += data;
    if (interrupt && log.includes('fixture ready')) { interrupt = false; child.kill('SIGTERM'); }
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  clearTimeout(timer);
  clearTimeout(killTimer);
  fs.writeFileSync(path.join(out, `${label}.log`), log);
  assert(!timedOut, `${label} timed out`);
  for (const match of log.matchAll(/<launched> pid=(\d+)/g)) {
    assert.throws(() => process.kill(Number(match[1]), 0), { code: 'ESRCH' }, `${label}: browser survived`);
  }
  let report;
  if (fs.existsSync(state)) {
    const saved = JSON.parse(fs.readFileSync(state, 'utf8'));
    assert(saved.disconnected, `${label}: browser did not disconnect`);
    for (const pid of saved.children) {
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `${label}: child ${pid} survived`);
    }
    await assert.rejects(fetch(saved.url, { signal: AbortSignal.timeout(2000) }), `${label}: server survived`);
    const file = path.join(saved.out, 'report.json');
    if (fs.existsSync(file) && fs.statSync(file).isFile()) report = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  results.push({ label, code, report: report ? path.join(JSON.parse(fs.readFileSync(state, 'utf8')).out, 'report.json') : null });
  return { code, log, report };
}

try {
  fs.writeFileSync(fixture, `
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const state = ${JSON.stringify(state)};
function record(h) {
  const children = execFileSync('ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8' }).trim().split(String.fromCharCode(10)).map((line) => line.trim().split(/\\s+/)).filter((fields) => Number(fields[1]) === process.pid && path.basename(fields[2]) !== 'ps').map((fields) => Number(fields[0]));
  const saved = { url: h.server.url, out: h.out, children, disconnected: false };
  fs.writeFileSync(state, JSON.stringify(saved));
  h.browser.once('disconnected', () => fs.writeFileSync(state, JSON.stringify({ ...saved, disconnected: true })));
}
export const scenarios = {
  async '${name}-fail'(h) {
    record(h);
    const { page } = await h.open({ 'dbt.app.v1': h.SEEN });
    h.expect(await page.title() === 'The Lantern', 'app did not load');
    await h.shot(page, '${name}-failure');
    h.shared.failed = true;
    throw new Error('deliberate runner failure');
  },
  async '${name}-clean'(h) {
    h.expect(h.browser.contexts().length === 0, 'previous scenario left contexts open');
    if (!h.shared.failed) record(h);
    h.expect(h.flags.probe === 'a=b', 'flag value was truncated');
    const { page } = await h.open({ 'dbt.app.v1': h.SEEN });
    h.expect(await page.title() === 'The Lantern', 'app did not load');
    await h.shot(page, '${name}-clean');
  },
};
`, { flag: 'wx' });
  const selected = await run('scenario-from-other-cwd', [`--scenario=${name}-clean`, '--probe=a=b']);
  assert.equal(selected.code, 0);
  assert.deepEqual(selected.report.scenarios.map((s) => [s.name, s.file, s.ok]), [[`${name}-clean`, name, true]]);
  const failed = await run('failure-and-continuation', [`--file=${name}`, '--probe=a=b']);
  assert.notEqual(failed.code, 0);
  assert(failed.report.scenarios.some((s) => s.name === `${name}-fail` && !s.ok && /deliberate runner failure/.test(s.error)));
  assert(failed.report.scenarios.some((s) => s.name === `${name}-clean` && s.ok));
  const prelude = fs.readFileSync(fixture, 'utf8').split('export const scenarios = {')[0];
  fs.writeFileSync(fixture, prelude + `export const scenarios = {
    async '${name}-report-error'(h) {
      record(h);
      fs.mkdirSync(path.join(h.out, 'report.json'));
    },
    async '${name}-signal'(h) {
      record(h);
      const { page } = await h.open();
      console.log('fixture ready');
      await page.waitForTimeout(60000);
    },
  };`);
  const reportError = await run('report-write-error', [`--scenario=${name}-report-error`]);
  assert.notEqual(reportError.code, 0);
  assert.match(reportError.log, /EISDIR/);
  const signal = await run('signal-cleanup', [`--scenario=${name}-signal`], true);
  assert.equal(signal.code, 130);
  fs.writeFileSync(duplicate, `export const scenarios = { '${name}-signal': async () => {} };`, { flag: 'wx' });
  const collision = await run('duplicate-name', [`--file=${name}`]);
  assert.notEqual(collision.code, 0);
  assert.match(collision.log, /is in both/);
  assert(!collision.log.includes('renderer:'));
  fs.unlinkSync(duplicate);
  const missing = await run('missing-file', ['--file=does-not-exist']);
  assert.notEqual(missing.code, 0);
  assert.match(missing.log, /no scenario file/);
  const startup = await run('startup-failure', [`--scenario=${name}-signal`, '--host=invalid.invalid']);
  assert.notEqual(startup.code, 0);
  assert.match(startup.log, /no free port/);
} finally {
  for (const file of [fixture, duplicate]) fs.rmSync(file, { force: true });
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(results, null, 2));
}
console.log(`${results.length} runner checks passed, artifacts in ${path.relative(root, out)}`);
