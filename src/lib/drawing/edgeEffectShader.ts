// Edge Effects fragment shader for the WebGL compositor.
//
// The same evaluator the 2.0 render core runs (heartbeat.wgsl, Edge Effects
// section), in GLSL ES 3.00: stroke, fill and animation stacks drawn
// analytically per output pixel on the layer's outline, which arrives
// already warped and flattened (edgeEffectGeometry.ts). It covers every
// edge type, the beat reaction and the group chase, so a stack built in
// either line looks the same in both.
//
// Inputs, packed by nativeEdgeEffectPayload (edgeEffects.ts):
//   uEdgeData   RGBA32F, one row: the 16 x 22 effect vec4s, then the
//               segment chunk bounds, corners, diagonals and centerline
//   uEdgeInfo   (points, effects, corners, diagonals)
//   uEdgeGeom   (centroid x px, centroid y px, perimeter px, inradius px)
//   uEdgeExtra  (seed, _, _, _)
//   uEdgeBox    centerline bbox px
//   uClock      (beat position, bpm, _, _) from the launch clock
//   uAudio0..2  level, bass, mid, treble / high, beat, phase, bpm /
//               centroid, kick, snare, active

export const EDGE_DATA_WIDTH = 1024;
export const EDGE_FX_OFFSET = 0;
export const EDGE_CHUNK_OFFSET = 352;
export const EDGE_CORNER_OFFSET = 384;
export const EDGE_DIAG_OFFSET = 448;
export const EDGE_POINT_OFFSET = 480;

export const EDGE_EFFECT_VERTEX = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const EDGE_EFFECT_FRAGMENT = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uSource;
uniform sampler2D uEdgeData;
uniform vec2 uResolution;
uniform float uTime;
uniform vec4 uClock;
uniform vec4 uAudio0;
uniform vec4 uAudio1;
uniform vec4 uAudio2;
uniform vec4 uEdgeInfo;
uniform vec4 uEdgeGeom;
uniform vec4 uEdgeExtra;
uniform vec4 uEdgeBox;

in vec2 vUv;
out vec4 fragColor;

vec4 edgeFx(int e, int k) { return texelFetch(uEdgeData, ivec2(${EDGE_FX_OFFSET} + e * 22 + k, 0), 0); }
vec4 edgeChunk(int i) { return texelFetch(uEdgeData, ivec2(${EDGE_CHUNK_OFFSET} + i, 0), 0); }
vec4 edgeCorner(int i) { return texelFetch(uEdgeData, ivec2(${EDGE_CORNER_OFFSET} + i, 0), 0); }
vec4 edgeDiag(int i) { return texelFetch(uEdgeData, ivec2(${EDGE_DIAG_OFFSET} + i, 0), 0); }
vec4 edgePt(int i) { return texelFetch(uEdgeData, ivec2(${EDGE_POINT_OFFSET} + i, 0), 0); }

struct GhostAudio { vec4 a0; vec4 a1; vec4 a2; };
GhostAudio ghost_audio_scene() { return GhostAudio(uAudio0, uAudio1, uAudio2); }
float ghost_audio_active(GhostAudio a) { return clamp(a.a2.w, 0.0, 1.0); }
float ghost_audio_level(GhostAudio a) { return a.a0.x * ghost_audio_active(a); }
float ghost_audio_bass(GhostAudio a) { return a.a0.y * ghost_audio_active(a); }
float ghost_audio_treble(GhostAudio a) { return a.a0.w * ghost_audio_active(a); }
float ghost_audio_beat(GhostAudio a) { return a.a1.y * ghost_audio_active(a); }
float ghost_audio_kick(GhostAudio a) { return a.a2.y * ghost_audio_active(a); }
float ghost_audio_snare(GhostAudio a) { return a.a2.z * ghost_audio_active(a); }

vec3 rgb_to_hsv(vec3 c) {
  vec4 k = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = ((c.g >= c.b) ? (vec4(c.gb, k.xy)) : (vec4(c.bg, k.wz)));
  vec4 q = ((c.r >= p.x) ? (vec4(c.r, p.yzx)) : (vec4(p.xyw, c.r)));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv_to_rgb(vec3 c) {
  vec4 k = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + k.xyz) * 6.0 - k.www);
  return c.z * mix(k.xxx, clamp(p - k.xxx, vec3(0.0), vec3(1.0)), c.y);
}

vec3 native_blend(vec3 dst_in, vec3 src_in, float alpha, float mode) {
  vec3 dst = clamp(dst_in, vec3(0.0), vec3(1.5));
  vec3 src = clamp(src_in, vec3(0.0), vec3(1.5));
  int m = int(floor(mode + 0.5));
  vec3 blended = src;
  if (m == 1) {
    blended = clamp(dst + src, vec3(0.0), vec3(1.0));
  } else if (m == 2) {
    blended = dst * src;
  } else if (m == 3) {
    blended = vec3(1.0) - (vec3(1.0) - dst) * (vec3(1.0) - src);
  } else if (m == 4) {
    blended = mix(2.0 * dst * src, vec3(1.0) - 2.0 * (vec3(1.0) - dst) * (vec3(1.0) - src), vec3(greaterThan(dst, vec3(0.5))));
  } else if (m == 5) {
    blended = max(dst - src, vec3(0.0));
  } else if (m == 6) {
    blended = abs(dst - src);
  } else if (m == 7) {
    blended = max(dst, src);
  } else if (m == 8) {
    blended = min(dst, src);
  } else if (m == 9) {
    blended = (dst + src) * 0.5;
  } else if (m == 10) {
    blended = mix(2.0 * dst * src, vec3(1.0) - 2.0 * (vec3(1.0) - dst) * (vec3(1.0) - src), vec3(greaterThan(src, vec3(0.5))));
  } else if (m == 11) {
    blended = (vec3(1.0) - 2.0 * src) * dst * dst + 2.0 * src * dst;
  } else if (m == 12) {
    blended = dst + src - 2.0 * dst * src;
  } else if (m == 13) {
    blended = clamp(dst / max(vec3(1.0) - src, vec3(0.001)), vec3(0.0), vec3(1.0));
  } else if (m == 14) {
    blended = clamp(vec3(1.0) - ((vec3(1.0) - dst) / max(src, vec3(0.001))), vec3(0.0), vec3(1.0));
  } else if (m == 15) {
    vec3 dh = rgb_to_hsv(clamp(dst, vec3(0.0), vec3(1.0)));
    vec3 sh = rgb_to_hsv(clamp(src, vec3(0.0), vec3(1.0)));
    blended = hsv_to_rgb(vec3(sh.x, dh.y, dh.z));
  } else if (m == 16) {
    vec3 dh = rgb_to_hsv(clamp(dst, vec3(0.0), vec3(1.0)));
    vec3 sh = rgb_to_hsv(clamp(src, vec3(0.0), vec3(1.0)));
    blended = hsv_to_rgb(vec3(dh.x, sh.y, dh.z));
  } else if (m == 17) {
    vec3 dh = rgb_to_hsv(clamp(dst, vec3(0.0), vec3(1.0)));
    vec3 sh = rgb_to_hsv(clamp(src, vec3(0.0), vec3(1.0)));
    blended = hsv_to_rgb(vec3(sh.x, sh.y, dh.z));
  } else if (m == 18) {
    vec3 dh = rgb_to_hsv(clamp(dst, vec3(0.0), vec3(1.0)));
    vec3 sh = rgb_to_hsv(clamp(src, vec3(0.0), vec3(1.0)));
    blended = hsv_to_rgb(vec3(dh.x, dh.y, sh.z));
  } else if (m == 19) {
    blended = clamp(dst / max(src, vec3(0.001)), vec3(0.0), vec3(1.0));
  } else if (m == 20) {
    blended = clamp(vec3(1.0) - abs(vec3(1.0) - dst - src), vec3(0.0), vec3(1.0));
  } else if (m == 21) {
    blended = clamp(min(dst, src) - max(dst, src) + vec3(1.0), vec3(0.0), vec3(1.0));
  } else if (m == 22) {
    blended = clamp(dst + 2.0 * src - vec3(1.0), vec3(0.0), vec3(1.0));
  } else if (m == 23) {
    vec3 linear_light = clamp(dst + 2.0 * src - vec3(1.0), vec3(0.0), vec3(1.0));
    blended = step(vec3(0.5), linear_light);
  } else if (m == 24) {
    vec3 burn = vec3(1.0) - ((vec3(1.0) - dst) / max(2.0 * src, vec3(0.001)));
    vec3 dodge = dst / max(2.0 * (vec3(1.0) - src), vec3(0.001));
    blended = clamp(mix(burn, dodge, vec3(greaterThanEqual(src, vec3(0.5)))), vec3(0.0), vec3(1.0));
  } else if (m == 25) {
    vec3 low = min(dst, 2.0 * src);
    vec3 high = max(dst, 2.0 * src - vec3(1.0));
    blended = clamp(mix(low, high, vec3(greaterThanEqual(src, vec3(0.5)))), vec3(0.0), vec3(1.0));
  }
  return mix(dst_in, blended, clamp(alpha, 0.0, 1.0));
}


const float EDGE_PI = 3.14159265359;
const float EDGE_TAU = 6.28318530718;

float edge_mod(float x, float y) {
  return x - y * floor(x / y);
}

// GLSL smoothstep, spelled out: the snake stroke relies on reversed edges.
float edge_smoothstep(float e0, float e1, float x) {
  float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// The drawing shader's hash, kept for the classic types' flicker timing.
float edge_random(vec2 st) {
  return fract(sin(dot(st, vec2(12.9898, 78.233))) * 43758.5453123);
}

// Integer hash for the new types: identical on every GPU.
uint edge_hash_u(uint v) {
  uint x = v * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  return (x >> 22u) ^ x;
}

float edge_hash2(float a, float b) {
  uint h = edge_hash_u(uint(int(floor(a))) ^ edge_hash_u(uint(int(floor(b))) + 0x9e3779b9u));
  return float(h & 0x00ffffffu) / 16777215.0;
}

float edge_value_noise(float x, float seed) {
  float i = floor(x);
  float f = x - i;
  float u = f * f * (3.0 - 2.0 * f);
  return mix(edge_hash2(i, seed), edge_hash2(i + 1.0, seed), u) * 2.0 - 1.0;
}

// GLSL rotate2d(a) * v with rotate2d = mat2(c, -s, s, c).
vec2 edge_rotate(vec2 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * v.x + s * v.y, -s * v.x + c * v.y);
}

