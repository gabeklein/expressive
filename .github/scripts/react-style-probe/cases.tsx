import { style } from '@expressive/react/style';
import { Suspense, lazy } from 'react';
import { createPortal } from 'react-dom';
import { Counter, Plain } from './refreshed';
import { Exotic, Lexical, Own, Toggle, Toolbar } from './shared';
import { Swatch } from './swatch';
import { Third, ThirdDeep, Trigger } from './third';

const never = new Promise(() => {});

function Hang(): null {
  throw never;
}

const Later = lazy(() => import('./later'));

export function App() {
  return (
    <main>
      <Own />
      <Toggle />
      <Toolbar />
      <Lexical />
      <Exotic />
      {createPortal(<p id="portal" _note>portal</p>, document.getElementById('portal-root')!)}
      <Suspense fallback={<p id="fallback" _wait>wait</p>}><Hang /></Suspense>
      <Suspense fallback={null}><Later /></Suspense>
      <section><Counter /><Plain /></section>
      <Swatch />
    </main>
  );
}

style(App, {
  _note: { color: 'rgb(0, 128, 0)' },
  _wait: { color: 'rgb(128, 128, 128)' }
});

export function ThirdParty() {
  return (
    <div>
      <Third id="third-children"><p id="third-child" _note>child</p></Third>
      <Third id="third-caller" _accent />
    </div>
  );
}

export function ThirdDeepCase() {
  return (
    <div>
      <ThirdDeep id="third-deep" _accent />
      <Trigger _accent><a id="third-slot" href="#" _link>slot</a></Trigger>
    </div>
  );
}

style(ThirdDeepCase, { _accent: { color: 'rgb(255, 0, 0)' }, _link: { fontWeight: 700 } });

style(ThirdParty, { _note: { color: 'rgb(0, 128, 0)' }, _accent: { color: 'rgb(255, 0, 0)' } });
