// ISF (Interactive Shader Format) Parser
// Parses the JSON metadata from ISF shader files

export interface ISFInput {
  NAME: string;
  TYPE: 'float' | 'bool' | 'long' | 'point2D' | 'color' | 'image' | 'event' | 'audio' | 'audioFFT';
  DEFAULT?: number | boolean | number[] | string;
  MIN?: number;
  MAX?: number;
  LABEL?: string;
  LABELS?: string[];
  VALUES?: number[];
}

export interface ISFMetadata {
  DESCRIPTION?: string;
  CREDIT?: string;
  CATEGORIES?: string[];
  INPUTS: ISFInput[];
  IMPORTED?: Record<string, { PATH: string }>;
  PASSES?: Array<{ TARGET?: string; PERSISTENT?: boolean; WIDTH?: string; HEIGHT?: string }>;
  /** ISF 1.x: buffer names, or name -> size spec. */
  PERSISTENT_BUFFERS?: string[] | Record<string, unknown>;
  ISFVSN?: string;
}

export interface ParsedISF {
  metadata: ISFMetadata;
  fragmentShader: string;
  vertexShader?: string;
  /** True if the shader source references audio uniforms (audioLevel, audioBass, etc.) */
  isAudioReady: boolean;
}

/** Audio uniform names that indicate a shader is designed for audio reactivity */
const AUDIO_UNIFORM_NAMES = [
  'audioLevel', 'audioBass', 'audioMid', 'audioHigh',
  'audioBeat', 'audioBeatPhase', 'audioBPM', 'audioSpectralCentroid',
  'audioFFT', 'audioWaveform', 'sampleFFT', 'sampleWaveform',
];

/** Check if shader source code references any audio uniforms */
export function detectAudioReady(shaderSource: string): boolean {
  return AUDIO_UNIFORM_NAMES.some(name => new RegExp(`\\b${name}\\b`).test(shaderSource));
}

/**
 * Parse ISF shader file content
 * Extracts JSON metadata from the comment block at the top
 */
