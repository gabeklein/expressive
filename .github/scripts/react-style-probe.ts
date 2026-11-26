import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer as listen } from 'node:net';
import { join, resolve } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';

import reactHot from '../../packages/react/src/vite';
import { Browser, CHROME, until } from './chrome';

if (!await Bun.file(CHROME).exists()) {
  console.log(`No Chrome at ${CHROME} - set CHROME to run the react style probe.`);
  process.exit(0);
}

const examples = createRequire(resolve('examples/package.json'));
const { createServer } = (await import(examples.resolve('vite'))) as typeof import('vite');
const { default: react } = (await import(examples.resolve('@vitejs/plugin-react'))) as typeof import('@vitejs/plugin-react');

const ROOT = resolve('.react-style-probe');
const APP = join(ROOT, 'app');
const src = (pkg: string) => resolve('packages', pkg, 'src');

rmSync(ROOT, { recursive: true, force: true });
mkdirSync(ROOT, { recursive: true });
cpSync(resolve('.github/scripts/react-style-probe'), APP, { recursive: true });

const page = (body: string, script: string) =>
  `<!doctype html><html><head><title>probe</title></head><body>${body}<div id="portal-root"></div>` +
  `<script type="module" src="${script}"></script></body></html>`;

writeFileSync(join(APP, 'index.html'), page('<div id="root"></div><div id="third-root"></div><div id="third-deep-root"></div>', '/client.tsx'));

function routes(): Plugin {
  let vite: ViteDevServer;

  return {
    name: 'ssr-routes',
    configureServer(server) {
      vite = server;
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';

        try {
          if (url.startsWith('/ssr-string')) {
            const server = await vite.ssrLoadModule('/server.tsx');
            const html = page(`<div id="root">${server.string()}</div>`, '/hydrate.tsx');
            res.setHeader('content-type', 'text/html');
            res.end(await vite.transformIndexHtml(url, html));
          } else if (url == '/ssr-stream') {
            const server = await vite.ssrLoadModule('/server.tsx');
            const stream = await server.stream(['/@vite/client', '/hydrate-stream.ts']);
            res.setHeader('content-type', 'text/html');
            res.end('<!doctype html>' + (await new Response(stream).text()));
          } else next();
        } catch (error) {
          res.statusCode = 500;
          res.end(String((error as Error)?.stack || error));
        }
      });
    }
  };
}

function freePort() {
  return new Promise<number>((done, fail) => {
    const probe = listen().once('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => done(port));
    });
  });
}

const server = await createServer({
  configFile: false,
  root: APP,
  logLevel: 'silent',
  cacheDir: join(ROOT, '.vite'),
  plugins: [react({ jsxImportSource: '@expressive/react' }), reactHot(), routes()],
  resolve: {
    alias: {
      '@expressive/react': src('react'),
      '@expressive/jsx': src('jsx'),
      '@expressive/dom': src('dom'),
      '@expressive/mvc': src('mvc')
    }
  },
  server: { host: '127.0.0.1', port: await freePort(), strictPort: true }
});

await server.listen();

const base = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`;
const browser = new Browser();
const results: [string, boolean, string][] = [];

const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

async function scenario(name: string, body: () => Promise<string | void>) {
  try {
    const evidence = (await body()) || '';
    results.push([name, true, evidence]);
    console.log(`PASS ${name}${evidence ? ` - ${evidence}` : ''}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    results.push([name, false, reason]);
    console.log(`FAIL ${name} - ${reason}`);
  }
}

