const esbuild = require('esbuild');
const path = require('node:path');

esbuild.build({
  entryPoints: [path.resolve(__dirname, '..', 'src', 'editor-engine-source.js')],
  outfile: path.resolve(__dirname, '..', 'src', 'editor-engine.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome130'],
  legalComments: 'eof'
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

// The engine for erasing with artificial intelligence: only the three files the page needs, copied next to it.
const fs = require('node:fs');
const vendor = path.resolve(__dirname, '..', 'src', 'vendor', 'ort');
fs.mkdirSync(vendor, { recursive: true });
for (const name of ['ort.wasm.min.js', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  fs.copyFileSync(path.resolve(__dirname, '..', 'node_modules', 'onnxruntime-web', 'dist', name), path.join(vendor, name));
}
