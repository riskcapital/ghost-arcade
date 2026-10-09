import { normalizeCrossfade, type CrossfadeSettings } from './crossfade';
import {standaloneShaderPaths} from './shaderAvailability';
import {mobileHeavyShaderPaths,mobileRemovedShaderPaths} from './shaderPerformance';
import {normalizePaint,type PaintConfig} from './paint';
import type { LookConfig } from './looks/types';
import { EDGE_LOOKS } from './looks/edgeLookCatalog';
import { MOBILE_EDGE_STROKES, MOBILE_EDGE_FILLS } from './looks/renderer';
import { MOBILE_SHADERS } from '../standaloneShaderList';
import { MOBILE_EFFECTS, type MobileEffectInstance } from '../standaloneEffects';
export type Point = { x: number; y: number };
export type EffectChain = (MobileEffectInstance & { id: string })[];
export type LookParams = Record<string, number | boolean | number[]>;
export type Clip = {
  /** The look this clip was last given. Restored when it is launched; absent means shader defaults. */
  params?: LookParams;
  effects?: EffectChain;
  id: string;
  name: string;
  kind: 'shader' | 'video' | 'image' | 'camera' | 'depth';
  facing?: 'user'|'environment';
  shaderId?: string;
  assetId?: string;
  thumbnail?: string;
};
export type Layer = {
  solo?: boolean;
  look?: LookConfig;
  id: string;
  name: string;
  clipId: string | null;
  enabled: boolean;
  opacity: number;
  fit: 'stretch' | 'contain' | 'fill';
  blend: 'normal' | 'add' | 'screen' | 'multiply' | 'difference';
  speed: number;
  intensity: number;
  params: Record<string, number | boolean | number[]>;
  effects: (MobileEffectInstance & { id: string })[];
};
export type Surface = {
  look?: LookConfig;
  id: string;
  name: string;
  source: number | 'mix';
  enabled: boolean;
  locked: boolean;
  fit: 'stretch' | 'contain' | 'fill';
  feather: number;
  mode: 'corners' | 'mesh';
  points: Point[];
};
export type Scene = { launchGrid?: (string|null)[][]; clipEffects?: Record<string, EffectChain>; effects?: EffectChain; id: string; name: string; layers: Layer[]; crossfade: number; dualDeck?: boolean };
export type Show = {
  /** Format revision. Absent on sets saved by app 1.0; 2 from app 1.1 on (see setRepair.ts). */
  rev?: number;
  paint?:PaintConfig;
  activeBlockId?: string;
  effects: EffectChain;
  version: 1;
  id: string;
  name: string;
  clips: Clip[];
  layers: Layer[];
  surfaces: Surface[];
  scenes: Scene[];
  bpm: number;
  quantize: boolean;
  crossfade: number;
  crossfadeSettings?: CrossfadeSettings;
  dualDeck: boolean;
  launchGrid: (string | null)[][];
  master: number;
  quality: 540 | 720 | 1080;
  mapping: boolean;
};
export const uid = () => crypto.randomUUID();
export const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
export const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
export const shaderThumbnail = (id: string) => {
  const s = MOBILE_SHADERS.find((s) => s.id === id);
  return s
    ? `${import.meta.env.BASE_URL}ISF/thumbnails/${s.path
        .replace(/^ISF\//, '')
        .replace(/\.fs$/, '')
        .replaceAll('/', '_')}.jpg`
    : '';
};
/** True for a saved shader clip this build cannot run: it left the library, was stripped from the mobile release, or costs too much for a phone GPU. */
export function clipUnavailable(clip: Clip | undefined): boolean {
  if (!clip || clip.kind !== 'shader') return false;
  const shader = MOBILE_SHADERS.find((s) => s.id === clip.shaderId);
  return !shader || mobileHeavyShaderPaths.has(shader.path) || mobileRemovedShaderPaths.has(shader.path);
}
export function gridPoints(x = 0.08, y = 0.08, w = 0.84, h = 0.84): Point[] {
  return Array.from({ length: 9 }, (_, i) => ({ x: x + ((i % 3) * w) / 2, y: y + (Math.floor(i / 3) * h) / 2 }));
}
/** The whole output frame: where a set's first surface starts, so turning mapping on changes nothing. */
export const fullFramePoints = (): Point[] => gridPoints(0, 0, 1, 1);
const sameGrid = (a: Point[], b: Point[]) => a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i].x) < 1e-6 && Math.abs(p.y - b[i].y) < 1e-6);
export function newSurface(index: number, fullFrame = false): Surface {
  return {
    id: uid(),
    name: `Surface ${index + 1}`,
    source: 'mix',
    enabled: true,
    locked: false,
    fit: 'stretch',
    feather: 0,
    mode: 'corners',
    points: fullFrame ? fullFramePoints() : gridPoints(),
  };
}
/** Blend mode a new set gives each row: Screen above an opaque bottom row (L4 / B4). */
export const starterBlend = (row: number): Layer['blend'] => (row % 4 === 3 ? 'normal' : 'screen');
/** The set format revision this app writes. */
export const SET_REV = 2;
/** A starting set. With `demoBlocks`, the one a person first opens: three full blocks of shaders ready to play. */
export function defaultShow(demoBlocks=false): Show {
  const featured=['lumenstrata','lumenveil','murmur','prism','pulse','quantumchamber','sentinels','tendril','tide','chrysalis','crystallon','dispersion','drift','aurora','chladniplate'].map(n=>'featured-'+n);
  const preferred=['ga-ghostfx','dm-plasma-flow','room-ember-drift','dm-kaleidoscope','dm-liquid-metal','dm-tunnel','room-cosmic-nebula','ar-frequency-rings','sm-fireflies','dm-neon-lines','ar-spectral-aurora','sm-lava-lamp-blobs','room-aurora-curtains'];
  const performanceShader=(shader:typeof MOBILE_SHADERS[number])=>!shader.requiresImage&&standaloneShaderPaths.has(shader.path)&&!/(test.?pattern|test.?bars|safe.?area|uv.?grid|grid.?matrix|solid.?color|calibrat|checker)/i.test(shader.id+' '+shader.path);
  const eligible=MOBILE_SHADERS.filter(performanceShader);
  const ids=[...featured,...preferred].filter(id=>eligible.some(s=>s.id===id));
  for(const shader of eligible)if(ids.length<(demoBlocks?96:64)&&!ids.includes(shader.id))ids.push(shader.id);
  // Deliberate opening rows on both decks, not catalog-order utility shaders.
  const rows=Array.from({length:8},(_,row)=>Array.from({length:8},(_,col)=>ids[(row*8+col)%ids.length]));
  const curateRow=(priorities:string[])=>[...new Set([...priorities.filter(id=>ids.includes(id)),...ids])].slice(0,8);
  rows[0]=curateRow(featured.slice(0,8));
  rows[4]=curateRow([...featured.slice(8),'ga-ghostfx']);
  // The demo opens with three blocks, each a full page of different shaders, so the
  // tabs above the deck have somewhere to go. Block 1 is the curated deck.
  const blockGrid=(block:number)=>block===0?rows:Array.from({length:8},(_,row)=>Array.from({length:8},(_,col)=>ids[(block*32+(row%4)*8+col+(row>=4?16:0))%ids.length]));
  const blockIds=[0,1,2].map(()=>uid());
  const demoLayers:Layer[]=Array.from({ length: 8 }, (_, i) => ({
      id: `layer-${i}`,
      name: `Layer ${i + 1}`,
      clipId: i === 0 ? rows[0][0] : i === 4 ? rows[4][0] : null,
      enabled: true,
      opacity: 1,
      fit: 'contain',
      // L1 is the top of the stack. Only the bottom row of each deck is opaque, so a clip
      // launched on any lower row shows through instead of hiding behind L1.
      blend: starterBlend(i),
      speed: 1,
      intensity: 1,
      params: {},
      effects: [],
    }));
  return {
    version: 1,
    rev: SET_REV,
    id: uid(),
    name: 'Untitled set',
    clips: ids.map((id) => ({ id, shaderId: id, name: MOBILE_SHADERS.find((s) => s.id === id)!.name, kind: 'shader' })),
    layers: demoLayers,
    surfaces: [newSurface(0, true)],
    scenes: !demoBlocks?[]:blockIds.map((id,block)=>({id,name:`Block ${block+1}`,launchGrid:blockGrid(block).map(row=>[...row]),layers:demoLayers.map(layer=>({...layer,params:{},effects:[]})),crossfade:0})),
    activeBlockId: demoBlocks?blockIds[0]:undefined,
    effects: [],
    bpm: 120,
    quantize: false,
    crossfade: 0,
    crossfadeSettings: normalizeCrossfade(),
    dualDeck: false,
    launchGrid: rows,
    master: 1,
    quality: 720,
    mapping: false,
  };
}
/**
 * A set that is still the stock demo (its first block is the curated opening
 * deck, untouched) is brought up to the current demo: three blocks, each full.
 * Blocks the person already filled are left exactly as they are; only empty
 * ones are filled, and missing ones are added.
 */
