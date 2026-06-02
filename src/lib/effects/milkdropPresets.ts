// Butterchurn preset pack loader.
//
// The butterchurn-presets package ships multiple UMD bundles, each holding
// a different slice of the preset library. We lazy-load them so a layer
// that never opens "extra" doesn't pull its ~3 MB into the main bundle.
//
// Each module exports a `getPresets()` (and sometimes `getPresetsExtra2()`)
// that returns a Record<presetName, presetObject>.

export type MilkdropPresetPack = 'minimal' | 'full' | 'extra' | 'extra2' | 'md1';

interface PackModule {
  getPresets?: () => Record<string, any>;
  default?: { getPresets?: () => Record<string, any> };
}

const packCache = new Map<MilkdropPresetPack, Record<string, any>>();

export async function loadPresetPack(pack: MilkdropPresetPack): Promise<Record<string, any>> {
  const cached = packCache.get(pack);
  if (cached) return cached;

  let mod: PackModule;
  switch (pack) {
    case 'minimal':
      mod = await import('butterchurn-presets/lib/butterchurnPresetsMinimal.min.js');
      break;
    case 'extra':
      mod = await import('butterchurn-presets/lib/butterchurnPresetsExtra.min.js');
      break;
    case 'extra2':
      mod = await import('butterchurn-presets/lib/butterchurnPresetsExtra2.min.js');
      break;
    case 'md1':
      mod = await import('butterchurn-presets/lib/butterchurnPresetsMD1.min.js');
      break;
    case 'full':
    default:
      mod = await import('butterchurn-presets');
      break;
  }

  // UMD interop: the bundle may be reachable via default or as the module itself.
  const getter = mod.getPresets ?? mod.default?.getPresets;
  const presets = getter ? getter() : {};
  packCache.set(pack, presets);
  return presets;
}

/** Pick the next preset name from a pack, optionally avoiding the current one. */
export function pickNextPreset(presets: Record<string, any>, current: string | null): string | null {
  const names = Object.keys(presets);
  if (names.length === 0) return null;
  if (names.length === 1) return names[0];
  let next: string;
  let tries = 0;
  do {
    next = names[Math.floor(Math.random() * names.length)];
    tries++;
  } while (next === current && tries < 8);
  return next;
}
