import {
  AUDIO_TIME_ARG, audioParam, calleeName, declaratorOf, declaredAs, isNamed, memberName, methodName, variableOf,
} from './ast.mjs';
import { busRules } from './bus-rules.mjs';
import { prebuildRules } from './prebuild-rules.mjs';

const SKIPPED_KEYS = new Set(['parent', 'loc', 'range']);
const FUNCTIONS = new Set(['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration']);

const isGlobal = (node, name) => node?.type === 'Identifier' ? node.name === name : isNamed(node, name);

const isNode = (value) => typeof value?.type === 'string';

function children(node) {
  return Object.entries(node)
    .filter(([key, value]) => !SKIPPED_KEYS.has(key) && value && typeof value === 'object')
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]).filter(isNode));
}

function constantOf(context, id) {
  const def = declaratorOf(context, id);
  return def?.parent.kind === 'const' ? def.init : null;
}

function readsAudioClock(context, node, seen = new Set()) {
  if (!node || seen.has(node) || FUNCTIONS.has(node.type)) return false;
  seen.add(node);
  if (node.type === 'MemberExpression') {
    if (isNamed(node, 'currentTime')) return !isNamed(node.object, 'timeline');
    const key = node.computed ? node.property : null;
    return readsAudioClock(context, node.object, seen) || readsAudioClock(context, key, seen);
  }
  if (node.type === 'Identifier') return readsAudioClock(context, declaredAs(context, node), seen);
  if (node.type === 'Property') return readsAudioClock(context, node.value, seen);
  return children(node).some((child) => readsAudioClock(context, child, seen));
}

function anchorsLinearRamp(node) {
  if (methodName(node) !== 'setValueAtTime') return false;
  const receiver = node.callee.object;
  if (receiver.type !== 'ThisExpression' && !(isNamed(receiver, 'param')
    && receiver.object.type === 'ThisExpression')) return false;
  for (let at = node.parent; at; at = at.parent) {
    if (FUNCTIONS.has(at.type)) {
      return at.parent?.type === 'MethodDefinition' && nameOf(at) === 'linearRampToValueAtTime';
    }
  }
  return false;
}

const audioTimesFromSoon = {
  meta: {
    messages: {
      clock:
        'Schedule from soon(ctx), not the audio clock as it reads now: by the time the sound is built, that moment ' +
        'has already played.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const at = AUDIO_TIME_ARG.get(methodName(node));
        const time = at === undefined ? null : node.arguments[at];
        if (time && !anchorsLinearRamp(node) && readsAudioClock(context, time)) {
          context.report({ node: time, messageId: 'clock' });
        }
      },
    };
  },
};

const lateOpensBuildAgain = {
  meta: {
    messages: {
      dropped: 'Open held sounds with openPrebuilt so a missed placement retries a built copy or drops '
        + 'before it opens.',
    },
  },
  create(context) {
    const usesVoice = context.sourceCode.ast.body.some((node) =>
      node.type === 'ImportDeclaration'
        ? node.specifiers.some((s) => s.imported?.name === 'Voice')
        : (node.declaration ?? node).id?.name === 'Voice');
    return {
      CallExpression(node) {
        const callee = node.callee;
        const method = callee.type === 'MemberExpression'
          ? callee.computed ? callee.property.value : callee.property.name
          : null;
        if (method !== 'open' && method !== 'openInTime') return;
        if (method === 'open' && !usesVoice) return;
        let parent = node.parent;
        while (parent && parent.type !== 'MethodDefinition') parent = parent.parent;
        const checked = parent?.static && parent.key.name === 'openBuilt' &&
          parent.parent.parent.id?.name === 'Voice';
        if (method === 'open' || !checked) context.report({ node, messageId: 'dropped' });
      },
    };
  },
};

const animationsShareStartTime = {
  meta: {
    messages: {
      place:
        'Line animations up by giving them the same startTime. A currentTime set on one still waiting for its ' +
        'first frame only counts from that frame.',
    },
  },
  create(context) {
    return {
      AssignmentExpression(node) {
        if (isNamed(node.left, 'currentTime')) context.report({ node: node.left, messageId: 'place' });
      },
    };
  },
};

const followDevicePreferences = {
  meta: {
    messages: {
      once:
        'A device preference can change while the page is open: keep the MediaQueryList and follow its change ' +
        'event instead of reading .matches once.',
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        const call = node.object;
        if (!isNamed(node, 'matches') || call.type !== 'CallExpression' || !isGlobal(call.callee, 'matchMedia')) return;
        const query = call.arguments[0];
        if (typeof query?.value === 'string' && query.value.includes('prefers-')) {
          context.report({ node, messageId: 'once' });
        }
      },
    };
  },
};

const SOFT_HYPHEN = '\u00ad';

