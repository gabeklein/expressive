const COPIES = Symbol.for('@expressive/jsx');
const HERE = import.meta.url.split('?')[0];
let announced = false;

function announce() {
  if (announced) return;

  const copies = ((globalThis as { [COPIES]?: string[] })[COPIES] ||= []);

  announced = true;

  if (copies.includes(HERE)) return;

  copies.push(HERE);

  if (copies.length == 2)
    console.error(
      '@expressive/jsx is loaded more than once - each copy renders and styles on its own, so styles from one are lost in the other. ' +
      'Dedupe it: one version, and no separate pre-bundle (Vite optimizeDeps).'
    );
}

export { announce };
