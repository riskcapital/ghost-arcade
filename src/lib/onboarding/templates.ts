/**
 * Starter templates — ready-made projects a new user can open instead of a
 * blank screen. Each one is built from the shader library at the moment it
 * is chosen rather than stored as a project file, so a template always
 * matches the current project format and shader set.
 */
import { get } from 'svelte/store';
import { generateUUID } from '../utils/uuid';
import { project } from '../stores/layers';
import { vjClipLauncher, type VJClip, type VJDeck } from '../stores/vjClipLauncher';
import type { WarpCorners } from '../types';

export interface StarterTemplate {
  id: string;
  name: string;
  /** Who it is for, in a few words. */
  audience: string;
  description: string;
  /** Library shader shown as the card picture. */
  cover: string;
  mode: 'vj' | 'mapping';
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: 'band-stage',
    name: 'Band on stage',
    audience: 'Projecting across a band',
    description: 'Concert lighting looks on a deck ready to play to the music: beams, gobos, washes, followspot, strobe and mirror ball.',
    cover: 'STAGE-BeamRig.fs',
    mode: 'vj',
  },
  {
    id: 'club-vj',
    name: 'Club VJ set',
    audience: 'DJ nights and parties',
    description: 'Two decks of flagship visuals with the crossfader on and launches locked to the bar.',
    cover: 'Featured-tide.fs',
    mode: 'vj',
  },
  {
    id: 'psychedelic',
    name: 'Psychedelic night',
    audience: 'Liquid light shows',
    description: 'Oil wheels, acid flows, tie-dye and form constants for a classic liquid light show.',
    cover: 'PSY-OilWheel.fs',
    mode: 'vj',
  },
  {
    id: 'mapping-starter',
    name: 'Projection mapping starter',
    audience: 'Mapping onto objects and walls',
    description: 'Three surfaces with test patterns, ready to drag their corners onto your real objects.',
    cover: 'DM-TestPattern.fs',
    mode: 'mapping',
  },
];

/** Deck layouts: one row of shader files per deck row. */
const DECKS: Record<string, { A: string[][]; B?: string[][]; crossfader?: boolean }> = {
  'band-stage': {
    A: [
      ['STAGE-BeamRig', 'STAGE-GoboSpots', 'STAGE-LightCurtain', 'STAGE-Followspot'],
      ['STAGE-ColourWash', 'STAGE-LiquidSky', 'STAGE-Blinders'],
      ['STAGE-Strobe', 'STAGE-MirrorBall'],
      ['GA2-Eclipse', 'GA2-Lightbox', 'GA2-ColouredShadows'],
    ],
  },
  'club-vj': {
    crossfader: true,
    A: [
      ['Featured-tide', 'Featured-prism', 'Featured-pulse', 'Featured-aurora'],
      ['GA2-Quasicrystal', 'GA2-HopfFibration', 'GA2-Apollonian', 'GA2-CircleLimit'],
      ['STAGE-BeamRig', 'STAGE-Strobe'],
    ],
    B: [
      ['Featured-lumenveil', 'Featured-crystallon', 'Featured-dispersion', 'Featured-drift'],
      ['GA2-PhasePortrait', 'GA2-SoftCells', 'GA2-Murmuration', 'GA2-Kakeya'],
      ['STAGE-GoboSpots', 'STAGE-MirrorBall'],
    ],
  },
  psychedelic: {
    A: [
      ['PSY-OilWheel', 'PSY-OilSlick', 'PSY-AcidFlow'],
      ['PSY-TieDye', 'PSY-Chrysanthemum', 'PSY-FormConstants'],
      ['GA2-DriftVeil', 'GA2-SoftCells'],
    ],
  },
};

