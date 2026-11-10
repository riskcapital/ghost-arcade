import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NATIVE_EFFECT_PASS_MANIFEST } from './nativeEffectPass';

// The sync gates every effect chain on the core's table (id + code must match
// exactly), and the broker overlays its own list on cores that predate an
// effect. A pass added on one side only is silently refused natively, so the
// three tables are checked against each other here, without a core binary.
const root = process.cwd();

function coreManifest() {
  const source = readFileSync(join(root, 'native-renderer', 'src', 'capabilities.rs'), 'utf8');
  const start = source.indexOf('pub fn native_effect_pass_manifest()');
  expect(start).toBeGreaterThan(0);
  const body = source.slice(start, source.indexOf('])', start));
  const rows = [...body.matchAll(/\{"id": "([^"]+)", "code": (\d+), "default_amount": ([-\d.]+), "amount_min": ([-\d.]+), "amount_max": ([-\d.]+)\}/g)];
  return rows.map((m) => ({ id: m[1], code: Number(m[2]), defaultAmount: Number(m[3]), amountMin: Number(m[4]), amountMax: Number(m[5]) }));
}

function brokerDescriptors() {
  const source = readFileSync(join(root, 'electron', 'native-renderer-broker.js'), 'utf8');
  const start = source.indexOf('const NATIVE_EFFECT_PASS_DESCRIPTORS = [');
  expect(start).toBeGreaterThan(0);
  const body = source.slice(start, source.indexOf('];', start));
  return [...body.matchAll(/\{ id: '([^']+)', code: (\d+) \}/g)].map((m) => ({ id: m[1], code: Number(m[2]) }));
}

describe('native effect pass manifest', () => {
  it('core capabilities table matches the editor manifest exactly', () => {
    const core = coreManifest();
    // Order does not matter to the sync (it looks entries up by id).
    const byCode = <T extends { code: number }>(rows: T[]) => [...rows].sort((a, b) => a.code - b.code);
    expect(core.length).toBe(NATIVE_EFFECT_PASS_MANIFEST.length);
    expect(byCode(core)).toEqual(byCode(NATIVE_EFFECT_PASS_MANIFEST.map(({ id, code, defaultAmount, amountMin, amountMax }) => ({ id, code, defaultAmount, amountMin, amountMax }))));
  });

  it('broker overlay lists the same ids and codes', () => {
    const byCode = <T extends { code: number }>(rows: T[]) => [...rows].sort((a, b) => a.code - b.code);
    expect(byCode(brokerDescriptors())).toEqual(byCode(NATIVE_EFFECT_PASS_MANIFEST.map(({ id, code }) => ({ id, code }))));
  });
});
