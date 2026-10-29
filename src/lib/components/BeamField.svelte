<script lang="ts">
  // The beam field from the body of ghostarcade.live: a ghostly fbm domain
  // warp lit by projector beams from one source above the frame.
  //
  // A beam is constant along its own ray, so the slat pattern is evaluated
  // once per pixel and the only thing marched is transmittance through a
  // cheap two-octave copy of the field (~48 noise taps a pixel, not ~600).
  //
  // It runs on a launch screen while the editor is starting, so it is
  // kept cheap: drawn below display resolution and scaled up (the field is
  // soft enough to take it), held to 30 frames a second, paused while the
  // window is in the background, linked off the main thread where the
  // driver allows, and reduced to one still frame for reduced motion or a
  // software rasterizer. Where WebGL would only run in software it draws
  // nothing and the ground colour behind the canvas shows instead.
  import { onMount } from 'svelte';

  /** False holds the canvas back; the field fades in once it turns true. */
  export let active = true;
  /** Draw one frame and never animate. */
  export let still = false;
  /** Where the light sits: 0 high on the left, 0.5 overhead, 1 low on the right. */
  export let sweep = 0.3;

  const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

  const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2  uRes;
uniform float uTime;
uniform float uSweep;   /* 0..1, where the light source sits */

#define TAU 6.28318530718

const vec3 GHOST = vec3(0.906, 0.933, 0.961);  /* #e7eef5 */
const vec3 BLUE  = vec3(0.227, 0.361, 0.949);  /* #3a5cf2 */
const vec3 INK   = vec3(0.322, 0.471, 1.000);  /* #5278ff */
const vec3 DEEP  = vec3(0.027, 0.031, 0.035);  /* #070809 */

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

/* Three octaves. The rotation between them stops the lattice of the value
   noise showing up as a grid at the low frequencies. */
const mat2 ROT = mat2(0.80, 0.60, -0.60, 0.80);
float fbm3(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = ROT * p * 2.02; a *= 0.5; }
  return v;
}
float fbm2(vec2 p) {
  float v = vnoise(p) * 0.62;
  v += vnoise(ROT * p * 2.03) * 0.31;
  return v;
}

/* The ghost: fbm warped by fbm warped by fbm. Each level bends the domain
   of the next, which is why the result tears and folds instead of simply
   being lumpy. */
float ghost(vec2 p, float t, float amt) {
  vec2 q = vec2(fbm3(p + vec2(0.0, t * 0.031)),
                fbm3(p + vec2(5.2, 1.3) + vec2(t * 0.024, 0.0)));
  vec2 r = vec2(fbm3(p + amt * q + vec2(1.7, 9.2) - t * 0.019),
                fbm3(p + amt * q + vec2(8.3, 2.8) + t * 0.027));
  return fbm3(p + amt * r);
}

/* The same field, two octaves and one warp, for the occlusion march. Its
   only job is to say where the light is blocked. */
float ghostLo(vec2 p, float t) {
  vec2 q = vec2(fbm2(p + vec2(0.0, t * 0.031)),
                fbm2(p + vec2(5.2, 1.3) + vec2(t * 0.024, 0.0)));
  return fbm2(p + 2.6 * q);
}

/* Caustics: the iterated-distortion pattern. The coordinate is pushed far
   from the origin on purpose; the filaments only go sparse and bright out
   there. */
float caustic(vec2 p, float t) {
  p = mod(p, TAU) - 250.0;
  vec2 i = p;
  float c = 1.0;
  const float inten = 0.0055;
  for (int n = 0; n < 3; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 3.0;
  c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 4.0);
}

/* Irregular slats around the source. Two frequencies so a wide shaft can
   have a thin one running beside it. The window straddles the mean of the
   noise (~0.5), or the average pixel lands on zero and there are no shafts,
   only the rare peak. */
float slats(float a, float t, float splay) {
  float n = vnoise(vec2(a * splay, t * 0.050));
  float m = vnoise(vec2(a * splay * 3.1 + 11.0, t * 0.037));
  float v = n * 0.62 + m * 0.38;
  return pow(smoothstep(0.34, 0.86, v), 1.6);
}

