const COPIES = Symbol.for('@expressive/jsx');
let announced = false;

function announce() {
  if (announced) return;

  const copies = ((globalThis as { [COPIES]?: unknown[] })[COPIES] ||= []);

  announced = true;
  copies.push(announce);

  if (copies.length == 2)
    console.error(
      '@expressive/jsx is loaded more than once - each copy renders and styles on its own, so styles from one are lost in the other. ' +
      'Dedupe it: one version, and no separate pre-bundle (Vite optimizeDeps).'
    );
}

export { announce };
