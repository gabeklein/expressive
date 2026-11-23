import { Component } from '@expressive/mvc';

const PLACED = new WeakMap<Component, Promise<void>>();
let installed = false;

function own(Type: new (props: unknown) => Component, props: unknown, placed: Promise<void>) {
  if (!installed) {
    Component.on({ setup: (self) => PLACED.get(self) });
    installed = true;
  }

  const instance = new Type(props);

  PLACED.set(instance, placed);
  return instance;
}

export { own };
