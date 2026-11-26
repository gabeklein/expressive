import type { Style } from './src/style/claim';

declare module '@expressive/mvc/host' {
  interface Host {
    intrinsics: Record<string, Record<string, any>>;
  }
}

declare module '@expressive/jsx/jsx-runtime' {
  namespace JSX {
    interface IntrinsicAttributes {
      style?: Style;
      [attribute: `_${string}`]: unknown;
    }
  }
}
