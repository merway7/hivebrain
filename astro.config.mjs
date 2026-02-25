// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  server: { port: 4321, host: 'localhost' },
  vite: { server: { strictPort: true } },
});
