// Ghost WGSL stdlib: compact lighting helpers.

const GHOST_LIGHT_PI: f32 = 3.141592653589793;

fn ghost_light_saturate(v: f32) -> f32 {
  return clamp(v, 0.0, 1.0);
}

fn ghost_light_saturate3(v: vec3<f32>) -> vec3<f32> {
  return clamp(v, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn ghost_safe_normalize3(v: vec3<f32>, fallback: vec3<f32>) -> vec3<f32> {
  let len2 = dot(v, v);
  if (len2 > 1e-8) {
    return v * inverseSqrt(len2);
  }
  return fallback;
}

fn ghost_lambert(normal: vec3<f32>, lightDir: vec3<f32>) -> f32 {
  return max(dot(normalize(normal), normalize(lightDir)), 0.0);
}

fn ghost_wrapped_lambert(normal: vec3<f32>, lightDir: vec3<f32>, wrap: f32) -> f32 {
  let ndotl = dot(ghost_safe_normalize3(normal, vec3<f32>(0.0, 0.0, 1.0)), ghost_safe_normalize3(lightDir, vec3<f32>(0.0, 0.0, 1.0)));
  let w = clamp(wrap, 0.0, 1.0);
  return clamp((ndotl + w) / (1.0 + w), 0.0, 1.0);
}

fn ghost_blinn_specular(normal: vec3<f32>, lightDir: vec3<f32>, viewDir: vec3<f32>, shininess: f32) -> f32 {
  let h = normalize(normalize(lightDir) + normalize(viewDir));
  return pow(max(dot(normalize(normal), h), 0.0), max(shininess, 1.0));
}

fn ghost_fresnel(viewDir: vec3<f32>, normal: vec3<f32>, power: f32) -> f32 {
  return pow(1.0 - max(dot(normalize(viewDir), normalize(normal)), 0.0), max(power, 0.001));
}

fn ghost_fresnel_schlick(f0: vec3<f32>, cosTheta: f32) -> vec3<f32> {
  let x = pow(1.0 - ghost_light_saturate(cosTheta), 5.0);
  return f0 + (vec3<f32>(1.0) - f0) * x;
}

fn ghost_ggx_distribution(ndoth: f32, roughness: f32) -> f32 {
  let r = clamp(roughness, 0.025, 1.0);
  let a = r * r;
  let a2 = a * a;
  let d = ndoth * ndoth * (a2 - 1.0) + 1.0;
  return a2 / max(GHOST_LIGHT_PI * d * d, 1e-5);
}

fn ghost_smith_ggx_visibility(ndotl: f32, ndotv: f32, roughness: f32) -> f32 {
  let r = clamp(roughness, 0.0, 1.0) + 1.0;
  let k = (r * r) * 0.125;
  let gl = ndotl / max(ndotl * (1.0 - k) + k, 1e-5);
  let gv = ndotv / max(ndotv * (1.0 - k) + k, 1e-5);
  return gl * gv;
}

fn ghost_rim_light(normal: vec3<f32>, viewDir: vec3<f32>, power: f32, amount: f32) -> f32 {
  return ghost_fresnel(viewDir, normal, power) * max(amount, 0.0);
}

fn ghost_pbr_directional_light(
  baseColor: vec3<f32>,
  normal: vec3<f32>,
  viewDir: vec3<f32>,
  lightDir: vec3<f32>,
  lightColor: vec3<f32>,
  roughness: f32,
  metallic: f32,
  ambient: f32,
  intensity: f32,
) -> vec3<f32> {
  let n = ghost_safe_normalize3(normal, vec3<f32>(0.0, 0.0, 1.0));
  let v = ghost_safe_normalize3(viewDir, vec3<f32>(0.0, 0.0, 1.0));
  let l = ghost_safe_normalize3(lightDir, vec3<f32>(0.0, 0.0, 1.0));
  let h = ghost_safe_normalize3(l + v, n);
  let ndotl = ghost_light_saturate(dot(n, l));
  let ndotv = max(ghost_light_saturate(dot(n, v)), 1e-4);
  let ndoth = ghost_light_saturate(dot(n, h));
  let vdoth = ghost_light_saturate(dot(v, h));
  let metal = ghost_light_saturate(metallic);
  let f0 = mix(vec3<f32>(0.04), ghost_light_saturate3(baseColor), metal);
  let f = ghost_fresnel_schlick(f0, vdoth);
  let d = ghost_ggx_distribution(ndoth, roughness);
  let g = ghost_smith_ggx_visibility(ndotl, ndotv, roughness);
  let specular = (d * g) * f / max(4.0 * ndotl * ndotv, 1e-4);
  let diffuse = (vec3<f32>(1.0) - f) * (1.0 - metal) * ghost_light_saturate3(baseColor) / GHOST_LIGHT_PI;
  let direct = (diffuse + specular) * lightColor * (ndotl * max(intensity, 0.0));
  let ambience = ghost_light_saturate3(baseColor) * max(ambient, 0.0) * (1.0 - metal * 0.25);
  return ambience + direct;
}

fn ghost_key_fill_rim_light(
  baseColor: vec3<f32>,
  normal: vec3<f32>,
  viewDir: vec3<f32>,
  keyDir: vec3<f32>,
  keyColor: vec3<f32>,
  fillColor: vec3<f32>,
  rimColor: vec3<f32>,
  ambient: f32,
  keyStrength: f32,
  fillStrength: f32,
  rimStrength: f32,
) -> vec3<f32> {
  let n = ghost_safe_normalize3(normal, vec3<f32>(0.0, 0.0, 1.0));
  let k = ghost_safe_normalize3(keyDir, vec3<f32>(0.45, 0.55, 0.7));
  let key = ghost_lambert(n, k) * max(keyStrength, 0.0);
  let fill = ghost_wrapped_lambert(n, -k, 0.65) * max(fillStrength, 0.0);
  let rim = ghost_rim_light(n, viewDir, 3.0, rimStrength);
  let lit = vec3<f32>(max(ambient, 0.0)) + keyColor * key + fillColor * fill;
  return baseColor * lit + rimColor * rim;
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
