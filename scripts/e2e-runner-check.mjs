import './gl.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { holdDaily } from './e2e/first-actions.e2e.mjs';
import { runIconChild } from './e2e/icons.e2e.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = `runner-check-${process.pid}`;
const out = path.join(root, 'artifacts/e2e', `${name}-${Date.now()}`);
const fixture = path.join(root, 'scripts/e2e', `${name}.e2e.mjs`);
const duplicate = path.join(root, 'scripts/e2e', `${name}-duplicate.e2e.mjs`);
const side = path.join(root, 'scripts/e2e', `${name}-side.e2e.mjs`);
const state = path.join(out, 'state.json');
const results = [];
fs.mkdirSync(out, { recursive: true });

async function run(label, args, interrupt = null) {
  fs.rmSync(state, { force: true });
  const child = spawn(process.execPath, [path.join(root, 'scripts/e2e.mjs'), ...args], { cwd: out, env: { ...process.env, DEBUG: 'pw:browser' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, 90000);
  const killTimer = setTimeout(() => child.kill('SIGKILL'), 100000);
  const collect = (data) => {
    log += data;
    if (interrupt && log.includes('fixture ready')) { const signal = interrupt; interrupt = null; child.kill(signal); }
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
  await assert.rejects(runIconChild(['-e', "console.log('before the error ' + 'x'.repeat(945)); throw new Error('icon draw failed')"]), (error) => {
    assert.match(error.message, /exit code 1/);
    assert(error.message.includes('before the error ' + 'x'.repeat(945)));
    assert.match(error.message, /Error: icon draw failed\n\s+at /);
    assert.equal(error.cause.code, 1);
    assert(error.message.includes(error.cause.stdout));
    assert(error.message.includes(error.cause.stderr));
    return true;
  });
  await assert.rejects(runIconChild(['-e', "process.kill(process.pid, 'SIGKILL')"]), (error) => {
    assert.match(error.message, /signal SIGKILL/);
    assert.equal(error.cause.signal, 'SIGKILL');
    return true;
  });
  await assert.rejects(runIconChild(['-e', 'process.exit(1)']), (error) => {
    assert.match(error.message, /exit code 1/);
    assert.equal(error.cause.code, 1);
    return true;
  });
  await assert.rejects(runIconChild(['-e', "console.log('partial stdout'); console.error('partial stderr'); setInterval(() => {}, 1000)"], { timeout: 500 }), (error) => {
    assert.match(error.message, /timed out after 500 ms/);
    assert.match(error.message, /partial stdout/);
    assert.match(error.message, /partial stderr/);
    assert.equal(error.cause.signal, 'SIGKILL');
    assert.equal(error.cause.killed, true);
    return true;
  });
  results.push({ label: 'icon-child-failures', cases: 4 });
  // a sleep that ends early, here at half its time, still holds the companion module 9 s by the clock that measures it
  const held = [];
  const loaded = [];
  let hold;
  holdDaily({ sleep: (ms) => new Promise((r) => setTimeout(r, ms / 2)) }, held)({ route: (_, fn) => (hold = fn) });
  const t = performance.now();
  await hold({ continue: async () => loaded.push(performance.now() - t) });
  assert(held.length === 1 && held[0] >= 9000 && loaded[0] >= 9000, `the companion module was held ${JSON.stringify(held)} ms and loaded after ${JSON.stringify(loaded)} ms`);
  results.push({ label: 'companion-hold', held: held[0] });
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
export const serial = true;
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
    return { kept: [h.flags.probe] };
  },
};
`, { flag: 'wx' });
  const selected = await run('scenario-from-other-cwd', [`--scenario=${name}-clean`, '--probe=a=b']);
  assert.equal(selected.code, 0);
  assert.deepEqual(selected.report.scenarios.map((s) => [s.name, s.file, s.ok, s.result]), [[`${name}-clean`, name, true, { kept: ['a=b'] }]]);
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
    async '${name}-popup-throttle-failure'(h) {
      record(h);
      const ctx = await h.browser.newContext();
      const page = await ctx.newPage();
      ctx.newCDPSession = async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        throw new Error('popup throttle refused');
      };
      const popup = ctx.waitForEvent('page');
      await page.evaluate(() => void window.open('about:blank'));
      await popup;
    },
  };`);
  const reportError = await run('report-write-error', [`--scenario=${name}-report-error`]);
  assert.notEqual(reportError.code, 0);
  assert.match(reportError.log, /EISDIR/);
  const throttle = await run('popup-throttle-failure', [`--scenario=${name}-popup-throttle-failure`, '--cpu-throttle=4']);
  assert.notEqual(throttle.code, 0);
  assert.match(throttle.log, /CPU throttle 4: popup throttle refused/);
  assert.deepEqual(throttle.report.throttleErrors, ['CPU throttle 4: popup throttle refused']);
  const signal = await run('signal-cleanup', [`--scenario=${name}-signal`], 'SIGTERM');
  assert.equal(signal.code, 130);
  const sigint = await run('sigint-cleanup', [`--scenario=${name}-signal`], 'SIGINT');
  assert.equal(sigint.code, 130);
  fs.writeFileSync(duplicate, `export const scenarios = { '${name}-signal': async () => {} };`, { flag: 'wx' });
  const collision = await run('duplicate-name', [`--file=${name}`]);
  assert.notEqual(collision.code, 0);
  assert.match(collision.log, /is in both/);
  assert(!collision.log.includes('renderer:'));
  fs.unlinkSync(duplicate);
  const missing = await run('missing-file', ['--file=does-not-exist']);
  assert.notEqual(missing.code, 0);
  assert.match(missing.log, /no scenario file/);
  // scenarios in a file that isn't serial run side by side, each in a browser of its own, and every browser is stopped
  fs.writeFileSync(side, prelude.replace('export const serial = true;', '') + `
async function meet(h, me) {
  if (me === 'a') record(h);
  const { page } = await h.open({ 'dbt.app.v1': h.SEEN });
  h.expect(await page.title() === 'The Lantern', 'app did not load');
  h.expect(h.browser.contexts().length === 1, 'another scenario opened a profile in this browser');
  const met = (h.shared.met ??= {});
  met[me] = h.browser;
  for (const end = Date.now() + 20000; !(met.a && met.b); await h.sleep(100)) h.expect(Date.now() < end, 'the other scenario did not run at the same time');
  h.expect(met.a !== met.b, 'both scenarios ran in one browser');
  if (h.flags.hold) {
    console.log('fixture ready');
    await page.waitForTimeout(60000);
  }
}
export const scenarios = {
  '${name}-side-a': (h) => meet(h, 'a'),
  '${name}-side-b': (h) => meet(h, 'b'),
};
`, { flag: 'wx' });
  const both = await run('side-by-side', [`--file=${name}-side`, '--jobs=2']);
  assert.equal(both.code, 0);
  assert.equal(both.report.jobs, 2);
  assert.deepEqual(both.report.scenarios.map((s) => [s.name, s.ok]), [[`${name}-side-a`, true], [`${name}-side-b`, true]]);
  assert.equal([...both.log.matchAll(/<launched> pid=/g)].length, 2);
  const bothSignal = await run('side-by-side-signal', [`--file=${name}-side`, '--jobs=2', '--hold'], 'SIGTERM');
  assert.equal(bothSignal.code, 130);
  fs.unlinkSync(side);
  for (const key of ['file', 'scenario', 'jobs']) {
    const empty = await run(`empty-${key}`, [`--${key}=`]);
    assert.notEqual(empty.code, 0);
    assert.match(empty.log, new RegExp(`--${key} needs a value`));
    assert(!empty.log.includes('renderer:'));
  }
  const startup = await run('startup-failure', [`--scenario=${name}-signal`, '--host=invalid.invalid']);
  assert.notEqual(startup.code, 0);
  assert.match(startup.log, /no free port/);
} finally {
  for (const file of [fixture, duplicate, side]) fs.rmSync(file, { force: true });
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(results, null, 2));
}
console.log(`${results.length} runner checks passed, artifacts in ${path.relative(root, out)}`);
