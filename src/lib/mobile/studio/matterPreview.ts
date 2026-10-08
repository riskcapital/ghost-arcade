import type { InteractiveEffect } from './interactiveEffects';
import { inside, defaultMatter, type InteractiveScene, type InteractiveSurface, type Interaction } from './interactive';
import { createInteractiveQuality, interactiveFrameDelta, type InteractiveQualityBudget } from './interactiveQuality';

type Particle = { x: number; y: number; vx: number; vy: number; r: number; age: number; seed: number };
type SurfaceBounds = {
  surface: InteractiveSurface;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
};
const ASPECT = 16 / 9;
const EMPTY_FIELD = new Float32Array(0);
const EMPTY_MASK = new Uint8Array(0);

/** Portable Canvas approximation. Desktop pressure/volume-light solvers remain native. */
export class MatterPreview {
  effect?: InteractiveEffect;
  private quality = createInteractiveQuality();
  private particles: Particle[] = [];
  private field = EMPTY_FIELD;
  private next = EMPTY_FIELD;
  private liquidField = EMPTY_FIELD;
  private liquidTemp = EMPTY_FIELD;
  private mask = EMPTY_MASK;
  private sources = EMPTY_MASK;
  private canvas?: HTMLCanvasElement;
  private liquidCanvas?: HTMLCanvasElement;
  private heatContext?: CanvasRenderingContext2D;
  private liquidContext?: CanvasRenderingContext2D;
  private heatImage?: ImageData;
  private liquidImage?: ImageData;
  private signature = '';
  private mode = '';
  private bounds: SurfaceBounds[] = [];
  private solids: SurfaceBounds[] = [];
  private emitters: SurfaceBounds[] = [];
  private hasSources = false;
  private hasHeat = false;
  private solidEdges = 0;
  private particleLimit = 0;
  private edgeChecks = 0;
  private spawn = 0;
  private clock = 0;
  private burst = 0;
  private burstUntil = 0;
  private heatDirty = true;
  private liquidDirty = true;
  private drawHue = NaN;
  private liquidLook = '';

  setQuality(quality: InteractiveQualityBudget) {
    if (quality.fieldWidth !== this.quality.fieldWidth || quality.fieldHeight !== this.quality.fieldHeight) {
      const oldWidth = this.quality.fieldWidth,
        oldHeight = this.quality.fieldHeight;
      const oldHeat = this.field,
        oldLiquid = this.liquidField,
        oldMask = this.mask,
        oldSources = this.sources;
      this.releaseFields();
      // A layer-count change is a runtime quality change, not a simulation reset.
      // Preserve the visible state even when it happens while transport is paused.
      const resize = <T extends Float32Array | Uint8Array>(source: T, channels: number, target: T) => {
        for (let y = 0; y < quality.fieldHeight; y++)
          for (let x = 0; x < quality.fieldWidth; x++) {
            const oldX = Math.min(oldWidth - 1, Math.floor(((x + 0.5) / quality.fieldWidth) * oldWidth));
            const oldY = Math.min(oldHeight - 1, Math.floor(((y + 0.5) / quality.fieldHeight) * oldHeight));
            for (let k = 0; k < channels; k++)
              target[(y * quality.fieldWidth + x) * channels + k] = source[(oldY * oldWidth + oldX) * channels + k];
          }
        return target;
      };
      const cells = quality.fieldWidth * quality.fieldHeight;
      if (oldHeat.length) {
        this.field = resize(oldHeat, 2, new Float32Array(cells * 2));
        this.next = new Float32Array(cells * 2);
      }
      if (oldLiquid.length) {
        this.liquidField = resize(oldLiquid, 1, new Float32Array(cells));
        this.liquidTemp = new Float32Array(cells);
      }
      if (oldMask.length) this.mask = resize(oldMask, 1, new Uint8Array(cells));
      if (oldSources.length) this.sources = resize(oldSources, 1, new Uint8Array(cells));
      this.signature = '';
    }
    this.quality = quality;
  }

  diagnostics() {
    return {
      particles: this.particles.length,
      particleLimit: this.particleLimit,
      fieldCells: this.mask.length,
      bufferBytes:
        this.field.byteLength +
        this.next.byteLength +
        this.liquidField.byteLength +
        this.liquidTemp.byteLength +
        this.mask.byteLength +
        this.sources.byteLength +
        (this.heatImage?.data.byteLength ?? 0) +
        (this.liquidImage?.data.byteLength ?? 0),
      heatCanvas: !!this.canvas,
      liquidCanvas: !!this.liquidCanvas,
      collisionChecks: this.edgeChecks,
    };
  }

