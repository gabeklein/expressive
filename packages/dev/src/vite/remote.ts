import { Manifest, type Exposed as Plain } from "@expressive/rpc/vite";

import type { Remote } from "./routes";

export interface Exposed extends Remote, Plain {}

export class Exposure extends Manifest<Exposed> {}
