/**
 * Auto show's content: the cast a show picks from the catalog (small, by the
 * song's tiers, one mood, few costly ones), section tiers by style, and the
 * user's own videos tiered by name or by how they move.
 */
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../score/scoreDraft';
import { AUTO_SHOW_CATALOG } from './catalogData';
import { castFromContent, paletteFor, pickCast, pickMember, sectionTier, type AutoShowContent } from './catalog';
import { libraryCast, tierFromMeasure, tierFromName } from './libraryVideos';
import type { MediaItem } from '../../stores/media';

describe('the catalog', () => {
  it('every entry is well formed: a shader file or a Look, tiers, moods, a variant per mood it lists', () => {
    const ids = new Set<string>();
    for (const c of AUTO_SHOW_CATALOG) {
      expect(ids.has(c.id)).toBe(false);
      ids.add(c.id);
      expect(c.kind === 'shader' ? /\.fs$/.test(c.ref) : c.ref.length > 0).toBe(true);
      expect(c.tiers.length).toBeGreaterThan(0);
      expect(c.scale.length).toBeGreaterThan(0);
    }
    expect(AUTO_SHOW_CATALOG.length).toBeGreaterThanOrEqual(8);
  });

  it('a cast of 4–8 for the tiers the song uses, at most one costly content, the mood\'s colours', () => {
    const cast = pickCast(AUTO_SHOW_CATALOG, 'cool', seededRandom(3), { tiers: { calm: 60, groove: 40, drive: 30, peak: 60 } });
    expect(cast.length).toBeGreaterThanOrEqual(4);
    expect(cast.length).toBeLessThanOrEqual(8);
    expect(cast.filter((c) => c.cost === 'high').length).toBeLessThanOrEqual(1);
    for (const t of ['calm', 'groove', 'drive', 'peak'] as const) expect(cast.some((c) => c.tiers.includes(t))).toBe(true);
    expect(cast.some((c) => c.scale.includes('span'))).toBe(true);
    // The same seed, the same cast.
    expect(pickCast(AUTO_SHOW_CATALOG, 'cool', seededRandom(3), { tiers: { calm: 60, groove: 40, drive: 30, peak: 60 } }).map((c) => c.id)).toEqual(cast.map((c) => c.id));
    const entry: AutoShowContent = { id: 'x', kind: 'shader', ref: 'GA2-X.fs', tiers: ['calm'], moods: ['cool'], texture: 'organic', scale: ['span'], params: { a: 1 }, variants: [{ mood: 'warm', params: { colorMode: 2 } }] };
    expect(castFromContent(entry, 'warm').params).toEqual({ a: 1, colorMode: 2 });
    expect(castFromContent(entry, 'cool').params).toEqual({ a: 1 });
    expect(castFromContent(entry, 'cool').name).toBe('X');
  });

  it('a member never repeats what it must avoid, and prefers the tier and scale asked', () => {
    const cast = pickCast(AUTO_SHOW_CATALOG, 'warm', seededRandom(9), { tiers: { calm: 1, peak: 1 } });
    const rnd = seededRandom(1);
    const peak = pickMember(cast, 'peak', rnd)!;
    expect(peak.tiers).toContain('peak');
    const other = pickMember(cast, 'peak', rnd, { avoid: [peak.id] })!;
    expect(other.id).not.toBe(peak.id);
    expect(pickMember(cast, 'calm', rnd, { scale: 'span' })!.scale).toContain('span');
  });

  it('section tiers follow the style: Chill tops out at groove, Hard verses drive, Cinematic drops drive', () => {
    expect(sectionTier('drop', 1, 'driving')).toBe('peak');
    expect(sectionTier('drop', 1, 'chill')).toBe('groove');
    expect(sectionTier('verse', 0.5, 'hard')).toBe('drive');
    expect(sectionTier('drop', 1, 'cinematic')).toBe('drive');
    expect(sectionTier('breakdown', 0.2, 'hard')).toBe('calm');
    expect(paletteFor('warm')).toMatchObject({ mood: 'warm', accent: 'acid', looks: { calm: 'sunset', loud: 'fire' } });
  });
});

describe('My library', () => {
  it('tiers a video by its name or folder, else by how it moves and how bright it is', async () => {
    expect(tierFromName('Big drop 03.mov')).toBe('peak');
    expect(tierFromName('loop_12', '/Packs/Calm/loop_12.mov')).toBe('calm');
    expect(tierFromName('riser-a')).toBe('drive');
    expect(tierFromName('clip 7')).toBeNull();
    expect(tierFromMeasure({ motion: 0.2, brightness: 0.6 })).toBe('peak');
    expect(tierFromMeasure({ motion: 0.01, brightness: 0.1 })).toBe('calm');
    const items = [
      { id: 'a', name: 'drop.mp4', src: 'file:///a.mp4', type: 'video' },
      { id: 'b', name: 'clip.mp4', src: 'file:///b.mp4', type: 'video', durationSeconds: 8 },
      { id: 'c', name: 'pack.mov', src: 'file:///c.mov', type: 'video' },
      { id: 'd', name: 'still.png', src: 'file:///d.png', type: 'image' },
    ] as MediaItem[];
    const measured: string[] = [];
    const cast = await libraryCast(items, async (src) => { measured.push(src); return { motion: 0.02, brightness: 0.2 }; });
    expect(cast.map((c) => c.id)).toEqual(['library:a', 'library:b', 'library:c']);
    expect(cast[0].tiers).toContain('peak');
    expect(cast[1].tiers).toContain('calm');
    // A HAP .mov the page cannot decode, with a name that says nothing: the middle.
    expect(cast[2].tiers).toEqual(['groove']);
    expect(measured).toEqual(['file:///b.mp4']);
    expect(cast[1].video).toMatchObject({ src: 'file:///b.mp4', seconds: 8 });
  });
});
