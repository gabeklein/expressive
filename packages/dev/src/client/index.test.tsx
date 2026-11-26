// @vitest-environment happy-dom
// @vitest-environment-options { "url": "http://localhost/" }

import { Component, Model, set } from "@expressive/mvc";
import { Link, Redirect } from "@expressive/router";
import type { BrowserRouter } from "@expressive/router";
import { NotFound, Redirect as Moved } from "@expressive/rpc";
import { afterEach, describe, expect, it } from "vitest";

import { browserRouter, location, mount, settle } from "../../test.setup";
import { Route, Router } from ".";

function Boom(): any {
  throw new Error("kaboom");
}
function Err({ error, retry }: { error: Error; retry: () => void }) {
  return <button onClick={retry}>caught: {error.message}</button>;
}

const click = (root: Element, label: string) => {
  const target = Array.from(root.querySelectorAll("a, button")).find(el => el.textContent === label);
  if (!target) throw new Error(`No control labelled "${label}"`);
  (target as HTMLElement).click();
  return settle();
};

it("renders page content when nothing throws", async () => {
  class Home extends Route {
    render() {
      return <span>home</span>;
    }
  }

  const root = await mount(Home);
  expect(root.textContent).toBe("home");
});

it("will handle an async new() redirect from the owning route", async () => {
  class Task extends Model {
    protected async new() {
      await null;
      throw new Moved("/login");
    }
  }
  class Secret extends Component {
    task = new Task();
    render() { return <p>secret</p>; }
  }
  location("/secret");
  const root = await mount(() => <Router><Route><Route to="secret" as={Secret} /><Route to="login" as={() => <p>login</p>} /></Route></Router>);
  await settle();
  expect(root.textContent).toBe("login");
  expect(window.location.pathname).toBe("/login");
});

it("will handle a NotFound reported by a route's async new()", async () => {
  class Missing extends Route {
    protected async new() {
      await null;
      throw new NotFound("missing");
    }
  }
  location("/");
  const root = await mount(() => <Router><Route Catch={Err}><Missing as={() => <p>page</p>} /></Route></Router>);
  await settle();
  expect(root.textContent).toBe("caught: missing");
});

it("renders the Catch UI when a child throws", async () => {
  class Crashing extends Route {
    Catch = Err;
    render() {
      return <Boom />;
    }
  }

  const root = await mount(Crashing);
  expect(root.textContent).toBe("caught: kaboom");
});

it("recovers when retry is invoked and the error has cleared", async () => {
  let boom = true;
  function MaybeThrows() {
    if (boom) throw new Error("kaboom");
    return <span>recovered</span>;
  }

  class Crashing extends Route {
    Catch = Err;
    render() {
      return <MaybeThrows />;
    }
  }

  const root = await mount(Crashing);
  expect(root.textContent).toBe("caught: kaboom");

  boom = false;
  await click(root, "caught: kaboom");

  expect(root.textContent).toBe("recovered");
});

it("will restore Loading after retry before a later suspension", async () => {
  let resolve!: () => void;
  const pending = new Promise<void>(done => (resolve = done));
  let retry!: () => void;
  let page!: Page;
  class Page extends Route {
    mode = 0;
    value = set(() => pending.then(() => "done"));
    render() {
      page = this;
      if (this.mode === 0) throw new Error("broken");
      return <p>{this.mode === 1 ? "ready" : this.value}</p>;
    }
  }
  const Catch = ({ retry: again }: { retry: () => void }) => { retry = again; return <p>caught</p>; };
  location("/");
  const root = await mount(() => <Route Catch={Catch} fallback={<p>loading</p>}><Route as={Page} /></Route>);
  expect(root.textContent).toBe("caught");
  page.mode = 1;
  retry();
  await settle();
  expect(root.textContent).toBe("ready");
  page.mode = 2;
  await settle();
  expect(root.textContent).toBe("loading");
  resolve();
  await settle();
  expect(root.textContent).toBe("done");
});

