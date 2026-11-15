declare const __LIB_SIZES__: Record<string, number> | null;

export const sizes = __LIB_SIZES__;

function bytes(shape: string) {
  const value = sizes?.[shape];

  if (sizes && value === undefined)
    throw new Error(`No import shape "${shape}" in size-report.json.`);

  return value;
}

export function Size({ of, minus }: { of: string; minus?: string }) {
  const total = bytes(of);
  const less = minus ? bytes(minus) : 0;

  if (total === undefined || less === undefined) return '? kB';

  return `~${((total - less) / 1024).toFixed(1)} kB`;
}
