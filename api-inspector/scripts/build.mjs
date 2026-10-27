// Builds the extension into dist/.
// Pages (popup, rules, panel, devtools, pause) are one Vite build with React.
// Scripts (inject, content, background) are built one by one as single IIFE files,
// because content scripts can't use imports.
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const outDir = resolve(root, 'dist');
const watch = process.argv.includes('--watch') ? {} : null;

await build({
  root,
  configFile: false,
  logLevel: 'warn',
  plugins: [react(), tailwindcss()],
  build: {
    outDir,
    emptyOutDir: true,
    watch,
    rolldownOptions: {
      input: Object.fromEntries(
        ['popup', 'rules', 'panel', 'devtools', 'pause'].map((n) => [n, resolve(root, `${n}.html`)]),
      ),
    },
  },
});

for (const name of ['inject', 'content', 'background']) {
  await build({
    root,
    configFile: false,
    logLevel: 'warn',
    publicDir: false,
    define: { 'process.env.NODE_ENV': '"production"' },
    build: {
      outDir,
      emptyOutDir: false,
      watch,
      minify: false,
      lib: {
        entry: resolve(root, `src/${name}/index.js`),
        formats: ['iife'],
        name: `apiInspector_${name}`,
        fileName: () => `${name}.js`,
      },
    },
  });
}

console.log('Built to', outDir);
