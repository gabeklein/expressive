/**
 * Per-adapter interpretation manifest. Each adapter augments this interface to
 * declare how it renders; the first member is `node` - the element type produced
 * by `Component.render` (surfaced as `Component.Node`) - alongside `intrinsics`,
 * the host's tag map (surfaced as `JSX.IntrinsicElements`), `elementClass`,
 * the instance a class must construct to render as an element, and optionally
 * `element`, further element types the host renders (joined into
 * `JSX.ElementType`).
 *
 * ```ts
 * declare module '@expressive/mvc/jsx-runtime' {
 *   interface Host {
 *     node: React.ReactNode;
 *     intrinsics: React.JSX.IntrinsicElements;
 *     elementClass: React.Component<any, any>;
 *   }
 * }
 * ```
 *
 * Only one adapter is expected per compilation; two augmenting the same member
 * with different types in the same build would conflict - by design.
 */
export interface Host { }

/** Host-side: every class declared an element - see `element.ts`. */
export { elements } from './element';

/** Host-side: how `Context.get` resolves outside an origin - see `context.ts`. */
export { resolver } from './context';
export type { Renderable } from './element';

/** Host-side: owner and key of a bound method - see `model.ts`. */
export { methodOf } from './model';
