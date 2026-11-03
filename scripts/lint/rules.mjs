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

function declaredAs(context, id) {
  for (let scope = context.sourceCode.getScope(id); scope; scope = scope.upper) {
    const variable = scope.set.get(id.name);
    if (!variable) continue;
    const def = variable.defs[0]?.node;
    return def?.type === 'VariableDeclarator' && def.id.type === 'Identifier' ? def.init : null;
  }
  return null;
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

const SOFT_HYPHEN = '­';

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

const POINTER_METHODS = new Set(['click', 'dblclick', 'down', 'tap']);

const isFixedNumber = (node) =>
  (node?.type === 'Literal' && typeof node.value === 'number') ||
  (node?.type === 'UnaryExpression' && node.operator === '-' && isFixedNumber(node.argument));

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
        if (node.arguments.slice(0, 2).some(isFixedNumber)) context.report({ node, messageId: 'point' });
      },
    };
  },
};

const handleLostGpuContext = {
  meta: {
    messages: {
      lost:
        'Handle a lost graphics context (webglcontextlost or isContextLost) where the renderer is made, or the ' +
        'scene keeps drawing into a dead canvas.',
    },
  },
  create(context) {
    const renderers = [];
    let handled = false;
    return {
      NewExpression(node) {
        if (isGlobal(node.callee, 'WebGLRenderer')) renderers.push(node);
      },
      Literal(node) {
        if (node.value === 'webglcontextlost') handled = true;
      },
      MemberExpression(node) {
        if (isNamed(node, 'isContextLost')) handled = true;
      },
      'Program:exit'() {
        if (!handled) for (const node of renderers) context.report({ node, messageId: 'lost' });
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
  },
};
