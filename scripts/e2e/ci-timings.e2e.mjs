import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { load } from 'js-yaml';

const exec = promisify(execFile);
const workflowFile = process.env.E2E_TIMINGS_WORKFLOW ?? '.github/workflows/ci.yml';
const selected = { 'ci-plan-downloads-timings-before-setup': [42] };
const downloadErrors = {
  'gone-name': 'no artifact matches any of the names or patterns provided',
  'gone-empty': 'no valid artifacts found to download',
  'gone-404': 'error fetching artifacts: HTTP 404: Not Found',
  'gone-410': 'error downloading e2e-timings: HTTP 410: Gone',
  denied: 'error fetching artifacts: HTTP 403: Resource not accessible by integration',
  unavailable: 'error downloading e2e-timings: HTTP 503: Service Unavailable',
  network: 'error fetching artifacts: dial tcp: lookup api.github.com: no such host',
};
const boundary = `
gh() {
  if [[ $1 == api ]]; then
    [[ $MODE != api-denied ]] || return 1
    if [[ "$*" == *--jq* ]]; then
      echo '5040 504'
    else
      cat "$CASE/artifacts.json"
    fi
    return
  fi
  [[ $1 == run && $2 == download && $4 == --repo && $6 == -n && $7 == e2e-timings && $8 == -D ]] || return 2
  echo "$3" >> "$CASE/downloads"
  mkdir -p "\${9}"
  if [[ $MODE == denied || $MODE == unavailable || $MODE == network ]]; then
    printf '%s\\n' "$DOWNLOAD_ERROR" >&2
    return 1
  fi
  if [[ $MODE == exhausted || ( $MODE == sixth && $3 != 500 ) || ( $MODE == gone-* && $3 == 505 ) ]]; then
    echo '{}' > "\${9}/e2e-timings.json"
    printf '%s\\n' "$DOWNLOAD_ERROR" >&2
    return 1
  fi
  [[ $MODE != malformed ]] || return 0
  cp "$CASE/current.json" "\${9}/e2e-timings.json"
}
`;

async function plan(mode, expect) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-timings-'));
  try {
    const workflow = load(fs.readFileSync(workflowFile, 'utf8'));
    const steps = workflow.jobs.plan.steps;
    const find = steps.find((step) => step.id === 'find');
    const parts = steps.find((step) => step.id === 'parts');
    const upload = steps.find((step) => step.with?.name === 'e2e-plan-timings');
    expect(steps[0] === find, 'the plan looks for timings after setup has already begun');
    const artifact = (run, extra = {}) => ({
      id: run * 10,
      name: 'e2e-timings',
      expired: false,
      created_at: `2026-11-0${run - 499}T12:00:00Z`,
      workflow_run: { id: run, head_repository_id: 7 },
      ...extra,
    });
    const artifacts = mode === 'empty' ? [] : [
      artifact(504), artifact(506, { expired: true }), artifact(505),
      artifact(507, { workflow_run: { id: 507, head_repository_id: 8 } }),
      artifact(508, { name: 'unrelated' }),
      artifact(503), artifact(502), artifact(501), artifact(500),
    ];
    const write = (file, value) => fs.writeFileSync(path.join(scratch, file), value);
    write('artifacts.json', JSON.stringify({ artifacts }));
    write('current.json', JSON.stringify(selected));
    write('boundary.sh', boundary);
    write('output', '');
    write('downloads', '');
    const env = {
      ...process.env,
      BASH_ENV: path.join(scratch, 'boundary.sh'),
      CASE: scratch,
      MODE: mode,
      DOWNLOAD_ERROR: downloadErrors[mode] ?? downloadErrors['gone-name'],
      RUNNER_TEMP: scratch,
      GITHUB_OUTPUT: path.join(scratch, 'output'),
      GITHUB_REPOSITORY: 'fixture/game',
      GITHUB_REPOSITORY_ID: '7',
    };
    const shell = (code, more = {}) => exec('bash', ['-e', '-o', 'pipefail', '-c', code], {
      env: { ...env, ...more },
    });
    if (['denied', 'unavailable', 'network', 'api-denied', 'malformed'].includes(mode)) {
      let failed = false;
      try {
        await shell(find.run);
      } catch {
        failed = true;
      }
      expect(failed && !find['continue-on-error'], `${mode}: the plan hid a failed timings download`);
      const attempts = fs.readFileSync(path.join(scratch, 'downloads'), 'utf8');
      expect(attempts === (mode === 'api-denied' ? '' : '505\n'), `${mode}: the plan retried a failed lookup`);
      return;
    }
    await shell(find.run);
    const fallback = mode === 'empty' || mode === 'exhausted';
    const downloaded = path.join(scratch, 'timings/e2e-timings.json');
    expect(fallback || fs.existsSync(downloaded), `${mode}: setup began before timings were downloaded`);
    const all = '505\n504\n503\n502\n501\n500\n';
    const wanted = ['exhausted', 'sixth'].includes(mode) ? all :
      mode.startsWith('gone-') ? '505\n504\n' : fallback ? '' : '505\n';
    const attempts = fs.readFileSync(path.join(scratch, 'downloads'), 'utf8');
    expect(attempts === wanted,
      `${mode}: downloads did not try the newest available runs in order: ${attempts}`);
    const output = fs.readFileSync(path.join(scratch, 'output'), 'utf8');
    const run = output.match(/^run=(\d+)$/m)?.[1] ?? '';
    const expectedRun = fallback ? '' : mode === 'sixth' ? '500' : mode.startsWith('gone-') ? '504' : '505';
    expect(run === expectedRun, `${mode}: the plan selected run ${run} instead of ${expectedRun}`);
    await shell(parts.run, { PLANNED: run });
    const saved = fs.readFileSync(path.join(scratch, 'plan-timings/e2e-timings.json'), 'utf8');
    const expected = fallback ? fs.readFileSync('scripts/e2e/timings.json', 'utf8') : JSON.stringify(selected);
    expect(saved === expected, `${mode}: the plan saved different timings from the file it downloaded`);
    expect(/^parts=[1-9]\d*$/m.test(fs.readFileSync(path.join(scratch, 'output'), 'utf8')),
      `${mode}: the saved timings did not produce a shard plan`);
    expect(upload?.with['retention-days'] === 30, 'planned timings expire before the timings they came from');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

export const scenarios = {
  async 'ci-plan-downloads-timings-before-setup'({ expect }) {
    for (const mode of ['replaced', 'gone-name', 'gone-404', 'gone-410', 'empty', 'exhausted', 'sixth']) {
      await plan(mode, expect);
    }
  },
  async 'ci-plan-continues-after-the-last-artifact-disappears'({ expect }) {
    await plan('gone-empty', expect);
  },
  async 'ci-plan-keeps-download-errors-visible'({ expect }) {
    for (const mode of ['denied', 'unavailable', 'network', 'api-denied', 'malformed']) await plan(mode, expect);
  },
};
