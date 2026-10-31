// Finds every name an E2E script uses without defining it: a helper a rebase deleted, a typo, or a name a function run
// in the page takes from the test around it, where it doesn't exist. Each would only stop its scenario at "is not
// defined" once a browser got to that line, so scripts/e2e.mjs checks the scenario files, and the scripts they import,
// before it starts one. CI's check job runs it on its own: node scripts/e2e-scope-check.mjs
// A function runs in the page when it is given to a Playwright call that runs it there (evaluate, waitForFunction,
// addInitScript and the like), in place or by any name that leads back to it, or to a function of ours that hands it to
// one (harness.mjs's until()), or when its text is part of the code such a call or a CDP Runtime.evaluate runs. The
// page's globals are the language's own and the DOM's, as the TypeScript that type-checks src/ declares them, plus what
// the scripts expose with exposeFunction or exposeBinding.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parseAst } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsLib = path.join(path.dirname(createRequire(import.meta.resolve('typescript/package.json')).resolve(`@typescript/typescript-${process.platform}-${process.arch}/package.json`)), 'lib');
const NODE = new Set(Object.getOwnPropertyNames(globalThis));
const PAGE = new Set(vm.runInNewContext('Object.getOwnPropertyNames(globalThis)'));
for (const m of fs.readFileSync(path.join(tsLib, 'lib.dom.d.ts'), 'utf8').matchAll(/^declare (?:var|let|const|function|namespace|class) ([\w$]+)/gm)) PAGE.add(m[1]);
// the argument whose function Playwright runs in the page
const PAGE_CALLS = { evaluate: '0', evaluateHandle: '0', evaluateAll: '0', waitForFunction: '0', addInitScript: '0', $eval: '1', $$eval: '1' };
// CDP methods that run text in the page, and the field of their parameters it goes in
const CDP_CODE = { 'Runtime.evaluate': 'expression', 'Runtime.callFunctionOn': 'functionDeclaration', 'Page.addScriptToEvaluateOnNewDocument': 'source' };
const FUNCTION = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

const keyName = (n) => n.name ?? n.value;
// the method a call calls, x.name(), by its name
const methodOf = (call) => (call.callee.type === 'MemberExpression' && !call.callee.computed ? call.callee.property.name : null);
const property = (o, key) => o.properties.find((p) => p.type === 'Property' && !p.computed && keyName(p.key) === key)?.value;

/** Where each identifier a binding pattern declares sits in the value it takes apart: the keys and indexes to it. */
function paths(p, path = [], out = new Map()) {
  if (p.type === 'Identifier') out.set(p, path);
  else if (p.type === 'ObjectPattern') {
    for (const q of p.properties) if (q.type === 'Property' && !q.computed) paths(q.value, [...path, keyName(q.key)], out);
  } else if (p.type === 'ArrayPattern') p.elements.forEach((e, i) => e && paths(e, [...path, i], out));
  else if (p.type === 'AssignmentPattern') paths(p.left, path, out);
  return out;
}

/** The identifiers a binding pattern declares. */
function declared(p, out = []) {
  if (p.type === 'Identifier') out.push(p);
  else if (p.type === 'ObjectPattern') for (const q of p.properties) declared(q.type === 'RestElement' ? q.argument : q.value, out);
  else if (p.type === 'ArrayPattern') for (const e of p.elements) e && declared(e, out);
  else if (p.type === 'RestElement') declared(p.argument, out);
  else if (p.type === 'AssignmentPattern') declared(p.left, out);
  return out;
}

function lookup(s, name) {
  for (; s; s = s.parent) if (s.names.has(name)) return s.names.get(name);
  return null;
}

