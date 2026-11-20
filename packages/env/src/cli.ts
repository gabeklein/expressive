#!/usr/bin/env node
import { main } from "@expressive/cli";

import Env from "./command";

export default main(import.meta, Env, { as: "expressive" });
