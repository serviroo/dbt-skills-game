import path from 'node:path';
import { clikePieces, codeTextPieces, shifted, textTemplatePieces } from './pieces.mjs';
import { oxlintScan } from './scan-js.mjs';

const BY_EXTENSION = new Map(['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts'].map((ext) => [ext, 'js']));

export const languageOf = (file) => BY_EXTENSION.get(path.extname(file).slice(1).toLowerCase()) ?? null;

export function scanner(scratch) {
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
    js: (text) => {
      const { pieces, error } = jsFamily([{ id: 'embedded', text, ext: '.js' }]).get('embedded');
      return error ? textTemplatePieces(text) : pieces;
    },
  };

  function embed(lang, text, at) {
    return shifted((readers[lang] ?? textTemplatePieces)(text), at);
  }

  return function scan(files) {
    const items = files.map((f) => ({ id: f.id, text: f.text, ext: path.extname(f.path).toLowerCase() }));
    return jsFamily(items);
  };
}