/** Reads one script's scopes: every name it uses and what it refers to, its calls, imports and exports. */
function read(file) {
  const source = fs.readFileSync(file, 'utf8');
  const uses = [];
  const calls = [];
  const links = [];
  const shipped = [];
  const imports = [];
  const exports = new Map();
  const stars = [];
  // the calls whose arguments the walk is in, and which argument, up to the function it is in
  const within = [];
  const scope = (parent, fn = null) => ({ parent, fn, names: new Map() });
  const declare = (s, id, about = {}) => s.names.set(id.name, { ...about, scope: s });
  const declarator = (s, d) => {
    const at = d.init ? paths(d.id) : new Map();
    for (const id of declared(d.id)) declare(s, id, at.has(id) ? { init: d.init, path: at.get(id) } : {});
  };
  const from = (spec) => (spec.startsWith('.') ? path.resolve(path.dirname(file), spec) : null);
  const vars = (node, s) => {
    if (Array.isArray(node)) for (const n of node) n && vars(n, s);
    else if (node && typeof node === 'object' && !FUNCTION.has(node.type) && node.type !== 'StaticBlock') {
      if (node.type === 'VariableDeclaration' && node.kind === 'var') for (const d of node.declarations) declarator(s, d);
      for (const v of Object.values(node)) if (v && typeof v === 'object') vars(v, s);
    }
  };
  const lexical = (statements, s) => {
    for (const st of statements) {
      const d = st.type === 'ExportNamedDeclaration' || st.type === 'ExportDefaultDeclaration' ? st.declaration : st;
      if (d?.type === 'VariableDeclaration' && d.kind !== 'var') for (const v of d.declarations) declarator(s, v);
      else if (d?.type === 'FunctionDeclaration' && d.id) declare(s, d.id, { fn: d });
      else if (d?.type === 'ClassDeclaration' && d.id) declare(s, d.id);
      else if (d?.type === 'ImportDeclaration') {
        for (const sp of d.specifiers) declare(s, sp.local, { from: from(d.source.value), name: sp.type === 'ImportSpecifier' ? keyName(sp.imported) : sp.type === 'ImportDefaultSpecifier' ? 'default' : '*' });
      }
    }
  };
  const block = (statements, s) => {
    lexical(statements, s);
    visit(statements, s);
  };
  // a binding pattern declares its identifiers; only its defaults and computed keys use names
  const pattern = (p, s) => {
    if (p.type === 'ObjectPattern') {
      for (const q of p.properties) {
        if (q.type === 'RestElement') pattern(q.argument, s);
        else {
          if (q.computed) visit(q.key, s);
          pattern(q.value, s);
        }
      }
    } else if (p.type === 'ArrayPattern') for (const e of p.elements) e && pattern(e, s);
    else if (p.type === 'RestElement') pattern(p.argument, s);
    else if (p.type === 'AssignmentPattern') {
      pattern(p.left, s);
      visit(p.right, s);
    }
  };
  const use = (id, s, typeOf = false) => uses.push({ id, s, binding: lookup(s, id.name), typeOf });
  // a function's text, as ${fn} or fn.toString(): it runs in the page if it is part of the code a call sends there
  const ship = (arg, s) => shipped.push({ arg, s, calls: [...within] });

  function visit(node, s) {
    if (Array.isArray(node)) {
      for (const n of node) n && visit(n, s);
      return;
    }
    switch (node.type) {
      case 'Identifier':
        return use(node, s);
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        const outer = within.splice(0);
        const f = scope(s, node);
        if (node.type === 'FunctionExpression' && node.id) declare(f, node.id, { fn: node });
        if (node.type !== 'ArrowFunctionExpression') f.names.set('arguments', { scope: f });
        // a parameter, or a property of an options parameter, that a call could hand a function in
        node.params.forEach((p, i) => {
          const q = p.type === 'AssignmentPattern' ? p.left : p;
          const slots = new Map([[q, String(i)]]);
          if (q.type === 'ObjectPattern') {
            for (const r of q.properties) {
              const v = r.value?.type === 'AssignmentPattern' ? r.value.left : r.value;
              if (r.type === 'Property' && !r.computed) slots.set(v, `${i}.${keyName(r.key)}`);
            }
          }
          for (const id of declared(p)) declare(f, id, { param: slots.get(id), of: node });
        });
        for (const p of node.params) pattern(p, f);
        if (node.body.type === 'BlockStatement') {
          // the parameters' defaults can't see what the body declares
          const body = scope(f);
          vars(node.body, body);
          block(node.body.body, body);
        } else visit(node.body, f);
        within.push(...outer);
        return;
      }
      case 'ClassDeclaration':
      case 'ClassExpression': {
        const c = scope(s);
        if (node.id) declare(c, node.id);
        if (node.superClass) visit(node.superClass, c);
        for (const m of node.body.body) {
          if (m.type === 'StaticBlock') {
            const b = scope(c);
            vars(m.body, b);
            block(m.body, b);
            continue;
          }
          if (m.computed) visit(m.key, c);
          if (m.value) visit(m.value, c);
        }
        return;
      }
      case 'VariableDeclaration':
        for (const d of node.declarations) {
          pattern(d.id, s);
          if (d.init) visit(d.init, s);
        }
        return;
      case 'BlockStatement':
        return block(node.body, scope(s));
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement': {
        const b = scope(s);
        const head = node.init ?? node.left;
        if (head?.type === 'VariableDeclaration' && head.kind !== 'var') for (const d of head.declarations) declarator(b, d);
        for (const k of ['init', 'test', 'update', 'left', 'right', 'body']) if (node[k]) visit(node[k], b);
        return;
      }
      case 'CatchClause': {
        const b = scope(s);
        if (node.param) {
          for (const id of declared(node.param)) declare(b, id);
          pattern(node.param, b);
        }
        return visit(node.body, b);
      }
      case 'SwitchStatement': {
        visit(node.discriminant, s);
        const b = scope(s);
        lexical(node.cases.flatMap((c) => c.consequent), b);
        for (const c of node.cases) visit([c.test, ...c.consequent], b);
        return;
      }
      case 'MemberExpression':
        visit(node.object, s);
        if (node.computed) visit(node.property, s);
        return;
      case 'Property':
        if (node.computed) visit(node.key, s);
        return visit(node.value, s);
      case 'ObjectExpression':
        for (const p of node.properties) if (p.type === 'Property' && !p.computed) links.push({ name: keyName(p.key), value: p.value, s });
        return visit(node.properties, s);
      case 'AssignmentExpression':
        if (node.left.type === 'MemberExpression' && !node.left.computed) links.push({ name: node.left.property.name, value: node.right, s });
        visit(node.left, s);
        return visit(node.right, s);
      case 'UnaryExpression':
        // typeof asks about a name without needing it
        if (node.operator === 'typeof' && node.argument.type === 'Identifier') return use(node.argument, s, true);
        return visit(node.argument, s);
      case 'CallExpression':
        calls.push({ node, s });
        if (methodOf(node) === 'toString' && !node.arguments.length) ship(node.callee.object, s);
        visit(node.callee, s);
        node.arguments.forEach((a, i) => {
          within.push({ node, s, i });
          visit(a, s);
          within.pop();
        });
        return;
      case 'TemplateLiteral':
        for (const e of node.expressions) ship(e, s);
        return visit(node.expressions, s);
      case 'ImportExpression':
        if (node.source.type === 'Literal' && from(node.source.value)) imports.push(from(node.source.value));
        return visit(node.source, s);
      case 'ImportDeclaration':
        if (from(node.source.value)) imports.push(from(node.source.value));
        return;
      case 'ExportNamedDeclaration':
        if (node.source) {
          if (from(node.source.value)) imports.push(from(node.source.value));
          for (const sp of node.specifiers) exports.set(keyName(sp.exported), { from: from(node.source.value), name: keyName(sp.local) });
          return;
        }
        if (node.declaration) {
          visit(node.declaration, s);
          for (const id of node.declaration.declarations?.flatMap((d) => declared(d.id)) ?? [node.declaration.id]) exports.set(id.name, { local: id.name });
        }
        for (const sp of node.specifiers) {
          use(sp.local, s);
          exports.set(keyName(sp.exported), { local: sp.local.name });
        }
        return;
      case 'ExportDefaultDeclaration': {
        const d = node.declaration;
        exports.set('default', d.id ? { local: d.id.name } : d.type === 'Identifier' ? { local: d.name } : { init: d });
        return visit(d, s);
      }
      case 'ExportAllDeclaration':
        if (from(node.source.value)) imports.push(from(node.source.value));
        if (node.exported) exports.set(keyName(node.exported), { from: from(node.source.value), name: '*' });
        else stars.push(from(node.source.value));
        return;
      case 'LabeledStatement':
        return visit(node.body, s);
      case 'BreakStatement':
      case 'ContinueStatement':
      case 'MetaProperty':
      case 'PrivateIdentifier':
        return;
      default:
        for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v, s);
    }
  }

  const ast = parseAst(source);
  const top = scope(null);
  vars(ast.body, top);
  block(ast.body, top);
  return { file, source, top, uses, calls, links, shipped, imports, exports, stars };
}

