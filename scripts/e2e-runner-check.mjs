import './gl.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

async function run(label, args, interrupt = null, env = {}) {
  fs.rmSync(state, { force: true });
  const child = spawn(process.execPath, [path.join(root, 'scripts/e2e.mjs'), ...args], { cwd: out, env: { ...process.env, DEBUG: 'pw:browser', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
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

/** Starts scripts/e2e-browser.mjs as the machine with the GPU would. stop() ends it with Ctrl+C's signal and checks its browser went too. */
async function startRemote(args, nodeArgs = []) {
  const child = spawn(process.execPath, [...nodeArgs, path.join(root, 'scripts/e2e-browser.mjs'), ...args], { cwd: out, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  const timer = setTimeout(() => child.kill('SIGTERM'), 30000);
  const endpoint = await new Promise((resolve, reject) => {
    const collect = (data) => {
      log += data;
      const m = /^ws:\/\/\S+$/m.exec(log);
      if (m) resolve(m[0]);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    exited.then(({ code, signal }) => reject(new Error(`scripts/e2e-browser.mjs ended (code ${code}, signal ${signal}) without an endpoint:\n${log}`)));
  }).finally(() => clearTimeout(timer));
  const children = execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' }).trim().split('\n').map((line) => line.trim().split(/\s+/).map(Number)).filter(([, ppid]) => ppid === child.pid).map(([pid]) => pid);
  const stop = async () => {
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 10000);
    child.kill('SIGINT');
    const { signal } = await exited;
    clearTimeout(killTimer);
    fs.writeFileSync(path.join(out, 'remote-browser.log'), log);
    assert.notEqual(signal, 'SIGKILL', 'scripts/e2e-browser.mjs did not stop on Ctrl+C');
    assert.equal(children.length, 1, `scripts/e2e-browser.mjs started ${children.length} processes`);
    assert.throws(() => process.kill(children[0], 0), { code: 'ESRCH' }, 'the remote browser survived its script');
  };
  return { endpoint, stop };
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
import { checkRenderer } from '../gl.mjs';
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
    // written the moment it starts, in the same tick of the disk's clock as its mark
    fs.writeFileSync(path.join(h.out, '${name}-first.txt'), 'first');
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
  async '${name}-masked-renderer'(h) {
    record(h);
    const { page } = await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', undefined, (ctx) => ctx.addInitScript(() => {
      const get = WebGL2RenderingContext.prototype.getExtension;
      WebGL2RenderingContext.prototype.getExtension = function (name) {
        return name === 'WEBGL_debug_renderer_info' ? null : get.call(this, name);
      };
    }));
    let error;
    try { await checkRenderer(page); } catch (e) { error = e; }
    h.expect(error?.message === 'WebGL renderer cannot be verified: WebKit WebGL', 'a masked renderer was not rejected: ' + error?.message);
  },
};
`, { flag: 'wx' });
  const selected = await run('scenario-from-other-cwd', [`--scenario=${name}-clean`, '--probe=a=b']);
  assert.equal(selected.code, 0);
  assert.deepEqual(selected.report.scenarios.map((s) => [s.name, s.file, s.ok, s.result]), [[`${name}-clean`, name, true, { kept: ['a=b'] }]]);
  const masked = await run('masked-renderer', [`--scenario=${name}-masked-renderer`]);
  assert.equal(masked.code, 0);
  assert.equal(masked.report.scenarios[0].ok, true);
  const failed = await run('failure-and-continuation', [`--file=${name}`, '--probe=a=b']);
  assert.notEqual(failed.code, 0);
  assert(failed.report.scenarios.some((s) => s.name === `${name}-fail` && !s.ok && /deliberate runner failure/.test(s.error)));
  assert(failed.report.scenarios.some((s) => s.name === `${name}-clean` && s.ok));
  // what the failed scenario wrote, its own screenshot and its page's evidence, is kept in failed/<scenario>/ of the run's
  // folder, which CI uploads, and nothing of the scenarios that passed
  const failedOut = JSON.parse(fs.readFileSync(state, 'utf8')).out;
  const kept = fs.readdirSync(path.join(failedOut, 'failed'), { recursive: true }).sort();
  assert(fs.existsSync(path.join(failedOut, `${name}-clean.png`)), 'the passing scenario wrote no screenshot');
  assert(['first.txt', 'failure.png', 'fail-1.json'].every((f) => kept.includes(path.join(`${name}-fail`, f.startsWith('fail-') ? `fail-${name}-${f}` : `${name}-${f}`))), `failed/ lacks the failed scenario's first file, screenshot or evidence: ${JSON.stringify(kept)}`);
  assert(kept.every((f) => f.split(path.sep)[0] === `${name}-fail`) && !kept.some((f) => f.includes('clean')), `failed/ holds more than the failed scenario's files: ${JSON.stringify(kept)}`);
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
    async '${name}-hang'(h) {
      record(h);
      const { page } = await h.open();
      await h.shot(page, '${name}-before-hang');
      console.log('fixture ready');
      // a wait nothing settles, not even the browser closing, so the runner never gets to this scenario's failure
      await new Promise(() => {});
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
    async '${name}-autoplay'(h) {
      record(h);
      let heard;
      await h.open({ 'dbt.app.v1': h.SEEN }, '?mute', undefined, (ctx) => {
        heard = new Promise((done) => ctx.on('console', (m) => m.text().startsWith('autoplay ') && done(m.text())));
        // the page starts the sound itself: page.evaluate() counts as a tap, and after a tap any browser may play
        return ctx.addInitScript(() => addEventListener('load', () => {
          const audio = new AudioContext();
          const say = () => console.log('autoplay ' + audio.state);
          if (audio.state === 'running') say();
          else {
            audio.onstatechange = say;
            setTimeout(say, 1500);
          }
        }));
      });
      return { audio: await heard };
    },
  };`);
  const reportError = await run('report-write-error', [`--scenario=${name}-report-error`]);
  assert.notEqual(reportError.code, 0);
  assert.match(reportError.log, /EISDIR/);
  const throttle = await run('popup-throttle-failure', [`--scenario=${name}-popup-throttle-failure`, '--cpu-throttle=4']);
  assert.notEqual(throttle.code, 0);
  assert.match(throttle.log, /CPU throttle 4: popup throttle refused/);
  assert.deepEqual(throttle.report.throttleErrors, ['CPU throttle 4: popup throttle refused']);
  // a browser started for --ws listens on 127.0.0.1 only and has a local run's flags (with this check's --software
  // choice), the run keeps its dev server on the --port a tunnel forwards, and a run that expects the other renderer says
  // where that browser's flags are set
  const refused = await startRemote(['--host=0.0.0.0']).then(async (r) => { await r.stop(); return 'it listened at ' + r.endpoint; }, (e) => e.message);
  assert.match(refused, /--host is not an option: the browser listens on 127\.0\.0\.1 only/);
  const software = process.env.LANTERN_GL === 'software';
  const remote = await startRemote(software ? ['--software'] : []);
  try {
    assert.equal(new URL(remote.endpoint).hostname, '127.0.0.1', 'the browser server listens at ' + remote.endpoint);
    const port = await freePort();
    const viaWs = await run('remote-browser', [`--scenario=${name}-autoplay`, `--ws=${remote.endpoint}`, `--port=${port}`]);
    assert.equal(viaWs.code, 0);
    assert.equal(viaWs.report.url, `http://127.0.0.1:${port}`);
    assert.equal(/SwiftShader/.test(viaWs.report.renderer), software, viaWs.report.renderer);
    assert.deepEqual(viaWs.report.scenarios.map((s) => [s.ok, s.result]), [[true, { audio: 'autoplay running' }]]);
    const mismatch = await run('remote-renderer-mismatch', [`--scenario=${name}-autoplay`, `--ws=${remote.endpoint}`, `--port=${await freePort()}`], null, { LANTERN_GL: software ? undefined : 'software' });
    assert.notEqual(mismatch.code, 0);
    assert(mismatch.log.includes(`; a --ws browser gets its flags where it was started, so start it with node scripts/e2e-browser.mjs${software ? '' : ' --software'}\n`), mismatch.log);
  } finally {
    await remote.stop();
  }
  // a run over --ws must name the port its tunnel forwards, and stops before any scenario when the browser reaches some
  // other server there: this browser sends everything, loopback included, to a stand-in for another dev server
  const unforwarded = await run('ws-without-port', [`--scenario=${name}-autoplay`, '--ws=ws://127.0.0.1:9/unused']);
  assert.notEqual(unforwarded.code, 0);
  assert.match(unforwarded.log, /--ws needs --port/);
  const decoy = http.createServer((req, res) => res.end('<!doctype html><title>Another dev server</title>')).listen(0, '127.0.0.1');
  await once(decoy, 'listening');
  const toDecoy = path.join(out, 'to-decoy.mjs');
  fs.writeFileSync(toDecoy, `import { chromium } from ${JSON.stringify(pathToFileURL(path.join(root, 'node_modules/playwright/index.mjs')).href)};
const launchServer = chromium.launchServer.bind(chromium);
chromium.launchServer = (options) => launchServer({ ...options, args: [...options.args, '--proxy-server=http://127.0.0.1:${decoy.address().port}', '--proxy-bypass-list=<-loopback>'] });
`);
  const elsewhere = await startRemote(software ? ['--software'] : [], ['--import', pathToFileURL(toDecoy).href]);
  try {
    const wrong = await run('remote-wrong-server', [`--scenario=${name}-autoplay`, `--ws=${elsewhere.endpoint}`, `--port=${await freePort()}`]);
    assert.notEqual(wrong.code, 0);
    assert.match(wrong.log, /the browser does not reach this run's dev server at http:\/\/127\.0\.0\.1:\d+ \(<!doctype html><title>Another dev server/);
  } finally {
    await elsewhere.stop();
    decoy.close();
  }
  const signal = await run('signal-cleanup', [`--scenario=${name}-signal`], 'SIGTERM');
  assert.equal(signal.code, 130);
  const sigint = await run('sigint-cleanup', [`--scenario=${name}-signal`], 'SIGINT');
  assert.equal(sigint.code, 130);
  // a scenario that hangs where closing the browser can't reach, stopped as its CI step runs out of time: the runner never
  // gets to its failure and keeps nothing itself, but its mark in running/ says it was cut off, and scripts/e2e/keep.mjs
  // (CI's next step) keeps what it wrote for the upload
  const hang = await run('hang-kept', [`--scenario=${name}-hang`], 'SIGINT');
  assert.notEqual(hang.code, 0);
  const hangOut = JSON.parse(fs.readFileSync(state, 'utf8')).out;
  assert(fs.existsSync(path.join(hangOut, `${name}-before-hang.png`)), 'the hung scenario wrote no screenshot');
  assert(!fs.existsSync(path.join(hangOut, 'failed')) && fs.readdirSync(path.join(hangOut, 'running')).length === 1, 'the runner itself got to the hung scenario, so this checks nothing');
  const keepRun = () => spawnSync(process.execPath, [path.join(root, 'scripts/e2e/keep.mjs'), hangOut], { cwd: out, encoding: 'utf8' });
  const hangKept = [`${name}-hang`, path.join(`${name}-hang`, `${name}-before-hang.png`)].sort();
  // a folder it can't read costs only itself: what it can read is kept, it says what it couldn't, exits 1 and keeps the mark
  const locked = path.join(hangOut, 'locked');
  fs.mkdirSync(locked);
  fs.chmodSync(locked, 0o000);
  let partial;
  try {
    partial = keepRun();
  } finally {
    fs.chmodSync(locked, 0o755);
    fs.rmdirSync(locked);
  }
  assert.equal(partial.status, 1, partial.stdout + partial.stderr);
  assert.match(partial.stdout, new RegExp(`^${name}-hang was cut off midway: .* but not locked: EACCES`, 'm'));
  assert.deepEqual(fs.readdirSync(path.join(hangOut, 'failed'), { recursive: true }).sort(), hangKept);
  assert.equal(fs.readdirSync(path.join(hangOut, 'running')).length, 1, 'keep.mjs dropped the mark of a scenario it could not keep whole');
  const whole = keepRun();
  assert.equal(whole.status, 0, whole.stdout + whole.stderr);
  assert.match(whole.stdout, new RegExp(`^${name}-hang was cut off midway: what it wrote is kept in \\S+$`, 'm'));
  const hangFiles = fs.readdirSync(path.join(hangOut, 'failed'), { recursive: true });
  assert.deepEqual(hangFiles.sort(), hangKept, `failed/ after keep.mjs: ${JSON.stringify(hangFiles)}`);
  assert.equal(fs.readdirSync(path.join(hangOut, 'running')).length, 0, 'keep.mjs left the mark of the scenario it kept');
  fs.writeFileSync(duplicate, `export const scenarios = { '${name}-signal': async () => {} };`, { flag: 'wx' });
  const collision = await run('duplicate-name', [`--file=${name}`]);
  assert.notEqual(collision.code, 0);
  assert.match(collision.log, /is in both/);
  assert(!collision.log.includes('renderer:'));
  fs.writeFileSync(duplicate, `export const scenarios = {\n  async '${name}-twice'() {},\n  async '${name}-twice'() {},\n};`);
  const twice = await run('duplicate-key', [`--scenario=${name}-twice`]);
  assert.notEqual(twice.code, 0);
  assert.match(twice.log, new RegExp(`"${name}-twice" on line 3 a second time`));
  assert(!twice.log.includes('renderer:'));
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
  const busy = net.createServer().listen(0, '127.0.0.1');
  await once(busy, 'listening');
  const { port: busyPort } = busy.address();
  const taken = await run('pinned-port-taken', [`--scenario=${name}-signal`, `--port=${busyPort}`]);
  busy.close();
  assert.notEqual(taken.code, 0);
  assert.match(taken.log, new RegExp(`dev server port ${busyPort} is taken`));
} finally {
  for (const file of [fixture, duplicate, side]) fs.rmSync(file, { force: true });
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(results, null, 2));
}
console.log(`${results.length} runner checks passed, artifacts in ${path.relative(root, out)}`);
