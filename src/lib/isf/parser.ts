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
  PASSES?: Array<{ TARGET?: string; WIDTH?: string; HEIGHT?: string }>;
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

/**
 * Convert ISF shader code to standard WebGL GLSL
 * Handles ISF-specific uniforms and functions
 */
function convertISFtoGLSL(source: string, metadata: ISFMetadata): string {
  // First, fix any problematic loop constructs
  let glsl = fixShaderLoops(source);

  // Check if shader uses derivative functions (dFdx, dFdy, fwidth)
  const needsDerivatives = /\b(dFdx|dFdy|fwidth)\s*\(/.test(glsl);

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

  // Build uniform declarations for built-in ISF uniforms (only if not already declared)
  let uniformDeclarations = '';

  // Enable derivatives extension if needed (must be first)
  if (needsDerivatives) {
    uniformDeclarations += '#extension GL_OES_standard_derivatives : enable\n';
  }

  // Add built-in uniforms only if not already present (check for various common naming)
  // Also handle lowercase 'renderSize' variant
  if (!glsl.includes('uniform vec2 RENDERSIZE') && !glsl.includes('uniform vec2 renderSize')) {
    uniformDeclarations += 'uniform vec2 RENDERSIZE;\n';
  }

  // Add alias for lowercase variant if used in shader but not declared
  if (glsl.includes('renderSize') && !glsl.includes('uniform vec2 renderSize')) {
    uniformDeclarations += '#define renderSize RENDERSIZE\n';
  }

  if (!glsl.includes('uniform float TIME')) {
    uniformDeclarations += 'uniform float TIME;\n';
  }
  if (!glsl.includes('uniform float TIMEDELTA')) {
    uniformDeclarations += 'uniform float TIMEDELTA;\n';
  }
  if (!glsl.includes('uniform int FRAMEINDEX')) {
    uniformDeclarations += 'uniform int FRAMEINDEX;\n';
  }
  if (!glsl.includes('uniform vec4 DATE')) {
    uniformDeclarations += 'uniform vec4 DATE;\n';
  }

  // Add varying for UV coordinates
  uniformDeclarations += 'varying vec2 vUv;\n';

  // Add uniforms for each input (only if not already declared)
  for (const input of metadata.INPUTS) {
    // Check if uniform is already declared with any type
    const uniformCheck = new RegExp(`uniform\\s+\\w+\\s+${input.NAME}\\s*;`);
    if (uniformCheck.test(glsl)) continue;

    switch (input.TYPE) {
      case 'float':
      case 'event':
        uniformDeclarations += `uniform float ${input.NAME};\n`;
        break;
      case 'bool':
        uniformDeclarations += `uniform bool ${input.NAME};\n`;
        break;
      case 'long':
        uniformDeclarations += `uniform int ${input.NAME};\n`;
        break;
      case 'point2D':
        uniformDeclarations += `uniform vec2 ${input.NAME};\n`;
        break;
      case 'color':
        uniformDeclarations += `uniform vec4 ${input.NAME};\n`;
        break;
      case 'image':
        uniformDeclarations += `uniform sampler2D ${input.NAME};\n`;
        uniformDeclarations += `uniform vec2 _${input.NAME}_imgSize;\n`;
        break;
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

  // Audio-reactive uniforms (always available to all ISF shaders, zero-config)
  if (!glsl.includes('uniform sampler2D audioFFT')) {
    uniformDeclarations += 'uniform sampler2D audioFFT;\n';
  }
  if (!glsl.includes('uniform sampler2D audioWaveform')) {
    uniformDeclarations += 'uniform sampler2D audioWaveform;\n';
  }
  const audioFloatUniforms = [
    'audioLevel', 'audioBass', 'audioMid', 'audioHigh',
    'audioBeat', 'audioBeatPhase', 'audioBPM', 'audioSpectralCentroid'
  ];
  for (const name of audioFloatUniforms) {
    if (!glsl.includes(`uniform float ${name}`)) {
      uniformDeclarations += `uniform float ${name};\n`;
    }
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

  // Prepend precision and uniforms
  const header = `precision highp float;
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
