import assert from 'node:assert/strict';
import { h } from 'preact';
import render from 'preact-render-to-string';
import '@expressive/react/compat';
import { Model, Component } from '@expressive/mvc';

class Counter extends Model {
  value = 5;
}

const View = () => h('span', null, Counter.get().value);

assert.equal(render(h(Component, { for: Counter }, h(View))), '<span>5</span>');

class Widget extends Component {
  label = 'unset';

  render() {
    return h('b', null, this.label);
  }
}

assert.equal(render(h(Widget, { label: 'patched' })), '<b>patched</b>');

assert.throws(() => render(h('div', null, Widget.new())), /cannot be rendered directly under Preact/);

console.log('@expressive/react/compat: preact host renders from dist');