it("bubbles to an ancestor Catch when the throwing Page has none", async () => {
  class Inner extends Route {
    render() {
      return <Boom />;
    }
  }
  class Outer extends Route {
    Catch = Err;
    render() {
      return <Inner />;
    }
  }

  const root = await mount(Outer);
  expect(root.textContent).toBe("caught: kaboom");
});

describe("render-time HTTP errors", () => {
  const router = browserRouter() as unknown as { current: BrowserRouter };

  it("will show the folder Catch for NotFound with the original error and retry", async () => {
    const missing = new NotFound("Record missing");
    let caught: Error | undefined;
    let retry: (() => void) | undefined;
    const Catch = ({ error, retry: again }: { error: Error; retry: () => void }) => {
      caught = error;
      retry = again;
      return <p>missing</p>;
    };
    location("/record");
    const root = await mount(() => <Route Catch={Catch}><Route to="record" as={() => { throw missing; }} /></Route>);
    expect(root.textContent).toBe("missing");
    expect(caught).toBe(missing);
    expect(retry).toBeTypeOf("function");
  });

  it("will send a status-shaped error to Catch without navigating", async () => {
    const fake = Object.assign(new Error("fake"), { status: 302, location: "/login" });
    location("/record");
    const root = await mount(() => <Route Catch={Err}><Route to="record" as={() => { throw fake; }} /></Route>);
    expect(root.textContent).toBe("caught: fake");
    expect(window.location.pathname).toBe("/record");
  });

  it("will redirect an rpc Redirect during render and replace a cold entry", async () => {
    const Login = () => <p>login</p>;
    location("/secret");
    const before = window.history.length;
    const root = await mount(() => <Route Catch={Err}><Route to="login" as={Login} /><Route to="secret" as={() => { throw new Moved("/login"); }} /></Route>);
    expect(root.textContent).toBe("login");
    expect(window.location.pathname).toBe("/login");
    expect(window.history.length).toBe(before);
  });

  it("will push an rpc Redirect after in-app navigation", async () => {
    const Tree = () => <Route><Route as={() => <Link to="/secret">Go</Link>} /><Route to="login" as={() => <p>login</p>} /><Route to="secret" as={() => { throw new Moved("/login"); }} /></Route>;
    location("/");
    const root = await mount(Tree);
    const before = window.history.length;
    await click(root, "Go");
    await settle();
    expect(root.textContent).toBe("login");
    expect(window.history.length).toBe(before + 1);
  });

  it("will clear a caught NotFound when the path changes", async () => {
    const Tree = () => <Route Catch={Err}><Route to="missing" as={() => { throw new NotFound("gone"); }} /><Route to="home" as={() => <p>home</p>} /></Route>;
    location("/missing");
    const root = await mount(Tree);
    expect(root.textContent).toBe("caught: gone");
    router.current.goto("/home");
    await settle();
    expect(root.textContent).toBe("home");
  });

  it("will send a redirect caught after another redirect to Catch", async () => {
    const Tree = () => <Route><Route to="a" as={() => { throw new Moved("/b"); }} /><Route to="b" Catch={Err} as={() => { throw new Moved("/a"); }} /></Route>;
    location("/a");
    const root = await mount(Tree);
    await settle();
    expect(root.textContent).toContain("caught: /a");
  });
});

describe("missing-path routes", () => {
  browserRouter();

  const Home = () => <span>home</span>;
  const Missing = () => <span>missing</span>;

  const Tree = () => (
    <Route>
      <Route as={Home} />
      <Route none as={Missing} />
    </Route>
  );

  it("matched URL renders the lexical child", async () => {
    location("/");
    expect((await mount(Tree)).textContent).toBe("home");
  });

  it("unmatched URL falls through to the injected NotFound", async () => {
    location("/nope");
    expect((await mount(Tree)).textContent).toBe("missing");
  });
});

