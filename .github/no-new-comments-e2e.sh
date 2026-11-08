#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
checker=$root/scripts/lint/comments/check.mjs
credits=$root/scripts/lint/comments/credits.mjs
name=$(node --input-type=module -e "import { NAMES } from '$credits'; console.log(NAMES[0]);")
[[ -n $name ]] || { echo "can't read the names the checker looks for" >&2; exit 1; }
repo=$(mktemp -d) || exit 1
trap 'rm -rf -- "${repo:?}"' EXIT
cd "$repo"
git init -q -b main
git config user.name fixture
git config user.email fixture@example.com
git config commit.gpgsign false

failed=0
put() { mkdir -p "$(dirname "$1")"; cat >"$1"; }
commit() { git add -A && git commit -q --allow-empty -m "$1"; }

mkdir -p src
put src/old.js <<'EOF'
export function total(items) {
  // Sum the prices, skipping the free ones because the cart shows them apart.
  return items.filter((i) => i.price > 0).reduce((a, i) => a + i.price, 0);
}
EOF
put src/keep.py <<'EOF'
def run():
    return 1  # keep this one
EOF
put src/conf.js <<'EOF'
export const fallback = load();
EOF
put LICENSE <<'EOF'
Copyright (c) 2026 Example

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files.
EOF
put docs/guide.md <<'EOF'
Prices skip the free items.
EOF
commit base

expect() {
  local want=$1 label=$2 out code=0
  shift 2
  out=$(node "$checker" --base main --head HEAD "$@" 2>&1) || code=$?
  local wrong=0
  if [[ $want == pass ]]; then
    [[ $code -eq 0 ]] || wrong=1
  elif [[ $code -ne 1 || $out != *"$want"* ]]; then
    wrong=1
  fi
  if ((wrong)); then
    echo "FAIL: $label (exit $code)"
    printf '%s\n' "$out" | sed 's/^/    /'
    failed=1
  else
    echo "ok: $label"
  fi
}

case_branch() { git checkout -q main && git checkout -q -B "case-$1"; }

case_branch js
put src/a.js <<'EOF'
export const a = 1;
// Loops over the cards so the header stays in sync.
export const b = 2;
EOF
commit "feat: add a"
expect "src/a.js:2: adds a comment" "a new JS line comment fails"

case_branch tsblock
put src/a.ts <<'EOF'
/* Keeps the header in sync. */
export const a: number = 1;
const b = {
  c: 2,
  /**
   * The width of the card.
   */
  w: 3,
};
EOF
commit "feat: add a"
expect "src/a.ts:6: adds a comment" "a new TS block comment fails"

case_branch shader
put web/shader.ts <<'EOF'
export const FRAG = /* glsl */ `
  float a = 1.0;
  // the glow fades out here
  vec2 b = vec2(a, a / 2.0);
`;
EOF
commit "feat: add a shader"
expect "web/shader.ts:3: adds a comment" "a comment in shader code inside a template fails"

case_branch reused
put src/conf.js <<'EOF'
export const fallback = loadAgain();
// fallback
EOF
git rm -q docs/guide.md
put src/price.js <<'EOF'
// Prices skip the free items.
export const price = 1;
EOF
commit "feat: reuse words"
expect "src/conf.js:2: adds a comment" "a comment repeating removed code fails"
expect "src/price.js:1: adds a comment" "a removed doc sentence turned into a comment fails"

case_branch lookalikes
put src/look.js <<'EOF'
// SPDX-License-Identifier: MIT
// Fetches the user list
// global state lives here
// eslint complains here because the cache is shared
/*! Explains why the cache is shared across tabs. */
// vim: this is a vim workaround
// 42
export const a = 1;
// Shows the copyright year in the footer.
export const b = <p><b>a</b>{/* note */}</p>;
EOF
put "src/my file.js" <<'EOF'
// in a spaced path
export const c = 1;
EOF
commit "feat: add lookalikes"
expect "src/look.js:2: adds a comment" "an explanation under a license line fails"
expect "src/look.js:3: adds a comment" "plain words that start like a directive fail"
expect "src/look.js:4: adds a comment" "plain words that start with a linter name fail"
expect "src/look.js:5: adds a comment" "a preserved comment below the header fails"
expect "src/look.js:6: adds a comment" "plain words after an editor name fail"
expect "src/look.js:7: adds a comment" "a bare number fails"
expect "src/look.js:9: adds a comment" "a comment that mentions copyright fails"
expect "src/look.js:10: adds a comment" "a JSX comment after a closing tag fails"
expect "src/my file.js:1: adds a comment" "a comment in a path with a space fails"

