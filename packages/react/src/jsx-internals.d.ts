import type { Appearance } from '../../jsx/src/style/claim';

export type { Appearance, Claim } from '../../jsx/src/style/claim';
export type { Declaration, Styles } from '../../jsx/src/style/protocol';
export { styleElement } from '../../jsx/src/style/claim';
export { Style, style } from '../../jsx/src/style/stylesheet';
export { Css } from '../../jsx/src/style/css';

export interface Rendered {
  kind: string;
  type?: unknown;
  props?: Record<string, any>;
  instance?: object;
  appearance?: Appearance;
  consumed?: boolean;
  dev?: object;
}

export type Style = string | Record<string, unknown> | false | null | undefined | readonly Style[];

export interface AppearanceContext {
  readonly base?: object;
}

export function consume<T>(fiber: Rendered, render: () => T): T;
export function observe(props: Record<string, any>): Record<string, any>;
export function renderedAppearance(fiber: Rendered): Appearance | undefined;
export function componentProps(type: unknown, props: Record<string, any>, appearance: Appearance | undefined): {
  appearance: Appearance | undefined;
  props: Record<string, any>;
};
export function enterAppearance(type: Function, key?: string): Appearance['context'] & AppearanceContext | undefined;
