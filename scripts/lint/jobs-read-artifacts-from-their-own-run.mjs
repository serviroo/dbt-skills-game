import fs from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';
import { timingsLookupProblems } from './rules.mjs';

const dir = '.github/workflows';
const gh = String.raw`\bgh(?:\s+(?:-R|--repo|--hostname)(?:=|\s+)\S+)*\s+`;
const files = process.argv.slice(2);
if (!files.length) {
  files.push(...fs.readdirSync(dir).filter((file) => /\.ya?ml$/.test(file)).map((file) => path.join(dir, file)));
}
const problems = [];
for (const file of files) {
  const workflow = load(fs.readFileSync(file, 'utf8'), { filename: file });
  if (!workflow?.jobs || typeof workflow.jobs !== 'object' || Array.isArray(workflow.jobs)) {
    problems.push(`${file}: expected a jobs mapping`);
    continue;
  }
  for (const [job, config] of Object.entries(workflow.jobs)) {
    for (const [index, step] of (config.steps ?? []).entries()) {
      const at = `${file}: ${job} step ${index + 1}`;
      if (Object.hasOwn(step.with ?? {}, 'artifact-ids')) {
        problems.push(`${at} uses artifact-ids; download the current artifact by name`);
      }
      if (/^actions\/download-artifact@/.test(step.uses ?? '') && Object.hasOwn(step.with ?? {}, 'run-id')) {
        problems.push(`${at} uses run-id; choose and download by name in ci.yml's plan find step`);
      }
      const find = path.resolve(file) === path.resolve(dir, 'ci.yml') && job === 'plan' && step.id === 'find';
      const shell = String(step.run ?? '').replace(/\\\r?\n/g, ' ');
      if (find) problems.push(...timingsLookupProblems(shell).map((problem) => `${at} ${problem}`));
      const downloads = shell.match(new RegExp(gh + String.raw`run\s+download\b[^\n]*`, 'g')) ?? [];
      const queries = shell.match(new RegExp(gh + String.raw`api\b[^\n]*/artifacts\b[^\n]*`, 'g')) ?? [];
      for (const command of downloads) {
        const named = /\s(?:-n|--name)(?:=|\s+)["']?e2e-timings["']?(?:\s|$)/.test(command);
        if (!find || !named) problems.push(`${at} uses gh run download outside the named plan find download`);
      }
      for (const command of queries) {
        if (!find || !/\/artifacts\?name=e2e-timings(?:&|["'\s]|$)/.test(command)) {
          problems.push(`${at} uses gh api artifacts outside the named plan find lookup`);
        }
      }
    }
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('jobs-read-artifacts-from-their-own-run: passed');