case_branch moved
git rm -q src/old.js
put src/new.js <<'EOF'
export function total(items) {
  return items
    // Sum the prices, skipping the free ones
    // because the cart shows them apart.
    .filter((i) => i.price > 0)
    .reduce((a, i) => a + i.price, 0);
}
EOF
put src/keep.py <<'EOF'
def run():
    return 2  # keep this one
EOF
commit "refactor: move total"
expect pass "a moved, re-wrapped comment and a kept trailing comment pass"

case_branch strings
put scripts/walk.mjs <<'EOF'
export const order = (page) =>
  page.evaluate(`(() => {
    // the first stop is the picked radio
    return document.querySelectorAll('button').length;
  })()`);
EOF
put src/kit.ts <<'EOF'
export function bend(sh) {
  sh.vertexShader = sh.vertexShader.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
    // sway with the wind
    transformed.x += 1.0;`,
  );
}
EOF
put src/glow.ts <<'EOF'
export const GLOW = /* glsl */ `
  float a = 1.0; // the glow fades
  vec2 b = vec2(a);/* halves it */
`;
EOF
put src/math.js <<'EOF'
let x = 1;
x++ / 2; /* why it halves */
export { x };
EOF
commit "feat: code in strings"
expect "scripts/walk.mjs:3: adds a comment" "a comment in code a page runs fails"
expect "src/kit.ts:5: adds a comment" "a comment in a shader patch fails"
expect "src/glow.ts:2: adds a comment" "a trailing comment in a marked shader fails"
expect "src/glow.ts:3: adds a comment" "a block comment right after shader code fails"
expect "src/math.js:2: adds a comment" "a comment after a division fails"

case_branch once
put src/old.js <<'EOF'
export function total(items) {
  return items.filter((i) => i.price > 0).reduce((a, i) => a + i.price, 0);
}
EOF
put src/twice.js <<'EOF'
// Sum the prices, skipping the free ones because the cart shows them apart.
export const one = 1;
// Sum the prices, skipping the free ones because the cart shows them apart.
export const two = 2;
EOF
commit "refactor: reuse a comment"
expect "src/twice.js:3: adds a comment" "a removed comment moves once, not twice"

case_branch license
put src/warm.js <<'EOF'
/*
 * Copyright (c) 2026 Example
 * Keeps the cache warm between tabs.
 * Permission is hereby granted, free of charge, to any person obtaining a copy.
 */
export const warm = true;
EOF
commit "feat: add warm"
expect "src/warm.js:3: adds a comment" "prose inside a license header fails"

case_branch bypasses
printf '%s\n' '*.js -diff' >.gitattributes
put src/hidden.js <<'EOF'
export const a = 1;
// hidden from the diff
EOF
put src/disabled.js <<'EOF'
// still a comment
export const order = (page) => page.evaluate("const n = 1; /* hidden */ return n;");
const probe = `
  const a = 1; // reads a
`;
export const run = (page) => page.evaluate(probe);
setTimeout("tick(); // why", 5);
/* eslint-disable */
EOF
put src/said.js <<'EOF'
// Copyright 2026 Example. This module warms the cache.
// eslint-disable-next-line no-console -- logs because the cart needs it
console.log(1);
// @ts-expect-error the old type is wrong
export const d = 1;
// #region the cart
/* eslint-disable no-console */ /* explains the console */
export const e = 2; //
EOF
put src/conf.js <<'EOF'
/*
export const fallback = load();
*/
EOF
commit "feat: get around the check"
expect "src/hidden.js:2: adds a comment" "a diff attribute doesn't hide a comment"
expect "src/disabled.js:1: adds a comment" "a disable comment doesn't hide comments"
expect "src/disabled.js:2: adds a comment" "a comment in a string a page runs fails"
expect "src/disabled.js:4: adds a comment" "a comment in a string passed to a page later fails"
expect "src/disabled.js:7: adds a comment" "a comment in a string set to run on a timer fails"
expect "src/said.js:1: adds a comment" "prose after a copyright notice fails"
expect "src/said.js:2: adds a comment" "a reason after a lint directive fails"
expect "src/said.js:4: adds a comment" "a reason after a type directive fails"
expect "src/said.js:6: adds a comment" "a named region fails"
expect "src/said.js:7: adds a comment: explains the console" "a comment beside a directive fails"
expect "src/said.js:8: adds a comment" "an empty comment fails"
expect "src/conf.js:1: adds a comment" "markers around existing code fail"

case_branch executed
put src/run.js <<'EOF'
export const make = () => {
  const program = "return 1; /* explanation */";
  return new Function(program);
};
eval(`1;\x2f\x2a hidden \x2a\x2f`);
export const paint = (el) => {
  el.innerHTML = `<defs>
    <!-- the soft glow -->
  </defs>`;
};
let script;
script = `1; // why`;
export const run = (page) => page.evaluate(script);
EOF
put src/spdx.js <<'EOF'
// SPDX-License-Identifier: MIT keeps the cache warm
// Copyright (c) 2026 Example, the cart total skips free items
export const a = 1;
EOF
commit "feat: executed strings"
expect "src/run.js:2: adds a comment" "a comment in a string handed to new Function fails"
expect "src/run.js:5: adds a comment" "an escaped comment in run code fails"
expect "src/run.js:8: adds a comment" "an HTML comment set as innerHTML fails"
expect "src/run.js:12: adds a comment" "a comment in a string assigned before a page runs it fails"
expect "src/spdx.js:1: adds a comment" "prose after a license id fails"
expect "src/spdx.js:2: adds a comment" "prose after a copyright holder fails"

case_branch allowed
put src/lic.js <<'EOF'
#!/usr/bin/env node
/*
 * Copyright (c) 2026 Example
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy.
 */
// SPDX-License-Identifier: MIT
// @ts-check
/* global window, document */
/* eslint-disable no-console */
// eslint-disable-next-line no-unused-vars
const re = /\/\/ not a comment/g;
const url = "https://example.com/#top";
const t = `a // b ${"/* c */"} d https://*.example.com`;
const share = `
  //server/share
`;
const hint = `Match all files with /*.txt`;
const shares = [share, hint];
if (shares) /[/*]/.test('x');
// prettier-ignore
const m = [1,0,
           0,1];
const lazy = () => import(/* @vite-ignore */ url);
const Link = () => <p>See https://example.com for more</p>;
export { re, t, m, lazy, Link, shares };
EOF
put src/d.ts <<'EOF'
// @ts-expect-error
export const d: string = 1;
EOF
put src/data.js <<'EOF'
export const echo = (page) => page.evaluate((x) => x, "hello /* world */");
function a() {
  const probe = "1; /* x */";
  return probe;
}
export function b(page) {
  const probe = 1;
  return page.evaluate(probe) + a();
}
EOF
put src/help.js <<'EOF'
export const help = `Type a path:
  // like this
`;
EOF
put docs/notes.md <<'EOF'
<!-- docs are prose, not code -->
# Notes
EOF
commit "feat: add allowed"
expect pass "license headers, shebangs, directives, strings and docs pass"

case_branch credit
put src/b.js <<'EOF'
export const b = 1;
EOF
commit "feat: add b"
git commit -q --amend -m "feat: add b" -m "Co-authored-by: helper[bot] <1+helper[bot]@users.noreply.github.com>"
expect "credits an assistant, model or bot as co-author" "a co-author trailer naming a bot fails"
git commit -q --amend -m "feat: add b" -m "Co-authored-by: Sam <12345+sam@users.noreply.github.com>
Co-authored-by: Ana Talbot <talbot@example.com>"
expect pass "a person on a GitHub no-reply address is a real co-author"
git commit -q --amend -m "feat: add b with $name"
expect "names an assistant or model ($name)" "a commit message naming a model fails"
git commit -q --amend -m "feat: add b" -m "Generated with Copilot"
expect "carries an authorship label" "a generated-with line naming a coding tool fails"
git commit -q --amend -m "fix: convert the disk to GPT"
expect pass "a GPT partition table is not a model name"
git commit -q --amend -m "feat: add b"
expect "PR title: names an assistant or model" "a PR title naming a model fails" --title "Add b with ${name^}"
printf '%s\n' 'Adds b.' '' 'AI-generated summary.' >"$repo/.git/body"
expect "PR body line 3: carries an authorship label" "a PR body with an authorship label fails" \
  --body-file "$repo/.git/body"
opened='<!-- This is an auto-generated comment: release notes by bot -->'
closed='<!-- end of auto-generated comment: release notes by bot -->'
printf '%s\n' 'Adds b.' '' "$opened" '<!-- bot-ai-generated:v1 -->' 'Summary' "$closed" >"$repo/.git/body"
expect pass "a review bot's own summary block in the PR body passes" --body-file "$repo/.git/body"
printf '%s\n' 'Adds b.' "$opened" "Generated with ${name^}" >"$repo/.git/body"
expect "PR body line 3: names an assistant or model" "an unclosed review bot marker hides nothing after it" \
  --body-file "$repo/.git/body"
bot='helper[bot] <1+helper[bot]@users.noreply.github.com>'
git commit -q --amend -m "feat: add b" --author "$bot"
expect "is authored by an assistant, model or bot" "a commit authored by a bot fails"
git commit -q --amend -m "feat: add b" --author "${name^} <noreply@example.com>"
expect "is authored by an assistant, model or bot" "a commit authored by an assistant fails"
git commit -q --amend -m "feat: add b" --reset-author
git checkout -q -b side main && commit "chore: side" && git checkout -q case-credit
git merge -q --no-ff side -m "Merge side" -m "Co-authored-by: $bot"
expect "credits an assistant, model or bot as co-author" "a merge commit crediting a bot fails"
git reset -q --hard HEAD^
printf 'export const note = "Co-authored-by: %s";\n' "$bot" >src/credit.js
commit "feat: add a note"
expect "src/credit.js:1: credits an assistant, model or bot" "a co-author credit in a source string fails"
git reset -q --hard HEAD^
printf 'export const who = "%s";\n' "$name" >src/c.js
commit "feat: add c"
expect "src/c.js:1: names an assistant or model ($name)" "code naming a model fails"

case_branch more-credits
put src/b.js <<'EOF'
export const b = 1;
EOF
commit "feat: add b"
expect "PR title: carries an authorship label" "a title crediting a bot fails" --title "Generated by helper[bot]"
for said in "Reviewed with sol-loop." "Reviewed by Sonnet 5.5 and Sol, then SWE-2."; do
  git commit -q --amend -m "feat: add b" -m "$said"
  expect "names an assistant or model" "a commit naming the tools fails: $said"
done
for said in "Assisted-by: GitHub Copilot" "Co-authored-by: Sonnet <s@example.com>" "Helped-by: $bot"; do
  git commit -q --amend -m "feat: add b" -m "$said"
  expect "credits an assistant, model or bot as co-author" "a credit trailer fails: $said"
done
for said in "Written with Cursor." "Made by an AI agent."; do
  git commit -q --amend -m "feat: add b" -m "$said"
  expect "carries an authorship label" "a credit line fails: $said"
done
git commit -q --amend -m "feat: add b"
printf '%s\n' 'Adds b.' 'Written by Copilot' >"$repo/.git/body"
expect "PR body line 2: carries an authorship label" "a body crediting a coding tool fails" \
  --body-file "$repo/.git/body"
for separator in '\037' '\036'; do
  printf "feat: add b\n\nok${separator}Co-authored-by: %s\n" "$bot" >"$repo/.git/msg"
  git commit -q --amend -F "$repo/.git/msg"
  expect "credits an assistant, model or bot as co-author" "a control character doesn't hide a credit"
done

case_branch real-names
put src/codec.js <<'EOF'
export const codec = 'audio/ogg; codecs=opus';
export const story = 'A fable about courage, the old codex and Gemini rising.';
EOF
commit "feat: serve opus audio"
git commit -q --amend -m "feat: serve opus audio" --author "Devin Park <devin@example.com>"
printf '%s\n' 'Generated by the builder; used by the enemy AI.' >"$repo/.git/body"
expect pass "codec names, story words and a person named Devin pass" --body-file "$repo/.git/body"

case_branch credit-identity
put src/b.js <<'EOF'
export const b = 1;
EOF
commit "feat: add b"
git commit -q --amend -m "feat: add b" --author "Codex <codex@users.noreply.github.com>"
expect "is authored by an assistant, model or bot" "a commit authored by a tool account fails"
git commit -q --amend -m "feat: add b" -m "Authored-by: Copilot" --reset-author
expect "credits an assistant, model or bot as co-author" "an authored-by trailer naming a tool fails"
git commit -q --amend -m "feat: add b" -m "Generated by a bot."
expect "carries an authorship label" "a line crediting a bot fails"

case_branch everyday
printf 'a\0b\nsol5 x\n' >assets.bin
put src/caret.js <<'EOF'
export const hint = 'Text is written with the cursor at the end, built using the user agent.';
export const lore = 'A message created by an agent of the Watch.';
export const cursor1 = 1;
export const sol2 = 2;
EOF
commit "feat: caret hints"
git commit -q --amend -m "feat: caret hints" -m "Co-authored-by: Devin Park <devin@example.com>"
expect pass "binary files, everyday phrases, a co-author named Devin and numbered names pass"

[[ $failed -eq 0 ]] && echo "All cases behaved." || exit 1
