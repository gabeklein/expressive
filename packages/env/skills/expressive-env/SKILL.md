---
name: expressive-env
description: Typed environment variables (@expressive/env) - `env.NAME` read from the project's .env files without touching process.env. Use when code reads an environment variable or a task touches a .env file.
---

# @expressive/env

```ts
import { env } from "@expressive/env";

const db = connect(env.DATABASE_URL);
```

`env` is read-only: `process.env` over the mode's `.env` files. Read it instead of `process.env` - it needs no `dotenv`, `--env-file` or loader, and never writes `process.env`. Keys do not enumerate - spread and `JSON.stringify(env)` give `{}`, so logging it leaks nothing; read keys by name.

Files load from the working directory on the first read, later winning:

```text
.env  .env.local  .env.[mode]  .env.[mode].local
```

Mode is `NODE_ENV`, default `development` - the same files and order as Vite. Commit `.env.example` with every key and no secrets; keep the rest out of git.
