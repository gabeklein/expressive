import type { Component, Model } from '@expressive/mvc';
import type { RenderNode as Node, VNode } from '@expressive/jsx';
import type { JSX as Base } from '@expressive/jsx/jsx-runtime';

type Words =
  | 'AnimationCancel' | 'AnimationEnd' | 'AnimationIteration' | 'AnimationStart'
  | 'AuxClick' | 'BeforeInput' | 'BeforeMatch' | 'BeforeToggle' | 'CanPlay' | 'CanPlayThrough'
  | 'CompositionEnd' | 'CompositionStart' | 'CompositionUpdate'
  | 'ContextLost' | 'ContextMenu' | 'ContextRestored' | 'CueChange' | 'DblClick'
  | 'DragEnd' | 'DragEnter' | 'DragLeave' | 'DragOver' | 'DragStart' | 'DurationChange'
  | 'FocusIn' | 'FocusOut' | 'FormData' | 'GotPointerCapture' | 'KeyDown' | 'KeyPress' | 'KeyUp'
  | 'LoadedData' | 'LoadedMetadata' | 'LoadStart' | 'LostPointerCapture'
  | 'MouseDown' | 'MouseEnter' | 'MouseLeave' | 'MouseMove' | 'MouseOut' | 'MouseOver' | 'MouseUp'
  | 'PointerCancel' | 'PointerDown' | 'PointerEnter' | 'PointerLeave' | 'PointerMove'
  | 'PointerOut' | 'PointerOver' | 'PointerRawUpdate' | 'PointerUp'
  | 'RateChange' | 'ScrollEnd' | 'SecurityPolicyViolation' | 'SelectionChange' | 'SelectStart'
  | 'SlotChange' | 'TimeUpdate' | 'TouchCancel' | 'TouchEnd' | 'TouchMove' | 'TouchStart'
  | 'TransitionCancel' | 'TransitionEnd' | 'TransitionRun' | 'TransitionStart' | 'VolumeChange';

type Cased = { [W in Words as Lowercase<W>]: W };
type EventName<K> = K extends keyof Cased ? Cased[K] : Capitalize<K & string>;

type EventAttributes<T extends Element> = {
  [K in keyof GlobalEventHandlersEventMap as `on${EventName<K>}`]?:
    (event: GlobalEventHandlersEventMap[K] & { currentTarget: T }) => unknown;
} & {
  [K in keyof GlobalEventHandlersEventMap as `on${EventName<K>}Capture`]?:
    (event: GlobalEventHandlersEventMap[K] & { currentTarget: T }) => unknown;
};

type Declarations = Partial<Record<keyof CSSStyleDeclaration, string | number | null>> & {
  [property: `--${string}`]: string | number | null | undefined;
};
type Style = string | Declarations | false | null | undefined | readonly Style[];

type SVGAttributes = {
  [K in
    | 'clipPathUnits' | 'cx' | 'cy' | 'd' | 'dx' | 'dy' | 'fill' | 'filter' | 'fx' | 'fy'
    | 'gradientTransform' | 'gradientUnits' | 'height' | 'href' | 'in' | 'in2' | 'mask'
    | 'markerHeight' | 'markerUnits' | 'markerWidth' | 'maskUnits' | 'offset' | 'opacity'
    | 'orient' | 'pathLength' | 'patternUnits' | 'points' | 'preserveAspectRatio' | 'r'
    | 'refX' | 'refY' | 'result' | 'rotate' | 'rx' | 'ry' | 'stdDeviation' | 'stroke'
    | 'textLength' | 'transform' | 'type' | 'values' | 'version' | 'viewBox' | 'width'
    | 'x' | 'x1' | 'x2' | 'xmlns' | 'y' | 'y1' | 'y2']?: string | number;
};

