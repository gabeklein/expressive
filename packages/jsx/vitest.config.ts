import { mergeConfig } from 'vitest/config';

import { suite } from '../../vitest.config';

export default mergeConfig(suite(true), {
  test: { include: ['src/**/*.test.*', '../dom/src/**/*.test.*'] }
});
