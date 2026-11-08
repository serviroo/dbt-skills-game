export const AUDIO_TIME_ARG = new Map([
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

export function memberName(node) {
  if (node?.type !== 'MemberExpression') return null;
  if (!node.computed) return node.property.name;
  return typeof node.property.value === 'string' ? node.property.value : null;
}

export const isNamed = (node, name) => memberName(node) === name;

export const methodName = (call) => memberName(call.callee);

export function variableOf(context, id) {
  for (let scope = context.sourceCode.getScope(id); scope; scope = scope.upper) {
    const variable = scope.set.get(id.name);
    if (variable) return variable;
  }
  return null;
}

export function declaratorOf(context, id) {
  const def = variableOf(context, id)?.defs[0]?.node;
  return def?.type === 'VariableDeclarator' && def.id.type === 'Identifier' ? def : null;
}

export const declaredAs = (context, id) => declaratorOf(context, id)?.init ?? null;

export const calleeName = (call) => methodName(call) ?? (call.callee.type === 'Identifier' ? call.callee.name : null);

const PARAM_NAMES = new Set([
  'gain', 'frequency', 'detune', 'offset', 'pan', 'Q', 'delayTime', 'playbackRate',
  'threshold', 'knee', 'ratio', 'attack', 'release',
]);

export function audioParam(context, node, seen = new Set()) {
  if (!node || seen.has(node)) return false;
  seen.add(node);
  if (node.type === 'MemberExpression' && !node.computed) return PARAM_NAMES.has(node.property.name);
  if (node.type !== 'Identifier') return false;
  const variable = variableOf(context, node);
  const typed = variable?.defs.some((def) => def.name?.typeAnnotation?.typeAnnotation?.typeName?.name === 'AudioParam');
  return typed || audioParam(context, declaredAs(context, node), seen);
}
