import { Component, get } from '@expressive/mvc';

import { Link } from './link';
import { allRoutes, lexicalRoutes, Route, scopeBase, scopeResolves } from './route';
import type { Router } from './router';
import { patternSegment } from './url';

declare namespace NavLinks {
  /**
   * A route as NavLinks lists it.
   *
   * Read from the declared `<Route>` JSX until that route mounts, then from the mounted Route -
   * so the first render, on a server too, lists routes declared after the NavLinks.
   */
  interface Entry {
    /** Absolute path, as `Route.path`. */
    path: string;
    /** The route's own `to` segment. */
    to: string;
    label?: string;
    meta?: Record<string, any>;
  }
}

interface Listing {
  entry: NavLinks.Entry;
  base: string;
  page: boolean;
  skip: boolean;
  scope?: Component.Node;
  inner: Listing[];
}

const DECLARES = ['to', 'as', 'label', 'none', 'redirect'];

type Declared = { label?: string; meta?: Record<string, any>; as?: unknown; redirect?: unknown; none?: boolean };

class NavLinks extends Component {
  route = get(Route);

  List(props: { children?: Component.Node }): Component.Node {
    return <ul>{props.children}</ul>;
  }

  Item(props: { route: NavLinks.Entry; active: boolean; label?: string; meta: NavLinks.Entry['meta'] }): Component.Node {
    const { route, active, label } = props;
    return (
      <Link to={route.path} aria-current={active ? 'page' : undefined}>
        {label ?? route.path}
      </Link>
    );
  }

  /**
   * Renders an anonymous (group) node. Default is transparent - flattens by
   * passing children through. Override to wrap a group in a heading/section
   * (the node's `label`/`meta` describe it), turning tree structure into nav
   * sections with no explicit navigation layer.
   */
  Group(props: { route: NavLinks.Entry; children?: Component.Node }): Component.Node {
    return props.children;
  }

  render(): Component.Node {
    const { route } = this;

    return this.branch(listings(route, effective(route), scopeBase(route)));
  }

  protected branch(listings: Listing[]): Component.Node {
    const { Item, List, Group } = this;
    const { router } = this.route;

    return (
      <List>
        {listings.map((listing, i) => {
          if (listing.skip) return null;

          const inner = listing.inner.length ? this.branch(listing.inner) : null;

          return listing.page || !inner ? (
            <Row key={i} listing={listing} router={router} Item={Item}>
              {inner}
            </Row>
          ) : (
            <Group key={i} route={listing.entry}>{inner}</Group>
          );
        })}
      </List>
    );
  }
}

function effective(route: Route): Component.Node {
  return (route as unknown as { children: Component.Node }).children;
}

function rendersOwn(type: typeof Route): boolean {
  for (let T = type; T !== Route; T = Object.getPrototypeOf(T))
    if (Object.prototype.hasOwnProperty.call(T.prototype, 'render')) return true;

  return false;
}

function listings(route: Route | undefined, children: Component.Node, base: string): Listing[] {
  if (route?.inner.length)
    return route.inner.map((child) =>
      listing(child.base, child.to, child, effective(child), child, rendersOwn(child.constructor as typeof Route)));

  return lexicalRoutes(children)
    .filter(({ props, type }) => type === Route || DECLARES.some((key) => key in props))
    .map(({ props, to, type }) => listing(base, to, undefined, props.children, props, rendersOwn(type)));
}

function listing(base: string, to: string, route: Route | undefined, children: Component.Node, props: Declared, own: boolean): Listing {
  const path = base + patternSegment(to);
  const routes = allRoutes(children);

  return {
    entry: { path, to, label: props.label, meta: props.meta },
    base,
    page: !!props.as || own || (!routes && !!children),
    skip: !!props.none || !!props.redirect,
    scope: routes ? children : undefined,
    inner: listings(route, children, path)
  };
}

type ItemType = (props: { route: NavLinks.Entry; active: boolean; label?: string; meta: NavLinks.Entry['meta'] }) => Component.Node;

/**
 * Per-item reactive wrapper. `router` arrives as a prop and becomes a managed
 * property; `active` is a getter, so a row re-renders only when its own
 * match flips - same idiom as `Route.matched`, no host hook involved.
 */
class Row extends Component {
  listing?: Listing = undefined;
  router?: Router = undefined;
  Item?: ItemType = undefined;

  /** Row never suspends itself; no boundary here - a suspending custom
   * `Item` bubbles to NavLinks (or above) rather than blanking one row. */
  fallback = false;

  get active(): boolean {
    const { base, entry, scope } = this.listing!;
    const { match, path } = this.router!;

    return scope ? scopeResolves(scope, entry.path, path) : !!match(base, entry.to);
  }

  render() {
    const { entry } = this.listing!;
    const Item = this.Item!;

    return (
      <>
        <Item route={entry} active={this.active} label={entry.label} meta={entry.meta} />
        {this.props.children}
      </>
    );
  }
}

export { NavLinks };
