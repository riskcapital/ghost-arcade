/**
 * Layer-param audit: every panel control must change the packed native
 * graph. Same methodology as effectParamAudit — build default content,
 * shift one field, diff the packer's full output JSON.
 *
 * Control inventory:
 *  - Splat/Model3D: harvested from data-midi-path/min/max/step/discrete
 *    annotations (dot paths like `echo.count` set into the nested object).
 *  - Text/Lines/AdvLightPainting: the default content object's own key
 *    space, walked recursively — panels write exactly these fields, so
 *    key space == control space (minus UI-only keys).
 *
 * A field is DEAD only when NO type-aware probe changes the packer
 * output. Findings are candidates for verification, not verdicts: a
 * genuinely unsupported-native control and a probe the packer clamps
 * away read the same. Report: /tmp/layer-param-audit.txt
 */
import { describe, it, beforeAll } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';

type Pack = (content: Record<string, unknown>) => string;
let packers: Record<string, Pack>;
let defaults: Record<string, Record<string, unknown>>;

interface Control {
  field: string; // dot path
  probes: unknown[];
}

/** Conditional gates: many knobs only pack when their feature is on
 *  (echo spacing needs echo enabled, glass IOR needs the glass material…).
 *  Each entry patches the base content before probing matching fields. */
const CONTEXTS: Record<string, Array<{ match: RegExp; apply: Record<string, unknown> }>> = {
  splat: [
    { match: /^audio/, apply: { audioEnabled: true } },
    { match: /^colorEffectSpeed$/, apply: { colorEffect: 'rainbow' } },
    { match: /^dofFocusDistance$/, apply: { opacityEffect: 'dof' } },
    { match: /^(gravity|friction|bounciness)$/, apply: { physicsEnabled: true } },
    { match: /^mouseStrength$/, apply: { mouseInteraction: 'attract' } },
    { match: /^autoRotateSpeed$/, apply: { cameraOrbitEnabled: true, autoRotate: true, cameraAutoRotate: true } },
    { match: /^animationProgress$/, apply: { animationLoop: false, animationType: 'explode' } },
  ],
  model3d: [
    { match: /^material(Roughness|Metalness)$/, apply: { materialType: 'standard' } },
    { match: /^hologram/, apply: { materialType: 'hologram' } },
    { match: /^lava/, apply: { materialType: 'lava' } },
    { match: /^glass/, apply: { materialType: 'glass' } },
    { match: /^dissolve/, apply: { materialType: 'dissolve' } },
    { match: /^chrome/, apply: { materialType: 'chrome' } },
    { match: /^wireframe/, apply: { materialType: 'wireframe', wireframeMode: true } },
    { match: /^vertexDecoration/, apply: { vertexDecoration: 'points' } },
    { match: /^deformationAxis$/, apply: { deformationType: 'wave', deformationIntensity: 1 } },
    { match: /^echo\./, apply: { echo: { enabled: true, type: 'ghostTrail', count: 6, spacing: 0.5, fadeRate: 0.15, scaleVariation: 0, rotationVariation: 0, colorVariation: 0, speed: 1, phaseOffset: 0 } } },
    { match: /^(audio\.|beat)/, apply: { audio: { enabled: true, audioBand: 'low', scaleResponse: 0.5, rotationResponse: 0.5, deformResponse: 0.5, colorResponse: 0.5, emissiveResponse: 0.5 } } },
    { match: /^animationSpeed$/, apply: { animationType: 'rotate' } },
    // 'rotate' ignores intensity; 'bounce' scales by it.
    { match: /^animationIntensity$/, apply: { animationType: 'bounce' } },
    // Loop only matters for one-shot animations (unfold/assemble/grow):
    // looping rides the clock sawtooth, non-looping rides the progress slider.
    { match: /^animationLoop$/, apply: { animationType: 'unfold', animationProgress: 0.9 } },
    { match: /^camera\.rotateSpeed$/, apply: { 'camera.autoRotate': true } },
    { match: /^backgroundOpacity$/, apply: { backgroundMode: 'color' } },
    { match: /^animationProgress$/, apply: { animationType: 'unfold', animationLoop: false } },
    { match: /^environmentIntensity$/, apply: { environmentEnabled: true } },
    { match: /^shadow(Softness|Bias)$/, apply: { shadowsEnabled: true } },
  ],
  text: [
    { match: /^animation\./, apply: { animation: { type: 'wave', speed: 1, loop: true, direction: 'ltr', staggerDelay: 40, intensity: 1 } } },
    { match: /^strokeColor$/, apply: { strokeWidth: 3 } },
    // staggerDelay needs a staggered-entrance animation ('wave' above is not
    // a valid type; letterReveal spaces letters by staggerDelay seconds).
    { match: /^animation\.staggerDelay$/, apply: { animation: { type: 'letterReveal', speed: 1, loop: true, direction: 'forward', staggerDelay: 0.05, intensity: 1 } } },
    // rotateZ/bevelSize only pack when the 3D extrusion block is on.
    { match: /^(rotateZ|bevelSize)$/, apply: { enable3D: true, extrudeDepth: 20 } },
  ],
  lines: [
    { match: /warpCorners/, apply: {} }, // patched per-element below
    { match: /^sharedShaderSourceId$/, apply: { sharedShaderMode: true } },
  ],
  lightpaint: [
    { match: /gpuSpiral|gpuParticle/, apply: {} },
    { match: /taper(Start|End|Curve)/, apply: {} },
    { match: /^snakeSpeed$/, apply: { snake: true } },
    { match: /^wind(Speed|Scale|Anchor)$/, apply: { windSway: 1 } },
    { match: /stagger/i, apply: { staggerStrokes: true, sequenceMode: 'random' } },
    { match: /^sequenceMode$/, apply: { staggerStrokes: true } },
    // The seed only reorders playback when the sequence is randomized.
    { match: /^randomSequenceSeed$/, apply: { staggerStrokes: true, sequenceMode: 'random' } },
  ],
};

