import { afterEach, describe, expect, it, vi } from 'vitest';

import { Component, get, has, map, Model, set } from '@expressive/mvc';

import { createElement, Css, Fragment, Portal, render, style } from './index';
import { renderToString } from './server';
import { flushMicrotasks, mockPromise, mount } from '../test.setup';

afterEach(() => {
  vi.unstubAllGlobals();
});

async function serve(node: any, signal?: AbortSignal) {
  vi.stubGlobal('document', undefined);

  try {
    return await renderToString(node, { signal });
  } finally {
    vi.unstubAllGlobals();
  }
}

async function parity(node: () => any) {
  const root = document.body.appendChild(document.createElement('main'));
  const unmount = render(node(), root);
  const expected = root.innerHTML;

  unmount();
  root.remove();

  const { html } = await serve(node());

  expect(html).toBe(expected);
  return html;
}

describe('renderToString', () => {
  it('will render elements, text and attributes as render() leaves them', async () => {
    const html = await parity(() => (
      <section id="a" title={'say "hi" & go'} hidden tabIndex={0} aria-hidden={false} data-n={2} draggable spellcheck={false}>
        {'1 < 2 & 3 > 2'}
        {null}
        {undefined}
        {true}
        {[<b key="x">x</b>, 0n, 4]}
        <br />
        <label htmlFor="name">name</label>
        <button disabled={false}>go</button>
      </section>
    ));

    expect(html).toContain('<br>');
    expect(html).toContain('1 &lt; 2 &amp; 3 &gt; 2');
  });

  it('will render components, fragments and collections with their markers', async () => {
    class Counter extends Component {
      count = 2;

      render() {
        return <span>{this.count}</span>;
      }
    }

    class Item extends Component {
      name = '';

      render() {
        return <li>{this.name}</li>;
      }
    }

    class Lists extends Component {
      list = has(['one']);
      pool = has(Item);
      values = map<string, string>([['a', 'A']]);

      render() {
        return <>{this.list}<ul>{this.pool}</ul>{this.values}</>;
      }
    }

    function Greeting(props: { name: string }) {
      return <>hi {props.name}</>;
    }

    const html = await parity(() => (
      <div>
        <Greeting name="you" />
        <Counter count={3} />
        <Fragment><i>f</i></Fragment>
        <Lists />
      </div>
    ));

    expect(html).toBe(
      '<!--fragment--><div><!--function--><!--fragment-->hi you<!--/fragment--><!--/function-->' +
      '<!--component--><span>3</span><!--/component--><!--fragment--><i>f</i><!--/fragment-->' +
      '<!--component--><!--fragment--><!--collection-->one<!--/collection--><ul><!--collection--><!--/collection--></ul>' +
      '<!--collection-->A<!--/collection--><!--/fragment--><!--/component--></div><!--/fragment-->'
    );
  });

  it('will render a component instance and a Model unwrapped by the tracker', async () => {
    class Note extends Component {
      text = 'kept';

      render() {
        return <p>{this.text}</p>;
      }
    }

    const note = Note.new();
    const { html } = await serve(<main>{note}</main>);

    expect(html).toBe('<!--fragment--><main><!--component--><p>kept</p><!--/component--></main><!--/fragment-->');
  });

  it('will resolve context between components', async () => {
    class Theme extends Model {
      color = 'red';
    }

    class Swatch extends Component {
      theme = get(Theme);

      render() {
        return <i>{this.theme.color}</i>;
      }
    }

    function Label() {
      const { color } = Theme.get();
      return <b>{color}</b>;
    }

    const html = await parity(() => (
      <Component for={Theme}>
        <Swatch />
        <Label />
      </Component>
    ));

    expect(html).toContain('<i>red</i>');
    expect(html).toContain('<b>red</b>');
  });

  it('will render svg attributes as written and foreignObject content as html', async () => {
    await parity(() => (
      <svg viewBox="0 0 2 2">
        <path d="M0 0" stroke-width="2" />
        <foreignObject><div tabIndex={1}>html</div></foreignObject>
      </svg>
    ));
  });

  it('will write style classes and declarations, emitting their rules', async () => {
    function Card(props: { _active?: boolean; children?: any }) {
      return (
        <div _active={props._active} style={{ marginTop: 4, zIndex: 2, '--gap': '1px', color: null }}>
          {props.children}
        </div>
      );
    }

    style(Card, {
      _active: { fontWeight: 700 },
      _div: { padding: '4px' },
      color: 'blue'
    });

    const html = await parity(() => <Card _active>card</Card>);
    const { css } = await serve(<Card _active>card</Card>);

    expect(html).toContain('class="Card_div Card_active Card"');
    expect(css).toBe([
      '.Card{color: blue;}',
      '.Card_active{font-weight: 700;}',
      '.Card_div{padding: 4px;}'
    ].join('\n'));
  });

  it('will size numbers by property and include root variables', async () => {
    class Pack extends Css {
      $tone = 'red';
    }

    const styled = Pack.use();

    function Box() {
      return <div>box</div>;
    }

    styled(Box, ($) => ({ marginTop: 4, lineHeight: 1.5, opacity: 0, webkitLineClamp: 2, cssFloat: 'left', color: $.tone }));

    const { css, html } = await serve(<Box />);

    expect(html).toBe('<!--fragment--><!--function--><div class="Box">box</div><!--/function--><!--/fragment-->');
    expect(css).toBe(
      '.Box{margin-top: 4px; line-height: 1.5; opacity: 0; -webkit-line-clamp: 2; float: left; color: var(--tone);}\n' +
      ':where(:root){--tone: red;}'
    );
  });

  it('will drop declarations a browser would reject and escape markup in the rest', async () => {
    function Box() {
      return (
        <div style={{
          backgroundImage: 'url(x); position: fixed',
          color: 'red}body{display:none',
          width: NaN,
          height: Infinity,
          outline: true as any,
          content: '"</style>"',
          margin: 'calc((1px)',
          padding: 'a)b(',
          fontFamily: '"a;b", \\"x',
          'line-height': 2,
          msTransform: 'none'
        } as any}
        />
      );
    }

    const { html } = await serve(<Box />);

    expect(html).toBe(
      '<!--fragment--><!--function--><div style="content: &quot;\\3c /style&gt;&quot;; font-family: &quot;a;b&quot;, \\&quot;x; ' +
      'line-height: 2; -ms-transform: none;"></div><!--/function--><!--/fragment-->'
    );
  });

  it('will include root variables a module adds after the first rule', async () => {
    function Early() {
      return <i>early</i>;
    }

    function Late() {
      return <b>late</b>;
    }

    style(Early, { color: 'red' });

    function Loader() {
      class Accent extends Css {
        $accent = 'blue';
      }

      Accent.use()(Late, ($) => ({ color: $.accent }));

      return <Late />;
    }

    const { css } = await serve(<><Early /><Loader /></>);

    expect(css).toContain(':where(:root){--accent: blue;}');
  });

  it('will leave out range comments without markers', async () => {
    class Note extends Component {
      render() {
        return <p>{[<b key="a">a</b>]}</p>;
      }
    }

    const { html } = await renderToString(
      <main><Note /><Portal into="body"><i>away</i></Portal></main>,
      { markers: false }
    );

    expect(html).toBe('<main><p><b>a</b></p></main>');
  });

  it('will inline plain class rules in cascade order, before inline style', async () => {
    class Pack extends Css {}

    const styled = Pack.use();

    function Card(props: { children?: any }) {
      return <div _active style={{ marginTop: 2 }}>{props.children}<span>plain</span></div>;
    }

    function Page() {
      return <Card _card>page</Card>;
    }

    styled(Card, {
      padding: 4,
      color: 'red',
      _active: { fontWeight: 700, ':hover': { color: 'blue' } },
      '@media (min-width: 1px)': { margin: 1 }
    });
    styled(Page, { _card: { color: 'green' } });

    const { css, html } = await renderToString(<Page />, { inline: true, markers: false });

    expect(html).toBe(
      '<div class="Card_active Card_active-hover Page_card-d1 Card Card-media_min-width_1px" style="padding: 4px; color: red; font-weight: 700; color: green; margin-top: 2px;">' +
      'page<span>plain</span></div>'
    );
    expect(css).toContain(':hover');
    expect(css).toContain('@media (min-width: 1px)');
  });

  it('will write form state as attributes and raw text as is', async () => {
    const { html } = await serve(
      <form>
        <input value={'a"b'} checked defaultValue="x" onInput={() => {}} />
        <input {...{ value: null } as any} checked={false} defaultChecked />
        <textarea value="t<" />
        <textarea>kept</textarea>
        <textarea defaultValue={'\nlead'} />
        <pre>{'\nlead'}</pre>
        <select><option selected>o</option></select>
        <select value="b"><option>a</option><option value="b">B</option></select>
        <style>{'a > b {}'}{[' i', null, false]}</style>
        <div dangerouslySetInnerHTML={{ __html: '<b>raw</b>' }} />
        <div {...{ dangerouslySetInnerHTML: {} } as any} />
        <div {...{ dangerouslySetInnerHTML: null } as any}>dropped</div>
        <div {...{ innerHTML: '<i>set</i>' } as any} />
        <div {...{ textContent: '<i>text</i>' } as any} />
        <Portal into="body"><p>away</p></Portal>
      </form>
    );

    expect(html).toBe(
      '<!--fragment--><form><input value="a&quot;b" checked=""><input>' +
      '<textarea>t&lt;</textarea><textarea>kept</textarea><textarea>\n\nlead</textarea><pre>\n\nlead</pre>' +
      '<select><option selected="">o</option></select>' +
      '<select><option>a</option><option value="b" selected="">B</option></select>' +
      '<style>a > b {} i</style><div><b>raw</b></div><div></div><div></div><div><i>set</i></div>' +
      '<div>&lt;i&gt;text&lt;/i&gt;</div><!--portal--></form><!--/fragment-->'
    );
  });

  it('will omit boolean attributes for falsy values', async () => {
    const { html } = await serve(
      <div>
        <button disabled={0 as any} hidden={'' as any} />
        <button disabled={'yes' as any} hidden={'until-found' as any} title={false as any} />
      </div>
    );

    expect(html).toBe(
      '<!--fragment--><div><button></button><button disabled="" hidden="until-found"></button></div><!--/fragment-->'
    );
  });

  it('will escape markup in attributes and closing tags in raw text', async () => {
    const state = JSON.stringify({ a: '</script><img src=x onerror=alert(1)>', b: '<!-- x' });
    const { html } = await serve(
      <head>
        <meta {...{ content: 'a<b>"c' } as any} />
        <script type="application/json">{state}</script>
        <style>{'a{} </STYLE><b>'}</style>
      </head>
    );

    expect(html).toBe(
      '<!--fragment--><head><meta content="a&lt;b&gt;&quot;c">' +
      '<script type="application/json">{"a":"<\\/script><img src=x onerror=alert(1)>","b":"<\\!-- x"}</script>' +
      '<style>a{} <\\/STYLE><b></style></head><!--/fragment-->'
    );
  });

  it('will drop event attributes and throw for names that break markup', async () => {
    const { html } = await serve(<div {...{ onclick: 'alert(1)', ONLOAD: 'x', title: 't' } as any} />);

    expect(html).toBe('<!--fragment--><div title="t"></div><!--/fragment-->');

    await expect(serve(<div {...{ 'x"><img src=x onerror=alert(1)>': 'y' } as any} />))
      .rejects.toThrow('Invalid attribute name "x"><img src=x onerror=alert(1)>".');
    await expect(serve(createElement('img src=x', {})))
      .rejects.toThrow('Invalid element name "img src=x".');
  });

  it('will await a suspended render and retry it in place', async () => {
    class Data extends Component {
      value = set(async () => 'loaded');
      renders = 0;

      render() {
        this.renders++;
        return <p>{this.value}</p>;
      }
    }

    const { html } = await serve(<Data />);

    expect(html).toContain('<p>loaded</p>');
  });

  it('will await a lazy component', async () => {
    function Page() {
      return <h1>page</h1>;
    }

    const Lazy = () => Promise.resolve({ default: Page });
    const { html } = await serve(<Lazy />);

    expect(html).toBe('<!--fragment--><!--function--><!--function--><h1>page</h1><!--/function--><!--/function--><!--/fragment-->');
  });

  it('will let a catch boundary handle an error once, then render again', async () => {
    let fail = true;

    function Risky() {
      if (fail) throw 'broke';
      return <p>fine</p>;
    }

    class Shell extends Component {
      error = '';

      catch(error: Error) {
        this.error = error.message;
        fail = false;
      }

      render() {
        return <main>{this.error}<Risky /></main>;
      }
    }

    const { html } = await serve(<Shell />);

    expect(html).toContain('<main>broke<!--function--><p>fine</p>');
  });

  it('will recover each failing child once, as render() does', async () => {
    const failing = new Set(['a', 'b']);
    const handled = vi.fn();

    function Risky(props: { name: string }) {
      if (failing.delete(props.name)) throw new Error(props.name);
      return <i>{props.name}</i>;
    }

    const node = () => (
      <Component catch={handled}>
        <Risky name="a" />
        <Risky name="b" />
      </Component>
    );

    const { html } = await serve(node());

    expect(handled).toHaveBeenCalledTimes(2);
    expect(html).toContain('<i>a</i><!--/function--><!--function--><i>b</i>');
  });

  it('will stop at an aborted signal, skipping catch boundaries', async () => {
    const pending = mockPromise<string>();
    const handled = vi.fn();
    const controller = new AbortController();

    class Slow extends Component {
      value = set(() => pending);

      render() {
        return <p>{this.value}</p>;
      }
    }

    const rendering = serve(<Component catch={handled}><Slow /></Component>, controller.signal);

    controller.abort(new Error('timed out'));
    await expect(rendering).rejects.toThrow('timed out');
    expect(handled).not.toHaveBeenCalled();

    await expect(serve(<Slow />, AbortSignal.abort('gone'))).rejects.toBe('gone');
  });

  it('will abort while a catch boundary recovers', async () => {
    const controller = new AbortController();
    const recovering = mockPromise<void>();

    function Broken(): any {
      throw new Error('broke');
    }

    const rendering = serve(<Component catch={() => recovering}><Broken /></Component>, controller.signal);

    await flushMicrotasks();
    controller.abort('stop');
    await expect(rendering).rejects.toBe('stop');
  });

  it('will resolve normally with a signal that never aborts', async () => {
    const { html } = await serve(<p>ok</p>, new AbortController().signal);

    expect(html).toBe('<!--fragment--><p>ok</p><!--/fragment-->');
    expect((await renderToString(<p>ok</p>)).html).toBe(html);
  });

  it('will use a placement catch and propagate a second error', async () => {
    const handled = vi.fn();

    function Broken(): any {
      throw new Error('again');
    }

    await expect(serve(<Component catch={handled}><Broken /></Component>)).rejects.toThrow('again');
    expect(handled).toHaveBeenCalledOnce();
    await expect(serve(<Broken />)).rejects.toThrow('again');
  });

  it('will run new() but not effects, and will destroy what it built', async () => {
    const effect = vi.fn();
    const destroyed = vi.fn();

    class Quiet extends Component {
      new() {
        this.get(effect);
        return destroyed;
      }

      render() {
        return <p>quiet</p>;
      }
    }

    await serve(<Quiet />);

    expect(effect).not.toHaveBeenCalled();
    expect(destroyed).toHaveBeenCalledOnce();

    const [, root] = mount(Quiet);

    await flushMicrotasks();
    expect(effect).toHaveBeenCalled();
    root.remove();
  });

  it('will throw what render() throws for what it cannot render', async () => {
    class Plain extends Model {}

    function Holder() {
      return <div>{{} as any}</div>;
    }

    const nodes = [
      Plain.new() as any,
      createElement(Plain as any),
      {} as any,
      createElement(Symbol.iterator as any),
      <Holder />
    ];

    for (const node of nodes) {
      let expected = '';

      try {
        render(node, document.createElement('main'));
      } catch (error) {
        expected = (error as Error).message;
      }

      expect(expected).not.toBe('');
      await expect(serve(node)).rejects.toThrow(expected);
    }

    await expect(serve(<Holder />)).rejects.toThrow('Cannot render a plain object in Holder.');
  });
});
