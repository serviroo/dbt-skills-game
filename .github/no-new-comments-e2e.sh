#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
checker=$root/scripts/lint/comments/check.mjs
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
// @ts-expect-error the old type is wrong
export const d: string = 1;
EOF
put docs/notes.md <<'EOF'
<!-- docs are prose, not code -->
# Notes
EOF
commit "feat: add allowed"
expect pass "license headers, shebangs, directives, strings and docs pass"

[[ $failed -eq 0 ]] && echo "All cases behaved." || exit 1