vec3 edge_hsv(float h, float s, float v) {
  vec3 k = vec3(1.0, 2.0 / 3.0, 1.0 / 3.0);
  vec3 p = abs(fract(vec3(h) + k) * 6.0 - vec3(3.0));
  return v * mix(vec3(1.0), clamp(p - vec3(1.0), vec3(0.0), vec3(1.0)), s);
}

// Analytic coverage of a signed distance (negative inside), 'aa' screen px wide.
float edge_cov(float sd, float aa) {
  return clamp(0.5 - sd / aa, 0.0, 1.0);
}

vec4 edge_pt(uint li, int i) {
  return edgePt(i);
}

struct EdgeHit {
  float d; // signed distance to the centerline polygon, px, negative inside
  float s; // arc length of the closest centerline point, px
  int seg; // closest segment
  float h; // position along it (0-1)
  float scale; // surface scale there
};

// Closest point and winding against the centerline, visiting only the
// 16-segment chunks that can matter (closer than the best so far, or
// crossed by the pixel's winding ray).
EdgeHit edge_hit(uint li, vec2 p, int count) {
  float best = 1.0e20;
  int winding = 0;
  int seg = 0;
  float hh = 0.0;
  int chunk_count = (count + 15) / 16;
  for (int c = 0; c < 32; c = c + 1) {
    if (c >= chunk_count) { break; }
    vec4 bb = edgeChunk(c);
    vec2 q = max(max(bb.xy - p, p - bb.zw), vec2(0.0));
    float box_d2 = dot(q, q);
    bool ray_hits = p.y >= bb.y && p.y < bb.w && p.x <= bb.z;
    if (box_d2 >= best && !ray_hits) { continue; }
    int start = c * 16;
    int end = min(start + 16, count);
    for (int i = start; i < end; i = i + 1) {
      vec2 a = edge_pt(li, i).xy;
      vec2 b = edge_pt(li, ((i + 1 >= count) ? (0) : (i + 1))).xy;
      vec2 pa = p - a;
      vec2 ba = b - a;
      float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-12), 0.0, 1.0);
      vec2 e = pa - ba * h;
      float d2 = dot(e, e);
      if (d2 < best) {
        best = d2;
        seg = i;
        hh = h;
      }
      float cross_z = ba.x * pa.y - pa.x * ba.y;
      if (a.y <= p.y) {
        if (b.y > p.y && cross_z > 0.0) { winding = winding + 1; }
      } else if (b.y <= p.y && cross_z < 0.0) {
        winding = winding - 1;
      }
    }
  }
  vec4 a = edge_pt(li, seg);
  vec4 b = edge_pt(li, ((seg + 1 >= count) ? (0) : (seg + 1)));
  float seg_len = length(b.xy - a.xy);
  EdgeHit out_;
  out_.d = ((winding != 0) ? (-1.0) : (1.0)) * sqrt(best);
  out_.s = a.z + seg_len * hh;
  out_.seg = seg;
  out_.h = hh;
  out_.scale = mix(a.w, b.w, hh);
  return out_;
}

// Output position of arc length 's' along the centerline.
vec2 edge_point_at(uint li, float s_in, int count, float total) {
  float s = edge_mod(s_in, total);
  int lo = 0;
  int hi = count - 1;
  for (int k = 0; k < 10; k = k + 1) {
    if (lo >= hi) { break; }
    int mid = (lo + hi + 1) / 2;
    if (edge_pt(li, mid).z <= s) { lo = mid; } else { hi = mid - 1; }
  }
  vec4 a = edge_pt(li, lo);
  vec4 b = edge_pt(li, ((lo + 1 >= count) ? (0) : (lo + 1)));
  float seg_end = ((lo + 1 >= count) ? (total) : (b.z));
  float t = clamp((s - a.z) / max(seg_end - a.z, 1e-6), 0.0, 1.0);
  return mix(a.xy, b.xy, t);
}

// Signed distance to a stroke of half-width 'hw' on the centerline, with
// the chosen join where the closest feature is a vertex (0 miter, 1 round,
// 2 bevel). Round joins are the plain distance field.
float edge_band_sd(uint li, vec2 p, EdgeHit hit, float hw, int join, float miter_limit, int count) {
  float sd = abs(hit.d) - hw;
  if (join == 1 || (hit.h > 0.0 && hit.h < 1.0)) { return sd; }
  int vi = ((hit.h >= 1.0) ? (((hit.seg + 1 >= count) ? (0) : (hit.seg + 1))) : (hit.seg));
  vec2 v = edge_pt(li, vi).xy;
  vec2 prev = edge_pt(li, ((vi == 0) ? (count - 1) : (vi - 1))).xy;
  vec2 next = edge_pt(li, ((vi + 1 >= count) ? (0) : (vi + 1))).xy;
  vec2 tin = normalize(v - prev);
  vec2 tout = normalize(next - v);
  vec2 rel = p - v;
  vec2 nin = vec2(-tin.y, tin.x);
  if (dot(nin, rel) < 0.0) { nin = -nin; }
  vec2 nout = vec2(-tout.y, tout.x);
  if (dot(nout, rel) < 0.0) { nout = -nout; }
  // A straight-through vertex (a mesh or flattening split) has no join:
  // both offset points coincide, the miter edges below would normalize a
  // zero vector, and the NaN they give survives max() in the dash and trim
  // cuts as a line through the vertex. The band there is the plain one.
  if (dot(nin, nout) > 0.99999) { return sd; }
  vec2 a = v + nin * hw;
  vec2 b = v + nout * hw;
  float denom = max(1.0 + dot(nin, nout), 1e-4);
  float ratio = sqrt(2.0 / denom);
  if (join == 0 && ratio <= miter_limit) {
    vec2 m = v + (nin + nout) / denom * hw;
    vec2 e0 = normalize(m - a);
    vec2 e1 = normalize(b - m);
    vec2 n0 = vec2(e0.y, -e0.x) * sign(dot(vec2(e0.y, -e0.x), a - v));
    vec2 n1 = vec2(e1.y, -e1.x) * sign(dot(vec2(e1.y, -e1.x), b - v));
    sd = max(dot(p - a, n0), dot(p - b, n1));
  } else {
    vec2 e = normalize(b - a);
    vec2 n = vec2(e.y, -e.x);
    if (dot(n, a - v) < 0.0) { n = -n; }
    sd = dot(p - a, n);
  }
  return sd;
}

// Signed distance, along the path, outside the circular interval
// [s0, s0 + len) of a closed path of length 'total' (negative inside).
float edge_interval_out(float s, float s0, float len, float total) {
  if (len >= total) { return -1.0e6; }
  if (len <= 0.0) { return 1.0e6; }
  float u = edge_mod(s - s0, total);
  if (u < len) { return -min(u, len - u); }
  return min(u - len, total - u);
}

// Same for a periodic on-interval [0, on) repeating every 'cycle'.
float edge_periodic_out(float u_in, float on, float cycle) {
  float u = edge_mod(u_in, cycle);
  if (u < on) { return -min(u, on - u); }
  return min(u - on, cycle - u);
}

// A band cut to an open run of the path: 'along' is the distance outside
// the run along the path. Caps: 0 butt, 1 round, 2 square.
float edge_open_sd(float band_sd, float along, float hw, int cap) {
  if (cap == 1) {
    if (along > 0.0) { return length(vec2(along, max(band_sd + hw, 0.0))) - hw; }
    return max(band_sd, along);
  }
  if (cap == 2) { return max(band_sd, along - hw); }
  return max(band_sd, along);
}

// Coverage of a stroke whose signed distance was built for half-width
// max(width, aa) / 2: lines thinner than a pixel keep a one pixel footprint
// and fade by their width instead of breaking up.
float edge_line_cov(float sd, float width, float aa) {
  return edge_cov(sd, aa) * clamp(width / aa, 0.0, 1.0);
}

// 1 - smoothstep(0, radius, dist) as the classic types use it, filtered
// when the radius is below a pixel so it fades instead of aliasing.
float edge_falloff(float dist, float radius, float aa) {
  float r = max(radius, aa);
  return (1.0 - edge_smoothstep(0.0, r, dist)) * clamp(radius / aa, 0.0, 1.0);
}

// Animated 0-1 progress for wipes and growth fills: 0 loop, 1 ping-pong,
// 2 beat phase, 3 manual (the progress value itself).
float edge_progress(float t, float speed, int mode, float manual) {
  if (mode == 1) { return 1.0 - abs(fract(t * speed * 0.5) * 2.0 - 1.0); }
  if (mode == 2) { return fract(uClock.x); }
  if (mode == 3) { return clamp(manual, 0.0, 1.0); }
  return fract(t * speed);
}

// Coverage of the "on" half-period of a periodic coordinate (crisp stripes).
float edge_stripe(float x, float period, float duty, float aa) {
  return edge_cov(edge_periodic_out(x, period * duty, period), aa);
}

struct EdgeCtx {
  int count;
  float total;
  vec2 centroid_;
  float inradius;
  int corner_count;
  int diag_count;
  float aa;
  vec2 res;
  float seed;
  vec4 bbox;
};

// ---------- classic strokes (px) ----------

vec4 edge_solid_stroke(float sd, vec4 color, float width, float aa) {
  return vec4(color.rgb, color.a * edge_line_cov(sd, width, aa));
}

vec4 edge_glow_stroke(float d, float core, vec4 color, float glow_size, float intensity, float pulse, float t, float aa) {
  float pulse_mod = ((pulse > 0.0) ? (0.7 + 0.3 * sin(t * pulse * 3.0)) : (1.0));
  float glow = edge_falloff(abs(d), glow_size, aa);
  glow = pow(glow, 2.0) * intensity * pulse_mod;
  return vec4(color.rgb * (core + glow), max(core, glow * 0.8) * color.a);
}

vec4 edge_neon_stroke(float d, float core, vec4 color, float width, float glow_size, float flicker, float t, float aa) {
  float flicker_mod = 1.0;
  if (flicker > 0.0) {
    flicker_mod = 0.85 + 0.15 * sin(t * flicker * 15.0);
    flicker_mod = flicker_mod * (0.9 + 0.1 * edge_random(vec2(floor(t * 8.0), 0.0)));
  }
  float inner = 1.0 - edge_smoothstep(0.0, 3.0, abs(d) - width * 0.5);
  float outer = edge_falloff(abs(d), glow_size, aa);
  outer = pow(outer, 1.5);
  vec3 final_color = vec3(1.0) * core * 0.8 + color.rgb * inner + color.rgb * outer * 0.5;
  final_color = final_color * flicker_mod;
  return vec4(final_color, max(core, max(inner * 0.9, outer * 0.6)) * color.a);
}

