import { Component } from '@expressive/mvc';
import React from 'react';
import { Context } from './context';

interface Entry {
  committed?: boolean;
  context: Context;
  commit: () => void;
  remove: () => void;
};

/** In-flight render attempts by tree position, per ambient context.
 *  When one commits, older uncommitted attempts at its slot are provably dead. */
const SLOTS = new WeakMap<Context, Map<string, Set<Entry>>>();

/**
 * React's attempt lifecycle: fiber-keyed stacking so a superseded (uncommitted)
 * render attempt at a tree position is discarded when a later one commits.
 */
export function dedupe(on: Component, context: Context) {
  let slots = SLOTS.get(context.parent!);
  if (!slots) SLOTS.set(context.parent!, (slots = new Map()));

  // key/index path to root: stable across render attempts of this element
  let slot = '';
  for (let f = (on as any)._reactInternals; f; f = f.return)
    slot += (f.key ?? f.index) + '.';

  let list = slots.get(slot);
  if (!list) slots.set(slot, (list = new Set()));

  const entry: Entry = {
    context,
    commit() {
      entry.committed = true;

      for (const e of list) {
        if (e === entry) break;
        if (e.committed) continue;
        e.context.pop();
        list.delete(e);
      }
    },
    remove() {
      list.delete(entry);
    }
  };

  list.add(entry);
  return entry;
};

const REDIRECT = Symbol.for('@expressive/router#redirect');
const HOLD = Symbol.for('@expressive/router#hold-redirect');

export class ErrorBoundary extends React.Component<{
  self: Component;
  children: React.ReactNode;
}> {
  state = {} as { error?: Error };
  recovering = false;
  mounted = false;
  redirect?: { error: Error; pending: Promise<void> };

  constructor(props: ErrorBoundary['props']) {
    super(props);
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    this.handle(error);
  }

  handle(error: Error) {
    const { self } = this.props;
    const { fallback } = self;
    const reset = (error?: Error) => {
      this.recovering = true;
      this.setState({ error });
    };

    return Promise.resolve((self.props.catch || self.catch)!.call(self, error, self.is))
      .then(() => reset(), reset)
      .finally(() => self.set({ fallback }, true));
  }

  componentDidMount() {
    this.mounted = true;
  }

  componentDidUpdate() {
    this.recovering = false;
  }

  componentWillUnmount() {
    this.mounted = false;
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.recovering) throw this.state.error;

    const { error } = this.state;
    if (this.mounted && (error as Error & { [REDIRECT]?: boolean })[REDIRECT] &&
        (this.props.self as Component & { [HOLD]?: boolean })[HOLD]) {
      if (this.redirect?.error !== error)
        this.redirect = { error, pending: Promise.resolve().then(() => this.handle(error)) };
      throw this.redirect.pending;
    }

    return this.props.self.fallback;
  }
};
