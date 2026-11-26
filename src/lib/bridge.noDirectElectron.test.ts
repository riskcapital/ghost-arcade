import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Every renderer call into Electron goes through src/lib/bridge.ts so the
// transport can be swapped in one place.
const SRC = join(process.cwd(), 'src');
const BRIDGE = join(SRC, 'lib', 'bridge.ts');
const PATTERN = /\.electronAPI\b|\.ghostNDI\b|\bghostNDI\?*\./;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules') continue;
      walk(full, out);
    } else if (/\.(ts|js|svelte)$/.test(name) && !/\.(test|spec)\.[tj]s$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe('bridge centralisation', () => {
  it('no file outside src/lib/bridge touches window.electronAPI or window.ghostNDI', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (file === BRIDGE || file.startsWith(join(SRC, 'lib', 'bridge') + sep)) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const code = line.trim();
        if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
        if (PATTERN.test(line)) offenders.push(`${relative(process.cwd(), file)}:${i + 1}: ${code}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
