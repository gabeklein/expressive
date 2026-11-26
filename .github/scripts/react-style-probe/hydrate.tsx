import '@expressive/react';
import { hydrateRoot } from 'react-dom/client';
import { Doc, SsrApp } from './ssr-app';

const errors: string[] = ((window as any).__recoverable = []);
const onRecoverableError = (error: unknown) => errors.push(String((error as Error)?.message || error));

if (location.search == '?hoist')
  document.head.append(...document.querySelectorAll('#root > style[data-precedence]'));

if (location.pathname == '/ssr-stream') hydrateRoot(document, <Doc />, { onRecoverableError });
else hydrateRoot(document.getElementById('root')!, <SsrApp />, { onRecoverableError });