vec4 edge_snake_stroke(float d, float core, vec4 color, float width, float snake_len, float speed, float path_pos, int snake_count, float t, float rx, float aa) {
  float total_in_snake = 0.0;
  float total_fade = 0.0;
  float total_head_glow = 0.0;
  for (int s = 0; s < 8; s = s + 1) {
    if (s >= snake_count) { break; }
    float snake_offset = float(s) / float(snake_count);
    float head_pos = edge_mod(t * speed + snake_offset, 1.0);
    float dist_behind = edge_mod(head_pos - path_pos + 1.0, 1.0);
    float in_snake = edge_smoothstep(snake_len + 0.02, snake_len - 0.02, dist_behind);
    float fade = 1.0 - clamp(dist_behind / max(snake_len, 0.001), 0.0, 1.0);
    total_in_snake = max(total_in_snake, in_snake);
    total_fade = max(total_fade, fade * in_snake);
    float head_dist = abs(path_pos - head_pos);
    float head_dist_wrapped = min(head_dist, 1.0 - head_dist);
    total_head_glow = max(total_head_glow, exp(-head_dist_wrapped * 30.0));
  }
  float glow = edge_falloff(abs(d), width * 2.0 / rx, aa) * total_head_glow;
  float body = core * total_in_snake * max(total_fade, 0.1);
  return vec4(color.rgb * (body + glow), (body + glow * 0.5) * color.a);
}

vec4 edge_rainbow_stroke(float d, float core, float width, float speed, float path_pos, float t, float rx, float aa) {
  float hue = edge_mod(path_pos * 2.0 + t * speed, 1.0);
  vec3 rainbow = 0.5 + 0.5 * cos(EDGE_TAU * (hue + vec3(0.0, 0.33, 0.67)));
  float glow = edge_falloff(abs(d), width * 1.5 / rx, aa);
  glow = pow(glow, 2.0) * 0.5;
  return vec4(rainbow * (core + glow), max(core, glow * 0.7));
}

vec4 edge_dashed_stroke(float core, vec4 color, float dash_len, float gap_len, float path_pos, float speed, float t) {
  float cycle = dash_len + gap_len;
  float pos = edge_mod(path_pos + t * speed * 0.1, 1.0);
  float dash_phase = edge_mod(pos * 10.0, cycle);
  float dash = edge_smoothstep(0.0, 0.02, dash_phase) * (1.0 - edge_smoothstep(dash_len - 0.02, dash_len, dash_phase));
  return vec4(color.rgb * core * dash, color.a * core * dash);
}

// The electric stroke's jittering white core, as analytic coverage.
float edge_electric_core(float d, float width, float arc_intensity, float speed, float path_pos, float time, float rx, float aa) {
  float t = time * speed;
  // Arc offsets were UV distances in the editor; px here.
  float jitter = sin(path_pos * 50.0 + t * 20.0) * arc_intensity * 0.003 * rx;
  jitter = jitter + sin(path_pos * 120.0 + t * 35.0) * arc_intensity * 0.002 * rx;
  return edge_line_cov(abs(d + jitter) - max(width * 0.6, aa) * 0.5, width * 0.6, aa);
}

vec4 edge_electric_stroke(float d, float core, vec4 color, float width, float arc_intensity, float speed, float path_pos, float time, float rx, float aa) {
  float t = time * speed;
  float arc1_offset = sin(path_pos * 30.0 + t * 15.0) * arc_intensity * 0.008 * rx;
  float arc1 = 1.0 - edge_smoothstep(0.0, 3.0, abs(d + arc1_offset) - width * 0.15);
  float arc2_offset = cos(path_pos * 45.0 + t * 22.0) * arc_intensity * 0.006 * rx;
  float arc2 = 1.0 - edge_smoothstep(0.0, 3.0, abs(d + arc2_offset) - width * 0.1);
  vec3 core_color = vec3(1.0) * core;
  vec3 arc_color = color.rgb * (arc1 * 0.6 + arc2 * 0.4);
  float glow = edge_falloff(abs(d), width * 3.0 / rx, aa);
  glow = pow(glow, 2.5) * 0.4;
  float flicker = 0.85 + 0.15 * edge_random(vec2(floor(t * 12.0), path_pos * 5.0));
  float alpha = max(core, max(arc1 * 0.6, max(arc2 * 0.4, glow * 0.5)));
  return vec4((core_color + arc_color + color.rgb * glow) * flicker, alpha * color.a);
}

vec4 edge_strobe_stroke(float d, float core, vec4 color, float width, float rate, float t, float rx, float aa) {
  float on = step(0.0, sin(t * rate * EDGE_TAU));
  float glow = edge_falloff(abs(d), width * 2.0 / rx, aa);
  glow = pow(glow, 1.5) * 0.8;
  return vec4(color.rgb * (core + glow) * on, max(core, glow * 0.7) * on * color.a);
}

vec4 edge_scanner_stroke(float d, float core, vec4 color, float width, float beam_width, float speed, float path_pos, float trail, float t, float rx, float aa) {
  float scan_pos = edge_mod(t * speed * 0.2, 1.0);
  float dist = abs(path_pos - scan_pos);
  dist = min(dist, 1.0 - dist);
  float beam = 1.0 - edge_smoothstep(0.0, beam_width, dist);
  beam = pow(beam, 2.0);
  float trail_dist = edge_mod(scan_pos - path_pos + 1.0, 1.0);
  float trail_fade = (1.0 - edge_smoothstep(0.0, trail, trail_dist)) * 0.4;
  float intensity = max(beam, trail_fade);
  float glow = edge_falloff(abs(d), width * 2.0 / rx, aa);
  glow = pow(glow, 2.0) * beam * 0.6;
  return vec4(color.rgb * (core * intensity + glow), (core * intensity + glow * 0.5) * color.a);
}

vec4 edge_fire_stroke(float d, float core, vec4 color, float width, float speed, float path_pos, float time, float rx, float aa) {
  float t = time * speed;
  float noise = sin(path_pos * 20.0 + t * 5.0) * 0.5 + 0.5;
  noise = noise * (sin(path_pos * 35.0 - t * 3.0) * 0.5 + 0.5);
  noise = noise + sin(path_pos * 8.0 + t * 7.0) * 0.3;
  vec3 fire_color = mix(vec3(1.0, 0.2, 0.0), vec3(1.0, 0.9, 0.2), noise);
  fire_color = mix(fire_color, vec3(1.0), core * 0.5);
  float w_uv = width / rx;
  float flame_dist = abs(d) - width * (0.5 + noise * 0.8);
  float flame = edge_falloff(max(flame_dist, 0.0), w_uv * 2.0, aa);
  flame = flame * noise;
  vec3 final_color = fire_color * core + vec3(1.0, 0.3, 0.0) * flame * 0.6;
  return vec4(final_color, max(core, flame * 0.5) * color.a);
}

// ---------- classic fills (uv = output UV, as the editor shader) ----------

vec4 edge_plasma_fill(float inside, vec2 p, float speed, float scale, float complexity, int palette, float time) {
  if (inside < 0.01) { return vec4(0.0); }
  float t = time * speed;
  float s = scale;
  float plasma = 0.0;
  plasma = plasma + sin(p.x * s + t);
  plasma = plasma + sin(p.y * s + t * 1.2);
  plasma = plasma + sin((p.x + p.y) * s * 0.75 + t * 0.7);
  plasma = plasma + sin(length(p - vec2(0.5)) * s * 1.5 + t * 0.9);
  if (complexity > 2.0) {
    plasma = plasma + sin(p.x * s * 2.0 - p.y * s * 1.5 + t * 1.5) * 0.5;
    plasma = plasma + sin(length(p - vec2(0.3, 0.7)) * s * 2.0 + t * 1.1) * 0.4;
  }
  if (complexity > 4.0) {
    plasma = plasma + sin((p.x * p.y) * s * 3.0 + t * 2.0) * 0.3;
    plasma = plasma + cos(p.x * s * 3.0 + sin(p.y * s * 2.0 + t)) * 0.25;
  }
  float total_weight = 4.0 + ((complexity > 2.0) ? (0.9) : (0.0)) + ((complexity > 4.0) ? (0.55) : (0.0));
  plasma = plasma / total_weight + 0.5;
  vec3 color;
  if (palette == 1) {
    color = mix(vec3(0.1, 0.0, 0.0), vec3(1.0, 0.9, 0.2), plasma);
    color = mix(color, vec3(1.0, 0.3, 0.0), sin(plasma * EDGE_PI) * 0.5 + 0.5);
  } else if (palette == 2) {
    color = mix(vec3(0.0, 0.05, 0.2), vec3(0.0, 0.8, 1.0), plasma);
    color = mix(color, vec3(0.2, 0.4, 0.8), sin(plasma * EDGE_PI * 2.0) * 0.3 + 0.5);
  } else if (palette == 3) {
    color = 0.5 + 0.5 * cos(EDGE_TAU * (plasma * 2.0 + vec3(0.0, 0.15, 0.4)));
    color = pow(color, vec3(0.8));
  } else {
    color = 0.5 + 0.5 * cos(EDGE_TAU * (plasma + vec3(0.0, 0.33, 0.67)));
  }
  return vec4(color, inside);
}

