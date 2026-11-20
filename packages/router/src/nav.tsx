import { Component, get } from '@expressive/mvc';

import { Link } from './link';
import { allRoutes, exempt, lexicalRoutes, Route, scopeResolves } from './route';
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

interface Node extends NavLinks.Entry {
  base: string;
  page: boolean;
  skip: boolean;
  scope?: Component.Node;
  inner: Node[];
}

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

    return this.branch(entries(route, effective(route), route.base + patternSegment(route.to)));
  }

  branch(nodes: Node[]): Component.Node {
    const { Item, List, Group } = this;
    const { router } = this.route;

    return (
      <List>
        {nodes.map((node, i) => {
          if (node.skip) return null;

          const inner = node.inner.length ? this.branch(node.inner) : null;

          return node.page || !inner ? (
            <Entry key={i} route={node} router={router} Item={Item}>
              {inner}
            </Entry>
          ) : (
            <Group key={i} route={node}>{inner}</Group>
          );
        })}
      </List>
    );
  }
}

function effective(route: Route): Component.Node {
  return (route as unknown as { children: Component.Node }).children;
}

function entries(route: Route | undefined, children: Component.Node, base: string): Node[] {
  if (route?.inner.length)
    return route.inner.map((child) => node(child.base, child.to, child, effective(child), child));

  return lexicalRoutes(children).map(({ props, to }) => node(base, to, undefined, props.children, props));
}

type Declared = { label?: string; meta?: Record<string, any>; as?: unknown; redirect?: unknown; none?: boolean };

function node(base: string, to: string, route: Route | undefined, children: Component.Node, props: Declared): Node {
  const path = base + patternSegment(to);

  return {
    path,
    to,
    label: props.label,
    meta: props.meta,
    base,
    page: !!props.as,
    skip: exempt(props) || !!props.redirect,
    scope: allRoutes(children) ? children : undefined,
    inner: entries(route, children, path)
  };
}

type ItemType = (props: { route: NavLinks.Entry; active: boolean; label?: string; meta: NavLinks.Entry['meta'] }) => Component.Node;

/**
 * Per-item reactive wrapper. `router` arrives as a prop and becomes a managed
 * property, so the match read in render subscribes to navigation - same idiom
 * as `Route.router`, no host hook involved.
 */
class Entry extends Component {
  route?: Node = undefined;
  router?: Router = undefined;
  Item?: ItemType = undefined;

  /** Entry never suspends itself; no boundary here - a suspending custom
   * `Item` bubbles to NavLinks (or above) rather than blanking one row. */
  fallback = false;

  render() {
    const route = this.route!;
    const Item = this.Item!;
    const { match, path } = this.router!;
    const active = route.scope ? scopeResolves(route.scope, route.path, path) : !!match(route.base, route.to);

    return (
      <>
        <Item route={route} active={active} label={route.label} meta={route.meta} />
        {this.props.children}
      </>
    );
  }
}

export { NavLinks };