/** Element-level lines gates need nested patching. */
function applyLinesElementContext(content: Record<string, unknown>, field: string): void {
  const el = (content.elements as Array<Record<string, unknown>>)[0];
  if (/warpCorners/.test(field)) el.warpEnabled = true;
  if (/meshWarp\./.test(field)) el.meshWarpEnabled = true;
  // The toggles themselves need a NON-default warp so flipping them moves
  // points (the default corner grid / mesh is the identity mapping).
  if (/\.warpEnabled$/.test(field)) {
    el.warpCorners = {
      topLeft: { x: 0.12, y: 0.08 }, topRight: { x: 0.9, y: 0.05 },
      bottomLeft: { x: 0.05, y: 0.95 }, bottomRight: { x: 0.88, y: 1.1 },
    };
  }
  if (/\.meshWarpEnabled$/.test(field)) {
    const mesh = el.meshWarp as { points: Array<Array<{ x: number; y: number }>> };
    mesh.points[1][1] = { x: 0.31, y: 0.68 };
  }
  // enabled is the gate itself: leave it at default so the probe flip counts.
  if (/drawAnimation\.(?!enabled)/.test(field)) (el.drawAnimation as Record<string, unknown>).enabled = true;
}

/** Lightpaint brush gates: gpu* knobs belong to specific brush types. */
function applyLightpaintContext(content: Record<string, unknown>, field: string): void {
  const brush = (content.strokes as Array<Record<string, unknown>>)[0].brush as Record<string, unknown>;
  const m = field.match(/gpu(Spiral|Water|Smoke|Particle)/);
  if (m) {
    // The native packer gates these on the PROCEDURAL brush names, not the
    // legacy gpu* brush ids (water→gpuWaterGravity, smoke→gpuSmokeRise,
    // firefly/sap-flow→gpuParticleDrift, spiral→gpuSpiral*).
    const map: Record<string, string> = { Spiral: 'spiral', Water: 'water', Smoke: 'smoke', Particle: 'firefly' };
    brush.type = map[m[1]];
  }
  if (/taper(Start|End|Curve)/.test(field)) brush.taper = true;
}

/** Enum probe pool: every quoted string inside an array literal in the
 *  packer source — covers idx(LIST, value) style lookups without
 *  hand-maintaining the lists. */