vec4 edge_liquid_fill(float inside, vec2 p, vec4 base_color, float speed, float viscosity, float turbulence, float metallic, float time) {
  if (inside < 0.01) { return vec4(0.0); }
  float t = time * speed;
  float dist_amt = 0.05 * (1.0 - viscosity * 0.8);
  float distort1 = sin(p.x * 15.0 + t) * cos(p.y * 12.0 + t * 0.8) * dist_amt;
  float distort2 = cos(p.x * 10.0 - t * 0.6) * sin(p.y * 18.0 + t * 1.2) * dist_amt * turbulence;
  vec2 dp = p + vec2(distort1, distort2);
  float noise = sin(dp.x * 25.0 + t) * sin(dp.y * 25.0 - t) * 0.5 + 0.5;
  if (turbulence > 0.3) {
    noise = noise + sin(dp.x * 50.0 - t * 1.5) * sin(dp.y * 40.0 + t * 1.3) * 0.2 * turbulence;
  }
  if (turbulence > 0.6) {
    noise = noise + sin(dp.x * 80.0 + t * 2.0) * cos(dp.y * 70.0 - t * 1.8) * 0.1 * turbulence;
  }
  noise = clamp(noise, 0.0, 1.0);
  vec3 color = base_color.rgb * (0.6 + noise * 0.6);
  vec3 deep_color = base_color.rgb * vec3(0.6, 0.8, 1.2);
  color = mix(deep_color, color, noise);
  float highlight = pow(noise, 3.0 + (1.0 - metallic) * 3.0) * metallic;
  float sheen = pow(max(0.0, sin(dp.x * 40.0 + t * 2.0) * cos(dp.y * 35.0 - t * 1.5)), 8.0) * metallic * 0.4;
  color = color + vec3(highlight + sheen);
  return vec4(color, base_color.a * inside);
}

vec4 edge_fire_fill(float inside, vec2 p, float speed, float intensity, float turbulence, int palette, float time) {
  if (inside < 0.01) { return vec4(0.0); }
  float t = time * speed;
  float fire = 0.0;
  fire = fire + sin(p.x * 8.0 + t * 3.0) * 0.5;
  fire = fire + sin(p.y * 6.0 - t * 2.5) * 0.5;
  fire = fire + sin((p.x + p.y) * 5.0 + t * 4.0) * 0.3;
  if (turbulence > 0.3) {
    fire = fire + sin(p.x * 16.0 - t * 5.0) * sin(p.y * 14.0 + t * 3.5) * turbulence * 0.4;
  }
  if (turbulence > 0.6) {
    fire = fire + sin(p.x * 30.0 + t * 8.0) * cos(p.y * 25.0 - t * 6.0) * turbulence * 0.2;
  }
  fire = fire * 0.5 + 0.5;
  vec3 dark_color = vec3(1.0, 0.2, 0.0);
  vec3 bright_color = vec3(1.0, 0.9, 0.2);
  vec3 mid_color = vec3(1.0, 0.5, 0.1);
  if (palette == 1) {
    dark_color = vec3(0.0, 0.0, 0.4);
    bright_color = vec3(0.4, 0.7, 1.0);
    mid_color = vec3(0.1, 0.3, 0.9);
  } else if (palette == 2) {
    dark_color = vec3(0.0, 0.2, 0.0);
    bright_color = vec3(0.5, 1.0, 0.3);
    mid_color = vec3(0.1, 0.7, 0.2);
  } else if (palette == 3) {
    dark_color = vec3(0.2, 0.0, 0.3);
    bright_color = vec3(1.0, 0.5, 1.0);
    mid_color = vec3(0.5, 0.1, 0.8);
  }
  vec3 color = mix(dark_color, bright_color, pow(fire, 1.5));
  color = mix(color, mid_color, fire * 0.4);
  color = color * intensity;
  return vec4(color, inside);
}

vec4 edge_electric_fill(float inside, vec2 p, vec4 color, float speed, float intensity, float arc_count, float time) {
  if (inside < 0.01) { return vec4(0.0); }
  float t = time * speed;
  float freq_mult = arc_count * 6.0;
  float arc = 0.0;
  arc = arc + sin(p.x * freq_mult + t * 8.0) * sin(p.y * freq_mult * 0.83 - t * 6.0);
  arc = arc + sin((p.x - p.y) * freq_mult * 1.33 + t * 12.0) * 0.5;
  arc = arc + sin(length(p - vec2(0.5)) * freq_mult * 0.67 + t * 10.0) * 0.3;
  arc = pow(abs(arc), 0.3);
  float bolt = step(1.0 - intensity * 0.25, arc);
  float glow = pow(arc, 3.0 - intensity * 0.5);
  vec3 final_color = color.rgb * (glow * 0.4 * intensity + bolt * 1.5);
  final_color = final_color + vec3(0.8, 0.9, 1.0) * bolt * 0.5 * intensity;
  float flash = step(0.97 - intensity * 0.05, edge_random(vec2(floor(t * (4.0 + intensity * 4.0)), 0.0)));
  final_color = final_color + color.rgb * flash * 0.3 * intensity;
  final_color = final_color + color.rgb * (glow * 0.15 * intensity);
  return vec4(final_color, inside * max(glow * 0.5, bolt));
}

vec4 edge_holographic_fill(float inside, float d, vec2 p, float speed, float shift, float scanlines, float flicker_amt, float time, float rx) {
  if (inside < 0.01) { return vec4(0.0); }
  float t = time * speed;
  float angle = atan(p.y - 0.5, p.x - 0.5);
  float hue = edge_mod(angle / EDGE_TAU + t * 0.1 + shift, 1.0);
  vec3 rainbow = 0.5 + 0.5 * cos(EDGE_TAU * (hue + vec3(0.0, 0.33, 0.67)));
  float fresnel = exp(-abs(d) / (0.05 * rx) * 2.0);
  float scan = 1.0;
  if (scanlines > 0.1) {
    scan = sin(p.y * scanlines * 100.0 + t * 2.0) * 0.5 + 0.5;
    scan = mix(0.7, 1.0, scan);
  }
  float flicker = 1.0;
  if (flicker_amt > 0.01) {
    flicker = 1.0 - flicker_amt * 0.15;
    flicker = flicker + flicker_amt * 0.15 * sin(t * 15.0);
    flicker = flicker * (1.0 - flicker_amt * 0.1 * step(0.95, edge_random(vec2(floor(t * 8.0), 0.0))));
  }
  return vec4(rainbow * scan * flicker * (0.5 + fresnel * 0.5), inside * 0.8);
}

vec4 edge_noise_fill(float inside, vec2 p, vec4 color, float speed, float scale, float turbulence, vec4 color2, float time) {
  if (inside < 0.01) { return vec4(0.0); }
  float t = time * speed;
  float n = 0.0;
  float amp = 1.0;
  float freq = scale;
  for (int i = 0; i < 4; i = i + 1) {
    n = n + amp * (sin(p.x * freq + t + float(i)) * cos(p.y * freq * 1.3 - t * 0.7 + float(i) * 2.0));
    amp = amp * 0.5;
    freq = freq * (2.0 + turbulence);
  }
  n = n * 0.5 + 0.5;
  return vec4(mix(color2.rgb, color.rgb, n), inside * color.a);
}

vec4 edge_gradient_fill(float inside, vec2 p, vec2 px, vec4 color, vec4 color2, float angle, float speed, int grad_type, float time) {
  if (inside < 0.01) { return vec4(0.0); }
  float t;
  if (grad_type == 1) {
    t = fract(clamp(length(p - vec2(0.5)) * 2.0 + time * speed * 0.1, 0.0, 1.0));
  } else if (grad_type == 2) {
    float a = atan(p.y - 0.5, p.x - 0.5);
    t = edge_mod(a / EDGE_TAU + 0.5 + time * speed * 0.1, 1.0);
  } else if (grad_type == 3) {
    // Diamond: the L1 distance from the centre.
    t = fract(clamp((abs(p.x - 0.5) + abs(p.y - 0.5)) * 2.0 + time * speed * 0.1, 0.0, 1.0));
  } else {
    float a = angle + time * speed * 0.5;
    t = clamp(dot(p - vec2(0.5), vec2(cos(a), sin(a))) + 0.5, 0.0, 1.0);
  }
  // Half an 8-bit step of dither keeps long ramps from banding.
  float dither = (edge_hash2(px.x, px.y + 17.0) - 0.5) / 255.0;
  return vec4(mix(color.rgb, color2.rgb, t) + vec3(dither), inside * mix(color.a, color2.a, t));
}

// ---------- new fills ----------

// Extent of 'bbox' (px) projected on 'dir': (min, max).
vec2 edge_extent(vec4 bbox, vec2 dir) {
  float a = dot(bbox.xy, dir);
  float b = dot(vec2(bbox.z, bbox.y), dir);
  float c = dot(bbox.zw, dir);
  float d = dot(vec2(bbox.x, bbox.w), dir);
  return vec2(min(min(a, b), min(c, d)), max(max(a, b), max(c, d)));
}

float edge_far_corner(vec4 bbox, vec2 origin) {
  return max(max(length(bbox.xy - origin), length(bbox.zw - origin)),
    max(length(vec2(bbox.z, bbox.y) - origin), length(vec2(bbox.x, bbox.w) - origin)));
}

// Crisp pattern lines: 0 dots, 1 lines (hatch), 2 grid, 3 crosshatch,
// 4 chevron, 5 hexagon. Returns the pattern's coverage.
float edge_pattern(vec2 q, int kind, float scale, float line_w, float aa) {
  float s = max(scale, 1.0);
  float hw = max(line_w, aa) * 0.5;
  float fade = clamp(line_w / aa, 0.0, 1.0);
  if (kind == 0) {
    vec2 cell = q - s * (floor(q / s) + vec2(0.5));
    return edge_cov(length(cell) - max(line_w, aa) * 0.5 * 2.0, aa) * fade;
  }
  float fx = abs(q.x - s * round(q.x / s));
  float fy = abs(q.y - s * round(q.y / s));
  if (kind == 1) { return edge_cov(fx - hw, aa) * fade; }
  if (kind == 2) { return edge_cov(min(fx, fy) - hw, aa) * fade; }
  if (kind == 3) {
    vec2 r = vec2(q.x + q.y, q.x - q.y) * 0.70710678;
    float gx = abs(r.x - s * round(r.x / s));
    float gy = abs(r.y - s * round(r.y / s));
    return edge_cov(min(gx, gy) - hw, aa) * fade;
  }
  if (kind == 4) {
    float y = q.y + abs(edge_mod(q.x, s) - s * 0.5);
    float g = abs(y - s * round(y / s));
    return edge_cov(g * 0.70710678 - hw, aa) * fade;
  }
  // Hexagon edges: distance to the nearest hexagon cell border.
  vec2 r = vec2(1.0, 1.7320508) * s;
  vec2 h = r * 0.5;
  vec2 a = q - r * floor(q / r) - h;
  vec2 b = (q - h) - r * floor((q - h) / r) - h;
  vec2 g = ((dot(a, a) < dot(b, b)) ? (a) : (b));
  vec2 ag = abs(g);
  float hex = max(dot(ag, normalize(vec2(1.0, 1.7320508))), ag.x);
  return edge_cov(abs(hex - s * 0.5) - hw, aa) * fade;
}

