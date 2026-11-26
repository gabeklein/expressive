import { harness } from '../jsx/test.setup';
import { render } from './src/host';

export { attached, flushMicrotasks, html, lazy, mockError, mockPromise, mockWarn, track, until } from '../jsx/test.setup';

export const { mount, place, rules } = harness(render, 'dom');