const noSoftHyphenCharacters = {
  meta: {
    messages: {
      shy: 'A soft hyphen in the text is read aloud and copied with it. Mark the break with shy() instead.',
    },
  },
  create(context) {
    const check = (node, text) => {
      if (typeof text === 'string' && text.includes(SOFT_HYPHEN)) context.report({ node, messageId: 'shy' });
    };
    return {
      Literal: (node) => check(node, node.value),
      TemplateElement: (node) => check(node, node.value.cooked),
    };
  },
};

const STORAGE_WRITES = new Set(['setItem', 'removeItem', 'clear']);

const storedWritesGoThroughCleared = {
  meta: {
    messages: {
      direct:
        'Store beside the saves with setStored() or removeStored() from core/cleared, so a write that lands ' +
        'after a clear is taken back.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!STORAGE_WRITES.has(methodName(node)) || !isGlobal(node.callee.object, 'localStorage')) return;
        context.report({ node, messageId: 'direct' });
      },
    };
  },
};

const POINTER_METHODS = new Set(['click', 'dblclick', 'move', 'tap']);

const EXPRESSION_WRAPPERS = new Set([
  'TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression', 'TSSatisfiesExpression', 'ParenthesizedExpression',
]);

function unwrapped(node) {
  while (EXPRESSION_WRAPPERS.has(node?.type)) node = node.expression;
  return node;
}

function isFixedNumber(context, node, resolving = new Set()) {
  switch (node?.type) {
    case 'Literal':
      return typeof node.value === 'number';
    case 'UnaryExpression':
      return node.operator === '-' && isFixedNumber(context, node.argument, resolving);
    case 'BinaryExpression':
      return isFixedNumber(context, node.left, resolving) && isFixedNumber(context, node.right, resolving);
    case 'Identifier': {
      const variable = variableOf(context, node);
      if (!variable || resolving.has(variable)) return false;
      return isFixedNumber(context, constantOf(context, node), new Set(resolving).add(variable));
    }
    default:
      return false;
  }
}

const tapElementsNotPoints = {
  meta: {
    messages: {
      point:
        'Tap the element you mean (a locator click), not a point written into the test: whatever is there by ' +
        'then takes the tap.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const device = node.callee.type === 'MemberExpression' ? node.callee.object : null;
        if (!POINTER_METHODS.has(methodName(node))) return;
        if (!isNamed(device, 'mouse') && !isNamed(device, 'touchscreen')) return;
        const fixed = node.arguments.slice(0, 2).some((arg) => isFixedNumber(context, arg));
        if (fixed) context.report({ node, messageId: 'point' });
      },
    };
  },
};

const IN_PAGE_ARGUMENT = new Map([
  ['evaluate', 0], ['evaluateHandle', 0], ['evaluateAll', 0], ['addInitScript', 0], ['waitForFunction', 0],
  ['$eval', 1], ['$$eval', 1],
]);

function runsInPage(node) {
  for (let at = node.parent; at; at = at.parent) {
    const call = at.parent;
    if (!FUNCTIONS.has(at.type) || call?.type !== 'CallExpression') continue;
    if (call.arguments[IN_PAGE_ARGUMENT.get(methodName(call))] === at) return true;
  }
  return false;
}

function staticKey(key, computed) {
  if (!computed && key.type === 'Identifier') return key.name;
  if (key.type === 'Literal') return key.value;
  return key.type === 'TemplateLiteral' && !key.expressions.length ? key.quasis[0].value.cooked : null;
}

const clockCallsGoThroughClockModule = {
  meta: {
    messages: {
      clock:
        'Move the page clock through scripts/e2e/clock.mjs, whose pauseClock(page) pauses where the clock stands: ' +
        'a time passed to clock.pauseAt may be past by the time the call lands on a running page.',
    },
  },
  create(context) {
    const isClockKey = (p) => p.type === 'Property' && staticKey(p.key, p.computed) === 'clock';
    return {
      MemberExpression(node) {
        if (staticKey(node.property, node.computed) !== 'clock' || runsInPage(node)) return;
        context.report({ node, messageId: 'clock' });
      },
      ObjectPattern(node) {
        if (runsInPage(node)) return;
        for (const p of node.properties.filter(isClockKey)) context.report({ node: p, messageId: 'clock' });
      },
    };
  },
};

const LOST_EVENT = 'webglcontextlost';

function canvasOf(context, node) {
  if (node?.type === 'Identifier') return variableOf(context, node);
  if (isNamed(node, 'domElement') && node.object.type === 'Identifier') return variableOf(context, node.object);
  return null;
}

function rendererCanvases(context, node) {
  const options = node.arguments[0]?.type === 'ObjectExpression' ? node.arguments[0].properties : [];
  const given = options.find((p) => p.type === 'Property' && !p.computed && p.key.name === 'canvas');
  const bound = node.parent.type === 'VariableDeclarator' ? node.parent.id : null;
  return [canvasOf(context, given?.value), canvasOf(context, bound)].filter(Boolean);
}

