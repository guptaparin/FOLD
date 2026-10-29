import { defineConfig } from 'vite';

// The film is a separate page that imports the game's own engine and scenery.
export default defineConfig({
  root: __dirname,
  publicDir: 'public',
  server: { host: '127.0.0.1', port: 5199, strictPort: true, fs: { allow: ['..'] } },
  resolve: { dedupe: ['three'] },
  optimizeDeps: { include: ['three'], exclude: ['@babylonjs/havok'] },
  esbuild: { target: 'esnext' },
  build: { target: 'esnext' },
});
