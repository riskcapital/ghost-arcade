import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Saved screen setups exist because the new-project reset is right for a
 * touring laptop and wrong for a permanent install. A dome should not be
 * re-aimed every time someone starts a show.
 *
 * The behaviour worth pinning is the round trip — what is captured comes back
 * — and that a default actually reaches New Project, since a default nothing
 * consults is the same as no default at all.
 */

const liveOutput: Record<string, unknown> = {};

vi.mock('./settings', () => ({
  settings: {
    captureOutputStage: () => structuredClone(liveOutput),
    applyOutputStage: (snap: Record<string, unknown>) => Object.assign(liveOutput, structuredClone(snap)),
  },
}));

let screenSetups: typeof import('./screenSetups').screenSetups;

beforeEach(async () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  };
  vi.resetModules();
  ({ screenSetups } = await import('./screenSetups'));
  for (const key of Object.keys(liveOutput)) delete liveOutput[key];
  Object.assign(liveOutput, {
    slices: [{ id: 'a' }, { id: 'b' }],
    domeEnabled: true,
    domeFOV: 210,
    edgeBlendLeft: 0.2,
  });
});

describe('saved screen setups', () => {
  it('restores exactly what was captured', () => {
    screenSetups.save('Planetarium');

    // Someone tears the rig down for a different show.
    Object.assign(liveOutput, { slices: [], domeEnabled: false, domeFOV: 180, edgeBlendLeft: 0 });

    let saved: any;
    screenSetups.subscribe(s => { saved = s.saved[0]; })();
    expect(screenSetups.load(saved.id)).toBe(true);

    expect(liveOutput.domeEnabled).toBe(true);
    expect(liveOutput.domeFOV).toBe(210);
    expect(liveOutput.edgeBlendLeft).toBe(0.2);
    expect(liveOutput.slices).toHaveLength(2);
  });

  it('hands New Project the default snapshot', () => {
    expect(screenSetups.defaultSnapshot()).toBeNull();
    screenSetups.setCurrentAsDefault('Dome');
    expect(screenSetups.defaultSnapshot()).toMatchObject({ domeEnabled: true, domeFOV: 210 });
  });

  it('does not alias the live settings object', () => {
    // A snapshot holding a reference rather than a copy would be rewritten by
    // the very reset it exists to survive.
    screenSetups.setCurrentAsDefault('Dome');
    (liveOutput.slices as unknown[]).length = 0;
    liveOutput.domeEnabled = false;

    expect(screenSetups.defaultSnapshot()).toMatchObject({ domeEnabled: true });
    expect((screenSetups.defaultSnapshot() as any).slices).toHaveLength(2);
  });

  it('stops using a deleted setup as the default', () => {
    screenSetups.save('Club');
    let saved: any;
    screenSetups.subscribe(s => { saved = s.saved[0]; })();
    screenSetups.setDefaultFromSaved(saved.id);
    expect(screenSetups.defaultSnapshot()).not.toBeNull();

    // Otherwise New Project keeps restoring something the user cannot see.
    screenSetups.remove(saved.id);
    expect(screenSetups.defaultSnapshot()).toBeNull();
  });

  it('survives a reload', () => {
    screenSetups.setCurrentAsDefault('Dome');
    screenSetups.save('Club');
    let before: any;
    screenSetups.subscribe(s => { before = s; })();

    // The point of a default is that it outlives the session that set it.
    vi.resetModules();
    return import('./screenSetups').then(({ screenSetups: reloaded }) => {
      let after: any;
      reloaded.subscribe(s => { after = s; })();
      expect(after.defaultSetup?.name).toBe('Dome');
      expect(after.saved).toHaveLength(before.saved.length);
    });
  });
});

describe('wiring', () => {
  it('New Project asks for the default setup', () => {
    // A default that nothing consults is no default at all.
    const app = readFileSync(join(process.cwd(), 'src', 'App.svelte'), 'utf8');
    const start = app.indexOf('function newProjectConfirm()');
    const body = app.slice(start, app.indexOf('\n  }', start));
    expect(body).toContain('resetOutputStageForNewProject(screenSetups.defaultSnapshot())');
  });
});
