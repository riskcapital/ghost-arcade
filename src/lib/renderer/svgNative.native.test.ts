import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultSVGContent, type SVGContent } from '$lib/types';
import {
  SVG_NATIVE_SHADER_ID,
  SVG_NATIVE_WGSL,
  SVG_TRANSFORM_WGSL,
  SVG_UNIFORM_BYTES,
  buildSvgNativeComputeGraph,
  buildSvgNativePrecompileCommands,
  parseSvgNativeContours,
} from './svgNative';

function svgContent(svgSource: string): SVGContent {
  return {
    ...createDefaultSVGContent(),
    svgSource,
    fillMode: 'solid',
    colorMode: 'white',
    colorCycleEnabled: false,
  };
}

const nativeCoreBin = join(
  process.cwd(),
  'native-renderer',
  'target',
  'release',
  process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core',
);

function createNativeRpc() {
  const child = spawn(nativeCoreBin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new Error('native render-core stdio was not initialized');
  }

  let nextId = 1;
  let stdout = '';
  let stderr = '';
  const pending = new Map<number, {
    timer: ReturnType<typeof setTimeout>;
    resolve(value: any): void;
    reject(error: Error): void;
  }>();

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
    let newline = stdout.indexOf('\n');
    while (newline >= 0) {
      const line = stdout.slice(0, newline).trim();
      stdout = stdout.slice(newline + 1);
      if (line) {
        const message = JSON.parse(line) as {
          id?: number;
          ok?: boolean;
          result?: unknown;
          error?: string;
        };
        const waiter = typeof message.id === 'number' ? pending.get(message.id) : null;
        if (waiter) {
          clearTimeout(waiter.timer);
          pending.delete(message.id as number);
          if (message.ok) waiter.resolve(message.result);
          else waiter.reject(new Error(message.error || 'native render-core request failed'));
        }
      }
      newline = stdout.indexOf('\n');
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  const send = (method: string, params: Record<string, unknown> = {}, timeoutMs = 5000) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`native render-core timed out handling ${method}: ${stderr.trim()}`));
      }, timeoutMs);
      pending.set(id, { timer, resolve, reject });
      child.stdin?.write(`${JSON.stringify({ id, method, params })}\n`);
    });

  return {
    send,
    async close() {
      try {
        await send('shutdown', {}, 1000);
      } catch {
        // The process may already have stopped after a failed assertion.
      }
      child.kill();
    },
  };
}