function completeDemo(show: Show): Show {
  const stock = defaultShow(true);
  const first = show.scenes[0]?.launchGrid ?? show.launchGrid;
  const same = (a?: (string|null)[], b?: (string|null)[]) => !!a && !!b && b.slice(0, 8).every((id, i) => a[i] === id);
  if (show.name !== stock.name || show.scenes.length > stock.scenes.length || ![0, 1, 2, 3].every(row => same(first?.[row], stock.launchGrid[row]))) return show;
  const empty = (grid?: (string|null)[][]) => !grid || grid.every(row => row.every(id => !id));
  let scenes = show.scenes.map((block, i) => (i > 0 && empty(block.launchGrid) ? { ...block, launchGrid: stock.scenes[i].launchGrid!.map(row => [...row]) } : block));
  let activeBlockId = show.activeBlockId;
  if (!scenes.length) { scenes = [{ ...stock.scenes[0], launchGrid: show.launchGrid.map(row => [...row]), layers: show.layers.map(layer => ({ ...layer })) }]; activeBlockId = scenes[0].id; }
  for (let i = scenes.length; i < stock.scenes.length; i++) scenes.push({ ...stock.scenes[i], name: `Block ${i + 1}` });
  if (scenes.every((block, i) => block === show.scenes[i]) && scenes.length === show.scenes.length) return show;
  const known = new Set(show.clips.map(clip => clip.id));
  // The added shaders go ahead of the person's own clips, so what they imported stays last, where they left it.
  const own = show.clips.findIndex(clip => clip.kind !== 'shader');
  const added = stock.clips.filter(clip => !known.has(clip.id));
  const clips = own < 0 ? [...show.clips, ...added] : [...show.clips.slice(0, own), ...added, ...show.clips.slice(own)];
  return { ...show, scenes, activeBlockId, clips };
}
export function normalizeShow(raw: unknown): Show { return completeDemo(normalizeStored(raw)); }
function normalizeStored(raw: unknown): Show {
  let r = raw as Show;
  if (!r || r.version !== 1 || !Array.isArray(r.layers) || !Array.isArray(r.clips) || !Array.isArray(r.surfaces))
    throw new Error('This is not a Ghost Arcade mobile set.');
  const base = defaultShow();
  // Before the explicit deck toggle, saved sets always used A/B routing.
  // New sets store false explicitly; preserve the mix for those legacy files.
  r={...r,dualDeck:r.dualDeck===undefined?true:!!r.dualDeck};
  // Older dual sets used A1/A2/B1/B2. Preserve B in the expanded second deck.
  if(r.layers.length===4&&r.dualDeck){
    const expand=<T>(items:T[],empty:()=>T)=>[items[0],items[1],empty(),empty(),items[2],items[3],empty(),empty()];
    r={...r,layers:expand(r.layers,()=>({...base.layers[2],clipId:null})),launchGrid:expand(r.launchGrid??[[],[],[],[]],()=>[]),
      surfaces:r.surfaces.map(s=>({...s,source:s.source==='mix'?'mix':s.source%2})),
      scenes:(r.scenes??[]).map(s=>s.layers?.length===4?{...s,layers:expand(s.layers,()=>({...base.layers[2],clipId:null})),launchGrid:expand(s.launchGrid??[[],[],[],[]],()=>[])}:s)};
  }
  // Fill only the untouched original demo; never overwrite custom clip grids.
  const oldDemo=['dm-plasma-flow','room-ember-drift','dm-kaleidoscope','dm-liquid-metal','dm-tunnel','room-cosmic-nebula','ar-frequency-rings','sm-fireflies','dm-neon-lines','ar-spectral-aurora','sm-lava-lamp-blobs','room-aurora-curtains'];
  if(!r.dualDeck&&r.clips.length===12&&r.clips.every(c=>oldDemo.includes(c.id))&&r.launchGrid?.length===4&&r.launchGrid.every((row,i)=>row.slice(0,3).every((id,j)=>id===oldDemo[i*3+j])&&row.slice(3).every(id=>!id))){
    const grid=base.launchGrid.map(row=>[...row]);for(let i=0;i<4;i++)for(let j=0;j<3;j++)grid[i][j]=r.launchGrid[i][j];
    r={...r,clips:[...r.clips,...base.clips.filter(c=>!r.clips.some(old=>old.id===c.id))],launchGrid:grid};
  }
  const clips = r.clips
    .filter((c) => c && typeof c.id === 'string' && ['shader', 'image', 'video','camera','depth'].includes(c.kind))
    .slice(0, 2048)
    .map((c) => ({ ...c, params: normalizeLookParams(c.params), effects: normalizeEffects(c.effects), name: String(c.name || 'Untitled clip').slice(0, 100) }));
  const layers = (items: Layer[]) =>
    base.layers.map((b, i) => {
      const l = items?.[i];
      if (!l) return b;
      return {
        ...b,
        solo: !!l.solo,
        // An unavailable clip keeps its pad in the grid but can never be the playing source.
        clipId: clips.some((c) => c.id === l.clipId && !clipUnavailable(c)) ? l.clipId : null,
        enabled: l.enabled !== false,
        opacity: clamp(l.opacity),
        fit: ['stretch', 'contain', 'fill'].includes(l.fit) ? l.fit : 'contain',
        speed: clamp(l.speed, 0, 3),
        intensity: clamp(l.intensity, 0, 2),
        blend: ['normal', 'add', 'screen', 'multiply', 'difference'].includes(l.blend) ? l.blend : 'normal',
        params: l.params && typeof l.params === 'object' ? l.params : {},
        effects: normalizeEffects(l.effects),
      } as Layer;
    });
  const next: Show = {
    ...base,
    // Kept exactly as saved: a set without it came from app 1.0 and may be offered a repair.
    rev: typeof r.rev === 'number' && Number.isFinite(r.rev) ? r.rev : undefined,
    id: typeof r.id === 'string' ? r.id : base.id,
    name: String(r.name || base.name).slice(0, 100),
    clips,
    effects: normalizeEffects(r.effects),
    layers: layers(r.layers),
    surfaces: r.surfaces
      .slice(0, 16)
      .map((s, i) => ({
        ...newSurface(i),
        id: String(s.id || uid()),
        name: String(s.name || `Surface ${i + 1}`).slice(0, 80),
        source: s.source === 'mix' ? 'mix' : clamp(Math.round(Number(s.source)), 0, 3),
        enabled: s.enabled !== false,
        locked: !!s.locked,
        fit: ['stretch', 'contain', 'fill'].includes(s.fit) ? s.fit : 'stretch',
        feather: clamp(s.feather, 0, 0.4),
        look: normalizeLook(s.look ?? (s.source === 'mix' ? r.layers.find(l=>l?.look?.enabled)?.look : r.layers[Number(s.source)]?.look)),
        mode: s.mode === 'mesh' ? 'mesh' : 'corners',
        points:
          Array.isArray(s.points) && s.points.length === 9
            ? s.points.map((p) => ({ x: clamp(p.x, -0.5, 1.5), y: clamp(p.y, -0.5, 1.5) }))
            : gridPoints(),
      })),
    activeBlockId: typeof r.activeBlockId==='string' && r.scenes?.some(s=>s.id===r.activeBlockId) ? r.activeBlockId : undefined,
    scenes: (Array.isArray(r.scenes) ? r.scenes : [])
      .slice(0, 16)
      .map((s) => ({
        id: String(s.id || uid()),
        name: String(s.name || 'Block').replace(/^Scene /,'Block ').slice(0, 80),
        launchGrid: Array.from({length:8},(_,row)=>Array.from({length:Math.max(4,Math.min(48,s.launchGrid?.[row]?.length||4))},(_,col)=>{const id=s.launchGrid?.[row]?.[col] ?? (!s.launchGrid&&col===0?s.layers?.[row]?.clipId:null);return clips.some(c=>c.id===id)?id!:null;})),
        layers: layers(s.layers),
        clipEffects: s.clipEffects ? Object.fromEntries(Object.entries(s.clipEffects).filter(([id])=>clips.some(c=>c.id===id)).map(([id,fx])=>[id,normalizeEffects(fx)])) : undefined,
        effects: normalizeEffects(s.effects),
        crossfade: clamp(s.crossfade),
        dualDeck: s.dualDeck === undefined ? true : !!s.dualDeck,
      })),
    bpm: clamp(r.bpm, 30, 240),
    quantize: !!r.quantize,
    crossfade: clamp(r.crossfade),
    crossfadeSettings: normalizeCrossfade(r.crossfadeSettings),
    dualDeck: r.dualDeck === undefined ? false : !!r.dualDeck,
    launchGrid: Array.from({ length: 8 }, (_, row) => {
      const saved = r.launchGrid?.[row];
      if (Array.isArray(saved)) return Array.from({ length: Math.max(4, Math.min(48, saved.length)) }, (_, col) => clips.some(c => c.id === saved[col]) ? saved[col] : null);
      // Preserve old active sources; distribute the former shared bank across rows.
      const rowClips = clips.filter((_, i) => i % 8 === row).map(c => c.id);
      const active = r.layers[row]?.clipId;
      if (active && clips.some(c => c.id === active) && !rowClips.includes(active)) rowClips.unshift(active);
      return Array.from({ length: Math.max(4, Math.min(48, rowClips.length)) }, (_, col) => rowClips[col] ?? null);
    }),
    master: clamp(r.master),
    quality: [540, 720, 1080].includes(r.quality) ? r.quality : 720,
    mapping: !!r.mapping,
    paint: normalizePaint(r.paint),
  };
  // Sets made before mapping became opt-in hold one untouched surface inset by 8%. While mapping is
  // still off that inset was never on screen, so start it full-frame: switching mapping on then
  // leaves the picture alone. A set with mapping already on is the performer's and stays as saved.
  if (!next.mapping && next.surfaces.length === 1 && sameGrid(next.surfaces[0].points, gridPoints()))
    next.surfaces[0] = { ...next.surfaces[0], points: fullFramePoints() };
  return next;
}
/** Keep only values a shader input can take, so a damaged set cannot poison the renderer. */
export function normalizeLookParams(raw: unknown): LookParams | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: LookParams = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(0, 128)) {
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) out[key] = value;
    else if (Array.isArray(value) && value.length <= 4 && value.every((n) => typeof n === 'number' && Number.isFinite(n))) out[key] = value as number[];
  }
  return Object.keys(out).length ? out : undefined;
}
/** Parameters a clip starts with: its shader's defaults, then the look it was last given. */
export function clipLaunchParams(show: Show, clipId: string): LookParams {
  const clip = show.clips.find((c) => c.id === clipId);
  const defaults = clip?.shaderId ? MOBILE_SHADERS.find((s) => s.id === clip.shaderId)?.defaults : undefined;
  return copy({ ...defaults, ...clip?.params });
}
/** Clips with the playing clip of `row` updated to the look currently on that layer. */
export function rememberClipLook(show: Show, row: number): Clip[] {
  const layer = show.layers[row];
  if (!layer?.clipId) return show.clips;
  return show.clips.map((c) => (c.id === layer.clipId ? { ...c, params: copy(layer.params) } : c));
}
/** Forget a clip's look. Returns the clips and the parameters its layer should go back to. */
export function resetClipLook(show: Show, clipId: string): { clips: Clip[]; params: LookParams } {
  const clips = show.clips.map((c) => (c.id === clipId ? { ...c, params: undefined } : c));
  return { clips, params: clipLaunchParams({ ...show, clips }, clipId) };
}
export const STORAGE_KEY = 'ga-mobile-studio-v1';
export function loadShow(): Show {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return normalizeShow(JSON.parse(saved));
  } catch {
    /* preserve old data; start a new set */
  }
  return defaultShow(true);
}
export function savedSets(): Show[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SETS_KEY) || '[]');
    return Array.isArray(raw)
      ? raw.flatMap((s) => {
          try {
            return [normalizeShow(s)];
          } catch {
            return [];
          }
        })
      : [];
  } catch {
    return [];
  }
}
export const SETS_KEY = 'ga-mobile-studio-sets-v1';
/** Sets kept on the device. Reaching it stops new sets being started; nothing is ever dropped. */
export const MAX_SAVED_SETS = 24;
/** Autosave of the set being played. Cheap: one set, no reading back. */
export function saveCurrentShow(show: Show) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(show));
}
/**
 * The saved-set list with `show` placed first. Pure, so the list lives in memory and is written
 * only when it changes. When the list is full and `show` is new it is returned unchanged with
 * `full` set: the caller tells the performer instead of an older set quietly disappearing.
 */
