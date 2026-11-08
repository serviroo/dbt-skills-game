import path from 'node:path';
import { clikePieces, codeTextPieces, shifted, textTemplatePieces, wholeLinePieces } from './pieces.mjs';
import { oxlintScan } from './scan-js.mjs';
import { cssPieces, htmlPieces } from './scan-markup.mjs';
import { pythonPieces } from './scan-py.mjs';
import { bashParser, shellPieces } from './scan-shell.mjs';
import { yamlPieces } from './scan-yaml.mjs';

const BY_EXTENSION = new Map([
  ...['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts'].map((ext) => [ext, 'js']),
  ['css', 'css'],
  ['html', 'html'],
  ['py', 'py'],
  ['json', 'json'],
  ['sh', 'sh'],
  ['bash', 'sh'],
  ['yml', 'yaml'],
  ['yaml', 'yaml'],
]);

export function languageOf(file) {
  if (path.basename(file) === '.gitignore') return 'gitignore';
  return BY_EXTENSION.get(path.extname(file).slice(1).toLowerCase()) ?? null;
}

function readable({ pieces, error }) {
  if (error) throw new Error(error);
  return pieces;
}

function attempt(read, fallback) {
  try {
    return read();
  } catch {
    return fallback();
  }
}

export function scanner(scratch) {
  const shell = bashParser(scratch);
  const everyLine = (text) => text.split('\n').map((_, i) => i + 1);

  function jsFamily(items, depth = 0) {
    const results = oxlintScan(items, scratch);
    const nested = [];
    const out = new Map();
    for (const item of items) {
      const { pieces, templates, error } = results.get(item.id);
      out.set(item.id, { pieces, error });
      for (const t of templates) {
        const id = `${item.id}#${nested.length}`;
        if (t.lang === 'js' && depth < 3) nested.push({ id, owner: item.id, ...t, ext: '.js' });
        else pieces.push(...embed(t.lang, t.text, t.lines));
      }
    }
    const inner = nested.length ? jsFamily(nested, depth + 1) : new Map();
    for (const n of nested) {
      const { pieces, error } = inner.get(n.id);
      out.get(n.owner).pieces.push(...shifted(error ? textTemplatePieces(n.text) : pieces, n.lines));
    }
    return out;
  }

  const readers = {
    glsl: clikePieces,
    wgsl: clikePieces,
    text: codeTextPieces,
    css: (text) => attempt(() => cssPieces(text), () => textTemplatePieces(text)),
    html: (text) => htmlPieces(text, embed),
    py: (text) => readable(pythonPieces(text, scratch)),
    sh: (text) => readable(shellPieces(text, everyLine(text), shell, embed)),
    js: (text) => {
      const { pieces, error } = jsFamily([{ id: 'embedded', text, ext: '.js' }]).get('embedded');
      return error ? textTemplatePieces(text) : pieces;
    },
  };

  function embed(lang, text, at) {
    return shifted((readers[lang] ?? textTemplatePieces)(text), at);
  }

  function scanOne({ lang, text, wanted }) {
    if (lang === 'gitignore') return { pieces: wholeLinePieces(text, /^[ \t]*#/), error: null };
    if (lang === 'json') return { pieces: clikePieces(text), error: null };
    if (lang === 'html') return { pieces: htmlPieces(text, embed), error: null };
    try {
      if (lang === 'py') return pythonPieces(text, scratch);
      if (lang === 'sh') return shellPieces(text, wanted, shell, embed);
      if (lang === 'yaml') return yamlPieces(text, wanted, embed);
      return { pieces: cssPieces(text), error: null };
    } catch (error) {
      return { pieces: [], error: error.reason ?? error.message };
    }
  }

  return function scan(files) {
    const js = files.filter((f) => f.lang === 'js');
    const results = jsFamily(js.map((f) => ({ id: f.id, text: f.text, ext: path.extname(f.path).toLowerCase() })));
    for (const f of files) if (f.lang !== 'js') results.set(f.id, scanOne(f));
    return results;
  };
}
