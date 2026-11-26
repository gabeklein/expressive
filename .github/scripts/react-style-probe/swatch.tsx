import { Component } from '@expressive/mvc';
import { style } from '@expressive/react/style';

export class Swatch extends Component {
  render() {
    return <p id="swatch" _ink>swatch</p>;
  }
}

style(Swatch, { _ink: { color: 'rgb(255, 0, 0)' } });
