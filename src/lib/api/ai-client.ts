/**
 * AI API Client for shader/animation generation
 * Supports Claude Opus 4.8 / Sonnet 4.6 and Gemini 3.1+ models.
 */

import { invoke } from '$lib/bridge';

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
const SYSTEM_PROMPTS: Record<GenerationType, string> = {
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
- NEVER import from subpaths (no 'three/examples/...') — only use core Three.js
- Keep draw calls under 2000 for smooth 60fps
- Use InstancedMesh when creating >50 similar objects
- Test math mentally — no NaN, no division by zero
- Black background always (this is for projection)

═══ OUTPUT ═══

Return ONLY the complete HTML. No markdown, no code fences, no explanations.`,

  'p5js': `You are an elite generative artist creating mesmerizing visual experiences for "Ghost Arcade" — a professional projection mapping / VJ application. Your creations will be projected in clubs, festivals, and art installations. Make them UNFORGETTABLE.

Generate a complete, self-contained p5.js sketch in a single HTML file. It MUST run flawlessly on first try.

═══ TEMPLATE (FOLLOW EXACTLY) ═══

<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; }
    body { overflow: hidden; background: #000; }
    canvas { display: block; }
  </style>
  <!-- p5.js is injected by Ghost Arcade from a local bundle when your
       HTML references p5. You can leave this CDN tag in if you want the
       file to also work standalone in a browser; the runtime preserves
       it but loads the local copy first so there's no network fetch. -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js"></script>
</head>
<body>
  <script>
    window.shaderParams = {
      speed: 1.0,
      scale: 1.0,
      intensity: 0.7,
      colorShift: 0.0,
      complexity: 0.5
    };

    // Global state
    let particles = [];

    function setup() {
      createCanvas(windowWidth, windowHeight);
      colorMode(HSB, 360, 100, 100, 100);
      // Initialize
    }

    function draw() {
      background(0, 15); // Trail fade
      // SPECTACULAR VISUALS HERE
    }

    function windowResized() {
      resizeCanvas(windowWidth, windowHeight);
    }
  </script>
</body>
</html>

═══ VISUAL QUALITY REQUIREMENTS ═══

You MUST create something that looks professional and mesmerizing:

MOTION & FLOW:
- Use background(0, 10-25) for motion trails (NEVER background(0) — trails look 10x better)
- Use noise() extensively: noise(x*0.003, y*0.003, frameCount*0.005) for organic flow
- Layer multiple animation speeds: slow drift + medium oscillation + fast sparkle
- Use translate(width/2, height/2) to center compositions
- Rotate entire compositions slowly: rotate(frameCount * 0.001)

COLOR MASTERY:
- Always use colorMode(HSB, 360, 100, 100, 100)
- Cycle hues over time: (frameCount * 0.5 + i * 10) % 360
- Use high saturation (80-100) and brightness (80-100) for vivid neon colors
- Add colorShift parameter: hue = (baseHue + window.shaderParams.colorShift * 360) % 360
- Layer translucent colors for depth: fill(hue, 90, 95, 30)

PARTICLE SYSTEMS (200-500 particles):
- Give each particle: x, y, vx, vy, size, hue, life
- Apply forces: gravity, attraction/repulsion, noise-based flow fields
- Respawn dead particles instead of creating new ones
- Vary size: lerp(2, 15, noise(i * 0.1, frameCount * 0.01))
- Draw with blendMode(ADD) for energy/glow effects

═══ PROVEN SPECTACULAR PATTERNS ═══

1. FLOW FIELD: 400 particles following Perlin noise vectors, rainbow hue based on angle, trails create aurora effect
2. ATTRACTOR SYSTEM: Particles orbiting 2-3 moving attractor points, gravitational pull, neon streaks
3. SACRED GEOMETRY: Rotating overlapping circles/polygons, golden ratio spacing, pulsing opacity, mandala-like
4. WAVE INTERFERENCE: Multiple sin waves overlapping, draw lines between wave peaks, moiré patterns
5. PARTICLE EXPLOSION: Burst from center on timer, radial velocity + gravity + noise displacement, color by velocity
6. FRACTAL SPIRAL: Recursive spiral arms with decreasing scale, each node spawns children, Fibonacci angles
7. LIQUID SIMULATION: Grid of points connected by lines, displaced by layered noise, surface tension physics
8. CONSTELLATION MAP: Random stars connected when close, slow drift, twinkle with noise, shooting stars

═══ MANDATORY RULES ═══

- Declare variables with 'let' or 'const'
- Initialize arrays in setup(), NOT globally
- Use frameCount for timing (not millis())
- Keep particle count under 500 for 60fps
- NEVER create objects in draw() — reuse and recycle
- Use push()/pop() for ALL coordinate transforms
- Include 4-6 parameters in window.shaderParams
- Black background always (projection mapping)

═══ OUTPUT ═══

Return ONLY the complete HTML. No markdown, no code fences, no explanations.`
};

/**
 * Call Claude API (Anthropic)
 */
async function callClaude(apiKey: string, systemPrompt: string, userPrompt: string, model: string = 'claude-sonnet-4-6'): Promise<string> {
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
      max_tokens: 50000,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt }
      ]
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Claude API error: ${response.status}`);
  }

  const data = await response.json();
  return data.content[0]?.text || '';
}

