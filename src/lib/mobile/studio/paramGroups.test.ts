import { describe, expect, it } from 'vitest';
import { defaultOpenGroups, groupParams, paramGroupOf, paramLabel, paramWords, pinnedParams } from './paramGroups';

const float = (NAME: string, LABEL?: string) => ({ NAME, LABEL, TYPE: 'float' });

// The inputs of the featured clip "Tide": the long flat list the review measured (35 sliders).
const TIDE = [
  float('audioGain', 'Audio Sensitivity'), float('bassToBloom', 'Bass → Emission'), float('midToFlow', 'Mid → Flow Pace'), float('trebToPalette', 'Treble → Palette Pace'),
  float('energyToWarp', 'Energy → Warp'), float('smoothness', 'Response Smoothness'), float('bassLo', 'Bass Band Lo'), float('bassHi', 'Bass Band Hi'), float('midLo', 'Mid Band Lo'),
  float('midHi', 'Mid Band Hi'), float('trebLo', 'Treble Band Lo'), float('trebHi', 'Treble Band Hi'), float('worldDrift', 'Forward Drift'), float('flowSpeed', 'Base Flow Speed'),
  float('warpAmount', 'Warp Amount'), float('warpDecay', 'Warp Decay'), float('currents', 'Currents'), float('fieldScale', 'Field Scale'), float('densityCutoff', 'Density Cutoff'),
  float('softness', 'Cloud Softness'), float('emissionAmount', 'Emission'), float('absorption', 'Self Absorption'), float('paletteSpeed', 'Base Palette Pace'), float('paletteSpread', 'Palette Spread'),
  float('paletteShift', 'Palette Shift'), float('voidTint', 'Void Tint'), float('voidLevel', 'Void Glow'), float('fov', 'Field of View'), float('orbitSpeed', 'Camera Yaw'),
  float('camTilt', 'Camera Tilt'), float('saturation', 'Saturation'), float('contrast', 'Contrast'), float('gamma', 'Gamma'), float('vignette', 'Vignette'), float('grain', 'Film Grain'),
];

describe('parameter sections', () => {
  it('splits code names and labels into words', () => {
    expect(paramWords('bassToBloom')).toEqual(['bass', 'to', 'bloom']);
    expect(paramWords('Bass → Emission')).toEqual(['bass', 'emission']);
    expect(paramWords('trail_length2')).toEqual(['trail', 'length']);
  });

  it('files a parameter under Audio, Colour, Motion or Look', () => {
    expect(paramGroupOf(float('bassToBloom', 'Bass → Emission'))).toBe('audio');
    expect(paramGroupOf(float('audioGain', 'Audio Sensitivity'))).toBe('audio');
    expect(paramGroupOf(float('energyToWarp'))).toBe('audio');
    expect(paramGroupOf({ NAME: 'bgColor', LABEL: 'Background', TYPE: 'color' })).toBe('colour');
    expect(paramGroupOf(float('colorShift'))).toBe('colour');
    expect(paramGroupOf(float('saturation'))).toBe('colour');
    expect(paramGroupOf(float('orbitSpeed', 'Camera Yaw'))).toBe('motion');
    expect(paramGroupOf(float('speed'))).toBe('motion');
    expect(paramGroupOf(float('trailLength'))).toBe('look');
    expect(paramGroupOf(float('plasmaEnergy', 'Plasma Energy'))).toBe('look');
  });

  it('turns the 35 flat sliders of Tide into pinned controls and four sections', () => {
    const { pinned, groups } = groupParams(TIDE);
    expect(pinned.length).toBe(4);
    // Nothing audio is pinned, and the pins keep the order the shader declares.
    expect(pinned.every((p) => paramGroupOf(p) !== 'audio')).toBe(true);
    expect(pinned.map((p) => TIDE.indexOf(p))).toEqual([...pinned.map((p) => TIDE.indexOf(p))].sort((a, b) => a - b));
    expect(pinned.map((p) => p.NAME)).toContain('flowSpeed');
    expect(groups.map((g) => g.id)).toEqual(['look', 'motion', 'colour', 'audio']);
    const audio = groups.find((g) => g.id === 'audio')!;
    expect(audio.params.length).toBe(12);
    // Every parameter appears exactly once.
    const all = [...pinned, ...groups.flatMap((g) => g.params)];
    expect(all.length).toBe(TIDE.length);
    expect(new Set(all).size).toBe(TIDE.length);
    // No section is longer than the old flat list was by itself.
    expect(Math.max(...groups.map((g) => g.params.length))).toBeLessThanOrEqual(12);
  });

  it('opens only Look for a long clip and everything for a short one', () => {
    const long = groupParams(TIDE);
    expect([...defaultOpenGroups(long.groups, long.pinned.length)]).toEqual(['look']);
    const short = groupParams([float('speed'), float('zoom'), float('colorShift'), float('trailLength')]);
    expect(short.pinned).toEqual([]);
    expect(defaultOpenGroups(short.groups, 0).size).toBe(short.groups.length);
  });

  it('pins sliders only, never switches, menus or colours', () => {
    const params = [
      { NAME: 'effectStyle', TYPE: 'long', VALUES: [0, 1, 2] }, { NAME: 'invert', TYPE: 'bool' }, { NAME: 'bgColor', TYPE: 'color' },
      float('speed'), float('zoom'), float('trailLength'), float('colorShift'), float('svPump'), float('svChaos'), float('svGlow'),
    ];
    const pins = pinnedParams(params);
    expect(pins.map((p) => p.NAME)).toEqual(['speed', 'zoom', 'colorShift', 'svGlow']);
  });

  it('gives code names a readable label', () => {
    expect(paramLabel({ NAME: 'trailLength' })).toBe('Trail length');
    expect(paramLabel({ NAME: 'colorShift' })).toBe('Color shift');
    expect(paramLabel({ NAME: 'svPump' })).toBe('Boost pump');
    expect(paramLabel({ NAME: 'fov', LABEL: 'Field of View' })).toBe('Field of View');
    expect(paramLabel({ NAME: 'speed' })).toBe('Speed');
  });
});
