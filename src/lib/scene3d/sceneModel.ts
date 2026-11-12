/**
 * The Interactive 3D scene: schema `ghost-scene`, version 1.
 *
 * World units are metres, +Y up, right-handed, the same as Map Sim, so a
 * mapped room drops straight in. A scene is a list of nodes (meshes,
 * emitters, fields, lights, zones) with an environment, a camera, a finish
 * (post), how it follows the music, and its inputs and rules.
 *
 * `validateScene3D` checks a scene from anywhere (a project, a file, a phone)
 * and returns a copy built only from what the model knows. Unlike the 2D
 * validator it does not quietly drop what it does not understand: anything
 * wrong is an error that says where (`nodes[3] "Wall": unknown shape "cone"`).
 */

export const SCENE3D_SCHEMA = 'ghost-scene';
export const SCENE3D_VERSION = 1;
export const MAX_SCENE3D_NODES = 256;
export const MAX_OUTLINE_POINTS = 64;

export type Vec3 = [number, number, number];

export type Transform = {
  position: Vec3;
  /** Euler angles in degrees, applied X then Y then Z. */
  rotation: Vec3;
  scale: Vec3;
};

export const MATERIAL_PRESETS = ['chrome', 'glass', 'matte', 'neon', 'ink'] as const;
export type MaterialPreset = (typeof MATERIAL_PRESETS)[number];

export type Material = {
  /** Base colour, `#rrggbb`. */
  base: string;
  /** 0 dielectric to 1 metal. */
  metal: number;
  /** 0 mirror to 1 fully rough. */
  rough: number;
  /** Light the surface gives off itself, 0 to 10. */
  emissive: number;
  /** 0 clear to 1 solid. Below 1 the surface is drawn as glass. */
  opacity: number;
  /** A starting point the values above refine. */
  preset?: MaterialPreset;
  /** Any source in the app (a video, a shader, a camera) as the surface. */
  texture?: string;
};

export const MESH_SHAPES = ['box', 'sphere', 'plane', 'cylinder', 'outline'] as const;
export type MeshShape = (typeof MESH_SHAPES)[number];
export const COLLIDERS = ['none', 'static', 'body'] as const;
export type Collider = (typeof COLLIDERS)[number];

export type MeshNode = {
  kind: 'mesh';
  shape: MeshShape;
  material: Material;
  collider: Collider;
  /** Invisible, but receives shadows and blocks particles: the real room. */
  catcher: boolean;
  /** `outline` only: a flat shape (x, y in metres on the node's XY plane)
   *  extruded `depth` metres along its Z. */
  outline?: { points: { x: number; y: number }[]; depth: number };
};

export const EMITTER_SHAPES = ['point', 'box', 'sphere'] as const;
export type EmitterShape = (typeof EMITTER_SHAPES)[number];
export type EmitterNode = {
  kind: 'emitter';
  shape: EmitterShape;
  /** Particles a second. */
  rate: number;
  /** Particles released by one burst. */
  burst: number;
  /** Seconds a particle lives. */
  life: number;
  /** Metres a second along the node's +Y. */
  speed: number;
  /** Cone half-angle in degrees around +Y. */
  spread: number;
  /** Particle size in metres. */
  size: number;
  color: string;
  /** Light the particles give off, 0 to 10. */
  glow: number;
};

export const FIELD_KINDS = ['gravity', 'wind', 'vortex', 'attract', 'curl'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];
export type FieldNode = {
  kind: 'field';
  field: FieldKind;
  /** Metres a second squared at the centre; negative pushes away. */
  strength: number;
  /** Metres. 0 reaches the whole scene with no falloff. */
  radius: number;
};

export const LIGHT_KINDS = ['key', 'point', 'spot'] as const;
export type LightKind = (typeof LIGHT_KINDS)[number];
export type LightNode = {
  kind: 'light';
  light: LightKind;
  color: string;
  /** Brightness; 1 is a normal key. */
  power: number;
  /** Only the key light casts shadows in version 1. */
  shadows: boolean;
  /** A key light that moves: degrees a second around the scene's +Y. */
  orbit: number;
};

