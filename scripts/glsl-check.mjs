// The shaders' smoothstep calls, read from the GLSL in the source's template literals. GLSL leaves
// smoothstep(edge0, edge1, x) undefined when edge0 >= edge1, and some phone drivers then draw a hard step or a constant,
// so a fade the other way is written 1.0 - smoothstep(lo, hi, x). A call is known to be the wrong way round when its
// edges are constants, or the same expression plus or minus constants (`top + 0.02, top - 0.3`). The build fails on any
// (vite.config.ts), and `node scripts/glsl-check.mjs` lists them for all of src/ and exits 1.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The text of every template literal in `source`, its `${}` parts left as a NUL each, with where in `source` each of its
 * characters is. Strings, comments and regular expressions in the code around them are skipped, so a backtick inside
 * them starts nothing.
 */
function templates(source) {
  const out = [];
  let i = 0;
  // whether a `/` here would start a regular expression rather than divide
  let regexOk = true;
  const code = (stopAtBrace) => {
    let depth = 0;
    while (i < source.length) {
      const c = source[i];
      if (c === '/' && source[i + 1] === '/') i = source.indexOf('\n', i) < 0 ? source.length : source.indexOf('\n', i);
      else if (c === '/' && source[i + 1] === '*') i = source.indexOf('*/', i + 2) < 0 ? source.length : source.indexOf('*/', i + 2) + 2;
      else if (c === '"' || c === "'") {
        for (i++; i < source.length && source[i] !== c; i++) if (source[i] === '\\') i++;
        i++;
        regexOk = false;
      } else if (c === '`') {
        i++;
        template();
        regexOk = false;
      } else if (c === '/' && regexOk) {
        let inClass = false;
        for (i++; i < source.length && (source[i] !== '/' || inClass) && source[i] !== '\n'; i++) {
          if (source[i] === '\\') i++;
          else if (source[i] === '[') inClass = true;
          else if (source[i] === ']') inClass = false;
        }
        i++;
        regexOk = false;
      } else {
        if (c === '{') depth++;
        if (c === '}' && stopAtBrace && depth-- === 0) return void i++;
        if (!/\s/.test(c)) regexOk = /[(,=:[!&|?{};+\-*%~^<>]/.test(c) || /\b(return|typeof|case|do|else|in|of|void|yield|await)$/.test(source.slice(Math.max(0, i - 6), i + 1));
        i++;
      }
    }
  };
  const template = () => {
    let text = '';
    const at = [];
    while (i < source.length && source[i] !== '`') {
      if (source[i] === '$' && source[i + 1] === '{') {
        at.push(i);
        text += '\0';
        i += 2;
        regexOk = true;
        code(true);
      } else {
        const n = source[i] === '\\' ? 2 : 1;
        for (let k = 0; k < n; k++) at.push(i + k);
        text += source.slice(i, i + n);
        i += n;
      }
    }
    i++;
    out.push({ text, at });
  };
  code(false);
  return out;
}

/** The value of a constant expression (numbers, + - * / and brackets), or null if it is anything else. */
function constant(expr) {
  const s = expr.replace(/\s+/g, '');
  let i = 0;
  const num = () => {
    const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return Number(m[0]);
  };
  const atom = () => {
    if (s[i] === '-' || s[i] === '+') {
      const sign = s[i++] === '-' ? -1 : 1;
      const v = atom();
      return v === null ? null : sign * v;
    }
    if (s[i] === '(') {
      i++;
      const v = sum();
      if (v === null || s[i++] !== ')') return null;
      return v;
    }
    return num();
  };
  const product = () => {
    let v = atom();
    while (v !== null && (s[i] === '*' || s[i] === '/')) {
      const op = s[i++], w = atom();
      v = w === null ? null : op === '*' ? v * w : v / w;
    }
    return v;
  };
  const sum = () => {
    let v = product();
    while (v !== null && (s[i] === '+' || s[i] === '-')) {
      const op = s[i++], w = product();
      v = w === null ? null : op === '+' ? v + w : v - w;
    }
    return v;
  };
  const v = sum();
  return v !== null && i === s.length && Number.isFinite(v) ? v : null;
}

/** The arguments of the call whose `(` is at `open` in `text`, split at its top-level commas, and where it ends. */
function args(text, open) {
  const list = [];
  let depth = 0, from = open + 1;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return { list: [...list, text.slice(from, i)], end: i };
    else if (text[i] === ',' && depth === 1) list.push(text.slice(from, i)), (from = i + 1);
  }
  return null;
}

/**
 * An edge as a part it may share with the other edge plus a constant: `top - 0.3` is ['top', -0.3], `uDissolve` is
 * ['uDissolve', 0] and a constant is ['', its value]. Two edges that share their part are in a known order whatever
 * that part is worth. Null for an edge with a `${}` in it, whose value is only known when the page runs.
 */
function offset(expr) {
  const c = constant(expr);
  if (c !== null) return ['', c];
  const e = expr.trim();
  if (e.includes('\0')) return null;
  // a constant added or taken away last, after a whole expression (not `x * -0.5`, nor the exponent of `x * 1e-3`)
  const m = /^(.*[\w.)\]])\s*([+-])\s*((?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$/.exec(e);
  if (!m || /\d[eE]$/.test(m[1])) return [e, 0];
  let depth = 0;
  for (const ch of m[1]) if ((depth += ch === '(' ? 1 : ch === ')' ? -1 : 0) < 0) return [e, 0];
  return depth ? [e, 0] : [m[1].replace(/\s+/g, ''), (m[2] === '-' ? -1 : 1) * Number(m[3])];
}

/** Every GLSL smoothstep call in `source`: its line, its text and whether its edges are known to be the wrong way round. */
export function smoothsteps(source) {
  const calls = [];
  for (const { text, at } of templates(source)) {
    for (const m of text.matchAll(/\bsmoothstep\s*\(/g)) {
      const a = args(text, m.index + m[0].length - 1);
      if (!a || a.list.length !== 3) continue;
      const [e0, e1] = a.list.slice(0, 2).map(offset);
      const reversed = !!e0 && !!e1 && e0[0] === e1[0] && e0[1] >= e1[1];
      calls.push({ line: source.slice(0, at[m.index]).split('\n').length, call: text.slice(m.index, a.end + 1).replace(/\0/g, '${}'), reversed });
    }
  }
  return calls;
}

/** The GLSL smoothstep calls in `source` whose edges are known to be the wrong way round (edge0 >= edge1). */
export const reversedSmoothsteps = (source) => smoothsteps(source).filter((c) => c.reversed);

/** What to tell whoever wrote `calls` in `file`. */
export const reversedMessage = (file, calls) =>
  `${calls.map((c) => `${file}:${c.line}: ${c.call}`).join('\n')}\n${calls.length} GLSL smoothstep call${calls.length === 1 ? ' has its' : 's have their'} edges the wrong way round, which GLSL leaves undefined; write 1.0 - smoothstep(lo, hi, x) instead`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let bad = 0;
  for (const f of fs.readdirSync(path.join(root, 'src'), { recursive: true }).filter((f) => /\.[jt]s$/.test(f))) {
    const calls = reversedSmoothsteps(fs.readFileSync(path.join(root, 'src', f), 'utf8'));
    if (calls.length) console.error(reversedMessage(path.join('src', f), calls));
    bad += calls.length;
  }
  if (bad) process.exit(1);
  console.log('every GLSL smoothstep has its edges the right way round');
}