type Attributes<T extends Element> = EventAttributes<T> & {
  [K in keyof T as K extends 'children' | 'className' | 'style'
    ? never
    : T[K] extends Function
      ? never
      : K]?: T[K] | string | number | boolean;
} & {
  children?: Node;
  className?: string;
  autoFocus?: boolean;
  onDoubleClick?: (event: MouseEvent & { currentTarget: T }) => unknown;
  dangerouslySetInnerHTML?: { __html: string };
  itemProp?: string;
  itemScope?: boolean;
  itemType?: string;
  itemID?: string;
  itemRef?: string;
  key?: string | number | null;
  ref?: ((node: T | null) => unknown) | { current: T | null };
  style?: Style;
  [attribute: `_${string}`]: unknown;
  [attribute: `data-${string}`]: unknown;
  [attribute: `aria-${string}`]: unknown;
};

type Intrinsics = {
  [K in keyof HTMLElementTagNameMap]: Attributes<HTMLElementTagNameMap[K]>
    & (K extends 'meta' ? { charSet?: string; property?: string } : {});
} & {
  [K in keyof SVGElementTagNameMap]: Attributes<SVGElementTagNameMap[K]> & SVGAttributes;
};

declare module '@expressive/mvc/jsx-runtime' {
  interface Host {
    node: Node;
    intrinsics: Intrinsics;
    element: () => PromiseLike<Module>;
    elementClass: Model & { render(props?: any): Component.Node };
  }
}

declare module '@expressive/mvc' {
  namespace Model {
    /** JSX attributes of a Model with no `props` member: its settable fields, `is`, a boundary, and what `render` accepts. */
    type Props<T extends Model> =
      & Component.ModelProps<T>
      & {
        is?: (instance: T) => void;
        /** Shown while this element's content is suspended or recovering. `false` opts out. */
        fallback?: Reserved<T, 'fallback', Component.Node | false>;
        /** Called when this element's content throws. A returned promise retries once settled. */
        catch?: Reserved<T, 'catch', (error: Error, instance: T) => Promise<void> | void>;
      }
      & Component.RenderProps<T extends { render: infer R } ? R : never>;

    /** Boundary attribute type, narrowed by a member of the same name so a mismatch fails at the element. */
    type Reserved<T, K extends string, V> = K extends keyof T ? T[K] & V : V;
  }
}

declare module '@expressive/jsx/jsx-runtime' {
  namespace JSX {
    interface IntrinsicAttributes {
      style?: Style;
      [attribute: `_${string}`]: unknown;
    }
  }
}

export { Fragment, jsx, jsxs } from '@expressive/jsx/jsx-runtime';
export type { VNode as JSXElement };
type Loadable = ((props: any) => Node) | (abstract new (...args: any[]) => object);
type Module<T extends Loadable = Loadable> = T | { default: T };

type Loaded<T> = [T] extends [never] ? {}
  : T extends abstract new (...args: any[]) => infer I
  ? JSX.LibraryManagedAttributes<T, I>
  : T extends (props: infer P) => any ? P : never;

export declare namespace JSX {
  type Element = Base.Element;
  type ElementType =
    | keyof IntrinsicElements
    | ((props: any) => Component.Node)
    | (() => PromiseLike<Module>)
    | (abstract new (...args: any[]) => ElementClass);
  interface ElementClass extends Model { render(props?: any): Component.Node }
  /**
   * Empty, so a class element's attributes resolve from its instance type and
   * {@link LibraryManagedAttributes} picks `props` when declared, else derives
   * them from the Model.
   */
  interface ElementAttributesProperty {}
  type LibraryManagedAttributes<C, P> =
    C extends abstract new (...args: any[]) => infer I
      ? P extends { props: infer Q } ? Q
      : I extends Model ? Model.Props<I>
      : P
      : C extends () => PromiseLike<Module<infer T>>
      ? Loaded<T>
      : P;
  interface ElementChildrenAttribute extends Base.ElementChildrenAttribute {}
  interface IntrinsicAttributes extends Base.IntrinsicAttributes {}
  type IntrinsicElements = Base.IntrinsicElements;
}