export const ZONE_SHAPES = ['box', 'sphere'] as const;
export type ZoneShape = (typeof ZONE_SHAPES)[number];
export type ZoneNode = {
  kind: 'zone';
  shape: ZoneShape;
  /** The event a rule listens for when something comes into the zone. */
  emits: string;
};

export type NodeBody = MeshNode | EmitterNode | FieldNode | LightNode | ZoneNode;
export type SceneNode = { id: string; name: string; transform: Transform; visible: boolean } & NodeBody;

export const SKIES = ['studio', 'night', 'void'] as const;
export type Sky = (typeof SKIES)[number];
export type Environment = {
  /** `void` is black and stays transparent, so the scene cuts out over other layers. */
  sky: Sky;
  /** Light from the sky, 0 to 4. */
  intensity: number;
  /** 0 clear to 1 thick. */
  fog: number;
};

export const CAMERA_MODES = ['free', 'director'] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];
export type Camera = {
  /** `free` stays where it is put; `director` circles the target slowly,
   *  faster with the music. (`projector`, the real lens, comes with Stage 3.) */
  mode: CameraMode;
  /** Vertical field of view in degrees. */
  fov: number;
  position: Vec3;
  target: Vec3;
};

export type Post = {
  /** Glow around bright light, 0 to 2. */
  bloom: number;
  /** Stops up or down, -4 to 4. */
  exposure: number;
  /** 0 flat to 2 hard. 1 leaves it. */
  contrast: number;
  /** 0 grey to 2 vivid. 1 leaves it. */
  saturation: number;
  /** -1 cool to 1 warm. */
  temperature: number;
  /** Film grain, 0 to 1. */
  grain: number;
};

/** How much each part of the scene follows the music, 0 to 1. Not zero by
 *  default, so a scene reacts with no set-up. */
export type React = {
  /** The key light breathes with the bass. */
  light: number;
  /** Emitters release more with the level. */
  particles: number;
  /** The glow flares on the beat. */
  bloom: number;
  /** The director camera moves faster as the music builds. */
  camera: number;
};

/** Inputs and rules are part of the format now and arrive in M3. */
export type InputBinding = { source: 'pointer' | 'hands' | 'body'; strength: number };
export type Rule = { when: string; zone?: string; then: { kind: string; [key: string]: unknown } };

export type Scene3D = {
  schema: typeof SCENE3D_SCHEMA;
  version: typeof SCENE3D_VERSION;
  name: string;
  nodes: SceneNode[];
  environment: Environment;
  camera: Camera;
  post: Post;
  react: React;
  inputs: InputBinding[];
  rules: Rule[];
};

// ── Defaults ──────────────────────────────────────────────────────────────

export const identityTransform = (): Transform => ({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });

/** Values for each material preset; `base` is the preset's own colour. */
export const PRESET_MATERIALS: Record<MaterialPreset, Omit<Material, 'preset' | 'texture'>> = {
  chrome: { base: '#d8dce4', metal: 1, rough: 0.08, emissive: 0, opacity: 1 },
  glass: { base: '#e8f2ff', metal: 0, rough: 0.02, emissive: 0, opacity: 0.25 },
  matte: { base: '#8a8a86', metal: 0, rough: 0.9, emissive: 0, opacity: 1 },
  neon: { base: '#ff3df0', metal: 0, rough: 0.4, emissive: 4, opacity: 1 },
  ink: { base: '#0b0c10', metal: 0, rough: 0.55, emissive: 0, opacity: 1 },
};

export const material = (preset: MaterialPreset = 'matte', patch: Partial<Material> = {}): Material => ({
  ...PRESET_MATERIALS[preset],
  preset,
  ...patch,
});

export function defaultScene3D(): Scene3D {
  return {
    schema: SCENE3D_SCHEMA,
    version: SCENE3D_VERSION,
    name: 'Untitled world',
    nodes: [],
    environment: { sky: 'void', intensity: 0.4, fog: 0.15 },
    camera: { mode: 'free', fov: 38, position: [0, 3.4, 8.2], target: [0, 1.2, 0] },
    post: { bloom: 0.8, exposure: 0, contrast: 1.05, saturation: 1.05, temperature: 0, grain: 0.08 },
    react: { light: 0.35, particles: 0.5, bloom: 0.4, camera: 0.3 },
    inputs: [],
    rules: [],
  };
}

