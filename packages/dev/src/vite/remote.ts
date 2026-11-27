import { Manifest, type Exposed } from "@expressive/rpc/vite";

export type { Exposed };

export class Exposure extends Manifest<Exposed> {
  readonly api = new Map<string, Exposed>();

  /** The calls and error classes of an `api/` route the client imports, export name by id. */
  idsOf(file: string): { calls: Record<string, string>; classes: Record<string, string> } {
    const exposed = this.api.get(file);
    const ids = (names: string[], id: (name: string) => string) => Object.fromEntries(names.map(name => [id(name), name]));

    if (!exposed) return { calls: {}, classes: {} };

    return {
      calls: ids(exposed.calls, name => this.callId(exposed, name)),
      classes: ids(exposed.errors.map(error => error.name), name => this.classId(exposed, name)),
    };
  }
}
