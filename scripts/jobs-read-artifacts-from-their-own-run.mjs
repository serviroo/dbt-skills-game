import fs from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';

const dir = '.github/workflows';
const files = process.argv.slice(2);
if (!files.length) {
  files.push(...fs.readdirSync(dir).filter((file) => /\.ya?ml$/.test(file)).map((file) => path.join(dir, file)));
}
const problems = [];
for (const file of files) {
  const workflow = load(fs.readFileSync(file, 'utf8'), { filename: file });
  for (const [job, config] of Object.entries(workflow.jobs)) {
    if (job === 'plan') continue;
    for (const [index, step] of (config.steps ?? []).entries()) {
      if (!/^actions\/download-artifact@/.test(step.uses ?? '')) continue;
      const crossRun = ['run-id', 'artifact-ids'].filter((key) => Object.hasOwn(step.with ?? {}, key));
      if (crossRun.length) {
        problems.push(`${file}: ${job} step ${index + 1} uses ${crossRun.join(', ')}; only plan may read another run`);
      }
    }
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('jobs-read-artifacts-from-their-own-run: passed');
