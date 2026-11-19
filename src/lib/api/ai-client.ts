/**
 * AI API client for shader, sketch and video generation (Claude, Gemini,
 * Gemini Omni video and Luma Ray). The model lists live in ./ai-models.
 */

import { invoke } from '$lib/bridge';
import {
  DEFAULT_CLAUDE_MODEL, DEFAULT_GEMINI_MODEL, DEFAULT_LUMA_MODEL, DEFAULT_OMNI_MODEL,
  geminiThinkingLevel, isLumaAgentsModel, modelLabel, type LumaModel, type OmniModel,
} from './ai-models';

export type { LumaModel, OmniModel } from './ai-models';

const GOOGLE_API = 'https://generativelanguage.googleapis.com/v1beta';

export type AIProvider = 'claude' | 'gemini';
export type GenerationType = 'shader-isf' | 'threejs' | 'p5js';

export interface AIGenerationRequest {
  provider: AIProvider;
  apiKey: string;
  description: string;
  generationType: GenerationType;
  additionalContext?: string;
  model?: string;
}

export interface AIGenerationResult {
  success: boolean;
  code?: string;
  name?: string;
  error?: string;
  metadata?: {
    description?: string;
    inputs?: Array<{
      name: string;
      type: string;
      default?: number | boolean | number[];
      min?: number;
      max?: number;
    }>;
  };
}

