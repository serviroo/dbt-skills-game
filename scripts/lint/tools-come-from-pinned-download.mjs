import fs from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';

const helper = path.resolve('.github/actions/pinned-download/action.yml');
const fetches = /\b(?:curl|wget|Invoke-WebRequest|iwr)\b|\bgh\s+release\s+download\b|\/releases\/download\//;
const yaml = (dir) => fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter((f) => /\.ya?ml$/.test(f))
  .map((f) => path.join(dir, f)) : [];
const files = process.argv.slice(2);
if (!files.length) files.push(...yaml('.github/workflows'), ...yaml('.github/actions'));
const problems = [];
for (const file of files) {
  if (path.resolve(file) === helper) continue;
  const doc = load(fs.readFileSync(file, 'utf8'), { filename: file });
  const jobs = Object.entries(doc?.jobs ?? {}).map(([name, job]) => [name, job?.steps]);
  if (Array.isArray(doc?.runs?.steps)) jobs.push(['runs', doc.runs.steps]);
  for (const [job, steps] of jobs) {
    for (const [index, step] of (Array.isArray(steps) ? steps : []).entries()) {
      if (fetches.test(String(step?.run ?? ''))) {
        problems.push(`${file}: ${job} step ${index + 1} downloads at run time; use ./.github/actions/pinned-download`);
      }
    }
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('tools-come-from-pinned-download: passed');