// ---------- one edge effect ----------

vec4 edge_fx(uint li, int e, int k) {
  return edgeFx(e, k);
}

// One edge effect at output pixel 'p', as premultiplied colour.
vec4 edge_compose(vec4 fill, vec4 stroke, bool classic);

vec4 edge_effect_fragment(uint li, int e, vec2 p, EdgeHit base, EdgeCtx ctx) {
  vec4 v0 = edge_fx(li, e, 0);
  vec4 stroke_color_u = edge_fx(li, e, 1);
  vec4 sw = edge_fx(li, e, 2);
  vec4 s3 = edge_fx(li, e, 3);
  vec4 s4 = edge_fx(li, e, 4);
  vec4 f5 = edge_fx(li, e, 5);
  vec4 fill_color_u = edge_fx(li, e, 6);
  vec4 fill_color2_u = edge_fx(li, e, 7);
  vec4 fa = edge_fx(li, e, 8);
  vec4 an = edge_fx(li, e, 9);
  vec4 ap = edge_fx(li, e, 10);
  vec4 sb = edge_fx(li, e, 11);
  vec4 fb = edge_fx(li, e, 12);
  vec4 geo = edge_fx(li, e, 13);
  vec4 trim = edge_fx(li, e, 14);
  vec4 misc = edge_fx(li, e, 15);
  vec4 cen = edge_fx(li, e, 16);
  vec4 dash = edge_fx(li, e, 17);
  vec4 gbox = edge_fx(li, e, 18);
  int stroke_type = int(floor(v0.w + 0.5));
  int fill_type = int(floor(f5.y + 0.5));
  int anim_type = int(floor(an.x + 0.5));
  vec2 res = ctx.res;
  float rx = res.x;
  float total = ctx.total;
  float t = uTime - misc.y;
  vec2 center = ((misc.w > 0.5) ? (cen.xy) : (ctx.centroid_));
  float anim_count = an.y;
  float anim_spacing = an.z;
  float anim_speed = an.w;

  // Transform animations move the query point: q is where p lands on the
  // shape, k how much the transform magnifies it (distances scale by k).
  vec2 q = p;
  float k = 1.0;
  float visible = 1.0;
  if (anim_type == 4) {
    float angle = t * ap.x;
    if (angle != 0.0) { q = center + edge_rotate(p - center, angle); }
  } else if (anim_type == 8 || anim_type == 9) {
    // Card flip about the shape's X (8) or Y (9) axis, with perspective.
    float theta = t * anim_speed * EDGE_TAU;
    // Perspective 1 puts the eye 2.5 shape radii away (the near edge grows
    // at most 1.7x); 0 is a flat projection.
    float persp = clamp(ap.x, 0.0, 1.0);
    float extent = max(max(ctx.bbox.z - ctx.bbox.x, ctx.bbox.w - ctx.bbox.y) * 0.5, 8.0);
    float focal = ((persp > 0.001) ? (extent * 2.5 / persp) : (1.0e7));
    vec2 rel = p - center;
    float along = ((anim_type == 8) ? (rel.y) : (rel.x));
    float across = ((anim_type == 8) ? (rel.x) : (rel.y));
    float c = cos(theta);
    float s = sin(theta);
    float denom = focal * c - along * s;
    if (abs(denom) < 1e-3 || abs(c) < 1e-3) {
      visible = 0.0;
    } else {
      float a_plane = along * focal / denom;
      float depth = focal + a_plane * s;
      if (depth <= 0.0) { visible = 0.0; }
      float x_plane = across * depth / focal;
      q = center + ((anim_type == 8) ? (vec2(x_plane, a_plane)) : (vec2(a_plane, x_plane)));
      k = sqrt(abs(focal * focal * c / (depth * depth) * focal / depth));
    }
  } else if (anim_type == 10) {
    float tau = fract(t * anim_speed);
    float bounciness = max(ap.y, 1.0);
    float sc = max(1.0 - ap.x * exp(-5.0 * tau) * cos(tau * bounciness * EDGE_TAU), 0.05);
    q = center + (p - center) / sc;
    k = sc;
  } else if (anim_type == 11) {
    float a = t * anim_speed * EDGE_TAU;
    q = p - ap.x * vec2(cos(a), sin(a));
  } else if (anim_type == 12) {
    q = p - vec2(0.0, ap.x * abs(sin(t * anim_speed * EDGE_PI)));
  } else if (anim_type == 13) {
    float n = t * anim_speed * 8.0;
    q = p - ap.x * vec2(edge_value_noise(n, 11.0 + ctx.seed), edge_value_noise(n, 37.0 + ctx.seed));
  }
  if (visible < 0.5) { return vec4(0.0); }
  EdgeHit hit = base;
  if (any(notEqual(q, p))) {
    // A moved shape draws nothing where the moved point is beyond its box
    // plus the effect's reach: skip the distance field there.
    float reach = edge_fx(li, e, 20).z / max(k, 0.05);
    if (any(lessThan(q, ctx.bbox.xy - vec2(reach))) || any(greaterThan(q, ctx.bbox.zw + vec2(reach)))) {
      return vec4(0.0);
    }
    hit = edge_hit(li, q, ctx.count);
  }
  float aa = ctx.aa / max(k, 0.05);
  vec2 fill_px = ((anim_type >= 8) ? (q) : (p));
  vec2 uv = fill_px / res;
  float d = hit.d;
  float s_arc = hit.s;
  float path_pos = s_arc / total;
  float inside = edge_cov(d, aa);

  // Stroke geometry shared by the core band of every stroke type.
  float width = sw.x * ((geo.w > 0.5) ? (hit.scale) : (1.0));
  float hw = max(width, aa) * 0.5;
  int cap = int(floor(geo.x + 0.5));
  int join = int(floor(geo.y + 0.5));
  float band = edge_band_sd(li, q, hit, hw, join, max(geo.z, 1.0), ctx.count);

  // Trim path: the stroke only shows between start and end (fractions of the
  // perimeter), shifted by offset and optionally animated.
  bool trim_on = false;
  float trim_along = -1.0e6;
  int trim_mode = int(floor(trim.w + 0.5));
  if (trim_mode > 0 || trim.x > 0.0 || trim.y < 1.0) {
    trim_on = true;
    float t0 = trim.x;
    float t1 = trim.y;
    float prog = fract(t * misc.x);
    if (trim_mode == 1) { t1 = t0 + (t1 - t0) * prog; }
    else if (trim_mode == 2) { t0 = t0 + (t1 - t0) * prog; }
    else if (trim_mode == 3) { t1 = t0 + (t1 - t0) * (1.0 - abs(prog * 2.0 - 1.0)); }
    trim_along = edge_interval_out(s_arc, (t0 + trim.z) * total, (t1 - t0) * total, total);
  }
  // Classic types take the plain band and are trimmed by a mask afterwards;
  // solid and the new types cut the band itself, so the trim gets real caps.
  float core = edge_line_cov(band, width, aa);
  float core_sd = ((trim_on) ? (edge_open_sd(band, trim_along, hw, cap)) : (band));
  float stroke_speed = s3.y;

  // Fill and stroke are evaluated at full coverage (fill_color, and the
  // stroke with its core off and on: stroke0, stroke1); their analytic
  // coverages (fill_w, stroke_w) are applied at the end, linearly.
  vec4 fill_color = vec4(0.0);
  float fill_w = inside;
  vec4 stroke0 = vec4(0.0);
  vec4 stroke1 = vec4(0.0);
  float stroke_w = 0.0;
  bool stroke_has_trim = false;

  // ----- fill -----
  float fill_speed = f5.z;
  int prog_mode = int(floor(cen.z + 0.5));
  if (inside <= 0.0) {
    // Nothing of the fill reaches this pixel.
  } else if (fill_type == 1) {
    fill_color = fill_color_u;
  } else if (fill_type == 2) {
    fill_color = edge_plasma_fill(1.0, uv, fill_speed, fa.x, fa.y, int(floor(fa.z + 0.5)), t);
  } else if (fill_type == 3) {
    fill_color = edge_liquid_fill(1.0, uv, fill_color_u, fill_speed, fa.x, fa.y, fa.z, t);
  } else if (fill_type == 4) {
    fill_color = edge_fire_fill(1.0, uv, fill_speed, fa.x, fa.y, int(floor(fa.z + 0.5)), t);
  } else if (fill_type == 5) {
    fill_color = edge_electric_fill(1.0, uv, fill_color_u, fill_speed, fa.x, fa.y, t);
  } else if (fill_type == 6) {
    fill_color = edge_holographic_fill(1.0, d, uv, fill_speed, fa.x, fa.y, fa.z, t, rx);
  } else if (fill_type == 7) {
    fill_color = edge_noise_fill(1.0, uv, fill_color_u, fill_speed, fa.x, fa.y, fill_color2_u, t);
  } else if (fill_type == 8) {
    fill_color = edge_gradient_fill(1.0, uv, fill_px, fill_color_u, fill_color2_u, fa.x, fill_speed, int(floor(f5.w + 0.5)), t);
  } else if (fill_type >= 9) {
    float prog = edge_progress(t, fill_speed, prog_mode, cen.w);
    float region = d;           // signed distance of the lit region
    vec4 c1 = fill_color_u;
    float mixv = 0.0;           // 0 = colour 1, 1 = colour 2 (patterns)
    if (fill_type == 9) {
      float index = 0.0;
      // New colour each beat of the beat clock, delayed by the group chase.
      if (fa.z > 0.5) { index = floor(uClock.x - misc.y * uClock.y / 60.0); }
      float hue = edge_hash2(ctx.seed * 7.0 + index, 3.0 + float(e));
      c1 = vec4(edge_hsv(hue, clamp(fa.x, 0.0, 1.0), clamp(fa.y, 0.0, 1.0)), fill_color_u.a);
    } else if (fill_type == 10) {
      region = max(d, -d - prog * ctx.inradius);
    } else if (fill_type == 11) {
      region = (1.0 - prog) * ctx.inradius + d;
    } else if (fill_type == 12) {
      int ci = clamp(int(floor(fa.x + 0.5)), 0, max(ctx.corner_count - 1, 0));
      vec2 corner = ((ctx.corner_count > 0) ? (edgeCorner(ci).xy) : (center));
      region = max(d, length(fill_px - corner) - prog * edge_far_corner(ctx.bbox, corner));
    } else if (fill_type == 13 || fill_type == 14) {
      vec2 dir = vec2(cos(fa.x), sin(fa.x));
      vec2 ext = edge_extent(((fill_type == 14) ? (gbox) : (ctx.bbox)), dir);
      float soft = max(fa.y, 0.0);
      float along = dot(fill_px, dir) - (ext.x + prog * (ext.y - ext.x + soft));
      if (soft > 0.5) {
        c1 = vec4(fill_color_u.rgb, fill_color_u.a * (1.0 - edge_smoothstep(-soft, 0.0, along)));
      } else {
        region = max(d, along);
      }
    } else if (fill_type == 15) {
      float steps = max(floor(fa.x + 0.5), 1.0);
      vec2 dir = vec2(cos(fa.y), sin(fa.y));
      vec2 ext = edge_extent(ctx.bbox, dir);
      float span = max(ext.y - ext.x, 1.0);
      float x = dot(fill_px, dir) - ext.x;
      float lit = floor(prog * (steps + 1.0));
      region = max(d, x - lit * span / steps);
      float band_i = floor(x / (span / steps));
      c1 = vec4(fill_color_u.rgb * (0.55 + 0.45 * (band_i + 1.0) / steps), fill_color_u.a);
    } else if (fill_type == 16) {
      float period = max(fa.x, 1.0);
      mixv = 1.0 - edge_stripe(-d - t * fill_speed * period, period, 0.5, aa);
    } else if (fill_type == 17 || fill_type == 18) {
      vec2 dir = vec2(-sin(fa.x), cos(fa.x));
      float period = max(fa.y, 0.5) * 2.0;
      mixv = 1.0 - edge_stripe(dot(fill_px, dir) + t * fill_speed * period, period, 0.5, aa);
      if (fill_type == 18) {
        vec2 dir2 = vec2(sin(fa.x), cos(fa.x));
        float second = edge_stripe(dot(fill_px, dir2) - t * fill_speed * period, period, 0.5, aa);
        mixv = 1.0 - max(1.0 - mixv, second);
      }
    } else if (fill_type == 19) {
      float cell = max(fa.x, 2.0);
      vec2 id = floor(fill_px / cell);
      float on = step(edge_hash2(id.x + ctx.seed * 13.0, id.y), prog);
      mixv = 1.0 - on;
    } else if (fill_type == 20) {
      float radius = max(fa.x, 0.01) * max(ctx.inradius, 1.0);
      float pulse = ((fa.z > 0.0) ? (0.8 + 0.2 * sin(t * fa.z * EDGE_TAU)) : (1.0));
      float glow = clamp(fa.y * pulse * exp(-length(fill_px - center) / radius * 2.0), 0.0, 1.5);
      c1 = vec4(fill_color_u.rgb * glow, fill_color_u.a * clamp(glow, 0.0, 1.0));
    } else if (fill_type == 21) {
      // Origami: fan facets from the centre to each corner, each folding.
      vec2 rel = fill_px - center;
      float ang = atan(rel.y, rel.x);
      float facet = 0.0;
      int n = max(ctx.corner_count, 0);
      if (n >= 3) {
        float best = 1.0e9;
        for (int i = 0; i < 64; i = i + 1) {
          if (i >= n) { break; }
          vec2 ca = edgeCorner(i).xy - center;
          float da = edge_mod(ang - atan(ca.y, ca.x), EDGE_TAU);
          if (da < best) { best = da; facet = float(i); }
        }
      } else {
        facet = floor(edge_mod(ang, EDGE_TAU) / (EDGE_TAU / 8.0));
      }
      float fold = 0.5 + 0.5 * sin(t * fill_speed * EDGE_TAU + facet * 1.7);
      float depth = clamp(-d / max(ctx.inradius, 1.0), 0.0, 1.0);
      float shade = mix(1.0, 0.35 + 0.65 * fold, clamp(fa.x, 0.0, 1.0)) * mix(0.8, 1.05, depth);
      c1 = vec4(fill_color_u.rgb * shade, fill_color_u.a);
    } else if (fill_type == 22) {
      float cell = max(fa.x, 2.0);
      vec2 r = edge_rotate(fill_px - center, fa.y);
      vec2 id = floor(r / cell);
      vec2 cc = (id + vec2(0.5)) * cell;
      float value = 0.0;
      if (fa.z > 0.5) {
        value = clamp(uAudio0.x * 2.0, 0.0, 1.0);
      } else {
        float span = max(ctx.bbox.z - ctx.bbox.x, ctx.bbox.w - ctx.bbox.y);
        value = 1.0 - abs(fract(cc.x / max(span, 1.0) + t * fill_speed * 0.25) * 2.0 - 1.0);
      }
      float radius = cell * 0.5 * sqrt(value) * 1.414;
      mixv = 1.0 - edge_cov(length(r - cc) - radius, aa);
    } else if (fill_type == 23) {
      vec2 r = edge_rotate(fill_px - center, fa.z + t * fill_speed);
      mixv = 1.0 - edge_pattern(r, int(floor(fa.x + 0.5)), fa.y, fa.w, aa);
    } else if (fill_type == 24) {
      region = max(d, length(fill_px - center) - prog * edge_far_corner(ctx.bbox, center));
    } else if (fill_type == 25) {
      vec2 rel = fill_px - center;
      // Clockwise from twelve o'clock.
      float ang = edge_mod(EDGE_PI * 0.5 - atan(rel.y, rel.x), EDGE_TAU);
      float sweep = prog * EDGE_TAU;
      float r = length(rel);
      // Arc distance to the nearer boundary ray of the swept wedge.
      float wedge = ((ang < sweep) ? (-min(ang, sweep - ang)) : (min(ang - sweep, EDGE_TAU - ang))) * r;
      if (sweep >= EDGE_TAU - 1e-4) { wedge = -1.0e6; }
      region = max(d, wedge);
    } else if (fill_type == 26) {
      vec2 dir = vec2(cos(fa.y), sin(fa.y));
      vec2 ext = edge_extent(ctx.bbox, dir);
      float pos = ext.x + prog * (ext.y - ext.x);
      region = max(d, abs(dot(fill_px, dir) - pos) - max(fa.x, aa) * 0.5);
      c1 = vec4(fill_color_u.rgb, fill_color_u.a * clamp(fa.x / aa, 0.0, 1.0));
    }
    // 'region' starts as the shape itself; wipes and growth fills cut it.
    vec4 col = mix(c1, fill_color2_u, mixv);
    fill_color = col;
    fill_w = edge_cov(region, aa);
  }

  // ----- stroke -----
  if (stroke_type == 1) {
    stroke1 = stroke_color_u;
    stroke_w = edge_line_cov(core_sd, width, aa);
    stroke_has_trim = true;
  } else if (stroke_type == 2) {
    stroke1 = edge_glow_stroke(d, 1.0, stroke_color_u, sw.y, sw.z, sw.w, t, aa);
    stroke0 = edge_glow_stroke(d, 0.0, stroke_color_u, sw.y, sw.z, sw.w, t, aa);
    stroke_w = core;
  } else if (stroke_type == 3) {
    float nhw = max(width * 0.6, aa) * 0.5;
    stroke_w = edge_line_cov(edge_band_sd(li, q, hit, nhw, join, max(geo.z, 1.0), ctx.count), width * 0.6, aa);
    stroke1 = edge_neon_stroke(d, 1.0, stroke_color_u, width, sw.y, sw.w, t, aa);
    stroke0 = edge_neon_stroke(d, 0.0, stroke_color_u, width, sw.y, sw.w, t, aa);
  } else if (stroke_type == 4) {
    stroke1 = edge_snake_stroke(d, 1.0, stroke_color_u, width, s3.x, stroke_speed, path_pos, int(s3.z), t, rx, aa);
    stroke0 = edge_snake_stroke(d, 0.0, stroke_color_u, width, s3.x, stroke_speed, path_pos, int(s3.z), t, rx, aa);
    stroke_w = core;
  } else if (stroke_type == 5) {
    stroke1 = edge_rainbow_stroke(d, 1.0, width, stroke_speed, path_pos, t, rx, aa);
    stroke0 = edge_rainbow_stroke(d, 0.0, width, stroke_speed, path_pos, t, rx, aa);
    stroke_w = core;
  } else if (stroke_type == 6) {
    stroke1 = edge_dashed_stroke(1.0, stroke_color_u, s3.w, s4.x, path_pos, stroke_speed, t);
    stroke_w = core;
  } else if (stroke_type == 7) {
    stroke_w = edge_electric_core(d, width, s4.y, stroke_speed, path_pos, t, rx, aa);
    stroke1 = edge_electric_stroke(d, 1.0, stroke_color_u, width, s4.y, stroke_speed, path_pos, t, rx, aa);
    stroke0 = edge_electric_stroke(d, 0.0, stroke_color_u, width, s4.y, stroke_speed, path_pos, t, rx, aa);
  } else if (stroke_type == 8) {
    stroke1 = edge_strobe_stroke(d, 1.0, stroke_color_u, width, f5.x, t, rx, aa);
    stroke0 = edge_strobe_stroke(d, 0.0, stroke_color_u, width, f5.x, t, rx, aa);
    stroke_w = core;
  } else if (stroke_type == 9) {
    stroke1 = edge_scanner_stroke(d, 1.0, stroke_color_u, width, s4.z, stroke_speed, path_pos, s4.w, t, rx, aa);
    stroke0 = edge_scanner_stroke(d, 0.0, stroke_color_u, width, s4.z, stroke_speed, path_pos, s4.w, t, rx, aa);
    stroke_w = core;
  } else if (stroke_type == 10) {
    stroke1 = edge_fire_stroke(d, 1.0, stroke_color_u, width, stroke_speed, path_pos, t, rx, aa);
    stroke0 = edge_fire_stroke(d, 0.0, stroke_color_u, width, stroke_speed, path_pos, t, rx, aa);
    stroke_w = core;
  } else if (stroke_type >= 11) {
    float sd = core_sd;
    float alpha_scale = 1.0;
    vec3 add_rgb = vec3(0.0);
    float add_a = 0.0;
    if (stroke_type == 11 || stroke_type == 12) {
      // Half / Quarter: lit runs of the border that travel round it.
      float o = fract(t * stroke_speed) * total;
      float along = edge_interval_out(s_arc, o, total * 0.5, total);
      if (stroke_type == 12) {
        along = min(edge_interval_out(s_arc, o, total * 0.25, total), edge_interval_out(s_arc, o + total * 0.5, total * 0.25, total));
      }
      sd = edge_open_sd(core_sd, along, hw, cap);
    } else if (stroke_type == 13) {
      // Line: a run of 'length' travelling the border (normal, boomerang
      // back and forth, or yoyo growing and shrinking).
      float len = clamp(sb.x, 0.0, 1.0) * total;
      int mode = int(floor(sb.y + 0.5));
      float head = fract(t * stroke_speed) * total;
      float run = len;
      if (mode == 1) {
        head = (1.0 - abs(fract(t * stroke_speed * 0.5) * 2.0 - 1.0)) * total;
      } else if (mode == 2) {
        run = len * (1.0 - abs(fract(t * stroke_speed) * 2.0 - 1.0));
        head = fract(t * stroke_speed * 0.25) * total + run;
      }
      sd = edge_open_sd(core_sd, edge_interval_out(s_arc, head - run, run, total), hw, cap);
    } else if (stroke_type == 14) {
      // Comet: a crisp head dot and a tail fading analytically behind it.
      float head = fract(t * stroke_speed) * total;
      float tail = max(clamp(sb.x, 0.0, 1.0) * total, 1.0);
      float behind = edge_mod(head - s_arc, total);
      sd = edge_open_sd(core_sd, edge_interval_out(s_arc, head - tail, tail, total), hw, 1);
      alpha_scale = ((behind <= tail) ? (exp(-3.0 * behind / tail)) : (0.0));
      vec2 head_p = edge_point_at(li, head, ctx.count, total);
      float head_r = max(width * max(sb.y, 1.0), aa) * 0.5;
      add_a = edge_cov(length(q - head_p) - head_r, aa);
    } else if (stroke_type == 15 || stroke_type == 16) {
      // Dash pattern / marching ants: dashes measured in path pixels, the
      // pattern fitted to a whole number of repeats round the closed path.
      float d1 = max(dash.x, 0.0);
      float g1 = max(dash.y, 0.0);
      float d2 = max(dash.z, 0.0);
      float g2 = max(dash.w, 0.0);
      if (stroke_type == 16) { d2 = 0.0; g2 = 0.0; }
      float cycle = max(d1 + g1 + d2 + g2, 1.0);
      float repeats = max(round(total / cycle), 1.0);
      float fit = total / (repeats * cycle);
      float offset = t * stroke_speed;
      if (stroke_type == 16 && sb.x > 0.5) {
        // One full dash cycle per beat, locked to the beat phase.
        offset = fract(uClock.x) * cycle * fit;
      }
      float uu = s_arc - offset;
      float along = edge_periodic_out(uu, d1 * fit, cycle * fit);
      if (d2 > 0.0) {
        along = min(along, edge_periodic_out(uu - (d1 + g1) * fit, d2 * fit, cycle * fit));
      }
      sd = edge_open_sd(core_sd, along, hw, cap);
    } else if (stroke_type == 17) {
      // Offset outlines: parallel copies at a fixed pixel spacing, inset,
      // outset or both, drifting outward at 'speed' px/s.
      float count = max(floor(sb.x + 0.5), 1.0);
      float spacing = max(sb.y, 1.0);
      int direction = int(floor(sb.z + 0.5));
      float phase = edge_mod(t * stroke_speed, spacing);
      float best = 1.0e6;
      if (direction != 1) {
        float x = -d - phase;
        float kk = clamp(round(x / spacing), 0.0, count);
        best = min(best, abs(x - kk * spacing));
      }
      if (direction != 0) {
        float x = d + phase;
        float kk = clamp(round(x / spacing), 0.0, count);
        best = min(best, abs(x - kk * spacing));
      }
      sd = best - hw;
      if (trim_on) { sd = max(sd, trim_along); }
    } else if (stroke_type == 18) {
      // Corner accents: brackets running 'length' px from each corner.
      float along = 1.0e6;
      for (int i = 0; i < 64; i = i + 1) {
        if (i >= ctx.corner_count) { break; }
        float sc = edgeCorner(i).z;
        float du = abs(edge_mod(s_arc - sc + total * 0.5, total) - total * 0.5);
        along = min(along, du - max(sb.x, 0.0));
      }
      sd = edge_open_sd(core_sd, along, hw, cap);
    } else if (stroke_type == 19) {
      // Vertex dots, swelling on the beat, with a ring burst.
      float beat = ghost_audio_beat(ghost_audio_scene());
      float r0 = max(sb.x, 0.5);
      float r = r0 * (1.0 + max(sb.y, 0.0) * beat);
      float dot_sd = 1.0e6;
      float ring = 1.0e6;
      for (int i = 0; i < 64; i = i + 1) {
        if (i >= ctx.corner_count) { break; }
        float dist = length(q - edgeCorner(i).xy);
        dot_sd = min(dot_sd, dist - r);
        ring = min(ring, abs(dist - r0 * (1.0 + 3.0 * max(sb.y, 0.0) * beat)));
      }
      sd = dot_sd;
      if (trim_on) { sd = max(sd, trim_along); }
      add_a = edge_line_cov(ring - max(width, aa) * 0.5, width, aa) * beat * ((sb.y > 0.0) ? (1.0) : (0.0));
    } else if (stroke_type == 20) {
      // Wireframe: spokes from the centre to each corner, the inner
      // triangulation, and optionally the outline itself.
      float best = ((sb.z > 0.5) ? (abs(d)) : (1.0e6));
      int n = ctx.corner_count;
      if (sb.x > 0.5) {
        for (int i = 0; i < 64; i = i + 1) {
          if (i >= n) { break; }
          vec2 a = edgeCorner(i).xy;
          vec2 pa = q - center;
          vec2 ba = a - center;
          float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
          best = min(best, length(pa - ba * h));
        }
      }
      if (sb.y > 0.5) {
        for (int i = 0; i < 64; i = i + 1) {
          if (i >= ctx.diag_count) { break; }
          vec4 pair = edgeDiag(i / 2);
          vec2 ij = (((i % 2) == 0) ? (pair.xy) : (pair.zw));
          vec2 a = edgeCorner(int(ij.x)).xy;
          vec2 b = edgeCorner(int(ij.y)).xy;
          vec2 pa = q - a;
          vec2 ba = b - a;
          float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
          best = min(best, length(pa - ba * h));
        }
      }
      sd = best - hw;
      if (trim_on) { sd = max(sd, trim_along); }
    } else if (stroke_type == 21 || stroke_type == 22) {
      // Zig-zag / wiggle: the centerline displaced across itself as a
      // function of arc length; dividing by the slope keeps it crisp.
      float amp = max(sb.x, 0.0);
      float wl = max(sb.y, 2.0);
      float x = s_arc / wl + t * stroke_speed;
      float offset = 0.0;
      float slope = 0.0;
      if (stroke_type == 21) {
        offset = amp * (abs(fract(x) * 4.0 - 2.0) - 1.0);
        slope = 4.0 * amp / wl;
      } else {
        offset = amp * edge_value_noise(x * 2.0, sb.z + ctx.seed);
        slope = 3.0 * amp / wl;
      }
      sd = abs(d - offset) / sqrt(1.0 + slope * slope) - hw;
      if (trim_on) { sd = max(sd, trim_along); }
    }
    float cov_line = edge_line_cov(sd, width, aa) * alpha_scale;
    stroke1 = stroke_color_u;
    stroke_w = max(cov_line, add_a);
    stroke_has_trim = true;
  }

  // ----- classic animations (the editor's, at output resolution) -----
  if (anim_type == 1 && anim_count >= 1.0) {
    int cnt = int(anim_count);
    int direction = int(floor(ap.x + 0.5));
    int loop_count = ((direction == 2) ? (cnt * 2) : (cnt));
    float ta = t * anim_speed;
    vec4 result = vec4(0.0);
    for (int i = 0; i < 40; i = i + 1) {
      if (i >= loop_count) { break; }
      float fi = float(i % cnt);
      bool is_inward = (direction == 1) || (direction == 2 && i >= cnt);
      float phase = edge_mod(fi * anim_spacing + ta * 0.15, float(cnt) * anim_spacing);
      float scale;
      if (is_inward) {
        scale = max(1.0 - phase / (float(cnt) * anim_spacing) * 0.95, 0.02);
      } else {
        scale = 1.0 + phase;
      }
      vec2 rq = center + (p - center) / scale;
      // The distance field is 1-Lipschitz: |d(rq)| >= |d(p)| - |rq - p|, so
      // a ring that cannot reach this pixel is skipped without a search.
      if (abs(base.d) - length(rq - p) > max(sw.x * 2.0, aa / scale) + 1.0) { continue; }
      EdgeHit ring = edge_hit(li, rq, ctx.count);
      float stroke_alpha = edge_falloff(abs(ring.d), sw.x * 2.0, aa / scale);
      result = max(result, stroke_color_u * stroke_alpha);
    }
    stroke0 = stroke0 + result;
    stroke1 = stroke1 + result;
  }
  if (anim_type == 3) {
    float breathe_t = sin(t * anim_speed * EDGE_PI) * 0.5 + 0.5;
    float bs = mix(ap.x, ap.y, breathe_t);
    EdgeHit bh = edge_hit(li, center + (p - center) / bs, ctx.count);
    stroke_w = edge_line_cov(abs(bh.d) - hw, width, aa / max(bs, 0.05));
    stroke1 = stroke_color_u;
    stroke0 = vec4(0.0);
  }
  if (anim_type == 2 && anim_count > 0.0) {
    vec2 rel = p - center;
    float ray_angle = edge_mod(atan(rel.y, rel.x) + t * anim_speed * 0.5, EDGE_TAU);
    float ray = pow(abs(cos(ray_angle * anim_count * 0.5)), 20.0);
    float radiate = ray * (1.0 - edge_smoothstep(0.0, 0.4 * rx, length(rel)));
    stroke0 = stroke0 + stroke_color_u * radiate * 0.5;
    stroke1 = stroke1 + stroke_color_u * radiate * 0.5;
  }
  if (anim_type == 5) {
    float dist = length(p - center);
    float ripple_count = max(anim_count, 3.0);
    for (int i = 0; i < 10; i = i + 1) {
      if (float(i) >= ripple_count) { break; }
      float r = edge_mod(t * anim_speed * 0.15 + float(i) * anim_spacing, ripple_count * anim_spacing);
      float ring = edge_falloff(abs(dist - r * rx), sw.x * 2.0, aa);
      vec4 add = stroke_color_u * ring * exp(-r * ap.x * 5.0) * 0.3;
      stroke0 = stroke0 + add;
      stroke1 = stroke1 + add;
    }
  }
  if (anim_type == 6) {
    float wt = t * anim_speed;
    vec2 wave_offset = vec2(
      sin(uv.y * ap.y * 20.0 + wt * 3.0),
      cos(uv.x * ap.y * 20.0 + wt * 2.5)
    ) * ap.x * 0.02 * rx;
    EdgeHit wh = edge_hit(li, p + wave_offset, ctx.count);
    stroke_w = edge_line_cov(abs(wh.d) - hw, width, aa);
    stroke1 = stroke_color_u;
    stroke0 = vec4(0.0);
    if (fill_type > 0) {
      fill_w = fill_w * edge_cov(wh.d, aa);
    }
  }
  if (anim_type == 7 && ap.x > 0.0) {
    float gt = t * anim_speed;
    float block_y = floor(uv.y * (10.0 / ap.y)) * ap.y * 0.1;
    float trigger = step(0.92, edge_random(vec2(block_y, floor(gt * 4.0))));
    float offset = (edge_random(vec2(block_y + 1.0, floor(gt * 4.0))) - 0.5) * ap.x * 0.05 * rx;
    if (trigger > 0.5) {
      EdgeHit hr = edge_hit(li, p + vec2(offset, 0.0), ctx.count);
      EdgeHit hb = edge_hit(li, p - vec2(offset, 0.0), ctx.count);
      float ar = edge_line_cov(abs(hr.d) - hw, width, aa);
      float ab = edge_line_cov(abs(hb.d) - hw, width, aa);
      float ag = mix(stroke0, stroke1, stroke_w).a;
      stroke1 = vec4(stroke_color_u.r * ar, stroke_color_u.g * ag, stroke_color_u.b * ab, max(ar, max(ag, ab)) * stroke_color_u.a);
      stroke0 = stroke1;
      stroke_w = 1.0;
    }
  }

  // The four corners of (fill coverage, stroke coverage), each composited
  // the editor's way, then interpolated: analytic edges stay linear.
  bool classic = stroke_type <= 10 && fill_type <= 8;
  vec4 fill0 = vec4(fill_color.rgb, 0.0);
  vec4 bare = mix(edge_compose(fill0, stroke0, classic), edge_compose(fill_color, stroke0, classic), fill_w);
  vec4 lit = mix(edge_compose(fill0, stroke1, classic), edge_compose(fill_color, stroke1, classic), fill_w);
  vec4 out_ = mix(bare, lit, stroke_w);
  if (trim_on && !stroke_has_trim) {
    // Classic strokes: the trim masks the whole stroke, halo included.
    vec4 no_stroke = mix(edge_compose(fill0, vec4(0.0), classic), edge_compose(fill_color, vec4(0.0), classic), fill_w);
    out_ = mix(no_stroke, out_, edge_cov(trim_along, aa));
  }
  return out_;
}

