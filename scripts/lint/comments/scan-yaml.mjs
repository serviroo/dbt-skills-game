import yaml from 'js-yaml';
import { lineOf, lineStarts } from './pieces.mjs';

const BASH = /^(bash|sh)\b/;
const SHELLS = { python: 'py', node: 'js' };

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function steps(docs) {
  const found = [];
  for (const doc of docs.filter(isObject)) {
    const jobs = isObject(doc.jobs) ? Object.values(doc.jobs) : [];
    const groups = [...jobs.map((job) => [job, job?.defaults]), [doc.runs, doc.runs?.defaults]];
    for (const [group, defaults] of groups) {
      for (const step of Array.isArray(group?.steps) ? group.steps : []) {
        const shell = String(step?.shell ?? defaults?.run?.shell ?? doc.defaults?.run?.shell ?? 'bash');
        if (typeof step?.run === 'string') found.push({ key: 'run', shell, code: step.run });
        const script = /^actions\/github-script@/.test(step?.uses ?? '') ? step?.with?.script : null;
        if (typeof script === 'string') found.push({ key: 'script', shell: 'node', code: script });
      }
    }
  }
  return found;
}

function load(text) {
  const spans = [];
  const open = [];
  let key = null;
  const listener = (type, state) => {
    if (type === 'open') return void open.push(state.position);
    const start = open.pop();
    if (typeof state.result !== 'string') return;
    spans.push({ start, end: state.position, value: state.result, key });
    key = state.result;
  };
  try {
    return { value: yaml.loadAll(text, null, { listener }), spans };
  } catch (error) {
    return { error: error.reason ?? error.message };
  }
}

function sourceLines(span, code, text, starts) {
  const head = text.slice(span.start, span.end).trimEnd();
  const lead = head.length - head.trimStart().length;
  const first = lineOf(starts, span.start + lead);
  const count = code.split('\n').length;
  if (!head.includes('\n')) return Array.from({ length: count }, () => first);
  if (head.trimStart()[0] === '|') return Array.from({ length: count }, (_, k) => first + 1 + k);
  return null;
}

function counted(texts) {
  const counts = new Map();
  for (const text of texts) counts.set(text, (counts.get(text) ?? 0) + 1);
  return counts;
}

function blame(found, index, comments, read, context) {
  const { text, lines, starts, wanted } = context;
  const blamed = [];
  const before = counted(comments);
  for (let n = lineOf(starts, found.span.start); n <= lineOf(starts, found.span.end - 1); n++) {
    if (!wanted.has(n)) continue;
    const trial = load(lines.filter((_, i) => i !== n - 1).join('\n'));
    const code = trial.value ? steps(trial.value)[index]?.code : undefined;
    if (code === undefined) continue;
    const after = counted(read(code));
    const lost = comments.find((c) => (after.get(c) ?? 0) < before.get(c));
    if (lost) blamed.push({ line: n, text: lost, group: `y${n}` });
  }
  return blamed;
}

export function yamlPieces(text, wanted, embed) {
  const before = load(text);
  if (before.error) return { pieces: [], error: before.error };
  const lines = text.split('\n');
  const starts = lineStarts(text);
  const context = { text, lines, starts, wanted: new Set(wanted) };
  const pieces = [];
  for (const n of wanted) {
    const line = lines[n - 1] ?? '';
    for (let at = line.indexOf('#'); at >= 0; at = line.indexOf('#', at + 1)) {
      if (at > 0 && !/[ \t]/.test(line[at - 1])) continue;
      const after = load(lines.with(n - 1, line.slice(0, at).trimEnd()).join('\n'));
      if (after.error || JSON.stringify(after.value) !== JSON.stringify(before.value)) continue;
      pieces.push({ line: n, text: line.slice(at), group: `l${n}` });
      break;
    }
  }
  const unused = [...before.spans];
  for (const [index, step] of steps(before.value).entries()) {
    const lang = BASH.test(step.shell) ? 'sh' : SHELLS[step.shell.split(' ')[0]];
    if (!lang) return { pieces: [], error: `a run step uses ${step.shell}, which this check can't read` };
    const at = unused.findIndex((s) => s.key === step.key && s.value === step.code);
    if (at < 0) return { pieces: [], error: `can't find where a ${step.key} step is` };
    const span = unused.splice(at, 1)[0];
    const map = sourceLines(span, step.code, text, starts);
    const read = (code) => embed(lang, code, 1).map((p) => p.text.trim());
    if (map) pieces.push(...embed(lang, step.code, map));
    else pieces.push(...blame({ span }, index, read(step.code), read, context));
  }
  return { pieces, error: null };
}
