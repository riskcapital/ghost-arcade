import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SCENE3D_FRAME_BUFFER_SUFFIX,
  SCENE3D_FRAME_BYTES,
  SCENE3D_FRAME_FIELDS,
  SCENE3D_FRAME_SLOT,
  SCENE3D_FRAME_WGSL,
  scene3dFrameBuffer,
} from './scene3dFrame';

const rust = readFileSync(path.resolve(__dirname, '../../../native-renderer/src/scene_frame.rs'), 'utf8');

describe('scene frame block', () => {
  it('matches the layout the render core writes', () => {
    const fields = rust.match(/pub\(crate\) const FIELDS: \[&str; (\d+)\] = \[([\s\S]*?)\];/);
    expect(fields).not.toBeNull();
    const names = [...fields![2].matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
    expect(names).toEqual([...SCENE3D_FRAME_FIELDS]);
    expect(Number(fields![1])).toBe(SCENE3D_FRAME_FIELDS.length);
    expect(rust).toContain(`pub(crate) const BUFFER_SUFFIX: &str = "${SCENE3D_FRAME_BUFFER_SUFFIX}";`);
  });

  it('documents every slot in the core module table', () => {
    for (const field of SCENE3D_FRAME_FIELDS) {
      const row = new RegExp(`//! \\| ${SCENE3D_FRAME_SLOT[field]}\\s+\\| ${field}\\s+\\|`);
      expect(rust, field).toMatch(row);
    }
  });

  it('declares a zeroed buffer of the block size and a WGSL struct in slot order', () => {
    const buffer = scene3dFrameBuffer('scene3d:layer-1');
    expect(buffer.id).toBe('scene3d:layer-1:scene3d:frame');
    expect(buffer.byte_length).toBe(SCENE3D_FRAME_BYTES);
    expect(atob(buffer.initial_b64)).toHaveLength(SCENE3D_FRAME_BYTES);
    const order = [...SCENE3D_FRAME_WGSL.matchAll(/ {2}([a-z_]+): f32,/g)].map((match) => match[1]);
    expect(order).toEqual([...SCENE3D_FRAME_FIELDS]);
  });
});
