// Spectral Terrain (terrain.rs has the CPU side). The ring holds `rows`
// spectrum rows of `bins` heights; slot `head` is the newest.

struct TerrainU {
  view_proj: mat4x4<f32>,
  eye: vec4<f32>,    // camera xyz, fog
  res: vec4<f32>,    // width, height, aspect, rows due this frame
  grid: vec4<f32>,   // columns, rows, bins, mirrored
  clock: vec4<f32>,  // time, scroll fraction, head, rows filled
  shape: vec4<f32>,  // width, row spacing, amplitude, flags (1 wire, 2 contours)
  look: vec4<f32>,   // contour density, line glow, write start, line width
  audio: vec4<f32>,  // spectrum gain bass, mid, high; level
  extra: vec4<f32>,  // wire density, drive level, hit flash
  core: vec4<f32>,
  mid: vec4<f32>,
  fringe: vec4<f32>,
}
