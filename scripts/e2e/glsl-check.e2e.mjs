// The build's check for a GLSL smoothstep with its edges the wrong way round (vite.config.ts) reads every file under
// src whatever separator its path uses, so a build on Windows stops on one too.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigFromFile } from 'vite';

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
};
