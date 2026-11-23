import assert from 'node:assert/strict';
import { Css, Fragment, Portal, Style, createElement, style } from '@expressive/jsx';
import { jsx, jsxs } from '@expressive/jsx/jsx-runtime';
import { jsxDEV } from '@expressive/jsx/jsx-dev-runtime';
import { renderToString } from '@expressive/jsx/server';
import { limp, mountRoot } from '@expressive/jsx/host';

for (const [name, value] of Object.entries({ Css, Style, createElement, style, jsx, jsxs, jsxDEV, renderToString, mountRoot }))
  assert.equal(typeof value, 'function', name + ' is not exported by the built dist');

assert.equal(typeof Portal, 'symbol', 'Portal is not exported by the built dist');
assert.equal(typeof Fragment, 'symbol', 'Fragment is not exported by the built dist');
assert.equal(typeof limp.mount, 'function', 'limp is not exported by the built dist');
assert.equal((await renderToString(jsx('p', { children: 'ready' }), { markers: false })).html, '<p>ready</p>');

console.log('jsx: import shape + renderToString ok');