// Fill and stroke composited to premultiplied colour. The classic types
// keep the editor's shape shader composite (mix by stroke alpha, then the
// additive (SRC_ALPHA, ONE) write into an 8-bit target), which shapes
// their glow halos; the new types use plain premultiplied source-over.
vec4 edge_compose(vec4 fill, vec4 stroke, bool classic) {
  if (classic) {
    vec4 r = mix(fill, stroke, stroke.a);
    float a = clamp(r.a, 0.0, 1.0);
    return vec4(clamp(r.rgb, vec3(0.0), vec3(1.0)) * a, a);
  }
  float sa = clamp(stroke.a, 0.0, 1.0);
  float fa = clamp(fill.a, 0.0, 1.0);
  vec3 rgb = clamp(stroke.rgb, vec3(0.0), vec3(1.0)) * sa + clamp(fill.rgb, vec3(0.0), vec3(1.0)) * fa * (1.0 - sa);
  return vec4(rgb, sa + fa * (1.0 - sa));
}

// Hue rotation about the grey axis (Rodrigues), 'turns' of a full circle.
vec3 edge_hue_rotate(vec3 c, float turns) {
  float a = turns * EDGE_TAU;
  vec3 k = vec3(0.57735027);
  float ca = cos(a);
  return clamp(c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca), vec3(0.0), vec3(1.0));
}