// ── Validation ────────────────────────────────────────────────────────────

class SceneError extends Error {}
const fail = (where: string, what: string): never => {
  throw new SceneError(`${where}: ${what}`);
};

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function num(v: unknown, where: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fail(where, 'must be a number');
  if (v < min || v > max) return fail(where, `must be between ${min} and ${max}`);
  return v;
}
function bool(v: unknown, where: string): boolean {
  if (typeof v !== 'boolean') return fail(where, 'must be true or false');
  return v;
}
function text(v: unknown, where: string, max = 100): string {
  if (typeof v !== 'string') return fail(where, 'must be text');
  if (v.length > max) return fail(where, `is longer than ${max} characters`);
  return v;
}
function oneOf<T extends string>(v: unknown, options: readonly T[], where: string, noun: string): T {
  if (typeof v !== 'string' || !(options as readonly string[]).includes(v))
    return fail(where, `unknown ${noun} ${JSON.stringify(v)} (one of ${options.join(', ')})`);
  return v as T;
}
function color(v: unknown, where: string): string {
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) return fail(where, 'must be a colour like #ff8800');
  return v.toLowerCase();
}
function vec3(v: unknown, where: string, limit = 1000): Vec3 {
  if (!Array.isArray(v) || v.length !== 3) return fail(where, 'must be three numbers');
  return [num(v[0], `${where}[0]`, -limit, limit), num(v[1], `${where}[1]`, -limit, limit), num(v[2], `${where}[2]`, -limit, limit)];
}
/** Only the keys listed may appear: a misspelt field is an error, not a silent default. */
function only(o: Record<string, unknown>, keys: readonly string[], where: string): void {
  for (const k of Object.keys(o)) if (!keys.includes(k)) fail(where, `unknown field "${k}"`);
}

function validateTransform(raw: unknown, where: string): Transform {
  if (!isObject(raw)) return fail(where, 'must be an object');
  only(raw, ['position', 'rotation', 'scale'], where);
  const scale = vec3(raw.scale, `${where}.scale`, 1000);
  if (scale.some((s) => Math.abs(s) < 1e-4)) fail(`${where}.scale`, 'cannot be zero');
  return {
    position: vec3(raw.position, `${where}.position`),
    rotation: vec3(raw.rotation, `${where}.rotation`, 36000),
    scale,
  };
}

function validateMaterial(raw: unknown, where: string): Material {
  if (!isObject(raw)) return fail(where, 'must be an object');
  only(raw, ['base', 'metal', 'rough', 'emissive', 'opacity', 'preset', 'texture'], where);
  const out: Material = {
    base: color(raw.base, `${where}.base`),
    metal: num(raw.metal, `${where}.metal`, 0, 1),
    rough: num(raw.rough, `${where}.rough`, 0, 1),
    emissive: num(raw.emissive, `${where}.emissive`, 0, 10),
    opacity: num(raw.opacity, `${where}.opacity`, 0, 1),
  };
  if (raw.preset !== undefined) out.preset = oneOf(raw.preset, MATERIAL_PRESETS, `${where}.preset`, 'preset');
  if (raw.texture !== undefined) {
    const t = text(raw.texture, `${where}.texture`, 200);
    if (!/^[\w.:/-]+$/.test(t)) fail(`${where}.texture`, 'is not a source id');
    out.texture = t;
  }
  return out;
}

const COMMON = ['id', 'name', 'transform', 'visible', 'kind'] as const;