describe('native SVG graph', () => {
  it('packs common SVG geometry into finite native contours', () => {
    const contours = parseSvgNativeContours(`
      <svg viewBox="0 0 200 100">
        <rect x="5" y="5" width="40" height="30" />
        <circle cx="80" cy="30" r="20" />
        <polygon points="110,10 150,45 115,80" />
        <path d="M 10 90 C 40 50, 70 130, 100 90 Q 125 60, 150 90 Z" />
      </svg>
    `);

    expect(contours.length).toBeGreaterThanOrEqual(4);
    expect(contours.every((contour) => contour.points.length >= 2)).toBe(true);
    expect(
      contours.every((contour) =>
        contour.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
      ),
    ).toBe(true);
  });

  it('builds a source-frame graph with packed contour data', () => {
    const graph = buildSvgNativeComputeGraph({
      sourceId: 'svg-layer-source',
      width: 1920,
      height: 1080,
      content: svgContent(`
        <svg viewBox="0 0 100 100">
          <path d="M 10 10 L 90 10 L 50 90 Z" />
        </svg>
      `),
      time: 2.5,
    });

    expect(graph.config.render_passes).toHaveLength(1);
    expect(graph.config.render_passes[0]?.target).toBe('source_frame');
    expect(graph.config.render_passes[0]?.shader_id).toBe(SVG_NATIVE_SHADER_ID);
    expect(graph.config.buffers[0]?.initial_f32).toHaveLength(SVG_UNIFORM_BYTES / 4);
    expect(graph.config.buffers[0]?.initial_f32?.[4]).toBe(1);
    expect(graph.config.buffers[0]?.initial_f32?.[5]).toBeGreaterThanOrEqual(3);
  });

  it('packs every SVG effect switch into the native effect mask', () => {
    const content: SVGContent = {
      ...svgContent('<svg><rect x="0" y="0" width="100" height="100" /></svg>'),
      liquidEnabled: true,
      particlesEnabled: true,
      energyEnabled: true,
      connectionsEnabled: true,
      glowEnabled: true,
      ripplesEnabled: true,
      lightningEnabled: true,
      edgeFlowEnabled: true,
      innerGlowEnabled: true,
      nebulaEnabled: true,
      heartbeatEnabled: true,
      plasmaEnabled: true,
      particleLinksEnabled: true,
      echoEnabled: true,
      arcBridgesEnabled: true,
      particleFillEnabled: true,
      organicWarpEnabled: true,
      growthEnabled: true,
      breatheEnabled: true,
    };
    const graph = buildSvgNativeComputeGraph({
      sourceId: 'svg-all-effects',
      width: 640,
      height: 360,
      content,
      time: 1,
    });

    expect(graph.config.buffers[0]?.initial_f32?.[36]).toBe((1 << 19) - 1);
  });

  it('keeps the WGSL template literals free of backticks', () => {
    /*
     * A backtick in a comment inside the /* wgsl *\/ template closes the
     * string early, and the error surfaces hundreds of lines away as a
     * confusing "Expected ;" in prose. Cost two debugging rounds; now it is a
     * test instead of a trap.
     */
    for (const source of [SVG_TRANSFORM_WGSL, SVG_NATIVE_WGSL]) {
      expect(source.includes('`')).toBe(false);
    }
  });

  it('registers the native SVG shaders for warm precompile', () => {
    // Two modules now: the geometry transform (compute) and the render pass.
    // One module cannot declare binding 1 as both storage and texture, so the
    // split is structural, not stylistic.
    const commands = buildSvgNativePrecompileCommands();
    expect(commands).toHaveLength(2);
    expect(commands.map((command) => command.shader_id).sort()).toEqual(
      ['svg/render-v6', 'svg/transform-v6'],
    );
    expect(commands[0]?.source).toContain('@compute');
    expect(commands[1]?.source).toContain('@fragment');
  });

  it('keeps open SVG paths open in the native contour stream', () => {
    const contours = parseSvgNativeContours('<svg><path d="M 10 10 L 90 10 L 50 90" /></svg>');
    expect(contours).toHaveLength(1);
    expect(contours[0]?.closed).toBe(false);
  });

  it('composes authored ancestor and element opacity exactly once', () => {
    const contours = parseSvgNativeContours(`
      <svg><g opacity="0.5"><rect x="0" y="0" width="10" height="10" opacity="0.5" fill="#ff0000" /></g></svg>
    `);
    expect(contours[0]?.fill?.[3]).toBeCloseTo(0.25);
  });

  it('keeps native extrusion and growth behavior in the shader contract', () => {
    expect(SVG_NATIVE_SHADER_ID).toBe('svg/render-v6');
    expect(SVG_NATIVE_WGSL).toContain('var back_inside=false');
    expect(SVG_NATIVE_WGSL).toContain('contour_info.z<0.5');
    expect(SVG_NATIVE_WGSL).toContain('bit_on(bits,17u)');
  });

  const itIfNativeCore = existsSync(nativeCoreBin) ? it : it.skip;

  itIfNativeCore('precompiles the SVG shader in the real native core', async () => {
    const rpc = createNativeRpc();
    try {
      const backend = process.platform === 'darwin'
        ? 'metal'
        : process.platform === 'win32'
          ? 'd3d12'
          : 'vulkan';
      const started = await rpc.send('start', {
        config: { backend, width: 160, height: 90, source_frame_size: 160, target_fps: 60 },
      }, 15000);
      expect(started?.backend_ready).toBe(true);

      const result = await rpc.send('submit_commands', {
        commands: buildSvgNativePrecompileCommands(),
      }, 15000);
      let precompileStatus: any = null;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        precompileStatus = await rpc.send('status', {}, 5000);
        const settled =
          Number(precompileStatus.shader_precompile_compiled ?? 0) +
          Number(precompileStatus.shader_precompile_failed ?? 0);
        if (settled >= buildSvgNativePrecompileCommands().length) break;
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      expect(
        Number(precompileStatus?.shader_precompile_failed ?? -1),
        String(precompileStatus?.last_shader_error ?? ''),
      ).toBe(0);
      expect(Number(precompileStatus?.shader_precompile_compiled ?? 0)).toBeGreaterThanOrEqual(1);
      const layerId = 'svg-native-runtime-layer';
      const sourceId = 'svg-native-runtime-source';
      const graph = buildSvgNativeComputeGraph({
        sourceId,
        width: 160,
        height: 90,
        frameIndex: 1,
        time: 0.5,
        includeSnapshot: true,
        content: svgContent(`
          <svg viewBox="0 0 160 90">
            <path d="M 8 8 L 148 18 L 112 80 L 24 66 Z" />
            <circle cx="46" cy="38" r="12" />
          </svg>
        `),
      });
      await rpc.send('submit_commands', {
        commands: [
          {
            type: 'upsert_layer',
            layer_id: layerId,
            z_index: 0,
            blend_mode: 'normal',
            opacity: 1,
            corners: {
              topLeft: { x: 0, y: 0 },
              topRight: { x: 1, y: 0 },
              bottomRight: { x: 1, y: 1 },
              bottomLeft: { x: 0, y: 1 },
            },
          },
          { type: 'set_layer_visibility', layer_id: layerId, visible: true },
          {
            type: 'bind_media_source',
            layer_id: layerId,
            source_id: sourceId,
            uri: 'native-svg://runtime-fixture',
            source_type: 'svg',
          },
          {
            type: 'set_native_graph_layer',
            layer_id: layerId,
            kind: 'svg',
            instrument_source_id: sourceId,
            composite_source_id: sourceId,
            input_source_id: null,
            effect_graph: null,
            params: {},
          },
          {
            type: 'queue_compute_graph',
            ...graph.config,
          },
        ],
      }, 15000);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const snapshot = await rpc.send('frame_snapshot', { include_pixels: true }, 10000);
      const status = await rpc.send('status', {}, 5000);
      expect(status.last_shader_error, JSON.stringify(result)).toBeNull();
      expect(status.shader_cache_entries).toBeGreaterThan(0);
      expect(Number(status.compute_graph_source_frame_renders ?? 0)).toBeGreaterThan(0);
      expect(Number(snapshot.nonzero_pixels ?? 0)).toBeGreaterThan(100);
      expect(snapshot.dark_frame).toBe(false);
    } finally {
      await rpc.close();
    }
  }, 30000);
});
