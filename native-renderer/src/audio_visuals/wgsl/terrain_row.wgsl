// Writes this frame's due rows from the audio packet: the spectrum softened
// across bins, and eased against the row before it so ridges do not flicker.
@group(0) @binding(0) var<storage, read_write> rows: array<f32>;
@group(0) @binding(1) var<uniform> T: TerrainU;
@group(0) @binding(2) var<storage, read> av: array<f32>;

@compute @workgroup_size(64)
fn cs_row(@builtin(global_invocation_id) gid: vec3<u32>) {
  let bins = u32(T.grid.z);
  let n = u32(T.grid.y);
  let bin = gid.x % bins;
  let k = gid.x / bins;
  if (k >= u32(T.res.w)) {
    return;
  }
  let start = u32(T.look.z);
  let row = (start + k) % n;
  let before = (start + n - 1u) % n;
  let s = (f32(bin) + 0.5) / f32(bins);
  // Per-band gain across the spectrum (bass, mid, high thirds, blended).
  let gain = mix(mix(T.audio.x, T.audio.y, smoothstep(0.2, 0.4, s)), T.audio.z, smoothstep(0.55, 0.75, s));
  let v = clamp(av_spectrum_smooth(s) * gain, 0.0, 1.5);
  var prev = rows[before * bins + bin];
  if (T.clock.w < 1.5) {
    prev = v;
  }
  rows[row * bins + bin] = mix(prev, v, 0.6);
}
