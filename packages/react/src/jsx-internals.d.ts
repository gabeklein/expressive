import type { Model } from '@expressive/mvc';
import type { Appearance } from '../../jsx/src/style/claim';

export type { Appearance, Claim } from '../../jsx/src/style/claim';
export type { Declaration, Styles } from '../../jsx/src/style/protocol';
export { placeComponent, styleElement } from '../../jsx/src/style/claim';
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
  method?: { owner: Model; key: string };
}

export function authorAppearance(author: object | undefined, appearance: Appearance | undefined): Appearance | undefined;
export function renderComponent<T>(fiber: Rendered, render: () => T): { output: T; appearance: Appearance | undefined };
