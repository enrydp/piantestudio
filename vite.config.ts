import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Plugin Vite leggero per servire (in dev) e copiare (in build) il file WebAssembly
 * di @mlightcad/libredwg-web senza committare il binario .wasm in git.
 */
function libreDwgWasmPlugin(): Plugin {
  const wasmSrc = path.resolve(
    rootDir,
    'node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.wasm'
  );

  return {
    name: 'libredwg-wasm-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.split('?')[0].endsWith('/wasm/libredwg-web.wasm')) {
          if (fs.existsSync(wasmSrc)) {
            res.setHeader('Content-Type', 'application/wasm');
            fs.createReadStream(wasmSrc).pipe(res);
            return;
          }
        }
        next();
      });
    },
    writeBundle(options) {
      const outDir = options.dir || path.resolve(rootDir, 'dist');
      const targetDir = path.join(outDir, 'wasm');
      if (fs.existsSync(wasmSrc)) {
        fs.mkdirSync(targetDir, { recursive: true });
        fs.copyFileSync(wasmSrc, path.join(targetDir, 'libredwg-web.wasm'));
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), libreDwgWasmPlugin()],
  optimizeDeps: {
    exclude: ['pdfjs-dist', '@mlightcad/libredwg-web'],
  },
});
