import * as Refresh from '/@react-refresh';
import { refresh, style, wrap } from '@expressive/react/style';
import { useState } from 'react';

export function Counter() {
  const [count, setCount] = useState(0);
  return <p id="counter" _count onClick={() => setCount(count + 1)}>v1 {count}</p>;
}

style(Counter, { _count: { color: 'rgb(255, 0, 0)' } });

export function Plain() {
  const [count, setCount] = useState(0);
  return <p id="plain" _plain onClick={() => setCount(count + 1)}>v1 {count}</p>;
}

style(Plain, { _plain: { color: 'rgb(255, 0, 0)' } });

if (import.meta.hot) {
  refresh(Counter, '/refreshed.tsx Counter', Refresh.register);
  Refresh.createSignatureFunctionForTransform()(wrap(Counter), 'KEY-1');
}
