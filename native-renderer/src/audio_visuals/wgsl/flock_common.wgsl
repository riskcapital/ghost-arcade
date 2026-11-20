// Cloud Flock: live point state, next to the scan's rest positions.
struct FlockPoint {
  p: vec4<f32>, // position xyz (scan space), speed
  v: vec4<f32>, // velocity xyz, seed (0 = not yet placed)
}
