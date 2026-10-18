import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

function copyAssets() {
  mkdirSync('dist/wasm', { recursive: true });
  cpSync('node_modules/web-tree-sitter/tree-sitter.wasm', 'dist/wasm/tree-sitter.wasm');
  for (const lang of ['typescript', 'tsx', 'javascript', 'python']) {
    cpSync(`node_modules/tree-sitter-wasms/out/tree-sitter-${lang}.wasm`, `dist/wasm/tree-sitter-${lang}.wasm`);
  }
}

if (production) rmSync('dist', { recursive: true, force: true });

const common = { bundle: true, minify: production, sourcemap: !production, logLevel: 'info' };

const contexts = await Promise.all([
  esbuild.context({
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['vscode'],
  }),
  esbuild.context({
    ...common,
    entryPoints: ['src/webview/main.tsx'],
    outfile: 'dist/webview.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    // elkjs only requires 'web-worker' when a workerUrl is passed; we run ELK in-thread.
    external: ['web-worker'],
    jsx: 'automatic',
    jsxImportSource: 'preact',
    loader: { '.css': 'text' },
  }),
]);

copyAssets();
if (watch) {
  await Promise.all(contexts.map((c) => c.watch()));
} else {
  await Promise.all(contexts.map((c) => c.rebuild()));
  await Promise.all(contexts.map((c) => c.dispose()));
}
