import { style } from '@expressive/react/style';

export default function Later() {
  return <p id="lazy" _lazy>lazy</p>;
}

style(Later, { _lazy: { color: 'rgb(0, 128, 128)' } });
