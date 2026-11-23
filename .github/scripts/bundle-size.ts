import { gzipSync } from 'bun';
import type { BunPlugin } from 'bun';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { withWorkspaceLinks } from './workspace-links';

const STEP = 0.05;

/**
 * Gzip bytes per import shape, measured against built dist and written to
 * `--out` (default `size-report.json`, which the site reads for its figures).
 * Per-shape rather than one aggregate: the point is to notice when the
 * adapter's irreducible floor grows, or when a formerly shakeable export stops
 * shaking.
 *
 * With `--base <report>` each shape is compared to that report, and `--gate`
 * fails when one grows by more than `STEP` in a single change. Feature
 * growth stays well under it; a broken `sideEffects` flag or a module pulled
 * into the wrong entry does not. There are no absolute budgets to re-set.
 *
 * `--partial` skips a shape that fails to bundle, for measuring a base that
 * predates it.
 */

const CASES = [
  {
    name: 'mvc: Model only',
    code: `import Model from '@expressive/mvc'; console.log(Model);`
  },
  {
    name: 'mvc: everything',
    code: `import * as all from '@expressive/mvc'; console.log(all);`
  },
  {
    name: 'react: Model only',
    code: `import '@expressive/react'; import { Model } from '@expressive/mvc'; console.log(Model);`
  },
  {
    name: 'react: typical app',
    code: `import '@expressive/react';
           import { Model, Component, get, set, ref, def } from '@expressive/mvc';
           console.log(Model, Component, get, set, ref, def);`
  },
  {
    name: 'react: with collections',
    code: `import '@expressive/react';
           import { Model, Component, has, map } from '@expressive/mvc';
           console.log(Model, Component, has, map);`
  },
  {
    name: 'react: everything',
    code: `import * as all from '@expressive/react'; import * as mvc from '@expressive/mvc'; console.log(all, mvc);`
  },
  {
    name: 'jsx: runtime',
    code: `import { Fragment, jsx, jsxs } from '@expressive/jsx/jsx-runtime'; console.log(Fragment, jsx, jsxs);`
  },
  {
    name: 'jsx: style',
    code: `import Model from '@expressive/mvc'; import { Css, style } from '@expressive/jsx'; console.log(Model, Css, style);`
  },
  {
    name: 'dom: renderer',
    code: `import Model, { Component, Context, def, get, has, map, pending, ref, set } from '@expressive/mvc';
           import { Fragment, Portal, createElement, render } from '@expressive/dom';
           console.log(Model, Component, Context, Fragment, Portal, createElement, def, get, has, map, pending, ref, render, set);`
  },
  {
    name: 'dom: styling',
    code: `import * as mvc from '@expressive/mvc';
           import * as dom from '@expressive/dom';
           console.log(mvc, dom);`
  },
  {
    name: 'router: everything',
    code: `import * as all from '@expressive/router'; console.log(all);`
  },
  {
    name: 'inspect: install',
    code: `import '@expressive/inspect/install';`
  },
  {
    name: 'steps: everything',
    code: `import { Steps } from '@expressive/steps'; console.log(Steps);`
  },
  {
    name: 'react + router',
    code: `import * as a from '@expressive/react';
           import * as b from '@expressive/router';
           console.log(a, b);`
  }
];

/**
 * Resolve `@expressive/*` through each package's exports map, the way a
 * consumer does. Without this, Bun applies the nearest package `tsconfig.json`
 * to files it processes - including a dependency's own `dist` - so an import of
 * `@expressive/mvc` alongside an adapter resolves once to `dist` and once to
 * `src`, and the probe measures two copies of the core.
 */
const published: BunPlugin = {
  name: 'published-exports',
  setup(build) {
    build.onResolve({ filter: /^@expressive\// }, async ({ path }) => {
      const [, name, ...rest] = path.split('/');
      const dir = resolve('packages', name);
      const manifest = await Bun.file(join(dir, 'package.json')).json();
      const key = rest.length ? `./${rest.join('/')}` : '.';
      const entry = manifest.exports?.[key]?.default ?? manifest.main;

      return { path: join(dir, entry) };
    });
  }
};