// System prompts for each generation type
export const SYSTEM_PROMPTS: Record<GenerationType, string> = {
  'shader-isf': `You are a world-class shader artist creating stunning real-time visual effects for a projection mapping / VJ application called "Ghost Arcade". Users range from beginners to professionals — the shader MUST compile on first try with zero errors and look visually spectacular.

Generate a complete ISF (Interactive Shader Format) fragment shader. Your output is the ONLY thing between the user and a beautiful visual — make it count.

═══ ISF FORMAT (STRICT) ═══

Start with a JSON metadata comment block, then the GLSL code:

/*{
  "DESCRIPTION": "Short description",
  "CREDIT": "AI Generated",
  "ISFVSN": "2.0",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 2.0, "LABEL": "Speed" },
    { "NAME": "scale", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.0, "MAX": 10.0, "LABEL": "Scale" },
    { "NAME": "baseColor", "TYPE": "color", "DEFAULT": [0.5, 0.0, 1.0, 1.0], "LABEL": "Base Color" }
  ]
}*/

INPUT TYPES:
- float: { "NAME": "x", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Label" }
- bool:  { "NAME": "x", "TYPE": "bool", "DEFAULT": true, "LABEL": "Label" }
- color: { "NAME": "x", "TYPE": "color", "DEFAULT": [r, g, b, a], "LABEL": "Label" }
- long (dropdown): { "NAME": "x", "TYPE": "long", "DEFAULT": 0, "VALUES": [0,1,2], "LABELS": ["A","B","C"], "LABEL": "Label" }

═══ BUILT-IN UNIFORMS (DO NOT REDECLARE) ═══

- vec2 RENDERSIZE — output resolution in pixels
- float TIME — seconds since start (use for animation)
- isf_FragNormCoord is NOT reliable — use gl_FragCoord.xy / RENDERSIZE instead

═══ MANDATORY RULES ═══

1. NO #version directive (ISF injects it)
2. NO 'in', 'out', 'layout' keywords — this is WebGL 1.0 / GLSL ES 1.0
3. Output via gl_FragColor = vec4(r, g, b, 1.0); (alpha MUST be 1.0)
4. Add precision header: #ifdef GL_ES\\nprecision highp float;\\n#endif
5. UV coords: vec2 uv = gl_FragCoord.xy / RENDERSIZE;
6. Aspect correction: uv.x *= RENDERSIZE.x / RENDERSIZE.y; (after centering)
7. All float literals MUST have decimal points: 1.0 not 1, 0.5 not .5
8. Loops MUST have constant integer bounds: for(int i = 0; i < 10; i++) — NEVER use variables as loop bounds
9. If you need variable loop counts: for(int i = 0; i < 100; i++) { if(float(i) >= count) break; }
10. Guard ALL divisions: use max(x, 0.001) or add epsilon to denominators
11. Clamp all color outputs to 0.0-1.0 range

═══ VISUAL QUALITY GUIDELINES ═══

- ALWAYS animate with TIME — static shaders are boring
- Use HSV-to-RGB for rich, vibrant color palettes (include the hsv2rgb helper function)
- Add at least one "color" type input so users can customize the palette
- Include a "speed" parameter (always)
- Include 4-6 total parameters for good user control
- Favor smooth organic motion: sin/cos waves, noise, fractals, spirals
- Use smoothstep() for soft transitions, never hard edges
- Center the effect: vec2 p = (uv - 0.5) * 2.0; for centered coordinate space
- Add subtle glow effects: accumulate 1.0/(distance+epsilon) for neon looks
- Layer multiple effects for depth and complexity

═══ PROVEN TECHNIQUES ═══

HSV helper (include when using color):
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

Rotation helper:
vec2 rot(vec2 p, float a) { float c=cos(a),s=sin(a); return vec2(p.x*c-p.y*s, p.x*s+p.y*c); }

Simple noise (no texture lookups):
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }

═══ COMPLETE WORKING EXAMPLE ═══

/*{
  "DESCRIPTION": "Infinite fractal zoom with neon glow",
  "CREDIT": "AI Generated",
  "ISFVSN": "2.0",
  "CATEGORIES": ["Generator", "Fractal"],
  "INPUTS": [
    {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.5, "LABEL": "Speed"},
    {"NAME": "iterations", "TYPE": "float", "MIN": 3.0, "MAX": 12.0, "DEFAULT": 7.0, "LABEL": "Detail"},
    {"NAME": "baseColor", "TYPE": "color", "DEFAULT": [0.5, 0.0, 1.0, 1.0], "LABEL": "Base Color"},
    {"NAME": "glowColor", "TYPE": "color", "DEFAULT": [1.0, 0.5, 0.0, 1.0], "LABEL": "Glow Color"},
    {"NAME": "rotateSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.2, "LABEL": "Rotation"}
  ]
}*/

#ifdef GL_ES
precision highp float;
#endif

vec2 rot(vec2 p, float a) { float c=cos(a),s=sin(a); return vec2(p.x*c-p.y*s, p.x*s+p.y*c); }

void main() {
  vec2 uv = gl_FragCoord.xy / RENDERSIZE;
  vec2 p = (uv - 0.5) * 2.0;
  p.x *= RENDERSIZE.x / RENDERSIZE.y;
  float t = TIME * speed;
  float zoom = pow(2.0, fract(t) * 2.0);
  p *= zoom;
  p = rot(p, TIME * rotateSpeed);
  float d = 1e10;
  float glow = 0.0;
  for (int i = 0; i < 12; i++) {
    if (float(i) >= iterations) break;
    p = abs(p) - 0.5;
    p = rot(p, 0.785 + t * 0.1);
    p *= 1.5 + sin(t * 0.3 + float(i)) * 0.2;
    float shape = length(p) - 2.5;
    d = min(d, abs(shape));
    glow += 0.1 / (0.1 + abs(shape));
  }
  float edge = 1.0 - smoothstep(0.0, 0.05, d);
  vec3 col = baseColor.rgb * edge + glowColor.rgb * glow * 0.15;
  col += baseColor.rgb * 0.05;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}

═══ OUTPUT FORMAT ═══

Return ONLY the complete shader code starting with /*{ and ending with the closing } of main().
No markdown, no explanations, no code fences. Just the raw ISF shader.`,

  'threejs': `You are an elite creative coder building jaw-dropping 3D visuals for "Ghost Arcade" — a professional projection mapping / VJ application. Your creations will be projected onto buildings, shown in nightclubs, and used in live performances. They must be SPECTACULAR.

Generate a complete, self-contained Three.js animation in a single HTML file. It MUST compile and run with zero errors on first try.

═══ TEMPLATE (FOLLOW EXACTLY) ═══

<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; }
    body { overflow: hidden; background: #000; }
    canvas { display: block; width: 100%; height: 100%; }
  </style>
</head>
<body>
  <script type="module">
    // Ghost Arcade injects an importmap that resolves 'three' to a locally
    // bundled copy of Three.js (no CDN fetch, works offline). Don't add
    // your own importmap — the runtime patches it in before your code runs.
    import * as THREE from 'three';

    window.shaderParams = {
      speed: 1.0,
      intensity: 0.7,
      scale: 1.0,
      colorShift: 0.0,
      detail: 0.5
    };

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.035);

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 5;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    // Pixel ratio is forced to 1 by the host — it samples this canvas at
    // its own resolution, so setPixelRatio(devicePixelRatio) would 4x the
    // GPU memory for nothing on a Retina display. Just leave it default.
    document.body.appendChild(renderer.domElement);

    // YOUR SPECTACULAR 3D SCENE HERE

    const clock = new THREE.Clock();
    function animate() {
      requestAnimationFrame(animate);
      const t = clock.getElapsedTime() * window.shaderParams.speed;
      // YOUR ANIMATION LOGIC
      renderer.render(scene, camera);
    }
    animate();

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  </script>
</body>
</html>

═══ VISUAL QUALITY REQUIREMENTS ═══

You MUST create something visually stunning. Here's what separates good from GREAT:

GEOMETRY & MOTION:
- Use 200-2000 objects for density and visual richness
- Animate EVERYTHING — position, rotation, scale, color should all evolve with time
- Use InstancedMesh for large particle/object counts (critical for performance)
- Organic motion: combine sin/cos at different frequencies, use noise-like patterns
- Camera should slowly orbit, drift, or breathe — never static
- Use groups to create hierarchical motion (rotate group + rotate children = complex paths)

MATERIALS & LIGHTING:
- MeshBasicMaterial or MeshPhongMaterial preferred (always works, no light issues)
- Use emissive colors for self-illumination: new THREE.MeshPhongMaterial({ emissive: 0xff00ff, emissiveIntensity: 0.8 })
- Multiple colored point lights that move and pulse create atmosphere
- Use THREE.AdditiveBlending for glow/energy effects on particles
- Use wireframe: true for geometric/cyberpunk aesthetics
- Use transparent materials with varying opacity for depth

POST-PROCESSING IDEAS (without imports):
- Fake glow: overlay slightly scaled-up transparent copies of key geometry
- Fake trails: don't clear background (renderer.autoClear = false) + draw fading overlay
- Use fog (scene.fog) for depth atmosphere

COLOR PALETTES (use these for pro results):
- Synthwave: #ff00ff, #00ffff, #ff6600, #0066ff
- Neon: #39FF14, #FF073A, #00F0FF, #FFE600
- Deep space: #1a0533, #4400aa, #ff3366, #00ffaa
- Fire: #ff4400, #ff8800, #ffcc00, #220800

═══ PROVEN SPECTACULAR PATTERNS ═══

1. PARTICLE GALAXY: 2000 InstancedMesh spheres in spiral arms, each orbiting with sin/cos, HSL color based on angle+radius, slight camera orbit
2. INFINITE TUNNEL: 50 ring geometries receding into z-depth, each rotating differently, neon edges, camera inside
3. MORPHING POLYHEDRA: IcosahedronGeometry with vertices displaced by time-varying noise, wireframe + solid overlay, pulsing emissive
4. CRYSTAL FIELD: 100+ OctahedronGeometry scattered, slowly rotating, refractive-look materials, colored lights sweeping through
5. ENERGY VORTEX: TorusKnotGeometry with animated vertex positions, particles spiraling around it, additive blending
6. DNA HELIX: Two interleaving spirals of spheres, connected by line segments, rotating, color cycling
7. FRACTAL TREE: Recursive branching cylinders, growing/breathing animation, bioluminescent colors

═══ MANDATORY RULES ═══

- Always use 'const' or 'let', NEVER 'var'
- Use THREE.Clock() for timing
- Include 4-6 parameters in window.shaderParams
- window.shaderParams must be ONE flat object literal of plain numbers and booleans (no nested objects, arrays, negative numbers or hex values): the app reads that literal to build the sliders. Read window.shaderParams inside the animation loop every frame, never copy values out once, so slider moves take effect
- For audio reactivity read window.ghostAudio inside the loop: level, bass, mid, treble, high, beat, beatPhase, kick and snare run 0 to 1, bpm is the tempo. Guard with (window.ghostAudio || {}) and keep some idle motion, because every value is 0 when no audio is playing
- NEVER import from subpaths (no 'three/examples/...') — only use core Three.js
- Keep draw calls under 2000 for smooth 60fps
- Use InstancedMesh when creating >50 similar objects
- Test math mentally — no NaN, no division by zero
- Black background always (this is for projection)

═══ OUTPUT ═══

Return ONLY the complete HTML. No markdown, no code fences, no explanations.`,

  'p5js': `You are a generative artist who writes p5.js sketches for "Ghost Arcade", a projection mapping and VJ application. Your sketches play on big screens in clubs, festivals and installations, run for hours, and sit in a stack of layers with effects on top.

Write ONE complete, self-contained HTML file that runs on the first try.

═══ WHAT P5 IS FOR ═══

p5 makes the FORM. Ghost Arcade does the TREATMENT.

Ghost Arcade already has GPU effects for glow, bloom, blur, feedback, mirroring, kaleidoscopes, color grading and blend modes. Do not fake those in p5 (no shadowBlur glow, no drawingContext.filter, no full-screen pixel loops). Spend the sketch on what a fragment shader cannot do well:

- Agents with memory: flocks, boids, ants, slime trails, walkers that remember where they have been.
- Strokes and line quality: flow-field pen strokes, hatching, contour lines, ribbons, calligraphic width.
- Typography: words broken into letters that move, stack, scatter and re-form.
- Recursion: branching trees, subdivision, L-systems, fractal growth that unfolds over time.
- Accumulation: let marks build up over seconds by fading slowly instead of clearing.
- Systems with rules: circle packing, differential growth, cellular automata, tiling (Truchet, Wang), physics, springs.

Pick ONE strong idea and execute it with care. Restraint reads better at scale than everything at once. Prefer a considered palette of two to four colors over rainbow cycling, and give the piece a slow evolution so it still surprises after five minutes.

═══ TEMPLATE (FOLLOW THIS STRUCTURE) ═══

<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <!-- Lets Ghost Arcade keep this page's alpha when Transparent is on. -->
  <meta name="ghost-arcade-background" content="transparent">
  <style>
    html, body { margin: 0; height: 100%; overflow: hidden; background: #000; }
    canvas { display: block; }
  </style>
  <!-- Ghost Arcade loads its own copy of p5; this tag lets the file also run in a browser. -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.11.0/p5.min.js"></script>
</head>
<body>
<script>
  // Starting values: ONE flat object literal of plain values.
  window.shaderParams = {
    speed: 1,
    density: 0.5,
    hue: 0.6,
    transparent: false
  };

  // The controls Ghost Arcade shows. Plain data only, no expressions.
  window.shaderParamDefs = [
    { name: 'speed', label: 'Speed', type: 'number', min: 0, max: 3, default: 1 },
    { name: 'density', label: 'Density', type: 'number', min: 0, max: 1, default: 0.5 },
    { name: 'hue', label: 'Hue', type: 'number', min: 0, max: 1, default: 0.6 },
    { name: 'transparent', label: 'Transparent', type: 'boolean', default: false }
  ];

  const P = (name, fallback) => {
    const v = (window.shaderParams || {})[name];
    return typeof v === 'number' ? v : fallback;
  };
  const A = () => window.ghostAudio || {};

  // A beat hit: the rising edge of a kick or beat while audio plays, or a
  // steady 120 BPM pulse when nothing plays, so the piece always moves.
  let lastBeat = 0, idleClock = 0;
  function hit(dt) {
    const a = A();
    if (a.active) {
      const b = Math.max(a.beat || 0, a.kick || 0);
      const rose = b > 0.6 && lastBeat <= 0.6;
      lastBeat = b;
      return rose;
    }
    idleClock += dt;
    if (idleClock >= 0.5) { idleClock -= 0.5; return true; }
    return false;
  }
  // Clear or fade the frame. With Transparent on it fades to clear instead of
  // black, so the marks float over the layers below. Use 1 for a full clear.
  // Slow fades never quite reach empty: 0.05 or more keeps old marks under 4%.
  function fadeTo(alpha) {
    const ctx = drawingContext;
    const clear = (window.shaderParams || {}).transparent === true;
    ctx.globalCompositeOperation = clear ? 'destination-out' : 'source-over';
    ctx.fillStyle = 'rgba(0,0,0,' + Math.min(1, Math.max(0, alpha)) + ')';
    ctx.fillRect(0, 0, width, height);
    if (!clear) {
      // Keep the frame fully opaque: back anything see-through with black.
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function setup() {
    createCanvas(windowWidth, windowHeight);
    pixelDensity(1);
    // Allocate agents, arrays and grids here, sized from width and height.
  }

  function draw() {
    // Seconds since the last frame, capped so a stall never jumps.
    const dt = Math.min(deltaTime / 1000, 1 / 20) * P('speed', 1);
    fadeTo(0.08);
    // Draw the form here. Read window.shaderParams every frame.
  }

  function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    // Rebuild anything sized from width and height.
  }
</script>
</body>
</html>

═══ CONTROLS ═══

- Give 4 to 7 controls, including speed, one color control (hue or a color) and the transparent switch. Every control must visibly change the piece.
- window.shaderParams is one flat object literal; window.shaderParamDefs is one array literal. Both must be plain data (numbers, strings, booleans, arrays): no Math.PI, no variables, no function calls, no template strings. The app reads these literals to build its controls.
- Control types in shaderParamDefs:
  - number: { name, label, type: 'number', min, max, default }
  - boolean: { name, label, type: 'boolean', default }
  - color: { name, label, type: 'color', default: [r, g, b] } with 0 to 1 channels
  - text: { name, label, type: 'text', default: 'WORDS' } for typography (up to 500 characters)
  - select: { name, label, type: 'select', options: ['Lines', 'Dots'], default: 'Lines' } for modes or palettes
- Read window.shaderParams inside draw() every frame, so moving a control takes effect at once. When a text or select control changes, rebuild what depends on it.

═══ AUDIO ═══

- Read window.ghostAudio inside draw(): level, bass, mid, treble, high, beat, beatPhase, kick and snare run 0 to 1, bpm is the tempo, active is true while audio plays.
- Every value is 0 when nothing plays, so the piece must still move on its own.
- Use hit(dt) for events (spawn a branch, flip tiles, burst a flock). Use continuous values like bass for size, speed or line weight, eased so they never flicker.
- Add a react control (number, 0 to 2) that scales how strongly audio drives the piece.
═══ PERFORMANCE (IT MUST HOLD 60 FPS AT 1920x1080) ═══

- pixelDensity(1) always.
- Allocate in setup(); reuse and recycle in draw(). No new arrays, objects or createGraphics() per frame.
- Neighbor searches over more than a few hundred agents need a spatial grid, never an all-pairs loop.
- Budget: a few thousand short lines or a few hundred filled shapes per frame. Batch strokes that share a style into one beginShape()/endShape() or one Path2D on drawingContext.
- No shadowBlur, drawingContext.filter, loadPixels() or get() at full resolution in draw(). Leave glow and blur to Ghost Arcade's effects.
- Time with deltaTime (as in the template), not frameCount, so motion keeps its speed when the frame rate changes.
- Text: use textFont() with common system fonts (e.g. 'Helvetica', 'Arial', 'Georgia', 'Courier New'); measure with textWidth(). Never loadFont(), loadImage() or fetch anything: the page runs offline.

═══ LOOK ═══

- Black ground and bright marks: the layer is usually blended with Add or Screen, and black disappears. Transparent mode lets the marks sit over anything.
- Use alpha and line weight for depth instead of more objects.
- Center the composition and fill the frame at any aspect ratio, from a 16:9 screen to a tall LED strip.
- No mouse, keyboard or DOM interface: nobody touches a projection.

═══ ONLY WHEN THE USER ASKS FOR A SHADER ═══

For a pure per-pixel effect (plasma, raymarching, a noise field), write one fullscreen p5 WEBGL fragment shader instead:
- Assign the fragment source to a const named frag and the vertex source to a const named vert, each as a plain template string with no embedded expressions.
- Name each uniform exactly like its control (uniform float hue; for the hue control). Use uniform float time; and uniform vec2 resolution;. For audio use uniform float audioLevel, audioBass, audioMid, audioHigh and audioBeat.
- Set every uniform from window.shaderParams and window.ghostAudio each frame.
Ghost Arcade Pro then runs that shader natively on the GPU. For everything else, use the 2D canvas approach above: that is where p5 shines.
═══ MANDATORY ═══

- let/const only, no var.
- No external resources other than the p5 script tag.
- No console spam, no alert(), no errors in setup() or draw().
- Test the math in your head: no NaN, no division by zero, no unbounded growth in arrays.

═══ OUTPUT ═══

Return ONLY the complete HTML. No markdown, no code fences, no explanations.`
};

