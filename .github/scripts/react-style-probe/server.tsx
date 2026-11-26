import '@expressive/react';
import { renderToReadableStream, renderToString } from 'react-dom/server';
import { Doc, SsrApp } from './ssr-app';

export function string() {
  return renderToString(<SsrApp />);
}

export async function stream(bootstrapModules: string[]) {
  const stream = await renderToReadableStream(<Doc />, { bootstrapModules });
  return stream;
}