function shaderName(file: string): string {
  const base = file.replace(/\.fs$/, '').replace(/^(STAGE|GA2|PSY|DM|Featured)-/, '');
  return base.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

export function templateCoverUrl(template: StarterTemplate): string {
  return `./ISF/thumbnails/${encodeURIComponent(template.cover.replace(/\.fs$/, '.jpg'))}`;
}

async function loadShader(base: string): Promise<{ src: string; code: string; thumbnail: string } | null> {
  const file = `${base}.fs`;
  const src = `./ISF/${encodeURIComponent(file)}`;
  try {
    const response = await fetch(src);
    if (!response.ok) return null;
    return { src, code: await response.text(), thumbnail: `./ISF/thumbnails/${encodeURIComponent(`${base}.jpg`)}` };
  } catch {
    return null;
  }
}

async function fillDeck(rows: string[][], deck: VJDeck, firstRow = 0): Promise<void> {
  for (const [offset, row] of rows.entries()) {
    const rowIndex = firstRow + offset;
    for (const [column, base] of row.entries()) {
      if (!base) continue;
      const shader = await loadShader(base);
      if (!shader) continue;
      const clip: VJClip = {
        id: generateUUID(),
        type: 'shader',
        name: shaderName(base),
        src: shader.src,
        thumbnail: shader.thumbnail,
        shaderCode: shader.code,
        shaderValues: {},
      };
      vjClipLauncher.setClip(rowIndex, column, clip, deck);
    }
  }
}

/** Put one library shader into a deck cell (used by the guided tour). */
export async function addLibraryShaderToDeck(base: string, row: number, column: number, deck: VJDeck = 'A'): Promise<boolean> {
  await fillDeck([[...Array(column).fill(''), base]], deck, row);
  return !!get(vjClipLauncher)[deck === 'B' ? 'bankBClipGrid' : 'clipGrid'][row]?.[column];
}

function region(x0: number, x1: number, y0: number, y1: number): WarpCorners {
  // Corner space is [0,1] with y = 1 at the top.
  return {
    topLeft: { x: x0, y: y1 },
    topRight: { x: x1, y: y1 },
    bottomLeft: { x: x0, y: y0 },
    bottomRight: { x: x1, y: y0 },
  } as WarpCorners;
}

/** Add one test-pattern surface for mapping (used by the guided tour). */
export async function addMappingSurface(name = 'Surface 1'): Promise<boolean> {
  const shader = await loadShader('DM-TestPattern');
  const id = project.addLayer(name, 'media');
  if (!id || !shader) return false;
  project.setLayerSource(id, {
    id: `DM-TestPattern-${id}`,
    type: 'shader',
    src: shader.src,
    name: shaderName('DM-TestPattern'),
    shaderCode: shader.code,
    shaderValues: {},
  } as any);
  project.updateLayer(id, { corners: region(0.25, 0.75, 0.22, 0.78) });
  return true;
}

async function buildMappingStarter(): Promise<void> {
  const surfaces: Array<[string, string, WarpCorners]> = [
    ['Surface 1', 'DM-TestPattern', region(0.06, 0.36, 0.3, 0.75)],
    ['Surface 2', 'DM-UVGrid', region(0.4, 0.62, 0.15, 0.85)],
    ['Surface 3', 'DM-GridMatrix', region(0.66, 0.94, 0.35, 0.7)],
  ];
  for (const [name, base, corners] of surfaces) {
    const shader = await loadShader(base);
    const id = project.addLayer(name, 'media');
    if (!id || !shader) continue;
    project.setLayerSource(id, {
      id: `${base}-${id}`,
      type: 'shader',
      src: shader.src,
      name: shaderName(base),
      shaderCode: shader.code,
      shaderValues: {},
    } as any);
    project.updateLayer(id, { corners });
  }
}

/**
 * Open a template. `startFresh` clears the current project the same way
 * File → New does, so nothing from the previous project leaks in.
 */
export async function applyStarterTemplate(id: string, startFresh: (name: string) => void): Promise<boolean> {
  const template = STARTER_TEMPLATES.find((t) => t.id === id);
  if (!template) return false;
  startFresh(template.name);
  if (template.mode === 'mapping') {
    vjClipLauncher.setOpen(false);
    await buildMappingStarter();
    return true;
  }
  const layout = DECKS[id];
  const rowsNeeded = Math.max(layout.A.length, layout.B?.length ?? 0);
  const columnsNeeded = Math.max(...[...layout.A, ...(layout.B ?? [])].map((row) => row.length));
  while (get(vjClipLauncher).numLayers < rowsNeeded) vjClipLauncher.addLayer();
  while (get(vjClipLauncher).numColumns < columnsNeeded) vjClipLauncher.addColumn();
  vjClipLauncher.setCrossfaderEnabled(!!layout.crossfader);
  if (layout.crossfader) vjClipLauncher.setQuantization('1bar');
  await fillDeck(layout.A, 'A');
  if (layout.B) await fillDeck(layout.B, 'B');
  vjClipLauncher.setOpen(true);
  return true;
}
