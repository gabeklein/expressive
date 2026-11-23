#!/usr/bin/env node
import { main } from "@expressive/cli";

import Dev from "./command/dev";

export default main(import.meta, Dev, { as: "expressive" });
