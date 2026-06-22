import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const rootDir = process.cwd();

await build({
  configFile: false,
  root: rootDir,
  plugins: [react()],
  build: {
    outDir: resolve(rootDir, '../../dist/webview'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});