/**
 * Call Gemini API (Google)
 */
async function callGemini(apiKey: string, systemPrompt: string, userPrompt: string, model: string = 'gemini-3.5-flash'): Promise<string> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
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
        maxOutputTokens: 8192,
        temperature: 0.7
      }
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
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

      // Create human-readable label from camelCase name
      const label = name.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());

      params.push({
        name,
        type,
        default: defaultValue,
        min,
        max,
        label
      });
    }

    return params.length > 0 ? params : undefined;
  } catch (e) {
    return undefined;
  }
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

  if (additionalContext) {
    userPrompt += `\n\nAdditional creative direction: ${additionalContext}`;
  }

  try {
    let response: string;

    if (provider === 'claude') {
      response = await callClaude(apiKey, systemPrompt, userPrompt, model);
    } else {
      response = await callGemini(apiKey, systemPrompt, userPrompt, model);
    }

    const code = extractCode(response, generationType);

    if (!code) {
      return { success: false, error: 'Failed to extract code from AI response' };
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

// ─── Veo Video Generation ───────────────────────────────────────────────

export type VeoModel =
  | 'veo-3.1-generate-preview'
  | 'veo-3.1-fast-generate-preview'
  | 'veo-3.1-lite-generate-preview'
  | 'veo-2.0-generate-001';

export interface VeoGenerationRequest {
  apiKey: string;
  prompt: string;
  model?: VeoModel;
  aspectRatio?: '16:9' | '9:16';
  durationSeconds?: 4 | 6 | 8;
  negativePrompt?: string;
  firstFrame?: Blob;
  lastFrame?: Blob;
}

export interface VeoGenerationStatus {
  done: boolean;
  operationName: string;
  videoUri?: string;
  error?: string;
}

/**
 * Start a Veo video generation job.
 * Returns the operation name for polling.
 */
type VeoImageEncoding = {
  mimeType: string;
  data: string;
};

type VeoImagePayloadStyle = 'bytes' | 'inline';

async function blobToVeoImageEncoding(blob: Blob): Promise<VeoImageEncoding> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read image.'));
    reader.readAsDataURL(blob);
  });
  const match = dataUrl.match(/^data:([^;,]+);base64,(.*)$/);
  if (!match) throw new Error('Failed to encode image for Veo.');
  return {
    mimeType: blob.type || match[1] || 'image/jpeg',
    data: match[2],
  };
}

function veoImagePayload(
  image: VeoImageEncoding,
  style: VeoImagePayloadStyle,
): { bytesBase64Encoded: string; mimeType: string } | { inlineData: { mimeType: string; data: string } } {
  if (style === 'inline') {
    return {
      inlineData: {
        mimeType: image.mimeType,
        data: image.data,
      },
    };
  }
  return {
    bytesBase64Encoded: image.data,
    mimeType: image.mimeType,
  };
}

