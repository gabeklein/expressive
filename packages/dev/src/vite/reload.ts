import { forget, replaced } from "@expressive/mvc/hot";
import { retire } from "@expressive/rpc/protocol";
import type { ModuleRunner } from "vite/module-runner";

import { rotate } from "../server/connection";

export interface Reloads {
  stop(): void;
  settled(): Promise<void>;
}

export function reloads(runner: ModuleRunner): Reloads {
  const hmr = runner.hmrClient;
  const entries = new Set<string>();
  let teardown: Promise<void> | undefined;
  let settled = Promise.resolve();
  let latest = 0;

  const report = (results: PromiseSettledResult<unknown>[]) =>
    results.forEach(result => result.status == "rejected" && console.error(result.reason));

  const restart = (): Promise<void> => {
    if (teardown) return teardown;

    const run = ++latest;

    for (const node of runner.evaluatedModules.idToModuleMap.values()) if (!node.importers.size) entries.add(node.url);

    teardown = (async () => {
      retire();
      forget();

      if (hmr) {
        const disposers = [...hmr.disposeMap];

        hmr.disposeMap.clear();
        report(await Promise.allSettled(disposers.map(async ([path, dispose]) => dispose(hmr.dataMap.get(path)))));
      }

      runner.evaluatedModules.clear();
      rotate();
    })()
      .catch(error => console.error(error))
      .finally(() => (teardown = undefined));

    settled = teardown
      .then(() => new Promise(resolve => setTimeout(resolve)))
      .then(() => Promise.allSettled([...entries].map(url => runner.import(url))))
      .then(results => {
        report(results);
        if (run === latest) entries.clear();
      });

    return teardown;
  };

  const stop = replaced(() => void restart());

  if (hmr) {
    const listeners = hmr.customListenersMap;

    listeners.set("vite:beforeFullReload", [...(listeners.get("vite:beforeFullReload") ?? []), restart]);
  }

  return { stop, settled: () => settled };
}