  private releaseCanvas(canvas?: HTMLCanvasElement) {
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  private releaseFields() {
    this.field = this.next = this.liquidField = this.liquidTemp = EMPTY_FIELD;
    this.mask = this.sources = EMPTY_MASK;
    this.releaseCanvas(this.canvas);
    this.releaseCanvas(this.liquidCanvas);
    this.canvas = this.liquidCanvas = undefined;
    this.heatContext = this.liquidContext = undefined;
    this.heatImage = this.liquidImage = undefined;
    this.heatDirty = this.liquidDirty = true;
    this.drawHue = NaN;
    this.liquidLook = '';
  }

  reset() {
    this.particles.length = 0;
    this.releaseFields();
    this.signature = this.mode = '';
    this.bounds = [];
    this.solids = [];
    this.emitters = [];
    this.hasSources = this.hasHeat = false;
    this.solidEdges = this.particleLimit = this.edgeChecks = 0;
    this.spawn = this.clock = this.burst = this.burstUntil = 0;
  }

  dispose() {
    this.reset();
    this.effect = undefined;
  }

  /** Scanline rasterization keeps edited 32×64-vertex scenes bounded, rather than
   * performing point-in-polygon for every field cell on every surface. */
  private prepareSurfaces(scene: InteractiveScene, heat: boolean, liquid: boolean, cloud: boolean) {
    const W = this.quality.fieldWidth,
      H = this.quality.fieldHeight;
    const signature = `${heat}:${liquid}:${cloud}:` + JSON.stringify(scene.surfaces);
    if (signature === this.signature) return;
    this.signature = signature;
    this.bounds = scene.surfaces.map((surface) => {
      let minX = 1,
        maxX = 0,
        minY = 1,
        maxY = 0,
        centerX = 0,
        centerY = 0;
      for (const p of surface.points) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
        centerX += p.x / surface.points.length;
        centerY += p.y / surface.points.length;
      }
      return { surface, minX, maxX, minY, maxY, centerX, centerY };
    });
    this.solids = this.bounds.filter((s) => s.surface.behavior === 'solid');
    this.solidEdges = this.solids.reduce((n, s) => n + s.surface.points.length, 0);
    this.emitters = this.bounds.filter(
      (s) => s.surface.material === (liquid ? 'liquid' : cloud ? 'points' : 'fire') || s.surface.behavior === 'emitter',
    );
    this.hasSources = false;
    if (!heat && !liquid) return;
    if (this.mask.length !== W * H) this.mask = new Uint8Array(W * H);
    else this.mask.fill(0);
    if (heat) {
      if (this.sources.length !== W * H) this.sources = new Uint8Array(W * H);
      else this.sources.fill(0);
    }
    const intersections: number[] = [];
    for (const bound of this.bounds) {
      const s = bound.surface;
      const source = s.material === 'fire' ? 1 : s.material === 'smoke' ? 2 : 0;
      for (
        let y = Math.max(0, Math.ceil(bound.minY * H - 0.5));
        y < Math.min(H, Math.ceil(bound.maxY * H - 0.5));
        y++
      ) {
        intersections.length = 0;
        const py = (y + 0.5) / H;
        for (let j = 0, k = s.points.length - 1; j < s.points.length; k = j++) {
          const a = s.points[j],
            b = s.points[k];
          if (a.y > py !== b.y > py) intersections.push((a.x + ((py - a.y) * (b.x - a.x)) / (b.y - a.y)) * W);
        }
        intersections.sort((a, b) => a - b);
        for (let i = 0; i + 1 < intersections.length; i += 2) {
          const start = y * W + Math.max(0, Math.ceil(intersections[i] - 0.5));
          const end = y * W + Math.min(W, Math.ceil(intersections[i + 1] - 0.5));
          if (s.behavior === 'solid') this.mask.fill(1, start, end);
          if (heat) this.sources.fill(source, start, end);
        }
      }
    }
    this.hasSources = heat && this.sources.some(Boolean);
  }