// Beat reaction of one effect (Looks): slot 21 = (mode, source, amount,
// decay), slot 12 = (chase index, chase count, chase beats, hue per beat).
// Modes: 1 pulse, 2 boost, 3 step (one group member per beat), 4 strobe.
// Sources: 0 beat clock, 1 kick, 2 snare, 3 bass, 4 level, 5 treble; audio
// sources follow the beat clock while no audio is live, so a Look moves on
// a tapped or typed tempo too. Returns (alpha gain, whiten, hue turns, _).
vec4 edge_react(vec4 rx, vec4 rc) {
  int mode = int(floor(rx.x + 0.5));
  int source = int(floor(rx.y + 0.5));
  float amount = clamp(rx.z, 0.0, 1.0);
  float decay = max(rx.w, 0.05);
  float n = max(floor(rc.y + 0.5), 1.0);
  float k = floor(rc.x + 0.5);
  float beat = uClock.x - k * rc.z;
  float beat_i = floor(beat);
  float clock_env = exp(-(beat - beat_i) * 4.0 * decay);
  GhostAudio audio = ghost_audio_scene();
  float env = clock_env;
  if (source > 0 && ghost_audio_active(audio) > 0.5) {
    if (source == 1) { env = ghost_audio_kick(audio); }
    else if (source == 2) { env = ghost_audio_snare(audio); }
    else if (source == 3) { env = ghost_audio_bass(audio); }
    else if (source == 4) { env = ghost_audio_level(audio); }
    else { env = ghost_audio_treble(audio); }
  }
  env = clamp(env, 0.0, 1.0);
  float gain = 1.0;
  float whiten = 0.0;
  if (mode == 1) {
    gain = 1.0 - amount + amount * env;
  } else if (mode == 2) {
    gain = 1.0 + amount * env * 1.5;
    whiten = amount * env * 0.45;
  } else if (mode == 3) {
    float lit = ((abs(edge_mod(floor(uClock.x), n) - k) < 0.5) ? (1.0) : (0.0));
    gain = 1.0 - amount + amount * lit * mix(1.0, clock_env, 0.35);
  } else if (mode == 4) {
    gain = ((env > 0.5) ? (1.0) : (1.0 - amount));
  }
  return vec4(gain, whiten, rc.w * beat_i, 0.0);
}

