/** @jsxImportSource @expressive/dom */
import { Component } from '@expressive/mvc';
import { Css, Portal, hydrate, render } from '@expressive/dom';
import { renderToString } from '@expressive/dom/server';

const style = Css.use();

const out: string[] = [];

function report() {
  const pre = document.createElement('pre');
  pre.id = 'out';
  pre.textContent = out.join('\n');
  document.body.append(pre);
}

window.addEventListener('error', (event) => {
  out.push(`FAIL uncaught ${event.message}`);
  report();
});

function check(name: string, actual: string, expected: string) {
  out.push(`${actual === expected ? 'PASS' : 'FAIL'} ${name} expected=${expected} actual=${actual}`);
}

function Leaf() {
  return <b _own>leaf</b>;
}

function Middle() {
  return <Leaf _mid />;
}

function Outer() {
  return <Middle _out />;
}

style(Leaf, { color: 'rgb(1, 1, 1)', _own: { color: 'rgb(2, 2, 2)' } });
style(Middle, { _mid: { color: 'rgb(3, 3, 3)' } });
style(Outer, { _out: { color: 'rgb(4, 4, 4)' } });

function Inline() {
  return <i _hue style={{ color: 'rgb(9, 9, 9)' }}>inline</i>;
}

style(Inline, { _hue: { color: 'rgb(8, 8, 8)' } });

function Units() {
  return <span _box>units</span>;
}

style(Units, { _box: { paddingTop: 5, zIndex: 3, marginBlockEnd: 2, marginInline: 4, rotate: 45, animationDuration: [200, 0], offsetRotate: 30, transition: { opacity: { duration: 300, easing: 'linear', delay: 100 }, color: 50 } } });

function Nested() {
  return <section _frame><em>deep</em></section>;
}

style(Nested, {
  _frame: { '--depth': '7', _em: { color: 'rgb(6, 6, 6)', paddingTop: '3px' } }
});

function Readout() {
  return <output>readout</output>;
}

style(Readout, { color: 'rgb(7, 7, 7)', padding: '1px', _output: { padding: '6px' } });

function Toggle() {
  return <input type="checkbox" checked readOnly />;
}

style(Toggle, {
  color: 'rgb(10, 10, 10)',
  ':checked': { color: 'rgb(11, 11, 11)', outlineColor: 'rgb(11, 11, 11)' },
  '@media (min-width: 1px)': { letterSpacing: '2px' },
  '@media (max-width: 1px)': { wordSpacing: '9px' }
});

function Picker() {
  return <Toggle _pick />;
}

style(Picker, { _pick: { color: 'rgb(12, 12, 12)' } });

function Field() {
  return <label _box><input /><b _hint>hint</b></label>;
}

style(Field, {
  _box: { ':focus-within': { _hint: { color: 'rgb(14, 14, 14)' } } },
  _hint: { color: 'rgb(13, 13, 13)' }
});

function Tip() {
  return <span _tip>tip</span>;
}

style(Tip, { _tip: { '::before': { content: '"x"' } } });

const shell = Css.use({ _kbd: { color: 'rgb(20, 20, 20)', padding: '9px' } });

function Keys() {
  return <kbd _key><kbd /></kbd>;
}

shell(Keys, { color: 'rgb(21, 21, 21)', _key: { padding: '3px' } });

class Theme extends Css {
  readonly $ink = '--probe-ink';
  readonly $gap = '--probe-gap';
  readonly $probeTone = 'rgb(40, 40, 40)';
  readonly $wide = '@media (min-width: 1px)';
  readonly $dark = ':is([data-mode="dark"], [data-mode="dark"] *)';
}

const theme = Theme.use({
  $ink: 'rgb(30, 30, 30)',
  $wide: { $gap: '5px' },
  $dark: { $ink: 'rgb(31, 31, 31)' }
});

function Swatch() {
  return <s>swatch</s>;
}

function Panel() {
  return <aside><Swatch /></aside>;
}

theme(Swatch, ($) => ({ color: $.ink, paddingTop: $.gap, border: ['1px', 'solid', $.ink], outlineColor: $.probeTone }));
theme(Panel, { $ink: 'rgb(32, 32, 32)' });

function Typed() {
  return <dfn>typed</dfn>;
}

style(Typed, {
  '--face': 'monospace',
  '--small': '9px',
  font: '700 var(--small)/1 var(--face)',
  fontSize: '13px'
});