const probe = (selector: string, property = 'color') =>
  browser.eval(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    return node && { value: getComputedStyle(node)[${JSON.stringify(property)}], className: node.className, text: node.textContent };
  })()`) as Promise<{ value: string; className: string; text: string } | null>;

async function expectStyle(selector: string, expected: string, property = 'color', timeout = 4000) {
  let last: Awaited<ReturnType<typeof probe>> = null;

  try {
    await until(async () => (last = await probe(selector, property))?.value == expected, timeout);
  } catch {
    throw new Error(`${selector} ${property} is ${last?.value ?? 'missing'} (class "${last?.className ?? ''}"), expected ${expected}`);
  }

  return `${selector} ${property} ${expected} via "${last!.className}"`;
}

const click = (selector: string) => browser.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
const navigate = async (url: string) => {
  await browser.eval(`window.__stale = true`);
  await browser.send('Page.navigate', { url });
  await until(async () => (await browser.eval(`document.readyState == 'complete' && !window.__stale`)) === true, 10000);
};
const sheets = () =>
  browser.eval(`JSON.stringify([...document.querySelectorAll('style, link[rel=stylesheet]')].map((n) => (n.parentNode === document.head ? 'head:' : 'body:') + (n.dataset.precedence ? n.dataset.precedence + '[' + (n.dataset.href || '').split(' ').length + ']' : 'sheet(' + n.sheet?.cssRules.length + ' rules: ' + [...(n.sheet?.cssRules || [])].map((r) => r.selectorText).filter(Boolean).slice(0, 6).join(',') + ')')))`);
const strayAttributes = () =>
  browser.eval(`[...document.querySelectorAll('*')].flatMap((node) => [...node.attributes].filter((a) => a.name[0] == '_').map((a) => node.tagName.toLowerCase() + '#' + node.id + '[' + a.name + ']'))`) as Promise<string[]>;

// React Refresh re-renders roots that failed, so the unhosted third-party case crashes again on every edit.
const thirdParty = (line: string) => line.includes('CSSStyleDeclaration') || line.includes('non-boolean attribute');

const RED = 'rgb(255, 0, 0)';
const BLUE = 'rgb(0, 0, 255)';
const GREEN = 'rgb(0, 128, 0)';
const GRAY = 'rgb(128, 128, 128)';
const PURPLE = 'rgb(128, 0, 128)';
const TEAL = 'rgb(0, 128, 128)';

async function edit(file: string, ...pairs: string[]) {
  const path = join(APP, file);
  let text = await Bun.file(path).text();

  for (let i = 0; i < pairs.length; i += 2) {
    if (!text.includes(pairs[i])) throw new Error(`"${pairs[i]}" not in ${file}`);
    text = text.replace(pairs[i], pairs[i + 1]);
  }

  await Bun.write(path, text);
}

const profile = join(ROOT, '.chrome');
let failed = 0;

try {
  await browser.open(base + '/', profile);
  await until(() => browser.text('#own'), 20000).catch((error) => {
    console.error('App did not render:', browser.errors.join('\n'), browser.warnings.join('\n'));
    throw error;
  });

  if (process.env.DEBUG) {
    console.log(await browser.eval(process.env.DEBUG));
    throw new Error('debug');
  }

  console.log('\n# Client render (StrictMode, dev)\n');

  await scenario('own rules and base declarations', async () => {
    const color = await expectStyle('#own', BLUE);
    const weight = await expectStyle('#own', '700', 'fontWeight');
    return `${color}; ${weight}`;
  });

  await scenario('_flag toggles on state change', async () => {
    const off = await expectStyle('#toggle', GRAY);
    await click('#toggle');
    const on = await expectStyle('#toggle', GREEN);
    await click('#toggle');
    await expectStyle('#toggle', GRAY);
    return `${off} -> ${on} -> back`;
  });

  await scenario('caller _rule on a child beats the callee base', async () => {
    const caller = await expectStyle('#caller', RED);
    const callee = await expectStyle('#callee', BLUE);
    await expectStyle('#caller', '1px', 'letterSpacing');
    return `${caller}; ${callee}`;
  });

  await scenario('lexical nesting through two component boundaries and {children}', async () =>
    expectStyle('#lex-deep', RED));
  await scenario('lexical nesting through a class Component\'s children', async () =>
    expectStyle('#lex-class', RED));
  await scenario('nested rule on a wrapper element reaches passed-in children', async () =>
    expectStyle('#lex-wrapper', GREEN));
  await scenario('descendant scope does not reach another component\'s own output', async () =>
    expectStyle('#lex-inner', PURPLE));
  await scenario('rule outside the scope keeps its top-level declaration', async () =>
    expectStyle('#lex-outside', GRAY));

  await scenario('memo child: own rule, caller rule, passed-in children', async () => {
    const own = await expectStyle('#memo', RED);
    const caller = await expectStyle('#memo', '700', 'fontWeight');
    const child = await expectStyle('#memo-child', TEAL);
    return `${own}; ${caller}; ${child}`;
  });

  await scenario('forwardRef child: own rule, caller rule, ref', async () => {
    const own = await expectStyle('#fwd', BLUE);
    const caller = await expectStyle('#fwd', '700', 'fontWeight');
    check((await browser.eval('window.__fieldRef')) == 'fwd', 'ref did not reach the input');
    return `${own}; ${caller}; ref ok`;
  });

  await scenario('portal', async () => expectStyle('#portal-root #portal', GREEN));
  await scenario('Suspense fallback', async () => expectStyle('#fallback', GRAY));
  await scenario('lazy component', async () => expectStyle('#lazy', TEAL));

  await scenario('no `_` attributes reach the DOM in hosted output', async () => {
    const stray = (await strayAttributes()).filter((name) => !name.includes('#third'));
    check(!stray.length, `stray: ${stray.join(', ')}`);
  });

  console.log('\n# Third-party component (React\'s own JSX runtime)\n');

  await scenario('third party: children authored by a styled caller', async () => {
    const error = await browser.text('#third-root .third-error');
    check(!error, `third-party root crashed: ${error}`);
    return expectStyle('#third-child', GREEN, 'color', 1500);
  });

  await scenario('third party: caller _rule on its root', async () => {
    const error = await browser.text('#third-root .third-error');
    check(!error, `third-party root crashed: ${error}`);
    return expectStyle('#third-caller', RED, 'color', 1500);
  });

  const beforeDeep = { errors: browser.errors.length, warnings: browser.warnings.length };
  await Bun.sleep(1000);
  const deepConsole = [...browser.errors.slice(beforeDeep.errors), ...browser.warnings.slice(beforeDeep.warnings)];
  console.log('third-deep console:', JSON.stringify(deepConsole.map((line) => line.slice(0, 300))));

  await scenario('[limitation] third party: caller _rule through an unhosted inner component', async () => {
    const error = await browser.text('#third-deep-root .third-error');
    check(!error, `third-party root crashed: ${error}`);
    const attrs = await browser.eval(`(() => { const n = document.querySelector('#third-deep'); return n && JSON.stringify({ class: n.className, style: n.getAttribute('style') }); })()`);
    try {
      return await expectStyle('#third-deep', RED, 'color', 1500);
    } catch (error) {
      throw new Error(`${(error as Error).message}; attributes ${attrs}`);
    }
  });

  const clientErrors = browser.errors.slice(0, beforeDeep.errors);
  const clientWarnings = browser.warnings.slice(0, beforeDeep.warnings);

  await scenario('client console clean before the unhosted third-party case mounts', async () => {
    check(!clientErrors.length && !clientWarnings.length, [...clientErrors, ...clientWarnings].join(' | ').slice(0, 1200));
  });

  console.log('client console:', JSON.stringify({ errors: clientErrors, warnings: clientWarnings }, null, 2));

  console.log('\n# SSR + hydration\n');

  for (const route of ['/ssr-string', '/ssr-stream']) {
    const html = await (await fetch(base + route)).text();
    const classes = [...html.matchAll(/id="([\w-]+)"[^>]*class="([^"]*)"|class="([^"]*)"[^>]*id="([\w-]+)"/g)]
      .map((m) => [m[1] || m[4], m[2] ?? m[3]] as const);
    const order = [...html.matchAll(/<style[^>]*data-precedence="([^"]+)"[^>]*data-href="([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}`);
    console.log(`${route} style tags:`, order.join(' '));

    await browser.eval('window.__stale = true');
    await browser.send('Emulation.setScriptExecutionDisabled', { value: true });
    await browser.send('Page.navigate', { url: base + route });
    await until(async () => (await browser.eval(`document.readyState == 'complete' && !window.__stale && !!document.querySelector('#own')`)) === true, 10000);

    const cascade = async (phase: string) => {
      await scenario(`${route} ${phase}: caller rendered before callee - caller rule wins`, async () => {
        const caller = await expectStyle('#caller', RED);
        const callee = await expectStyle('#callee', BLUE);
        const standalone = await expectStyle('#standalone', BLUE);
        return `${caller}; ${callee}; ${standalone}`;
      });
      await scenario(`${route} ${phase}: own rules`, async () => expectStyle('#own', '700', 'fontWeight'));
      await scenario(`${route} ${phase}: flag off`, async () => expectStyle('#toggle', GRAY));
      await scenario(`${route} ${phase}: lexical nesting`, async () => {
        await expectStyle('#lex-deep', RED);
        await expectStyle('#lex-class', RED);
        await expectStyle('#lex-wrapper', GREEN);
        await expectStyle('#lex-inner', PURPLE);
        return expectStyle('#lex-outside', GRAY);
      });
      if (route.startsWith('/ssr-string') && phase.startsWith('before'))
        await scenario(`${route} ${phase}: Suspense boundary (fallback until the server-cached promise settles)`, async () => {
          if (await browser.text('#late-fallback')) return 'fallback in server HTML';
          return expectStyle('#late', PURPLE);
        });
      else await scenario(`${route} ${phase}: late Suspense boundary`, async () => expectStyle('#late', PURPLE, 'color', 3000));
    };

    await cascade('before hydration (JS off)');

    const before = await browser.eval(`Object.fromEntries([...document.querySelectorAll('[id]')].map((n) => [n.id, n.className]))`);

    await browser.send('Emulation.setScriptExecutionDisabled', { value: false });
    const errors = browser.errors.length;
    const warnings = browser.warnings.length;
    await navigate(base + route);
    await until(async () => (await browser.eval('window.__hydrated')) === true, 10000).catch(() => {});

    await scenario(`${route} hydrated`, async () => {
      check((await browser.eval('window.__hydrated')) === true, 'hydration effect never ran');
    });

    await scenario(`${route} no hydration mismatch or recoverable error`, async () => {
      const recoverable = ((await browser.eval('window.__recoverable')) as string[])
        .filter((line) => !(route.startsWith('/ssr-string') && line.startsWith('Switched to client rendering because the server rendering aborted')));
      const logged = [...browser.errors.slice(errors), ...browser.warnings.slice(warnings)];
      check(!recoverable?.length && !logged.length, [...(recoverable || []), ...logged].join(' | ').slice(0, 1500));
    });

    await scenario(`${route} same class names on server and client`, async () => {
      const after = await browser.eval(`Object.fromEntries([...document.querySelectorAll('[id]')].map((n) => [n.id, n.className]))`);
      const diff = Object.keys(before).filter((id) => id in after && before[id] !== after[id]);
      check(!diff.length, diff.map((id) => `${id}: "${before[id]}" -> "${after[id]}"`).join('; '));
      return `${Object.keys(before).length} elements compared; server HTML classes: ${classes.length}`;
    });

    await cascade('after hydration');

    await scenario(`${route} after hydration: flag rule not in server CSS toggles on`, async () => {
      await click('#toggle');
      try {
        return await expectStyle('#toggle', GREEN);
      } catch (error) {
        throw new Error(`${(error as Error).message}; sheets ${await sheets()}`);
      }
    });

    await scenario(`${route} after hydration: client-only caller rule beats server-emitted callee base`, async () => {
      await click('#reveal');
      try {
        return await expectStyle('#reveal-caller', GREEN);
      } catch (error) {
        throw new Error(`${(error as Error).message}; sheets ${await sheets()}`);
      }
    });

    await scenario(`${route} no _ attributes`, async () => {
      const stray = await strayAttributes();
      check(!stray.length, stray.join(', '));
    });
  }

  console.log('\n# Fast refresh\n');

  const errors = browser.errors.length;
  await navigate(base + '/');
  await until(() => browser.text('#counter'), 10000);

  const reloads = async () => {
    await browser.eval('window.__alive = true');
  };
  const alive = async () => (await browser.eval('window.__alive')) === true;

  await reloads();

  await scenario('refresh: rule and text edit on a function component keeps state', async () => {
    await click('#counter');
    await click('#counter');
    await click('#counter');
    await until(async () => (await browser.text('#counter')) == 'v1 3');
    await edit('refreshed.tsx', `return <p id="counter" _count onClick={() => setCount(count + 1)}>v1 {count}</p>;`,
      `return <p id="counter" _count onClick={() => setCount(count + 1)}>v2 {count}</p>;`,
      `style(Counter, { _count: { color: 'rgb(255, 0, 0)' } });`, `style(Counter, { _count: { color: 'rgb(0, 0, 255)' } });`);
    await until(async () => (await browser.text('#counter'))?.startsWith('v2'), 8000).catch(() => {});
    const text = await browser.text('#counter');
    check(text == 'v2 3', `counter shows "${text}", expected "v2 3"`);
    check(await alive(), 'page reloaded');
    return `${await expectStyle('#counter', BLUE)}; text "${text}", no reload`;
  });

  await scenario('refresh: hooks edit remounts cleanly', async () => {
    const before = browser.errors.length;
    await edit('refreshed.tsx',
      `const [count, setCount] = useState(0);\n  return <p id="counter" _count onClick={() => setCount(count + 1)}>v2 {count}</p>;`,
      `const [count, setCount] = useState(0);\n  const doubled = useMemo(() => count * 2, [count]);\n  return <p id="counter" _count onClick={() => setCount(count + 1)}>v3 {count} {doubled}</p>;`,
      `import { useState } from 'react';`, `import { useMemo, useState } from 'react';`);
    await until(async () => (await browser.text('#counter'))?.startsWith('v3'), 8000).catch(() => {});
    const text = await browser.text('#counter');
    check(text == 'v3 0 0', `counter shows "${text}", expected remount to "v3 0 0"`);
    check(await alive(), 'page reloaded');
    const logged = browser.errors.slice(before).filter((line) => !thirdParty(line));
    check(!logged.length, logged.join(' | ').slice(0, 800));
    return `${await expectStyle('#counter', BLUE)}; text "${text}" (state reset by design), no reload, no errors`;
  });

  await scenario('refresh: class Component style map edit (hot.accept)', async () => {
    await expectStyle('#swatch', RED);
    await edit('swatch.tsx', `'rgb(255, 0, 0)'`, `'rgb(0, 0, 255)'`);
    const result = await expectStyle('#swatch', BLUE, 'color', 8000);
    check(await alive(), 'page reloaded');
    return result + ', no reload';
  });

  await scenario('refresh: a second component in the module keeps state across an edit', async () => {
    await click('#plain');
    await click('#plain');
    await until(async () => (await browser.text('#plain')) == 'v1 2');
    await edit('refreshed.tsx', `onClick={() => setCount(count + 1)}>v1 {count}</p>;`, `onClick={() => setCount(count + 1)}>v2 {count}</p>;`,
      `style(Plain, { _plain: { color: 'rgb(255, 0, 0)' } });`, `style(Plain, { _plain: { color: 'rgb(0, 0, 255)' } });`);
    await Bun.sleep(2500);
    const text = await browser.text('#plain');
    const color = (await probe('#plain'))?.value;
    check(text == 'v2 2' && color == BLUE, `plain shows "${text}" in ${color} after edit (alive: ${await alive()})`);
  });

  await reloads();

  await scenario('refresh: a second hooks edit remounts cleanly', async () => {
    const before = browser.errors.length;
    await edit('refreshed.tsx',
      `const doubled = useMemo(() => count * 2, [count]);\n  return <p id="counter" _count onClick={() => setCount(count + 1)}>v3 {count} {doubled}</p>;`,
      `const doubled = useMemo(() => count * 2, [count]);\n  const tripled = useMemo(() => count * 3, [count]);\n  return <p id="counter" _count onClick={() => setCount(count + 1)}>v4 {count} {doubled} {tripled}</p>;`);
    await Bun.sleep(2500);
    const text = await browser.text('#counter');
    const logged = browser.errors.slice(before).filter((line) => !thirdParty(line));
    check(text == 'v4 0 0 0' && !logged.length, `counter "${text}", alive ${await alive()}, errors: ${logged.join(' | ').slice(0, 600)}`);
  });

  console.log('refresh console errors:', JSON.stringify(browser.errors.slice(errors)).slice(0, 3000));
} finally {
  await browser.close();
  await server.close();
  rmSync(profile, { recursive: true, force: true });

  failed = results.filter(([name, ok]) => !ok && !name.startsWith('[limitation]')).length;
  const limits = results.filter(([name]) => name.startsWith('[limitation]'));
  console.log(`\n${results.length - limits.length - failed}/${results.length - limits.length} passed in Chrome; ${limits.length} known limitations probed (${limits.filter(([, ok]) => !ok).length} reproduced).`);
  writeFileSync(join(ROOT, 'results.json'), JSON.stringify(results, null, 2));
}

process.exit(failed ? 1 : 0);
