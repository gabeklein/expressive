import { style } from '@expressive/react/style';
import { Suspense, use, useEffect } from 'react';
import { Button, Lexical, Own, Reveal, Toggle, Toolbar } from './shared';

const data = new Promise<string>((done) => setTimeout(() => done('late'), 300));

function Late() {
  return <em id="late" _late>{use(data)}</em>;
}

style(Late, { _late: { color: 'rgb(128, 0, 128)' } });

function Hydrated() {
  useEffect(() => {
    (window as any).__hydrated = true;
  }, []);
  return null;
}

export function SsrApp() {
  return (
    <main>
      <Toolbar />
      <Button id="standalone" />
      <Own />
      <Toggle />
      <Lexical />
      <Reveal />
      <Suspense fallback={<i id="late-fallback">…</i>}><Late /></Suspense>
      <Hydrated />
    </main>
  );
}

export function Doc() {
  return (
    <html>
      <head><title>stream</title></head>
      <body><div id="root"><SsrApp /></div></body>
    </html>
  );
}