/** A reply's text, and whether it stopped at the token limit before it was finished. */
export interface AIReply {
  text: string;
  truncated: boolean;
}

/**
 * A failed request as a sentence the user can act on: which key or model is
 * the problem and what to do, followed by the provider's own message.
 */
export function describeAPIError(service: string, status: number, apiMessage: string | undefined, model?: string): string {
  const name = model ? modelLabel(model) : service;
  let advice: string;
  if (status === 401) advice = `The ${service} API key was not accepted. Check it in Settings > AI.`;
  else if (status === 402) advice = `The ${service} account has run out of credit.`;
  else if (status === 403) advice = `This ${service} API key is not allowed to use ${name}. The account may need billing turned on.`;
  else if (status === 404) advice = `${name} is not available to this API key or has been retired. Choose another model in Settings > AI.`;
  else if (status === 410) advice = `${name} has been retired. Choose another model in Settings > AI.`;
  else if (status === 429) advice = `${service} rate limit or quota reached. Wait a minute and try again.`;
  else if (status >= 500) advice = `${service} is busy or having problems (${status}). Try again shortly.`;
  else advice = `${service} rejected the request (${status}).`;
  const detail = apiMessage?.trim();
  return detail ? `${advice} ${service} says: ${detail}` : advice;
}

async function callClaude(apiKey: string, systemPrompt: string, userPrompt: string, model: string = DEFAULT_CLAUDE_MODEL, maxTokens = 50000): Promise<AIReply> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt }
      ]
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(describeAPIError('Claude', response.status, errorData.error?.message, model));
  }

  const data = await response.json();
  // A safety decline is a normal 200 reply with no answer in it.
  if (data.stop_reason === 'refusal') {
    throw new Error(`${modelLabel(model)} declined this request. Try describing it another way.`);
  }
  // Current models think first, so the reply is every text block, not the first block.
  const blocks: Array<{ type?: string; text?: string }> = Array.isArray(data.content) ? data.content : [];
  return {
    text: blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join(''),
    truncated: data.stop_reason === 'max_tokens',
  };
}