function enumPoolFromSource(packerSource: string): string[] {
  const pool = new Set<string>();
  for (const arr of packerSource.matchAll(/\[([^\]\[]{0,600}?)\]/g)) {
    for (const str of arr[1].matchAll(/'([a-zA-Z][a-zA-Z0-9_-]{1,30})'/g)) {
      pool.add(str[1]);
    }
  }
  return [...pool];
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let node: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = node[parts[i]];
    if (!next || typeof next !== 'object') {
      node[parts[i]] = {};
    }
    node = node[parts[i]] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]] = value;
}

function getPath(target: Record<string, unknown>, path: string): unknown {
  let node: unknown = target;
  for (const part of path.split('.')) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/** Type-aware probe battery derived from the field's current value. */
function probesFor(current: unknown): unknown[] {
  if (typeof current === 'boolean') return [!current];
  if (typeof current === 'number') {
    return [0, 1, current + 0.37, current * 1.7 + 0.51, 7].filter((v) => v !== current);
  }
  if (typeof current === 'string') {
    return current.startsWith('#') ? ['#123456'] : ['__probe__'];
  }
  if (Array.isArray(current) && current.every((v) => typeof v === 'number')) {
    return [current.map((v) => v * 0.5 + 0.13)];
  }
  return [];
}

function midiControls(panelSource: string, prefix: string): Control[] {
  const out: Control[] = [];
  const seen = new Set<string>();
  const marker = `data-midi-path="map:${prefix}:`;
  for (const chunk of panelSource.split(marker).slice(1)) {
    const nameEnd = chunk.indexOf('"');
    if (nameEnd <= 0) continue;
    const field = chunk.slice(0, nameEnd);
    if (!/^[a-zA-Z0-9_.]+$/.test(field) || seen.has(field)) continue;
    seen.add(field);
    const nextMarker = chunk.indexOf('data-midi-path=');
    const tail = chunk.slice(0, nextMarker > 0 ? nextMarker : Math.min(chunk.length, 800));
    const num = (name: string) => {
      const hit = tail.match(new RegExp(`data-midi-${name}="(-?[0-9.]+)"`));
      return hit ? Number(hit[1]) : null;
    };
    const discrete = tail.match(/data-midi-discrete="([^"]+)"/);
    const probes: unknown[] = [];
    if (discrete) {
      for (const value of discrete[1].split(',')) {
        probes.push(value);
        const n = Number(value);
        if (Number.isFinite(n)) probes.push(n);
      }
    } else {
      const min = num('min');
      const max = num('max');
      const step = num('step');
      if (min !== null && max !== null) {
        probes.push(min, max, (min + max) / 2);
        if (step === 1 && max <= 1) probes.push(true, false);
      } else {
        probes.push(0, 1, 0.37, 2.4, true, false);
      }
    }
    // Colors annotated as numeric knobs still carry array/hex content values.
    probes.push('#123456', [0.1, 0.2, 0.3], [0.1, 0.2, 0.3, 0.9]);
    out.push({ field, probes });
  }
  return out;
}

/** Walk the default content and emit a control per leaf field. */
function contentControls(
  root: Record<string, unknown>,
  skip: Set<string>,
  prefix = '',
  depth = 0,
): Control[] {
  const out: Control[] = [];
  if (depth > 3) return out;
  for (const [key, value] of Object.entries(root)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (skip.has(path) || skip.has(key)) continue;
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.every((v) => typeof v === 'number')) {
        out.push({ field: path, probes: probesFor(value) });
      } else if (value.length && typeof value[0] === 'object') {
        out.push(...contentControls(value[0] as Record<string, unknown>, skip, `${path}.0`, depth + 1));
      }
      continue;
    }
    if (typeof value === 'object') {
      out.push(...contentControls(value as Record<string, unknown>, skip, path, depth + 1));
      continue;
    }
    const probes = probesFor(value);
    if (probes.length) out.push({ field: path, probes });
  }
  return out;
}

