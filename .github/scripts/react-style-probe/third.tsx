/** @jsxImportSource react */
import { Children, cloneElement, forwardRef } from 'react';
import type { ReactElement, ReactNode } from 'react';

export function Third(props: { id: string; children?: ReactNode; [key: string]: unknown }) {
  return <div {...props} />;
}

function Leaf(props: { id: string; [key: string]: unknown }) {
  return <div {...props} />;
}

export function ThirdDeep(props: { id: string; [key: string]: unknown }) {
  return <Leaf {...props} />;
}

const Slot = forwardRef<HTMLElement, { children: ReactElement<any>; className?: string }>(({ children, ...props }, ref) =>
  cloneElement(Children.only(children), {
    ...props,
    ref,
    className: [props.className, children.props.className].filter(Boolean).join(' ')
  })
);

export function Trigger({ children, ...props }: { children: ReactElement<any> }) {
  return <Slot {...props}>{children}</Slot>;
}
