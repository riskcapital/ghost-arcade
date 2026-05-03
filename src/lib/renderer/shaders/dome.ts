/**
 * Dome Projection Shaders
 * Fisheye, equirectangular, and domemaster reprojection
 * for hemispherical/dome projection output.
 *
 * Applied as a post-composition output transform (after all layers + watermark).
 */

export const domeProjectionShader = /* glsl */ `
  uniform sampler2D uTexture;      // Composited scene
  uniform vec2 uResolution;
  uniform float uFOV;              // Field of view in radians (pi = 180 degrees)
  uniform float uRotation;         // Dome rotation in radians
  uniform float uTilt;             // Dome tilt in radians
  uniform vec2 uOffset;            // Center offset (-1 to 1)
  uniform int uMode;               // 0=angular fisheye, 1=stereographic, 2=orthographic, 3=equirectangular
  uniform float uCurvature;        // Extra curvature control (0=flat, 1=full dome)
  uniform float uTruncation;       // Truncation angle as fraction of FOV (0.5 = half dome)
  varying vec2 vUv;

  #define PI 3.14159265359

  // Rotate a 2D point
  vec2 rotate2d(vec2 p, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  }

  void main() {
    // Map UV to centered coordinates (-1 to 1), accounting for aspect ratio
    float aspect = uResolution.x / uResolution.y;
    vec2 uv = (vUv - 0.5) * 2.0;

    // Force square mapping for domemaster output
    // (dome content is always circular in a square frame)
    if (aspect > 1.0) {
      uv.x *= aspect;
    } else {
      uv.y /= aspect;
    }

    // Apply center offset
    uv -= uOffset;

    // Apply rotation
    uv = rotate2d(uv, uRotation);

    // Distance from center
    float r = length(uv);
    float halfFOV = uFOV * 0.5;

    // Truncation: fade out beyond truncation angle
    float truncRadius = uTruncation;
    if (r > truncRadius) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }

    // Angular fisheye: r maps linearly to angle
    float theta;  // angle from center (0 = center, halfFOV = edge)
    float phi = atan(uv.y, uv.x);  // azimuthal angle

    int mode = uMode;

    if (mode == 0) {
      // Angular (equidistant) fisheye - standard planetarium/domemaster format
      // r maps linearly to angle: r=0 -> theta=0, r=1 -> theta=halfFOV
      theta = r * halfFOV;
    }
    else if (mode == 1) {
      // Stereographic fisheye - preserves shape better at edges
      theta = 2.0 * atan(r * tan(halfFOV * 0.5));
    }
    else if (mode == 2) {
      // Orthographic fisheye - less distortion at center
      theta = asin(min(r, 1.0)) * halfFOV / (PI * 0.5);
    }
    else {
      // Equirectangular (360 panoramic mapping)
      // Map x to longitude, y to latitude
      float lon = uv.x * PI;
      float lat = uv.y * PI * 0.5;
      // Convert spherical to direction, then to flat texture coords
      vec2 texUv = vec2(
        lon / PI * 0.5 + 0.5,
        lat / (PI * 0.5) * 0.5 + 0.5
      );
      texUv = clamp(texUv, 0.0, 1.0);
      gl_FragColor = texture2D(uTexture, texUv);
      return;
    }

    // Convert spherical angle back to flat texture coordinates
    // This is the inverse fisheye: dome angle -> flat source position
    // Apply tilt (rotate the sampling direction in 3D)
    float sinTheta = sin(theta);
    float cosTheta = cos(theta);

    // 3D direction on the dome
    vec3 dir = vec3(
      sinTheta * cos(phi),
      sinTheta * sin(phi),
      cosTheta
    );

    // Apply tilt around X axis
    float ct = cos(uTilt);
    float st = sin(uTilt);
    dir = vec3(
      dir.x,
      dir.y * ct - dir.z * st,
      dir.y * st + dir.z * ct
    );

    // Project back to 2D texture coordinates
    // Perspective projection from dome direction to flat source
    float z = max(dir.z, 0.001); // Prevent division by zero
    vec2 texUv = vec2(
      dir.x / z * 0.5 + 0.5,
      dir.y / z * 0.5 + 0.5
    );

    // Apply curvature blend: mix between flat (no reprojection) and full dome
    vec2 flatUv = vUv;
    texUv = mix(flatUv, texUv, uCurvature);

    // Clamp and sample
    texUv = clamp(texUv, 0.0, 1.0);

    vec4 color = texture2D(uTexture, texUv);

    // Vignette at dome edge for soft falloff
    float edgeFade = smoothstep(truncRadius, truncRadius - 0.05, r);
    color.rgb *= edgeFade;

    // Black outside the dome circle
    float circleMask = step(r, truncRadius);
    color.rgb *= circleMask;

    gl_FragColor = vec4(color.rgb, 1.0);
  }
`;
