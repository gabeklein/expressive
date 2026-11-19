import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'env-probe-'));
writeFileSync(join(root, '.env'), 'PROBE_KEY=from-file\n');
process.chdir(root);

const { env } = await import('@expressive/env');

assert.equal(env.PROBE_KEY, 'from-file');
assert.equal(process.env.PROBE_KEY, undefined);

console.log('env: .env read without touching process.env ok');
