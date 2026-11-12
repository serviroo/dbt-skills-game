import { AUDIO_TIME_ARG, audioParam, calleeName, declaratorOf, isNamed, methodName } from './ast.mjs';

const SHARED_BUSES = new Set([
  'duckG', 'yieldG', 'focus', 'uiDuck', 'hushBeds', 'hushMusic', 'hushHall', 'hushRoom', 'safe',
]);

function busAlias(context, node) {
  const declaration = declaratorOf(context, node);
  const loop = declaration?.parent?.parent;
  return declaration?.init ?? (loop?.type === 'ForOfStatement' ? loop.right : null);
}

function sharedBus(context, node, param, seen = new Set()) {
  if (!node || seen.has(node)) return false;
  const next = new Set(seen).add(node);
  if (node.type === 'Identifier') return sharedBus(context, busAlias(context, node), param, next);
  if (node.type === 'ArrayExpression') return node.elements.some((e) => sharedBus(context, e, param, next));
  if (node.type === 'ConditionalExpression') {
    return sharedBus(context, node.consequent, param, next) || sharedBus(context, node.alternate, param, next);
  }
  if (param) return ['gain', 'curve'].some((name) => isNamed(node, name))
    && sharedBus(context, node.object, false, next);
  return node.type === 'MemberExpression' && node.object.type === 'ThisExpression' &&
    SHARED_BUSES.has(node.computed ? node.property.value : node.property.name);
}

const busRisesWaitForStops = {
  meta: {
    messages: {
      rise: 'Schedule shared bus levels through busLevels.set, so a rise waits until stopped sounds are silent.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const object = node.callee.type === 'MemberExpression' ? node.callee.object : null;
        const helper = isNamed(object, 'busLevels') && object.object.type === 'ThisExpression';
        if (helper && methodName(node) === 'set') return;
        if (helper && methodName(node) === 'ramp' && node.arguments[1]?.value === 0) return;
        const moment = object?.type === 'Identifier' ? declaratorOf(context, object)?.init : null;
        const callback = node.arguments[1];
        const key = node.arguments[2];
        const call = callback?.type === 'ArrowFunctionExpression' ? callback.body : null;
        const bus = call?.callee?.type === 'MemberExpression' ? call.callee.object : null;
        const queued = methodName(node) === 'add' && moment?.type === 'NewExpression'
          && calleeName(moment) === 'Moment' && call?.type === 'CallExpression' && methodName(call) === 'set'
          && isNamed(bus, 'busLevels') && bus.object.type === 'ThisExpression'
          && key?.type === 'Identifier' && call.arguments[0]?.type === 'Identifier'
          && key.name === call.arguments[0].name;
        const writes = AUDIO_TIME_ARG.has(methodName(node)) && sharedBus(context, object, true);
        const passes = node.arguments.some((a, i) => !(queued && i === 2) && sharedBus(context, a, true));
        if (writes || passes) context.report({ node, messageId: 'rise' });
      },
    };
  },
};

const busLevelsUseTrackedCurves = {
  meta: { messages: { curve: 'Create shared buses with trackedGain and pass their curves to busLevels.' } },
  create(context) {
    return {
      AssignmentExpression(node) {
        const made = node.right.type === 'CallExpression' && calleeName(node.right) === 'trackedGain';
        if (sharedBus(context, node.left, false) && !made) {
          context.report({ node, messageId: 'curve' });
        }
      },
      CallExpression(node) {
        const object = node.callee.type === 'MemberExpression' ? node.callee.object : null;
        if (!isNamed(object, 'busLevels') || !['set', 'ramp'].includes(methodName(node))) return;
        if (audioParam(context, node.arguments[0])) context.report({ node, messageId: 'curve' });
      },
    };
  },
};

export const busRules = {
  'bus-rises-wait-for-stops': busRisesWaitForStops,
  'bus-levels-use-tracked-curves': busLevelsUseTrackedCurves,
};