beforeAll(async () => {
  const storage = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, String(v)),
    removeItem: (k: string) => void storage.delete(k),
    clear: () => storage.clear(), key: () => null, length: 0,
  };
  // layoutTextGlyphs measures via a 2D context; a deterministic fake is
  // enough for diffing (fixed per-char advance, fields settable).
  const fake2d = new Proxy({ font: '' } as Record<string, unknown>, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === 'measureText') {
        return (value: string) => ({
          width: value.length * 10,
          actualBoundingBoxAscent: 10,
          actualBoundingBoxDescent: 3,
          fontBoundingBoxAscent: 12,
          fontBoundingBoxDescent: 4,
        });
      }
      return () => undefined;
    },
    set(target, prop: string, value) { target[prop] = value; return true; },
  });
  (globalThis as any).document = {
    createElement: () => ({ getContext: () => fake2d, style: {}, remove: () => {}, width: 0, height: 0 }),
    documentElement: { style: { setProperty: () => {} }, setAttribute: () => {}, getAttribute: () => null },
    addEventListener: () => {}, removeEventListener: () => {},
    body: { appendChild: () => {}, removeChild: () => {} },
    baseURI: 'http://localhost/',
  };
  (globalThis as any).window = Object.assign((globalThis as any).window ?? {}, {
    addEventListener: () => {}, removeEventListener: () => {},
    setInterval, clearInterval, setTimeout, clearTimeout,
  });

  const types: any = await import('../types');
  const linesTypes: any = await import('../lines/types');
  const splat: any = await import('./splatNative');
  const model3d: any = await import('./model3dNative');
  const text: any = await import('./textNative');
  const lines: any = await import('./linesNative');
  const lightpaint: any = await import('./lightPaintingNative');

  const lightPaintingContent = types.createDefaultLightPaintingContent();
  lightPaintingContent.strokes = [{
    id: 'audit-stroke',
    points: [
      { x: 0.2, y: 0.2, t: 0 },
      { x: 0.5, y: 0.6, t: 200 },
      { x: 0.8, y: 0.4, t: 400 },
    ],
    brush: types.createDefaultLightPaintingBrush(),
    duration: 400,
    visible: true,
    locked: false,
    drawMode: 'freehand',
  }, {
    id: 'audit-stroke-2',
    points: [
      { x: 0.7, y: 0.7, t: 0 },
      { x: 0.3, y: 0.5, t: 200 },
      { x: 0.2, y: 0.8, t: 400 },
    ],
    brush: types.createDefaultLightPaintingBrush(),
    duration: 400,
    visible: true,
    locked: false,
    drawMode: 'freehand',
  }];
  (lightPaintingContent as any).isPlaying = true;

  const linesContent = linesTypes.createDefaultLinesContent();
  linesContent.elements = [
    linesTypes.createLineElement(linesTypes.createDefaultFreehandLine([
      { x: 0.1, y: 0.1 }, { x: 0.5, y: 0.4 }, { x: 0.9, y: 0.8 },
    ])),
  ];

  defaults = {
    splat: types.createDefaultSplatContent(),
    model3d: types.createDefaultModel3DContent(),
    text: types.createDefaultTextContent(),
    lines: linesContent,
    lightpaint: lightPaintingContent as unknown as Record<string, unknown>,
  };

  const N = 64;
  const positions = new Float32Array(N * 3);
  const colors = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    positions[i * 3] = Math.sin(i) % 1;
    positions[i * 3 + 1] = Math.cos(i * 1.7) % 1;
    positions[i * 3 + 2] = (i / N) - 0.5;
    colors[i * 3 + 1] = 1;
  }
  const packedPoints = splat.packSplatNativePoints({ positions, colors, sampleCount: N });

  const timing = { width: 320, height: 180, time: 1.37, frameDelta: 1 / 60, frameIndex: 41 };

  const textAtlasCells = new Map<string, { x: number; y: number; w: number; h: number; penX: number; penY: number; advance: number }>();
  for (const ch of ['H', 'i', ' solid']) {
    textAtlasCells.set(ch, { x: 0, y: 0, w: 16, h: 16, penX: 0, penY: 12, advance: 14 });
  }
  const textAtlas = {
    signature: 'audit', width: 64, height: 64,
    rgba: new Uint8ClampedArray(64 * 64 * 4),
    cells: textAtlasCells, rasterScale: 1, rasterFontSize: 48,
  };
  const textLetters = [
    { char: 'H', x: 0, y: 20, width: 14, index: 0, lineIndex: 0 },
    { char: 'i', x: 14, y: 20, width: 8, index: 1, lineIndex: 0 },
  ];

  packers = {
    splat: (content) => JSON.stringify(splat.buildSplatNativeComputeGraph({
      sourceId: 'a-splat', content, pointCount: packedPoints.pointCount,
      pointsBufferId: 'pts', pointsB64: null,
      textureSourceId: 'a-splat:tex', hasTexture: true,
      pointer: { x: 0.5, y: 0.5, active: true, down: false },
      audioLevel: 0.6, audioBeat: 0.4, audioBeatPhase: 0.5,
      ...timing,
    }).config),
    model3d: (content) => JSON.stringify(model3d.buildModel3DNativeComputeGraph({
      sourceId: 'a-model', content, vertexCount: 3, indexCount: 3,
      meshBufferId: 'mb', meshByteLength: 96, indexBufferId: 'ib', indexByteLength: 12,
      textureSourceId: 'a-model:tex', hasTexture: true, audioLevel: 0.6,
      audioSub: 0.35, audioBass: 0.55, audioLowMid: 0.45, audioMid: 0.5,
      audioHighMid: 0.4, audioHigh: 0.3, audioBeat: 0.4, audioBeatPhase: 0.5,
      ...timing,
    }).config),
    // Font/style/layout fields change the rasterized atlas or the glyph
    // layout rather than the per-frame uniform — fold both signatures into
    // the diffed output so those controls register as live.
    text: (content) => {
      try {
        const atlasSig = text.textAtlasSignature(content);
        const layout = JSON.stringify(text.layoutTextGlyphs(content, 320, 180));
        const packed = JSON.stringify(text.buildTextNativeComputeGraph({
          sourceId: 'a-text', atlasSourceId: 'a-text:atlas',
          content, atlas: textAtlas, letters: textLetters, ...timing,
        }).config);
        return `${atlasSig}|${layout}|${packed}`;
      } catch {
        return '';
      }
    },
    lines: (content) => JSON.stringify(lines.buildLinesNativeComputeGraph({
      sourceId: 'a-lines', content,
      audioBass: 0.5, audioTreble: 0.4, audioBeat: 0.3,
      ...timing,
    }).config),
    lightpaint: (content) => JSON.stringify(lightpaint.buildLightPaintingNativeComputeGraph({
      sourceId: 'a-lp', content,
      audioBass: 0.5, audioTreble: 0.4, audioBeat: 0.3,
      ...timing,
    }).config),
  };
});

