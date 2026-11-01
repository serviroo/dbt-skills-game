// A partial copy of the repo, like the ones the icon build and the stored-ids guard run in, brings every module its
// files load: all Vite builds vite.config.ts from, however the config names it, and all a script's imports load in Node.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { loadConfigFromFile } from 'vite';
import { copyFiles, nodeImports, viteConfigFiles } from './harness.mjs';

// a checkout whose build config and script load new modules every way Vite and Node allow, and one module neither loads
const CHECKOUT = {
  'package.json': '{ "type": "module" }\n',
  'vite.config.ts': "import { a } from './config/a';\nimport b from './config/b';\nimport { c } from './config/c.js';\nexport default { define: { LOADED: JSON.stringify(a + b + c) } };\n",
  'config/a.ts': "export * from './deep/a.mjs';\n",
  'config/deep/a.mjs': "export const a = 'a';\n",
  'config/b/index.js': "export default 'b';\n",
  'config/c.ts': "export const c: string = 'c';\n",
  'scripts/run.mjs': "import { d } from './d.mjs';\nimport { e } from '../e.mjs';\nconst { f } = await import('./f/f.mjs');\nconsole.log(d + e + f);\n",
  'scripts/d.mjs': "export { d } from './dd.mjs';\n",
  'scripts/dd.mjs': "export const d = 'd';\n",
  'e.mjs': "export const e = 'e';\n",
  'scripts/f/f.mjs': "export const f = 'f';\n",
  'scripts/unused.mjs': "export const u = 'u';\n",
};

export const scenarios = {
  async 'repo-copies-bring-every-module-they-load'({ expect }) {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-copies-'));
    try {
      const from = path.join(scratch, 'from');
      const to = path.join(scratch, 'to');
      for (const [f, code] of Object.entries(CHECKOUT)) {
        fs.mkdirSync(path.dirname(path.join(from, f)), { recursive: true });
        fs.writeFileSync(path.join(from, f), code);
      }
      copyFiles(to, ['package.json', ...(await viteConfigFiles(from)), ...nodeImports('scripts/run.mjs', from)], from);
      expect(!fs.existsSync(path.join(to, 'scripts/unused.mjs')), 'the copy took a module nothing loads, so it is not partial');

      const { config } = await loadConfigFromFile({ command: 'build', mode: 'production' }, path.join(to, 'vite.config.ts'), to, 'silent');
      expect(config.define.LOADED === '"abc"', "the copy's config did not load what the original does: " + JSON.stringify(config.define));
      const { stdout } = await promisify(execFile)(process.execPath, [path.join(to, 'scripts/run.mjs')], { encoding: 'utf8' });
      expect(stdout === 'def\n', 'the copied script did not load what the original does: ' + stdout);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  },
};
