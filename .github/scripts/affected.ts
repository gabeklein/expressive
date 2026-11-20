import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';

const [base = process.env.BASE, head = 'HEAD'] = process.argv.slice(2);

if (!base)
  throw new Error('Usage: bun .github/scripts/affected.ts <base-ref> [head-ref]');

const QUIET = ['website/', 'skills/', '.changeset/', '.agents/', '.claude/'];

const CONSUMERS = {
  e2e: { dir: 'examples/', reads: ['examples/package.json', 'examples/vite.config.ts'] },
  hot: { dir: undefined, reads: ['.github/scripts/hot-probe.ts'] }
};

const read = (file: string) => readFileSync(file, 'utf8');
const mentions = (text: string) =>
  new Set([...text.matchAll(/@expressive\/([a-z-]+)/g)].map(m => m[1]));

const dirs = readdirSync('packages').filter(dir => existsSync(`packages/${dir}/package.json`));
const uses = new Map<string, Set<string>>();

for (const dir of dirs) {
  const { dependencies, devDependencies, peerDependencies } = JSON.parse(read(`packages/${dir}/package.json`));
  const names = Object.keys({ ...dependencies, ...devDependencies, ...peerDependencies });

  uses.set(dir, mentions(names.join(' ')));
}

const changed = execFileSync('git', ['diff', '--name-only', `${base}...${head}`], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

const direct = new Set<string>();
let everything = false;

for (const file of changed) {
  const inPackage = file.match(/^packages\/([^/]+)\//);
  const isRootDoc = !file.includes('/') && file.endsWith('.md');
  const isQuiet = QUIET.some(prefix => file.startsWith(prefix));
  const isConsumer = Object.values(CONSUMERS).some(({ dir }) => dir && file.startsWith(dir));

  if (inPackage && dirs.includes(inPackage[1]))
    direct.add(inPackage[1]);
  else if (!isRootDoc && !isQuiet && !isConsumer)
    everything = true;
}

const affected = new Set(everything ? dirs : direct);

for (let grew = true; grew; ) {
  grew = false;

  for (const [dir, deps] of uses)
    if (!affected.has(dir) && [...deps].some(dep => affected.has(dep))) {
      affected.add(dir);
      grew = true;
    }
}

const touches = (job: keyof typeof CONSUMERS) => {
  const { dir, reads } = CONSUMERS[job];
  const deps = mentions(reads.map(read).join('\n'));
  const ownChange = !!dir && changed.some(file => file.startsWith(dir));

  return everything || ownChange || [...deps].some(dep => affected.has(dep));
};

const packages = [...affected].sort();
const outputs = {
  packages: packages.map(dir => `--filter=./packages/${dir}`).join(' '),
  any: String(packages.length > 0),
  e2e: String(touches('e2e')),
  hot: String(touches('hot')),
  dev: String(affected.has('dev')),
  rpc: String(affected.has('rpc'))
};

console.log(`Changed against ${base}:\n${changed.map(file => `  ${file}`).join('\n') || '  (none)'}\n`);
console.log(everything ? 'Shared file changed - every package affected.\n' : '');
console.log(Object.entries(outputs).map(([key, value]) => `${key}: ${value}`).join('\n'));

if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(''));
