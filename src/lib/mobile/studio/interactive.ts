import { validateInteractiveAnimation, type InteractiveAnimation } from './interactiveAnimation';
import { evaluateTrack } from '../../keyframes/easing';
import {
  validateEffects,
  advanceInteractiveAuto,
  applyInteractiveOverrides,
  evaluateEffect,
  effectScene,
  type InteractiveEffect,
} from './interactiveEffects';
import { MatterPreview } from './matterPreview';
import { createInteractiveQuality, interactiveFrameDelta, type InteractiveQualityBudget } from './interactiveQuality';
export type Point = { x: number; y: number };
export type Behavior = 'solid' | 'emitter' | 'attractor' | 'trigger';
export const INTERACTIVE_PRESETS = [
  'architecture',
  'garden',
  'walls',
  'ribbons',
  'orbit',
  'electric',
  'light',
  'balls',
  'smoke',
  'cloud',
  'liquid',
  'fire',
] as const;
export type SurfaceMaterial = 'none' | 'fire' | 'smoke' | 'liquid' | 'points';
export type InteractiveSurface = {
  id: string;
  name: string;
  behavior: Behavior;
  points: Point[];
  material?: SurfaceMaterial;
  height?: number;
};
export type MatterSettings = {
  lightX: number;
  lightY: number;
  lightHeight: number;
  lightPower: number;
  haze: number;
  bounce: number;
  friction: number;
  flow: number;
  viscosity: number;
  size: number;
};
export const defaultMatter = (): MatterSettings => ({
  lightX: 0.2,
  lightY: 0.12,
  lightHeight: 0.65,
  lightPower: 1.4,
  haze: 0.5,
  bounce: 0.72,
  friction: 0.18,
  flow: 0.65,
  viscosity: 0.4,
  size: 0.5,
});
export type InteractiveScene = {
  schema: 'ghost-interactive';
  version: 1;
  name: string;
  seed?: number;
  preset: (typeof INTERACTIVE_PRESETS)[number];
  matter?: MatterSettings;
  effects?: InteractiveEffect[];
  animation?: InteractiveAnimation;
  surfaces: InteractiveSurface[];
  energy: number;
  gravity: number;
  hue: number;
  trails: number;
};
export function defaultInteractive(): InteractiveScene {
  return {
    schema: 'ghost-interactive',
    version: 1,
    name: 'Living room',
    preset: 'architecture',
    energy: 0.6,
    gravity: 0.25,
    hue: 185,
    trails: 0.7,
    surfaces: [
      {
        id: 'stage',
        name: 'Stage',
        behavior: 'solid',
        points: [
          { x: 0.15, y: 0.3 },
          { x: 0.4, y: 0.3 },
          { x: 0.4, y: 0.7 },
          { x: 0.15, y: 0.7 },
        ],
      },
      {
        id: 'portal',
        name: 'Portal',
        behavior: 'trigger',
        points: [
          { x: 0.6, y: 0.25 },
          { x: 0.85, y: 0.25 },
          { x: 0.85, y: 0.75 },
          { x: 0.6, y: 0.75 },
        ],
      },
    ],
  };
}
export function validateScene(raw: unknown): InteractiveScene {
  const s = raw as InteractiveScene;
  if (
    !s ||
    s.schema !== 'ghost-interactive' ||
    s.version !== 1 ||
    !INTERACTIVE_PRESETS.includes(s.preset) ||
    typeof s.name !== 'string' ||
    !Array.isArray(s.surfaces) ||
    s.surfaces.length > 32
  )
    throw Error('Unsupported interactive scene.');
  for (const k of ['energy', 'gravity', 'hue', 'trails'] as const)
    if (!Number.isFinite(s[k])) throw Error('Invalid scene controls.');
  if (s.seed !== undefined && (!Number.isSafeInteger(s.seed) || s.seed < 0 || s.seed > 1000000))
    throw Error('Invalid scene seed.');
  const ids = new Set<string>();
  for (const p of s.surfaces) {
    if (
      typeof p.id !== 'string' ||
      ids.has(p.id) ||
      typeof p.name !== 'string' ||
      !['solid', 'emitter', 'attractor', 'trigger'].includes(p.behavior) ||
      !Array.isArray(p.points) ||
      p.points.length < 3 ||
      p.points.length > 64 ||
      p.points.some((v) => !Number.isFinite(v.x) || !Number.isFinite(v.y) || v.x < 0 || v.x > 1 || v.y < 0 || v.y > 1)
    )
      throw Error('Invalid surface geometry.');
    if (p.material !== undefined && !['none', 'fire', 'smoke', 'liquid', 'points'].includes(p.material))
      throw Error('Invalid surface material.');
    if (p.height !== undefined && (!Number.isFinite(p.height) || p.height < 0.02 || p.height > 0.9))
      throw Error('Invalid blocker depth.');
    ids.add(p.id);
  }
  const matter = defaultMatter();
  for (const k of Object.keys(matter) as (keyof MatterSettings)[]) {
    const v = s.matter?.[k];
    if (v !== undefined && !Number.isFinite(v)) throw Error('Invalid material controls.');
    if (v !== undefined) matter[k] = Math.max(k === 'lightHeight' ? 0.05 : 0, Math.min(k === 'lightPower' ? 3 : 1, v));
  }
  return JSON.parse(
    JSON.stringify({
      ...s,
      matter,
      animation: validateInteractiveAnimation(s.animation, s.effects ?? []),
      ...(s.effects ? { effects: validateEffects(s.effects, ids) } : {}),
      name: s.name.slice(0, 100),
      energy: Math.max(0, Math.min(1, s.energy)),
      gravity: Math.max(-1, Math.min(1, s.gravity)),
      hue: Math.max(0, Math.min(360, s.hue)),
      trails: Math.max(0, Math.min(1, s.trails)),
    }),
  );
}
export function inside(p: Point, vertices: Point[]) {
  let hit = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i],
      b = vertices[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}