// A user-authored page (`export class Page extends Route`) passed to the generated
// outer node's `as`. The inner Route delegates: it becomes the scope arbiter and sees
// the outer's computed `children` (incl. injected NotFound).
describe("user Page delegated via `as`", () => {
  browserRouter();

  const Child = () => <p>child</p>;
  const Missing = () => <p>missing</p>;

  class UserPage extends Route {
    render() {
      return <section data-user>{this.children}</section>;
    }
  }

  const Tree = () => (
    <Route as={UserPage}>
      <Route to="sub" as={Child} />
      <Route none as={Missing} />
    </Route>
  );

  it("inner renders its own chrome and owns the matched child", async () => {
    location("/sub");
    const root = await mount(Tree);
    expect(root.querySelector("[data-user]")?.textContent).toBe("child");
  });

  it("sees the outer's injected NotFound (outer children flows into inner)", async () => {
    location("/nope");
    const root = await mount(Tree);
    expect(root.querySelector("[data-user]")?.textContent).toBe("missing");
  });

  it("resolves the user class identity via .get()", async () => {
    let resolved: unknown;
    const Probe = () => { resolved = UserPage.get(); return null; };
    const T = () => (
      <Route as={UserPage}>
        <Route to="x" as={Probe} />
      </Route>
    );

    location("/x");
    await mount(T);

    expect(resolved).toBeInstanceOf(UserPage);
  });
});

// Routes the filesystem can't spell - computed from data at runtime. A `children`
// override maps a collection to child routes, composing `super.children` so the
// generated index/NotFound still apply.
describe("dynamically generated routes", () => {
  browserRouter();

  const SECTIONS = ["alpha", "beta"];

  class DocsPage extends Route {
    protected get children() {
      return (
        <>
          {super.children}
          {SECTIONS.map(slug => (
            <Route key={slug} to={slug} as={() => <article>doc:{slug}</article>} />
          ))}
        </>
      );
    }
  }

  const Tree = () => (
    <Route>
      <Route to="docs" as={DocsPage}>
        <Route as={() => <p>docs-index</p>} />
        <Route none as={() => <p>missing</p>} />
      </Route>
    </Route>
  );

  it("exact scope renders the (composed) index", async () => {
    location("/docs");
    expect((await mount(Tree)).textContent).toBe("docs-index");
  });

  it("each computed slug resolves to its generated route", async () => {
    location("/docs/beta");
    expect((await mount(Tree)).textContent).toBe("doc:beta");
  });

  it("a slug outside the collection falls through to NotFound", async () => {
    location("/docs/gamma");
    expect((await mount(Tree)).textContent).toBe("missing");
  });
});

// Auth gate: a guard Page protects its subtree, redirecting unauthenticated access.
describe("route guard / auth gate", () => {
  browserRouter();

  let authed = false;
  afterEach(() => { authed = false; });

  const Secret = () => <p>secret</p>;
  const Login = () => <p>login</p>;

  class Guard extends Route {
    render() {
      if (!authed) throw new Redirect("/login");

      return <>{this.children}</>;
    }
  }

  const Tree = () => (
    <Route>
      <Route to="login" as={Login} />
      <Route to="admin" as={Guard}>
        <Route as={Secret} />
      </Route>
    </Route>
  );

  it("redirects unauthenticated access away from the protected scope", async () => {
    location("/admin");
    const root = await mount(Tree);
    expect(root.textContent).toBe("login");
  });

  it("redirects past a Catch rather than into it", async () => {
    const Err = ({ error }: { error: Error }) => <p>caught: {error.message}</p>;
    const Moved = () => { throw new Redirect("/login"); };
    const Caught = () => (
      <Route>
        <Route to="login" as={Login} />
        <Route to="admin" as={Moved} Catch={Err} />
      </Route>
    );

    location("/admin");
    const root = await mount(Caught);
    expect(root.textContent).toBe("login");
  });

  it("renders the protected content once authenticated", async () => {
    authed = true;
    location("/admin");
    const root = await mount(Tree);
    expect(root.textContent).toBe("secret");
  });
});

