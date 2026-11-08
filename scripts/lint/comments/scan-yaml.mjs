import yaml from 'js-yaml';

const NOT_BASH = /^(pwsh|powershell|python|cmd|node)/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function differences(a, b, key = null, parent = null, found = []) {
  if (JSON.stringify(a) === JSON.stringify(b)) return found;
  const sameKeys = isObject(a) && isObject(b) && Object.keys(a).join('\n') === Object.keys(b).join('\n');
  const sameLength = Array.isArray(a) && Array.isArray(b) && a.length === b.length;
  if (sameKeys) for (const k of Object.keys(a)) differences(a[k], b[k], k, a, found);
  else if (sameLength) a.forEach((item, i) => differences(item, b[i], i, parent, found));
  else found.push({ key, parent, a, b });
  return found;
}

function onlyShellChanged(before, after, shell) {
  const changed = differences(before, after);
  return (
    changed.length > 0 &&
    changed.every(
      ({ key, parent, a, b }) =>
        key === 'run' &&
        typeof a === 'string' &&
        typeof b === 'string' &&
        !NOT_BASH.test(String(parent?.shell ?? '')) &&
        shell.sameMeaning(a, b),
    )
  );
}

function load(text) {
  try {
    return { value: yaml.loadAll(text) };
  } catch (error) {
    return { error: error.reason ?? error.message };
  }
}

const BLOCK_KEY = /^([ \t]*(- +)?)(run|script):[ \t]*[|>][-+0-9]*[ \t]*(#.*)?$/;

export function blockScalars(text) {
  const lines = text.split('\n');
  const blocks = [];
  for (const [i, line] of lines.entries()) {
    const match = BLOCK_KEY.exec(line);
    if (!match) continue;
    let end = i + 1;
    while (end < lines.length && (!lines[end].trim() || /^[ \t]*/.exec(lines[end])[0].length > match[1].length)) end++;
    const body = lines.slice(i + 1, end);
    const indent = Math.min(...body.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)[0].length));
    const text = body.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join('\n');
    blocks.push({ key: match[3], line: i + 2, text });
  }
  return blocks;
}

export function yamlPieces(text, wanted, shell) {
  const before = load(text);
  if (before.error) return { pieces: [], error: before.error };
  const lines = text.split('\n');
  const pieces = [];
  for (const n of wanted) {
    const line = lines[n - 1] ?? '';
    for (let at = line.indexOf('#'); at >= 0; at = line.indexOf('#', at + 1)) {
      if (at > 0 && !/[ \t]/.test(line[at - 1])) continue;
      const after = load(lines.with(n - 1, line.slice(0, at).trimEnd()).join('\n'));
      if (after.error) continue;
      const same = JSON.stringify(after.value) === JSON.stringify(before.value);
      if (!same && !onlyShellChanged(before.value, after.value, shell)) continue;
      pieces.push({ line: n, text: line.slice(at), kind: 'c' });
      break;
    }
  }
  return { pieces, error: null };
}
