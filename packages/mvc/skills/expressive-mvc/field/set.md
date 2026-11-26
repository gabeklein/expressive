# `set` - Default Values, Factories & Validation

Runnable source: [`set`](https://expressive.dev/examples/instructions/set) (default + callback), [`set-factory`](https://expressive.dev/examples/instructions/set-factory) and [`set-computed`](https://expressive.dev/examples/instructions/set-computed) - complete programs, served as HTML.

```ts
import { set } from '@expressive/mvc';
```

Instruction for managed slots: defaults, placeholders, lazy/async factories, validation callbacks.

All `set()` forms are **non-enumerable** - hidden from `Object.keys()`, spread, and `ref(this)`, unlike plain assignment (`name = 'foo'`) - except the [computed](#computed-reactive) form, enumerable to match a getter. All forms are writable except the computed one; a `readonly` field rejects direct assignment at compile time - constructor args and `set({...})` still write it.

## Overloads

### Placeholder (Suspense)

```ts
class FormState extends Model {
  data = set<string>();
  logged = set<string>(undefined, (next, prev) => {
    console.log('assigned:', next);
  });
}
```

Required, initially undefined. Reading before assignment throws a suspense-compatible `Promise`/`Error` hybrid. Writable.

### Default Value

```ts
class FormState extends Model {
  name = set('default');
}
```

Writable; unlike `name = 'default'`, hidden from `Object.keys()` and `ref(this)`.

### Default Value with Callback

```ts
class FormState extends Model {
  name = set('default', (next, prev) => {
    if (next.length > 50) throw false; // reject - never stored
  });

  query = set('', (value) => {
    const timer = setTimeout(() => search(value), 300);
    return () => clearTimeout(timer); // cleanup on next update
  });
}
```

Callback runs on every assignment:

| Callback does       | Effect                                     |
| ------------------- | ------------------------------------------ |
| throws `false`      | reject - value unchanged, no event         |
| throws `true`       | accept silently - value changes, no event  |
| returns a function  | cleanup, called on next update with the new value |
| returns a promise   | ignored                                    |
| throws an error     | rethrown to the caller                     |

### Factory

```ts
class AppState extends Model {
  config = set(() => loadConfig()); // lazy
  api = set(async () => fetchData()); // async, suspends until resolved
  data = set(() => fetchData(), true); // required - runs on activation, holds ready
  maybe = set(() => fetchData(), false); // lazy, no suspense (undefined while pending)
}
```

Zero-argument factory, computed lazily on first access. Writable - a loaded value can be patched in place:

```ts
class Account extends Model {
  profile = set(() => api.profile());
  readonly plan = set(() => api.plan()); // read-only to TypeScript

  rename(name: string) {
    this.profile = { ...this.profile, name };
  }
}
```

A write takes over from the factory - before it runs, it never does; while pending, its result is discarded. A constructor arg (`Account.new({ profile })`) counts, so it skips a required factory.

- Async factories (any thenable result) throw suspense on access until resolved; the field types as the `Awaited` value.
- A thenable Model not yet active (`new Job()`) activates owned by the instance and is destroyed once it settles - kept if it resolves to itself (a loaded entity).
- `false`: `undefined` while pending instead of suspending.
- `true`: required - runs on activation, after constructor args; reads suspend while async. A synchronous throw fails activation.
- Bound to the instance (`this` works).
- May suspend on other pending `set()` properties - resolution cascades.

While pending, a required factory holds the instance's `ready`, effects and `await state.set()` - and its parent's, like `async new()` ([lifecycle.md](../state/lifecycle.md)), so it cannot await `this.set()` or an effect. Render is not held: consumers that read the field suspend, others render. A rejection reports to `catch` as `setup` with the field's key, releases the hold, and rethrows on reads - the instance is not destroyed.

Suspense via factory fits load-once data a view cannot render without. Keep explicit `loading` / `error` fields when the operation is user-initiated (submit, refresh), stale content stays visible during refetch, or errors render inline rather than thru a boundary.

### Factory with Callback

```ts
class AppState extends Model {
  config = set(
    () => loadDefaults(),
    (next, prev) => {
      console.log('config changed');
    }
  );
}
```

Runs on activation, not first read. Callback runs on factory resolution and on manual assignment. An async result overwrites a value assigned while pending - the reverse of the bare factory.

### Computed (Reactive)

```ts
class Person extends Model {
  first = 'John';
  last = 'Doe';
  full = set(self => `${self.first} ${self.last}`); // re-runs when first/last change
}
```

The instruction equivalent of a getter. A function **declaring a parameter** routes into the compute engine - re-running whenever a managed property it reads updates - where a zero-arg factory runs once and caches. The instance is passed as both `this` and the first argument, so arrow and regular functions both work.

- **Dispatch is by arity.** `set(() => x)` is a one-shot factory; `set(self => x)` is reactive. A function reading via `this` still must declare the parameter (`set(function (self) { return this.x })`).
- Enumerable and read-only, like a prototype getter. Computes lazily on first access; in snapshots once accessed.
- Being instruction-assigned rather than a concrete getter, a **subclass can refine its type** with `declare` (e.g. narrowing a parent's generic computed) - which a parent getter cannot express.

### Direct Promises Are Not Supported

```ts
class AppState extends Model {
  data = set(somePromise); // TypeError at init
}
```

A raw Promise or other thenable throws `Direct promises and thenables are not supported in set(...)`. Use a factory (`set(() => promise)` or `set(async () => value)`) so async work starts during activation/access - a promise constructed in a field initializer can keep running for instances React abandons, especially under StrictMode.

Per-overload contract: JSDoc on hover, or `node_modules/@expressive/mvc/dist/field/set.d.ts`.