// The generated form of the guard: a verdict function rides as the Route `redirect` prop.
describe("redirect guard prop", () => {
  browserRouter();

  const Secret = () => <p>secret</p>;
  const Login = () => <p>login</p>;
  const Missing = () => <p>missing</p>;

  it("string verdict redirects away", async () => {
    const Tree = () => (
      <Route>
        <Route to="login" as={Login} />
        <Route to="admin" as={Secret} redirect={() => "/login"} />
      </Route>
    );
    location("/admin");
    expect((await mount(Tree)).textContent).toBe("login");
  });

  it("falsy verdict allows normal render", async () => {
    const Tree = () => (
      <Route>
        <Route to="admin" as={Secret} redirect={() => undefined} />
      </Route>
    );
    location("/admin");
    expect((await mount(Tree)).textContent).toBe("secret");
  });

  it("null verdict force-404s to the section Catch (no navigation)", async () => {
    const Tree = () => (
      <Route>
        <Route to="admin" as={Secret} redirect={() => null} />
        <Route none as={Missing} />
      </Route>
    );
    location("/admin");
    expect((await mount(Tree)).textContent).toBe("missing");
    expect(window.location.pathname).toBe("/admin");
  });
});

describe("default entry hook via `enter`", () => {
  browserRouter();

  const Secret = () => <p>secret</p>;
  const Login = () => <p>login</p>;

  it("hook receives its Route, reads params, allows on falsy", async () => {
    const seen: { id?: string } = {};
    const hook = (route: Route) => {
      seen.id = route.match?.id;
    };
    const Tree = () => (
      <Route>
        <Route to=":id" as={Secret} enter={hook} />
      </Route>
    );

    location("/ok");
    const root = await mount(Tree);

    expect(seen.id).toBe("ok");
    expect(root.textContent).toBe("secret");
  });

  it("verdict derived from params redirects", async () => {
    const hook = (route: Route) => (route.match?.id === "block" ? "/login" : undefined);
    const Tree = () => (
      <Route>
        <Route to="login" as={Login} />
        <Route to=":id" as={Secret} enter={hook} />
      </Route>
    );

    location("/block");
    expect((await mount(Tree)).textContent).toBe("login");
  });

  it("a hook loaded on demand redirects once its module arrives", async () => {
    const hook = (route: Route) => Promise.resolve({ default: () => "/login" }).then(m => m.default());
    const Tree = () => (
      <Route>
        <Route to="login" as={Login} />
        <Route to="secret" as={Secret} enter={hook} fallback={null} />
      </Route>
    );

    location("/secret");
    const root = await mount(Tree);
    await settle();
    expect(root.textContent).toBe("login");
  });

  it("will run the hook a loader resolves", async () => {
    let ran = false;
    const hook = () => Promise.resolve(() => {
      ran = true;
      return "/login";
    });
    const Tree = () => (
      <Route>
        <Route to="login" as={Login} />
        <Route to="secret" as={Secret} enter={hook as never} fallback={null} />
      </Route>
    );

    location("/secret");
    const root = await mount(Tree);
    await settle();

    expect(ran).toBe(true);
    expect(root.textContent).toBe("login");
  });

  it("will redirect where a hook's thrown 3xx error points", async () => {
    const hook = (): undefined => {
      throw new Moved("/login");
    };
    const Tree = () => (
      <Route>
        <Route to="login" as={Login} />
        <Route to="secret" as={Secret} enter={hook} />
      </Route>
    );

    location("/secret");
    const root = await mount(Tree);
    await settle();

    expect(root.textContent).toBe("login");
    expect(window.location.pathname).toBe("/login");
  });

  it("will redirect where a hook's rejected 3xx error points", async () => {
    const hook = () => Promise.reject(new Moved("/login", 303));
    const Tree = () => (
      <Route>
        <Route to="login" as={Login} />
        <Route to="secret" as={Secret} enter={hook} fallback={null} />
      </Route>
    );

    location("/secret");
    const root = await mount(Tree);
    await settle();

    expect(root.textContent).toBe("login");
    expect(window.location.pathname).toBe("/login");
  });

  it("will throw a hook's error that is not a redirect to its Catch", async () => {
    const hook = (): undefined => {
      throw Object.assign(new Error("Not yours"), { status: 403, location: "/login" });
    };
    const Tree = () => (
      <Route Catch={Err} fallback={null}>
        <Route to="login" as={Login} />
        <Route to="secret" as={Secret} enter={hook} />
      </Route>
    );

    location("/secret");
    const root = await mount(Tree);
    await settle();

    expect(root.textContent).toBe("caught: Not yours");
  });

  it("will throw a redirect with no location to its Catch", async () => {
    const hook = (): undefined => {
      throw new Moved("");
    };
    const Tree = () => (
      <Route Catch={Err} fallback={null}>
        <Route to="secret" as={Secret} enter={hook} />
      </Route>
    );

    location("/secret");
    const root = await mount(Tree);
    await settle();

    expect(root.textContent).toBe("caught: ");
  });

  it("clearing the hook clears the guard", async () => {
    const route = Route.new({ enter: () => "/login" });
    expect(route.redirect).toBeTypeOf("function");
    route.enter = undefined;
    expect(route.redirect).toBeUndefined();
    route.set(null);
  });
});

