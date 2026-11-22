import { defineConfig, type UserConfig } from 'tsdown';

const shared: UserConfig = {
  sourcemap: true,
  outDir: 'dist',
  outExtensions: () => ({ js: '.js' }),
  format: ['esm'],
  outputOptions: {
    exports: 'named',
    chunkFileNames: 'chunk-[name]-[hash].js'
  }
};

export default defineConfig([
  {
    ...shared,
    clean: true,
    dts: { compilerOptions: { paths: {} } },
    entry: {
      index: 'src/index.ts',
      adapter: 'src/adapter.ts',
      vite: 'src/vite.ts'
    }
  },
  {
    ...shared,
    clean: false,
    tsconfig: 'tsconfig.compat.json',
    dts: { compilerOptions: { paths: {} } },
    external: ['@expressive/react/adapter'],
    entry: {
      compat: 'src/compat/index.ts'
    }
  }
]);