function lossListenerTarget(context, call) {
  if (methodName(call) !== 'addEventListener') return null;
  const event = call.arguments[0];
  const named = event?.type === 'Identifier' ? constantOf(context, event) : event;
  return named?.type === 'Literal' && named.value === LOST_EVENT ? canvasOf(context, call.callee.object) : null;
}

function functionOf(context, callee) {
  if (callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'ThisExpression') {
    let body = callee.parent;
    while (body && body.type !== 'ClassBody') body = body.parent;
    const method = body?.body.find((p) => !p.computed && p.key?.name === callee.property.name)?.value;
    return FUNCTIONS.has(method?.type) ? method : null;
  }
  const def = callee.type === 'Identifier' ? variableOf(context, callee)?.defs[0]?.node : null;
  if (def?.type === 'FunctionDeclaration') return def;
  return def?.type === 'VariableDeclarator' && FUNCTIONS.has(def.init?.type) ? def.init : null;
}

function listenThroughHandOvers(listened, handedOver) {
  const newlyHeard = () => handedOver.filter(({ canvas, param }) => listened.has(param) && !listened.has(canvas));
  for (let heard = newlyHeard(); heard.length; heard = newlyHeard()) {
    for (const { canvas } of heard) listened.add(canvas);
  }
}

const handleLostGpuContext = {
  meta: {
    messages: {
      lost:
        'Listen for webglcontextlost on this renderer\'s canvas, here or through a function this file calls, or ' +
        'the scene keeps drawing into a dead canvas.',
    },
  },
  create(context) {
    const renderers = [];
    const listened = new Set();
    const handedOver = [];
    return {
      NewExpression(node) {
        if (isGlobal(node.callee, 'WebGLRenderer')) renderers.push({ node, canvases: rendererCanvases(context, node) });
      },
      CallExpression(node) {
        const target = lossListenerTarget(context, node);
        if (target) listened.add(target);
        const fn = functionOf(context, node.callee);
        if (!fn) return;
        node.arguments.forEach((arg, i) => {
          const canvas = canvasOf(context, arg);
          const param = fn.params[i];
          if (canvas && param?.type === 'Identifier') handedOver.push({ canvas, param: variableOf(context, param) });
        });
      },
      'Program:exit'() {
        listenThroughHandOvers(listened, handedOver);
        for (const { node, canvases } of renderers) {
          if (!canvases.some((canvas) => listened.has(canvas))) context.report({ node, messageId: 'lost' });
        }
      },
    };
  },
};

const LOADS_ECHO = new Set(['createConvolver', 'makeIR', 'ConvolverNode']);

function nameOf(fn) {
  const p = fn.parent;
  if (fn.type === 'FunctionDeclaration') return fn.id?.name ?? null;
  if (p?.type === 'MethodDefinition' || p?.type === 'Property') return p.computed ? null : p.key.name;
  if (p?.type === 'VariableDeclarator' && p.id.type === 'Identifier') return p.id.name;
  return null;
}

function ownCalls(node, calls = []) {
  if (node.type === 'CallExpression' || node.type === 'NewExpression') calls.push(node);
  for (const child of children(node)) if (!FUNCTIONS.has(child.type)) ownCalls(child, calls);
  return calls;
}

const callsSoon = (node) => !!node && !FUNCTIONS.has(node.type) && (
  (node.type === 'CallExpression' && calleeName(node) === 'soon') || children(node).some(callsSoon));

function bindsTime(node) {
  if (node.type === 'VariableDeclarator') return [node.id, node.init];
  if (node.type === 'AssignmentExpression' && node.operator === '=') return [node.left, node.right];
  return [null, null];
}

function ownNodes(node, found = []) {
  for (const child of children(node)) {
    if (FUNCTIONS.has(child.type)) continue;
    found.push(child);
    ownNodes(child, found);
  }
  return found;
}

function soonTimes(context, fn, before) {
  const times = new Set();
  const add = (id) => {
    const v = id?.type === 'Identifier' ? variableOf(context, id) : null;
    if (v) times.add(v);
  };
  for (const p of fn.params) {
    if (p.type === 'AssignmentPattern' && (callsSoon(p.right) || mentions(context, p.right, times))) add(p.left);
  }
  for (const node of ownNodes(fn.body)) {
    const [id, value] = bindsTime(node);
    if (id && ((callsSoon(value) && node.range[1] <= before) || mentions(context, value, times))) add(id);
  }
  return times;
}

function straightBlock(node) {
  const statement = node.parent;
  if (node.type === 'AssignmentExpression') {
    if (statement.type !== 'ExpressionStatement') return null;
  } else if (statement.type !== 'VariableDeclaration' || !['let', 'const'].includes(statement.kind)) {
    return null;
  }
  let block = statement.parent;
  if (block?.type !== 'BlockStatement') return null;
  while (block.parent?.type === 'BlockStatement') block = block.parent;
  return block;
}