describe("nav cycle: async guard <-> class Page", () => {
  browserRouter();

  let caught = "";

  const Layout = (p: { children?: any }) => (
    <main>
      <nav><Link to="/blog/hello">Hello</Link> | <Link to="/admin">Admin</Link></nav>
      {p.children}
    </main>
  );
  const Boundary = ({ error }: { error: Error; retry: () => void }) => { caught = error.message; return <p>broke</p>; };
  const BlogIndex = () => <h1>blog index</h1>;
  class BlogSlug extends Route { render() { return <h1>post {this.match!.slug}</h1>; } }
  const Admin = () => <h1>admin area</h1>;
  const guard = async () => { await Promise.resolve(); return undefined; };

  const Tree = () => (
    <Route as={Layout} Catch={Boundary}>
      <Route to="blog">
        <Route as={BlogIndex} />
        <Route to=":slug" as={BlogSlug} />
      </Route>
      <Route to="admin" as={Admin} redirect={guard} />
    </Route>
  );

  it("survives admin → /blog/hello → admin → /blog/hello", async () => {
    location("/admin");
    const root = await mount(Tree);
    for (const label of ["Hello", "Admin", "Hello"]) await click(root, label);

    expect(caught).toBe("");
    expect(root.querySelector("h1")?.textContent).toBe("post hello");
  });
});

describe("loaders", () => {
  browserRouter();

  it("renders a page whose module loads on demand", async () => {
    const Page = () => <span>loaded</span>;
    const Lazy = () => Promise.resolve({ Page }).then(m => m.Page);

    const Tree = () => (
      <Route>
        <Route to="lazy" as={Lazy} fallback={<span>waiting</span>} />
      </Route>
    );

    location("/lazy");
    const root = await mount(Tree);
    await settle();
    expect(root.textContent).toBe("loaded");
  });
});

describe("Loading in a route's slot", () => {
  browserRouter();

  it("shows while a page class waits on its data", async () => {
    let resolve!: (value: string) => void;
    const pending = new Promise<string>(done => (resolve = done));

    class Page extends Route {
      value = set(() => pending);

      render() {
        return <p>{this.value}</p>;
      }
    }

    const Tree = () => (
      <Route>
        <Route to="x" as={Page} fallback={<span>loading</span>} />
      </Route>
    );

    location("/x");
    const root = await mount(Tree);
    expect(root.textContent).toBe("loading");

    resolve("ready");
    await settle();
    expect(root.textContent).toBe("ready");
  });

  it("shows inside the parent Layout while a child page loads", async () => {
    let resolve!: () => void;
    const pending = new Promise<void>(done => (resolve = done));
    const Lazy = () => pending.then(() => () => <span>child</span>);
    const Layout = (props: { children?: any }) => <div>layout:{props.children}</div>;

    const Tree = () => (
      <Route>
        <Route to="sec" as={Layout} fallback={null}>
          <Route to="leaf" as={Lazy} fallback={<span>loading</span>} />
        </Route>
      </Route>
    );

    location("/sec/leaf");
    const root = await mount(Tree);
    expect(root.textContent).toBe("layout:loading");

    resolve();
    await settle();
    expect(root.textContent).toBe("layout:child");
  });
});
