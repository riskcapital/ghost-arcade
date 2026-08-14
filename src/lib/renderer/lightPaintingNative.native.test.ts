import { describe, expect, it } from 'vitest';
import {
  createDefaultLightPaintingBrush,
  createDefaultLightPaintingContent,
  type LightPaintingBrushType,
  type LightPaintingStroke,
} from '../types';
import {
  LIGHT_PAINTING_HEADER_VEC4S,
  LIGHT_PAINTING_MAX_POINTS,
  LIGHT_PAINTING_MAX_STROKES,
  LIGHT_PAINTING_NATIVE_SHADER_ID,
  LIGHT_PAINTING_NATIVE_WGSL,
  LIGHT_PAINTING_STROKE_VEC4S,
  LIGHT_PAINTING_UNIFORM_BYTES,
  NATIVE_LIGHT_PAINTING_BRUSHES,
  buildLightPaintingNativeComputeGraph,
  buildLightPaintingNativePrecompileCommands,
  isNativeLightPaintingBrush,
} from './lightPaintingNative';

const ALL_LIGHT_PAINTING_BRUSHES: LightPaintingBrushType[] = [
  'glow',
  'neon',
  'flame',
  'electric',
  'ribbon',
  'particle',
  'smoke',
  'laser',
  'calligraphy',
  'spray',
  'paintbrush',
  'marker',
  'watercolor',
  'spiral',
  'firefly',
  'sap-flow',
  'water',
  'sparkle',
  'plasma',
  'galaxy',
  'lightning',
  'vortex',
  'nebula',
  'kaleido',
  'ink',
  'crystal',
  'aurora',
  'bubbles',
  'orbit',
  'helix',
];

const HEADER_VEC4S = LIGHT_PAINTING_HEADER_VEC4S;
const STROKE_STRIDE_F32 = LIGHT_PAINTING_STROKE_VEC4S * 4;

function createStroke(type: LightPaintingBrushType): LightPaintingStroke {
  return {
    id: `native-light-stroke-${type}`,
    points: [
      { x: 0.1, y: 0.2, pressure: 1, timestamp: 0 },
      { x: 0.5, y: 0.45, pressure: 0.8, timestamp: 40 },
      { x: 0.85, y: 0.75, pressure: 1, timestamp: 80 },
    ],
    brush: { ...createDefaultLightPaintingBrush(), type },
    duration: 80,
    visible: true,
    locked: false,
    drawMode: 'freehand',
  };
}

function uniformData(graph: ReturnType<typeof buildLightPaintingNativeComputeGraph>): number[] {
  return graph.config.buffers[0]!.initial_f32 as number[];
}

function strokeField(data: number[], strokeIndex: number, f32Offset: number): number {
  return data[HEADER_VEC4S * 4 + strokeIndex * STROKE_STRIDE_F32 + f32Offset]!;
}

