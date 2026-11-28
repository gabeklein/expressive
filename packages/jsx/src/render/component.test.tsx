import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Component, Context, has, Model, pending } from '@expressive/mvc';
import { placement } from '@expressive/mvc/host';

import { Portal } from '../node/vnode';
import { flushMicrotasks, mockError, mockPromise, mount, place, render, until } from '../../test.setup';

const error = mockError();

describe('component', () => {
  it('will run an effect from new() once inserted', async () => {
    const effect = vi.fn();

    class App extends Component {
      protected new() {
        this.get(effect);
      }

      render() {
        return <b>app</b>;
      }
    }

    mount(App);

    expect(effect).not.toBeCalled();

    await flushMicrotasks();
    expect(effect).toBeCalledTimes(1);
  });

  it('will run effects after descendants, as any parent commits', async () => {
    const order: string[] = [];

    class Inner extends Component {
      protected new() {
        this.get(() => void order.push('child'));
      }

      render() {
        return <i>inner</i>;
      }
    }

    class Outer extends Component {
      protected new() {
        this.get(() => void order.push('parent'));
      }

      render() {
        return <Inner />;
      }
    }

    mount(Outer);

    await flushMicrotasks();
    expect(order).toEqual(['child', 'parent']);
  });

  it('will hold a constructed class until the provider is inserted', async () => {
    const effect = vi.fn();

    class Owned extends Model {
      protected new() {
        this.get(effect);
      }
    }

    place(<Component for={Owned} />);

    expect(effect).not.toBeCalled();

    await flushMicrotasks();
    expect(effect).toBeCalledTimes(1);
  });

  it('will destroy owned Components when their context pops', () => {
    let child!: Child;

    class Child extends Component {}
    class Parent extends Component {
      render() {
        return <Child is={(c) => void (child = c)} />;
      }
    }

    const [parent] = mount(Parent);

    Context.get(parent).pop();

    expect(child.get(null)).toBe(true);
    expect(parent.get(null)).toBe(true);
  });

  it('will retain a class Component when its VNode props object is unchanged', async () => {
    class Child extends Component {
      label = '';
      render() {
        return <span>{this.label}</span>;
      }
    }

    const child = <Child label="fixed" />;

    class Parent extends Component {
      tick = 0;
      render() {
        this.tick;
        return child;
      }
    }

    const [parent, root] = mount(Parent);
    const span = root.querySelector('span');
    parent.tick++;
    await flushMicrotasks();

    expect(root.querySelector('span')).toBe(span);
  });

  it('will place an external Component and collection without owning them', async () => {
    const cleanup = vi.fn();

    class Message extends Component {
      protected new() {
        this.get(() => cleanup);
      }

      render() {
        return <span>message</span>;
      }
    }

    const message = Message.new();
    const first = new has.List(['first']);
    const second = new has.List(['second']);

    class Parent extends Component {
      tick = 0;
      useSecond = false;

      render() {
        return <><small>{this.tick}</small>{message}{this.useSecond ? second : first}</>;
      }
    }

    const [parent, root, release] = mount(Parent);
    parent.tick++;
    await flushMicrotasks();
    expect(root.textContent).toBe('1messagefirst');

    parent.useSecond = true;
    await flushMicrotasks();
    expect(root.textContent).toBe('1messagesecond');

    release();
    expect(message.get(null)).toBe(false);
    expect(cleanup).not.toHaveBeenCalled();
    message.set(null);
  });
});

