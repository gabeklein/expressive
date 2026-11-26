import { unbind } from '@expressive/mvc';
import type { Component, Model } from '@expressive/mvc';

import { authoring, authorOf } from '../node/vnode';
import type { Node as RenderNode } from '../node/vnode';
import { door } from '../style/claim';
import { unmatched } from '../style/diagnose';
import type { Appearance, Style } from '../style/claim';
import { enterAppearance } from '../style/protocol';
import { owner } from './adapter';
import { latest } from './hot';

/** A rendering component as the style engine tracks it - a host keeps one per mounted component. */
interface Rendered {
  kind: string;
  type?: unknown;
  props?: Record<string, any>;
  instance?: object;
  appearance?: Appearance;
  consumed?: boolean;
  dev?: object;
  /** Owner and key of a subcomponent whose `type` is a host's wrapper rather than the bound method. */
  method?: { owner: Model; key: string };
}

let rendering: object | undefined;

let touched = false;

const observed = new WeakMap<object, Record<string, any>>();
const outputs = new WeakSet<object>();
const bare = new WeakMap<Rendered, Appearance>();

function observe(props: Record<string, any>) {
  if (!('style' in props) || outputs.has(props)) return props;

  let output = observed.get(props);

  if (!output) {
    const { style } = props;
    let handle: Style;
    let resolved = false;

    output = Object.defineProperty({ ...props }, 'style', {
      enumerable: true,
      get() {
        if (rendering === output) touched = true;
        if (!resolved) {
          handle = door(style);
          resolved = true;
        }
        return handle;
      }
    });
    observed.set(props, output);
    outputs.add(output);
  }

  return output;
}

function consume(fiber: Rendered, render: () => RenderNode) {
  const previous = rendering;
  const read = touched;

  rendering = fiber.props;
  touched = false;

  try {
    const output = authoring(fiber, render);
    fiber.consumed = touched;
    return output;
  } finally {
    rendering = previous;
    touched = read;
  }
}

function renderedAppearance(fiber: Rendered): Appearance | undefined {
  if (fiber.kind != 'component' && fiber.kind != 'function') return fiber.appearance;

  const style = fiber.props?.style as Style;
  const entries = (fiber.appearance?.entries || []).map(({ hops, style }) => ({ hops: hops + 1, style }));
  const sub = fiber.method || owner(fiber.type);
  const { instance } = fiber;
  let context = sub
    ? enterAppearance(latest(sub.owner.constructor), sub.key)
    : enterAppearance(latest(fiber.type as Function));

  if (instance)
    context = enterAppearance(unbind((instance as Component).render), undefined, context);

  unmatched(fiber.dev, fiber.props!, [fiber.appearance?.lexical, context], fiber.appearance?.author, instance);

  if (context?.base)
    entries.push({ hops: 0, style: context.base as Style });

  if (style && !fiber.consumed && !(instance && 'style' in instance)) entries.push({ hops: 0, style });

  if (entries.length || context) return { author: fiber, context, entries };

  let empty = bare.get(fiber);
  if (!empty) bare.set(fiber, (empty = { author: fiber, entries }));
  return empty;
}

function authored(value: RenderNode, appearance: Appearance | undefined): Appearance | undefined {
  return authorAppearance(authorOf(value), appearance);
}

/**
 * Appearance for an element `author` wrote, placed under `appearance` - children passed in keep their author's rules.
 *
 * For hosts with their own reconciler, which record authors themselves.
 */
function authorAppearance(author: object | undefined, appearance: Appearance | undefined): Appearance | undefined {
  if (!author || !appearance || author === appearance.author) return appearance;

  for (let fiber = appearance.author as Rendered | undefined; fiber; fiber = fiber.appearance?.author as Rendered | undefined)
    if (fiber.appearance?.author === author)
      return { author, context: fiber.appearance.lexical, entries: appearance.entries };

  return appearance;
}

/**
 * Run a component's render under style tracking; returns its output and the appearance that output renders under.
 *
 * Replaces `fiber.props` with a copy that notes a read of `style` - a component reading it takes over forwarding. `render` should read `fiber.props` when called.
 */
function renderComponent<T>(fiber: Rendered, render: () => T) {
  fiber.props &&= observe(fiber.props);

  const output = consume(fiber, render as () => RenderNode) as T;

  return { output, appearance: renderedAppearance(fiber) };
}

export { authorAppearance, authored, consume, observe, renderComponent, renderedAppearance };
export type { Rendered };
