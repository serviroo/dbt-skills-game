import fs from 'node:fs';

const MARK = /\/\*\s*(glsl|wgsl|css|html|js)\s*\*\/\s*$/;
const TAGS = new Set(['glsl', 'wgsl', 'css', 'html']);
const FIRST_ARG_RUNS = new Set([
  'evaluate',
  'evaluateHandle',
  'evaluateAll',
  '$eval',
  '$$eval',
  'waitForFunction',
  'addInitScript',
  'setTimeout',
  'setInterval',
  'eval',
]);
const HTML_SINKS = new Set(['innerHTML', 'outerHTML']);
const SHADER = /^(vertex|fragment)Shader$/;
const NAMED = [
  [/(^|_)(css|styles?)$/i, 'css'],
  [/(vert|frag|shader|glsl)$/i, 'glsl'],
];
const STOP = /Statement$|Declaration$|^Program$|FunctionExpression$|^ArrowFunctionExpression$/;
const ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };

function nameOf(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'MemberExpression' && !node.computed) return node.property.name;
  return null;
}

function codeArgs(call) {
  if (!/^(Call|New)Expression$/.test(call.type)) return [];
  const name = nameOf(call.callee);
  if (name === 'Function') return call.arguments;
  if (name === 'insertAdjacentHTML') return [];
  return FIRST_ARG_RUNS.has(name) ? call.arguments.slice(0, 1) : [];
}

function marked(node, text) {
  const parent = node.parent;
  if (parent?.type === 'TaggedTemplateExpression' && TAGS.has(nameOf(parent.tag))) return nameOf(parent.tag);
  return MARK.exec(text.slice(Math.max(0, node.range[0] - 40), node.range[0]))?.[1] ?? null;
}

function langOf(node, text, codeNodes) {
  for (let child = null, at = node; at && !STOP.test(at.type); child = at, at = at.parent) {
    const mark = at.type === 'TemplateLiteral' ? marked(at, text) : null;
    if (mark) return mark;
    if (codeNodes.has(at) || codeArgs(at).includes(child)) return 'js';
    if (at.type === 'CallExpression' && nameOf(at.callee) === 'insertAdjacentHTML' && at.arguments[1] === child) {
      return 'html';
    }
    if (at.type === 'Property' && at.value === child && SHADER.test(nameOf(at.key) ?? '')) return 'glsl';
    if (at.type === 'AssignmentExpression' && at.right === child) {
      if (SHADER.test(nameOf(at.left) ?? '')) return 'glsl';
      if (HTML_SINKS.has(nameOf(at.left))) return 'html';
    }
    if (at.type === 'VariableDeclarator' && at.init === child) {
      return NAMED.find(([pattern]) => pattern.test(at.id.name ?? ''))?.[1] ?? 'text';
    }
  }
  return 'text';
}

function decode(raw, firstLine, out) {
  let line = firstLine;
  for (let i = 0; i < raw.length; i++) {
    let char = raw[i];
    if (char === '\\') {
      const kind = raw[++i];
      const hex = (from, to) => parseInt(raw.slice(from, to), 16);
      if (kind === '\n') {
        line++;
        continue;
      }
      if (kind === 'x') char = String.fromCharCode(hex(i + 1, (i += 2) + 1));
      else if (kind === 'u' && raw[i + 1] === '{') char = String.fromCodePoint(hex(i + 2, (i = raw.indexOf('}', i))));
      else if (kind === 'u') char = String.fromCharCode(hex(i + 1, (i += 4) + 1));
      else char = ESCAPES[kind] ?? kind;
    } else if (char === '\n') {
      line++;
    }
    out.text += char;
    if (char === '\n') out.lines.push(line);
  }
}

function contentOf(node, text, lineAt) {
  const out = { text: '', lines: [lineAt(node.range[0])] };
  if (node.type === 'Literal') {
    decode(text.slice(node.range[0] + 1, node.range[1] - 1), out.lines[0], out);
    return out;
  }
  for (const [i, quasi] of node.quasis.entries()) {
    const start = quasi.range[0] + (text[quasi.range[0]] === '`' || text[quasi.range[0]] === '}' ? 1 : 0);
    const line = lineAt(start);
    while (out.lines.at(-1) < line) {
      out.text += '\n';
      out.lines.push(out.lines.at(-1) + 1);
    }
    const last = i === node.quasis.length - 1;
    decode(text.slice(start, quasi.range[1] - (last ? 1 : 2)), line, out);
    if (!last) out.text += '0';
  }
  return out;
}

export default {
  meta: { name: 'nnc' },
  rules: {
    found: {
      create(context) {
        const source = context.sourceCode;
        const strings = [];
        const codeNodes = new Set();
        const starts = [0];
        for (let at = source.text.indexOf('\n'); at >= 0; at = source.text.indexOf('\n', at + 1)) starts.push(at + 1);
        const lineAt = (offset) => starts.findLastIndex((start) => start <= offset) + 1;
        function trackCode(call) {
          for (const arg of codeArgs(call).filter((a) => a.type === 'Identifier')) {
            let scope = source.getScope(arg);
            while (scope && !scope.set.has(arg.name)) scope = scope.upper;
            const variable = scope?.set.get(arg.name);
            for (const def of variable?.defs ?? []) if (def.node.init) codeNodes.add(def.node.init);
            for (const ref of variable?.references ?? []) if (ref.writeExpr) codeNodes.add(ref.writeExpr);
          }
        }
        return {
          TemplateLiteral: (node) => strings.push(node),
          Literal(node) {
            if (typeof node.value === 'string' && node.parent?.type !== 'ImportDeclaration') strings.push(node);
          },
          CallExpression: trackCode,
          NewExpression: trackCode,
          'Program:exit'() {
            const comments = source.getAllComments().map((c) => [c.range[0], c.range[1]]);
            const templates = [];
            for (const node of strings) {
              const lang = langOf(node, source.text, codeNodes);
              if (node.type === 'Literal' && lang === 'text') continue;
              const { text, lines } = contentOf(node, source.text, lineAt);
              if (lang !== 'text' || /\/\/|\/\*|<!--/.test(text)) templates.push({ lang, text, lines });
            }
            const found = { file: context.physicalFilename ?? context.filename, comments, templates };
            fs.appendFileSync(process.env.NNC_OUT, `${JSON.stringify(found)}\n`);
          },
        };
      },
    },
  },
};