function cross(a: Point, b: Point) {
  return a.x * b.y - a.y * b.x;
}
/** Swept segment collision prevents particles crossing thin walls in one frame. */
export function collision(a: Point, b: Point, c: Point, d: Point) {
  const v = { x: b.x - a.x, y: b.y - a.y },
    w = { x: d.x - c.x, y: d.y - c.y },
    q = { x: c.x - a.x, y: c.y - a.y },
    den = cross(v, w);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(q, w) / den,
    u = cross(q, v) / den;
  if (t <= 0.00001 || t > 1 || u < 0 || u > 1) return null;
  const len = Math.hypot(w.x, w.y);
  return { t, x: a.x + v.x * t, y: a.y + v.y * t, nx: -w.y / len, ny: w.x / len };
}
type Particle = Point & { vx: number; vy: number; life: number; seed: number };
export type Interaction = { id: string; point: Point; strength: number; mode?: 'attract' | 'repel' | 'vortex' };
export class InteractiveWorld {
  private quality: InteractiveQualityBudget;
  constructor(quality = createInteractiveQuality()) {
    this.quality = quality;
    this.matter.setQuality(quality);
  }
  private setQuality(quality: InteractiveQualityBudget) {
    this.quality = quality;
    this.matter.setQuality(quality);
  }
  qualityDiagnostics() {
    const layers = [...this.effectWorlds.values()];
    const stats = layers.length ? layers.map((w) => w.matter.diagnostics()) : [this.matter.diagnostics()];
    return {
      ...this.quality,
      activeWorlds: layers.length,
      canvasCount: this.effectCanvases.size,
      particles:
        this.particles.length +
        layers.reduce((n, w) => n + w.particles.length, 0) +
        stats.reduce((n, s) => n + s.particles, 0),
      bufferBytes: stats.reduce((n, s) => n + s.bufferBytes, 0),
      collisionChecks: stats.reduce((n, s) => n + s.collisionChecks, 0),
    };
  }
  private removeEffect(id: string) {
    this.effectWorlds.get(id)?.dispose();
    this.effectWorlds.delete(id);
    const canvas = this.effectCanvases.get(id);
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    this.effectCanvases.delete(id);
    this.evaluated.delete(id);
    this.renderedEffects.delete(id);
  }
  dispose() {
    this.reset();
    this.matter.dispose();
  }
  private transparent = false;
  private usingMatter = false;
  private matter = new MatterPreview();
  private effectWorlds = new Map<string, InteractiveWorld>();
  private effectCanvases = new Map<string, HTMLCanvasElement>();
  private evaluated = new Map<string, InteractiveEffect>();
  private renderedEffects = new Map<string, { tick: number; signature: string }>();
  private renderTick = 0;
  particles: Particle[] = [];
  pulses: { point: Point; age: number; hue: number }[] = [];
  clock = 0;
  private spawn = 0;
  private entered = new Set<string>();
  private lastTrigger = new Map<string, number>();
  reset() {
    for (const id of this.effectWorlds.keys()) this.removeEffect(id);
    this.evaluated.clear();
    this.renderedEffects.clear();
    this.renderTick = 0;
    this.matter.reset();
    this.usingMatter = false;
    this.particles = [];
    this.pulses = [];
    this.entered.clear();
    this.lastTrigger.clear();
    this.clock = 0;
    this.spawn = 0;
  }
  update(scene: InteractiveScene, delta: number, inputs: Interaction[], audio: Record<string, number> = {}, bpm = 120) {
    const dt = interactiveFrameDelta(delta);
    if (dt) this.renderTick++;
    if (scene.effects) {
      if (this.usingMatter) {
        this.matter.reset();
        this.usingMatter = false;
      }
      this.particles.length = 0;
      this.pulses.length = 0;
      this.clock += dt;
      scene = advanceInteractiveAuto(scene, dt, (this.clock * bpm) / 60);
      if (scene.animation) {
        const a = scene.animation,
          t = a.loop ? this.clock % a.duration : Math.min(this.clock, a.duration),
          overrides: Record<string, number | boolean> = {};
        for (const track of a.tracks) {
          const value = evaluateTrack(track, t);
          if (value !== undefined) overrides[track.key] = value;
        }
        scene = applyInteractiveOverrides(scene, overrides);
      }
      const effects = scene
        .effects!.slice(0, 8)
        .filter((e) => e.enabled)
        .map((base) => evaluateEffect(base, this.clock, audio, bpm));
      if (this.quality.activeLayers !== effects.length)
        this.setQuality({
          ...createInteractiveQuality(
            effects.length,
            this.quality.tier === 'economy'
              ? { hardwareConcurrency: 4 }
              : this.quality.tier === 'high'
                ? { hardwareConcurrency: 8, deviceMemory: 8 }
                : {},
          ),
          activeLayers: effects.length,
        });
      const active = new Set(effects.map((e) => e.id));
      for (const id of this.effectWorlds.keys()) if (!active.has(id)) this.removeEffect(id);
      this.evaluated.clear();
      for (const e of effects) {
        this.evaluated.set(e.id, e);
        let world = this.effectWorlds.get(e.id);
        if (!world) {
          world = new InteractiveWorld(this.quality);
          this.effectWorlds.set(e.id, world);
        }
        world.setQuality(this.quality);
        world.transparent = true;
        world.matter.effect = e;
        world.update(effectScene(scene, e), dt, inputs);
      }
      return;
    }
    for (const id of this.effectWorlds.keys()) this.removeEffect(id);
    if (
      INTERACTIVE_PRESETS.indexOf(scene.preset) >= 6 ||
      scene.surfaces.some((s) => s.material && s.material !== 'none')
    ) {
      if (!this.usingMatter) {
        this.particles.length = 0;
        this.pulses.length = 0;
        this.usingMatter = true;
      }
      this.matter.update(scene, dt, inputs);
      return;
    }
    if (this.usingMatter) {
      this.matter.reset();
      this.usingMatter = false;
    }
    if (!dt) return;
    this.clock += dt;
    const current = new Set<string>();
    for (const s of scene.surfaces)
      if (s.behavior === 'trigger')
        for (const input of inputs.slice(0, this.quality.inputLimit))
          if (inside(input.point, s.points)) {
            const key = s.id + ':' + input.id;
            current.add(key);
            if (!this.entered.has(key) && this.clock - (this.lastTrigger.get(s.id) ?? -10) > 0.35) {
              this.lastTrigger.set(s.id, this.clock);
              this.pulses.push({ point: input.point, age: 0, hue: scene.hue + scene.surfaces.indexOf(s) * 37 });
            }
          }
    this.entered = current;
    this.pulses = this.pulses.filter((p) => (p.age += dt) < 2.5).slice(-20);
    this.spawn += dt * (25 + scene.energy * 80);
    const emitters = scene.surfaces.filter((s) => s.behavior === 'emitter');
    const edges = scene.surfaces.reduce((n, s) => n + (s.behavior === 'solid' ? s.points.length : 0), 0),
      capacity = Math.min(
        this.quality.pointLimit,
        edges ? Math.max(1, Math.floor(this.quality.collisionChecks / edges)) : Infinity,
      );
    if (this.particles.length > capacity) this.particles.length = capacity;
    while (this.spawn >= 1 && this.particles.length < capacity) {
      this.spawn--;
      const shape = emitters.length ? emitters[Math.floor(Math.random() * emitters.length)] : null,
        point = shape
          ? shape.points.reduce(
              (p, v) => ({ x: p.x + v.x / shape.points.length, y: p.y + v.y / shape.points.length }),
              { x: 0, y: 0 },
            )
          : { x: Math.random(), y: 0.04 };
      this.particles.push({
        ...point,
        vx: (Math.random() - 0.5) * 0.15,
        vy: Math.random() * 0.1,
        life: 7 + Math.random() * 5,
        seed: Math.random(),
      });
    }
    this.spawn = Math.min(this.spawn, 1);
    const attractors: Interaction[] = scene.surfaces
      .filter((s) => s.behavior === 'attractor')
      .map((s) => ({
        id: s.id,
        point: s.points.reduce((p, v) => ({ x: p.x + v.x / s.points.length, y: p.y + v.y / s.points.length }), {
          x: 0,
          y: 0,
        }),
        strength: 0.5,
      }));
    const forces = [...inputs.slice(0, this.quality.inputLimit), ...attractors];
    for (const p of this.particles) {
      p.life -= dt;
      const old = { x: p.x, y: p.y };
      p.vy += scene.gravity * dt * 0.13;
      for (const input of forces) {
        const x = input.point.x - p.x,
          y = input.point.y - p.y,
          d = x * x + y * y + 0.012,
          force = (dt * 0.045 * input.strength) / d,
          radial = input.mode === 'repel' ? -1 : input.mode === 'vortex' ? 0.12 : 1,
          swirl = input.mode === 'vortex' ? 1.8 : 0.35;
        p.vx += x * force * radial - y * force * swirl;
        p.vy += y * force * radial + x * force * swirl;
      }
      if (scene.preset === 'garden' || scene.preset === 'ribbons' || scene.preset === 'orbit') {
        p.vx += Math.sin(p.y * 12 + this.clock * 0.6) * dt * 0.025;
        p.vy += Math.cos(p.x * 10 - this.clock * 0.4) * dt * 0.025;
      }
      const speed = Math.hypot(p.vx, p.vy);
      if (speed > 0.6) {
        p.vx *= 0.6 / speed;
        p.vy *= 0.6 / speed;
      }
      p.vx *= Math.exp(-dt * 0.18);
      p.vy *= Math.exp(-dt * 0.18);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      let nearest: ReturnType<typeof collision> = null;
      for (const s of scene.surfaces)
        if (s.behavior === 'solid')
          for (let i = 0; i < s.points.length; i++) {
            const hit = collision(old, p, s.points[i], s.points[(i + 1) % s.points.length]);
            if (hit && (!nearest || hit.t < nearest.t)) nearest = hit;
          }
      if (nearest) {
        const n = nearest,
          dot = p.vx * n.nx + p.vy * n.ny;
        p.vx = (p.vx - 2 * dot * n.nx) * 0.8;
        p.vy = (p.vy - 2 * dot * n.ny) * 0.8;
        p.x = old.x + (n.x - old.x) * 0.99;
        p.y = old.y + (n.y - old.y) * 0.99;
      }
    }
    this.particles = this.particles.filter((p) => p.life > 0 && p.x > -0.2 && p.x < 1.2 && p.y > -0.2 && p.y < 1.2);
  }
  draw(ctx: CanvasRenderingContext2D, scene: InteractiveScene, w: number, h: number, dt: number) {
    dt = interactiveFrameDelta(dt);
    if (scene.effects) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#03060c';
      ctx.fillRect(0, 0, w, h);
      const sceneSignature = JSON.stringify([
        scene.surfaces,
        scene.matter,
        scene.hue,
        scene.gravity,
        scene.energy,
        scene.trails,
      ]);
      for (const base of scene.effects.slice(0, 8)) {
        const e = this.evaluated.get(base.id),
          world = this.effectWorlds.get(base.id);
        if (!e || !world || (e.params.opacity ?? 1) <= 0) continue;
        let canvas = this.effectCanvases.get(e.id);
        if (!canvas) {
          canvas = document.createElement('canvas');
          this.effectCanvases.set(e.id, canvas);
        }
        const width = this.quality.canvasWidth,
          height = this.quality.canvasHeight;
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
          this.renderedEffects.delete(e.id);
        }
        const context = canvas.getContext('2d');
        if (!context) continue;
        const signature = sceneSignature + JSON.stringify(e.params),
          rendered = this.renderedEffects.get(e.id);
        if (rendered?.tick !== this.renderTick || rendered.signature !== signature) {
          world.draw(context, effectScene(scene, e), width, height, dt);
          this.renderedEffects.set(e.id, { tick: this.renderTick, signature });
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = e.params.opacity ?? 1;
        ctx.drawImage(canvas, 0, 0, w, h);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      return;
    }
    if (
      INTERACTIVE_PRESETS.indexOf(scene.preset) >= 6 ||
      scene.surfaces.some((s) => s.material && s.material !== 'none')
    ) {
      this.matter.draw(ctx, scene, w, h, this.transparent);
      return;
    }
    ctx.globalCompositeOperation = this.transparent ? 'destination-out' : 'source-over';
    ctx.fillStyle = `rgba(3,6,12,${1 - Math.exp(-Math.max(0.001, dt) * (3 + (1 - scene.trails) * 30))})`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    for (const s of scene.surfaces) {
      const color = scene.hue + scene.surfaces.indexOf(s) * 37;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `hsla(${color},90%,65%,.3)`;
      ctx.beginPath();
      s.points.forEach((p, i) => (i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h)));
      ctx.closePath();
      ctx.stroke();
      if (scene.preset === 'walls' || scene.preset === 'ribbons' || scene.preset === 'electric') {
        ctx.save();
        ctx.clip();
        const bands = Math.max(4, Math.round(16 / Math.sqrt(Math.max(1, this.quality.activeLayers)))),
          segments = Math.max(16, Math.round(48 / Math.sqrt(Math.max(1, this.quality.activeLayers))));
        for (let j = 0; j < bands; j++) {
          ctx.beginPath();
          for (let k = 0; k <= segments; k++) {
            const x = k / segments,
              y = j / (bands - 1) + Math.sin(x * 12 - this.clock * (0.3 + scene.energy) + j * 0.3) * 0.055;
            k ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h);
          }
          ctx.strokeStyle = `hsla(${color + j * 4},85%,65%,${0.1 + scene.energy * 0.1})`;
          ctx.lineWidth = scene.preset === 'ribbons' ? 3 : 1;
          ctx.stroke();
        }
        ctx.restore();
      }
      if (scene.preset === 'orbit') {
        const center = s.points.reduce((c, p) => ({ x: c.x + p.x / s.points.length, y: c.y + p.y / s.points.length }), {
          x: 0,
          y: 0,
        });
        for (let n = 0; n < 3; n++) {
          ctx.beginPath();
          ctx.ellipse(center.x * w, center.y * h, 32 + n * 16, 12 + n * 9, this.clock * 0.16 + n, 0, Math.PI * 2);
          ctx.strokeStyle = `hsla(${color + n * 25},90%,70%,.18)`;
          ctx.stroke();
        }
      }

