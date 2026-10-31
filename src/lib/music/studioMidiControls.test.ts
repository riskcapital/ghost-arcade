/**
 * The studio's controls for MIDI are registered by the runtime itself, so
 * they answer with the Studio view hidden. Loads the real runtime.
 */

import { beforeAll, describe, expect, it } from 'vitest';

let controls: typeof import('./studioMidiControls');
let registry: typeof import('./studioControls');

function installShim(): void {
  const storage = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, String(v)),
    removeItem: (k: string) => void storage.delete(k),
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
  };
  const el = (): any => ({
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
    dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    appendChild: (c: any) => c, removeChild: (c: any) => c,
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], getContext: () => null,
  });
  (globalThis as any).document = {
    documentElement: el(), body: el(), head: el(), createElement: () => el(),
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    addEventListener() {}, removeEventListener() {}, visibilityState: 'visible',
  };
  (globalThis as any).window = globalThis;
  (globalThis as any).dispatchEvent = () => true;
  (globalThis as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  (globalThis as any).requestAnimationFrame = () => 0;
  (globalThis as any).cancelAnimationFrame = () => {};
}

beforeAll(async () => {
  installShim();
  // Importing the runtime is what registers them.
  await import('./musicRuntime');
  controls = await import('./studioMidiControls');
  registry = await import('./studioControls');
});

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('the studio controls a controller can learn', () => {
  it('are registered once the runtime loads', () => {
    const expected = [
      'band.throw', 'band.wash', 'band.freeze', 'band.listen', 'band.echo-send', 'band.verb-send', 'band.return',
      'band.inputs', 'band.duck', 'band.duck-release', 'band.follow-bass',
      ...range(4).flatMap((n) => [`input.${n}.level`, `input.${n}.fx-send`]),
      ...range(8).map((n) => `pad.${n}`),
      ...range(5).map((n) => `bowl.${n}`),
      ...range(6).flatMap((n) => ['level', 'look-next', 'look-prev', 'mute', 'follow-next'].map((c) => `voice.${n}.${c}`)),
      'visuals.scene-next', 'visuals.scene-prev', 'studio.kill', 'studio.play',
    ];
    expect(controls.STUDIO_MIDI_CONTROLS.map((c) => c.id)).toEqual(expected);
    const registered = new Set(registry.studioControls().map((c) => c.id));
    for (const id of expected) expect(registered.has(id), id).toBe(true);
  });

  it('leave songs, the view switch and the looper to their own code', () => {
    for (const { id } of controls.STUDIO_MIDI_CONTROLS) {
      expect(id.startsWith('song.') || id.startsWith('looper.') || id === 'studio.view').toBe(false);
    }
  });

  it('play holds as holds, freezes as toggles, pads as triggers and knobs as values', () => {
    const kind = (id: string) => registry.studioControl(id)?.kind;
    expect([kind('band.throw'), kind('band.wash'), kind('band.freeze'), kind('band.listen')]).toEqual(['hold', 'hold', 'toggle', 'toggle']);
    expect([kind('pad.1'), kind('bowl.1'), kind('voice.3.level'), kind('voice.3.mute'), kind('studio.play')]).toEqual(['trigger', 'hold', 'value', 'toggle', 'toggle']);
    expect(registry.studioControl('band.echo-send')?.label).toBe('Echo send');
  });

  it('step a voice through the looks as the picker lists them, going round', () => {
    const first = controls.nextVoiceLook('', 1);
    const second = controls.nextVoiceLook(first, 1);
    expect(second).not.toBe(first);
    expect(controls.nextVoiceLook(second, -1)).toBe(first);
    expect(controls.nextVoiceLook(first, -1)).toBe(controls.nextVoiceLook('', -1));
    expect(controls.nextVoiceSource('fx')).toBe('played');
    expect(controls.nextVoiceSource('played')).toBe('all');
  });

  it('mute a voice and bring it back at its level', () => {
    expect(controls.toggledVoiceLevel(0, 0.6)).toBe(0);
    expect(controls.toggledVoiceLevel(0, 0)).toBe(0.6);
    expect(controls.toggledVoiceLevel(1, 0)).toBe(1);
  });
});
