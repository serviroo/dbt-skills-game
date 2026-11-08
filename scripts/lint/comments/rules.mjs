const MARKS = ['\\/\\/+', '\\/\\*+!?', '\\*+\\/', '<!--', '-->', '#+', '"""', "'''"];
const OPENERS = ['\\/\\/+', '\\/\\*+!?', '<!--', '#+', '\\*+'];
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

const SPDX_ID = '\\(?[A-Za-z0-9.+-]+\\)?';
const HOLDER_WORD = "([A-Z0-9@][\\w.&'@-]*|and|the|of|contributors|authors)";
const NOTICES = [
  new RegExp(`^SPDX-License-Identifier: ${SPDX_ID}( (AND|OR|WITH) ${SPDX_ID})*$`),
  new RegExp(
    `^(Copyright|COPYRIGHT)( \\(c\\)| \\(C\\)| ©)? [0-9]{4}([-, ]+[0-9]{4})*` +
      `( ${HOLDER_WORD}(,? ${HOLDER_WORD})*)?\\.?` +
      '( All rights reserved\\.?)?$',
  ),
  /^All rights reserved\.?$/,
  /^@(license|preserve)( [A-Za-z0-9.+-]+)?$/,
];

const words = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function licenseLine(text, licenseText) {
  const notice = strip(text);
  if (NOTICES.some((n) => n.test(notice))) return true;
  const said = words(text);
  return said.split(' ').length >= 4 && ` ${words(licenseText)} `.includes(` ${said} `);
}

const RULES = '[@a-z0-9/_-]+( *, *[@a-z0-9/_-]+)*';
const LEVEL = '(off|warn|error|[012])';

const DIRECTIVES = [
  new RegExp(`^(eslint|oxlint)-(disable|enable)(-next-line|-line)?( ${RULES})?$`),
  new RegExp(`^eslint [@a-z0-9/_-]+: *${LEVEL}( *, *[@a-z0-9/_-]+: *${LEVEL})*$`),
  /^eslint-env [a-z0-9]+( *, *[a-z0-9]+)*$/,
  /^(prettier-ignore|@vite-ignore|@ts-check|@ts-nocheck|#__pure__|@__pure__|@__no_side_effects__)$/,
  /^@ts-(expect-error|ignore)$/,
  /^\/? ?<reference (path|types|lib)="[^"]*" ?\/>$/,
  /^webpack[a-z]+: *("[^"]*"|'[^']*'|true|false|[0-9]+)$/,
  /^@jsx(importsource|frag|runtime)? [a-z@./_-]+$/,
  /^(istanbul ignore (next|else|if|file)|[cv]8 ignore (next|start|stop|file|if|else))$/,
  /^@(vitest|jest)-environment [a-z-]+$/,
  /^[#@] source(mapping)?url=\S+$/,
  /^stylelint-(disable|enable)(-next-line|-line)?( [a-z0-9/-]+( *, *[a-z0-9/-]+)*)?$/,
  /^noqa(: *[a-z]+[0-9]+( *, *[a-z]+[0-9]+)*)?$/,
  /^type: *ignore(\[[a-z-]+( *, *[a-z-]+)*\])?$/,
  /^pylint: *(disable|enable)=[a-z0-9,-]+$/,
  /^pyright: *(ignore(\[[a-z]+( *, *[a-z]+)*\])?|basic|strict)$/,
  /^mypy: *[a-z-]+(=[a-z0-9,-]+)?$/,
  /^fmt: *(off|on|skip)$/,
  /^isort: *(skip_file|skip|off|on)$/,
  /^pragma: no cover$/,
  /^nosec( [a-z][0-9]+)*$/,
  /^-\*- coding: *[a-z0-9_-]+ *-\*-$/,
];

const GLOBALS = /^(globals?|exported) [a-z_$][a-z0-9_$]*(:[a-z]+)?( *, *[a-z_$][a-z0-9_$]*(:[a-z]+)?)*$/;

export function directive(stripped, raw) {
  const lower = stripped.toLowerCase();
  if (DIRECTIVES.some((pattern) => pattern.test(lower))) return true;
  if (/^[ \t]*\/\*/.test(raw) && GLOBALS.test(lower)) return true;
  if (/^[ \t]*\/\/ ?#(end)?region[ \t]*$/.test(raw)) return true;
  return /^(glsl|wgsl|html|css|js)$/.test(lower) && /^[ \t]*\/\*/.test(raw);
}