/**
 * Call Gemini API (Google). Thinking counts toward maxOutputTokens, so the
 * limit leaves room for it.
 */
async function callGemini(apiKey: string, systemPrompt: string, userPrompt: string, model: string = DEFAULT_GEMINI_MODEL, maxTokens = 32768): Promise<AIReply> {
  const thinkingLevel = geminiThinkingLevel(model);
  const response = await fetch(`${GOOGLE_API}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [
        {
          parts: [{ text: userPrompt }]
        }
      ],
      generationConfig: {
        maxOutputTokens: maxTokens,
        ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
      }
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(describeAPIError('Gemini', response.status, errorData.error?.message, model));
  }

  const data = await response.json();
  const blocked = data.promptFeedback?.blockReason;
  if (blocked) throw new Error(`Gemini blocked this request (${blocked}). Try describing it another way.`);
  const candidate = data.candidates?.[0];
  const parts: Array<{ text?: string; thought?: boolean }> = candidate?.content?.parts ?? [];
  return {
    text: parts.filter((p) => !p.thought).map((p) => p.text ?? '').join(''),
    truncated: candidate?.finishReason === 'MAX_TOKENS',
  };
}

/**
 * Extract code from AI response (handles markdown code blocks)
 */
function extractCode(response: string, type: GenerationType): string {
  // Remove markdown code blocks if present
  let code = response.trim();

  // Check for code blocks
  const codeBlockMatch = code.match(/```(?:html|glsl|javascript|js)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    code = codeBlockMatch[1].trim();
  }

  // For ISF shaders, ensure it starts with the metadata block
  if (type === 'shader-isf' && !code.startsWith('/*{')) {
    // Try to find the ISF metadata block
    const isfMatch = code.match(/(\/\*\{[\s\S]*?\}\*\/[\s\S]*)/);
    if (isfMatch) {
      code = isfMatch[1];
    }
  }

  // For HTML types, ensure it starts with DOCTYPE or html
  if ((type === 'threejs' || type === 'p5js') && !code.toLowerCase().startsWith('<!doctype') && !code.toLowerCase().startsWith('<html')) {
    const htmlMatch = code.match(/(<!DOCTYPE[\s\S]*|<html[\s\S]*)/i);
    if (htmlMatch) {
      code = htmlMatch[1];
    }
  }

  return code;
}

/**
 * Extract name from shader metadata or description
 */