void main() {
  float t = uTime;
  float sc = uSweep;

  /* The evolution: incommensurate periods, so the combination does not come
     back around for a long time. */
  float e0 = sin(t * 0.0748);
  float e1 = sin(t * 0.0413 + 1.7);
  float e2 = sin(t * 0.0231 + 4.1);

  vec2 R = uRes;
  vec2 frag = gl_FragCoord.xy;
  /* Square aspect for the field so the noise does not stretch on wide
     screens, but the real 0..1 for the vertical grade. */
  vec2 uv = (frag - 0.5 * R) / min(R.x, R.y);
  float vy = frag.y / R.y;

  /* 1. ground */
  vec3 col = DEEP * (0.72 + 0.75 * pow(1.0 - vy, 1.7));
  col += BLUE * 0.018 * pow(vy, 2.0);

  /* 2. the source. The sweep walks it across and down; time drifts it on
     top of that, so the light never parks. */
  float sweep = sc * 2.0 - 1.0;
  vec2 L = vec2(sweep * 0.95 + e0 * 0.22,
                1.05 - sc * 0.55 + e1 * 0.08);
  vec2 d = uv - L;
  float dist = length(d);
  float ang = atan(d.x, -d.y);

  /* Few wide shafts at one end of the sweep, many narrow ones at the other. */
  float splay = 2.4 + sc * 3.6 + e1 * 0.9;

  /* 3. transmittance from this pixel to the source. Nothing else is
     accumulated: the slat value is constant along a ray. */
  float dither = hash21(frag + fract(t) * 57.0);
  float trans = 1.0;
  const int STEPS = 14;
  for (int i = 0; i < STEPS; i++) {
    float s = (float(i) + dither) / float(STEPS);
    vec2 p = mix(uv, L, s * 0.94);
    float occ = smoothstep(0.34, 0.84, ghostLo(p * 1.55 + vec2(0.0, t * 0.012), t));
    trans *= exp(-occ * 3.4 / float(STEPS));
  }

  /* 4. the shafts: white, with a signed red/blue deviation taken from the
     difference to the mono beam, so it is near zero across the body of a
     shaft and shows only where the profile changes fast. That is an edge
     fringe, which is what a misconverged lens does. */
  float chroma = 0.010 + 0.014 * sc;
  float bm = slats(ang, t, splay);
  float bR = slats(ang + chroma, t, splay);
  float bB = slats(ang - chroma, t, splay);
  float dR = clamp((bR - bm) * 2.2, -0.30, 0.30);
  float dB = clamp((bB - bm) * 2.2, -0.30, 0.30);
  vec3 beam = max(vec3(bm) * (1.0 + vec3(dR, 0.0, dB)), 0.0);

  float fall = exp(-dist * (0.50 + e2 * 0.12));
  vec3 rays = beam * trans * fall * (1.0 + 0.4 * e1);

  /* Caustics riding inside the shafts, sampled in a frame stretched along
     the beam so the filaments run with the light. They ride the mono beam:
     on the split one they would amplify the channel offset and tint whole
     shafts. */
  vec2 cf = vec2(ang * 5.5, dist * 2.6 - t * 0.035);
  float cau = caustic(cf * (3.4 + sc * 1.6), t * 0.10);
  rays += vec3(bm) * trans * fall * cau * (0.34 + 0.24 * sc);

  /* 5. the ghost field itself, lit from the same direction */
  float warpAmt = 2.6 + e0 * 1.1;
  float g = ghost(uv * 1.35 + vec2(0.0, t * 0.010), t, warpAmt);
  float body = smoothstep(0.30, 0.86, g);
  float edge = smoothstep(0.52, 0.74, g) * (1.0 - smoothstep(0.74, 0.93, g));

  /* The shafts stay white; all that survives of a tint is a barely-there
     cool-to-neutral drift along the sweep. */
  vec3 tint = mix(vec3(0.94, 0.97, 1.00), vec3(1.00, 0.98, 0.97),
                  smoothstep(0.15, 0.85, sc));

  col += mix(BLUE * 0.34, INK * 0.46, body) * body * 0.36;
  /* the torn edges catch the light: this is the ghostly read */
  col += mix(INK, GHOST, 0.45) * edge * (0.14 + dot(rays, vec3(0.33)) * 1.6) * 0.95;

  /* beams, dimmed where the ghost body is thick in front of them */
  col += rays * tint * (1.0 - body * 0.35) * 1.45;

  /* 6. motes catching the beams */
  vec2 mp = uv * 62.0 + vec2(t * 0.06, -t * 0.025);
  vec2 mi = floor(mp), mf = fract(mp) - 0.5;
  float m = hash21(mi);
  float dot2 = smoothstep(0.010, 0.0, dot(mf, mf));
  float mote = step(0.975, m) * dot2 * (0.45 + 0.55 * sin(t * 1.6 + m * 40.0));
  col += vec3(0.80, 0.90, 1.0) * mote * (0.10 + dot(rays, vec3(0.33)) * 2.6) * 1.0;

  /* Grade. 0.72 is a ceiling, not taste: text sits on top of this. */
  col = 1.0 - exp(-col * 1.62);
  col *= 0.72;
  col += (hash21(frag + fract(t) * 131.0) - 0.5) * 0.012;

  /* edges fall away so the field never draws a visible box */
  vec2 v = (frag / R - 0.5) * 2.0;
  col *= 1.0 - dot(v, v) * 0.16;

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

  /** A point in the cycle where, with the light at its default sweep, the
   *  beams fan out on both sides of the screen. Also the reduced-motion frame. */
  const START_TIME = 30;
  const RENDER_SCALE = 0.6;
  const MAX_PIXELS = 520_000;
  const FRAME_MS = 1000 / 30;
  const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render/i;

  let canvas: HTMLCanvasElement;
  let shown = false;
  let apply: (() => void) | null = null;

  $: if (apply) { void active; void still; void sweep; apply(); }

  onMount(() => {
    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
      failIfMajorPerformanceCaveat: true,
    });
    if (!gl) return;

    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const softwareGl = SOFTWARE_RENDERER.test(String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)));
    const parallel = gl.getExtension('KHR_parallel_shader_compile');
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;

    let program: WebGLProgram | null = null;
    let buffer: WebGLBuffer | null = null;
    let uRes: WebGLUniformLocation | null = null;
    let uTime: WebGLUniformLocation | null = null;
    let uSweep: WebGLUniformLocation | null = null;
    let linked = false;
    let lost = false;
    let disposed = false;
    let linkPoll = 0;
    let raf = 0;
    let last = 0;
    let clock = START_TIME;
    let width = 0;
    let height = 0;

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };

    // Compiles and links without blocking where the driver supports it;
    // the field starts as soon as the program is ready.
    const build = () => {
      linked = false;
      width = height = 0;
      const vs = compile(gl.VERTEX_SHADER, VERT);
      const fs = compile(gl.FRAGMENT_SHADER, FRAG);
      program = vs && fs ? gl.createProgram() : null;
      if (!vs || !fs || !program) return;
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      const finish = () => {
        linkPoll = 0;
        if (disposed || lost || !program) return;
        if (parallel && !gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR)) {
          linkPoll = window.setTimeout(finish, 50);
          return;
        }
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          gl.deleteProgram(program);
          program = null;
          return;
        }
        gl.useProgram(program);
        // One triangle that covers the screen: no diagonal seam.
        buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const aPos = gl.getAttribLocation(program, 'aPos');
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
        uRes = gl.getUniformLocation(program, 'uRes');
        uTime = gl.getUniformLocation(program, 'uTime');
        uSweep = gl.getUniformLocation(program, 'uSweep');
        linked = true;
        sync();
      };
      finish();
    };

    const resize = () => {
      const cssWidth = canvas.clientWidth || window.innerWidth;
      const cssHeight = canvas.clientHeight || window.innerHeight;
      let w = Math.max(1, Math.round(cssWidth * RENDER_SCALE));
      let h = Math.max(1, Math.round(cssHeight * RENDER_SCALE));
      if (w * h > MAX_PIXELS) {
        const k = Math.sqrt(MAX_PIXELS / (w * h));
        w = Math.max(1, Math.round(w * k));
        h = Math.max(1, Math.round(h * k));
      }
      if (w === width && h === height) return false;
      width = w;
      height = h;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
      return true;
    };

    const draw = () => {
      resize();
      gl.uniform1f(uTime, clock);
      gl.uniform1f(uSweep, sweep);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      shown = true;
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (last === 0) last = now;
      const elapsed = now - last;
      if (elapsed < FRAME_MS * 0.9) return;
      last = now;
      // A stalled frame should not make the field jump.
      clock += Math.min(elapsed, 100) / 1000;
      draw();
    };

    const pause = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
    };

    // The editor window keeps reporting itself visible when minimized (it
    // runs without background throttling), so focus is the signal that the
    // field is actually being looked at.
    const inFront = () => document.visibilityState !== 'hidden' && document.hasFocus();

    const sync = () => {
      if (!linked || lost || !active) {
        pause();
        return;
      }
      const frozen = still || softwareGl || !!reduceMotion?.matches;
      if (!frozen && inFront()) {
        if (!raf) raf = requestAnimationFrame(frame);
        return;
      }
      pause();
      // In the background the last frame stays up; a frozen field, or one
      // that has not drawn yet, gets its single frame now.
      if (frozen || !shown) draw();
    };

    const onResize = () => {
      if (linked && !lost && shown && resize()) draw();
    };
    const onLost = (event: Event) => {
      // preventDefault() is what lets the browser restore the context later.
      event.preventDefault();
      lost = true;
      linked = false;
      shown = false;
      pause();
    };
    const onRestored = () => {
      lost = false;
      build();
    };

    document.addEventListener('visibilitychange', sync);
    window.addEventListener('focus', sync);
    window.addEventListener('blur', sync);
    window.addEventListener('resize', onResize);
    reduceMotion?.addEventListener('change', sync);
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);

    apply = sync;
    build();

    return () => {
      disposed = true;
      apply = null;
      pause();
      clearTimeout(linkPoll);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
      window.removeEventListener('blur', sync);
      window.removeEventListener('resize', onResize);
      reduceMotion?.removeEventListener('change', sync);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      // The canvas goes with this component; hand the context back now
      // rather than when it is garbage collected.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  });
</script>

<canvas bind:this={canvas} class="beam-field" class:shown aria-hidden="true"></canvas>

<style>
  .beam-field {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    pointer-events: none;
    opacity: 0;
    transition: opacity 1.6s ease;
  }
  .beam-field.shown { opacity: 1; }
  @media (prefers-reduced-motion: reduce) {
    .beam-field { transition: none; }
  }
</style>
