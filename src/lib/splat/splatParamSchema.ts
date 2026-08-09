import type { SplatContent } from '../types';

export interface SplatParamDescriptor {
  key: keyof SplatContent & string;
  label: string;
  group: string;
  min: number;
  max: number;
  step: number;
  suffix?: string;
}

const p = (
  key: keyof SplatContent & string,
  label: string,
  group: string,
  min: number,
  max: number,
  step: number,
  suffix?: string,
): SplatParamDescriptor => ({ key, label, group, min, max, step, suffix });

/**
 * The single parameter contract shared by splat modulation and keyframes.
 * Keep this list aligned with the numeric controls exposed by SplatPanel.
 */
export const SPLAT_AUTOMATABLE_PARAMS: readonly SplatParamDescriptor[] = [
  p('pointDensity', 'Point Density', 'Rendering', 0.01, 1, 0.01, '%'),
  p('textureBlend', 'Texture Blend', 'Rendering', 0, 1, 0.01, '%'),
  p('textureScale', 'Texture Scale', 'Rendering', 0.1, 5, 0.1),
  p('textureOffsetX', 'Texture Offset X', 'Rendering', -1, 1, 0.01),
  p('textureOffsetY', 'Texture Offset Y', 'Rendering', -1, 1, 0.01),
  p('pointSize', 'Point Size', 'Rendering', 0.1, 20, 0.05),
  p('scaleUniform', 'Global Scale', 'Transform', 0.01, 10, 0.01),
  p('opacity', 'Global Opacity', 'Rendering', 0, 1, 0.01, '%'),
  p('backgroundOpacity', 'Background Opacity', 'Rendering', 0, 1, 0.01, '%'),
  p('positionX', 'Position X', 'Transform', -10, 10, 0.01),
  p('positionY', 'Position Y', 'Transform', -10, 10, 0.01),
  p('positionZ', 'Position Z', 'Transform', -10, 10, 0.01),
  p('rotationX', 'Rotation X', 'Transform', -360, 360, 1, '°'),
  p('rotationY', 'Rotation Y', 'Transform', -360, 360, 1, '°'),
  p('rotationZ', 'Rotation Z', 'Transform', -360, 360, 1, '°'),

  p('animationSpeed', 'Animation Speed', 'Animation', 0, 5, 0.01),
  p('animationIntensity', 'Animation Intensity', 'Animation', 0, 2, 0.01),
  p('animationProgress', 'Animation Progress', 'Animation', 0, 1, 0.001, '%'),
  p('explodeForce', 'Burst Distance', 'Animation', 0, 8, 0.01),
  p('explodeTurbulence', 'Burst Turbulence', 'Animation', 0, 2, 0.01),
  p('implodeForce', 'Collapse', 'Animation', 0, 1, 0.01),
  p('implodeSpin', 'Core Spin', 'Animation', 0, 8, 0.01),
  p('voxelGridSize', 'Voxel Grid Density', 'Animation', 2, 64, 1),
  p('peelWidth', 'Peel Width', 'Animation', 0.05, 2.5, 0.01),
  p('peelCurl', 'Peel Curl', 'Animation', 0, 10, 0.01),
  p('sliceWidth', 'Slice Band Count', 'Animation', 0.5, 12, 0.1),
  p('sliceSoftness', 'Slice Softness', 'Animation', 0.01, 0.95, 0.01),
  p('sliceTravel', 'Slice Travel', 'Animation', -5, 5, 0.01),
  p('animationWaveFrequency', 'Wave Frequency', 'Animation', 0.25, 20, 0.01),
  p('animationWaveAmplitude', 'Wave Amplitude', 'Animation', 0, 3, 0.01),
  p('scatterDistance', 'Scatter Distance', 'Animation', 0, 8, 0.01),
  p('scatterRandomness', 'Scatter Randomness', 'Animation', 0.25, 24, 0.01),
  p('spiralRadius', 'Spiral Radius', 'Animation', 0, 6, 0.01),
  p('spiralTurns', 'Spiral Turns', 'Animation', -8, 8, 0.01),
  p('spiralLift', 'Spiral Lift', 'Animation', -5, 5, 0.01),
  p('swarmCohesion', 'Swarm Cohesion', 'Animation', 0, 2, 0.01),
  p('swarmSeparation', 'Swarm Separation', 'Animation', 0, 2, 0.01),
  p('swarmAlignment', 'Swarm Alignment', 'Animation', 0, 2, 0.01),
  p('gravityStrength', 'Gravity Strength', 'Animation', 0, 12, 0.01),
  p('gravitySpread', 'Gravity Spread', 'Animation', 0, 2, 0.01),
  p('gravityFloor', 'Gravity Floor', 'Animation', -5, 2, 0.01),
  p('turntableTilt', 'Turntable Tilt', 'Animation', -90, 90, 1, '°'),
  p('tumbleSpread', 'Tumble Spread', 'Animation', 0, 3, 0.01),
  p('breatheAmount', 'Breathe Amount', 'Animation', 0, 1, 0.01),
  p('driftAmount', 'Drift Amount', 'Animation', 0, 2, 0.01),
  p('vortexTwist', 'Vortex Twist', 'Animation', -10, 10, 0.01),
  p('morphRoundness', 'Morph Roundness', 'Animation', 0, 1, 0.01),

  p('displacementAmount', 'Displacement Amount', 'Displacement', 0, 3, 0.01),
  p('displacementScale', 'Displacement Scale', 'Displacement', 0.1, 10, 0.1),
  p('displacementSpeed', 'Displacement Speed', 'Displacement', 0, 5, 0.01),
  p('audioSensitivity', 'Audio Sensitivity', 'Displacement', 0, 4, 0.01),
  p('audioDisplacement', 'Audio Displacement', 'Displacement', 0, 3, 0.01),
  p('audioSmoothing', 'Audio Smoothing', 'Displacement', 0, 0.98, 0.01),

  p('ambientIntensity', 'Ambient', 'Lighting', 0, 2, 0.01),
  p('keyLightIntensity', 'Key Power', 'Lighting', 0, 4, 0.01),
  p('keyLightAzimuth', 'Key Azimuth', 'Lighting', -180, 180, 1, '°'),
  p('keyLightElevation', 'Key Elevation', 'Lighting', -90, 90, 1, '°'),
  p('rimLightIntensity', 'Rim Power', 'Lighting', 0, 4, 0.01),
  p('rimLightAzimuth', 'Rim Azimuth', 'Lighting', -180, 180, 1, '°'),
  p('shadowStrength', 'Shadow Strength', 'Lighting', 0, 1, 0.01),
  p('shadowSoftness', 'Shadow Softness', 'Lighting', 0, 1, 0.01),
  p('specularStrength', 'Specular Strength', 'Lighting', 0, 2, 0.01),

  p('atmosphereDensity', 'Fog Density', 'Fog / Smoke', 0, 1, 0.01),
  p('atmosphereScale', 'Fog Scale', 'Fog / Smoke', 0.1, 8, 0.01),
  p('atmosphereTurbulence', 'Fog Turbulence', 'Fog / Smoke', 0, 2, 0.01),
  p('atmosphereSpeed', 'Fog Speed', 'Fog / Smoke', -2, 2, 0.01),

  p('colorEffectIntensity', 'Color Intensity', 'Color Effects', 0, 1, 0.01),
  p('colorEffectSpeed', 'Color Speed', 'Color Effects', 0, 5, 0.01),
  p('depthGradientBias', 'Depth Midpoint', 'Color Effects', 0.05, 0.95, 0.01),
  p('opacityEffectIntensity', 'Opacity Intensity', 'Opacity Effects', 0, 1, 0.01),
  p('dofFocusDistance', 'Focus Distance', 'Opacity Effects', 0, 100, 0.1),
  p('dofBlurAmount', 'Blur Amount', 'Opacity Effects', 0, 1, 0.01),
  p('fogDensity', 'Opacity Fog', 'Opacity Effects', 0, 1, 0.01),
  p('creativeEffectIntensity', 'Creative Intensity', 'Creative Effects', 0, 1, 0.01),
  p('trailLength', 'Trail Length', 'Creative Effects', 1, 100, 1),
  p('trailFade', 'Trail Fade', 'Creative Effects', 0, 1, 0.01),
  p('feedbackAmount', 'Feedback', 'Creative Effects', 0, 1, 0.01),
  p('kaleidoscopeSegments', 'Kaleidoscope Segments', 'Creative Effects', 2, 16, 1),
  p('constellationMaxDistance', 'Constellation Distance', 'Creative Effects', 0, 1, 0.01),
  p('constellationOpacity', 'Constellation Opacity', 'Creative Effects', 0, 1, 0.01),
  p('echoCount', 'Echo Count', 'Creative Effects', 1, 10, 1),
  p('echoDelay', 'Echo Delay', 'Creative Effects', 0, 1, 0.01),

  p('autoRotateSpeed', 'Auto-Rotate Speed', 'Camera', 0, 5, 0.1),
  p('cameraFov', 'Camera FOV', 'Camera', 20, 120, 1, '°'),
  p('cameraDistance', 'Camera Distance', 'Camera', 1.5, 30, 0.1),
  p('cameraOrbitX', 'Camera Orbit X', 'Camera', -89, 89, 1, '°'),
  p('cameraOrbitY', 'Camera Orbit Y', 'Camera', -180, 180, 1, '°'),
  p('cameraRoll', 'Camera Roll', 'Camera', -180, 180, 1, '°'),
  p('cameraPanX', 'Camera Pan X', 'Camera', -100, 100, 0.5),
  p('cameraPanY', 'Camera Pan Y', 'Camera', -100, 100, 0.5),
  p('mouseRadius', 'Mouse Radius', 'Interaction', 0.05, 1, 0.01),
  p('mouseStrength', 'Mouse Strength', 'Interaction', 0.1, 3, 0.05),
  p('gravity', 'Physics Gravity', 'Physics', -20, 20, 0.1),
  p('friction', 'Physics Friction', 'Physics', 0, 1, 0.01),
  p('bounciness', 'Physics Bounce', 'Physics', 0, 1, 0.01),
] as const;

export const SPLAT_AUTOMATABLE_PARAM_MAP = new Map(
  SPLAT_AUTOMATABLE_PARAMS.map((param) => [param.key, param]),
);

export const SPLAT_AUTOMATABLE_GROUPS = Array.from(
  SPLAT_AUTOMATABLE_PARAMS.reduce((groups, param) => {
    const list = groups.get(param.group) ?? [];
    list.push(param);
    groups.set(param.group, list);
    return groups;
  }, new Map<string, SplatParamDescriptor[]>()),
);
