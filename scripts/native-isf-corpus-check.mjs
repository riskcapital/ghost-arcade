import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

import { createRpcProcess } from './native-renderer-smoke.mjs';

const root = process.cwd();
const shaderRoots = ['public/ISF', 'CuratedISF']
  .map((dir) => join(root, dir))
  .filter((dir) => existsSync(dir));
const limit = Number(process.env.NATIVE_ISF_CORPUS_LIMIT || 0);
const minPct = Number(process.env.NATIVE_ISF_CORPUS_MIN_PCT || 100);
const minRenderPct = Number(process.env.NATIVE_ISF_CORPUS_MIN_RENDER_PCT || 98);
const renderShaders = process.env.NATIVE_ISF_CORPUS_PARSE_ONLY !== '1';
const FULLSCREEN_CORNERS = {
  topLeft: { x: 0, y: 0 },
  topRight: { x: 1, y: 0 },
  bottomRight: { x: 1, y: 1 },
  bottomLeft: { x: 0, y: 1 },
};

function walkFsFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walkFsFiles(path, out);
    } else if (/\.fs$/i.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

function hashSource(source) {
  return createHash('sha1').update(source).digest('hex').slice(0, 12);
}

function normalizeError(error) {
  return String(error || 'unknown native shader error')
    .replace(/corpus:[^:]+:[0-9a-f]+/g, 'corpus:<shader>')
    .replace(/\/Users\/[^ )]+/g, '<path>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 260);
}

async function main() {
  const files = [];
  const seen = new Set();
  for (const dir of shaderRoots) {
    for (const file of walkFsFiles(dir)) {
      const source = readFileSync(file, 'utf8');
      const digest = hashSource(source);
      if (seen.has(digest)) continue;
      seen.add(digest);
      files.push({ file, source, digest });
    }
  }
  files.sort((a, b) => relative(root, a.file).localeCompare(relative(root, b.file)));
  const selected = limit > 0 ? files.slice(0, limit) : files;
  if (selected.length === 0) {
    throw new Error(`No .fs shaders found under ${shaderRoots.map((dir) => relative(root, dir)).join(', ')}`);
  }

  const rpc = createRpcProcess();
  const failures = [];
  const renderFailures = [];
  let compiled = 0;
  let rendered = 0;
  try {
    await rpc.send('start', {
      config: {
        backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan',
        width: 320,
        height: 180,
        target_fps: 30,
      },
    }, 5000);
    await rpc.send('set_cache_caps', {
      config: {
        shader_metadata_cache_cap: Math.max(4096, selected.length + 128),
        pipeline_metadata_cache_cap: 4096,
      },
    }, 5000).catch(() => {});

    for (const [index, item] of selected.entries()) {
      const before = await rpc.send('status', {}, 5000);
      const shaderId = `corpus:${index}:${item.digest}`;
      await rpc.send('submit_commands', {
        commands: [
          {
            type: 'precompile_shader',
            shader_id: shaderId,
            stage: 'pixel',
            entry: 'main',
            source: item.source,
          },
        ],
      }, 8000);
      const after = await rpc.send('status', {}, 5000);
      if (Number(after.shader_precompile_compiled ?? 0) > Number(before.shader_precompile_compiled ?? 0)) {
        compiled += 1;
        if (renderShaders) {
          const layerId = `corpus-layer-${index}`;
          await rpc.send('submit_commands', {
            commands: [
              {
                type: 'upsert_layer',
                layer_id: layerId,
                z_index: 0,
                blend_mode: 'normal',
                opacity: 1,
                corners: FULLSCREEN_CORNERS,
              },
              { type: 'set_layer_visibility', layer_id: layerId, visible: true },
              { type: 'bind_isf_shader', layer_id: layerId, shader_id: shaderId },
              {
                type: 'update_isf_uniforms',
                shader_id: shaderId,
                time: 1.375,
                time_delta: 1 / 30,
                frame_index: 41,
                render_width: 320,
                render_height: 180,
                active: true,
                level: 0.32,
                bass: 0.4,
                mid: 0.28,
                high: 0.36,
                beat: 0.55,
                beat_phase: 0.2,
                bpm: 124,
                centroid: 0.48,
                kick: 0.42,
                snare: 0.24,
                float_inputs: {},
                point_inputs: {},
                color_inputs: {},
              },
              { type: 'render_isf_to_layer', layer_id: layerId },
            ],
          }, 12000);
          const renderedStatus = await rpc.send('status', {}, 5000);
          const renderError = String(renderedStatus.last_shader_error || '');
          if (renderError.includes(shaderId)) {
            renderFailures.push({
              file: relative(root, item.file),
              reason: normalizeError(renderError),
            });
          } else {
            const snapshot = await rpc.send('frame_snapshot', {
              include_pixels: false,
              time: 1.375,
              frame_index: 41,
            }, 12000);
            if (Number(snapshot.nonzero_pixels ?? 0) > 0 && snapshot.checksum) {
              rendered += 1;
            } else {
              let recovered = false;
              for (const [retryIndex, retryTime] of [3.75, 9.125].entries()) {
                await rpc.send('submit_commands', {
                  commands: [
                    {
                      type: 'update_isf_uniforms',
                      shader_id: shaderId,
                      time: retryTime,
                      time_delta: 1 / 30,
                      frame_index: 90 + retryIndex,
                      render_width: 320,
                      render_height: 180,
                      float_inputs: {},
                      point_inputs: {},
                      color_inputs: {},
                    },
                    { type: 'render_isf_to_layer', layer_id: layerId },
                  ],
                }, 12000);
                const retrySnapshot = await rpc.send('frame_snapshot', {
                  include_pixels: false,
                  time: retryTime,
                  frame_index: 90 + retryIndex,
                }, 12000);
                if (Number(retrySnapshot.nonzero_pixels ?? 0) > 0 && retrySnapshot.checksum) {
                  recovered = true;
                  break;
                }
              }
              if (recovered) {
                rendered += 1;
              } else {
                renderFailures.push({
                  file: relative(root, item.file),
                  reason: 'native pipeline rendered blank frames at all corpus fixture clocks',
                });
              }
            }
          }
          await rpc.send('submit_commands', {
            commands: [{ type: 'remove_layer', layer_id: layerId }],
          }, 5000);
        }
      } else {
        failures.push({
          file: relative(root, item.file),
          reason: normalizeError(after.last_shader_error),
        });
      }
    }

    const pct = (compiled / selected.length) * 100;
    const grouped = new Map();
    for (const failure of [...failures, ...renderFailures]) {
      const entry = grouped.get(failure.reason) ?? { count: 0, examples: [] };
      entry.count += 1;
      if (entry.examples.length < 4) entry.examples.push(failure.file);
      grouped.set(failure.reason, entry);
    }
    const topFailures = [...grouped.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 12);

    console.log([
      'Native ISF corpus:',
      `${compiled}/${selected.length}`,
      `${pct.toFixed(1)}%`,
      renderShaders ? `rendered=${rendered}/${selected.length} (${((rendered / selected.length) * 100).toFixed(1)}%)` : 'parse-only',
      `unique=${files.length}`,
      limit > 0 ? `limit=${limit}` : '',
    ].filter(Boolean).join(' '));
    for (const [reason, entry] of topFailures) {
      console.log(`- ${entry.count}x ${reason}`);
      console.log(`  e.g. ${entry.examples.join(' | ')}`);
    }
    if (minPct > 0 && pct < minPct) {
      throw new Error(`native ISF corpus coverage ${pct.toFixed(1)}% is below required ${minPct}%`);
    }
    const renderPct = (rendered / selected.length) * 100;
    if (renderShaders && minRenderPct > 0 && renderPct < minRenderPct) {
      throw new Error(`native ISF render coverage ${renderPct.toFixed(1)}% is below required ${minRenderPct}%`);
    }
  } finally {
    const stderr = await rpc.close();
    if (stderr) console.error(stderr.split('\n').slice(-12).join('\n'));
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
