/** @jsxImportSource @expressive/jsx */

import type { Component } from "@expressive/mvc";
import { NotFound } from "@expressive/rpc";

/** Shows a plain 404 or generic error when no folder supplies `Catch`. */
export function Catch({ error, retry }: { error: Error; retry: () => void }): Component.Node {
  if (!(error instanceof NotFound)) return <main><h1>Something went wrong</h1><button onClick={retry}>Try again</button></main>;
  return <main><h1>404 - Not found</h1><p>No route matched.</p></main>;
}
