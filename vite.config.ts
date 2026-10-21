import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeServiceWorker } from './scripts/sw-build.mjs';
import { CSP, ICONS, headersFile, splashImages, splashLinkTags } from './scripts/pwa-spec.mjs';

/** PWA build step: icons drawn in code, iOS splash links, CSP, host headers, and the precaching service worker. */
function pwa(): Plugin {
  let outDir = 'dist';
  let root = process.cwd();
  let build = false;
  return {
    name: 'lantern-pwa',
    configResolved(c) {
      root = c.root;
      build = c.command === 'build';
      outDir = path.resolve(c.root, c.build.outDir);
    },
    buildStart() {
      if (!build) return;
      const script = path.join(root, 'scripts/icons.mjs');
      const outputs = [...ICONS.map((i) => i.file), ...splashImages().map((s) => s.file)].map((f) => path.join(root, 'public', f));
      const stamp = fs.statSync(script).mtimeMs;
      const stale = outputs.some((f) => !fs.existsSync(f) || fs.statSync(f).mtimeMs < stamp);
      if (stale) {
        const r = spawnSync(process.execPath, [script, '--quiet'], { cwd: root, stdio: 'inherit' });
        if (r.status !== 0) this.error('scripts/icons.mjs failed; the PWA icons could not be drawn');
      }
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        html = html.replace('<!-- pwa:splash -->', splashLinkTags('./'));
        if (ctx.server) return html;
        return html.replace('<!-- pwa:csp -->', `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
      },
    },
    closeBundle() {
      if (!fs.existsSync(path.join(outDir, 'index.html'))) return;
      fs.writeFileSync(path.join(outDir, '_headers'), headersFile());
      const r = writeServiceWorker(outDir);
      this.info?.(`sw.js version ${r.version}: ${r.count} files, ${(r.bytes / 1024).toFixed(0)} KB precached`);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [pwa()],
  server: { host: '0.0.0.0', port: 5173, strictPort: true },
  preview: { host: '0.0.0.0', port: 4173, strictPort: true },
  build: { target: 'es2022', assetsInlineLimit: 0, sourcemap: false, chunkSizeWarningLimit: 2000 },
});
