/** @jsxImportSource react */
import type { ReactNode } from 'react';

export function Third(props: { id: string; children?: ReactNode; [key: string]: unknown }) {
  return <div {...props} />;
}

function Leaf(props: { id: string; [key: string]: unknown }) {
  return <div {...props} />;
}

export function ThirdDeep(props: { id: string; [key: string]: unknown }) {
  return <Leaf {...props} />;
}