const contains = (block, node) => block && block.range[0] <= node.range[0] && node.range[1] <= block.range[1];

function timeWrites(context, fn, from) {
  const variables = new Set();
  for (const node of ownNodes(fn.body)) {
    const id = node.type === 'AssignmentExpression' ? node.left : bindsTime(node)[0];
    if (id?.type === 'Identifier') variables.add(variableOf(context, id));
  }
  return [...variables].filter(Boolean).flatMap((variable) =>
    variable.references.filter((r) => r.isWrite())
      .map((r) => ({ variable, id: r.identifier, captured: r.from.variableScope.block !== fn }))
      .filter(({ id, captured }) => captured || id.range[0] >= from));
}

const NUMBER_OPERATORS = {
  '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b,
  '/': (a, b) => a / b, '%': (a, b) => a % b, '**': (a, b) => a ** b,
};
const fixedNumbers = new WeakMap();

function fixedNumber(context, node) {
  node = unwrapped(node);
  if (!node) return NaN;
  if (fixedNumbers.has(node)) return fixedNumbers.get(node);
  fixedNumbers.set(node, NaN);
  let value = NaN;
  if (node.type === 'Literal' && typeof node.value === 'number') value = node.value;
  if (node.type === 'Identifier') value = fixedNumber(context, constantOf(context, node));
  if (node.type === 'UnaryExpression' && node.operator === '-') value = -fixedNumber(context, node.argument);
  if (node.type === 'BinaryExpression') {
    value = NUMBER_OPERATORS[node.operator]?.(fixedNumber(context, node.left), fixedNumber(context, node.right)) ?? NaN;
  }
  fixedNumbers.set(node, value);
  return value;
}

function writeIsFresh(context, variable, id, from, fresh, memo) {
  const node = id.parent;
  const [bound, value] = bindsTime(node);
  const compound = node.type === 'AssignmentExpression' && node.left === id &&
    node.operator === '+=' && fixedNumber(context, node.right) >= 0 && freshAt(fresh, variable, id);
  return compound || (bound === id && freshValue(context, value, from, fresh, memo));
}

function refreshed(context, fn, from, memo) {
  const writes = timeWrites(context, fn, from);
  const fresh = new Map();
  for (const { variable, id, captured } of writes) {
    const node = id.parent;
    const block = straightBlock(node);
    if (captured || !block || bindsTime(node)[0] !== id) continue;
    if (!fresh.has(variable)) fresh.set(variable, []);
    fresh.get(variable).push({ node, block });
  }
  for (;;) {
    let changed = false;
    for (const [variable, refreshes] of fresh) {
      const kept = refreshes.filter(({ node }) =>
        freshValue(context, bindsTime(node)[1], from, fresh, memo) && writes.every((write) =>
          write.variable !== variable || (!write.captured && write.id.range[0] <= node.range[0]) ||
          writeIsFresh(context, variable, write.id, from, fresh, memo)));
      if (kept.length === refreshes.length) continue;
      fresh.set(variable, kept);
      changed = true;
    }
    memo.clear();
    if (!changed) return fresh;
  }
}

const freshAt = (fresh, variable, at) => fresh.get(variable)?.some(({ node, block }) =>
  node.range[1] <= at.range[0] && contains(block, at)) ?? false;

function freshValue(context, node, from, fresh, memo) {
  node = unwrapped(node);
  if (node?.type === 'CallExpression' && !node.optional) {
    if (calleeName(node) === 'soon') return true;
    if (node.callee.object?.type === 'Identifier' && node.callee.object.name === 'Math' &&
      !variableOf(context, node.callee.object)?.defs.length && ['max', 'min'].includes(methodName(node))) {
      const isFresh = (arg) => freshValue(context, arg, from, fresh, memo);
      if (methodName(node) === 'min') return node.arguments.length > 0 && node.arguments.every(isFresh);
      return node.arguments.every((arg) => !Number.isNaN(fixedNumber(context, arg)) || isFresh(arg)) &&
        node.arguments.some(isFresh);
    }
  }
  if (node?.type === 'BinaryExpression' && node.operator === '+') {
    return (freshValue(context, node.left, from, fresh, memo) && fixedNumber(context, node.right) >= 0) ||
      (fixedNumber(context, node.left) >= 0 && freshValue(context, node.right, from, fresh, memo));
  }
  if (node?.type !== 'Identifier') return false;
  const variable = variableOf(context, node);
  return freshAt(fresh, variable, node) || freshConst(context, variable, from, node, fresh, memo);
}

function freshConst(context, variable, from, at, fresh, memo) {
  const def = variable?.defs[0]?.node;
  if (def?.type !== 'VariableDeclarator' || def.id.type !== 'Identifier' ||
    def.parent.kind !== 'const' || def.range[0] < from || def.range[1] > at.range[0] ||
    !contains(straightBlock(def), at)) return false;
  if (memo.has(variable)) return memo.get(variable);
  memo.set(variable, false);
  const value = freshValue(context, def.init, from, fresh, memo);
  memo.set(variable, value);
  return value;
}

