import { Component } from '@expressive/mvc';

const PLACED = new WeakMap<Component, Promise<void>>();

Component.on({
  setup(self) {
    return PLACED.get(self);
  }
});

function placing(instance: Component) {
  let place!: () => void;

  PLACED.set(instance, new Promise<void>((resolve) => (place = resolve)));
  return place;
}

function unplaced(instance: Component) {
  PLACED.set(instance, new Promise(() => {}));
}

export { placing, unplaced };
