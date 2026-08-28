export interface Model3DParamDescriptor {
  /** Dot-path after the "model3d:" track-key prefix, e.g. "camera.orbitX" or "positionX". */
  key: string;
  label: string;
  group: string;
  min: number;
  max: number;
  step: number;
}

const p = (
  key: string,
  label: string,
  group: string,
  min: number,
  max: number,
  step: number,
): Model3DParamDescriptor => ({ key, label, group, min, max, step });

/**
 * The single parameter contract shared by the Model3D property panel and
 * keyframes. Keep this list aligned with the numeric controls exposed by
 * Model3DPanel. Mirrors splatParamSchema.ts's shape for SplatContent.
 */
export const MODEL3D_AUTOMATABLE_PARAMS: readonly Model3DParamDescriptor[] = [
  // Transform
  p('scaleUniform', 'Scale', '3D Transform', 0.01, 10, 0.01),
  p('rotationX', 'Rotation X', '3D Transform', -360, 360, 1),
  p('rotationY', 'Rotation Y', '3D Transform', -360, 360, 1),
  p('rotationZ', 'Rotation Z', '3D Transform', -360, 360, 1),
  p('positionX', 'Position X', '3D Transform', -5, 5, 0.01),
  p('positionY', 'Position Y', '3D Transform', -5, 5, 0.01),
  p('positionZ', 'Position Z', '3D Transform', -5, 5, 0.01),
  // Camera
  p('camera.fov', 'FOV', '3D Camera', 10, 120, 1),
  p('camera.distance', 'Distance', '3D Camera', 0.5, 30, 0.1),
  p('camera.orbitX', 'Orbit X', '3D Camera', -90, 90, 1),
  p('camera.orbitY', 'Orbit Y', '3D Camera', -360, 360, 1),
  p('camera.panX', 'Pan X', '3D Camera', -5, 5, 0.01),
  p('camera.panY', 'Pan Y', '3D Camera', -5, 5, 0.01),
  p('camera.roll', 'Roll', '3D Camera', -180, 180, 1),
  p('camera.rotateSpeed', 'Auto-Rotate Speed', '3D Camera', -5, 5, 0.01),
  // Deformation
  p('deformationIntensity', 'Deform Intensity', '3D Deformation', 0, 2, 0.01),
  p('deformationSpeed', 'Deform Speed', '3D Deformation', 0, 5, 0.01),
  p('deformationScale', 'Deform Scale', '3D Deformation', 0.1, 10, 0.05),
  p('deformationSpread', 'Deform Spread', '3D Deformation', 0, 6, 0.05),
  // Animation
  p('animationSpeed', 'Anim Speed', '3D Animation', 0, 5, 0.01),
  p('animationIntensity', 'Anim Intensity', '3D Animation', 0, 2, 0.01),
  p('animationProgress', 'Anim Progress', '3D Animation', 0, 1, 0.001),
  // Echo
  p('echo.count', 'Echo Count', '3D Echo', 1, 30, 1),
  p('echo.spacing', 'Echo Spacing', '3D Echo', 0, 2, 0.01),
  p('echo.fadeRate', 'Echo Fade', '3D Echo', 0, 3, 0.01),
  p('echo.scaleVariation', 'Echo Scale Var', '3D Echo', 0, 1, 0.01),
  p('echo.rotationVariation', 'Echo Rotation Var', '3D Echo', 0, 1, 0.01),
  p('echo.colorVariation', 'Echo Color Var', '3D Echo', 0, 1, 0.01),
  p('echo.phaseOffset', 'Echo Phase Offset', '3D Echo', 0, 2, 0.01),
  p('echo.speed', 'Echo Speed', '3D Echo', 0, 5, 0.01),
  // Material
  p('materialOpacity', 'Mat Opacity', '3D Material', 0, 1, 0.01),
  p('materialRoughness', 'Roughness', '3D Material', 0, 1, 0.01),
  p('materialMetalness', 'Metalness', '3D Material', 0, 1, 0.01),
  p('materialEmissiveIntensity', 'Emissive', '3D Material', 0, 5, 0.01),
  p('glassThickness', 'Glass Thickness', '3D Material', 0, 5, 0.01),
  p('glassIOR', 'Glass IOR', '3D Material', 1, 3, 0.01),
  p('chromeReflectivity', 'Chrome Reflect', '3D Material', 0, 1, 0.01),
  p('dissolveAmount', 'Dissolve', '3D Material', 0, 1, 0.01),
  // Lighting
  p('ambientIntensity', 'Ambient', '3D Lighting', 0, 2, 0.01),
  p('directionalIntensity', 'Key Power', '3D Lighting', 0, 3, 0.01),
  p('environmentIntensity', 'Environment', '3D Lighting', 0, 3, 0.01),
  p('toneMappingExposure', 'Exposure', '3D Lighting', 0.1, 3, 0.01),
  p('keyLightAzimuth', 'Key Azimuth', '3D Lighting', -180, 180, 1),
  p('keyLightElevation', 'Key Elevation', '3D Lighting', -10, 90, 1),
  p('fillIntensity', 'Fill Power', '3D Lighting', 0, 3, 0.01),
  p('rimIntensity', 'Rim Power', '3D Lighting', 0, 3, 0.01),
  p('shadowSoftness', 'Shadow Softness', '3D Shadows', 0, 4, 0.01),
  p('shadowBias', 'Shadow Bias', '3D Shadows', -0.01, 0.01, 0.0001),
  // Wireframe / Decorations
  p('wireframeOpacity', 'Wireframe Opacity', '3D Style', 0, 1, 0.01),
  p('wireframeAnimSpeed', 'Wireframe Speed', '3D Style', 0, 5, 0.01),
  p('vertexDecorationSize', 'Vertex Deco Size', '3D Style', 0.001, 0.5, 0.001),
  // Audio reactivity
  p('audio.scaleResponse', 'Audio→Scale', '3D Audio', 0, 5, 0.01),
  p('audio.rotationResponse', 'Audio→Rotation', '3D Audio', 0, 5, 0.01),
  p('audio.deformResponse', 'Audio→Deform', '3D Audio', 0, 5, 0.01),
  // Beat sync
  p('beatScale', 'Beat Scale', '3D Beat', 0, 2, 0.01),
  p('beatRotate', 'Beat Rotate', '3D Beat', 0, 2, 0.01),
  p('beatExplode', 'Beat Explode', '3D Beat', 0, 2, 0.01),
] as const;

export const MODEL3D_AUTOMATABLE_PARAM_MAP = new Map(
  MODEL3D_AUTOMATABLE_PARAMS.map((param) => [param.key, param]),
);

export const MODEL3D_AUTOMATABLE_GROUPS = Array.from(
  MODEL3D_AUTOMATABLE_PARAMS.reduce((groups, param) => {
    const list = groups.get(param.group) ?? [];
    list.push(param);
    groups.set(param.group, list);
    return groups;
  }, new Map<string, Model3DParamDescriptor[]>()),
);