function mentions(context, node, times) {
  if (!node) return false;
  if (node.type === 'Identifier') return times.has(variableOf(context, node) ?? node);
  if (node.type === 'MemberExpression' && !node.computed) return mentions(context, node.object, times);
  if (node.type === 'Property' && !node.computed) return mentions(context, node.value, times);
  return children(node).some((child) => mentions(context, child, times));
}

function loadsEcho(call, loads) {
  const name = calleeName(call);
  if (LOADS_ECHO.has(name)) return true;
  const { callee } = call;
  const own = callee.type === 'Identifier' || callee.object?.type === 'ThisExpression';
  return own && loads.has(name);
}

const logs = (call) => call.callee.object?.type === 'Identifier' && call.callee.object.name === 'console';

const scheduleBeforeEchoLoads = {
  meta: {
    messages: {
      late:
        'Loading an echo\'s response holds a slow phone for longer than soon() looks ahead, so this time has ' +
        'already played when it is set: schedule it before the echo loads.',
    },
  },
  create(context) {
    const fns = [];
    return {
      ':function'(node) {
        if (node.body) fns.push(node);
      },
      'Program:exit'() {
        const loads = new Set(LOADS_ECHO);
        for (let grew = true; grew; ) {
          grew = false;
          for (const fn of fns) {
            const name = nameOf(fn);
            if (!name || loads.has(name) || !ownCalls(fn.body).some((c) => loadsEcho(c, loads))) continue;
            loads.add(name);
            grew = true;
          }
        }
        for (const fn of fns) {
          const calls = ownCalls(fn.body).sort((a, b) => a.range[0] - b.range[0]);
          const loaded = calls.filter((c) => loadsEcho(c, loads));
          for (const c of calls) {
            const load = loaded.findLast((l) => l !== c && l.range[1] <= c.range[1]);
            if (!load || logs(c)) continue;
            const memo = new Map();
            const fresh = refreshed(context, fn, load.range[1], memo);
            const times = new Set([...soonTimes(context, fn, load.range[0])].filter((v) =>
              !freshAt(fresh, v, c) &&
              !freshConst(context, v, load.range[1], c, fresh, memo)));
            const passed = c.arguments.some((a) => mentions(context, a, times));
            const inside = mentions(context, functionOf(context, c.callee)?.body, times);
            if (passed || inside) context.report({ node: c, messageId: 'late' });
          }
        }
      },
    };
  },
};

const controlsWaitForOpening = {
  meta: {
    messages: { early: 'Queue held sound controls with voice.control before changing their parameters.' },
  },
  create(context) {
    const changesParameter = (call, seen = new Set()) => {
      const method = methodName(call);
      if (method === 'control') return false;
      if (AUDIO_TIME_ARG.has(method) && method !== 'stop' && method !== 'start') return true;
      const fn = functionOf(context, call.callee);
      if (!fn || seen.has(fn)) return false;
      seen.add(fn);
      return ownCalls(fn.body).some((next) => changesParameter(next, seen));
    };
    return {
      Property(node) {
        if (node.key.name !== 'handle' || node.value.type !== 'ObjectExpression') return;
        for (const method of node.value.properties) {
          if (!['level', 'set', 'release'].includes(method.key?.name) || !FUNCTIONS.has(method.value?.type)) continue;
          if (ownCalls(method.value.body).some((call) => changesParameter(call))) {
            context.report({ node: method, messageId: 'early' });
          }
        }
      },
    };
  },
};

function passedAsAudioTime(context, node, times) {
  if (node.type === 'CallExpression') {
    const index = AUDIO_TIME_ARG.get(calleeName(node));
    if (index !== undefined && mentions(context, node.arguments[index], times)) return true;
  }
  return children(node).some((child) => passedAsAudioTime(context, child, times));
}

function graphTimes(context, functions, calls) {
  const times = new Set();
  for (const fn of functions) {
    for (const variable of soonTimes(context, fn, Infinity)) times.add(variable);
    for (const param of fn.params) {
      const id = param.type === 'AssignmentPattern' ? param.left : param;
      if (id.type !== 'Identifier') continue;
      const variable = variableOf(context, id);
      if (passedAsAudioTime(context, fn.body, new Set([variable]))) times.add(variable);
    }
  }
  for (let grew = true; grew; ) {
    grew = false;
    for (const fn of functions) {
      for (const node of ownNodes(fn.body)) {
        const [id, value] = bindsTime(node);
        const variable = id?.type === 'Identifier' ? variableOf(context, id) : null;
        if (!variable || times.has(variable) || !(callsSoon(value) || mentions(context, value, times))) continue;
        times.add(variable);
        grew = true;
      }
    }
    for (const call of calls) {
      const fn = functionOf(context, call.callee);
      if (!fn) continue;
      call.arguments.forEach((arg, i) => {
        const param = fn.params[i];
        const id = param?.type === 'AssignmentPattern' ? param.left : param;
        if (id?.type !== 'Identifier' || !(callsSoon(arg) || mentions(context, arg, times))) return;
        const variable = variableOf(context, id);
        if (times.has(variable)) return;
        times.add(variable);
        grew = true;
      });
    }
  }
  return times;
}

