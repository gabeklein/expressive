import { Component } from '@expressive/mvc';
import { style } from '@expressive/react/style';
import { forwardRef, memo, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

const RED = 'rgb(255, 0, 0)';
const BLUE = 'rgb(0, 0, 255)';
const GREEN = 'rgb(0, 128, 0)';
const GRAY = 'rgb(128, 128, 128)';
const PURPLE = 'rgb(128, 0, 128)';
const TEAL = 'rgb(0, 128, 128)';

export function Own() {
  return <p id="own" _note>own</p>;
}

style(Own, { color: BLUE, _note: { fontWeight: 700 } });

export class Toggle extends Component {
  on = false;

  render() {
    return <p id="toggle" _on={this.on} onClick={() => (this.on = !this.on)}>toggle</p>;
  }
}

style(Toggle, { color: GRAY, _on: { color: GREEN } });

export function Button({ id }: { id: string }) {
  return <button id={id}>go</button>;
}

style(Button, { color: BLUE, letterSpacing: '1px' });

export function Toolbar() {
  return <nav><Button id="caller" _accent /><Button id="callee" /></nav>;
}

style(Toolbar, { _accent: { color: RED } });

function Card({ children }: { children?: ReactNode }) {
  return <div className="card">{children}</div>;
}

function Frame({ children }: { children?: ReactNode }) {
  return <section><Card>{children}</Card></section>;
}

class Panel extends Component {
  render() {
    return <aside>{this.props.children}</aside>;
  }
}

function Inner() {
  return <span id="lex-inner" _item>inner</span>;
}

style(Inner, { _item: { color: PURPLE } });

export function Lexical() {
  return (
    <div>
      <ul _list><Frame><li id="lex-deep" _item>deep</li></Frame><Inner /></ul>
      <ul _list><Panel><li id="lex-class" _item>class</li></Panel></ul>
      <Card _frame><li id="lex-wrapper" _item>wrapper</li></Card>
      <li id="lex-outside" _item>outside</li>
    </div>
  );
}

style(Lexical, {
  _list: { _item: { color: RED } },
  _frame: { _item: { color: GREEN } },
  _item: { color: GRAY }
});

const Badge = memo(function Badge({ children }: { children?: ReactNode }) {
  return <span id="memo" _dot>{children}</span>;
});

style(Badge, { _dot: { color: RED } });

const Field = forwardRef<HTMLInputElement>(function Field(_props, ref) {
  return <input id="fwd" ref={ref} _field readOnly value="f" />;
});

style(Field, { _field: { color: BLUE } });

export function Exotic() {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (window as any).__fieldRef = ref.current?.id;
  });

  return (
    <div>
      <Badge _accent><b id="memo-child" _strong>child</b></Badge>
      <Field ref={ref} _accent />
    </div>
  );
}

style(Exotic, { _accent: { fontWeight: 700 }, _strong: { color: TEAL } });

export function Switch() {
  return <span id="reveal-callee"><Button id="reveal-plain" /></span>;
}

export class Reveal extends Component {
  shown = false;

  render() {
    return (
      <div>
        <button id="reveal" onClick={() => (this.shown = true)}>reveal</button>
        {this.shown && <Button id="reveal-caller" _late />}
      </div>
    );
  }
}

style(Reveal, { _late: { color: GREEN } });
