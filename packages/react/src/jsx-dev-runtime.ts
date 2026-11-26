import { Fragment, jsxDEV as base } from 'react/jsx-dev-runtime';
import { root, stamp } from './style';

const jsxDEV: typeof base = (type, props, ...rest) => base(root(type), stamp(props), ...rest);

/** The host wrapper the runtime renders `type` through, if it has one - for `@expressive/react/vite`'s React Refresh registration. */
function hosted(type: unknown) {
  const host = typeof type == 'function' || (type && typeof type == 'object') ? root(type) : undefined;
  return host !== type ? host : undefined;
}

export { Fragment, hosted, jsxDEV };
export type { JSX } from './jsx-runtime';