export function upsertSet(bank: Show[], show: Show): { bank: Show[]; full: boolean } {
  const others = bank.filter((s) => s.id !== show.id);
  if (others.length === bank.length && bank.length >= MAX_SAVED_SETS) return { bank, full: true };
  return { bank: [show, ...others], full: false };
}
export function removeSet(bank: Show[], id: string): Show[] {
  return bank.filter((s) => s.id !== id);
}
export function renameSet(bank: Show[], id: string, name: string): Show[] {
  const clean = name.trim().slice(0, 100);
  return clean ? bank.map((s) => (s.id === id ? { ...s, name: clean } : s)) : bank;
}
export function writeSetBank(bank: Show[]) {
  localStorage.setItem(SETS_KEY, JSON.stringify(bank));
}
/** True when a brand-new set could not be kept because the device already holds the maximum. */
export const setBankFull = (bank: Show[], currentId?: string) => bank.filter((s) => s.id !== currentId).length >= MAX_SAVED_SETS;
/** One-shot save used on exit paths. Never drops a saved set. */
export function saveShow(show: Show) {
  saveCurrentShow(show);
  const { bank, full } = upsertSet(savedSets(), show);
  if (!full) writeSetBank(bank);
}
/** Every imported-media id still used by a clip in any of these sets. */
export function referencedAssetIds(shows: Show[]): Set<string> {
  const ids = new Set<string>();
  for (const show of shows) for (const clip of show?.clips ?? []) if (clip.assetId) ids.add(clip.assetId);
  return ids;
}
export function renameBlock(show: Show, id: string, name: string): Scene[] {
  const clean = name.trim().slice(0, 80);
  return clean ? show.scenes.map((b) => (b.id === id ? { ...b, name: clean } : b)) : show.scenes;
}
export function removeBlock(show: Show, id: string): Pick<Show, 'scenes' | 'activeBlockId'> {
  return { scenes: show.scenes.filter((b) => b.id !== id), activeBlockId: show.activeBlockId === id ? undefined : show.activeBlockId };
}
export function layerGain(show: Show, index: number) {
  const l = show.layers[index];
  const deck = show.dualDeck ? (index < 4 ? 1 - show.crossfade : show.crossfade) : index<4?1:0;
  return baseLayerGain(show,index) * deck;
}
export function nextBeat(now: number, origin: number, bpm: number): number {
  const duration = 60000 / clamp(bpm, 30, 240);
  return origin + (Math.floor((now - origin) / duration) + 1) * duration;
}
/** Interpolate the control lattice when editing a corner, retaining a coherent quad. */
export function movePoint(surface: Surface, index: number, point: Point): Surface {
  const s = copy(surface);
  s.points[index] = { x: clamp(point.x, -0.5, 1.5), y: clamp(point.y, -0.5, 1.5) };
  if (s.mode === 'corners') {
    const [a, b, c, d] = [s.points[0], s.points[2], s.points[8], s.points[6]];
    s.points = Array.from({ length: 9 }, (_, i) => {
      const u = (i % 3) / 2,
        v = Math.floor(i / 3) / 2;
      return {
        x: a.x * (1 - u) * (1 - v) + b.x * u * (1 - v) + c.x * u * v + d.x * (1 - u) * v,
        y: a.y * (1 - u) * (1 - v) + b.y * u * (1 - v) + c.y * u * v + d.y * (1 - u) * v,
      };
    });
  }
  return s;
}
export class History {
  private past: Show[] = [];
  private future: Show[] = [];
  push(show: Show) {
    this.past.push(copy(show));
    if (this.past.length > 40) this.past.shift();
    this.future = [];
  }
  undo(current: Show): Show | null {
    const s = this.past.pop();
    if (!s) return null;
    this.future.push(copy(current));
    return s;
  }
  redo(current: Show): Show | null {
    const s = this.future.pop();
    if (!s) return null;
    this.past.push(copy(current));
    return s;
  }
  get canUndo() {
    return !!this.past.length;
  }
  get canRedo() {
    return !!this.future.length;
  }
  /** Every state undo or redo could bring back, so their media is not treated as unused. */
  get states(): Show[] {
    return [...this.past, ...this.future];
  }
}

