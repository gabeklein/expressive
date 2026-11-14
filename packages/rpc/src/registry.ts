import type { Fault } from "./call";

export function registry(known: Record<string, new (message: string) => Error> = {}) {
  const classes = new Map(Object.entries(known));
  const given = new Set(classes.keys());

  function add(more: Record<string, new (message: string) => Error>) {
    for (const [id, Type] of Object.entries(more)) {
      classes.set(id, Type);
      given.add(id);
    }
  }

  function define(id: string, name: string, parent?: string): ErrorConstructor {
    if (given.has(id)) return classes.get(id) as ErrorConstructor;

    const Base = (parent !== undefined && classes.get(parent)) || Error;
    const named = { [name]: class extends Base {} };
    const Type = named[name] as ErrorConstructor;

    Type.prototype.name = name;
    classes.set(id, Type);

    return Type;
  }

  function rebuild({ error, message, stack, ...fields }: Fault): Error {
    const Type = classes.get(error!) ?? Error;

    return Object.assign(new Type(message), fields);
  }

  return { add, define, rebuild };
}