function validateNode(raw: unknown, where: string): SceneNode {
  if (!isObject(raw)) return fail(where, 'must be an object');
  const id = text(raw.id, `${where}.id`);
  if (!/^[\w-]{1,100}$/.test(id)) fail(`${where}.id`, 'may use letters, digits, - and _ only');
  const name = text(raw.name, `${where}.name`);
  const at = `${where} "${name || id}"`;
  const common = { id, name, transform: validateTransform(raw.transform, `${at}.transform`), visible: bool(raw.visible, `${at}.visible`) };
  const kind = oneOf(raw.kind, ['mesh', 'emitter', 'field', 'light', 'zone'] as const, `${at}.kind`, 'node kind');
  switch (kind) {
    case 'mesh': {
      only(raw, [...COMMON, 'shape', 'material', 'collider', 'catcher', 'outline'], at);
      const shape = oneOf(raw.shape, MESH_SHAPES, `${at}.shape`, 'shape');
      const node: SceneNode = {
        ...common,
        kind,
        shape,
        material: validateMaterial(raw.material, `${at}.material`),
        collider: oneOf(raw.collider, COLLIDERS, `${at}.collider`, 'collider'),
        catcher: bool(raw.catcher, `${at}.catcher`),
      };
      if (shape === 'outline') {
        const o = raw.outline;
        if (!isObject(o)) return fail(`${at}.outline`, 'an outline mesh needs its outline');
        only(o, ['points', 'depth'], `${at}.outline`);
        if (!Array.isArray(o.points) || o.points.length < 3 || o.points.length > MAX_OUTLINE_POINTS)
          fail(`${at}.outline.points`, `must be 3 to ${MAX_OUTLINE_POINTS} points`);
        const points = (o.points as unknown[]).map((p, i) => {
          const w = `${at}.outline.points[${i}]`;
          if (!isObject(p)) return fail(w, 'must be {x, y}');
          only(p, ['x', 'y'], w);
          return { x: num(p.x, `${w}.x`, -1000, 1000), y: num(p.y, `${w}.y`, -1000, 1000) };
        });
        node.outline = { points, depth: num(o.depth, `${at}.outline.depth`, 0.001, 100) };
      } else if (raw.outline !== undefined) fail(`${at}.outline`, 'only an outline mesh has one');
      return node;
    }
    case 'emitter':
      only(raw, [...COMMON, 'shape', 'rate', 'burst', 'life', 'speed', 'spread', 'size', 'color', 'glow'], at);
      return {
        ...common,
        kind,
        shape: oneOf(raw.shape, EMITTER_SHAPES, `${at}.shape`, 'emitter shape'),
        rate: num(raw.rate, `${at}.rate`, 0, 200000),
        burst: num(raw.burst, `${at}.burst`, 0, 200000),
        life: num(raw.life, `${at}.life`, 0.05, 60),
        speed: num(raw.speed, `${at}.speed`, 0, 100),
        spread: num(raw.spread, `${at}.spread`, 0, 180),
        size: num(raw.size, `${at}.size`, 0.001, 2),
        color: color(raw.color, `${at}.color`),
        glow: num(raw.glow, `${at}.glow`, 0, 10),
      };
    case 'field':
      only(raw, [...COMMON, 'field', 'strength', 'radius'], at);
      return {
        ...common,
        kind,
        field: oneOf(raw.field, FIELD_KINDS, `${at}.field`, 'field'),
        strength: num(raw.strength, `${at}.strength`, -1000, 1000),
        radius: num(raw.radius, `${at}.radius`, 0, 1000),
      };
    case 'light':
      only(raw, [...COMMON, 'light', 'color', 'power', 'shadows', 'orbit'], at);
      return {
        ...common,
        kind,
        light: oneOf(raw.light, LIGHT_KINDS, `${at}.light`, 'light'),
        color: color(raw.color, `${at}.color`),
        power: num(raw.power, `${at}.power`, 0, 100),
        shadows: bool(raw.shadows, `${at}.shadows`),
        orbit: num(raw.orbit, `${at}.orbit`, -360, 360),
      };
    case 'zone':
      only(raw, [...COMMON, 'shape', 'emits'], at);
      return {
        ...common,
        kind,
        shape: oneOf(raw.shape, ZONE_SHAPES, `${at}.shape`, 'zone shape'),
        emits: text(raw.emits, `${at}.emits`, 60),
      };
  }
}

