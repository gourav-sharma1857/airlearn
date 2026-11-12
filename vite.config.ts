import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

// Use the same Content-Security-Policy in `vite preview` as in production,
// so CSP problems show up locally.
const csp = /Content-Security-Policy: (.+)/.exec(readFileSync(resolve(root, 'public/_headers'), 'utf8'))?.[1] ?? '';

// ---- Branding -------------------------------------------------------------
// The product name, tagline and logo live in ONE file: brand.config.json.
// This plugin writes them into every HTML page at build time (no flicker),
// and the TypeScript code imports the same JSON file.
const brandFile = resolve(root, 'brand.config.json');
const escapeHtml = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function brandPlugin(): Plugin {
  return {
    name: 'brand',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const brand = JSON.parse(readFileSync(brandFile, 'utf8'));
        return html
          .replace(/%BRAND_NAME%/g, escapeHtml(brand.name))
          .replace(/%BRAND_TAGLINE%/g, escapeHtml(brand.tagline))
          .replace(/%BRAND_LOGO%/g, escapeHtml(brand.logo));
      },
    },
    configureServer(server) {
      // Editing brand.config.json reloads the open page in `npm run dev`.
      server.watcher.add(brandFile);
      server.watcher.on('change', (file) => {
        if (file === brandFile) server.ws.send({ type: 'full-reload' });
      });
    },
  };
}

export default defineConfig({
  plugins: [brandPlugin()],
  preview: { headers: { 'Content-Security-Policy': csp } },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        home: resolve(root, 'index.html'),
        lesson: resolve(root, 'lesson.html'),
        teachers: resolve(root, 'teachers.html'),
        privacy: resolve(root, 'privacy.html'),
      },
    },
  },
});
