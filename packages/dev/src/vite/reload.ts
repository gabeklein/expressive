import { replaced } from "@expressive/mvc/hot";
import { retire } from "@expressive/rpc/protocol";
import type { ModuleRunner } from "vite/module-runner";

import { rotate } from "../server/connection";

export function reloads(runner: ModuleRunner): () => void {
  const hmr = runner.hmrClient;
  const stop = replaced(({ prev }) => {
    retire(prev);
    rotate();
  });

  if (!hmr) return stop;

  const restart = async () => {
    retire();

    const disposers = [...hmr.disposeMap];

    hmr.disposeMap.clear();
    await Promise.all(disposers.map(([path, dispose]) => dispose(hmr.dataMap.get(path))));
    rotate(true);
  };

  const listeners = hmr.customListenersMap;

  listeners.set("vite:beforeFullReload", [...(listeners.get("vite:beforeFullReload") ?? []), restart]);

  return stop;
}
