// The build's check for a GLSL smoothstep with its edges the wrong way round (vite.config.ts) reads every file under
// src whatever separator its path uses, so a build on Windows stops on one too. It knows edges that share a width too.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigFromFile } from 'vite';
import { reversedSmoothsteps } from '../glsl-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const reversed = 'export const glsl = `float a = smoothstep(0.6, 0.2, d);`;\n';

export const scenarios = {
  async 'glsl-check-windows-paths'({ expect }) {
    const { config } = await loadConfigFromFile({ command: 'build', mode: 'production' }, path.join(root, 'vite.config.ts'), root, 'silent');
    const check = config.plugins.flat().find((p) => p?.name === 'lantern-glsl-check');
    expect(check, 'vite.config.ts has no lantern-glsl-check plugin');
    // the error the check raises on `code` at `id` in a project at `at`, or null when it lets the file through
    const run = (at, id, code = reversed) => {
      check.configResolved({ root: at });
      try {
        check.transform.call({ error: (m) => { throw new Error(m); } }, code, id);
        return null;
      } catch (e) {
        return e.message;
      }
    };
    for (const [at, id] of [
      ['/home/sam/dbt', '/home/sam/dbt/src/scene/x.ts'],
      ['C:\\Users\\sam\\dbt', 'C:/Users/sam/dbt/src/scene/x.ts'],
      ['C:\\Users\\sam\\dbt', 'C:\\Users\\sam\\dbt\\src\\scene\\x.ts?v=1'],
      ['C:/Users/sam/dbt', 'C:/Users/sam/dbt/src/scene/x.ts'],
    ]) {
      const error = run(at, id);
      expect(error?.startsWith('src/scene/x.ts:1: smoothstep(0.6, 0.2, d)\n'), `${id} in ${at}: ${error ?? 'the check let it through'}`);
    }
    expect(run('C:\\Users\\sam\\dbt', 'C:/Users/sam/dbt/scripts/x.ts') === null, 'the check read a file outside src');
    expect(run('C:\\Users\\sam\\dbt', 'C:/Users/sam/dbt/src/scene/x.ts', reversed.replace('0.6, 0.2', '0.2, 0.6')) === null, 'the check stopped a smoothstep the right way round');
  },

  /** a width that is not a constant, added to the first edge or taken from the second, puts them the wrong way round */
  async 'glsl-check-shared-width'({ expect }) {
    for (const [edges, wrong] of [
      ['outR(y) + pen, outR(y) - pen', true],
      ['top + pen, top', true],
      ['top, top - pen', true],
      ['a + w * 2.0, a - w * 2.0', true],
      ['outR(y) - pen, outR(y) + pen', false],
      ['top, top + pen', false],
      ['a + w, b - w', false],
      ['a + w, a - u', false],
      ['x * -w, x', false],
      ['a * 1e-3, a', false],
      ['a + b + pen, a + b', true],
      ['a - b, a - b - pen', true],
      ['top - 0.3 + pen, top - 0.3', true],
      ['hw - max(soft, 1e-3), hw', false],
      ['hw, hw - max(soft, 1e-3)', true],
      ['top + (-abs(pen) - 1.0), top', false],
      ['top, top - (pen - 1.0)', false],
      ['top - pen, top + -pen', false],
    ]) {
      const found = reversedSmoothsteps(`export const glsl = \`float a = smoothstep(${edges}, d);\`;\n`).length === 1;
      expect(found === wrong, `smoothstep(${edges}, d): ${wrong ? 'let through' : 'stopped'}`);
    }
  },
};