function extractName(code: string, description: string, type: GenerationType): string {
  if (type === 'shader-isf') {
    // Try to extract from ISF metadata
    const metaMatch = code.match(/\/\*\{([\s\S]*?)\}\*\//);
    if (metaMatch) {
      try {
        const meta = JSON.parse('{' + metaMatch[1] + '}');
        if (meta.DESCRIPTION) {
          return meta.DESCRIPTION.slice(0, 40);
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  }

  // Fall back to first few words of description
  const words = description.split(' ').slice(0, 4).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Extract ISF metadata inputs
 */
function extractISFInputs(code: string): AIGenerationResult['metadata'] {
  const metaMatch = code.match(/\/\*\{([\s\S]*?)\}\*\//);
  if (!metaMatch) return undefined;

  try {
    const meta = JSON.parse('{' + metaMatch[1] + '}');
    return {
      description: meta.DESCRIPTION,
      inputs: meta.INPUTS?.map((input: Record<string, unknown>) => ({
        name: input.NAME,
        type: input.TYPE,
        default: input.DEFAULT,
        min: input.MIN,
        max: input.MAX
      }))
    };
  } catch (e) {
    return undefined;
  }
}

/** "numParticles", "num_particles" and "NUM_PARTICLES" all read "Num Particles". */
export function paramLabel(name: string): string {
  const constant = name === name.toUpperCase();
  return name
    .replace(/_+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .map((word) => {
      const w = constant ? word.toLowerCase() : word;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

/**
 * Extract JS animation parameters from window.shaderParams object
 * Returns an array of parameter definitions compatible with JSAnimationSource.params
 */
export function extractJSParams(code: string): Array<{
  name: string;
  type: 'number' | 'boolean' | 'color';
  default: number | boolean | number[];
  min?: number;
  max?: number;
  label?: string;
}> | undefined {
  // Look for window.shaderParams = { ... } pattern
  const paramsMatch = code.match(/window\.shaderParams\s*=\s*\{([^}]+)\}/);
  if (!paramsMatch) return undefined;

  try {
    const paramsBlock = paramsMatch[1];
    const params: Array<{
      name: string;
      type: 'number' | 'boolean' | 'color';
      default: number | boolean | number[];
      min?: number;
      max?: number;
      label?: string;
    }> = [];

    // Parse each parameter: name: value or name: value, // comment with range
    const paramRegex = /(\w+)\s*:\s*([\d.]+|true|false)(?:\s*,?\s*\/\/\s*(?:min:\s*([\d.]+))?\s*(?:max:\s*([\d.]+))?)?/g;
    let match;

    while ((match = paramRegex.exec(paramsBlock)) !== null) {
      const name = match[1];
      const valueStr = match[2];
      const minStr = match[3];
      const maxStr = match[4];

      // Determine type from value
      let type: 'number' | 'boolean' | 'color';
      let defaultValue: number | boolean;

      if (valueStr === 'true' || valueStr === 'false') {
        type = 'boolean';
        defaultValue = valueStr === 'true';
      } else {
        type = 'number';
        defaultValue = parseFloat(valueStr);
      }

      // Infer reasonable min/max if not specified
      let min = minStr ? parseFloat(minStr) : undefined;
      let max = maxStr ? parseFloat(maxStr) : undefined;

      if (type === 'number' && min === undefined) {
        // Infer ranges based on common parameter names and values
        const nameLower = name.toLowerCase();
        if (nameLower.includes('speed') || nameLower.includes('rate')) {
          min = 0;
          max = (defaultValue as number) * 3 || 5;
        } else if (nameLower.includes('count') || nameLower.includes('num') || nameLower.includes('amount')) {
          min = 1;
          max = Math.max((defaultValue as number) * 3, 200);
        } else if (nameLower.includes('size') || nameLower.includes('scale') || nameLower.includes('radius')) {
          min = 0.1;
          max = (defaultValue as number) * 3 || 50;
        } else if (nameLower.includes('hue') || nameLower.includes('saturation') || nameLower.includes('brightness') || nameLower.includes('alpha') || nameLower.includes('opacity')) {
          min = 0;
          max = 1;
        } else if (nameLower.includes('angle') || nameLower.includes('rotation')) {
          min = 0;
          max = Math.PI * 2;
        } else {
          // Generic defaults based on value
          if ((defaultValue as number) <= 1) {
            min = 0;
            max = 1;
          } else if ((defaultValue as number) <= 10) {
            min = 0;
            max = (defaultValue as number) * 2;
          } else {
            min = 0;
            max = (defaultValue as number) * 2;
          }
        }
      }

      // The range always holds the starting value: a sketch's `hue = 200`
      // is in degrees, not the 0–1 the name suggests.
      if (type === 'number' && max !== undefined && (defaultValue as number) > max) {
        max = (defaultValue as number) * 2;
      }

      params.push({
        name,
        type,
        default: defaultValue,
        min,
        max,
        label: paramLabel(name)
      });
    }

    return params.length > 0 ? params : undefined;
  } catch (e) {
    return undefined;
  }
}

export interface AICompletionRequest {
  provider: AIProvider;
  apiKey: string;
  model?: string;
  system: string;
  prompt: string;
  maxTokens?: number;
}

/**
 * One reply from the user's chosen provider, as plain text. For features that
 * write their own prompts, such as the sketch editor's learning actions.
 * `truncated` is set when the reply hit the token limit before it finished.
 */
export async function completeWithAI(request: AICompletionRequest): Promise<AIReply> {
  const { provider, apiKey, model, system, prompt, maxTokens = 16000 } = request;
  if (!apiKey) throw new Error('API key is required');
  return provider === 'claude'
    ? callClaude(apiKey, system, prompt, model || undefined, maxTokens)
    : callGemini(apiKey, system, prompt, model || undefined, maxTokens);
}

/**
 * Main generation function
 */
export async function generateWithAI(request: AIGenerationRequest): Promise<AIGenerationResult> {
  const { provider, apiKey, description, generationType, additionalContext, model } = request;

  if (!apiKey) {
    return { success: false, error: 'API key is required' };
  }

  if (!description) {
    return { success: false, error: 'Description is required' };
  }

  const systemPrompt = SYSTEM_PROMPTS[generationType];

  // Enhance the user prompt to push for spectacular results
  const typeLabel = generationType === 'shader-isf' ? 'ISF shader' : generationType === 'threejs' ? 'Three.js 3D animation' : 'p5.js generative art piece';
  let userPrompt = `Create a ${typeLabel} for projection mapping / VJ performance based on this description:

"${description}"

Make it VISUALLY SPECTACULAR — this will be projected at large scale in live performances. Prioritize:
- Smooth, hypnotic animation that evolves over time
- Rich, vibrant neon colors on a black background
- Multiple layers of visual complexity
- Professional quality that would impress at a festival or art show
- 4-6 user-controllable parameters including speed and a color control`;

  if (generationType === 'p5js') {
    // p5 is at its best drawing form (agents, strokes, type, recursion,
    // accumulation); glow and colour treatment come from the app's effects.
    userPrompt = `Create a p5.js sketch for projection mapping / VJ performance based on this description:

"${description}"

Lean into what p5.js does best: agents with memory, expressive strokes, typography, recursion, slow accumulation and rule-based systems. Draw the form with care and leave glow, blur and feedback to Ghost Arcade's effects. It must hold 60 fps at 1920x1080, evolve over minutes, and offer 4-7 controls including speed, a color control and the Transparent switch.`;
  }

  if (additionalContext) {
    userPrompt += `\n\nAdditional creative direction: ${additionalContext}`;
  }

  try {
    const reply = provider === 'claude'
      ? await callClaude(apiKey, systemPrompt, userPrompt, model || undefined)
      : await callGemini(apiKey, systemPrompt, userPrompt, model || undefined);

    const code = extractCode(reply.text, generationType);

    if (!code) {
      return {
        success: false,
        error: reply.truncated
          ? 'The reply reached its length limit before the code was finished. Try a simpler description.'
          : 'Failed to extract code from AI response',
      };
    }

    const name = extractName(code, description, generationType);
    // Extract metadata for ISF shaders or JS animations
    let metadata: AIGenerationResult['metadata'] | undefined;
    if (generationType === 'shader-isf') {
      metadata = extractISFInputs(code);
    } else if (generationType === 'threejs' || generationType === 'p5js') {
      // For JS animations, wrap the params array in metadata format
      const jsParams = extractJSParams(code);
      if (jsParams) {
        metadata = { inputs: jsParams };
      }
    }

    return {
      success: true,
      code,
      name,
      metadata
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

/** Check whether the chosen model is visible to this key, without paying for a request. */
export async function validateAPIKey(provider: AIProvider, apiKey: string, model?: string): Promise<boolean> {
  try {
    if (provider === 'claude') {
      const id = encodeURIComponent(model || DEFAULT_CLAUDE_MODEL);
      const response = await fetch(`https://api.anthropic.com/v1/models/${id}`, {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
      });
      return response.ok;
    }
    const id = encodeURIComponent(model || DEFAULT_GEMINI_MODEL);
    const response = await fetch(`${GOOGLE_API}/models/${id}`, { headers: { 'x-goog-api-key': apiKey } });
    if (!response.ok) return false;
    const data = await response.json().catch(() => ({}));
    return Array.isArray(data.supportedGenerationMethods) && data.supportedGenerationMethods.includes('generateContent');
  } catch {
    return false;
  }
}

// ─── Shared polling helpers ──────────────────────────────────────────────

/** Resolves after `ms`, or rejects at once when the signal aborts. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/** What a video job shows while it runs (a table, so the language packs translate it). */
const VIDEO_STATUS_MESSAGES = {
  omniGenerating: 'Generating with Gemini Omni… this can take a few minutes',
  omniWaiting: 'Waiting for the Gemini Omni video file…',
  lumaSubmitting: 'Submitting to Luma…',
  lumaQueued: 'Waiting in the Luma queue…',
  lumaDreaming: 'Luma is making your video…',
  downloading: 'Downloading video…',
};

/** Progress for a video job, shown to the user as it runs. */
export type VideoJobStatus = (message: string) => void;

export interface VideoJobOptions {
  signal?: AbortSignal;
  onStatus?: VideoJobStatus;
  /** Give up after this long. Default 15 minutes. */
  timeoutMs?: number;
  /** Time between status checks. */
  pollMs?: number;
}

// ─── Gemini Omni video ──────────────────────────────────────────────────
// Google retired the Veo preview models on the Gemini API; Gemini Omni
// replaces them. One POST to /interactions makes the video, and with
// delivery "uri" the reply names a file to wait for and download.

export type OmniAspectRatio = '16:9' | '9:16';

export interface OmniVideoRequest {
  apiKey: string;
  prompt: string;
  model?: OmniModel;
  aspectRatio?: OmniAspectRatio;
  /** Whole seconds. Omni takes 3 to 15; with a last frame, 3 to 10. */
  durationSeconds?: number;
  /** Things to keep out of the video. Omni has no separate field, so it goes in the prompt. */
  avoid?: string;
  firstFrame?: Blob;
  lastFrame?: Blob;
}

export interface OmniVideoStart {
  /** The file to wait for, from a "uri" delivery. */
  fileId?: string;
  /** The finished video, when it came back inline. */
  blob?: Blob;
  /** An interaction still running, to check on until it finishes. */
  interactionId?: string;
  error?: string;
}

async function omniImagePart(blob: Blob): Promise<{ type: 'image'; mime_type: string; data: string }> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return { type: 'image', mime_type: blob.type || 'image/png', data: btoa(binary) };
}

/** The file id in a Gemini file URL. Only Google's own API host is accepted, since the key goes with it. */
export function omniFileId(uri: unknown): string | undefined {
  if (typeof uri !== 'string') return undefined;
  const match = /^(?:https:\/\/generativelanguage\.googleapis\.com\/v1beta\/)?files\/([a-z0-9][a-z0-9-]*)(?::download)?(?:\?.*)?$/i.exec(uri);
  return match?.[1];
}

function base64ToBlob(data: string, type: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: type.startsWith('video/') ? type : 'video/mp4' });
}

/** The video in an interaction, whether REST (`steps`) or the SDK's `output_video` shape. */
function readOmniInteraction(data: Record<string, any>): OmniVideoStart {
  const parts: Array<Record<string, any>> = (Array.isArray(data.steps) ? data.steps : [])
    .filter((step: Record<string, any>) => step?.type === 'model_output')
    .flatMap((step: Record<string, any>) => (Array.isArray(step.content) ? step.content : []));
  if (data.output_video) parts.push({ type: 'video', ...data.output_video });
  const video = parts.find((part) => part?.type === 'video' && (part.uri || part.data));
  if (video?.uri) {
    const fileId = omniFileId(video.uri);
    return fileId ? { fileId } : { error: 'Gemini Omni returned a video link this app does not recognise.' };
  }
  if (video?.data) return { blob: base64ToBlob(video.data, video.mime_type ?? 'video/mp4') };
  if (data.status === 'failed' || data.status === 'cancelled') {
    return { error: data.error?.message || 'Gemini Omni could not make this video. Try another prompt.' };
  }
  if (data.id && data.status && data.status !== 'completed') return { interactionId: String(data.id) };
  return { error: 'Gemini Omni finished without a video. Try another prompt.' };
}

/** Ask Gemini Omni for a video. Returns the file to wait for, or the video itself. */
export async function startOmniVideo(request: OmniVideoRequest, signal?: AbortSignal): Promise<OmniVideoStart> {
  const { apiKey, prompt, model = DEFAULT_OMNI_MODEL, aspectRatio = '16:9', avoid, firstFrame, lastFrame } = request;
  if (lastFrame && !firstFrame) return { error: 'Add a first frame before adding a last frame.' };
  const longest = lastFrame ? 10 : 15;
  const durationSeconds = Math.min(longest, Math.max(3, Math.round(request.durationSeconds ?? 8)));

  let text = prompt.trim();
  if (lastFrame) text = `Start on the first image and end on the second image. ${text}`;
  else if (firstFrame) text = `Start on this image. ${text}`;
  if (avoid?.trim()) text += `\nAvoid: ${avoid.trim()}`;

  try {
    const frames = await Promise.all([firstFrame, lastFrame].filter((f): f is Blob => !!f).map(omniImagePart));
    const response = await fetch(`${GOOGLE_API}/interactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        model,
        input: frames.length ? [...frames, { type: 'text', text }] : text,
        response_format: { type: 'video', aspect_ratio: aspectRatio, duration: `${durationSeconds}s`, delivery: 'uri' },
        background: false,
        stream: false,
      }),
      signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { error: describeAPIError('Gemini', response.status, data.error?.message, model) };
    return readOmniInteraction(data);
  } catch (err) {
    if (isAbortError(err)) throw err;
    return { error: err instanceof Error ? `Could not reach Gemini Omni: ${err.message}` : 'Could not reach Gemini Omni.' };
  }
}

export type OmniFileState = 'processing' | 'ready' | 'failed';

/** Check a Gemini file. A network blip or a 5xx/429 reads as still processing. */
export async function pollOmniFile(apiKey: string, fileId: string, signal?: AbortSignal): Promise<{ state: OmniFileState; error?: string }> {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(fileId)) return { state: 'failed', error: 'Invalid Gemini file id.' };
  try {
    const response = await fetch(`${GOOGLE_API}/files/${fileId}`, { headers: { 'x-goog-api-key': apiKey }, signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) return { state: 'processing' };
      return { state: 'failed', error: describeAPIError('Gemini', response.status, data.error?.message) };
    }
    if (data.state === 'ACTIVE') return { state: 'ready' };
    if (data.state === 'FAILED') return { state: 'failed', error: data.error?.message || 'Google could not finish the video file.' };
    return { state: 'processing' };
  } catch (err) {
    if (isAbortError(err)) throw err;
    return { state: 'processing' };
  }
}

export async function downloadOmniVideo(apiKey: string, fileId: string, signal?: AbortSignal): Promise<{ blob?: Blob; error?: string }> {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(fileId)) return { error: 'Invalid Gemini file id.' };
  try {
    const response = await fetch(`${GOOGLE_API}/files/${fileId}:download?alt=media`, { headers: { 'x-goog-api-key': apiKey }, signal });
    if (!response.ok) return { error: `Could not download the Gemini Omni video (${response.status}).` };
    const blob = await response.blob();
    return { blob: blob.type.startsWith('video/') ? blob : new Blob([blob], { type: 'video/mp4' }) };
  } catch (err) {
    if (isAbortError(err)) throw err;
    return { error: err instanceof Error ? `Could not download the Gemini Omni video: ${err.message}` : 'Could not download the Gemini Omni video.' };
  }
}

async function pollOmniInteraction(apiKey: string, id: string, signal?: AbortSignal): Promise<OmniVideoStart | null> {
  try {
    const response = await fetch(`${GOOGLE_API}/interactions/${encodeURIComponent(id)}`, { headers: { 'x-goog-api-key': apiKey }, signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) return null;
      return { error: describeAPIError('Gemini', response.status, data.error?.message) };
    }
    const result = readOmniInteraction(data);
    return result.interactionId ? null : result;
  } catch (err) {
    if (isAbortError(err)) throw err;
    return null;
  }
}

/**
 * Make a Gemini Omni video from start to finish: submit, wait for the file,
 * download. Throws an AbortError when the signal aborts.
 */
export async function generateOmniVideo(request: OmniVideoRequest, options: VideoJobOptions = {}): Promise<{ blob?: Blob; error?: string }> {
  const { signal, onStatus, timeoutMs = 15 * 60_000, pollMs = 5_000 } = options;
  const deadline = Date.now() + timeoutMs;
  onStatus?.(VIDEO_STATUS_MESSAGES.omniGenerating);
  let result = await startOmniVideo(request, signal);

  while (result.interactionId) {
    if (Date.now() > deadline) return { error: 'Gemini Omni took too long. Try again or choose a shorter video.' };
    await wait(pollMs, signal);
    result = (await pollOmniInteraction(request.apiKey, result.interactionId, signal)) ?? result;
  }
  if (result.error || result.blob) return result;
  const fileId = result.fileId!;

  onStatus?.(VIDEO_STATUS_MESSAGES.omniWaiting);
  for (;;) {
    const file = await pollOmniFile(request.apiKey, fileId, signal);
    if (file.state === 'failed') return { error: file.error };
    if (file.state === 'ready') break;
    if (Date.now() > deadline) return { error: 'Timed out waiting for the Gemini Omni video file.' };
    await wait(pollMs, signal);
  }
  onStatus?.(VIDEO_STATUS_MESSAGES.downloading);
  return downloadOmniVideo(request.apiKey, fileId, signal);
}

// ─── Luma video ─────────────────────────────────────────────────────────
// Ray 3.2 runs on the Luma Agents API (a Luma Agents key). Ray 2 and Ray 2
// Flash run on the older Dream Machine API, which Luma is retiring; they
// stay for keys that only reach it. All Luma calls go through the desktop
// app's http_fetch proxy, since the Luma API sends no CORS headers.

export type LumaAspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9' | '9:21';
export type LumaResolution = '360p' | '540p' | '720p' | '1080p' | '4k';
export type LumaDuration = '5s' | '9s' | '10s';

export interface LumaModelOptions {
  aspectRatios: LumaAspectRatio[];
  resolutions: LumaResolution[];
  durations: LumaDuration[];
  /** Durations a seamless loop may use. */
  loopDurations: LumaDuration[];
}

/** What each Luma model accepts, from Luma's API references. */
export function lumaModelOptions(model: string): LumaModelOptions {
  return isLumaAgentsModel(model)
    ? {
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
      resolutions: ['360p', '540p', '720p', '1080p'],
      durations: ['5s', '10s'],
      loopDurations: ['5s'],
    }
    : {
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21'],
      resolutions: ['540p', '720p', '1080p', '4k'],
      durations: ['5s', '9s'],
      loopDurations: ['5s', '9s'],
    };
}

export interface LumaGenerationRequest {
  apiKey: string;
  prompt: string;
  model?: LumaModel;
  aspectRatio?: LumaAspectRatio;
  duration?: LumaDuration;
  resolution?: LumaResolution;
  loop?: boolean;
}

export interface LumaGenerationStatus {
  id: string;
  state: 'queued' | 'dreaming' | 'completed' | 'failed';
  videoUrl?: string;
  error?: string;
}

const LUMA_AGENTS_API = 'https://agents.lumalabs.ai/v1';
const LUMA_DREAM_MACHINE_API = 'https://api.lumalabs.ai/dream-machine/v1';

function lumaApi(model: string): string {
  return isLumaAgentsModel(model) ? LUMA_AGENTS_API : LUMA_DREAM_MACHINE_API;
}

/** Call the desktop app's http_fetch proxy. Returns the status and the parsed JSON body. */
async function lumaFetch(
  method: string,
  url: string,
  apiKey: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; data: Record<string, any> }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  if (body) headers['Content-Type'] = 'application/json';
  const result = await invoke<{ status: number; body: string; headers: Record<string, string> }>('http_fetch', {
    method,
    url,
    headers,
    body: body ? JSON.stringify(body) : null,
  });
  let data: Record<string, any> = {};
  try { data = JSON.parse(result.body); } catch { /* not JSON */ }
  return { status: result.status, data };
}

/** A failed Luma call as a sentence the user can act on. */
function describeLumaError(status: number, data: Record<string, any>, model: string): string {
  const detail = typeof data.detail === 'string' ? data.detail : data.error?.user_message || data.message;
  if (isLumaAgentsModel(model) && (status === 401 || (status === 400 && /unknown model/i.test(String(detail))))) {
    return `Ray 3.2 needs a Luma Agents API key with Ray 3.2 access (platform.lumalabs.ai). Luma says: ${detail || status}`;
  }
  if (!isLumaAgentsModel(model) && status === 401) {
    return `${modelLabel(model)} needs a Dream Machine API key. Luma says: ${detail || status}`;
  }
  if (status === 402) return `The Luma account has run out of credit. Luma says: ${detail || status}`;
  return describeAPIError('Luma', status, detail, model);
}

export async function startLumaGeneration(request: LumaGenerationRequest): Promise<{ id?: string; error?: string }> {
  const { apiKey, prompt, model = DEFAULT_LUMA_MODEL, aspectRatio = '16:9', duration = '5s', resolution = '720p', loop = false } = request;
  const allowed = lumaModelOptions(model);
  const name = modelLabel(model);
  if (!allowed.aspectRatios.includes(aspectRatio)) return { error: `${name} does not take a ${aspectRatio} picture.` };
  if (!allowed.resolutions.includes(resolution)) return { error: `${name} does not make ${resolution} video.` };
  if (!allowed.durations.includes(duration)) return { error: `${name} does not make ${duration} video.` };
  if (loop && !allowed.loopDurations.includes(duration)) return { error: `${name} loops must be ${allowed.loopDurations.join(' or ')} long.` };

  const body = isLumaAgentsModel(model)
    ? { model, type: 'video', prompt, aspect_ratio: aspectRatio, video: { resolution, duration, ...(loop ? { loop: true } : {}) } }
    : { model, prompt, aspect_ratio: aspectRatio, resolution, duration, loop };
  try {
    const { status, data } = await lumaFetch('POST', `${lumaApi(model)}/generations`, apiKey, body);
    if (status < 200 || status >= 300) return { error: describeLumaError(status, data, model) };
    if (typeof data.id !== 'string' || !data.id) return { error: 'Luma did not return a generation id.' };
    return { id: data.id };
  } catch (err) {
    return { error: err instanceof Error ? `Could not reach Luma: ${err.message}` : 'Could not reach Luma.' };
  }
}

export async function pollLumaGeneration(apiKey: string, generationId: string, model: LumaModel = DEFAULT_LUMA_MODEL): Promise<LumaGenerationStatus> {
  try {
    const { status, data } = await lumaFetch('GET', `${lumaApi(model)}/generations/${encodeURIComponent(generationId)}`, apiKey);
    if (status === 429 || status >= 500) return { id: generationId, state: 'queued' };
    if (status < 200 || status >= 300) return { id: generationId, state: 'failed', error: describeLumaError(status, data, model) };

    const state = String(data.state ?? 'queued');
    if (state === 'completed') {
      const outputs: Array<{ type?: string; url?: string }> = Array.isArray(data.output) ? data.output : [];
      const videoUrl = outputs.find((o) => o.type === 'video' && o.url)?.url || data.assets?.video || data.video?.url;
      return videoUrl
        ? { id: generationId, state: 'completed', videoUrl }
        : { id: generationId, state: 'failed', error: 'Luma finished without a video.' };
    }
    if (state === 'failed') {
      return { id: generationId, state: 'failed', error: data.failure_reason || 'Luma could not make this video.' };
    }
    return { id: generationId, state: state === 'processing' || state === 'dreaming' ? 'dreaming' : 'queued' };
  } catch {
    // A network blip: keep waiting.
    return { id: generationId, state: 'queued' };
  }
}

/** Make a Luma video from start to finish: submit, wait, download. Throws an AbortError when cancelled. */
export async function generateLumaVideo(request: LumaGenerationRequest, options: VideoJobOptions = {}): Promise<{ blob?: Blob; error?: string }> {
  const { signal, onStatus, timeoutMs = 15 * 60_000, pollMs = 5_000 } = options;
  const model = request.model ?? DEFAULT_LUMA_MODEL;
  const deadline = Date.now() + timeoutMs;
  onStatus?.(VIDEO_STATUS_MESSAGES.lumaSubmitting);
  const started = await startLumaGeneration(request);
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (!started.id) return { error: started.error || 'Luma did not start the video.' };

  onStatus?.(VIDEO_STATUS_MESSAGES.lumaQueued);
  for (;;) {
    await wait(pollMs, signal);
    const status = await pollLumaGeneration(request.apiKey, started.id, model);
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (status.state === 'failed') return { error: status.error };
    if (status.state === 'completed' && status.videoUrl) {
      onStatus?.(VIDEO_STATUS_MESSAGES.downloading);
      return downloadLumaVideo(status.videoUrl);
    }
    if (status.state === 'dreaming') onStatus?.(VIDEO_STATUS_MESSAGES.lumaDreaming);
    if (Date.now() > deadline) return { error: 'Luma took too long. Try again later.' };
  }
}

/**
 * Download a Luma-generated video as a Blob.
 * Uses Tauri http_fetch_binary to bypass potential CORS on CDN URLs.
 */
export async function downloadLumaVideo(videoUrl: string): Promise<{ blob?: Blob; error?: string }> {
  try {
    // Try direct fetch first (works if CDN allows CORS)
    try {
      const directResp = await fetch(videoUrl);
      if (directResp.ok) {
        const blob = await directResp.blob();
        const contentType = blob.type || 'video/mp4';
        return { blob: contentType.startsWith('video/') ? blob : new Blob([blob], { type: 'video/mp4' }) };
      }
    } catch {
      // CORS blocked — fall through to proxy
    }

    const result = await invoke<{ status: number; contentType?: string; base64?: string; data?: string; headers?: Record<string, string> }>(
      'http_fetch_binary',
      { url: videoUrl, headers: {} },
    );

    if (result.status < 200 || result.status >= 300) {
      return { error: `Download failed: ${result.status}` };
    }

    // Decode base64 safely — handle potential data URL prefix or padding issues
    let b64 = result.base64 || result.data || '';
    if (!b64) return { error: 'Download failed: empty video payload' };
    if (b64.includes(',')) b64 = b64.split(',')[1]; // Strip data URL prefix if present
    const binaryString = atob(b64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const headerContentType = result.contentType || result.headers?.['content-type'] || result.headers?.['Content-Type'] || '';
    const contentType = headerContentType.startsWith('video/') ? headerContentType : 'video/mp4';
    const blob = new Blob([bytes], { type: contentType });
    return { blob };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network error downloading Luma video' };
  }
}

/** Check a Luma key against the API the chosen model runs on, without making a video. */
export async function validateLumaKey(apiKey: string, model: string = DEFAULT_LUMA_MODEL): Promise<boolean> {
  try {
    const path = isLumaAgentsModel(model) ? '/credits' : '/generations?limit=1';
    const { status } = await lumaFetch('GET', `${lumaApi(model)}${path}`, apiKey);
    return status >= 200 && status < 300;
  } catch {
    return false;
  }
}

/**
 * Enhance a prompt for seamless loop generation.
 * Appends loop-friendly language if not already present.
 */
export function enhancePromptForLoop(prompt: string, hasKeyframes: boolean): string {
  const lowerPrompt = prompt.toLowerCase();
  // Don't double-append if user already mentions looping
  if (lowerPrompt.includes('seamless loop') || lowerPrompt.includes('looping') || lowerPrompt.includes('perfectly looped')) {
    return prompt;
  }

  const loopSuffix = hasKeyframes
    ? '. Create a smooth, seamless animation that transitions naturally from the start frame through dynamic motion and returns gracefully to the end frame.'
    : '. Create a smooth, perfectly seamless loop with continuous cyclic motion where the end flows naturally back into the beginning.';

  return prompt.trim() + loopSuffix;
}