      if (scene.preset === 'architecture')
        for (let j = 0; j < s.points.length; j++) {
          const a = s.points[j],
            b = s.points[(j + 1) % s.points.length],
            phase = (this.clock * (0.12 + scene.energy * 0.22) + j * 0.19) % 1;
          for (let k = 0; k < 8; k++) {
            const t = (phase - k * 0.012 + 1) % 1;
            ctx.fillStyle = `hsla(${color + k * 3},100%,70%,${(1 - k / 8) * 0.9})`;
            ctx.beginPath();
            ctx.arc((a.x + (b.x - a.x) * t) * w, (a.y + (b.y - a.y) * t) * h, 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
    }
    if (scene.preset === 'electric')
      for (let i = 0; i < this.particles.length; i += 3) {
        const p = this.particles[i];
        for (let j = i + 1; j < Math.min(i + 12, this.particles.length); j++) {
          const q = this.particles[j],
            d = Math.hypot((p.x - q.x) * w, (p.y - q.y) * h);
          if (d < 70) {
            ctx.strokeStyle = `hsla(${scene.hue + p.seed * 80},90%,65%,${(1 - d / 70) * 0.2})`;
            ctx.beginPath();
            ctx.moveTo(p.x * w, p.y * h);
            ctx.lineTo(q.x * w, q.y * h);
            ctx.stroke();
          }
        }
      }
    for (const p of this.particles) {
      ctx.strokeStyle = `hsla(${scene.hue + p.seed * 100},95%,65%,.35)`;
      ctx.lineWidth = scene.preset === 'ribbons' ? 2 : 1;
      if (scene.preset === 'ribbons' || scene.preset === 'garden') {
        ctx.beginPath();
        ctx.moveTo(p.x * w, p.y * h);
        ctx.lineTo((p.x - p.vx * 0.12) * w, (p.y - p.vy * 0.12) * h);
        ctx.stroke();
      }
      ctx.fillStyle = `hsla(${scene.hue + p.seed * 100},90%,65%,${Math.min(1, p.life) * 0.7})`;
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, scene.preset === 'garden' ? 1.5 + p.seed * 2 : 1 + p.seed, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const pulse of this.pulses) {
      ctx.strokeStyle = `hsla(${pulse.hue},100%,70%,${Math.max(0, 1 - pulse.age / 2.5)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pulse.point.x * w, pulse.point.y * h, pulse.age * Math.min(w, h) * 0.35, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}
/** Low-resolution movement centroid; explicitly not body/hand recognition. */
export class MotionSensor {
  private previous?: Uint8Array;
  private smoothed?: Point;
  reset() {
    this.previous = undefined;
    this.smoothed = undefined;
  }
  sample(rgba: Uint8ClampedArray, w: number, h: number, sensitivity: number): Interaction[] {
    const gray = new Uint8Array(w * h);
    let weight = 0,
      x = 0,
      y = 0,
      count = 0;
    for (let i = 0; i < gray.length; i++) {
      gray[i] = rgba[i * 4] * 0.3 + rgba[i * 4 + 1] * 0.59 + rgba[i * 4 + 2] * 0.11;
      if (this.previous) {
        const change = Math.abs(gray[i] - this.previous[i]);
        if (change > 35 - sensitivity * 25) {
          weight += change;
          x += ((i % w) + 0.5) * change;
          y += (Math.floor(i / w) + 0.5) * change;
          count++;
        }
      }
    }
    this.previous = gray;
    if (count < 4 || count > gray.length * 0.65) {
      this.smoothed = undefined;
      return [];
    }
    const target = { x: x / weight / w, y: y / weight / h };
    this.smoothed = this.smoothed
      ? { x: this.smoothed.x * 0.65 + target.x * 0.35, y: this.smoothed.y * 0.65 + target.y * 0.35 }
      : target;
    return [{ id: 'camera-motion', point: this.smoothed, strength: Math.min(1, count / 80) }];
  }
}