export function normalizeLook(value: LookConfig | undefined): LookConfig | undefined {
 if(!value || !(value.id === 'custom' || EDGE_LOOKS.some(l => l.id === value.id))) return undefined;
 return {id:value.id,palette:String(value.palette||'neon'),enabled:value.enabled!==false,amount:clamp(value.amount ?? 1),speed:clamp(value.speed ?? 1,0,3),width:clamp(value.width ?? 1,.25,4),stroke:MOBILE_EDGE_STROKES.includes(value.stroke||'')?value.stroke:undefined,fill:MOBILE_EDGE_FILLS.includes(value.fill||'')?value.fill:undefined};
}
/** Screen row assignments follow the corresponding row across both decks. */
export function mappingRows(source: number, dualDeck: boolean): number[] {
 return dualDeck ? [source % 4, source % 4 + 4] : [source];
}

export function baseLayerGain(show: Show,index:number):number {
 const l=show.layers[index];
 const rows=show.layers.slice(show.dualDeck&&index>=4?4:0,show.dualDeck&&index>=4?8:4);
 return !!l?.enabled && (show.dualDeck||index<4) && (!rows.some(row=>row.solo) || l.solo) ? l.opacity : 0;
}
export function normalizeEffects(effects:EffectChain|undefined):EffectChain {
 return (Array.isArray(effects)?effects:[]).filter(e=>e && MOBILE_EFFECTS.some(d=>d.type===e.type&&!d.internal)).slice(0,8).map(e=>({...e,id:typeof e.id==='string'?e.id:uid(),enabled:e.enabled!==false,params:e.params&&typeof e.params==='object'?e.params:{}}));
}
