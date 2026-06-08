import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  base: './',
  plugins: [svelte()],
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
});
