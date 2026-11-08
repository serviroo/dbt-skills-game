import { createRequire } from 'node:module';
import { lineOf, lineStarts, rangePieces } from './pieces.mjs';

const require = createRequire(import.meta.url);
const viaStylelint = createRequire(require.resolve('stylelint/package.json'));
const tokenize = viaStylelint('postcss/lib/tokenize');
const Input = viaStylelint('postcss/lib/input');
const RAW_TEXT = new Set(['textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes']);

export function cssPieces(text) {
  const starts = lineStarts(text);
  const tokens = tokenize(new Input(text));
  const pieces = [];
  while (!tokens.endOfFile()) {
    const [type, , start, end] = tokens.nextToken();
    if (type === 'comment') pieces.push(...rangePieces(text, starts, start, end + 1));
  }
  return pieces;
}

function tagEnd(text, from) {
  let end = from;
  while (end < text.length && text[end] !== '>') {
    const quote = text[end] === '"' || text[end] === "'" ? text.indexOf(text[end], end + 1) : -2;
    end = quote === -1 ? text.length : quote === -2 ? end + 1 : quote + 1;
  }
  return end;
}

export function htmlPieces(text, embed) {
  const starts = lineStarts(text);
  const lower = text.toLowerCase();
  const pieces = [];
  let at = 0;
  while (at < text.length) {
    if (text.startsWith('<!--', at)) {
      const end = text.indexOf('-->', at + 4);
      const stop = end < 0 ? text.length : end + 3;
      pieces.push(...rangePieces(text, starts, at, stop));
      at = stop;
      continue;
    }
    const tag = /^<([a-z][a-z0-9-]*)/.exec(lower.slice(at, at + 64));
    if (!tag) {
      at++;
      continue;
    }
    const end = tagEnd(text, at + tag[0].length);
    const type = /\stype\s*=\s*["']?([^"'\s>]+)/.exec(lower.slice(at, end))?.[1];
    at = end + 1;
    if (!RAW_TEXT.has(tag[1]) && tag[1] !== 'script' && tag[1] !== 'style') continue;
    const close = lower.indexOf(`</${tag[1]}`, at);
    const stop = close < 0 ? text.length : close;
    if (RAW_TEXT.has(tag[1])) {
      at = stop;
      continue;
    }
    const runs = !type || /^(module|text\/javascript|application\/javascript)$/.test(type);
    const lang = tag[1] === 'style' ? 'css' : 'js';
    if (lang === 'css' || runs) pieces.push(...embed(lang, text.slice(at, stop), lineOf(starts, at)));
    at = stop;
  }
  return pieces;
}
