const MARK = /\/\*\s*(glsl|wgsl|css|html|js)\s*\*\/\s*$/;
const TAGS = new Set(['glsl', 'wgsl', 'css', 'html']);
const RUNS_IN_PAGE = new Set([
  'evaluate',
  'evaluateHandle',
  'evaluateAll',
  '$eval',
  '$$eval',
  'waitForFunction',
  'addInitScript',
]);
const SHADER = /^(vertex|fragment)Shader$/;
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

function langOf(node, text) {
  for (let child = null, at = node; at && !STOP.test(at.type); child = at, at = at.parent) {
    const mark = at.type === 'TemplateLiteral' ? marked(at, text) : null;
    if (mark) return mark;
    const call = at.type === 'CallExpression' && at.arguments.includes(child);
    if (call && RUNS_IN_PAGE.has(nameOf(at.callee))) return 'js';
    if (at.type === 'Property' && at.value === child && SHADER.test(nameOf(at.key) ?? '')) return 'glsl';
    if (at.type === 'AssignmentExpression' && at.right === child && SHADER.test(nameOf(at.left) ?? '')) return 'glsl';
  }
  return 'text';
}

function contentOf(node, text) {
  const start = node.range[0] + 1;
  const chars = text.slice(start, node.range[1] - 1).split('').map((c) => (c === '\n' ? c : ' '));
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
        return {
          Program(node) {
            for (const comment of source.getAllComments()) {
              const found = { comment: [comment.range[0], comment.range[1]] };
              context.report({ node, message: JSON.stringify(found) });
            }
          },
          TemplateLiteral(node) {
            const lang = langOf(node, source.text);
            const text = contentOf(node, source.text);
            if (lang === 'text' && !/\/\/|\/\*|<!--/.test(text)) return;
            const template = { lang, line: node.loc.start.line, text };
            context.report({ node, message: JSON.stringify({ template }) });
          },
        };
      },
    },
  },
};