// Measured through bare specifiers, as a consumer writes them, so the exports
// map and each package's `sideEffects` both take part in the result.
const release = withWorkspaceLinks();

const flag = (name: string) => {
  const at = process.argv.indexOf(name);
  if (at < 0) return undefined;

  const value = process.argv[at + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} needs a path.`);

  return value;
};

const out = flag('--out') ?? 'size-report.json';
const basePath = flag('--base');
const gate = process.argv.includes('--gate');
const partial = process.argv.includes('--partial');

const dir = '.size-probe';
mkdirSync(dir, { recursive: true });

const results: { name: string; bytes: number; base?: number }[] = [];

try {
  for (const probe of CASES) {
    const entry = join(dir, probe.name.replace(/[^a-z0-9]+/gi, '-') + '.ts');
    await Bun.write(entry, probe.code);

    const built = await Bun.build({
      entrypoints: [entry],
      minify: true,
      target: 'browser',
      plugins: [published],
      format: 'esm',
      external: ['react', 'react-dom', 'react/jsx-runtime'],
      define: { 'process.env.NODE_ENV': '"production"' }
    }).catch((cause) => {
      if (partial) return console.warn(`Skipped "${probe.name}": ${cause.message}`);
      throw new Error(`Failed to bundle "${probe.name}".`, { cause });
    });

    if (!built) continue;

    const source = await built.outputs[0].text();
    const bytes = gzipSync(Buffer.from(source), { level: 9 }).length;

    results.push({ name: probe.name, bytes });
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
  release();
}

await Bun.write(
  out,
  JSON.stringify(Object.fromEntries(results.map(({ name, bytes }) => [name, bytes])), null, 2)
);

if (basePath) {
  const base: Record<string, number> = JSON.parse(readFileSync(basePath, 'utf8'));
  for (const result of results) result.base = base[result.name];
}

const kb = (n: number) => (n / 1024).toFixed(2) + ' kB';
const change = ({ bytes, base }: { bytes: number; base?: number }) =>
  base === undefined ? undefined : (bytes - base) / base;
const delta = (result: { bytes: number; base?: number }) => {
  const ratio = change(result);
  if (ratio === undefined) return 'new';
  const diff = result.bytes - result.base!;
  const sign = diff > 0 ? '+' : '';
  return `${sign}${diff} B (${sign}${(ratio * 100).toFixed(1).replace(/^-0\.0$/, '0.0')}%)`;
};
const jumped = results.filter((result) => (change(result) ?? 0) > STEP);

for (const result of results)
  console.log(
    `${result.name.padEnd(24)} ${kb(result.bytes).padStart(9)}` +
    (basePath ? `  ${delta(result)}${jumped.includes(result) ? '  JUMP' : ''}` : '')
  );

if (process.env.GITHUB_STEP_SUMMARY && basePath)
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    [
      '## Bundle size',
      '',
      basePath ? '| Import shape | gzip | vs base |' : '| Import shape | gzip |',
      basePath ? '| --- | --- | --- |' : '| --- | --- |',
      ...results.map((result) =>
        `| ${result.name} | ${kb(result.bytes)} |` +
        (basePath ? ` ${jumped.includes(result) ? `**${delta(result)}** :warning:` : delta(result)} |` : '')
      ),
      ''
    ].join('\n')
  );

if (jumped.length && gate)
  throw new Error(
    `Import shapes grew by more than ${STEP * 100}% in one change:\n` +
    jumped.map((result) => `  ${result.name}: ${kb(result.base!)} -> ${kb(result.bytes)}`).join('\n') +
    `\n\nA jump this size usually means lost tree-shaking or a module pulled into the wrong entry.` +
    ` If the growth is intended, say so in the PR and merge - the check is not required.`
  );
