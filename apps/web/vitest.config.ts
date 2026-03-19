import { defineConfig } from 'vitest/config';
import path from 'path';

const dir = import.meta.dirname;

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  plugins: [
    {
      // Custom plugin to resolve Next.js dynamic route paths that contain
      // "[" and "]" characters, which Vite's alias system struggles with.
      name: 'resolve-nextjs-dynamic-routes',
      resolveId(id) {
        // Match imports like @/app/api/collections/[id]/route
        if (id.startsWith('@/app/api/') && id.includes('[')) {
          const relativePath = id.slice(2); // remove '@/'
          const resolved = path.join(dir, relativePath);
          // Try .ts extension if no extension
          if (!path.extname(resolved)) {
            return resolved + '.ts';
          }
          return resolved;
        }
        return null;
      },
    },
  ],
  resolve: {
    alias: [
      { find: '@', replacement: dir },
      {
        find: '@ai-sedlacek/shared',
        replacement: path.join(dir, '../../packages/shared/src'),
      },
    ],
  },
});