/** Every use of a name the given E2E scripts, and the scripts they import, never define, as "file:line: what" lines. */
export function undefinedNames(entries) {
  const scripts = new Map();
  for (const queue = entries.map((f) => path.resolve(f)); queue.length; ) {
    const file = queue.shift();
    if (scripts.has(file) || !/\.m?js$/.test(file) || !fs.existsSync(file)) continue;
    const script = read(file);
    scripts.set(file, script);
    queue.push(...script.imports);
  }
  // what an expression comes to, as far as the code shows: a function, object or array literal, with the scope it was
  // written in, or another script's namespace
  const valueOf = (node, s, seen = new Set()) => {
    if (!node || seen.has(node)) return null;
    seen.add(node);
    if (FUNCTION.has(node.type) || node.type === 'ObjectExpression' || node.type === 'ArrayExpression') return { node, s };
    if (node.type === 'Identifier') return bound(lookup(s, node.name), s, seen);
    if (node.type !== 'MemberExpression' || node.computed) return null;
    return member(valueOf(node.object, s, seen), node.property.name, seen);
  };
  const member = (o, key, seen) => {
    if (o?.script) return exported(o.script, key, seen);
    const v = o?.node.type === 'ObjectExpression' ? property(o.node, key) : o?.node.type === 'ArrayExpression' ? o.node.elements[key] : null;
    return v ? valueOf(v, o.s, seen) : null;
  };
  const bound = (b, s, seen) => {
    if (b?.fn) return { node: b.fn, s };
    if (b?.init) return b.path.reduce((o, key) => member(o, key, seen), valueOf(b.init, b.scope, seen));
    const script = b?.from && scripts.get(b.from);
    if (!script) return null;
    return b.name === '*' ? { script } : exported(script, b.name, seen);
  };
  const exported = (script, name, seen) => {
    const key = `${script.file}#${name}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const e = script.exports.get(name);
    if (e) return e.local ? bound(script.top.names.get(e.local), script.top, seen) : e.init ? valueOf(e.init, script.top, seen) : bound(e, script.top, seen);
    for (const star of script.stars) {
      const v = bound({ from: star, name }, script.top, seen);
      if (v) return v;
    }
    return null;
  };
  const functionOf = (node, s) => {
    const v = valueOf(node, s);
    return FUNCTION.has(v?.node?.type) ? v.node : null;
  };
  const pageFns = new Set();
  const exposed = new Set();
  // the parameters ("1", or "1.init" for an options parameter's init) a function of ours hands to the page, and the
  // methods that are such a function
  const forwards = new Map();
  const methods = new Map(Object.entries(PAGE_CALLS).map(([name, slot]) => [name, new Set([slot])]));
  const add = (map, key, values) => {
    const had = map.get(key) ?? new Set();
    const size = had.size;
    for (const v of values) had.add(v);
    map.set(key, had);
    return had.size !== size;
  };
  const slotsOf = ({ node, s }) => {
    const cdp = methodOf(node) === 'send' && CDP_CODE[node.arguments[0]?.value];
    return [...(methods.get(methodOf(node)) ?? []), ...(forwards.get(functionOf(node.callee, s)) ?? []), ...(cdp ? [`1.${cdp}`] : [])];
  };
  // whether `at`, in the call's argument i, is code the call runs in the page, not data it hands over
  const runsInPage = ({ node, s, i }, at) => {
    const slots = slotsOf({ node, s });
    const arg = node.arguments[i];
    const p = arg.type === 'ObjectExpression' && arg.properties.find((p) => p.type === 'Property' && !p.computed && p.start <= at.start && at.end <= p.end);
    return slots.includes(String(i)) || (p && slots.includes(`${i}.${keyName(p.key)}`));
  };
  const slotIn = (p, key) => (p && !p.param.includes('.') ? { of: p.of, param: `${p.param}.${key}` } : null);
  // the parameter slot an expression comes from, through aliases and an options parameter's properties
  const paramOf = (node, s, seen = new Set()) => {
    if (!node || seen.has(node)) return null;
    seen.add(node);
    if (node.type === 'Identifier') {
      const binding = lookup(s, node.name);
      if (binding?.param) return binding;
      return binding?.init ? binding.path.reduce(slotIn, paramOf(binding.init, binding.scope, seen)) : null;
    }
    if (node.type !== 'MemberExpression' || node.computed) return null;
    return slotIn(paramOf(node.object, s, seen), node.property.name);
  };
  // takes a function that runs in the page; says whether that taught a function of ours to hand one there
  const toPage = (arg, s) => {
    const fn = functionOf(arg, s);
    if (fn) pageFns.add(fn);
    else {
      const p = paramOf(arg, s);
      if (p) return add(forwards, p.of, [p.param]);
    }
    return false;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const { calls, links, shipped } of scripts.values()) {
      for (const { arg, s, calls: within } of shipped) if (within.some((call) => runsInPage(call, arg))) changed = toPage(arg, s) || changed;
      for (const call of calls) {
        const { node, s } = call;
        if (['exposeFunction', 'exposeBinding'].includes(methodOf(node)) && node.arguments[0]?.type === 'Literal') exposed.add(node.arguments[0].value);
        for (const slot of slotsOf(call)) {
          const [i, key] = slot.split('.');
          if (!key) changed = toPage(node.arguments[i], s) || changed;
          else {
            const options = valueOf(node.arguments[i], s);
            if (options?.node?.type === 'ObjectExpression') changed = toPage(property(options.node, key), options.s) || changed;
            else {
              const p = slotIn(paramOf(node.arguments[i], s), key);
              if (p) changed = add(forwards, p.of, [p.param]) || changed;
            }
          }
        }
      }
      for (const { name, value, s } of links) {
        const fn = functionOf(value, s);
        if (forwards.has(fn)) changed = add(methods, name, forwards.get(fn)) || changed;
      }
    }
  }
  const found = new Set();
  for (const { file, source, uses } of scripts.values()) {
    for (const { id, s, binding, typeOf } of uses) {
      // code inside a function that runs in the page runs there too; a function declaration sent there keeps its name
      let page = null;
      for (let at = s; at; at = at.parent) if (pageFns.has(at.fn)) page = at.fn;
      let what = null;
      if (!page) {
        if (!binding && !typeOf && !NODE.has(id.name)) what = 'is not defined';
      } else if (binding && !(binding.fn === page && page.type === 'FunctionDeclaration')) {
        let inside = false;
        for (let at = binding.scope; at && !inside; at = at.parent) inside = at.fn === page;
        if (!inside) what = 'is defined in the test, but this function runs in the page: pass it in as an argument';
      } else if (!binding && !typeOf && !PAGE.has(id.name) && !exposed.has(id.name)) what = 'is not defined in the page, where this function runs';
      if (what) found.add(`${path.relative(root, file)}:${source.slice(0, id.start).split('\n').length}: ${id.name} ${what}`);
    }
  }
  return [...found];
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const t = performance.now();
  const dir = path.join(root, 'scripts/e2e');
  const missing = undefinedNames(fs.readdirSync(dir).filter((f) => f.endsWith('.e2e.mjs')).map((f) => path.join(dir, f)));
  if (missing.length) {
    console.error(`The E2E scripts use names they never define, and each stops its scenario at "is not defined":\n${missing.join('\n')}`);
    process.exitCode = 1;
  } else console.log(`Every name the E2E scripts use is defined (${Math.round(performance.now() - t)} ms)`);
}
