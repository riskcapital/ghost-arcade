import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
  addCustomEffect,
  clearCustomEffects,
  communityEffectVersions,
  customCatalogEntries,
  customEffects,
  installCommunityEffect,
  parseDMFX,
  registerBuiltinTypes,
  removeCommunityEffect,
} from './customEffects';

function file(type: string, label = 'Soft Tint'): string {
  return JSON.stringify({
    version: 1,
    type,
    label,
    category: 'Color',
    description: 'Washes the layer in a color.',
    previewCSS: '#f0f',
    params: [{ param: 'uAmount', name: 'Amount', type: 'slider', min: 0, max: 1, default: 0.5 }],
    shader: 'uniform sampler2D uTexture;\nuniform float uAmount;\nvarying vec2 vUv;\nvoid main(){ gl_FragColor = texture2D(uTexture, vUv) * uAmount; }\n',
  });
}

const origin = (id: string, version = 1) => ({ id, version, licence: 'MIT' as const, authorUrl: 'https://ghostarcade.live/artists/neon-kite' });

describe('community effects', () => {
  beforeEach(() => {
    clearCustomEffects();
    registerBuiltinTypes(['blur']);
  });

  it('installs an effect with its credit, shown in the picker', () => {
    expect(installCommunityEffect(file('soft-tint'), origin('c1'), { author: 'Neon Kite' })).toBeNull();
    const [effect] = get(customEffects);
    expect(effect).toMatchObject({ type: 'soft-tint', author: 'Neon Kite', community: { id: 'c1', version: 1 } });
    expect(communityEffectVersions()).toEqual(new Map([['c1', 1]]));
    expect(get(customCatalogEntries)[0].description).toBe('Washes the layer in a color. By Neon Kite.');
  });

  it('never replaces one of the user\'s own effects, a built-in, or another community effect', () => {
    addCustomEffect(parseDMFX(file('mine')).effect!);
    expect(installCommunityEffect(file('mine'), origin('c1'), {})).toMatch(/one of your own effects/);
    expect(installCommunityEffect(file('blur'), origin('c2'), {})).toMatch(/built-in/);
    expect(installCommunityEffect(file('shared'), origin('c3'), {})).toBeNull();
    expect(installCommunityEffect(file('shared'), origin('c4'), {})).toMatch(/another community effect/);
    expect(get(customEffects).map((e) => e.type).sort()).toEqual(['mine', 'shared']);
  });

  it('updates in place, follows a renamed type, and is removed when taken down', () => {
    installCommunityEffect(file('soft-tint'), origin('c1'), {});
    expect(installCommunityEffect(file('soft-tint', 'Softer Tint'), origin('c1', 2), {})).toBeNull();
    expect(get(customEffects).map((e) => [e.type, e.label])).toEqual([['soft-tint', 'Softer Tint']]);

    expect(installCommunityEffect(file('soft-tint-2'), origin('c1', 3), {})).toBeNull();
    expect(get(customEffects).map((e) => e.type)).toEqual(['soft-tint-2']);

    removeCommunityEffect('c1');
    expect(get(customEffects)).toEqual([]);
  });

  it('turns down a file the app cannot read', () => {
    expect(installCommunityEffect('{"version":1}', origin('c1'), {})).toBeTruthy();
    expect(get(customEffects)).toEqual([]);
  });
});
