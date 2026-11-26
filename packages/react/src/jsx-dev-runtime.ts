import { Fragment, jsxDEV as base } from 'react/jsx-dev-runtime';
import { root, stamp } from './style';

const jsxDEV: typeof base = (type, props, ...rest) => base(root(type), stamp(props), ...rest);

export { Fragment, jsxDEV };
export type { JSX } from './jsx-runtime';
