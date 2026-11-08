import fs from 'node:fs';

const MARK = /\/\*\s*(glsl|wgsl|css|html|js)\s*\*\/\s*$/;
const TAGS = new Set(['glsl', 'wgsl', 'css', 'html']);
const RUNS_CODE = new Set([
  'evaluate',
  'evaluateHandle',
  'evaluateAll',
  '$eval',
  '$$eval',
  'waitForFunction',
  'addInitScript',
  'setTimeout',
  'setInterval',
  'Function',
  'eval',
]);
const SHADER = /^(vertex|fragment)Shader$/;
const NAMED = [
  [/(^|_)(css|styles?)$/i, 'css'],
  [/(vert|frag|shader|glsl)$/i, 'glsl'],
];
const STOP = /Statement$|Declaration$|^Program$|FunctionExpression$|^ArrowFunctionExpression$/;

function nameOf(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'MemberExpression' && !node.computed) return node.property.name;
  return null;
}

function marked(node, text) {
  const parent = node.parent;
  if (parent?.type === 'TaggedTemplateExpression' && TAGS.has(nameOf(parent.tag))) return nameOf(parent.tag);
  return MARK.exec(text.slice(Math.max(0, node.range[0] - 40), node.range[0]))?.[1] ?? null;
}

function langOf(node, text, codeNames) {
  for (let child = null, at = node; at && !STOP.test(at.type); child = at, at = at.parent) {
    const mark = at.type === 'TemplateLiteral' ? marked(at, text) : null;
    if (mark) return mark;
    const call = /^(Call|New)Expression$/.test(at.type) && at.arguments.includes(child);
    if (call && RUNS_CODE.has(nameOf(at.callee))) return 'js';
    if (at.type === 'Property' && at.value === child && SHADER.test(nameOf(at.key) ?? '')) return 'glsl';
    if (at.type === 'AssignmentExpression' && at.right === child && SHADER.test(nameOf(at.left) ?? '')) return 'glsl';
    if (at.type === 'VariableDeclarator' && at.init === child) {
      if (codeNames.has(at.id.name)) return 'js';
      return NAMED.find(([pattern]) => pattern.test(at.id.name ?? ''))?.[1] ?? 'text';
    }
  }
  return 'text';
}

function contentOf(node, text) {
  const start = node.range[0] + 1;
  const chars = text
    .slice(start, node.range[1] - 1)
    .split('')
    .map((c) => (c === '\n' ? c : ' '));
  for (const [i, quasi] of node.quasis.entries()) {
    const rawStart = quasi.range[0] + (text[quasi.range[0]] === '`' || text[quasi.range[0]] === '}' ? 1 : 0);
    const raw = quasi.value.raw;
    for (let k = 0; k < raw.length; k++) chars[rawStart - start + k] = raw[k];
    const gap = rawStart - start + raw.length;
    if (i < node.quasis.length - 1 && chars[gap] !== '\n') chars[gap] = '0';
  }
  return chars.join('');
}

export default {
  meta: { name: 'nnc' },
  rules: {
    found: {
      create(context) {
        const source = context.sourceCode;
        const strings = [];
        const codeNames = new Set();
        return {
          TemplateLiteral: (node) => strings.push(node),
          Literal(node) {
            if (typeof node.value === 'string' && node.parent?.type !== 'ImportDeclaration') strings.push(node);
          },
          CallExpression(node) {
            if (!RUNS_CODE.has(nameOf(node.callee))) return;
            for (const arg of node.arguments) if (arg.type === 'Identifier') codeNames.add(arg.name);
          },
          'Program:exit'() {
            const comments = source.getAllComments().map((c) => [c.range[0], c.range[1]]);
            const templates = [];
            for (const node of strings) {
              const lang = langOf(node, source.text, codeNames);
              const line = node.loc.start.line;
              const oneLine = node.type === 'Literal';
              if (oneLine && lang !== 'text') templates.push({ lang, line, text: node.value, oneLine });
              if (node.type !== 'TemplateLiteral') continue;
              const text = contentOf(node, source.text);
              if (lang !== 'text' || /\/\/|\/\*|<!--/.test(text)) templates.push({ lang, line, text });
            }
            const found = { file: context.physicalFilename ?? context.filename, comments, templates };
            fs.appendFileSync(process.env.NNC_OUT, `${JSON.stringify(found)}\n`);
          },
        };
      },
    },
  },
};