  update(scene: InteractiveScene, delta: number, inputs: Interaction[]) {
    if (this.effect?.enabled === false) {
      this.reset();
      return;
    }
    const dt = interactiveFrameDelta(delta);
    // Paused updates cannot spawn, age particles, accumulate bursts, or rebuild fields.
    if (!dt) return;
    const settings = { ...defaultMatter(), ...scene.matter },
      params = this.effect?.params ?? {};
    const ball = scene.preset === 'balls',
      cloud = scene.preset === 'cloud';
    const liquid = scene.preset === 'liquid' || scene.surfaces.some((s) => s.material === 'liquid');
    const heat =
      scene.preset === 'fire' ||
      scene.preset === 'smoke' ||
      scene.surfaces.some((s) => s.material === 'fire' || s.material === 'smoke');
    const mode = `${scene.preset}:${liquid}:${heat}`;
    if (mode !== this.mode) {
      this.reset();
      this.mode = mode;
    }
    this.hasHeat = heat;
    const W = this.quality.fieldWidth,
      H = this.quality.fieldHeight;
    if (heat && this.field.length !== W * H * 2) {
      this.field = new Float32Array(W * H * 2);
      this.next = new Float32Array(W * H * 2);
    }
    if (liquid && this.liquidField.length !== W * H) {
      this.liquidField = new Float32Array(W * H);
      this.liquidTemp = new Float32Array(W * H);
    }
    this.prepareSurfaces(scene, heat, liquid, cloud);
    this.clock += dt;
    if (this.effect && this.effect.burst !== this.burst) {
      this.burst = this.effect.burst;
      this.burstUntil = this.clock + (params.duration ?? 0.4);
    }
    const gate =
      !this.effect || this.effect.emission === 'continuous'
        ? 1
        : this.effect.emission === 'burst'
          ? Number(this.clock < this.burstUntil)
          : Number(this.clock % (params.period ?? 2) < (params.duration ?? 0.4));
    const free = this.effect?.target === 'point';
    if (heat) this.advanceHeat(scene, dt, gate, free);
    this.edgeChecks = 0;
    if (scene.preset === 'light' || scene.preset === 'smoke') {
      this.particleLimit = 0;
      return;
    }
    const lifetime = Math.max(0.05, params.lifetime ?? (ball ? 8 : liquid ? 6 : 15));
    const substeps = this.quality.substeps;
    // Each exact collision checks polygon membership and all edges. Retain every
    // authored surface, reducing simulation samples for unusually complex scenes.
    const geometryLimit = this.solidEdges
      ? Math.max(1, Math.floor(this.quality.collisionChecks / (this.solidEdges * substeps * 2)))
      : Infinity;
    const capacity = (this.particleLimit = Math.min(ball ? 48 : 700, this.quality.particleLimit, geometryLimit));
    this.compactParticles(lifetime);
    if (this.particles.length > capacity) {
      const stride = this.particles.length / capacity;
      for (let i = 0; i < capacity; i++) this.particles[i] = this.particles[Math.floor(i * stride)];
      this.particles.length = capacity;
    }
    const rate = Math.min(ball ? 12 : cloud ? 200 : liquid ? 250 : 20, capacity / (lifetime + 0.1));
    this.spawn += dt * rate * Math.max(0, settings.flow) * gate;
    while (this.spawn >= 1 && this.particles.length < capacity) {
      this.spawn--;
      const seed = Math.random();
      let x = Math.random(),
        y = cloud ? Math.random() : liquid || ball ? 0 : 0.95;
      if (this.emitters.length && !free) {
        const emitter = this.emitters[Math.floor(Math.random() * this.emitters.length)],
          s = emitter.surface;
        const j = Math.floor(Math.random() * s.points.length),
          a = s.points[j],
          b = s.points[(j + 1) % s.points.length];
        x = a.x + (b.x - a.x) * seed;
        y = a.y + (b.y - a.y) * seed;
        const d = Math.hypot(x - emitter.centerX, y - emitter.centerY) || 1;
        x += ((x - emitter.centerX) / d) * 0.02;
        y += ((y - emitter.centerY) / d) * 0.02;
      }
      const angle = ((params.direction ?? 90) * Math.PI) / 180;
      if (free) {
        x = (params.x ?? 0.5) - (Math.sin(angle) * (seed - 0.5) * (params.radius ?? 0.04) * 2) / ASPECT;
        y = (params.y ?? 0.12) + Math.cos(angle) * (seed - 0.5) * (params.radius ?? 0.04) * 2;
      }
      this.particles.push({
        x,
        y,
        vx: free ? (Math.cos(angle) * (params.speed ?? 0.15)) / ASPECT : (seed - 0.5) * 0.06,
        vy: free ? Math.sin(angle) * (params.speed ?? 0.15) : 0,
        age: 0,
        r: ball
          ? 0.012 + seed * 0.012 + settings.size * 0.012
          : liquid
            ? 0.005 + settings.size * 0.004
            : 0.001 + settings.size * 0.003,
        seed,
      });
    }
    this.spawn = Math.min(this.spawn, 2);
    const h = dt / substeps;
    const dragX = Math.exp(-h * (liquid ? 0.08 + settings.viscosity * 1.8 : 0.15));
    const dragY = Math.exp(-h * (liquid ? 0.08 + settings.viscosity * 1.8 : 0.12));
    for (const p of this.particles) {
      p.age += dt;
      for (let sub = 0; sub < substeps; sub++) {
        if (cloud) {
          const swirl = params.turbulence ?? 0.6;
          p.vx += Math.sin(p.y * 24 + this.clock * 0.4) * h * 0.05 * swirl;
          p.vy += Math.cos(p.x * 20 - this.clock * 0.35) * h * 0.05 * swirl;
        }
        p.vy += (ball || liquid ? scene.gravity * 0.65 : cloud ? 0 : -0.08) * h;
        for (let i = 0; i < Math.min(inputs.length, this.quality.inputLimit); i++) {
          const input = inputs[i],
            dx = (input.point.x - p.x) * ASPECT,
            dy = input.point.y - p.y;
          const f = (h * 0.08 * input.strength) / (dx * dx + dy * dy + 0.01),
            rad = input.mode === 'repel' ? -1 : input.mode === 'vortex' ? 0.1 : 1,
            sw = input.mode === 'vortex' ? 1.5 : 0.15;
          p.vx += ((dx * rad - dy * sw) * f) / ASPECT;
          p.vy += (dy * rad + dx * sw) * f;
        }
        if (liquid) {
          const x = Math.max(1, Math.min(W - 2, Math.round(p.x * W))),
            y = Math.max(1, Math.min(H - 2, Math.round(p.y * H))),
            i = y * W + x,
            d = this.liquidField;
          const pressure = Math.max(0, d[i] - (1.8 + (params.tension ?? 0.65) * 1.2)) / Math.max(d[i], 0.5);
          p.vx -= ((d[i + 1] - d[i - 1]) * pressure * h * 0.18) / ASPECT;
          p.vy -= (d[i + W] - d[i - W]) * pressure * h * 0.18;
        }
        p.vx *= dragX;
        p.vy *= dragY;
        const speed = Math.hypot(p.vx * ASPECT, p.vy);
        if (speed > 1) {
          p.vx /= speed;
          p.vy /= speed;
        }
        p.x += p.vx * h;
        p.y += p.vy * h;
        for (const bound of this.solids) {
          if (
            p.x + p.r / ASPECT < bound.minX ||
            p.x - p.r / ASPECT > bound.maxX ||
            p.y + p.r < bound.minY ||
            p.y - p.r > bound.maxY
          )
            continue;
          const s = bound.surface,
            inner = inside(p, s.points);
          this.edgeChecks += s.points.length * 2;
          let best = Infinity,
            nx = 0,
            ny = 0;
          for (let j = 0; j < s.points.length; j++) {
            const a = s.points[j],
              b = s.points[(j + 1) % s.points.length],
              ex = (b.x - a.x) * ASPECT,
              ey = b.y - a.y;
            const t = Math.max(
              0,
              Math.min(1, ((p.x - a.x) * ASPECT * ex + (p.y - a.y) * ey) / (ex * ex + ey * ey || 1)),
            );
            const dx = (p.x - a.x) * ASPECT - ex * t,
              dy = p.y - a.y - ey * t,
              d = Math.hypot(dx, dy);
            if (d < best) {
              best = d;
              nx = (dx / (d || 1)) * (inner ? -1 : 1);
              ny = (dy / (d || 1)) * (inner ? -1 : 1);
            }
          }
          const sd = inner ? -best : best;
          if (sd < p.r) {
            p.x += (nx * (p.r - sd + 0.001)) / ASPECT;
            p.y += ny * (p.r - sd + 0.001);
            const dot = p.vx * ASPECT * nx + p.vy * ny;
            if (dot < 0) {
              p.vx -= ((1 + (ball ? settings.bounce : 0.02)) * dot * nx) / ASPECT;
              p.vy -= (1 + (ball ? settings.bounce : 0.02)) * dot * ny;
              p.vx *= 1 - settings.friction * 0.15;
            }
          }
        }
        if (ball || liquid) {
          if (p.y > 1 - p.r) {
            p.y = 1 - p.r;
            p.vy = -Math.abs(p.vy) * (ball ? settings.bounce : 0.02);
          }
          if (p.x < p.r / ASPECT || p.x > 1 - p.r / ASPECT) {
            p.x = Math.max(p.r / ASPECT, Math.min(1 - p.r / ASPECT, p.x));
            p.vx = -p.vx * settings.bounce;
          }
        }
      }
    }
    // Balls stay capped at 48 even on high-tier devices (at most 1,128 pairs).
    if (ball) this.collideBalls(settings.bounce);
    this.compactParticles(lifetime);
    if (liquid) this.rebuildLiquid(settings.size, lifetime);
  }