export function parseISF(shaderSource: string): ParsedISF {
  // Find the JSON metadata block: /*{ ... }*/
  const metadataMatch = shaderSource.match(/\/\*\s*(\{[\s\S]*?\})\s*\*\//);

  let metadata: ISFMetadata = { INPUTS: [] };
  let fragmentShader = shaderSource;

  if (metadataMatch) {
    try {
      metadata = JSON.parse(metadataMatch[1]);
      // Remove the metadata block from shader source
      fragmentShader = shaderSource.replace(metadataMatch[0], '');
    } catch (e) {
      console.warn('Failed to parse ISF metadata:', e);
    }
  }

  // Ensure INPUTS array exists
  if (!metadata.INPUTS) {
    metadata.INPUTS = [];
  }

  return {
    metadata,
    fragmentShader: convertISFtoGLSL(fragmentShader, metadata),
    isAudioReady: detectAudioReady(fragmentShader),
  };
}

/**
 * Fix WebGL loop constraints in shader code
 * WebGL requires constant loop bounds, so we need to fix common AI-generated patterns
 */
function fixShaderLoops(source: string): string {
  let glsl = source;

  // FIRST: Collect all #define integer constants — these are valid compile-time constants
  // that the GLSL preprocessor resolves. We must NOT replace them with hardcoded numbers.
  const defineConstants = new Set<string>();
  const definePattern = /#define\s+(\w+)\s+(\d+)/g;
  let defineMatch;
  while ((defineMatch = definePattern.exec(glsl)) !== null) {
    defineConstants.add(defineMatch[1]);
  }

  // Helper: check if an expression is a compile-time constant (number or #define)
  function isCompileTimeConstant(expr: string): boolean {
    const trimmed = expr.trim();
    return /^\s*-?\d+\s*$/.test(trimmed) || defineConstants.has(trimmed);
  }

  // Pattern 1: Fix "for(int i = start; i < end; i++)" where start/end are runtime variables
  glsl = glsl.replace(
    /for\s*\(\s*int\s+(\w+)\s*=\s*([^;]+?);\s*\1\s*([<>=!]+)\s*([^;]+?);\s*\1\s*(\+\+|--|\+=\s*\d+|-=\s*\d+)\s*\)/g,
    (match, varName, initExpr, comparison, limitExpr, increment) => {
      const isInitConst = isCompileTimeConstant(initExpr);
      const isLimitConst = isCompileTimeConstant(limitExpr);

      if (isInitConst && isLimitConst) {
        return match; // Already valid
      }

      const fixedInit = isInitConst ? initExpr.trim() : '0';
      let fixedLimit = isLimitConst ? limitExpr.trim() : '100';

      const result = `for(int ${varName} = ${fixedInit}; ${varName} ${comparison} ${fixedLimit}; ${varName}${increment})`;

      if (!isInitConst || !isLimitConst) {
        console.log('[ISF Parser] Fixed non-constant loop:', match, '->', result);
      }

      return result;
    }
  );

  // Pattern 2: Fix loops like "for(int i = 0; i < count; i++)" where count is a runtime variable
  const variableLoopPattern = /for\s*\(\s*int\s+(\w+)\s*=\s*(\d+)\s*;\s*\1\s*<\s*(\w+)\s*;\s*\1\s*\+\+\s*\)/g;
  glsl = glsl.replace(variableLoopPattern, (match, varName, init, limitVar) => {
    if (isCompileTimeConstant(limitVar)) {
      return match; // Already a constant (number or #define)
    }

    const fixedLoop = `for(int ${varName} = ${init}; ${varName} < 64; ${varName}++) /* was: ${limitVar} */`;
    console.log('[ISF Parser] Fixed variable loop bound:', match, '->', fixedLoop);
    return fixedLoop;
  });

  // Pattern 4: Fix loops with non-constant step like "i += step"
  glsl = glsl.replace(
    /for\s*\(\s*int\s+(\w+)\s*=\s*(\d+)\s*;\s*\1\s*<\s*(\d+)\s*;\s*\1\s*\+=\s*(\w+)\s*\)/g,
    (match, varName, init, limit, stepVar) => {
      if (/^\d+$/.test(stepVar)) {
        return match; // Already a constant step
      }
      const fixedLoop = `for(int ${varName} = ${init}; ${varName} < ${limit}; ${varName}++) /* was: += ${stepVar} */`;
      console.log('[ISF Parser] Fixed variable step:', match, '->', fixedLoop);
      return fixedLoop;
    }
  );

  // Pattern 5: Fix float loops with non-constant init like "for(float j = i + 1.0; j < 30.0; j++)"
  // WebGL 1.0 requires constant loop initialization expressions
  glsl = glsl.replace(
    /for\s*\(\s*float\s+(\w+)\s*=\s*([^;]+?);\s*\1\s*([<>=!]+)\s*([\d.]+)\s*;\s*\1\s*(\+\+|--|\+=\s*[\d.]+|-=\s*[\d.]+)\s*\)/g,
    (match, varName, initExpr, comparison, limitExpr, increment) => {
      // Check if initExpr is a constant float (e.g., 0.0, -1.0, 5.0)
      if (/^\s*-?[\d.]+\s*$/.test(initExpr)) {
        return match; // Already a constant init
      }
      // Replace non-constant init with 0.0
      const result = `for(float ${varName} = 0.0; ${varName} ${comparison} ${limitExpr}; ${varName}${increment})`;
      console.log('[ISF Parser] Fixed float loop non-constant init:', match, '->', result);
      return result;
    }
  );

  // Pattern 6: Fix float loops with non-constant step like "y += 1.0 / basePairs"
  glsl = glsl.replace(
    /for\s*\(\s*float\s+(\w+)\s*=\s*(-?[\d.]+)\s*;\s*\1\s*([<>=!]+)\s*(-?[\d.]+)\s*;\s*\1\s*\+=\s*([^)]+?)\s*\)/g,
    (match, varName, initExpr, comparison, limitExpr, stepExpr) => {
      // Check if step is a constant float
      if (/^\s*-?[\d.]+\s*$/.test(stepExpr)) {
        return match; // Already a constant step
      }
      // Replace with a fixed iteration count and compute step inside loop
      const range = Math.abs(parseFloat(limitExpr) - parseFloat(initExpr));
      const maxIter = Math.min(Math.ceil(range * 30), 128); // reasonable max
      const result = `for(float ${varName} = ${initExpr}; ${varName} ${comparison} ${limitExpr}; ${varName} += (${limitExpr} - (${initExpr})) / ${maxIter}.0)`;
      console.log('[ISF Parser] Fixed float loop non-constant step:', match, '->', result);
      return result;
    }
  );

  // Pattern 7: Fix while loops by converting them to for loops with max iterations
  // while(condition) -> for(int _wl=0; _wl<100; _wl++) { if(!(condition)) break; ... }
  // This is risky, so we'll just flag them for now
  if (/\bwhile\s*\(/.test(glsl) && !/for\s*\(\s*;\s*;\s*\)/.test(glsl)) {
    console.warn('[ISF Parser] Shader contains while loop - may cause issues');
  }

  return glsl;
}

/** Uniforms the renderer sets on every ISF shader, in declaration order */
const BUILTIN_UNIFORMS: Array<[type: string, name: string]> = [
  ['vec2', 'RENDERSIZE'],
  ['float', 'TIME'],
  ['float', 'TIMEDELTA'],
  ['int', 'FRAMEINDEX'],
  ['vec4', 'DATE'],
  // Audio-reactive uniforms (always available to all ISF shaders, zero-config)
  ['sampler2D', 'audioFFT'],
  ['sampler2D', 'audioWaveform'],
  ['float', 'audioLevel'],
  ['float', 'audioBass'],
  ['float', 'audioMid'],
  ['float', 'audioHigh'],
  ['float', 'audioBeat'],
  ['float', 'audioBeatPhase'],
  ['float', 'audioBPM'],
  ['float', 'audioSpectralCentroid'],
];

const INT_OVERLOADS: Record<string, string> = {
  clamp: 'int clamp(int x, int lo, int hi) { return x < lo ? lo : (x > hi ? hi : x); }\n',
  min: 'int min(int a, int b) { return a < b ? a : b; }\n',
  max: 'int max(int a, int b) { return a > b ? a : b; }\n',
};

/** Matches a whole-line `uniform <type> <name>;`, precision qualifier allowed */
function uniformDeclaration(type: string, name: string): RegExp {
  return new RegExp(`^[ \\t]*uniform\\s+(?:(?:lowp|mediump|highp)\\s+)?${type}\\s+${name}\\s*;[ \\t]*$`, 'gm');
}

/** True when the source declares a uniform of this name, of any type */
function declaresUniform(source: string, name: string): boolean {
  return new RegExp(`\\buniform\\s+(?:(?:lowp|mediump|highp)\\s+)?\\w+\\s+${name}\\s*;`).test(source);
}

/** Buffers that PASSES (ISF 2) and PERSISTENT_BUFFERS (ISF 1) render into */
export function getISFPassTargets(metadata: Pick<ISFMetadata, 'PASSES' | 'PERSISTENT_BUFFERS'>): string[] {
  const persistent = metadata.PERSISTENT_BUFFERS;
  const names = [
    ...(Array.isArray(metadata.PASSES) ? metadata.PASSES.map((pass) => pass?.TARGET) : []),
    ...(Array.isArray(persistent) ? persistent : Object.keys(persistent ?? {})),
  ];
  const targets: string[] = [];
  for (const name of names) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (/^[A-Za-z_]\w*$/.test(trimmed) && !targets.includes(trimmed)) targets.push(trimmed);
  }
  return targets;
}