function audioNode(context, node, seen = new Set()) {
  if (!node || seen.has(node)) return null;
  seen.add(node);
  if (node.type === 'Identifier') return audioNode(context, declaredAs(context, node), seen);
  if (node.type === 'CallExpression' && /^create[A-Z]/.test(methodName(node) ?? '')) return node;
  if (node.type === 'NewExpression' && /Node$/.test(calleeName(node) ?? '')) return node;
  return null;
}

function gainOpensOnTime(context, built, fn, times) {
  const isGain = (node) => isNamed(node, 'gain') && audioNode(context, node.object) === built;
  const nodes = ownNodes(fn.body);
  const writes = nodes.filter((node) => node.type === 'AssignmentExpression' && isNamed(node.left, 'value')
    && isGain(node.left.object) && node.parent.parent === fn.body);
  const initial = writes.at(-1)?.right;
  if (initial?.type !== 'Literal' || initial.value !== 0) return false;
  const scheduled = nodes.filter((node) => node.type === 'CallExpression' && isGain(node.callee.object)
    && mentions(context, node.arguments[1], times));
  const holds = scheduled.some((call) => methodName(call) === 'setValueAtTime' && call.arguments[0]?.value === 0);
  return scheduled.some((call) => call.arguments[0]?.value > 0
    && (methodName(call) === 'setValueAtTime' || (holds && methodName(call) === 'linearRampToValueAtTime')));
}

function inTimedFunction(context, fn, times) {
  for (let p = fn; p; p = p.parent) {
    if (!FUNCTIONS.has(p.type)) continue;
    if (p.params.some((param) => mentions(context, param, times))) return true;
    if (ownNodes(p.body).some((node) => {
      const [id] = bindsTime(node);
      return id && mentions(context, id, times);
    })) return true;
  }
  return false;
}

function checkGraphInputs(context, calls, times) {
  const checked = new Set();
  for (const call of calls) {
    if (methodName(call) !== 'connect') continue;
    const built = audioNode(context, call.arguments[0]);
    if (!built) continue;
    let fn = built.parent;
    while (fn && !FUNCTIONS.has(fn.type)) fn = fn.parent;
    if (!fn) continue;
    let source = call.callee.object;
    while (source.type === 'CallExpression' && methodName(source) === 'connect') source = source.arguments[0];
    const fresh = audioNode(context, source);
    if (fresh && fresh.range[0] >= fn.range[0] && fresh.range[1] <= fn.range[1]) continue;
    if (!inTimedFunction(context, fn, times) || checked.has(built)) continue;
    checked.add(built);
    if (!gainOpensOnTime(context, built, fn, times)) context.report({ node: call, messageId: 'input' });
  }
}

const graphSwapsWaitForTheirTime = {
  meta: {
    messages: {
      early: 'Disconnect replaced audio graphs in a timed onended handler so scheduling ahead preserves their sound.',
      input: 'Hold a replacement graph\'s input at zero, then schedule it to open at its audio time.',
    },
  },
  create(context) {
    const functions = [];
    const calls = [];
    return {
      ':function'(node) {
        if (node.body) functions.push(node);
      },
      'Program:exit'() {
        const times = graphTimes(context, functions, calls);
        checkGraphInputs(context, calls, times);
        for (const node of calls) {
          if (!['dropEcho', 'disconnect'].includes(calleeName(node))) continue;
          let fn = node.parent;
          while (fn && !FUNCTIONS.has(fn.type)) fn = fn.parent;
          let handler = false;
          for (let p = fn; p; p = p.parent) {
            const assigned = p.parent?.type === 'AssignmentExpression' && isNamed(p.parent.left, 'onended');
            if (FUNCTIONS.has(p.type) && assigned) handler = true;
          }
          if (fn && !handler && inTimedFunction(context, fn, times)) context.report({ node, messageId: 'early' });
        }
      },
      CallExpression(node) {
        calls.push(node);
      },
    };
  },
};

function fieldValue(node) {
  if (node.type !== 'MemberExpression' || node.computed || node.object.type !== 'ThisExpression') return null;
  let body = node.parent;
  while (body && body.type !== 'ClassBody') body = body.parent;
  const field = body?.body.find((p) => p.type === 'PropertyDefinition' && p.key.name === node.property.name);
  const ctor = body?.body.find((p) => p.kind === 'constructor');
  const assigned = ctor && ownNodes(ctor.value.body).find((p) => p.type === 'AssignmentExpression'
    && p.left.type === 'MemberExpression' && p.left.object.type === 'ThisExpression'
    && !p.left.computed && p.left.property.name === node.property.name)?.right;
  return assigned ?? field?.value;
}