describe('native Light Painting graph', () => {
  it('keeps the complete native brush inventory explicit', () => {
    expect([...NATIVE_LIGHT_PAINTING_BRUSHES]).toEqual(ALL_LIGHT_PAINTING_BRUSHES);

    for (const brush of ALL_LIGHT_PAINTING_BRUSHES) {
      expect(isNativeLightPaintingBrush(brush)).toBe(true);
    }
  });

  it('pins the dedicated render contract', () => {
    expect(LIGHT_PAINTING_NATIVE_SHADER_ID).toBe('light-painting/render-v8');
    expect(LIGHT_PAINTING_NATIVE_WGSL).toContain('fn fs_paint');
    expect(LIGHT_PAINTING_NATIVE_WGSL).toContain('fn vs_full');
    expect(LIGHT_PAINTING_NATIVE_WGSL).toContain(
      `array<vec4<f32>, ${LIGHT_PAINTING_MAX_POINTS}>`,
    );
    expect(LIGHT_PAINTING_NATIVE_WGSL).toContain(
      `array<vec4<f32>, ${LIGHT_PAINTING_MAX_STROKES * LIGHT_PAINTING_STROKE_VEC4S}>`,
    );
  });

  it('packs retained strokes into the dedicated render pass', () => {
    const content = createDefaultLightPaintingContent();
    content.strokes = [createStroke('neon')];
    content.isPlaying = true;
    content.playbackPosition = 0.5;

    const graph = buildLightPaintingNativeComputeGraph({
      sourceId: 'light-layer-1',
      content,
      width: 1920,
      height: 1080,
      time: 1,
      frameDelta: 1 / 60,
      frameIndex: 60,
    });

    expect(graph.passCount).toBe(1);
    expect(graph.sourceId).toBe('light-layer-1');
    expect(graph.config.buffers).toHaveLength(1);
    expect(graph.config.buffers[0]?.id).toContain('light-painting:light-layer-1');
    expect(graph.config.buffers[0]?.byte_length).toBe(LIGHT_PAINTING_UNIFORM_BYTES);
    expect(graph.config.render_passes).toEqual([
      expect.objectContaining({
        name: 'light-painting-render',
        shader_id: LIGHT_PAINTING_NATIVE_SHADER_ID,
        vertex_entry: 'vs_full',
        fragment_entry: 'fs_paint',
        target: 'source_frame',
        source_id: 'light-layer-1',
      }),
    ]);

    const data = uniformData(graph);
    expect(data[0]).toBe(1920);
    expect(data[1]).toBe(1080);
    expect(data[4]).toBe(1); // stroke count
    expect(strokeField(data, 0, 0)).toBe(ALL_LIGHT_PAINTING_BRUSHES.indexOf('neon'));
    expect(strokeField(data, 0, 3)).toBe(3); // point count
  });

  it('bakes points in pixel space with cumulative arc length', () => {
    const content = createDefaultLightPaintingContent();
    content.strokes = [createStroke('glow')];

    const graph = buildLightPaintingNativeComputeGraph({
      sourceId: 'light-layer-pts',
      content,
      width: 1000,
      height: 500,
      time: 0,
      frameDelta: 1 / 60,
      frameIndex: 0,
    });

    const data = uniformData(graph);
    const pointsBase = (HEADER_VEC4S + LIGHT_PAINTING_MAX_STROKES * LIGHT_PAINTING_STROKE_VEC4S) * 4;
    expect(data[pointsBase]).toBeCloseTo(100); // 0.1 * 1000
    expect(data[pointsBase + 1]).toBeCloseTo(100); // 0.2 * 500
    expect(data[pointsBase + 2]).toBe(0); // cumLen starts at 0
    expect(data[pointsBase + 3]).toBe(1); // pressure
    expect(data[pointsBase + 4]).toBeCloseTo(500); // 0.5 * 1000
    expect(data[pointsBase + 6]).toBeGreaterThan(0); // cumulative length grows
  });

  it('freezes paused mid-scrub playback as a static partial draw', () => {
    const content = createDefaultLightPaintingContent();
    content.strokes = [createStroke('laser')];
    content.isPlaying = false;
    content.playbackPosition = 0.35;

    const graph = buildLightPaintingNativeComputeGraph({
      sourceId: 'light-layer-paused',
      content,
      width: 1920,
      height: 1080,
      time: 2,
      frameDelta: 1 / 60,
      frameIndex: 120,
    });

    const data = uniformData(graph);
    expect(strokeField(data, 0, 20)).toBe(0); // animEnabled off while paused
    expect(strokeField(data, 0, 24)).toBeCloseTo(0.35); // drawProgress frozen at scrub
  });

  it('shows retained strokes fully when playback never started', () => {
    const content = createDefaultLightPaintingContent();
    content.strokes = [createStroke('marker')];
    content.isPlaying = false;
    content.playbackPosition = 0;

    const graph = buildLightPaintingNativeComputeGraph({
      sourceId: 'light-layer-idle',
      content,
      width: 1920,
      height: 1080,
      time: 0,
      frameDelta: 1 / 60,
      frameIndex: 0,
    });

    const data = uniformData(graph);
    expect(strokeField(data, 0, 20)).toBe(0);
    expect(strokeField(data, 0, 24)).toBe(1); // fully drawn, not hidden
  });

  it('always renders the live preview stroke fully drawn', () => {
    const content = createDefaultLightPaintingContent();
    content.strokes = [];
    content.isPlaying = true;
    content.playbackPosition = 0.1;
    content.livePreviewStroke = {
      points: [
        { x: 0.2, y: 0.2, pressure: 1, timestamp: 0 },
        { x: 0.6, y: 0.6, pressure: 1, timestamp: 30 },
      ],
      brush: { ...createDefaultLightPaintingBrush(), type: 'glow' },
    } as any;

    const graph = buildLightPaintingNativeComputeGraph({
      sourceId: 'light-layer-live',
      content,
      width: 1920,
      height: 1080,
      time: 1,
      frameDelta: 1 / 60,
      frameIndex: 60,
    });

    const data = uniformData(graph);
    expect(data[4]).toBe(1);
    expect(strokeField(data, 0, 20)).toBe(0); // live stroke never animates
    expect(strokeField(data, 0, 24)).toBe(1); // and is always full
  });

  it('packs layer FX with motion effects gated on playback', () => {
    const content = createDefaultLightPaintingContent();
    content.strokes = [createStroke('glow')];
    content.pulse = 0.8;
    content.strobe = 0.5;
    content.colorShift = 0.4;
    content.echo = 3;
    content.snake = 0.6;
    content.snakeSpeed = 2;
    content.trailLength = 0.3;

    const build = () =>
      buildLightPaintingNativeComputeGraph({
        sourceId: 'light-layer-fx',
        content,
        width: 1920,
        height: 1080,
        time: 1,
        frameDelta: 1 / 60,
        frameIndex: 60,
      });

    content.isPlaying = false;
    let data = uniformData(build());
    expect(data[17]).toBe(0); // pulse gated off while paused
    expect(data[19]).toBe(0); // strobe gated off while paused
    expect(data[16]).toBeCloseTo(0.4); // hue shift stays active on static art
    expect(data[32]).toBe(3); // echo stays active on static art
    expect(strokeField(data, 0, 25)).toBeCloseTo(0.3); // snake inactive → trail slider

    content.isPlaying = true;
    data = uniformData(build());
    expect(data[17]).toBeCloseTo(0.8);
    expect(data[19]).toBeCloseTo(0.5);
    expect(strokeField(data, 0, 25)).toBeCloseTo(0.4); // snake trail = 1 - head size
    // drawSpeed × (4.5 / per-stroke duration, floored at 0.15s): 2 * (4.5 / 0.15)
    expect(strokeField(data, 0, 21)).toBeCloseTo(60);
  });

  it('sways packed points with wind only during playback', () => {
    const content = createDefaultLightPaintingContent();
    content.strokes = [createStroke('glow')];
    content.windSway = 1;
    content.windSpeed = 1;

    const build = () =>
      buildLightPaintingNativeComputeGraph({
        sourceId: 'light-layer-wind',
        content,
        width: 1000,
        height: 500,
        time: 0.37,
        frameDelta: 1 / 60,
        frameIndex: 22,
      });

    const pointsBase = (HEADER_VEC4S + LIGHT_PAINTING_MAX_STROKES * LIGHT_PAINTING_STROKE_VEC4S) * 4;
    content.isPlaying = false;
    const staticX = uniformData(build())[pointsBase]!;
    expect(staticX).toBeCloseTo(100); // undisturbed while paused

    content.isPlaying = true;
    const windX = uniformData(build())[pointsBase]!;
    expect(windX).not.toBeCloseTo(100, 1); // displaced by sway while playing
  });

  it('packs sequence-order slots for staggered playback', () => {
    const strokeAtY = (y: number): LightPaintingStroke => ({
      ...createStroke('glow'),
      points: [
        { x: 0.4, y, pressure: 1, timestamp: 0 },
        { x: 0.6, y, pressure: 1, timestamp: 40 },
      ],
    });
    const content = createDefaultLightPaintingContent();
    content.strokes = [strokeAtY(0.8), strokeAtY(0.2), strokeAtY(0.5)];
    content.isPlaying = true;
    content.staggerStrokes = true;

    const build = () =>
      buildLightPaintingNativeComputeGraph({
        sourceId: 'light-layer-seq',
        content,
        width: 1920,
        height: 1080,
        time: 1,
        frameDelta: 1 / 60,
        frameIndex: 60,
      });

    content.sequenceMode = 'recorded';
    let data = uniformData(build());
    expect([strokeField(data, 0, 23), strokeField(data, 1, 23), strokeField(data, 2, 23)]).toEqual([0, 1, 2]);

    // Alternating interleaves first/last: play order 0, 2, 1.
    content.sequenceMode = 'alternating';
    data = uniformData(build());
    expect([strokeField(data, 0, 23), strokeField(data, 1, 23), strokeField(data, 2, 23)]).toEqual([0, 2, 1]);

    // Top-down sorts by stroke center y: play order 1 (y=.2), 2 (y=.5), 0 (y=.8).
    content.sequenceMode = 'topDown';
    data = uniformData(build());
    expect([strokeField(data, 0, 23), strokeField(data, 1, 23), strokeField(data, 2, 23)]).toEqual([2, 0, 1]);

    // Bottom-up is the inverse.
    content.sequenceMode = 'bottomUp';
    data = uniformData(build());
    expect([strokeField(data, 0, 23), strokeField(data, 1, 23), strokeField(data, 2, 23)]).toEqual([0, 2, 1]);

    // Random is a deterministic seeded permutation of all three slots.
    content.sequenceMode = 'random';
    data = uniformData(build());
    const randomSlots = [strokeField(data, 0, 23), strokeField(data, 1, 23), strokeField(data, 2, 23)];
    expect([...randomSlots].sort()).toEqual([0, 1, 2]);
  });

  it('builds a native render pass for every Light Painting brush', () => {
    for (const brush of ALL_LIGHT_PAINTING_BRUSHES) {
      const content = createDefaultLightPaintingContent();
      content.strokes = [createStroke(brush)];

      const graph = buildLightPaintingNativeComputeGraph({
        sourceId: `light-layer-${brush}`,
        content,
        width: 1920,
        height: 1080,
        time: 1,
        frameDelta: 1 / 60,
        frameIndex: 60,
      });

      expect(graph.passCount, `${brush} should produce a native pass`).toBe(1);
      expect(graph.config.buffers, `${brush} should produce native geometry`).toHaveLength(1);
      const data = uniformData(graph);
      expect(strokeField(data, 0, 0), `${brush} should map to its own brush code`).toBe(
        ALL_LIGHT_PAINTING_BRUSHES.indexOf(brush),
      );
      expect(graph.config.render_passes[0], `${brush} should target the native source frame`).toEqual(
        expect.objectContaining({
          shader_id: LIGHT_PAINTING_NATIVE_SHADER_ID,
          target: 'source_frame',
        }),
      );
    }
  });

  it('caps packed strokes at the shader budget', () => {
    const content = createDefaultLightPaintingContent();
    content.strokes = Array.from({ length: LIGHT_PAINTING_MAX_STROKES + 6 }, () =>
      createStroke('glow'),
    );

    const graph = buildLightPaintingNativeComputeGraph({
      sourceId: 'light-layer-many',
      content,
      width: 1920,
      height: 1080,
      time: 0,
      frameDelta: 1 / 60,
      frameIndex: 0,
    });

    const data = uniformData(graph);
    expect(data[4]).toBe(LIGHT_PAINTING_MAX_STROKES);
  });

  it('precompiles the native Light Painting shader contract', () => {
    expect(buildLightPaintingNativePrecompileCommands()).toEqual([
      expect.objectContaining({
        type: 'precompile_shader',
        shader_id: LIGHT_PAINTING_NATIVE_SHADER_ID,
        stage: 'render',
        entry: 'fs_paint',
      }),
    ]);
  });
});