/**
 * Convert ISF shader code to standard WebGL GLSL
 * Handles ISF-specific uniforms and functions
 */
function convertISFtoGLSL(source: string, metadata: ISFMetadata): string {
  // First, fix any problematic loop constructs
  let glsl = fixShaderLoops(source);

  // Check if shader uses derivative functions (dFdx, dFdy, fwidth). Comments
  // are skipped: a note that mentions fwidth() is not a call.
  const code = glsl.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const needsDerivatives = /\b(dFdx|dFdy|fwidth)\s*\(/.test(code);

  // CRITICAL FIX: Handle Shadertoy-style global variable initialization from uniforms
  // In GLSL, you cannot initialize global variables with uniform values at compile time.
  // These shaders try to do: vec3 iResolution = vec3(RENDERSIZE.x, RENDERSIZE.y, 1.0);
  // We convert these to #define macros which are evaluated at runtime.

  // Convert: vec3 iResolution = vec3(RENDERSIZE.x, RENDERSIZE.y, 1.0);
  // To: #define iResolution vec3(RENDERSIZE.x, RENDERSIZE.y, 1.0)
  glsl = glsl.replace(/^\s*vec3\s+iResolution\s*=\s*vec3\s*\(\s*RENDERSIZE\.x\s*,\s*RENDERSIZE\.y\s*,\s*[\d.]+\s*\)\s*;/gm,
    '#define iResolution vec3(RENDERSIZE.x, RENDERSIZE.y, 1.0)');

  // Convert: float iTime = TIME;
  // To: #define iTime TIME
  glsl = glsl.replace(/^\s*float\s+iTime\s*=\s*TIME\s*;/gm, '#define iTime TIME');

  // Remove ONLY simple #ifdef GL_ES blocks that wrap just precision statements
  // Be more conservative - only remove if the block ONLY contains precision
  glsl = glsl.replace(/#ifdef\s+GL_ES\s*\n\s*precision\s+(highp|mediump|lowp)\s+float\s*;\s*\n\s*#endif/g, '');

  // Remove any standalone existing precision statements - we'll add our own
  glsl = glsl.replace(/^precision\s+(highp|mediump|lowp)\s+float\s*;\s*$/gm, '');

  // Built-in uniforms are declared once, here, ahead of the helpers below
  // that read them. A shader's own declaration of one is dropped in favour
  // of this one: left in place it either clashed with it (redefinition) or,
  // when its spelling slipped past the check, came after IMG_PIXEL had
  // already used RENDERSIZE (undeclared identifier). A declaration of
  // another type is the shader's to keep.
  let uniformDeclarations = '';
  const declared = new Set<string>();
  const declare = (type: string, name: string) => {
    if (declared.has(name)) return;
    declared.add(name);
    uniformDeclarations += `uniform ${type} ${name};\n`;
  };

  for (const [type, name] of BUILTIN_UNIFORMS) {
    glsl = glsl.replace(uniformDeclaration(type, name), '');
    if (declaresUniform(glsl, name)) declared.add(name);
    else declare(type, name);
  }

  // renderSize is a common misspelling; the renderer keeps it equal to RENDERSIZE
  glsl = glsl.replace(uniformDeclaration('vec2', 'renderSize'), '');
  if (/\brenderSize\b/.test(glsl)) {
    uniformDeclarations += '#define renderSize RENDERSIZE\n';
  }

  // This renderer draws a single pass, so PASSINDEX is pinned to the last
  // pass, the one that writes the output.
  if (/\bPASSINDEX\b/.test(code)) {
    glsl = glsl.replace(uniformDeclaration('int', 'PASSINDEX'), '');
    uniformDeclarations += `#define PASSINDEX ${Math.max((metadata.PASSES?.length ?? 0) - 1, 0)}\n`;
  }

  // Add varying for UV coordinates
  uniformDeclarations += 'varying vec2 vUv;\n';

  // Add uniforms for each input (only if not already declared)
  for (const input of metadata.INPUTS) {
    if (declaresUniform(glsl, input.NAME)) continue;

    switch (input.TYPE) {
      case 'float':
      case 'event':
        declare('float', input.NAME);
        break;
      case 'bool':
        declare('bool', input.NAME);
        break;
      case 'long':
        declare('int', input.NAME);
        break;
      case 'point2D':
        declare('vec2', input.NAME);
        break;
      case 'color':
        declare('vec4', input.NAME);
        break;
      case 'image':
        declare('sampler2D', input.NAME);
        declare('vec2', `_${input.NAME}_imgSize`);
        break;
    }
  }

  // Pass targets sample as black here, which lets multi-pass shaders compile
  for (const name of getISFPassTargets(metadata)) {
    if (!declaresUniform(glsl, name)) declare('sampler2D', name);
  }

  // GLSL ES 1.0 has clamp/min/max for floats only; shaders written against
  // desktop GLSL call them on ints as well
  for (const [name, overload] of Object.entries(INT_OVERLOADS)) {
    if (new RegExp(`\\b${name}\\s*\\(`).test(code) && !new RegExp(`\\bint\\s+${name}\\s*\\(`).test(code)) {
      uniformDeclarations += overload;
    }
  }

  // Add image sampling helper functions (only if not already DEFINED)
  // IMPORTANT: Check for function DEFINITION, not just usage/calls.
  // Shaders that CALL IMG_NORM_PIXEL() still need the function definition injected.
  if (!/vec4\s+IMG_NORM_PIXEL\s*\(/.test(glsl)) {
    uniformDeclarations += `
vec4 IMG_NORM_PIXEL(sampler2D img, vec2 uv) {
  return texture2D(img, uv);
}
`;
  }

  if (!/vec4\s+IMG_PIXEL\s*\(/.test(glsl)) {
    uniformDeclarations += `
vec4 IMG_PIXEL(sampler2D img, vec2 coord) {
  return texture2D(img, coord / RENDERSIZE);
}
`;
  }

  // Audio sampling helpers (available in all shaders)
  // Check for function DEFINITION (not just calls) to avoid skipping injection
  if (!glsl.includes('float sampleFFT(')) {
    uniformDeclarations += `
float sampleFFT(float u) {
  return texture2D(audioFFT, vec2(u, 0.5)).r;
}
`;}
  if (!glsl.includes('float sampleWaveform(')) {
    uniformDeclarations += `
float sampleWaveform(float u) {
  return texture2D(audioWaveform, vec2(u, 0.5)).r * 2.0 - 1.0;
}
`;
  }

  // Add isf_FragNormCoord helper (convert gl_FragCoord to normalized coords)
  uniformDeclarations += `
#define isf_FragNormCoord (gl_FragCoord.xy / RENDERSIZE)
`;

  // Prepend precision and uniforms. An #extension directive has to come
  // before any other statement in GLSL ES 1.0, precision included: placed
  // after it, every shader that uses derivatives failed to compile and
  // played black.
  const extensions = needsDerivatives ? '#extension GL_OES_standard_derivatives : enable\n' : '';
  const header = `${extensions}precision highp float;
${uniformDeclarations}
`;

  glsl = header + glsl;

  return glsl;
}

/**
 * Get default value for an ISF input
 */
export function getInputDefault(input: ISFInput): number | boolean | number[] {
  if (input.DEFAULT !== undefined) {
    return input.DEFAULT as number | boolean | number[];
  }

  switch (input.TYPE) {
    case 'float':
      return input.MIN !== undefined ? input.MIN : 0;
    case 'bool':
      return false;
    case 'long':
      return 0;
    case 'point2D':
      return [0.5, 0.5];
    case 'color':
      return [1, 1, 1, 1];
    case 'event':
      return 0;
    default:
      return 0;
  }
}

/**
 * Create uniform values object from ISF inputs with defaults
 * Uses Three.js types for proper WebGL uniform handling
 */
export function createUniformsFromInputs(inputs: ISFInput[]): Record<string, { value: unknown }> {
  // Import THREE dynamically since this is a parser module
  // The renderer will handle the actual Three.js types
  const uniforms: Record<string, { value: unknown }> = {
    RENDERSIZE: { value: null }, // Will be set to Vector2 by renderer
    renderSize: { value: null }, // Also add lowercase variant for shaders that use it
    TIME: { value: 0 },
    TIMEDELTA: { value: 0.016 },
    FRAMEINDEX: { value: 0 },
    DATE: { value: null }, // Will be set to Vector4 by renderer
    // Audio-reactive uniforms (set by renderer each frame when audio is active)
    audioFFT: { value: null },
    audioWaveform: { value: null },
    audioLevel: { value: 0 },
    audioBass: { value: 0 },
    audioMid: { value: 0 },
    audioHigh: { value: 0 },
    audioBeat: { value: 0 },
    audioBeatPhase: { value: 0 },
    audioBPM: { value: 0 },
    audioSpectralCentroid: { value: 0 },
  };

  for (const input of inputs) {
    const defaultValue = getInputDefault(input);

    switch (input.TYPE) {
      case 'float':
      case 'event':
        uniforms[input.NAME] = { value: defaultValue };
        break;
      case 'bool':
        uniforms[input.NAME] = { value: defaultValue };
        break;
      case 'long':
        uniforms[input.NAME] = { value: defaultValue };
        break;
      case 'point2D':
        uniforms[input.NAME] = { value: defaultValue };
        break;
      case 'color':
        uniforms[input.NAME] = { value: defaultValue };
        break;
      case 'image':
        uniforms[input.NAME] = { value: null };
        uniforms[`_${input.NAME}_imgSize`] = { value: null };
        break;
    }
  }

  return uniforms;
}
