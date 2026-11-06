const AUDIO_TIME_ARG = new Map([
  ['setValueAtTime', 1],
  ['setTargetAtTime', 1],
  ['linearRampToValueAtTime', 1],
  ['exponentialRampToValueAtTime', 1],
  ['setValueCurveAtTime', 1],
  ['cancelScheduledValues', 0],
  ['cancelAndHoldAtTime', 0],
  ['start', 0],
  ['stop', 0],
]);

const SKIPPED_KEYS = new Set(['parent', 'loc', 'range']);
const FUNCTIONS = new Set(['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration']);

const isNamed = (node, name) =>
  node?.type === 'MemberExpression' && !node.computed && node.property.name === name;

const methodName = (call) =>
  call.callee.type === 'MemberExpression' && !call.callee.computed ? call.callee.property.name : null;

const isGlobal = (node, name) => node?.type === 'Identifier' ? node.name === name : isNamed(node, name);

const isNode = (value) => typeof value?.type === 'string';

function children(node) {
  return Object.entries(node)
    .filter(([key, value]) => !SKIPPED_KEYS.has(key) && value && typeof value === 'object')
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]).filter(isNode));
}

function variableOf(context, id) {
  for (let scope = context.sourceCode.getScope(id); scope; scope = scope.upper) {
    const variable = scope.set.get(id.name);
    if (variable) return variable;
  }
  return null;
}

function declaratorOf(context, id) {
  const def = variableOf(context, id)?.defs[0]?.node;
  return def?.type === 'VariableDeclarator' && def.id.type === 'Identifier' ? def : null;
}

const declaredAs = (context, id) => declaratorOf(context, id)?.init ?? null;

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
        if (time && readsAudioClock(context, time)) context.report({ node: time, messageId: 'clock' });
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

const LOADS_ECHO = new Set(['createConvolver', 'makeIR']);

const calleeName = (call) => methodName(call) ?? (call.callee.type === 'Identifier' ? call.callee.name : null);

function nameOf(fn) {
  const p = fn.parent;
  if (fn.type === 'FunctionDeclaration') return fn.id?.name ?? null;
  if (p?.type === 'MethodDefinition' || p?.type === 'Property') return p.computed ? null : p.key.name;
  if (p?.type === 'VariableDeclarator' && p.id.type === 'Identifier') return p.id.name;
  return null;
}

function ownCalls(node, calls = []) {
  if (node.type === 'CallExpression') calls.push(node);
  for (const child of children(node)) if (!FUNCTIONS.has(child.type)) ownCalls(child, calls);
  return calls;
}

const callsSoon = (node) => !!node && (
  (node.type === 'CallExpression' && calleeName(node) === 'soon') || children(node).some(callsSoon));

function soonTimes(fn, before) {
  const names = new Set();
  for (const p of fn.params) {
    const timed = p.type === 'AssignmentPattern' && (callsSoon(p.right) || mentions(p.right, names));
    if (timed && p.left.type === 'Identifier') names.add(p.left.name);
  }
  const visit = (node) => {
    for (const child of children(node)) {
      if (FUNCTIONS.has(child.type)) continue;
      const early = child.range[1] <= before;
      const declared = early && child.type === 'VariableDeclarator' && child.id.type === 'Identifier';
      if (declared && (callsSoon(child.init) || mentions(child.init, names))) {
        names.add(child.id.name);
      }
      visit(child);
    }
  };
  visit(fn.body);
  return names;
}

const mentions = (node, names) => !!node && (
  (node.type === 'Identifier' && names.has(node.name)) || children(node).some((child) => mentions(child, names)));

function localFunction(context, callee) {
  if (callee.type !== 'Identifier') return null;
  const def = variableOf(context, callee)?.defs[0]?.node;
  const fn = def?.type === 'VariableDeclarator' ? def.init : def;
  return FUNCTIONS.has(fn?.type) ? fn : null;
}

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
            if (!name || loads.has(name) || !ownCalls(fn.body).some((c) => loads.has(calleeName(c)))) continue;
            loads.add(name);
            grew = true;
          }
        }
        for (const fn of fns) {
          const calls = ownCalls(fn.body).sort((a, b) => a.range[0] - b.range[0]);
          const loaded = calls.filter((c) => loads.has(calleeName(c)));
          for (const c of calls) {
            const load = loaded.findLast((l) => l.range[1] <= c.range[0]);
            if (!load) continue;
            const times = soonTimes(fn, load.range[0]);
            const passed = c.arguments.some((a) => mentions(a, times));
            const inside = mentions(localFunction(context, c.callee), times);
            if (passed || inside) context.report({ node: c, messageId: 'late' });
          }
        }
      },
    };
  },
};

export default {
  meta: { name: 'lantern' },
  rules: {
    'audio-times-from-soon': audioTimesFromSoon,
    'animations-share-start-time': animationsShareStartTime,
    'follow-device-preferences': followDevicePreferences,
    'no-soft-hyphen-characters': noSoftHyphenCharacters,
    'stored-writes-go-through-cleared': storedWritesGoThroughCleared,
    'tap-elements-not-points': tapElementsNotPoints,
    'handle-lost-gpu-context': handleLostGpuContext,
    'schedule-before-echo-loads': scheduleBeforeEchoLoads,
  },
};
