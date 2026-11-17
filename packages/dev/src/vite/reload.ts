import { forget, replaced } from "@expressive/mvc/hot";
import { retire } from "@expressive/rpc/protocol";
import type { ModuleRunner } from "vite/module-runner";

import { rotate } from "../server/connection";

export function reloads(runner: ModuleRunner): () => void {
  const hmr = runner.hmrClient;
  let pending: Promise<void> | undefined;

  const restart = () => (pending ??= (async () => {
    retire();
    forget();
    runner.evaluatedModules?.clear();

    if (hmr) {
      const disposers = [...hmr.disposeMap];

      hmr.disposeMap.clear();
      await Promise.all(disposers.map(([path, dispose]) => dispose(hmr.dataMap.get(path))));
    }

    rotate();
    pending = undefined;
  })());

  const stop = replaced(() => void restart());

  if (!hmr) return stop;

  const listeners = hmr.customListenersMap;

  listeners.set("vite:beforeFullReload", [...(listeners.get("vite:beforeFullReload") ?? []), restart]);

  return stop;
}