export async function startVeoGeneration(request: VeoGenerationRequest): Promise<{ operationName?: string; error?: string }> {
  const {
    apiKey,
    prompt,
    model = 'veo-3.1-generate-preview',
    aspectRatio = '16:9',
    durationSeconds = 8,
    negativePrompt,
    firstFrame,
    lastFrame,
  } = request;

  if (lastFrame && !firstFrame) {
    return { error: 'Veo last-frame generation requires a first frame too.' };
  }
  if (lastFrame && !String(model).startsWith('veo-3.1')) {
    return { error: 'Veo first/last frame generation requires a Veo 3.1 model.' };
  }

  const params: Record<string, unknown> = {
    aspectRatio,
    durationSeconds: lastFrame ? 8 : durationSeconds,
  };
  if (negativePrompt) {
    params.negativePrompt = negativePrompt;
  }

  try {
    const firstImage = firstFrame ? await blobToVeoImageEncoding(firstFrame) : null;
    const lastImage = lastFrame ? await blobToVeoImageEncoding(lastFrame) : null;

    const postGenerationRequest = async (imagePayloadStyle: VeoImagePayloadStyle) => {
      const instance: Record<string, unknown> = { prompt };
      if (firstImage) instance.image = veoImagePayload(firstImage, imagePayloadStyle);
      if (lastImage) instance.lastFrame = veoImagePayload(lastImage, imagePayloadStyle);

      return fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            instances: [instance],
            parameters: params,
          }),
        }
      );
    };

    const readStartError = async (response: Response) => {
      const errorData = await response.json().catch(() => ({}));
      return errorData.error?.message || `Veo API error: ${response.status}`;
    };

    let response = await postGenerationRequest('bytes');

    if (!response.ok) {
      let msg = await readStartError(response);
      if ((firstImage || lastImage) && /bytesBase64Encoded/i.test(msg)) {
        response = await postGenerationRequest('inline');
        if (!response.ok) {
          msg = await readStartError(response);
        }
      }
      if (!response.ok) {
        return { error: msg };
      }
    }

    const data = await response.json();
    const operationName = data.name;
    if (!operationName) {
      return { error: 'No operation name returned from Veo API' };
    }
    return { operationName };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network error starting Veo generation' };
  }
}

/**
 * Poll a Veo generation operation for completion.
 */
