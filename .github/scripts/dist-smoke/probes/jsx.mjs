import assert from 'node:assert/strict';
import { Css, Fragment, Portal, Style, createElement, mountRoot, plain, style } from '@expressive/jsx';
import { jsx, jsxs } from '@expressive/jsx/jsx-runtime';
import { jsxDEV } from '@expressive/jsx/jsx-dev-runtime';

for (const [name, value] of Object.entries({ Css, Style, createElement, style, jsx, jsxs, jsxDEV, mountRoot }))
  assert.equal(typeof value, 'function', name + ' is not exported by the built dist');

assert.equal(typeof Portal, 'symbol', 'Portal is not exported by the built dist');
assert.equal(typeof Fragment, 'symbol', 'Fragment is not exported by the built dist');
assert.equal(typeof plain.mount, 'function', 'plain is not exported by the built dist');
assert.equal(jsx('p', { children: 'ready' }).type, 'p');

console.log('jsx: import shape ok');
