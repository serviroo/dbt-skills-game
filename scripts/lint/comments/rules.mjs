export const COMMENT_EXCEPTIONS = new Set(['.github/no-new-comments-e2e.sh']);

const MARKS = ['\\/\\/+', '\\/\\*+!?', '\\*+\\/', '<!--', '-->'];
const OPENERS = ['\\/\\/+', '\\/\\*+', '<!--', '\\*+'];
const anyMark = new RegExp(MARKS.join('|'), 'g');
const opener = new RegExp(`^(${OPENERS.join('|')})`);

export function normalize(text) {
  return text
    .replace(anyMark, ' ')
    .replace(/^[ \t]*\*+([ \t]|$)/, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export function strip(text) {
  return text
    .trim()
    .replace(opener, '')
    .replace(/^[ \t]*\*+[ \t]/, '')
    .replace(/(\*+\/|-->)[ \t]*$/, '')
    .trim();
}

const LICENSE_LINE = new RegExp(
  [
    'spdx-license-identifier',
    'copyright (\\(c\\)|©|[0-9]{4})',
    '^© ',
    'all rights reserved',
    '@license',
    '@preserve',
    'the above copyright notice',
    'permission is hereby granted',
    'licensed under the',
    'gnu (general|lesser|affero) public license',
    'apache license',
    'the software is provided "as is"',
    'redistribution and use in source',
  ].join('|'),
);

export function licenseLine(text, licenseText) {
  if (LICENSE_LINE.test(text.toLowerCase())) return true;
  const words = normalize(text).toLowerCase();
  return words.split(' ').length >= 4 && licenseText.includes(` ${words} `);
}

const DIRECTIVES = [
  /^eslint-(disable|enable)(-next-line|-line)?( |$)/,
  /^eslint [@a-z0-9/_-]+: *(off|warn|error|[012]|\[)/,
  /^eslint-env [a-z]/,
  /^oxlint-(disable|enable)(-next-line|-line)?( |$)/,
  /^(prettier-ignore|@vite-ignore|@ts-check|@ts-nocheck|#__pure__|@__pure__|@__no_side_effects__)$/,
  /^@ts-(expect-error|ignore)( |:|$)/,
  /^\/? ?<reference (path|types|lib)=/,
  /^webpack[a-z]+: /,
  /^@jsx(importsource|frag|runtime)? [a-z@.]/,
  /^(istanbul ignore (next|else|if|file)|[cv]8 ignore (next|start|stop|file|if|else))/,
  /^@(vitest|jest)-environment [a-z]/,
  /^biome-ignore [a-z]/,
  /^[#@] source(mapping)?url=/,
];

const GLOBALS = /^(globals?|exported) [a-z_$][a-z0-9_$]*(:[a-z]+)?( *, *[a-z_$][a-z0-9_$]*(:[a-z]+)?)*$/;

export function directive(stripped, raw) {
  const lower = stripped.toLowerCase();
  if (DIRECTIVES.some((pattern) => pattern.test(lower))) return true;
  if (/^[ \t]*\/\*/.test(raw) && GLOBALS.test(lower)) return true;
  if (/^[ \t]*\/\/ ?#(end)?region([ \t]|$)/.test(raw)) return true;
  return /^(glsl|wgsl|html|css|js)$/.test(lower) && /^[ \t]*\/\*/.test(raw);
}