const root = document.getElementById('app')!;

render(<><Outer /><Inline /><Nested /><Units /><Readout /><Toggle /><Picker /><Tip /><Field /><Keys /><Swatch /><Panel /><Typed /></>, root);

const leaf = root.querySelector('b')!;
const inline = root.querySelector('i')!;
const frame = root.querySelector('section')!;
const em = root.querySelector('em')!;

check('outermost caller wins on door count', getComputedStyle(leaf).color, 'rgb(4, 4, 4)');
check('inline beats class', getComputedStyle(inline).color, 'rgb(9, 9, 9)');
check('descendant scope applies', getComputedStyle(em).color, 'rgb(6, 6, 6)');
check('custom property', getComputedStyle(frame).getPropertyValue('--depth').trim(), '7');
const box = root.querySelector('span')!;
const readout = root.querySelector('output')!;

check('own rule beats base', getComputedStyle(readout).padding, '6px');

check('px appended where required', getComputedStyle(box).paddingTop, '5px');
check('unitless left alone', getComputedStyle(box).zIndex, '3');
check('logical property sized', getComputedStyle(box).marginBlockEnd, '2px');
check('logical axis sized', getComputedStyle(box).marginLeft, '4px');
check('rotate in degrees', getComputedStyle(box).rotate, '45deg');
check('durations in ms', getComputedStyle(box).animationDuration, '0.2s, 0s');
check('transitions by property', `${getComputedStyle(box).transitionProperty} / ${getComputedStyle(box).transitionDuration} / ${getComputedStyle(box).transitionDelay}`, 'opacity, color / 0.3s, 0.05s / 0.1s, 0s');
check('offset rotate in degrees', getComputedStyle(box).offsetRotate, '30deg');

function Counted() {
  return <var _count>count</var>;
}

style(Counted, { _count: { '--count': 4, zIndex: 'var(--count)' } });

const counted = document.body.appendChild(document.createElement('div'));
render(<Counted />, counted);

check('custom property number stays bare', getComputedStyle(counted.querySelector('var')!).zIndex, '4');
const [toggle, picked] = root.querySelectorAll('input');

check('state beats base', getComputedStyle(toggle).color, 'rgb(11, 11, 11)');
check('caller door beats callee state', getComputedStyle(picked).color, 'rgb(12, 12, 12)');
check('callee state still applies under a door', getComputedStyle(picked).outlineColor, 'rgb(11, 11, 11)');
check('matching media applies', getComputedStyle(toggle).letterSpacing, '2px');
check('other media does not', getComputedStyle(toggle).wordSpacing, '0px');
check('pseudo-element applies', getComputedStyle(root.querySelector('span[class*=Tip]')!, '::before').content, '"x"');

const typed = getComputedStyle(root.querySelector('dfn')!);

check('var() font shorthand keeps parts beside a longhand', `${typed.fontFamily} ${typed.fontWeight} ${typed.fontSize}`, 'monospace 700 13px');

const hint = root.querySelector('label b')!;

check('group state off', getComputedStyle(hint).color, 'rgb(13, 13, 13)');
root.querySelector<HTMLInputElement>('label input')!.focus();
check('group state styles descendant', getComputedStyle(hint).color, 'rgb(14, 14, 14)');
const [key, inner] = root.querySelectorAll('kbd');
check('base beats pack rule', getComputedStyle(key).color, 'rgb(21, 21, 21)');
check('own rule beats pack rule', getComputedStyle(key).padding, '3px');
check('pack rule applies', getComputedStyle(inner).color, 'rgb(20, 20, 20)');
check('leaf carries door classes', String(leaf.className.includes('-d1') && leaf.className.includes('-d2')), 'true');

const [swatch, nested] = root.querySelectorAll('s');

check('variable default at root', getComputedStyle(swatch).color, 'rgb(30, 30, 30)');
check('variable default under media', getComputedStyle(swatch).paddingTop, '5px');
check('token in a shorthand', getComputedStyle(swatch).borderTopColor, 'rgb(30, 30, 30)');
check('field default named from its key', getComputedStyle(swatch).outlineColor, 'rgb(40, 40, 40)');
check('variable overridden for a subtree', getComputedStyle(nested).color, 'rgb(32, 32, 32)');
document.documentElement.dataset.mode = 'dark';
check('variable default under a root state', getComputedStyle(swatch).color, 'rgb(31, 31, 31)');
delete document.documentElement.dataset.mode;

