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
