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

function memberName(node) {
  if (node?.type !== 'MemberExpression') return null;
  if (!node.computed) return node.property.name;
  return typeof node.property.value === 'string' ? node.property.value : null;
}

const isNamed = (node, name) => memberName(node) === name;

const methodName = (call) => memberName(call.callee);

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

const LOADS_ECHO = new Set(['createConvolver', 'makeIR', 'ConvolverNode']);

const calleeName = (call) => methodName(call) ?? (call.callee.type === 'Identifier' ? call.callee.name : null);

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
    if (id && (callsSoon(value) ? node.range[1] <= before : mentions(context, value, times))) add(id);
  }
  return times;
}

function refreshed(context, fn, from, to) {
  const fresh = new Set();
  for (const node of ownNodes(fn.body)) {
    const [id, value] = bindsTime(node);
    const inside = node.range[0] >= from && node.range[1] <= to;
    if (inside && id?.type === 'Identifier' && callsSoon(value)) fresh.add(variableOf(context, id));
  }
  return fresh;
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
            const fresh = refreshed(context, fn, load.range[1], c.range[0]);
            const times = new Set([...soonTimes(context, fn, load.range[0])].filter((v) => !fresh.has(v)));
            const passed = c.arguments.some((a) => mentions(context, a, times));
            const inside = mentions(context, functionOf(context, c.callee)?.body, times);
            if (passed || inside) context.report({ node: c, messageId: 'late' });
          }
        }
      },
    };
  },
};

const PARAM_NAMES = new Set([
  'gain', 'frequency', 'detune', 'offset', 'pan', 'Q', 'delayTime', 'playbackRate',
  'threshold', 'knee', 'ratio', 'attack', 'release',
]);

function audioParam(context, node, seen = new Set()) {
  if (!node || seen.has(node)) return false;
  seen.add(node);
  if (node.type === 'MemberExpression' && !node.computed) return PARAM_NAMES.has(node.property.name);
  if (node.type !== 'Identifier') return false;
  const variable = variableOf(context, node);
  const typed = variable?.defs.some((def) => def.name?.typeAnnotation?.typeAnnotation?.typeName?.name === 'AudioParam');
  return typed || audioParam(context, declaredAs(context, node), seen);
}

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

const trackedEventsAreValidated = {
  meta: {
    messages: { unchecked: 'Validate tracked event order before changing the audio parameter.' },
  },
  create(context) {
    return {
      ':function'(fn) {
        if (!fn.body || fn.parent?.type !== 'MethodDefinition') return;
        const calls = ownCalls(fn.body);
        const onThis = (call, name) => methodName(call) === name && call.callee.object.type === 'ThisExpression';
        if (!calls.some((call) => onThis(call, 'record'))) return;
        const guard = calls.find((call) => onThis(call, 'checkEvent'));
        for (const call of calls) {
          if (!['setValueAtTime', 'linearRampToValueAtTime', 'setTargetAtTime'].includes(methodName(call))) continue;
          const receiver = call.callee.object;
          if (!isNamed(receiver, 'param') || receiver.object.type !== 'ThisExpression') continue;
          if (!guard || guard.range[1] > call.range[0]) context.report({ node: call, messageId: 'unchecked' });
        }
      },
    };
  },
};

export default {
  meta: { name: 'lantern' },
  rules: {
    'audio-times-from-soon': audioTimesFromSoon,
    'hold-reads-the-scheduled-curve': holdReadsTheScheduledCurve,
    'held-times-are-clamped': heldTimesAreClamped,
    'tracked-events-are-validated': trackedEventsAreValidated,
    'animations-share-start-time': animationsShareStartTime,
    'follow-device-preferences': followDevicePreferences,
    'no-soft-hyphen-characters': noSoftHyphenCharacters,
    'stored-writes-go-through-cleared': storedWritesGoThroughCleared,
    'tap-elements-not-points': tapElementsNotPoints,
    'handle-lost-gpu-context': handleLostGpuContext,
    'schedule-before-echo-loads': scheduleBeforeEchoLoads,
  },
};
