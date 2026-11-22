import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';

import { suite } from '../../vitest.config';

export default mergeConfig(suite(true), defineConfig({
  test: {
    name: 'react',
    exclude: [...configDefaults.exclude, 'src/compat/**'],
    projects: [{ extends: true }, './vitest.compat.config.ts']
  }
}));
