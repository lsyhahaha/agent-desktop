/** 使用现有esbuild和Electron执行隔离验收，产物放在既有忽略的out目录。 */
const {
  buildSync
} = require('esbuild');
const {
  mkdirSync,
  copyFileSync,
  readdirSync
} = require('node:fs');
const {
  spawnSync
} = require('node:child_process');
const path = require('node:path');
mkdirSync('out/acceptance', {
  recursive: true
});
buildSync({
  entryPoints: [process.argv.includes('--production') ? 'scripts/acceptance/workspace-main.ts' : 'scripts/acceptance/workspace-ui.ts'],
  outfile: 'out/acceptance/main.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  alias: {
    '@protocol': path.resolve('packages/protocol/src/index.ts')
  },
  target: 'node22'
});
for (const file of readdirSync('out/main')) {
  if (file.endsWith('.js')) copyFileSync(path.join('out/main', file), path.join('out/acceptance', file));
}
const result = spawnSync(require('electron'), ['out/acceptance/main.mjs'], {
  stdio: 'inherit',
  timeout: 60000,
  env: {
    ...process.env,
    NODE_ENV: 'test'
  }
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
