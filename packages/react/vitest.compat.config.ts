import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { configDefaults, defineProject, mergeConfig } from 'vitest/config';

import { suite } from '../../vitest.config';

const src = fileURLToPath(new URL('./src/', import.meta.url));
const compat = `${src}compat/index.ts`;
const setup = fileURLToPath(new URL('./test.compat.setup.ts', import.meta.url));

// The react suite runs again against the compat entry: react imports resolve
// to preact/compat, and its `.` and `../test.setup` imports to the compat
// entry and its setup. React-only tests are marked in place (`reactOnly`,
// `preactDiffers`); whole files that don't apply are skipped here.

const skipFiles = [
  // react's own JSX host registration and vite plugin
  'jsx-runtime.test.tsx',
  'vite.test.ts',
  // instances and collections placed as children - preact rejects them
  'element.test.tsx',
  // react's ErrorBoundary; compat has its own suite beside compat/boundary.ts
  'boundary.test.tsx'
];

for (const file of skipFiles)
  if (!existsSync(src + file))
    throw new Error(`compat suite: ${file} is not in packages/react/src`);

if (!readdirSync(src).some((file) => /\.test\./.test(file) && !skipFiles.includes(file)))
  throw new Error('compat suite: no react tests to run');

export default mergeConfig(suite(true), defineProject({
  plugins: [
    {
      name: 'compat-suite',
      enforce: 'pre',
      resolveId(id: string, importer?: string) {
        if (!importer?.startsWith(src)) return;
        if (/^\.\/?(index(\.tsx?)?)?$/.test(id)) return compat;
        if (id === '../test.setup') return setup;
      }
    }
  ],
  resolve: {
    alias: [
      { find: /^react(-dom)?$/, replacement: 'preact/compat' },
      { find: /^react-dom\/client$/, replacement: 'preact/compat/client' },
      { find: /^react-dom\/server$/, replacement: 'preact-render-to-string' },
      { find: /^react\/jsx-(dev-)?runtime$/, replacement: 'preact/jsx-runtime' },
      { find: /^@testing-library\/react$/, replacement: '@testing-library/preact' }
    ]
  },
  test: {
    name: 'compat',
    include: ['src/*.test.*', 'src/compat/*.test.*'],
    exclude: [...configDefaults.exclude, ...skipFiles.map((file) => `src/${file}`)],
    setupFiles: [setup]
  }
}));
