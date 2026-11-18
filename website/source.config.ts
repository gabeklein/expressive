import { defineConfig, defineDocs } from 'fumadocs-mdx/config';
import { readFileSync } from 'fs';
import { resolve } from 'path';

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    postprocess: {
      includeProcessedMarkdown: true
    }
  }
});

type Node = {
  type: string;
  name?: string;
  value?: string;
  attributes?: { name: string; value: unknown }[];
  children?: Node[];
};

function readSizes(): Record<string, number> | null {
  try {
    return JSON.parse(readFileSync(resolve(process.cwd(), '../size-report.json'), 'utf8'));
  } catch {
    return null;
  }
}

function remarkSize() {
  return (tree: Node) => {
    const sizes = readSizes();

    const bytes = (shape: unknown) => {
      if (!sizes) return undefined;
      if (typeof shape !== 'string' || !(shape in sizes))
        throw new Error(`No import shape "${shape}" in size-report.json.`);
      return sizes[shape];
    };

    const text = (node: Node) => {
      const attr = (name: string) => node.attributes?.find((a) => a.name === name)?.value;
      const total = bytes(attr('of'));
      const minus = attr('minus');
      const less = minus === undefined ? 0 : bytes(minus);

      return total === undefined || less === undefined
        ? '? kB'
        : `~${((total - less) / 1024).toFixed(1)} kB`;
    };

    const walk = (node: Node) => {
      node.children?.forEach((child, index) => {
        if (child.type.startsWith('mdxJsx') && child.name === 'Size')
          node.children![index] = { type: 'text', value: text(child) };
        else walk(child);
      });
    };

    walk(tree);
  };
}

export default defineConfig({
  mdxOptions: {
    remarkPlugins: (plugins) => [remarkSize, ...plugins]
  }
});