// The layer's edge stack at output UV 'p_uv': each effect is composited
// onto the layer with premultiplied source-over and its blend mode
// (W3C compositing), then the layer goes on with its own blend and opacity.
// 'layer' is straight colour and coverage; so is the result.
vec4 apply_native_edge_effects(vec4 layer, vec2 p_uv, uint li, float aa) {
  vec4 info = uEdgeInfo;
  EdgeCtx ctx;
  ctx.count = min(int(floor(info.x + 0.5)), 512);
  int effect_count = min(int(floor(info.y + 0.5)), 16);
  if (ctx.count < 3 || effect_count < 1) { return layer; }
  ctx.corner_count = min(int(floor(info.z + 0.5)), 64);
  ctx.diag_count = min(int(floor(info.w + 0.5)), 64);
  vec4 geom = uEdgeGeom;
  ctx.centroid_ = geom.xy;
  ctx.total = max(geom.z, 1.0);
  ctx.inradius = geom.w;
  ctx.aa = aa;
  ctx.res = uResolution;
  ctx.seed = uEdgeExtra.x;
  ctx.bbox = uEdgeBox;
  vec2 p = p_uv * uResolution;
  EdgeHit base;
  bool base_ready = false;
  vec3 cr = layer.rgb * layer.a;
  float ca = layer.a;
  for (int e = 0; e < 16; e = e + 1) {
    if (e >= effect_count) { break; }
    // Cull per effect: outside its own rectangle, or (for effects that keep
    // the outline still) farther from the centerline than it can reach.
    vec4 rect = edgeFx(e, 19);
    if (any(lessThan(p_uv, rect.xy)) || any(greaterThan(p_uv, rect.zw))) { continue; }
    if (!base_ready) {
      base = edge_hit(li, p, ctx.count);
      base_ready = true;
    }
    vec4 cull = edgeFx(e, 20);
    if (base.d > cull.x || (cull.y < 0.5 && -base.d > cull.x)) { continue; }
    vec4 head = edgeFx(e, 0);
    // Premultiplied effect colour.
    vec4 frag = edge_effect_fragment(li, e, p, base, ctx);
    float src_a = clamp(frag.a, 0.0, 1.0) * clamp(head.y, 0.0, 1.0);
    vec3 src_c = clamp(frag.rgb / max(frag.a, 1e-6), vec3(0.0), vec3(1.0));
    vec4 react_mode = edgeFx(e, 21);
    if (react_mode.x > 0.5) {
      vec4 r = edge_react(react_mode, edgeFx(e, 12));
      src_a = clamp(src_a * r.x, 0.0, 1.0);
      if (r.z != 0.0) { src_c = edge_hue_rotate(src_c, r.z); }
      src_c = mix(src_c, vec3(1.0), clamp(r.y, 0.0, 1.0));
    }
    if (src_a <= 0.0) { continue; }
    vec3 cb = ((ca > 1e-6) ? (cr / max(ca, 1e-6)) : (vec3(0.0)));
    vec3 blended = native_blend(cb, src_c, 1.0, head.z);
    cr = src_a * (1.0 - ca) * src_c + src_a * ca * blended + (1.0 - src_a) * cr;
    ca = src_a + ca * (1.0 - src_a);
  }
  return vec4(((ca > 1e-6) ? (cr / max(ca, 1e-6)) : (vec3(0.0))), ca);
}

void main() {
  // The layer below arrives as straight colour and coverage, like the core's.
  vec4 layer = texture(uSource, vUv);
  // One output pixel: the compositor renders at composition resolution.
  fragColor = apply_native_edge_effects(layer, vUv, 0u, 1.0);
}
`;