  private compactParticles(lifetime: number) {
    let count = 0;
    for (const p of this.particles)
      if (p.age < lifetime && p.x > -0.2 && p.x < 1.2 && p.y > -0.2 && p.y < 1.2) this.particles[count++] = p;
    this.particles.length = count;
  }

  private collideBalls(bounce: number) {
    for (let i = 0; i < this.particles.length; i++)
      for (let j = i + 1; j < this.particles.length; j++) {
        const a = this.particles[i],
          b = this.particles[j],
          dx = (a.x - b.x) * ASPECT,
          dy = a.y - b.y,
          d = Math.hypot(dx, dy),
          r = a.r + b.r;
        if (d < r && d > 0.00001) {
          const nx = dx / d,
            ny = dy / d;
          a.x += (nx * (r - d) * 0.5) / ASPECT;
          a.y += ny * (r - d) * 0.5;
          b.x -= (nx * (r - d) * 0.5) / ASPECT;
          b.y -= ny * (r - d) * 0.5;
          const dot = (a.vx - b.vx) * ASPECT * nx + (a.vy - b.vy) * ny;
          if (dot < 0) {
            const impulse = dot * (1 + bounce) * 0.5;
            a.vx -= (impulse * nx) / ASPECT;
            a.vy -= impulse * ny;
            b.vx += (impulse * nx) / ASPECT;
            b.vy += impulse * ny;
          }
        }
      }
  }