function readsContextKind(context, node, seen = new Set()) {
  if (!node || seen.has(node)) return false;
  seen.add(node);
  if (node.type === 'Identifier') {
    if (['AudioContext', 'OfflineAudioContext'].includes(node.name)) return true;
    return readsContextKind(context, declaredAs(context, node), seen);
  }
  if (node.type === 'MemberExpression' && !node.computed) {
    if (['AudioContext', 'OfflineAudioContext'].includes(node.property.name)) return true;
    return readsContextKind(context, fieldValue(node), seen);
  }
  return children(node).some((child) => readsContextKind(context, child, seen));
}

const cueTrackingIncludesOffline = {
  meta: {
    messages: { missing: 'Track sounding cues in every audio context so quiet and stopAll can stop them.' },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (methodName(node) !== 'add') return;
        const cue = node.arguments[0];
        const built = cue?.type === 'Identifier' ? declaredAs(context, cue) : cue;
        if (built?.type !== 'NewExpression' || built.callee.type !== 'Identifier') return;
        const imported = variableOf(context, built.callee)?.defs[0]?.node;
        if (imported?.type !== 'ImportSpecifier' || imported.imported.name !== 'Voice') return;
        for (let p = node.parent; p && !FUNCTIONS.has(p.type); p = p.parent) {
          const test = ['IfStatement', 'ConditionalExpression'].includes(p.type) ? p.test
            : p.type === 'LogicalExpression' && p.right.range[0] <= node.range[0] ? p.left : null;
          if (test && readsContextKind(context, test)) {
            context.report({ node, messageId: 'missing' });
            return;
          }
        }
      },
    };
  },
};

const cueCleanupSharesOneClock = {
  meta: {
    messages: { perCue: 'Use the shared cue cleanup clock instead of creating a clock for each played voice.' },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (methodName(node) !== 'createConstantSource') return;
        let fn = node.parent;
        while (fn && !FUNCTIONS.has(fn.type)) fn = fn.parent;
        if (!fn) return;
        const cue = ownNodes(fn.body).some((n) => {
          if (n.type !== 'NewExpression' || n.callee.type !== 'Identifier') return false;
          const imported = variableOf(context, n.callee)?.defs[0]?.node;
          return imported?.type === 'ImportSpecifier' && imported.imported.name === 'Voice';
        });
        if (cue) context.report({ node, messageId: 'perCue' });
      },
    };
  },
};

function readsParamValue(context, node, seen = new Set()) {
  if (!node || seen.has(node) || FUNCTIONS.has(node.type)) return false;
  seen.add(node);
  if (isNamed(node, 'value') && audioParam(context, node.object)) return true;
  if (node.type === 'Identifier') return readsParamValue(context, declaredAs(context, node), seen);
  return children(node).some((child) => readsParamValue(context, child, seen));
}

function paramPath(context, node, seen = new Set()) {
  if (!node || seen.has(node)) return null;
  seen.add(node);
  if (node.type === 'Identifier') {
    return paramPath(context, declaredAs(context, node), seen) ?? [variableOf(context, node) ?? node.name];
  }
  if (node.type === 'ThisExpression') {
    let scope = context.sourceCode.getScope(node);
    while (scope.upper && scope.type !== 'class') scope = scope.upper;
    return [scope];
  }
  if (memberName(node)) {
    const parent = paramPath(context, node.object, seen);
    return parent && [...parent, memberName(node)];
  }
  if (node.type === 'CallExpression' && AUDIO_TIME_ARG.has(methodName(node))) {
    return paramPath(context, node.callee.object, seen);
  }
  return null;
}

