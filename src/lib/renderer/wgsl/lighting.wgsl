// Ghost WGSL stdlib: compact lighting helpers.

fn ghost_lambert(normal: vec3<f32>, lightDir: vec3<f32>) -> f32 {
  return max(dot(normalize(normal), normalize(lightDir)), 0.0);
}

fn ghost_blinn_specular(normal: vec3<f32>, lightDir: vec3<f32>, viewDir: vec3<f32>, shininess: f32) -> f32 {
  let h = normalize(normalize(lightDir) + normalize(viewDir));
  return pow(max(dot(normalize(normal), h), 0.0), max(shininess, 1.0));
}

fn ghost_fresnel(viewDir: vec3<f32>, normal: vec3<f32>, power: f32) -> f32 {
  return pow(1.0 - max(dot(normalize(viewDir), normalize(normal)), 0.0), max(power, 0.001));
}

fn ghost_apply_directional_light(
  baseColor: vec3<f32>,
  normal: vec3<f32>,
  lightDir: vec3<f32>,
  lightColor: vec3<f32>,
  ambient: f32,
  strength: f32,
) -> vec3<f32> {
  let diffuse = ambient + ghost_lambert(normal, lightDir) * strength;
  return baseColor * mix(vec3<f32>(1.0), lightColor, 0.6) * diffuse;
}