document.querySelector('style[data-expressive=dom]')!.remove();

function Late() {
  return <u _late>late</u>;
}

style(Late, { _late: { color: 'rgb(5, 5, 5)' } });

const second = document.createElement('div');
document.body.append(second);
render(<><Late /><Field /></>, second);

check('stylesheet recreated', getComputedStyle(second.querySelector('u')!).color, 'rgb(5, 5, 5)');
second.querySelector('input')!.focus();
check('group anchor recreated', getComputedStyle(second.querySelector('label b')!).color, 'rgb(14, 14, 14)');

const host = document.body.appendChild(document.createElement('div')).attachShadow({ mode: 'open' });
render(<><Outer /><Swatch /></>, host);

check('shadow root styled', getComputedStyle(host.querySelector('b')!).color, 'rgb(4, 4, 4)');
check('shadow root reads pack variables', getComputedStyle(host.querySelector('s')!).color, 'rgb(30, 30, 30)');

const away = document.body.appendChild(document.createElement('div')).attachShadow({ mode: 'open' });

function Ported() {
  return <Portal into={away}><q _ported>ported</q></Portal>;
}

style(Ported, { _ported: { color: 'rgb(7, 7, 7)' } });
render(<Ported />, document.body.appendChild(document.createElement('div')));

check('portal into shadow root styled', getComputedStyle(away.querySelector('q')!).color, 'rgb(7, 7, 7)');

const detached = document.createElement('div').attachShadow({ mode: 'open' });
render(<Outer />, detached);
document.body.append(detached.host);

check('detached shadow host styled once attached', getComputedStyle(detached.querySelector('b')!).color, 'rgb(4, 4, 4)');

host.host.remove();
document.body.append(host.host);
render(<><Outer /><Late /></>, host);

check('moved shadow host keeps its rules', getComputedStyle(host.querySelector('b')!).color, 'rgb(4, 4, 4)');
check('moved shadow host takes new rules', getComputedStyle(host.querySelector('u')!).color, 'rgb(5, 5, 5)');

const form = document.body.appendChild(document.createElement('div')).attachShadow({ mode: 'open' });
render(<input value="fixed" onInput={() => {}} />, form);

const field = form.querySelector('input')!;
field.value = 'typed';
field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
await new Promise((resolve) => setTimeout(resolve, 20));

check('controlled input restores in a shadow root', field.value, 'fixed');

const iframe = document.body.appendChild(document.createElement('iframe'));
const framed = iframe.contentDocument!.body.appendChild(iframe.contentDocument!.createElement('div')).attachShadow({ mode: 'open' });
render(<Outer />, framed);

check('shadow root in an iframe styled', iframe.contentWindow!.getComputedStyle(framed.querySelector('b')!).color, 'rgb(4, 4, 4)');

const Served = style(Object.assign(() => <p>served</p>, { displayName: 'Shared' }), { marginTop: '9px' });
const Client = style(Object.assign(() => <b>client</b>, { displayName: 'Shared' }), { color: 'rgb(8, 8, 8)' });
const page = await renderToString(<Served />);
document.head.appendChild(document.createElement('style')).textContent = page.css;

const client = document.body.appendChild(document.createElement('div'));
render(<Client />, client);

const served = document.body.appendChild(document.createElement('main'));
served.innerHTML = page.html;

check('server rule styles markup before hydration', getComputedStyle(served.querySelector('p')!).marginTop, '9px');
hydrate(<Served />, served);
check('server rule stays off a client class of the same name', getComputedStyle(client.querySelector('b')!).marginTop, '0px');
check('hydrated element keeps its rules', getComputedStyle(served.querySelector('p')!).marginTop, '9px');

let waiting = false;

function Post(props: { children?: any }) {
  if (waiting) throw new Promise(() => {});
  return props.children;
}

function Feed() {
  return <section><Post><i>kept</i></Post></section>;
}

style(Feed, { ':not(.never)': { _i: { color: 'rgb(9, 9, 9)' } } });

const feed = await renderToString(<Feed />);
document.head.appendChild(document.createElement('style')).textContent = feed.css;

const kept = document.body.appendChild(document.createElement('main'));
kept.innerHTML = feed.html;
waiting = true;
hydrate(<Feed />, kept);

check('kept subtree under a hydrated scope stays styled', getComputedStyle(kept.querySelector('i')!).color, 'rgb(9, 9, 9)');

report();
