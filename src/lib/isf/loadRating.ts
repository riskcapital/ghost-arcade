export type ShaderLoadLevel = 'low' | 'medium' | 'high' | 'extreme';

export interface ShaderLoadRating {
  level: ShaderLoadLevel;
  score: number;
  label: string;
  shortLabel: string;
  hints: string[];
}

function countMatches(source: string, pattern: RegExp): number {
  const matches = source.match(pattern);
  return matches ? matches.length : 0;
}

/**
 * Strip comments before scoring.
 *
 * Every metric below is a proxy for GPU cost, and comments have none. Left in,
 * they distort the score twice over: a well-documented shader trips the
 * "large shader source" size bucket on prose alone, and the keyword tests fire
 * on any comment that happens to mention raymarching, blur or a kernel --
 * describing a technique is enough to be charged for it.
 *
 * This is not hypothetical. Four of the five GA2 shaders scored 43-47 (Extreme)
 * purely on their comments, and an Extreme rating makes MediaTray drop the
 * layer to half render quality on load. Shaders measured at 1.6-4.8ms on the
 * native core were being rendered at half resolution because of their prose.
 *
 * The ISF header is itself a block comment, so this removes the metadata JSON
 * too -- correct, since none of it executes. Input count is passed separately.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

export function estimateShaderLoadRating(
  shaderCode: string,
  inputCount = 0,
): ShaderLoadRating {
  const source = stripComments(shaderCode || '');
  const lower = source.toLowerCase();
  let score = 0;
  const hints: string[] = [];

  // General source size and branch complexity.
  const lines = source.split(/\r?\n/).length;
  if (lines > 120) {
    score += 6;
    hints.push('large shader source');
  } else if (lines > 70) {
    score += 3;
  }

  const conditionals = countMatches(source, /\bif\s*\(/g) + countMatches(source, /\?/g);
  if (conditionals > 16) {
    score += 8;
    hints.push('heavy branching');
  } else if (conditionals > 8) {
    score += 4;
  }

  // Looping and likely raymarch patterns.
  const loops = countMatches(source, /\b(for|while)\s*\(/g);
  if (loops > 8) {
    score += 14;
    hints.push('many loops');
  } else if (loops > 3) {
    score += 8;
  } else if (loops > 0) {
    score += 3;
  }

  if (
    lower.includes('raymarch')
    || lower.includes('ray march')
    || lower.includes('march(')
    || lower.includes('max_steps')
    || /for\s*\(\s*int\s+\w+\s*=\s*0\s*;\s*\w+\s*<\s*(64|96|128|160|192|256)/i.test(source)
  ) {
    score += 18;
    hints.push('raymarch/long-step loop pattern');
  }

  // Texture fetch intensity.
  const textureOps =
    countMatches(source, /\btexture2D\s*\(/g)
    + countMatches(source, /\btexture\s*\(/g)
    + countMatches(source, /\bIMG_(THIS_PIXEL|NORM_PIXEL|PIXEL)\s*\(/g);
  if (textureOps > 14) {
    score += 14;
    hints.push('many texture samples');
  } else if (textureOps > 6) {
    score += 8;
  } else if (textureOps > 2) {
    score += 4;
  }

  // Expensive math operations.
  const heavyMath = countMatches(source, /\b(pow|exp|log|sqrt|sin|cos|tan|atan)\s*\(/g);
  if (heavyMath > 20) {
    score += 10;
    hints.push('heavy transcendental math');
  } else if (heavyMath > 10) {
    score += 6;
  } else if (heavyMath > 4) {
    score += 3;
  }

  // Neighbor/blur kernels tend to scale badly with resolution.
  if (
    lower.includes('gaussian')
    || lower.includes('kernel')
    || lower.includes('blur')
    || lower.includes('sobel')
    || lower.includes('convolution')
  ) {
    score += 8;
    hints.push('kernel/blur style processing');
  }

  // More exposed controls often means wider dynamic shader behavior.
  if (inputCount > 12) {
    score += 4;
  } else if (inputCount > 6) {
    score += 2;
  }

  let level: ShaderLoadLevel;
  let label: string;
  let shortLabel: string;
  if (score >= 40) {
    level = 'extreme';
    label = 'Extreme Load';
    shortLabel = 'XL';
  } else if (score >= 26) {
    level = 'high';
    label = 'High Load';
    shortLabel = 'H';
  } else if (score >= 14) {
    level = 'medium';
    label = 'Medium Load';
    shortLabel = 'M';
  } else {
    level = 'low';
    label = 'Low Load';
    shortLabel = 'L';
  }

  return {
    level,
    score,
    label,
    shortLabel,
    hints,
  };
}
