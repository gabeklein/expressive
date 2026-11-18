import "@expressive/dom";

import { install as resolve, onBuild } from "@expressive/rpc/protocol";

import { audit } from "./connection";
import { track } from "./version";

export function install(dev = false) {
  audit(dev);
  onBuild(track);
  // dev's seats hold state between calls; rpc's default drops one after its last.
  resolve({ ttl: 300 });
}
