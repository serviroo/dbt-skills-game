const cappedAndIncomplete = `
for (const a of candidates.slice(0, 5)) console.log(a.workflow_run.id);
gh run download "$run" -n e2e-timings -D "$dir"
grep -Eq 'no artifact matches|HTTP (404|410)' "$error" || exit 1
`;

const unhandled = 'gh run download "$run" -n e2e-timings -D "$dir"';

const capped = `
for (const a of candidates.slice(0, 5)) console.log(a.workflow_run.id);
gh run download "$run" -n e2e-timings -D "$dir"
missing='no artifact matches|no valid artifacts found to download|HTTP (404|410)'
grep -Eq "$missing" "$error" || exit 1
`;

const complete = `
for (const a of candidates) console.log(a.workflow_run.id);
gh run download "$run" -n e2e-timings -D "$dir"
missing='no artifact matches|no valid artifacts found to download|HTTP (404|410)'
grep -Eq "$missing" "$error" || exit 1
`;

export { cappedAndIncomplete, unhandled, capped, complete };
