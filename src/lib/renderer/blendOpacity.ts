import type { BlendMode } from '../types';

/**
 * Keep a layer visually normal at full opacity, then ease its selected blend
 * mode in until it is fully engaged at half opacity. Below half opacity the
 * mode remains engaged while ordinary alpha makes the layer disappear.
 */
export function layerBlendInfluence(opacity: number, blendMode: BlendMode): number {
  if (blendMode === 'normal') return 0;
  const clampedOpacity = Math.min(1, Math.max(0, opacity));
  const ramp = Math.min(1, Math.max(0, (1 - clampedOpacity) * 2));
  return ramp * ramp * (3 - (2 * ramp));
}

/** Add normal-to-mode interpolation to one of the shared blend shaders. */
export function addLayerBlendInfluenceUniform(fragmentShader: string): string {
  const opacityUniform = 'uniform float uOpacity;';
  if (!fragmentShader.includes(opacityUniform)) {
    throw new Error('Blend shader is missing uOpacity');
  }

  const outputPattern = /([ \t]*)gl_FragColor = vec4\(mix\(base\.rgb, (.+), a\), max\(base\.a, a\)\);/;
  if (!outputPattern.test(fragmentShader)) {
    throw new Error('Blend shader output does not match the compositor contract');
  }

  return fragmentShader
    .replace(opacityUniform, `${opacityUniform}\n    uniform float uBlendInfluence;`)
    .replace(
      outputPattern,
      (_match, indent: string, blendColor: string) => [
        `${indent}vec3 normalComposite = mix(base.rgb, layer.rgb, a);`,
        `${indent}vec3 blendComposite = mix(base.rgb, ${blendColor}, a);`,
        `${indent}gl_FragColor = vec4(mix(normalComposite, blendComposite, uBlendInfluence), max(base.a, a));`,
      ].join('\n'),
    );
}