export async function pollVeoOperation(apiKey: string, operationName: string): Promise<VeoGenerationStatus> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${operationName}`,
      {
        method: 'GET',
        headers: {
          'x-goog-api-key': apiKey,
        },
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        done: false,
        operationName,
        error: errorData.error?.message || `Poll error: ${response.status}`,
      };
    }

    const data = await response.json();

    if (data.done) {
      const samples = data.response?.generateVideoResponse?.generatedSamples;
      const videoUri = samples?.[0]?.video?.uri;
      if (videoUri) {
        return { done: true, operationName, videoUri };
      }
      // Check for error in response
      if (data.error) {
        return { done: true, operationName, error: data.error.message || 'Generation failed' };
      }
      return { done: true, operationName, error: 'No video URI in completed response' };
    }

    return { done: false, operationName };
  } catch (err) {
    return {
      done: false,
      operationName,
      error: err instanceof Error ? err.message : 'Network error polling Veo',
    };
  }
}

/**
 * Download a Veo-generated video as a Blob.
 * The video URI requires the API key for authentication.
 */
export async function downloadVeoVideo(apiKey: string, videoUri: string): Promise<{ blob?: Blob; error?: string }> {
  try {
    const response = await fetch(videoUri, {
      headers: {
        'x-goog-api-key': apiKey,
      },
    });

    if (!response.ok) {
      return { error: `Download failed: ${response.status}` };
    }

    let blob = await response.blob();
    // Ensure blob has correct MIME type (Veo may not set Content-Type header)
    if (!blob.type || !blob.type.startsWith('video/')) {
      blob = new Blob([blob], { type: 'video/mp4' });
    }
    return { blob };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network error downloading video' };
  }
}

/**
 * Validate API key by making a minimal request
 */
export async function validateAPIKey(provider: AIProvider, apiKey: string, model?: string): Promise<boolean> {
  try {
    if (provider === 'claude') {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: model || 'claude-sonnet-4-6',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }]
        })
      });
      return response.ok;
    } else {
      const geminiModel = model || 'gemini-3.5-flash';
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Hi' }] }],
          generationConfig: { maxOutputTokens: 10 }
        })
      });
      return response.ok;
    }
  } catch {
    return false;
  }
}

// ─── Luma Video Generation ─────────────────────────────────────────────
// All Luma API calls go through the Tauri http_fetch proxy command to
// bypass CORS restrictions (the Luma API doesn't send CORS headers).

export type LumaModel = 'ray-2' | 'ray-flash-2';
export type LumaAspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9' | '9:21';
export type LumaResolution = '540p' | '720p' | '1080p' | '4k';

export interface LumaGenerationRequest {
  apiKey: string;
  prompt: string;
  model?: LumaModel;
  aspectRatio?: LumaAspectRatio;
  duration?: '5s' | '9s';
  resolution?: LumaResolution;
  loop?: boolean;
}

export interface LumaGenerationStatus {
  id: string;
  state: 'queued' | 'dreaming' | 'completed' | 'failed';
  videoUrl?: string;
  thumbnailUrl?: string;
  error?: string;
}

const LUMA_API_BASE = 'https://api.lumalabs.ai/dream-machine/v1';

/**
 * Helper: call the Tauri http_fetch proxy (bypasses CORS).
 * Returns parsed JSON body + status.
 */
async function lumaFetch(
  method: string,
  url: string,
  apiKey: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
  };
  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  console.log('[lumaFetch] Invoking http_fetch:', method, url);
  const result = await invoke<{ status: number; body: string; headers: Record<string, string> }>(
    'http_fetch',
    {
      method,
      url,
      headers,
      body: body ? JSON.stringify(body) : null,
    },
  );
  console.log('[lumaFetch] Got result, status:', result.status);

  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(result.body);
  } catch {
    // non-JSON response — leave data empty
  }
  return { status: result.status, data };
}

/**
 * Start a Luma video generation.
 */
export async function startLumaGeneration(request: LumaGenerationRequest): Promise<{ id?: string; error?: string }> {
  const {
    apiKey,
    prompt,
    model = 'ray-2',
    aspectRatio = '16:9',
    duration = '5s',
    resolution = '720p',
    loop = false,
  } = request;

  const body: Record<string, unknown> = {
    prompt,
    model,
    aspect_ratio: aspectRatio,
    duration,
    resolution,
    loop,
  };

  try {
    const { status, data } = await lumaFetch('POST', `${LUMA_API_BASE}/generations`, apiKey, body);

    if (status < 200 || status >= 300) {
      const msg = (data.detail || data.message || `Luma API error: ${status}`) as string;
      return { error: msg };
    }

    if (!data.id) {
      return { error: 'No generation ID returned from Luma API' };
    }
    return { id: data.id as string };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network error starting Luma generation' };
  }
}

/**
 * Poll a Luma generation for completion.
 */
export async function pollLumaGeneration(apiKey: string, generationId: string): Promise<LumaGenerationStatus> {
  try {
    const { status, data } = await lumaFetch('GET', `${LUMA_API_BASE}/generations/${generationId}`, apiKey);

    if (status < 200 || status >= 300) {
      return {
        id: generationId,
        state: 'failed',
        error: (data.detail || `Poll error: ${status}`) as string,
      };
    }

    const state = (data.state || data.status || 'queued') as string;

    if (state === 'completed') {
      const assets = data.assets as Record<string, string> | undefined;
      const video = data.video as Record<string, string> | undefined;
      return {
        id: generationId,
        state: 'completed',
        videoUrl: assets?.video || video?.url,
        thumbnailUrl: assets?.image || assets?.thumbnail,
      };
    }

    if (state === 'failed') {
      return {
        id: generationId,
        state: 'failed',
        error: (data.failure_reason || 'Generation failed') as string,
      };
    }

    return { id: generationId, state: state as 'queued' | 'dreaming' };
  } catch (err) {
    return {
      id: generationId,
      state: 'queued',
      error: err instanceof Error ? err.message : 'Network error polling Luma',
    };
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

/**
 * Validate a Luma API key by listing generations (via Tauri proxy).
 */
export async function validateLumaKey(apiKey: string): Promise<boolean> {
  console.log('[Luma] validateLumaKey called, key prefix:', apiKey?.slice(0, 8));
  console.log('[Luma] URL:', `${LUMA_API_BASE}/generations?limit=1`);
  try {
    console.log('[Luma] Calling lumaFetch...');
    const { status, data } = await lumaFetch('GET', `${LUMA_API_BASE}/generations?limit=1`, apiKey);
    console.log('[Luma] Validation response:', status, JSON.stringify(data).slice(0, 200));
    return status >= 200 && status < 300;
  } catch (err) {
    console.error('[Luma] Validation error:', err);
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
