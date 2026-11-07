import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../..', import.meta.url));

async function echoFindings({ expect, out }, suffix = '') {
  const fixture = path.join(root, `scripts/lint/fixtures/schedule-before-echo-loads${suffix}.ts`);
  const config = path.join(fs.mkdtempSync(path.join(out, 'echo-lint-')), 'oxlint.json');
  fs.writeFileSync(config, JSON.stringify({
    categories: { correctness: 'off' },
    jsPlugins: [path.join(root, 'scripts/lint/rules.mjs')],
    rules: { 'lantern/schedule-before-echo-loads': 'error' },
  }));
  const args = ['-c', config, '--disable-nested-config', '-f', 'json', fixture];
  const oxlint = path.join(root, 'node_modules/.bin/oxlint');
  const run = await promisify(execFile)(oxlint, args).catch((error) => {
    if (error.code !== 1) throw error;
    return error;
  });
  const { diagnostics } = JSON.parse(run.stdout);
  const source = fs.readFileSync(fixture, 'utf8');
  const methods = [...source.matchAll(/^  (\w+)\(/gm)];
  return diagnostics.map((d) => {
    expect(d.code === 'lantern(schedule-before-echo-loads)', `unexpected finding: ${d.code}`);
    const offset = d.labels[0].span.offset;
    const method = methods.findLast((m) => m.index < offset)?.[1];
    return source.startsWith('callback?.', offset) ? `${method}:argument` : method;
  });
}

export const scenarios = {
  async 'echo-lint-keeps-loop-writes-shadowed-math-and-fixed-times-stale'(h) {
    const found = await echoFindings(h, '.loops');
    const realCatches = [
      'staleFor', 'staleWhile', 'staleDoWhile', 'staleForOf', 'staleForIn', 'staleNestedLoop',
      'staleLoopDependency', 'shadowedMath', 'outerShadowedMath', 'fixedRefresh', 'fixedMathRefresh',
      'fixedConstRefresh', 'fixedSumRefresh', 'staleDoWhileCondition', 'staleOutsideLoop', 'staleOutsideLoop',
      'staleLoopSubtraction', 'staleLoopCompound', ...Array(5).fill('staleSubtractions'),
    ];
    const knownOverReports = [
      'conditionalSoonIsOverReported', 'multipliedSoonIsOverReported', 'wrappedSoonIsOverReported',
      'freshEachIteration',
    ];
    const expected = [...realCatches, ...knownOverReports].sort();
    h.expect(found.sort().join() === expected.join(), `expected ${expected.join()}; found ${found.join()}`);
  },
  async 'echo-lint-keeps-stale-times-and-allows-fresh-consts'(h) {
    const found = await echoFindings(h);
    const realCatches = [
      'stopAll', 'reset', 'reset', 'derived', 'built', 'later', 'nested', 'assigned', 'refreshedClockAfter',
      'keepsOldDerivedTime', 'conditionalRefresh', 'rightHandSideKeepsOldTime', 'conditionalStaleTime',
      'argumentKeepsOldTime', 'declarationKeepsOldTime', 'optionalCallRefreshMayNotRun',
      'optionalMemberRefresh', 'destructuringDefaults', 'destructuringDefaults', 'nestedCallback', 'nestedCallback',
      'namedCallback', 'loopCarriedWrite', 'callbackAlias', 'conditionalSoon', 'nestedSoon',
      'optionalCallSoonMayNotRun', 'optionalReceiverSoon', 'staleAfterRefresh',
      'capturedWriteAfterRefresh', 'capturedWriteAfterRefresh', 'clockWithOldTime', 'timelineRefresh',
      'clockConstAfter', 'snapshotRefresh', 'snapshotRefresh', 'timelineAliasRefresh', 'mediaClockRefresh',
      'memberCallback', 'memberCallbackAlias', 'constBeforeRefresh', 'twice',
      'conditionalStaleAfterFresh', 'refreshStaysInItsBranch', 'staleCompoundAfterFresh',
      'staleMinBound',
    ];
    const knownOverReports = [
      'maxWithOldBoundIsOverReported', 'maxWithOldBoundIsOverReported',
      'assignedAfterCall', ...Array(13).fill('conditionalAssignmentsFreshValueNotProven'),
      'nestedAssignmentFreshValueNotProven', 'argumentAssignmentFreshValueNotProven',
      'sequenceResultFreshValueNotProven', 'optionalCallRefreshMayNotRun:argument',
      ...Array(3).fill('nestedAndCompoundFreshValueNotProven'), 'sequenceAssignmentFreshValueNotProven',
      'varRedeclarationFreshValueNotProven', 'callbackObjectDataMistakenForCall',
      'refreshedCaptureMistakenForStaleCallback', 'optionalCallSoonMayNotRun:argument',
      'constBeforeOverwrite',
    ];
    const expected = [...realCatches, ...knownOverReports].sort();
    h.expect(found.sort().join() === expected.join(), `expected ${expected.join()}; found ${found.join()}`);
  },
  async 'echo-lint-checks-shared-consts-within-one-fixture-budget'(h) {
    const bestOfThree = async (suffix) => {
      const times = [];
      for (let i = 0; i < 3; i++) {
        const start = performance.now();
        const found = await echoFindings(h, suffix);
        if (suffix) h.expect(found.length === 0, `shared fresh consts: found ${found.join()}`);
        times.push(performance.now() - start);
      }
      return Math.min(...times);
    };
    const baseline = await bestOfThree('');
    const chain = await bestOfThree('.chain');
    h.expect(chain < 2 * baseline, `shared consts took ${chain} ms; baseline ${baseline} ms`);
  },
};
