// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  site: 'https://hivebrain.dev',
  output: 'server',
  adapter: vercel({
    excludeFiles: [
      'db/hivebrain.db',
      'db/hivebrain.db-shm',
      'db/hivebrain.db-wal',
      'db/hivebrain-deploy.db',
      'db/hivebrain-hf.db',
      'db/hivebrain.db.backup-pre-import',
      'db/hivebrain.db.backup-pre-se-import',
      'db/full-export.json',
    ],
  }),
});
