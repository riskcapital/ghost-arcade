// Ghost WGSL stdlib: sort helpers for particles and Gaussian splats.
//
// This module intentionally stays storage-buffer agnostic. Instruments
// decide their packed record layout; the shared functions below provide
// stable depth-key generation and bitonic compare/swap logic that works
// in browser WebGPU and the native render core.

const GHOST_SORT_KEY_MAX: u32 = 0xffffffffu;

struct GhostSortPair {
  key: u32,
  value: u32,
}

fn ghost_sort_key_from_depth_near_to_far(depth01: f32) -> u32 {
  let d = clamp(depth01, 0.0, 1.0);
  return u32(round(d * f32(GHOST_SORT_KEY_MAX)));
}

fn ghost_sort_key_from_depth_far_to_near(depth01: f32) -> u32 {
  return GHOST_SORT_KEY_MAX - ghost_sort_key_from_depth_near_to_far(depth01);
}

fn ghost_sort_bitonic_partner(index: u32, stride: u32) -> u32 {
  return index ^ stride;
}

fn ghost_sort_bitonic_ascending(index: u32, sequence_size: u32) -> bool {
  return (index & sequence_size) == 0u;
}

fn ghost_sort_should_swap_keys(a: u32, b: u32, ascending: bool) -> bool {
  if (ascending) {
    return a > b;
  }
  return a < b;
}

fn ghost_sort_pair_before(a: GhostSortPair, b: GhostSortPair, ascending: bool) -> GhostSortPair {
  let swap = ghost_sort_should_swap_keys(a.key, b.key, ascending);
  var out: GhostSortPair;
  out.key = select(a.key, b.key, swap);
  out.value = select(a.value, b.value, swap);
  return out;
}

fn ghost_sort_pair_after(a: GhostSortPair, b: GhostSortPair, ascending: bool) -> GhostSortPair {
  let swap = ghost_sort_should_swap_keys(a.key, b.key, ascending);
  var out: GhostSortPair;
  out.key = select(b.key, a.key, swap);
  out.value = select(b.value, a.value, swap);
  return out;
}

fn ghost_sort_pack_pair(key: u32, value: u32) -> GhostSortPair {
  var out: GhostSortPair;
  out.key = key;
  out.value = value;
  return out;
}