describe('transition', () => {
  class Nav extends Model {
    page = 'a';
  }

  const stale = vi.fn();

  function Stale() {
    return stale();
  }

  function Inner() {
    return Nav.get().page == 'b' ? <Stale /> : null;
  }

  function Next() {
    return Nav.get().page == 'b' ? <p>B</p> : null;
  }

  beforeEach(() => stale.mockClear());

  async function leave(Outer: (() => Component.Node) | (new () => Component)) {
    class App extends Component {
      nav = new Nav();

      render() {
        return <><Outer /><Next /></>;
      }
    }

    const [app, root, release] = mount(App);

    try {
      pending(() => (app.nav.page = 'b'));
      await until(() => expect(root.textContent).toBe('B'));
      expect(stale).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      release();
    }
  }

  it('will update an empty scope after one around it leaves, with no DOM globals', async () => {
    vi.stubGlobal('Node', undefined);

    try {
      await leave(() => Nav.get().page == 'a' ? <div><Inner /></div> : null);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('will update an empty scope in a fallback after its suspended owner leaves', async () => {
    const waiting = mockPromise<void>();

    function Wait(): Component.Node {
      throw waiting;
    }

    class Outer extends Component {
      fallback = <Inner />;

      render() {
        return Nav.get().page == 'a' ? <Wait /> : null;
      }
    }

    await leave(Outer);
  });

  it('will update an empty scope in a portal after one around it leaves', async () => {
    const into = document.createElement('aside');

    await leave(() => Nav.get().page == 'a' ? <Portal into={into}><Inner /></Portal> : null);
  });
});

describe('class element', () => {
  it('will pass children through a Component without render', () => {
    class Bare extends Component {}
    const root = document.createElement('main');

    render(<div><Bare>text</Bare><Bare /></div>, root);
    expect(root.textContent).toBe('text');
  });

  it('will be owned by enclosing Component', () => {
    let inner!: Component;

    class Panel extends Component {
      render() {
        return null;
      }
    }

    class Outer extends Component {
      render() {
        return <Panel is={(panel) => void (inner = panel)} />;
      }
    }

    const [outer] = mount(Outer);

    expect(outer.get(Model, false)).toBeUndefined();
    expect(inner.get(Model)).toBe(outer);
  });

  it('will render a Component with a render method', async () => {
    const lifecycle: string[] = [];
    let panel!: Panel;

    class Panel extends Component {
      label = 'idle';
      count = 0;

      protected new() {
        this.get(() => {
          lifecycle.push('effect');
          return () => lifecycle.push('cleanup');
        });
      }

      render() {
        return <span>{this.label}:{this.count}</span>;
      }
    }

    const root = document.createElement('main');
    const release = render(<Panel label="busy" is={(value) => void (panel = value)} />, root);

    expect(root.textContent).toBe('busy:0');

    await flushMicrotasks();
    expect(lifecycle).toEqual(['effect']);

    panel.count = 2;
    await flushMicrotasks();
    expect(root.textContent).toBe('busy:2');

    release();
    expect(lifecycle).toEqual(['effect', 'cleanup']);
    expect(panel.get(null)).toBe(true);
  });

  it('will apply props to fields, reset dropped ones and pass the rest to render', async () => {
    class Panel extends Component {
      label?: string = 'default';

      render(props: { children?: Component.Node }) {
        return <b>{this.label ?? 'none'}{props.children}</b>;
      }
    }

    class App extends Component {
      label?: string = 'one';

      render() {
        return this.label ? <Panel label={this.label}>!</Panel> : <Panel>!</Panel>;
      }
    }

    const [app, root] = mount(App);
    expect(root.textContent).toBe('one!');

    app.label = 'two';
    await flushMicrotasks();
    expect(root.textContent).toBe('two!');

    app.label = undefined;
    await flushMicrotasks();
    expect(root.textContent).toBe('none!');
  });

  it('will provide a Model through Component for', async () => {
    class Session extends Model {
      name = 'Ada';
    }

    let session!: Session;

    function Leaf() {
      return <b>{Session.get().name}</b>;
    }

    function Sibling() {
      return <i>{Session.get(false) ? 'leak' : 'none'}</i>;
    }

    const root = document.createElement('main');
    const release = render(
      <>
        <Component for={Session} name="Grace" is={(value: Session) => void (session = value)}>
          <Leaf />
        </Component>
        <Sibling />
      </>,
      root
    );

    expect(root.textContent).toBe('Gracenone');

    session.name = 'Hopper';
    await flushMicrotasks();
    expect(root.textContent).toBe('Hoppernone');

    release();
    expect(session.get(null)).toBe(true);
  });


  it('will render a Component instance inline', async () => {
    class Panel extends Component {
      label = 'inline';
      render() {
        return <span>{this.label}</span>;
      }
    }

    const panel = Panel.new();
    const root = place(<div>{panel}</div>);
    expect(root.textContent).toBe('inline');

    panel.label = 'changed';
    await flushMicrotasks();
    expect(root.textContent).toBe('changed');
    expect(panel.get(null)).toBe(false);
  });

  it('will render and provide a Component instance around changing children', async () => {
    const calls = vi.fn();

    class Panel extends Component {
      label = 'first';

      render(props: { children?: Component.Node }) {
        calls(props.children);
        return <section>{this.label}:{props.children}</section>;
      }
    }

    function Read() {
      return <b>{Panel.get().label}</b>;
    }

    const panel = Panel.new();
    const root = document.createElement('main');
    class App extends Component {
      extra = false;

      render() {
        return <Component for={panel}>{this.extra && <i>new</i>}<Read /></Component>;
      }
    }

    const [app, , release] = mount(App, undefined, root);

    expect(root.textContent).toBe('first:first');
    expect(calls).toHaveBeenCalled();

    app.extra = true;
    await flushMicrotasks();
    expect(root.textContent).toBe('first:newfirst');

    release();
    expect(panel.get(null)).toBe(false);
  });

  it('will preserve placed field state and clear children on removal', async () => {
    class Panel extends Component {
      label = 'a';
      render(props: { children?: Component.Node }) {
        return <b>{this.label}{props.children}</b>;
      }
    }
    const panel = Panel.new({ label: 'a' });
    panel.label = 'b';
    const root = document.createElement('main');
    class App extends Component {
      child = 'one';
      active = true;
      render() {
        return this.active ? <Component for={panel}>{this.child}</Component> : null;
      }
    }
    const [app, , release] = mount(App, undefined, root);
    expect(root.textContent).toBe('bone');
    expect(panel.label).toBe('b');
    app.child = 'two';
    await flushMicrotasks();
    expect(root.textContent).toBe('btwo');
    expect(panel.label).toBe('b');
    app.active = false;
    await flushMicrotasks();
    expect(panel.props.children).toBeUndefined();
    const placed = place(<div>{panel}</div>);
    expect(placed.textContent).toBe('b');
    release();
  });

  it('will use the element fallback for a placed render and children', async () => {
    const gate = mockPromise<() => Component.Node>();
    const Lazy = () => gate;
    class Panel extends Component {
      render(props: { children?: Component.Node }) {
        return <section>{props.children}<Lazy /></section>;
      }
    }
    const panel = Panel.new();
    const root = place(<Component for={panel} fallback={<i>loading</i>}><Lazy /></Component>);
    expect(root.textContent).toBe('loading');
    gate.resolve(() => <b>ready</b>);
    await flushMicrotasks();
    expect(root.textContent).toBe('readyready');
  });

  it('will use the element catch for a placed render error', async () => {
    const caught = vi.fn();
    class Panel extends Component {
      broken = true;
      render(): Component.Node {
        if (this.broken) throw new Error('broken');
        return <b>ready</b>;
      }
    }
    const panel = Panel.new();
    const root = place(<Component<Panel> for={panel} fallback={<i>recovering</i>} catch={(error: Error, instance: Component) => { caught(error.message, instance); panel.broken = false; }} />);
    await flushMicrotasks();
    expect(caught).toHaveBeenCalledWith('broken', expect.any(Component));
    expect(root.textContent).toBe('ready');
  });

  it('will render subclass children when it has a for field', () => {
    class Panel extends Component {}
    class Slot extends Component {
      for?: Component;
    }
    const panel = Panel.new();
    const root = place(<Slot for={panel}>kids</Slot>);
    expect(root.textContent).toBe('kids');
  });

  it('will refresh a placed instance when its own render props change', async () => {
    class Panel extends Component {
      render(props: { tone?: string }) {
        return <b>{props.tone}</b>;
      }
    }
    const panel = Panel.new({ tone: 'a' });
    const root = place(<Component for={panel} />);
    expect(root.textContent).toBe('a');
    (panel as any).props = { tone: 'b' };
    await flushMicrotasks();
    expect(root.textContent).toBe('b');
  });

  it('will let the latest provider own shared children', async () => {
    class Panel extends Component {
      render(props: { children?: Component.Node }) {
        return <b>{props.children}</b>;
      }
    }
    const panel = Panel.new();
    const first = document.createElement('main');
    const second = document.createElement('main');
    const releaseFirst = render(<Component for={panel} fallback="first">one</Component>, first);
    const releaseSecond = render(<Component for={panel} fallback="second">two</Component>, second);
    expect(second.textContent).toBe('two');
    expect(first.textContent).toBe('one');
    releaseFirst();
    expect(second.textContent).toBe('two');
    releaseSecond();
    expect(placement(panel)).toBeUndefined();
  });

  it('will clear children after swapping Component, Model, then undefined', async () => {
    class Panel extends Component {
      render(props: { children?: Component.Node }) {
        return <b>{props.children}</b>;
      }
    }
    const panel = Panel.new();
    class Store extends Model {}
    const model = Store.new();
    const root = document.createElement('main');
    class App extends Component {
      step = 0;
      render() {
        return <Component for={this.step === 0 ? panel : this.step === 1 ? model : undefined}>kids</Component>;
      }
    }
    const [app, , release] = mount(App, undefined, root);
    expect(root.textContent).toBe('kids');
    app.step = 1;
    await flushMicrotasks();
    expect(panel.props.children).toBeUndefined();
    expect(root.textContent).toBe('kids');
    expect(place(<div>{panel}</div>).textContent).toBe('');
    app.step = 2;
    await flushMicrotasks();
    expect(root.textContent).toBe('kids');
    release();
  });

  it('will destroy an adopted Component and swap provided instances', async () => {
    class Panel extends Component {
      label = '';

      render(props: { children?: Component.Node }) {
        return <section>{this.label}{props.children}</section>;
      }
    }

    const first = new Panel();
    const second = Panel.new();
    const root = document.createElement('main');
    class App extends Component {
      swap = false;

      render() {
        return this.swap
          ? <Component for={second} label="two">next</Component>
          : <Component for={first} label="one">child</Component>;
      }
    }

    const [app, , release] = mount(App, undefined, root);

    expect(root.textContent).toBe('onechild');
    app.swap = true;
    await flushMicrotasks();

    expect(first.get(null)).toBe(true);
    expect(root.textContent).toBe('twonext');

    release();
    expect(second.get(null)).toBe(false);
  });

  it('will pass children through a provided Model instance', () => {
    class Plain extends Model {}
    const model = Plain.new();
    const root = place(<Component for={model}><b>child</b></Component>);

    expect(root.textContent).toBe('child');
    expect(model.get(null)).toBe(false);
  });

  it('will pass children through a provided Component without render', () => {
    class Bare extends Component {}
    const bare = Bare.new();
    const root = place(<Component for={bare}><b>child</b></Component>);

    expect(root.textContent).toBe('child');
  });


  it('will own a boundary from a fallback on the element', async () => {
    const loaded = mockPromise<() => Component.Node>();
    const Lazy = () => loaded;

    class Plain extends Component {
      render() {
        return <Lazy />;
      }
    }

    const root = place(<Plain fallback={<i>loading</i>} />);
    expect(root.textContent).toBe('loading');

    loaded.resolve(() => <b>ready</b>);
    await flushMicrotasks();
    expect(root.textContent).toBe('ready');
  });

  it('will keep a Component which suspends itself', async () => {
    const loaded = mockPromise<void>();
    const created = vi.fn();
    let ready = false;

    class Report extends Component {
      count = 1;

      new() {
        created();
      }

      render() {
        if (!ready) throw loaded;
        return <p>{this.count}</p>;
      }
    }

    const [report, root] = mount(Report, { fallback: <i>loading</i> });
    expect(root.textContent).toBe('loading');

    report.count = 2;
    ready = true;
    loaded.resolve();
    await flushMicrotasks();

    expect(root.textContent).toBe('2');
    expect(created).toHaveBeenCalledTimes(1);
  });

  it('will prefer an element fallback over the member, used when placed', () => {
    const Lazy = () => new Promise<never>(() => {});

    class Guarded extends Component {
      fallback: Component.Node = <i>member</i>;

      render() {
        return <Lazy />;
      }
    }

    const root = place(<Guarded fallback={<i>element</i>} />);
    expect(root.textContent).toBe('element');

    const other = place(<><Guarded /><div>{Guarded.new() as never}</div></>);
    expect(other.textContent).toBe('membermember');
  });

  it('will call an element catch with the error and instance', async () => {
    const caught = vi.fn();
    let plain!: Plain;

    class Plain extends Component {
      broken = true;

      render() {
        if (this.broken) throw new Error('broken');
        return <p>fixed</p>;
      }
    }

    const root = place(
      <Plain
        is={(value) => void (plain = value)}
        fallback={<i>recovering</i>}
        catch={(error: Error, instance: Plain) => {
          caught(error.message, instance);
          instance.broken = false;
        }}
      />
    );

    expect(caught).toHaveBeenCalledWith('broken', plain);
    expect(root.textContent).toBe('recovering');

    await flushMicrotasks();
    expect(root.textContent).toBe('fixed');
  });

  it('will not own a boundary from fallback on a function component', () => {
    const received = vi.fn();
    const Lazy = () => new Promise<never>(() => {});

    function View(props: { fallback?: string }) {
      received(props.fallback);
      return <Lazy />;
    }

    class Outer extends Component {
      fallback = <i>outer</i>;

      render() {
        return <View fallback="inner" />;
      }
    }

    const root = place(<Outer />);
    expect(received).toHaveBeenCalledWith('inner');
    expect(root.textContent).toBe('outer');
  });

  it('will render a PascalCase function field as a plain function component', async () => {
    const First = ({ text }: { text: string }) => <b>{text}</b>;
    const Second = ({ text }: { text: string }) => <i>{text}</i>;

    class Panel extends Component {
      Badge = First;

      render() {
        return <this.Badge text="x" />;
      }
    }

    const [panel, root] = mount(Panel);
    expect(root.querySelector('b')?.textContent).toBe('x');
    expect(panel.Badge).toBe(First);

    panel.Badge = Second;
    await flushMicrotasks();
    expect(root.querySelector('i')?.textContent).toBe('x');
  });

  it('will render a Component class held in a PascalCase field', async () => {
    class Badge extends Component {
      text = '';

      render() {
        return <b>{this.text}</b>;
      }
    }

    class Panel extends Component {
      Badge = Badge;

      render() {
        return <this.Badge text="x" />;
      }
    }

    const [panel, root] = mount(Panel);
    expect(panel.Badge).toBe(Badge);
    expect(root.querySelector('b')?.textContent).toBe('x');
  });

  it('will reconcile keyed Components', async () => {
    class Item extends Component {
      value = '';
      render() {
        return <li>{this.value}</li>;
      }
    }

    class App extends Component {
      items = ['a', 'b'];
      render() {
        return <ul>{this.items.map((value) => <Item key={value} value={value} />)}</ul>;
      }
    }

    const [app, root] = mount(App);
    expect(root.textContent).toBe('ab');

    app.items = ['b', 'c'];
    await flushMicrotasks();
    expect(root.textContent).toBe('bc');
  });
});
