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
  const jobs = load(fs.readFileSync(file, 'utf8'), { filename: file })?.jobs;
  for (const [job, config] of Object.entries(jobs && typeof jobs === 'object' ? jobs : {})) {
    if (/\balways\s*\(/i.test(String(config?.if ?? ''))) {
      problems.push(`${file}: ${job} runs with always(), so a cancelled run starts it; use !cancelled()`);
    }
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('jobs-skip-cancelled-runs: passed');
