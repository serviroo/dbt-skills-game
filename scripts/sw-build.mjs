// Writes <outDir>/sw.js: the service worker template plus the hashed asset list and a content version.
// Used by the Vite plugin after every build; also runnable by hand: node scripts/sw-build.mjs dist
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.resolve(here, '../src/pwa/sw-template.js');

// Not precached: the SW itself, host config, the shell (cached as ./), and iOS splash screens (read by iOS at install, never by the page).
const SKIP = [/^sw\.js$/, /^index\.html$/, /^_headers$/, /^_redirects$/, /^_routes\.json$/, /^functions\//, /^robots\.txt$/, /^splash\//, /(^|\/)\./, /\.map$/];

function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p, base) : [path.relative(base, p).split(path.sep).join('/')];
  });
}

export function writeServiceWorker(outDir) {
  const files = walk(outDir).filter((f) => !SKIP.some((re) => re.test(f))).sort();
  const h = crypto.createHash('sha256');
  // the shell is part of the version too, so an index.html-only change still ships
  for (const f of [...files, 'index.html']) {
    const full = path.join(outDir, f);
    if (!fs.existsSync(full)) throw new Error(`sw-build: missing ${f} in ${outDir}`);
    h.update(f + '\0' + crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex') + '\n');
  }
  h.update(fs.readFileSync(TEMPLATE));
  const version = h.digest('hex').slice(0, 12);
  const assets = files.map((f) => './' + f);
  const bytes = files.reduce((n, f) => n + fs.statSync(path.join(outDir, f)).size, 0);
  const src = `const VERSION = ${JSON.stringify(version)};\nconst ASSETS = ${JSON.stringify(assets, null, 0)};\n` + fs.readFileSync(TEMPLATE, 'utf8');
  fs.writeFileSync(path.join(outDir, 'sw.js'), src);
  return { version, count: assets.length + 1, bytes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.argv[2] ?? 'dist');
  const r = writeServiceWorker(dir);
  console.log(`sw.js: version ${r.version}, ${r.count} files, ${(r.bytes / 1024).toFixed(0)} KB precached`);
}