describe('layer param audit', () => {
  it('finds panel controls that never reach the packed graph', () => {
    const root = process.cwd();
    // UI-only or non-render fields — no native representation expected.
    const skipCommon = new Set([
      'id', 'name', 'selectedElementId', 'locked', 'zIndex',
      'modelData', 'modelFormat', 'modelName', 'filePath', 'texturePath',
      '_originalFileName', 'vertexCount', 'faceCount', 'hasFileAnimations',
      // Lightpaint capture-time/UI state: drawMode picks the input tool,
      // smoothing is applied to points as they are recorded, point `t`
      // timestamps are recording metadata (unused by the legacy renderer
      // too), isRecording is a session flag.
      'drawMode', 'isRecording',
      'strokes.0.points.0.t', 'strokes.0.brush.smoothing',
      // Native-TODO (real render features with no native port yet):
      // GPU-particle extras live only in the WebGPU stroke-particle path
      // (webgpuStrokeParticles.ts) — particle budget, spiral core dot,
      // glass-tube styling.
      'gpuParticleCount', 'gpuSpiralShowCore',
      'gpuGlassTube', 'gpuGlassTubeRadiusScale', 'gpuGlassTubeColor',
      // Native-TODO: lines shared-shader mask mode (lines act as windows
      // into a shared ISF/video source) is not ported to the native pass.
      'sharedShaderMode', 'sharedShaderSourceId',
    ]);
    // UI-only midi-annotated controls (panel/interaction state, or handled
    // outside the packer): textureType switches the upload pipeline in
    // nativeRendererSync, cameraOrbitEnabled gates viewport drag-orbit,
    // showTransformGizmo is editor chrome. Native-TODO: useFileAnimation/
    // fileAnimationSpeed (GLTF file animations are not baked natively).
    const skipMidi: Record<string, Set<string>> = {
      splat: new Set(['textureType', 'showTransformGizmo', 'cameraOrbitEnabled']),
      model3d: new Set(['useFileAnimation', 'fileAnimationSpeed']),
    };
    const kinds: Array<{ kind: string; controls: Control[] }> = [
      {
        kind: 'splat',
        controls: midiControls(readFileSync(`${root}/src/lib/components/SplatPanel.svelte`, 'utf8'), 'splat')
          .filter((control) => !skipMidi.splat.has(control.field)),
      },
      {
        kind: 'model3d',
        controls: midiControls(readFileSync(`${root}/src/lib/components/Model3DPanel.svelte`, 'utf8'), 'model3d')
          .filter((control) => !skipMidi.model3d.has(control.field)),
      },
      { kind: 'text', controls: contentControls(defaults.text, skipCommon) },
      { kind: 'lines', controls: contentControls(defaults.lines, skipCommon) },
      { kind: 'lightpaint', controls: contentControls(defaults.lightpaint, skipCommon) },
    ];

    const packerSources: Record<string, string> = {
      splat: readFileSync(`${root}/src/lib/renderer/splatNative.ts`, 'utf8'),
      model3d: readFileSync(`${root}/src/lib/renderer/model3dNative.ts`, 'utf8'),
      text: readFileSync(`${root}/src/lib/renderer/textNative.ts`, 'utf8'),
      lines: readFileSync(`${root}/src/lib/renderer/linesNative.ts`, 'utf8'),
      lightpaint: readFileSync(`${root}/src/lib/renderer/lightPaintingNative.ts`, 'utf8'),
    };

    const lines: string[] = [];
    let liveTotal = 0;
    let deadTotal = 0;
    for (const { kind, controls } of kinds) {
      const pack = packers[kind];
      const enumPool = enumPoolFromSource(packerSources[kind]);
      const contexts = CONTEXTS[kind] ?? [];
      const buildContent = (field: string): Record<string, unknown> => {
        const content = structuredClone(defaults[kind]);
        for (const ctx of contexts) {
          if (ctx.match.test(field)) {
            // structuredClone: apply objects are shared across probes and a
            // by-reference assign would let setPath poison later probes.
            for (const [key, value] of Object.entries(ctx.apply)) setPath(content, key, structuredClone(value));
          }
        }
        if (kind === 'lines') applyLinesElementContext(content, field);
        if (kind === 'lightpaint') applyLightpaintContext(content, field);
        return content;
      };
      const dead: string[] = [];
      for (const control of controls) {
        const currentValue = getPath(defaults[kind], control.field);
        // Gated fields diff against a base that has the SAME gates applied,
        // so the gate itself is not what registers as the change.
        const gatedBase = pack(buildContent(control.field));
        if (!gatedBase) { dead.push(control.field); deadTotal++; continue; }
        const probes = [...control.probes];
        if (typeof currentValue === 'string' && !currentValue.startsWith('#')) {
          probes.push(...enumPool);
        }
        const live = probes.some((probe) => {
          if (probe === currentValue) return false;
          const content = buildContent(control.field);
          setPath(content, control.field, probe);
          const packed = pack(content);
          return packed !== '' && packed !== gatedBase;
        });
        if (live) liveTotal++;
        else { dead.push(control.field); deadTotal++; }
      }
      lines.push(`${kind}: ${controls.length - dead.length}/${controls.length} live${dead.length ? ` — DEAD: ${dead.join(', ')}` : ''}`);
    }
    lines.unshift(`LAYER PARAM AUDIT — live=${liveTotal} dead=${deadTotal}`);
    writeFileSync('/tmp/layer-param-audit.txt', lines.join('\n'));
    console.log(lines.join('\n'));
  });
});