  private sampleHeat(x: number, y: number, k: number) {
    const W = this.quality.fieldWidth,
      H = this.quality.fieldHeight;
    x = Math.max(0, Math.min(W - 1, x));
    y = Math.max(0, Math.min(H - 1, y));
    const ix = Math.floor(x),
      iy = Math.floor(y),
      fx = x - ix,
      fy = y - iy,
      right = Math.min(W - 1, ix + 1),
      below = Math.min(H - 1, iy + 1);
    return (
      (this.field[(iy * W + ix) * 2 + k] * (1 - fx) + this.field[(iy * W + right) * 2 + k] * fx) * (1 - fy) +
      (this.field[(below * W + ix) * 2 + k] * (1 - fx) + this.field[(below * W + right) * 2 + k] * fx) * fy
    );
  }

  private advanceHeat(scene: InteractiveScene, dt: number, gate: number, free: boolean) {
    const W = this.quality.fieldWidth,
      H = this.quality.fieldHeight,
      settings = { ...defaultMatter(), ...scene.matter },
      p = this.effect?.params ?? {};
    const smokeDecay = Math.exp(-dt / (p.lifetime ?? 2)),
      heatDecay = Math.exp((-dt / (p.lifetime ?? 1)) * 1.8);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        this.next[i * 2] = this.next[i * 2 + 1] = 0;
        if (this.mask[i]) continue;
        let heat = 0,
          smoke = 0;
        const bx = x - Math.sin((y / H) * 63 * 0.23 + this.clock * 1.1) * dt * 7 * (W / 112) * (p.turbulence ?? 0.7),
          by = y + dt * 12 * (H / 63) * (p.heat ?? 1);
        const back = Math.max(0, Math.min(H - 1, Math.round(by))) * W + Math.max(0, Math.min(W - 1, Math.round(bx)));
        if (!this.mask[back]) {
          smoke = this.sampleHeat(bx, by, 0) * smokeDecay;
          heat = this.sampleHeat(bx, by, 1) * heatDecay;
        }
        const src =
          this.sources[Math.min(W * H - 1, i + W)] ||
          (x > 0 ? this.sources[i - 1] : 0) ||
          (x < W - 1 ? this.sources[i + 1] : 0);
        if (src && !free) {
          smoke += dt * 2 * gate * settings.flow;
          heat += src === 1 ? dt * 7 * gate * settings.flow * (p.heat ?? 1) : 0;
        }
        if (free) {
          const distance = Math.hypot((x / W - (p.x ?? 0.5)) * ASPECT, y / H - (p.y ?? 0.8));
          const emit = Math.exp((-distance * distance) / (p.radius ?? 0.06) ** 2) * gate * settings.flow;
          if (scene.preset === 'fire') {
            heat += emit * dt * 12 * (p.heat ?? 1);
            smoke += emit * dt * 4 * settings.haze;
          }
          if (scene.preset === 'smoke') smoke += emit * dt * 8;
        }
        if (!free && y > H - 3 && !this.hasSources && Math.abs(x - W / 2) < W * 0.15) {
          if (scene.preset === 'fire') {
            heat += dt * 6 * gate * settings.flow;
            smoke += dt * gate * settings.flow;
          }
          if (scene.preset === 'smoke') smoke += dt * 3 * gate * settings.flow;
        }
        this.next[i * 2] = Math.min(2, smoke);
        this.next[i * 2 + 1] = Math.min(2, heat);
      }
    [this.field, this.next] = [this.next, this.field];
    this.heatDirty = true;
  }

  private fade(age: number, lifetime: number) {
    return Math.min(1, age / 0.04) * Math.max(0, Math.min(1, (lifetime - age) / Math.min(0.3, lifetime * 0.15)));
  }

  private rebuildLiquid(size: number, lifetime: number) {
    const W = this.quality.fieldWidth,
      H = this.quality.fieldHeight,
      field = this.liquidField;
    field.fill(0);
    for (const p of this.particles) {
      const x = p.x * W,
        y = p.y * H,
        vx = p.vx * W,
        vy = p.vy * H,
        speed = Math.hypot(vx, vy),
        ax = speed > 0 ? vx / speed : 0,
        ay = speed > 0 ? vy / speed : 1;
      const stretch = 1 + Math.min(1.5, speed * 0.04),
        radius = Math.max(0.65, ((1.1 + size * 0.8) * W) / 112),
        fade = this.fade(p.age, lifetime);
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          const xx = Math.floor(x) + dx,
            yy = Math.floor(y) + dy;
          if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue;
          const a = xx + 0.5 - x,
            b = yy + 0.5 - y,
            along = (a * ax + b * ay) / stretch,
            across = -a * ay + b * ax;
          field[yy * W + xx] +=
            (Math.exp((-(along * along + across * across) * 1.5) / (radius * radius)) * 0.6 * fade) / stretch;
        }
    }
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        this.liquidTemp[i] =
          (field[y * W + Math.max(0, x - 1)] + field[i] * 2 + field[y * W + Math.min(W - 1, x + 1)]) * 0.25;
      }
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        field[i] = this.mask[i]
          ? 0
          : (this.liquidTemp[Math.max(0, y - 1) * W + x] +
              this.liquidTemp[i] * 2 +
              this.liquidTemp[Math.min(H - 1, y + 1) * W + x]) *
            0.25;
      }
    this.liquidDirty = true;
  }
  draw(ctx: CanvasRenderingContext2D, scene: InteractiveScene, w: number, h: number, transparent = false) {
    const W = this.quality.fieldWidth,
      H = this.quality.fieldHeight;
    const settings = { ...defaultMatter(), ...scene.matter };
    const params = this.effect?.params ?? {};
    ctx.globalCompositeOperation = 'source-over';
    if (transparent) ctx.clearRect(0, 0, w, h);
    else {
      ctx.fillStyle = '#05080c';
      ctx.fillRect(0, 0, w, h);
    }
    if (this.effect?.enabled === false) return;
    const lx = settings.lightX * w,
      ly = settings.lightY * h;
    if (scene.preset === 'light') {
      ctx.fillStyle = `hsla(${scene.hue},45%,55%,${(params.ambient ?? 0.05) * 0.6})`;
      ctx.fillRect(0, 0, w, h);
      const reach = w * (1.35 / (1 + (params.falloff ?? 2) * 0.22));
      const glow = ctx.createRadialGradient(lx, ly, 0, lx, ly, reach);
      glow.addColorStop(
        0,
        `hsla(${scene.hue},65%,72%,${Math.min(1, (settings.haze * settings.lightPower * 0.8) / (0.6 + settings.lightHeight))})`,
      );
      glow.addColorStop(1, `hsla(${scene.hue},65%,55%,0)`);
      ctx.save();
      const angle = Math.atan2((params.targetY ?? 0.75) * h - ly, (params.targetX ?? 0.5) * w - lx),
        spread = ((params.spread ?? 100) * Math.PI) / 360;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.arc(lx, ly, w * 2, angle - spread, angle + spread);
      ctx.closePath();
      ctx.clip();
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.filter = `blur(${(params.softness ?? 0.35) * 12}px)`;
      // One blurred union, rather than a separate filtered fill for every edge.
      // A consistent winding keeps overlapping extrusions from cancelling out.
      ctx.beginPath();
      for (const s of scene.surfaces)
        if (s.behavior === 'solid')
          for (let j = 0; j < s.points.length; j++) {
            const a = s.points[j],
              b = s.points[(j + 1) % s.points.length],
              factor = 1 + (s.height ?? 0.25) / Math.max(0.05, settings.lightHeight - (s.height ?? 0.25)),
              ax = a.x * w,
              ay = a.y * h,
              bx = b.x * w,
              by = b.y * h,
              cx = lx + (bx - lx) * factor,
              cy = ly + (by - ly) * factor,
              dx = lx + (ax - lx) * factor,
              dy = ly + (ay - ly) * factor,
              area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) + (cx - ax) * (dy - ay) - (cy - ay) * (dx - ax);
            ctx.moveTo(ax, ay);
            if (area >= 0) {
              ctx.lineTo(bx, by);
              ctx.lineTo(cx, cy);
              ctx.lineTo(dx, dy);
            } else {
              ctx.lineTo(dx, dy);
              ctx.lineTo(cx, cy);
              ctx.lineTo(bx, by);
            }
            ctx.closePath();
          }
      ctx.fillStyle = `rgba(0,0,0,${params.shadow ?? 1})`;
      ctx.fill();
      ctx.restore();
      // Broad drifting haze bands; bounded canvas work on mobile.
      ctx.save();
      ctx.globalCompositeOperation = 'source-atop';
      for (let i = 0; i < 5; i++) {
        const y = (i / 5 + Math.sin(this.clock * 0.13 + i) * 0.05) * h;
        const band = ctx.createLinearGradient(0, y - h * 0.08, 0, y + h * 0.08);
        band.addColorStop(0, 'transparent');
        band.addColorStop(0.5, `rgba(255,255,255,${(params.turbulence ?? 0.45) * 0.05})`);
        band.addColorStop(1, 'transparent');
        ctx.fillStyle = band;
        ctx.fillRect(0, y - h * 0.08, w, h * 0.16);
      }
      ctx.restore();
    }
    if (this.hasHeat && this.field.length) {
      if (!this.canvas) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = W;
        this.canvas.height = H;
        this.heatContext = this.canvas.getContext('2d') ?? undefined;
        this.heatImage = this.heatContext?.createImageData(W, H);
      }
      const c = this.heatContext,
        data = this.heatImage;
      if (c && data && (this.heatDirty || this.drawHue !== scene.hue)) {
        for (let i = 0; i < W * H; i++) {
          const smoke = this.field[i * 2],
            heat = this.field[i * 2 + 1],
            r = i * 4;
          const flame = Math.max(
            0,
            heat * (0.7 + Math.sin((i % W) * 0.9 + Math.floor(i / W) * 0.6 + this.clock * 4) * 0.2) - smoke * 0.15,
          );
          data.data[r] = Math.min(255, flame * 320 + smoke * 35);
          data.data[r + 1] = Math.min(255, flame * flame * 150 + smoke * 42);
          data.data[r + 2] = Math.min(255, flame ** 3 * 60 + smoke * 55);
          if (flame > 0) {
            const hue = scene.hue / 360;
            for (let k = 0; k < 3; k++) {
              const tint = Math.max(0, Math.min(1, Math.abs(((hue + [0, 2 / 3, 1 / 3][k]) % 1) * 6 - 3) - 1));
              data.data[r + k] = Math.min(
                255,
                flame * (tint * 0.8 + 0.2) * 320 + Math.max(0, flame - 0.7) * 130 + smoke * 35,
              );
            }
          }
          data.data[r + 3] = Math.min(255, (smoke + flame) * 220);
        }
        c.putImageData(data, 0, 0);
        this.heatDirty = false;
        this.drawHue = scene.hue;
      }
      if (c) {
        ctx.globalCompositeOperation = 'screen';
        ctx.drawImage(this.canvas, 0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    for (const s of scene.surfaces) {
      ctx.beginPath();
      s.points.forEach((p, i) => (i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h)));
      ctx.closePath();
      ctx.fillStyle = s.material === 'fire' ? `hsl(${scene.hue},70%,12%)` : 'rgba(12,19,28,.85)';
      ctx.fill();
      ctx.strokeStyle = s.material === 'fire' ? `hsl(${scene.hue},90%,60%)` : '#425c70';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    const ball = scene.preset === 'balls',
      liquid = scene.preset === 'liquid' || scene.surfaces.some((s) => s.material === 'liquid');
    if (liquid && this.liquidField.length) {
      if (!this.liquidCanvas) {
        this.liquidCanvas = document.createElement('canvas');
        this.liquidCanvas.width = W;
        this.liquidCanvas.height = H;
        this.liquidContext = this.liquidCanvas.getContext('2d') ?? undefined;
        this.liquidImage = this.liquidContext?.createImageData(W, H);
      }
      const lc = this.liquidContext,
        image = this.liquidImage,
        field = this.liquidField;
      const look = `${scene.hue}:${params.roughness}:${params.refraction}`;
      if (lc && image && (this.liquidDirty || this.liquidLook !== look)) {
        image.data.fill(0);
        const hue = scene.hue / 360,
          tint = [0, 2 / 3, 1 / 3].map(
            (k) => Math.max(0, Math.min(1, Math.abs(((hue + k) % 1) * 6 - 3) - 1)) * 0.85 + 0.15,
          ),
          rough = params.roughness ?? 0.12,
          refract = params.refraction ?? 0.65;
        for (let y = 1; y < H - 1; y++)
          for (let x = 1; x < W - 1; x++) {
            const i = y * W + x,
              d = field[i];
            if (d < 0.055 || this.mask[i]) continue;
            const gx = (-(field[i + 1] - field[i - 1]) * 2.4) / (1 + d * 2),
              gy = (-(field[i + W] - field[i - W]) * 2.4) / (1 + d * 2),
              norm = Math.hypot(gx, gy, 0.24),
              nx = gx / norm,
              ny = gy / norm,
              nz = 0.24 / norm;
            const spec = Math.pow(Math.max(0, -0.172 * nx - 0.271 * ny + 0.947 * nz), 180 - rough * 168),
              fres = 0.035 + 0.965 * (1 - nz) ** 5;
            const ry = 2 * nz * ny,
              rx = 2 * nz * nx,
              sky = Math.max(0, Math.min(1, (ry + 0.5) / 1.3)),
              strip = Math.exp(-(((rx + ry * 0.35 - 0.15) / (0.065 + rough * 0.2)) ** 2));
            const thickness = 1 - Math.exp(-d * 0.9),
              caustic =
                (0.5 +
                  0.5 * Math.sin((x / W + nx * 0.06 * refract) * 42 + Math.sin((y / H) * 29 - this.clock * 0.8) * 2)) **
                  14 *
                0.06 *
                refract;
            for (let k = 0; k < 3; k++) {
              const env = [0.015, 0.028, 0.045][k] + ([0.52, 0.68, 0.78][k] - [0.015, 0.028, 0.045][k]) * sky;
              const water =
                tint[k] * (0.46 - thickness * 0.405) * (0.65 + 0.35 * nz) +
                env * (0.18 + fres * 0.82) +
                strip * (0.15 + fres * 0.85) * (1 - rough * 0.65) +
                spec * 1.5 +
                caustic;
              image.data[i * 4 + k] = 255 * (1 - Math.exp(-water * 1.25)) ** 0.85;
            }
            const coverage = Math.max(0, Math.min(1, (d - 0.055) / 0.085));
            image.data[i * 4 + 3] = 255 * coverage * coverage * (3 - 2 * coverage);
          }
        lc.putImageData(image, 0, 0);
        this.liquidDirty = false;
        this.liquidLook = look;
      }
      if (lc) ctx.drawImage(this.liquidCanvas, 0, 0, w, h);
    }
    if (!liquid && scene.preset !== 'smoke' && scene.preset !== 'light')
      for (const p of this.particles) {
        const r = p.r * h,
          x = p.x * w,
          y = p.y * h;
        const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.05, x, y, r);
        g.addColorStop(0, ball || liquid ? '#ffffff' : `hsl(${scene.hue + p.seed * 45},90%,80%)`);
        g.addColorStop(0.35, `hsl(${scene.hue + p.seed * 45},75%,55%)`);
        g.addColorStop(1, `hsl(${scene.hue + p.seed * 45},65%,12%)`);
        ctx.save();
        ctx.globalAlpha *= this.fade(p.age, params.lifetime ?? (ball ? 8 : 15));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
  }
}
