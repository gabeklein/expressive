import { afterEach, describe, expect, it, vi } from 'vitest';

import { Component, get, has, map, Model, set } from '@expressive/mvc';

import { createElement, Css, Fragment, Portal, render, style } from '@expressive/dom';
import { renderToString } from './server';
import { attached, flushMicrotasks, mockPromise, mockWarn, mount } from '../test.setup';

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

function unhashed(html: string, css = '') {
  const names = new Set(html.match(/(?<=class="[^"]*)[^\s"]+-[0-9a-z]{1,7}(?=[\s"])/g));
  const strip = (text: string) => text.replace(/[\w-]+/g, (token) => names.has(token) ? token.slice(0, token.lastIndexOf('-')) : token);

  return [strip(html), strip(css)];
}

async function parity(node: () => any) {
  const root = attached();
  const unmount = render(node(), root);
  const expected = root.innerHTML;

  unmount();
  root.remove();

  const { html } = await serve(node());

  expect(unhashed(html)[0]).toBe(expected);
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

    expect(html).toMatch(/class="Card_div-\w+ Card_active-\w+ Card-\w+"/);
    expect((await serve(<Card _active>card</Card>)).css).toBe(css);
    expect(unhashed(html, css)[1]).toBe([
      '.Card{color: blue;}',
      '.Card_active{font-weight: 700;}',
      '.Card_div{padding: 4px;}'
    ].join('\n'));
  });

  it('will name rules the same on every render, scope groups unhashed', async () => {
    function List() {
      return <ul><li>a</li></ul>;
    }

    style(List, { ':hover': { _li: { color: 'red' } } });

    const first = await serve(<List />);
    const second = await serve(<List />);

    expect(second).toEqual(first);
    expect(first.css).toMatch(/^:where\(\.List-group:hover\) \.List_li-List_hover-\w+\{color: red;\}$/);
  });

  it('will size numbers by property and include root variables', async () => {
    class Pack extends Css {
      $tone = 'red';
    }

    const styled = Pack.use();

    function Box() {
      return <div>box</div>;
    }

    styled(Box, ($) => ({ marginTop: 4, lineHeight: 1.5, opacity: 0, webkitLineClamp: 2, webkitBoxFlex: 1, readingOrder: 2, flex: 1, '--depth': 2, cssFloat: 'left', color: $.tone }));

    const { css, html } = await serve(<Box />);

    const [plain, rules] = unhashed(html, css);

    expect(html).toMatch(/class="Box-\w+"/);
    expect(plain).toBe('<!--fragment--><!--function--><div class="Box">box</div><!--/function--><!--/fragment-->');
    expect(rules).toBe(
      '.Box{margin-top: 4px; line-height: 1.5; opacity: 0; -webkit-line-clamp: 2; -webkit-box-flex: 1; reading-order: 2; flex: 1; --depth: 2; float: left; color: var(--tone);}\n' +
      ':where(:root){--tone: red;}'
    );
  });

  it('will keep a number bare on a dashed vendor key', async () => {
    const { html } = await serve(<p style={{ ['-webkit-line-clamp' as 'webkitLineClamp']: 2 }} />);

    expect(html).toContain('style="-webkit-line-clamp: 2;"');
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

  it('will include root variables first defined after the sheet opened', async () => {
    function First() {
      return <i>first</i>;
    }

    function Later() {
      return <b>later</b>;
    }

    style(First, { color: 'blue' });

    function Loader() {
      class Fresh extends Css {
        $fresh = 'red';
      }

      Fresh.use()(Later, ($) => ({ color: $.fresh }));

      return <Later />;
    }

    const { css } = await renderToString(<><First /><Loader /></>);

    expect(css).toContain(':where(:root){--fresh: red;}');
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

    const { html, head } = await renderToString(
      <main><Note /><Portal into="body"><i>away</i></Portal><title>Note</title></main>,
      { markers: false }
    );

    expect(html).toBe('<main><p><b>a</b></p></main>');
    expect(head).toBe('<title>Note</title>');
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

    expect(unhashed(html)[0]).toBe(
      '<div class="Card_active Card_active-hover Page_card-d1 Card Card-media_min-width_1px" style="padding: 4px; color: green; font-weight: 700; margin-top: 2px;">' +
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
        <input value={true as any} /><input value={false as any} />
      </div>
    );

    expect(html).toBe(
      '<!--fragment--><div><button></button><button disabled="" hidden="until-found"></button>' +
      '<input value="true"><input value="false"></div><!--/fragment-->'
    );
  });

  it('will escape markup in attributes and closing tags in raw text', async () => {
    const state = JSON.stringify({ a: '</script><img src=x onerror=alert(1)>', b: '<!-- x' });
    const { html } = await serve(
      <head>
        <base {...{ target: 'a<b>"c' } as any} />
        <script type="application/json">{state}</script>
        <style>{'a{} </STYLE><b>'}</style>
      </head>
    );

    expect(html).toBe(
      '<!--fragment--><head><base target="a&lt;b&gt;&quot;c">' +
      '<script type="application/json">{"a":"<\\/script><img src=x onerror=alert(1)>","b":"\\u003C!-- x"}</script>' +
      '<style>a{} <\\/STYLE><b></style></head><!--/fragment-->'
    );
  });

  it('will keep escaped JSON parseable and raw content props unescaped', async () => {
    const state = { a: '</script>', b: '<!-- x' };
    const { html } = await serve(
      <div>
        <script type="application/json">{JSON.stringify(state)}</script>
        <script {...{ textContent: 'if (a < b && c) x()' } as any} />
        <style {...{ textContent: 'a > b {}' } as any} />
      </div>
    );
    const json = html.slice(html.indexOf('json">') + 6, html.indexOf('</script>'));

    expect(JSON.parse(json)).toEqual(state);
    expect(html).toContain('<script>if (a < b && c) x()</script><style>a > b {}</style>');
  });

  it('will drop event attributes and throw for names that break markup', async () => {
    const { html } = await serve(<div {...{ onclick: 'alert(1)', ONLOAD: 'x', title: 't' } as any} />);

    expect(html).toBe('<!--fragment--><div title="t"></div><!--/fragment-->');

    await expect(serve(<div {...{ 'x"><img src=x onerror=alert(1)>': 'y' } as any} />))
      .rejects.toThrow('Invalid attribute name "x"><img src=x onerror=alert(1)>".');
    await expect(serve(createElement('img src=x', {})))
      .rejects.toThrow('Invalid element name "img src=x".');
  });

  it('will collect head elements, leaving the marker render() leaves', async () => {
    const node = () => (
      <div>
        <title>{'A & B'}</title>
        <meta name="description" content="about" />
        <svg><title>icon</title></svg>
      </div>
    );

    const html = await parity(node);
    const { head } = await serve(node());

    expect(html).toBe('<!--fragment--><div><!--portal--><!--portal--><svg><title>icon</title></svg></div><!--/fragment-->');
    expect(head).toBe('<title>A &amp; B</title><meta name="description" content="about">');
  });

  it('will put the latest title first, as render() leaves the head', async () => {
    const { head } = await serve(
      <div>
        <title>Outer</title>
        <meta name="a" content="1" />
        <section><title>Inner</title></section>
        <meta name="b" content="2" />
      </div>
    );

    expect(head).toBe('<title>Inner</title><title>Outer</title><meta name="a" content="1"><meta name="b" content="2">');
  });

  it('will leave head elements in a head it renders, as for a whole document', async () => {
    const { head, html } = await serve(
      <html>
        <head><meta charSet="utf-8" /><meta property="og:title" content="Shell" /><title>Shell</title></head>
        <body><title>Page</title></body>
      </html>
    );

    expect(html).toBe(
      '<!--fragment--><html><head><meta charset="utf-8"><meta property="og:title" content="Shell"><title>Shell</title></head>' +
      '<body><!--portal--></body></html><!--/fragment-->'
    );
    expect(head).toBe('<title>Page</title>');
  });

  it('will keep head elements only from the render a catch boundary kept', async () => {
    let failed = false;

    function Risky() {
      if (!failed) {
        failed = true;
        throw new Error('broke');
      }

      return <p>ok</p>;
    }

    class Shell extends Component {
      error = '';

      catch(error: Error) {
        this.error = error.message;
      }

      render() {
        return <main><title>{this.error || 'Loading'}</title><Risky /></main>;
      }
    }

    const { head } = await serve(<Shell />);

    expect(head).toBe('<title>broke</title>');
  });

  it('will keep range comments in an svg title, as render() does', async () => {
    function Label() {
      return 'icon';
    }

    await parity(() => <svg><title><Label /></title></svg>);
  });

  it('will render a title from components as text, and keep microdata in place', async () => {
    function Name() {
      return 'Hello';
    }

    const { head, html } = await serve(
      <div itemScope>
        <title><Name /> | Site</title>
        <meta itemProp="price" content="9" />
      </div>
    );

    expect(head).toBe('<title>Hello | Site</title>');
    expect(html).toBe('<!--fragment--><div itemscope=""><!--portal--><meta itemprop="price" content="9"></div><!--/fragment-->');
  });

  it('will await a suspended render and retry it in place', async () => {
    class Data extends Component {
      value = set(async () => 'loaded');

      render() {
        return <p>{this.value}</p>;
      }
    }

    const { html } = await serve(<Data />);

    expect(html).toContain('<p>loaded</p>');
  });

  it('will not wait on a void required factory, which holds only ready', async () => {
    let done = false;

    class Session extends Model {
      user = set(async () => {
        await null;
        done = true;
      }, true);
    }

    function Name() {
      Session.get();
      return <span>{String(done)}</span>;
    }

    const { html } = await serve(
      <Component for={Session} fallback={<i>loading</i>}>
        <Name />
      </Component>
    );

    expect(html).toContain('<span>false</span>');
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

  it('will not retry a boundary that gets no further', async () => {
    const handled = vi.fn();

    class Shell extends Component {
      catch = handled;

      render() {
        const Inner = () => {
          throw new Error('always');
        };

        return <main><Inner /></main>;
      }
    }

    await expect(serve(<Shell />)).rejects.toThrow('always');
    expect(handled).toHaveBeenCalledOnce();
  });

  it('will recover children whose new() fails, and an error an inner boundary gives up on', async () => {
    const failing = new Set(['a', 'b']);
    const outer = vi.fn();

    class Setup extends Component {
      name = '';

      new() {
        if (failing.delete(this.name)) throw new Error(this.name);
      }

      render() {
        return <i>{this.name}</i>;
      }
    }

    const { html } = await serve(<Component catch={outer}><Setup name="a" /><Setup name="b" /></Component>);

    expect(outer).toHaveBeenCalledTimes(2);
    expect(html).toContain('<i>a</i>');
    expect(html).toContain('<i>b</i>');

    let once = true;

    function Risky() {
      if (once) {
        once = false;
        throw new Error('once');
      }

      return <i>ok</i>;
    }

    function Always(): any {
      throw new Error('always');
    }

    const recovered = vi.fn();
    const inner = vi.fn();

    await expect(serve(
      <Component catch={recovered}>
        <Risky />
        <Component catch={inner}><Always /></Component>
      </Component>
    )).rejects.toThrow('always');

    expect(recovered).toHaveBeenCalledTimes(2);
    expect(recovered.mock.calls[1][0].message).toBe('always');
  });

  it('will count each inner boundary that gives up as its own failure', async () => {
    const failing = new Set(['a', 'b']);
    const outer = vi.fn();

    function Fails(props: { id: string }) {
      if (failing.has(props.id)) throw new Error(props.id);
      return <i>{props.id}</i>;
    }

    class Inner extends Component {
      id = '';

      catch() {}

      render() {
        return <Fails id={this.id} />;
      }
    }

    const { html } = await serve(
      <Component catch={(error: Error) => { outer(error.message); failing.delete(error.message); }}>
        <Inner id="a" />
        <Inner id="b" />
      </Component>
    );

    expect(outer.mock.calls).toEqual([['a'], ['b']]);
    expect(html).toContain('<i>a</i>');
    expect(html).toContain('<i>b</i>');
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

  it('will let a timeout interrupt a render that suspends forever', async () => {
    function Spinning(): any {
      throw Promise.resolve();
    }

    await expect(serve(<Spinning />, AbortSignal.timeout(20))).rejects.toMatchObject({ name: 'TimeoutError' });
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

  it('will leave a portal its marker, rendering nothing into it', async () => {
    const made = vi.fn();

    class Away extends Component {
      new() {
        made();
      }

      render() {
        return <i>away</i>;
      }
    }

    style(Away, { color: 'red' });

    const { html, css } = await serve(<main><Portal into={null as any}><Away /></Portal><Portal into="#x"><Away /></Portal></main>);

    expect(html).toBe('<!--fragment--><main><!--portal--><!--portal--></main><!--/fragment-->');
    expect(css).not.toContain('.Away');
    expect(made).not.toHaveBeenCalled();
  });

  it('will not wait on a suspension its subtree no longer renders', async () => {
    class Gate extends Model {
      open = true;
    }

    function Slow(): any {
      throw new Promise(() => {});
    }

    class Shell extends Component {
      gate = new Gate();

      new() {
        setTimeout(() => this.gate.open = false);
      }

      render() {
        return <main>{this.gate.open && <Slow />}</main>;
      }
    }

    const { html } = await serve(<Shell />, AbortSignal.timeout(1000));

    expect(html).toContain('<main></main>');
  });

  it('will reject a late error once, logging nothing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const renders = vi.fn();
    let pending = true;

    function Late(): any {
      renders();

      if (pending) {
        pending = false;
        throw Promise.resolve();
      }

      throw new Error('late');
    }

    try {
      await expect(serve(<Component catch={() => {}}><Late /></Component>)).rejects.toThrow('late');
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(renders).toHaveBeenCalledTimes(3);
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it('will order head elements as the document does, whatever settles first', async () => {
    class Slow extends Component {
      value = set(async () => 'a');

      render() {
        return <meta name={this.value} />;
      }
    }

    const { head } = await serve(<main><Slow /><meta name="b" /></main>);

    expect(head).toBe('<meta name="a"><meta name="b">');
  });

  it('will not draw a fallback, nor emit its styles', async () => {
    const drawn = vi.fn();
    let ready = false;

    function Spinner() {
      drawn();
      return <i>wait</i>;
    }

    style(Spinner, { color: 'red' });

    function Slow() {
      if (!ready) throw new Promise((resolve) => setTimeout(resolve)).then(() => ready = true);
      return <p>done</p>;
    }

    const { html, css } = await serve(<Component fallback={<Spinner />}><Portal into="#x" /><Slow /></Component>);

    expect(html).toContain('<!--portal--><!--function--><p>done</p>');
    expect(css).not.toContain('.Spinner');
    expect(drawn).not.toHaveBeenCalled();
  });

  it('will skip catch boundaries once aborted, even for an error already on its way', async () => {
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

    pending.reject(new Error('failed'));
    await flushMicrotasks();
    controller.abort('stop');

    await expect(rendering).rejects.toBe('stop');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(handled).not.toHaveBeenCalled();
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

describe('diagnostics', () => {
  const warn = mockWarn();

  it('will warn for a flag that matches no rule', async () => {
    function Badge() {
      return <i _smal />;
    }

    style(Badge, { _small: { color: 'red' } });
    await renderToString(<Badge />);

    expect(warn.mock.calls).toEqual([['"_smal" matches no rule in Badge. Did you mean "_small"?']]);
  });
});
