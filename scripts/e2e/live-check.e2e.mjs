// scripts/live-check.mjs reports a browser whose renderer it can't verify as a failed check, so the report a failed
// deploy uploads says why it failed.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const scenarios = {
  async 'live-check-reports-renderer-failure'({ out, expect }) {
    // loaded before the live check, this gives its browser no WebGL on any machine
    const noWebgl = path.join(out, 'live-check-no-webgl.mjs');
    fs.writeFileSync(noWebgl, `import { chromium } from ${JSON.stringify(pathToFileURL(path.join(root, 'node_modules/playwright/index.mjs')).href)};
const launch = chromium.launch.bind(chromium);
chromium.launch = (options) => launch({ ...options, args: [...options.args, '--disable-webgl'] });
`);
    // a port nothing listens on, so every other check fails at once
    const port = await new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
    const args = ['--import', pathToFileURL(noWebgl).href, path.join(root, 'scripts/live-check.mjs'), `http://127.0.0.1:${port}/`, '--wait=0'];
    const run = await new Promise((resolve) => execFile(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 120000 }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr })));
    expect(run.code === 1, `the live check exited with ${run.code}:\n${run.stdout}\n${run.stderr}`);
    const dir = /artifacts in (\S+)/.exec(run.stdout)?.[1];
    expect(dir, 'the live check printed no artifacts folder:\n' + run.stdout + run.stderr);
    const report = JSON.parse(fs.readFileSync(path.join(root, dir, 'report.json'), 'utf8'));
    const renderer = report.checks.find((c) => c.name === 'renderer');
    expect(report.ok === false, 'the report says the run passed: ' + JSON.stringify(report.checks.map((c) => [c.name, c.ok])));
    expect(renderer?.ok === false && /WebGL renderer cannot be verified: no webgl/.test(renderer.error), 'the report has no failed renderer check: ' + JSON.stringify(renderer));
  },
};