export function validateScene3D(raw: unknown): Scene3D {
  if (!isObject(raw)) return fail('scene', 'must be an object');
  if (raw.schema !== SCENE3D_SCHEMA) fail('scene', `is not a ${SCENE3D_SCHEMA} scene`);
  if (raw.version !== SCENE3D_VERSION) fail('scene', `version ${JSON.stringify(raw.version)} is not supported (this build reads version ${SCENE3D_VERSION})`);
  only(raw, ['schema', 'version', 'name', 'nodes', 'environment', 'camera', 'post', 'react', 'inputs', 'rules'], 'scene');
  if (!Array.isArray(raw.nodes)) fail('nodes', 'must be a list');
  const nodesRaw = raw.nodes as unknown[];
  if (nodesRaw.length > MAX_SCENE3D_NODES) fail('nodes', `a scene holds at most ${MAX_SCENE3D_NODES} nodes`);
  const nodes = nodesRaw.map((n, i) => validateNode(n, `nodes[${i}]`));
  const ids = new Set<string>();
  for (const [i, n] of nodes.entries()) {
    if (ids.has(n.id)) fail(`nodes[${i}] "${n.name}"`, `id "${n.id}" is used twice`);
    ids.add(n.id);
  }

  const env = raw.environment;
  if (!isObject(env)) return fail('environment', 'must be an object');
  only(env, ['sky', 'intensity', 'fog'], 'environment');
  const cam = raw.camera;
  if (!isObject(cam)) return fail('camera', 'must be an object');
  only(cam, ['mode', 'fov', 'position', 'target'], 'camera');
  const post = raw.post;
  if (!isObject(post)) return fail('post', 'must be an object');
  only(post, ['bloom', 'exposure', 'contrast', 'saturation', 'temperature', 'grain'], 'post');
  const react = raw.react;
  if (!isObject(react)) return fail('react', 'must be an object');
  only(react, ['light', 'particles', 'bloom', 'camera'], 'react');

  const camera: Camera = {
    mode: oneOf(cam.mode, CAMERA_MODES, 'camera.mode', 'camera mode'),
    fov: num(cam.fov, 'camera.fov', 5, 150),
    position: vec3(cam.position, 'camera.position'),
    target: vec3(cam.target, 'camera.target'),
  };
  const d = camera.position.map((v, i) => v - camera.target[i]);
  if (Math.hypot(...d) < 1e-3) fail('camera', 'position and target cannot be the same point');

  if (!Array.isArray(raw.inputs)) fail('inputs', 'must be a list');
  const inputs = (raw.inputs as unknown[]).slice(0, 16).map((b, i) => {
    const w = `inputs[${i}]`;
    if (!isObject(b)) return fail(w, 'must be an object');
    only(b, ['source', 'strength'], w);
    return { source: oneOf(b.source, ['pointer', 'hands', 'body'] as const, `${w}.source`, 'input'), strength: num(b.strength, `${w}.strength`, 0, 1) };
  });
  if (!Array.isArray(raw.rules)) fail('rules', 'must be a list');
  if ((raw.rules as unknown[]).length) fail('rules', 'rules arrive with version 1 of the rule engine; this build reads none');

  return {
    schema: SCENE3D_SCHEMA,
    version: SCENE3D_VERSION,
    name: text(raw.name, 'name'),
    nodes,
    environment: {
      sky: oneOf(env.sky, SKIES, 'environment.sky', 'sky'),
      intensity: num(env.intensity, 'environment.intensity', 0, 4),
      fog: num(env.fog, 'environment.fog', 0, 1),
    },
    camera,
    post: {
      bloom: num(post.bloom, 'post.bloom', 0, 2),
      exposure: num(post.exposure, 'post.exposure', -4, 4),
      contrast: num(post.contrast, 'post.contrast', 0, 2),
      saturation: num(post.saturation, 'post.saturation', 0, 2),
      temperature: num(post.temperature, 'post.temperature', -1, 1),
      grain: num(post.grain, 'post.grain', 0, 1),
    },
    react: {
      light: num(react.light, 'react.light', 0, 1),
      particles: num(react.particles, 'react.particles', 0, 1),
      bloom: num(react.bloom, 'react.bloom', 0, 1),
      camera: num(react.camera, 'react.camera', 0, 1),
    },
    inputs,
    rules: [],
  };
}

/** Like `validateScene3D`, but returns the error message instead of throwing. */
export function checkScene3D(raw: unknown): { scene: Scene3D; error: null } | { scene: null; error: string } {
  try {
    return { scene: validateScene3D(raw), error: null };
  } catch (e) {
    return { scene: null, error: e instanceof Error ? e.message : String(e) };
  }
}
