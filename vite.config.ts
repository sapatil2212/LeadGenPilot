import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

/**
 * Third-party code that every page needs, split away from application code.
 *
 * Two reasons. Cache lifetime: the React runtime and the icon set change when a
 * dependency is upgraded, while application code changes on every deploy, so
 * shipping them in one file makes returning users re-download both. And size: a
 * single application chunk containing the framework sat above Rollup's 500 kB
 * warning threshold, which trains everyone to ignore the warning.
 */
const VENDOR_CHUNKS: Array<[string, RegExp]> = [
  ['vendor-react', /[/\\]node_modules[/\\](react|react-dom|scheduler|use-sync-external-store)[/\\]/],
  ['vendor-icons', /[/\\]node_modules[/\\]lucide-react[/\\]/],
  ['vendor-motion', /[/\\]node_modules[/\\](motion|framer-motion)[/\\]/],
];

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            for (const [name, pattern] of VENDOR_CHUNKS) {
              if (pattern.test(id)) return name;
            }
            return undefined;
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        ignored: [
          '**/processed-leads.json',
          '**/failed-leads.json',
          '**/scraper-log.txt',
          '**/.wwebjs_auth/**',
          '**/.wwebjs_auth',
          '**/.wwebjs_cache/**',
          '**/.wwebjs_cache',
          '**/dist/**',
          '**/utils/.env',
          '**/.env',
          '**/src/config.ts'
        ]
      },
    },
  };
});
