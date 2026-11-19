import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = mkdtempSync(join(tmpdir(), 'env-probe-'));
writeFileSync(join(root, '.env'), '# Probe section\n\n# A probe key.\nPROBE_KEY=from-file\n');
process.chdir(root);

const { env } = await import('@expressive/env');

assert.equal(env.PROBE_KEY, 'from-file');
assert.equal(process.env.PROBE_KEY, undefined);

console.log('env: .env read without touching process.env ok');

const bin = fileURLToPath(new URL('../node_modules/@expressive/env/dist/cli.js', import.meta.url));
const expressive = (...args) => execFileSync('node', [bin, ...args], { cwd: root, encoding: 'utf8' });

assert.match(expressive('env', 'list'), /^PROBE_KEY {2}9 chars {2}\.env:4$/m);
expressive('env', 'sync');
assert.match(readFileSync(join(root, 'env.d.ts'), 'utf8'), /A probe key\.[\s\S]*@category Probe section[\s\S]*readonly PROBE_KEY: string;/);

console.log('env: expressive env list and sync ok');
