import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  /** node_modules is symlinked to ~/code/playground-deps/client/node_modules
   *  (see project_dev_setup.md). Pin cacheDir there directly so dep
   *  optimization writes land in the stash filesystem rather than crossing
   *  the symlink. */
  cacheDir: '/Users/kristiyaniliev/code/playground-deps/client/.vite',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@hooks': path.resolve(__dirname, './src/components/hooks'),
      '@scene': path.resolve(__dirname, './src/components/scene'),
      '@ui': path.resolve(__dirname, './src/components/ui'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@types': path.resolve(__dirname, './src/types'),
      '@assets': path.resolve(__dirname, './src/assets'),
    },
  },
  build: {
    target: 'esnext',
    sourcemap: true,
    rollupOptions: {
      output: {
        /**
         * Split Three.js and React into separate chunks for better caching.
         * Three.js is ~600KB gzipped — we don't want to re-download it
         * every time we change a component.
         */
        manualChunks: {
          three: ['three'],
          'react-vendor': ['react', 'react-dom'],
          r3f: ['@react-three/fiber', '@react-three/drei'],
        },
      },
    },
  },
  server: {
    port: 5173,
    fs: {
      /** Source lives in ~/code/playground/client; node_modules is a symlink
       *  resolving to ~/code/playground-deps/client/node_modules. Vite's
       *  default fs.allow is the project root only — the resolved
       *  node_modules path lies outside it, so without this Vite would
       *  refuse to serve the optimized dep bundles. */
      allow: [
        '/Users/kristiyaniliev/code/playground/client',
        '/Users/kristiyaniliev/code/playground-deps/client',
      ],
    },
    /** Proxy WebSocket connections to the Rust server during development */
    proxy: {
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
    },
  },
});