const holdReadsTheScheduledCurve = {
  meta: {
    messages: {
      curve: 'Hold and copy the scheduled curve at the change time: the value getter is an earlier rendered value.',
      write: 'Give trackParam its initial value and schedule later changes through the curve.',
      schedule: 'Schedule and cancel tracked parameters through their curve.',
    },
  },
  create(context) {
    const tracked = [];
    const writes = [];
    return {
      MemberExpression(node) {
        if (isNamed(node, 'cancelAndHoldAtTime')) context.report({ node, messageId: 'curve' });
      },
      CallExpression(node) {
        if (calleeName(node) === 'trackParam') {
          const param = paramPath(context, node.arguments[0]);
          if (param) tracked.push(param);
        }
        if (calleeName(node) === 'trackedGain') {
          const owner = node.parent.type === 'VariableDeclarator' ? node.parent.id
            : node.parent.type === 'AssignmentExpression' ? node.parent.left : null;
          const gain = paramPath(context, owner);
          if (gain) tracked.push([...gain, 'gain']);
        }
        if (!AUDIO_TIME_ARG.has(methodName(node))) return;
        if (!['start', 'stop', 'cancelAndHoldAtTime'].includes(methodName(node))) {
          const param = paramPath(context, node.callee.object);
          if (param) writes.push({ node, param, messageId: 'schedule' });
        }
        for (const arg of node.arguments) {
          if (readsParamValue(context, arg)) context.report({ node: arg, messageId: 'curve' });
        }
      },
      AssignmentExpression(node) {
        if (!isNamed(node.left, 'value')) return;
        if (audioParam(context, node.left.object) && readsParamValue(context, node.right)) {
          context.report({ node, messageId: 'curve' });
        } else {
          const param = paramPath(context, node.left.object);
          if (param) writes.push({ node, param });
        }
      },
      'Program:exit'() {
        for (const { node, param, messageId = 'write' } of writes) {
          if (tracked.some((path) => path.length === param.length && path.every((part, i) => part === param[i]))) {
            context.report({ node, messageId });
          }
        }
      },
    };
  },
};

function clampedTime(context, node, receiver) {
  if (node?.type === 'Identifier') return clampedTime(context, declaredAs(context, node), receiver);
  return node?.type === 'CallExpression' && methodName(node) === 'clampTime'
    && context.sourceCode.getText(node.callee.object) === receiver;
}

const heldTimesAreClamped = {
  meta: {
    messages: { past: 'Clamp the hold or cancel time before reading or changing the scheduled curve.' },
  },
  create(context) {
    return {
      ':function'(fn) {
        if (!fn.body) return;
        const calls = ownCalls(fn.body);
        const cancels = calls.filter((call) => methodName(call) === 'cancelScheduledValues');
        const receiverOf = (call) => context.sourceCode.getText(call.callee.object);
        const reads = calls.filter((call) => ['valueAt', 'rampValueAt'].includes(methodName(call))
          && cancels.some((cancel) => receiverOf(cancel) === receiverOf(call)));
        const wrapper = fn.parent?.type === 'MethodDefinition' && nameOf(fn) === 'cancelScheduledValues';
        for (const call of [...reads, ...cancels]) {
          if (!wrapper && !reads.some((read) => receiverOf(read) === receiverOf(call))) continue;
          const receiver = wrapper ? 'this' : receiverOf(call);
          if (!clampedTime(context, call.arguments[0], receiver)) context.report({ node: call, messageId: 'past' });
        }
      },
    };
  },
};

function sampleBuffer(context, node, seen = new Set()) {
  if (!node || seen.has(node)) return null;
  seen.add(node);
  if (node.type === 'Identifier') return sampleBuffer(context, declaredAs(context, node), seen);
  if (node.type === 'MemberExpression' && node.computed) return sampleBuffer(context, node.object, seen);
  return node.type === 'CallExpression' && methodName(node) === 'getChannelData'
    ? paramPath(context, node.callee.object) : null;
}

const noCrossRenderPeakEquality = {
  meta: {
    messages: {
      samples: 'Compare scheduled calls for exact timing: separate audio renders have floating point noise.',
    },
  },
  create(context) {
    return {
      BinaryExpression(node) {
        if (node.operator !== '-' || methodName(node.parent) !== 'abs'
          || methodName(node.parent.parent) !== 'max') return;
        const a = sampleBuffer(context, node.left);
        const b = sampleBuffer(context, node.right);
        if (a && b && (a.length !== b.length || a.some((part, i) => part !== b[i]))) {
          context.report({ node, messageId: 'samples' });
        }
      },
    };
  },
};

export default {
  meta: { name: 'lantern' },
  rules: {
    'audio-times-from-soon': audioTimesFromSoon,
    'controls-wait-for-opening': controlsWaitForOpening,
    'late-opens-build-again': lateOpensBuildAgain,
    'no-cross-render-peak-equality': noCrossRenderPeakEquality,
    'hold-reads-the-scheduled-curve': holdReadsTheScheduledCurve,
    'held-times-are-clamped': heldTimesAreClamped,
    'animations-share-start-time': animationsShareStartTime,
    'follow-device-preferences': followDevicePreferences,
    'no-soft-hyphen-characters': noSoftHyphenCharacters,
    'stored-writes-go-through-cleared': storedWritesGoThroughCleared,
    'tap-elements-not-points': tapElementsNotPoints,
    'clock-calls-go-through-clock-module': clockCallsGoThroughClockModule,
    'handle-lost-gpu-context': handleLostGpuContext,
    'schedule-before-echo-loads': scheduleBeforeEchoLoads,
    'graph-swaps-wait-for-their-time': graphSwapsWaitForTheirTime,
    'cue-tracking-includes-offline': cueTrackingIncludesOffline,
    'cue-cleanup-shares-one-clock': cueCleanupSharesOneClock,
    ...busRules,
    ...prebuildRules,
  },
};
