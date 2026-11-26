/** @jsxRuntime classic */
/** @jsx createElement */
/** @jsxFrag Fragment */
import { Component, Model } from '@expressive/mvc';
import { Fragment, createElement } from '@expressive/dom';

class Card extends Component {
  title = '';

  render() {
    return <b>{this.title}</b>;
  }
}

export const classic = (
  <>
    <div className="x">
      <Card title="t" />
    </div>
    {/* @ts-expect-error */}
    <Card title={1} />
  </>
);

class Counter extends Model {
  count = 0;

  render() {
    return <i>{this.count}</i>;
  }
}

const Lazy = () => import('./other');

export const typed = (
  <>
    <Counter count={2} />
    {/* @ts-expect-error */}
    <Counter count="2" />
    <Lazy />
  </>
);
