import yaml from 'js-yaml';

const BASH = /^(bash|sh)\b/;
const SHELLS = { python: 'py', node: 'js' };

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function differences(a, b, key = null, found = []) {
  if (JSON.stringify(a) === JSON.stringify(b)) return found;
  const sameKeys = isObject(a) && isObject(b) && Object.keys(a).join('\n') === Object.keys(b).join('\n');
  const sameLength = Array.isArray(a) && Array.isArray(b) && a.length === b.length;
  if (sameKeys) for (const k of Object.keys(a)) differences(a[k], b[k], k, found);
  else if (sameLength) a.forEach((item, i) => differences(item, b[i], i, found));
  else found.push({ key, a });
  return found;
}

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

function cutComment(value, comment) {
  const at = value.indexOf(comment);
  if (at < 0) return null;
  const end = value.indexOf('\n', at);
  return value.slice(0, at) + (end < 0 ? '' : value.slice(end));
}

function inRunOnly(before, after, comment, shell, bashRuns) {
  const changed = differences(before, after);
  return (
    changed.length > 0 &&
    changed.every(({ key, a }) => {
      const cut = key === 'run' && bashRuns.has(a) ? cutComment(a, comment) : null;
      return cut !== null && shell.sameMeaning(a, cut);
    })
  );
}

function load(text) {
  try {
    return { value: yaml.loadAll(text) };
  } catch (error) {
    return { error: error.reason ?? error.message };
  }
}

function placed(pieces, lines, wanted) {
  return pieces.flatMap((piece) => {
    const said = piece.text.trim();
    const at = lines.map((line, i) => i + 1).filter((n) => said && lines[n - 1].includes(said));
    const line = at.find((n) => wanted.has(n)) ?? at[0];
    return line ? [{ ...piece, line }] : [];
  });
}

export function yamlPieces(text, wanted, shell, embed) {
  const before = load(text);
  if (before.error) return { pieces: [], error: before.error };
  const found = steps(before.value);
  const bashRuns = new Set(found.filter((s) => s.key === 'run' && BASH.test(s.shell)).map((s) => s.code));
  for (const step of found) {
    const lang = BASH.test(step.shell) ? 'sh' : SHELLS[step.shell.split(' ')[0]];
    if (!lang) return { pieces: [], error: `a run step uses ${step.shell}, which this check can't read` };
    if (lang === 'sh' && shell.declared(step.code) === null) {
      return { pieces: [], error: "bash can't parse a run step" };
    }
  }
  const lines = text.split('\n');
  const pieces = [];
  for (const n of wanted) {
    const line = lines[n - 1] ?? '';
    for (let at = line.indexOf('#'); at >= 0; at = line.indexOf('#', at + 1)) {
      if (at > 0 && !/[ \t]/.test(line[at - 1])) continue;
      const after = load(lines.with(n - 1, line.slice(0, at).trimEnd()).join('\n'));
      if (after.error) continue;
      const same = JSON.stringify(after.value) === JSON.stringify(before.value);
      if (!same && !inRunOnly(before.value, after.value, line.slice(at).trim(), shell, bashRuns)) continue;
      pieces.push({ line: n, text: line.slice(at), group: `l${n}` });
      break;
    }
  }
  for (const step of found) {
    const lang = BASH.test(step.shell) ? 'embedded-sh' : SHELLS[step.shell.split(' ')[0]];
    pieces.push(...placed(embed(lang, step.code, 1), lines, new Set(wanted)));
  }
  return { pieces, error: null };
}
