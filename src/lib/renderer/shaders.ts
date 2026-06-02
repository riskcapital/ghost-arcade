// GLSL Shaders for warping and blend modes

export const warpVertexShader = /* glsl */ `
  varying vec2 vUv;

  // Corner positions in normalized space (0-1)
  uniform vec2 uTopLeft;
  uniform vec2 uTopRight;
  uniform vec2 uBottomLeft;
  uniform vec2 uBottomRight;

  // When true, use geometry position directly (for mesh warp mode)
  // When false, compute position from corner uniforms (for corner warp mode)
  uniform bool uUseMeshPosition;

  void main() {
    vUv = uv;

    vec2 clipPos;

    if (uUseMeshPosition) {
      // Mesh warp mode: geometry positions have been pre-computed by CPU
      // Position is already in clip space (-1 to 1)
      clipPos = position.xy;
    } else {
      // Corner warp mode: bilinear interpolation of corner positions
      vec2 top = mix(uTopLeft, uTopRight, uv.x);
      vec2 bottom = mix(uBottomLeft, uBottomRight, uv.x);
      vec2 pos = mix(bottom, top, uv.y);

      // Convert from 0-1 to -1 to 1 (clip space)
      clipPos = pos * 2.0 - 1.0;
    }

    gl_Position = vec4(clipPos, 0.0, 1.0);
  }
`;

export const textureFragmentShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uOpacity;
  // Luminance-keyed background opacity. Default 1.0 = bg fully opaque
  // (no keying). Lower values fade the alpha proportionally to the
  // pixel's brightness, so dark areas become transparent while
  // bright content stays solid. Used by GPU shader layers (set per-
  // layer via gpuLayerContent.bgOpacity) to "key out" their dark
  // background so the layer below shows through. All other layer
  // types leave it at 1.0.
  uniform float uBgOpacity;
  uniform vec4 uCropRegion; // x, y, width, height (0-1 normalized)
  uniform bool uCropEnabled;
  uniform int uLayerShapeType; // 0=rectangle, 1=circle, 2=triangle
  uniform float uLayerShapeFeather;
  uniform float uLayerShapeRotation;
  uniform float uLayerShapeScale;
  uniform int uLayerShapeHasControlPoints;
  uniform int uLayerShapeControlPointCount;
  uniform vec2 uLayerShapeControlPoints[5];
  uniform bool uFlipH;
  uniform bool uFlipV;
  uniform int uContentFit;      // 0=stretch, 1=fill (cover), 2=crop (contain)
  uniform float uSourceAspect;  // source width / height
  uniform float uLayerAspect;   // layer quad width / height
  // Custom shape polygon (evaluated in UV space so it warps with geometry)
  uniform int uCustomShapeEnabled;
  uniform int uCustomShapePointCount;
  uniform vec2 uCustomShapePoints[256];
  uniform int uCustomShapeFit;      // 0=mask (clip only), 1=warp (stretch to bbox), 2=fill (aspect-fit to bbox)
  uniform vec4 uCustomShapeBBox;    // vec4(minX, minY, maxX, maxY) of the polygon
  uniform int uCustomShapeInvert;   // 0=normal (show inside shape), 1=invert (show outside / cutout)
  varying vec2 vUv;

  vec2 rotate2D(vec2 p, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  }

  float distToSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }

  bool pointInTriangle(vec2 p, vec2 a, vec2 b, vec2 c) {
    vec2 v0 = c - a;
    vec2 v1 = b - a;
    vec2 v2 = p - a;
    float dot00 = dot(v0, v0);
    float dot01 = dot(v0, v1);
    float dot02 = dot(v0, v2);
    float dot11 = dot(v1, v1);
    float dot12 = dot(v1, v2);
    float invDenom = 1.0 / (dot00 * dot11 - dot01 * dot01);
    float u = (dot11 * dot02 - dot01 * dot12) * invDenom;
    float v = (dot00 * dot12 - dot01 * dot02) * invDenom;
    return (u >= 0.0) && (v >= 0.0) && (u + v <= 1.0);
  }

  float sdTriangleFromPoints(vec2 p, vec2 a, vec2 b, vec2 c) {
    float d = min(min(distToSegment(p, a, b), distToSegment(p, b, c)), distToSegment(p, c, a));
    return pointInTriangle(p, a, b, c) ? -d : d;
  }

  vec3 barycentric(vec2 p, vec2 a, vec2 b, vec2 c) {
    vec2 v0 = b - a;
    vec2 v1 = c - a;
    vec2 v2 = p - a;
    float d00 = dot(v0, v0);
    float d01 = dot(v0, v1);
    float d11 = dot(v1, v1);
    float d20 = dot(v2, v0);
    float d21 = dot(v2, v1);
    float denom = d00 * d11 - d01 * d01;
    float v = (d11 * d20 - d01 * d21) / denom;
    float w = (d00 * d21 - d01 * d20) / denom;
    float u = 1.0 - v - w;
    return vec3(u, v, w);
  }

  // Inverse bilinear interpolation for editable circle control points.
  vec2 inverseWarp(vec2 p, vec2 tl, vec2 tr, vec2 bl, vec2 br) {
    vec2 uv = vec2(0.5, 0.5);
    for (int i = 0; i < 6; i++) {
      vec2 top = mix(tl, tr, uv.x);
      vec2 bottom = mix(bl, br, uv.x);
      vec2 predicted = mix(top, bottom, uv.y);
      vec2 error = p - predicted;

      vec2 dTop = tr - tl;
      vec2 dBottom = br - bl;
      vec2 dX = mix(dTop, dBottom, uv.y);
      vec2 dY = bottom - top;

      float det = dX.x * dY.y - dX.y * dY.x;
      if (abs(det) < 0.00001) break;

      vec2 delta = vec2(
        (error.x * dY.y - error.y * dY.x) / det,
        (dX.x * error.y - dX.y * error.x) / det
      );
      uv += delta;
    }
    return uv;
  }

  // Custom shape: ray-casting point-in-polygon test (tessellated bezier)
  float customPointInPolygon(vec2 p) {
    if (uCustomShapePointCount < 3) return 0.0;
    int crossings = 0;
    for (int i = 0; i < 256; i++) {
      if (i >= uCustomShapePointCount) break;
      int j = i + 1;
      if (j >= uCustomShapePointCount) j = 0;
      vec2 p1 = uCustomShapePoints[i];
      vec2 p2 = uCustomShapePoints[j];
      if (((p1.y <= p.y && p2.y > p.y) || (p1.y > p.y && p2.y <= p.y)) &&
          (p.x < (p2.x - p1.x) * (p.y - p1.y) / (p2.y - p1.y) + p1.x)) {
        crossings++;
      }
    }
    return mod(float(crossings), 2.0);
  }

  // Custom shape: minimum distance to polygon edge (tessellated bezier)
  float customDistToEdge(vec2 p) {
    if (uCustomShapePointCount < 3) return 1.0;
    float minDist = 1000.0;
    for (int i = 0; i < 256; i++) {
      if (i >= uCustomShapePointCount) break;
      int j = i + 1;
      if (j >= uCustomShapePointCount) j = 0;
      vec2 a = uCustomShapePoints[i];
      vec2 b = uCustomShapePoints[j];
      vec2 ab = b - a;
      vec2 ap = p - a;
      float t = clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0);
      float dist = length(p - (a + t * ab));
      minDist = min(minDist, dist);
    }
    return minDist;
  }

  void main() {
    vec2 layerUv = vUv;
    if (uFlipH) layerUv.x = 1.0 - layerUv.x;
    if (uFlipV) layerUv.y = 1.0 - layerUv.y;
    vec2 sampledUv = layerUv;

    // Content fit mode: adjust UVs to maintain source aspect ratio
    if (uContentFit > 0 && uSourceAspect > 0.0 && uLayerAspect > 0.0) {
      float ratio = uSourceAspect / uLayerAspect;
      if (uContentFit == 1) {
        // Fill (cover): scale to fill, crop overflow
        if (ratio > 1.0) {
          // Source wider than layer - crop sides
          sampledUv.x = (sampledUv.x - 0.5) / ratio + 0.5;
        } else {
          // Source taller than layer - crop top/bottom
          sampledUv.y = (sampledUv.y - 0.5) * ratio + 0.5;
        }
      } else if (uContentFit == 2) {
        // Crop (contain): fit inside, letterbox
        if (ratio > 1.0) {
          // Source wider - fit width, letterbox top/bottom
          sampledUv.y = (sampledUv.y - 0.5) * ratio + 0.5;
        } else {
          // Source taller - fit height, pillarbox sides
          sampledUv.x = (sampledUv.x - 0.5) / ratio + 0.5;
        }
      }
    }

    // Shape-specific UV warping for editable control points.
    if (uLayerShapeType == 1 && uLayerShapeHasControlPoints == 1 && uLayerShapeControlPointCount >= 5) {
      vec2 tl = uLayerShapeControlPoints[0];
      vec2 tr = uLayerShapeControlPoints[1];
      vec2 bl = uLayerShapeControlPoints[2];
      vec2 br = uLayerShapeControlPoints[3];
      vec2 center = uLayerShapeControlPoints[4];
      sampledUv = inverseWarp(layerUv, tl, tr, bl, br);
      vec2 centerOffset = center - vec2(0.5);
      float centerWeight = 1.0 - smoothstep(0.0, 0.5, length(layerUv - vec2(0.5)));
      sampledUv -= centerOffset * centerWeight * 0.6;
    } else if (uLayerShapeType == 2 && uLayerShapeHasControlPoints == 1 && uLayerShapeControlPointCount >= 3) {
      vec2 a = uLayerShapeControlPoints[0];
      vec2 b = uLayerShapeControlPoints[1];
      vec2 c = uLayerShapeControlPoints[2];
      vec3 bc = barycentric(layerUv, a, b, c);
      if (bc.x >= 0.0 && bc.y >= 0.0 && bc.z >= 0.0) {
        vec2 d0 = vec2(0.5, 0.88);
        vec2 d1 = vec2(0.14, 0.14);
        vec2 d2 = vec2(0.86, 0.14);
        sampledUv = d0 * bc.x + d1 * bc.y + d2 * bc.z;
      }
    }

    if (uCropEnabled) {
      sampledUv = uCropRegion.xy + sampledUv * uCropRegion.zw;
    }

    // Custom shape UV remapping: stretch/fill texture to polygon bounding box.
    // Skipped entirely when invert is ON — in cutout/negative-space mode the
    // visible region is OUTSIDE the polygon (often most of the layer quad),
    // and bbox-relative UVs would extrapolate way past 0..1 and produce ugly
    // stretched/repeated artifacts. With inversion the texture should fill
    // the whole layer naturally and the polygon just punches a hole through it.
    if (uCustomShapeEnabled == 1 && uCustomShapeFit > 0 && uCustomShapePointCount >= 3 && uCustomShapeInvert == 0) {
      vec2 bbMin = uCustomShapeBBox.xy;
      vec2 bbSize = uCustomShapeBBox.zw - uCustomShapeBBox.xy;
      if (bbSize.x > 0.001 && bbSize.y > 0.001) {
        if (uCustomShapeFit == 1) {
          // Warp: stretch texture to fill the polygon's bounding box
          sampledUv = (layerUv - bbMin) / bbSize;
        } else if (uCustomShapeFit == 2) {
          // Fill: maintain source aspect ratio, use bbox top/bottom as height guide
          float bboxAspect = bbSize.x / bbSize.y;
          float sourceAspect = uSourceAspect > 0.0 ? uSourceAspect : 1.0;
          // Normalize within bbox first
          vec2 bboxUv = (layerUv - bbMin) / bbSize;
          float ratio = sourceAspect / bboxAspect;
          if (ratio > 1.0) {
            // Source wider than bbox - crop sides, fit height
            bboxUv.x = (bboxUv.x - 0.5) / ratio + 0.5;
          } else {
            // Source taller than bbox - crop top/bottom, fit width
            bboxUv.y = (bboxUv.y - 0.5) * ratio + 0.5;
          }
          sampledUv = bboxUv;
        }
      }
    }

    // For contain mode (crop), show transparent black for out-of-bounds UVs (letterbox/pillarbox)
    float contentMask = 1.0;
    if (uContentFit == 2) {
      if (sampledUv.x < 0.0 || sampledUv.x > 1.0 || sampledUv.y < 0.0 || sampledUv.y > 1.0) {
        contentMask = 0.0;
      }
    }

    // Allow content to extend beyond bounds — use edge texels for overflow
    // instead of hard clamping (enables stretching outside rectangle)
    vec4 texColor = texture2D(uTexture, sampledUv);

    float mask = 1.0;
    float feather = max(uLayerShapeFeather, 0.0);
    float safeScale = max(uLayerShapeScale, 0.0001);

    if (uLayerShapeType == 1) {
      if (uLayerShapeHasControlPoints == 1 && uLayerShapeControlPointCount >= 5) {
        vec2 tl = uLayerShapeControlPoints[0];
        vec2 tr = uLayerShapeControlPoints[1];
        vec2 bl = uLayerShapeControlPoints[2];
        vec2 br = uLayerShapeControlPoints[3];
        vec2 center = uLayerShapeControlPoints[4];
        vec2 circleUv = inverseWarp(layerUv, tl, tr, bl, br);
        vec2 centerOffset = center - vec2(0.5);
        float centerWeight = 1.0 - smoothstep(0.0, 0.5, length(layerUv - vec2(0.5)));
        circleUv -= centerOffset * centerWeight * 0.6;
        float dist = length(circleUv - vec2(0.5)) - 0.5;
        // Feather is one-sided: full visibility well inside (dist <= -feather),
      // smooth fade across the inner band (-feather..0), and hard transparent
      // outside the boundary (dist >= 0). Symmetric smoothstep would bleed
      // the feather outward as well, creating a halo beyond the mask edge.
      mask = feather > 0.001 ? 1.0 - smoothstep(-feather, 0.0, dist) : (dist < 0.0 ? 1.0 : 0.0);
      } else {
        vec2 p = (layerUv - 0.5) / safeScale;
        p = rotate2D(p, -uLayerShapeRotation);
        float dist = length(p) - 0.5;
        // Feather is one-sided: full visibility well inside (dist <= -feather),
      // smooth fade across the inner band (-feather..0), and hard transparent
      // outside the boundary (dist >= 0). Symmetric smoothstep would bleed
      // the feather outward as well, creating a halo beyond the mask edge.
      mask = feather > 0.001 ? 1.0 - smoothstep(-feather, 0.0, dist) : (dist < 0.0 ? 1.0 : 0.0);
      }
    } else if (uLayerShapeType == 2) {
      float dist = 1.0;
      if (uLayerShapeHasControlPoints == 1 && uLayerShapeControlPointCount >= 3) {
        vec2 a = uLayerShapeControlPoints[0];
        vec2 b = uLayerShapeControlPoints[1];
        vec2 c = uLayerShapeControlPoints[2];
        dist = sdTriangleFromPoints(layerUv, a, b, c);
      } else {
        vec2 p = rotate2D((layerUv - 0.5) / safeScale, -uLayerShapeRotation) + 0.5;
        vec2 a = vec2(0.5, 0.88);
        vec2 b = vec2(0.14, 0.14);
        vec2 c = vec2(0.86, 0.14);
        dist = sdTriangleFromPoints(p, a, b, c);
      }
      // Feather is one-sided: full visibility well inside (dist <= -feather),
      // smooth fade across the inner band (-feather..0), and hard transparent
      // outside the boundary (dist >= 0). Symmetric smoothstep would bleed
      // the feather outward as well, creating a halo beyond the mask edge.
      mask = feather > 0.001 ? 1.0 - smoothstep(-feather, 0.0, dist) : (dist < 0.0 ? 1.0 : 0.0);
    }

    // Custom shape polygon mask (evaluated in UV space so it warps with geometry).
    // Feather is one-sided: only fades the INSIDE edge. Outside the polygon is
    // always fully transparent — no outward bleed.
    // When uCustomShapeInvert==1, we flip the mask so the polygon punches a hole
    // (cutout / negative space) and the area OUTSIDE the polygon shows the layer.
    if (uCustomShapeEnabled == 1 && uCustomShapePointCount >= 3) {
      float inside = customPointInPolygon(layerUv);
      float customMask;
      if (feather > 0.001 && inside > 0.5) {
        float dist = customDistToEdge(layerUv);
        customMask = smoothstep(0.0, feather, dist);
      } else {
        customMask = inside;
      }
      if (uCustomShapeInvert == 1) {
        customMask = 1.0 - customMask;
      }
      mask *= customMask;
    }

    // BG keying: mix(luma, 1.0, uBgOpacity). When uBgOpacity=1 the
    // key is a no-op; at 0 the alpha collapses to the pixel's value
    // channel so black is transparent and bright stays opaque. The
    // mix gives the user a continuous fade between the two.
    float bgLuma = max(max(texColor.r, texColor.g), texColor.b);
    float bgKey = mix(bgLuma, 1.0, uBgOpacity);
    gl_FragColor = vec4(texColor.rgb, texColor.a * uOpacity * mask * contentMask * bgKey);
  }
`;

// Blend mode shaders - composite layer onto base
export const blendShaders: Record<string, string> = {
  normal: /* glsl */ `
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, layer.rgb, a), max(base.a, a));
    }
  `,

  multiply: /* glsl */ `
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = base.rgb * layer.rgb;
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,

  screen: /* glsl */ `
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = 1.0 - (1.0 - base.rgb) * (1.0 - layer.rgb);
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,

  difference: /* glsl */ `
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = abs(base.rgb - layer.rgb);
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,

  add: /* glsl */ `
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = min(base.rgb + layer.rgb, 1.0);
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,

  subtract: /* glsl */ `
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = max(base.rgb - layer.rgb, 0.0);
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,

  overlay: /* glsl */ `
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    vec3 overlay(vec3 base, vec3 blend) {
      return vec3(
        base.r < 0.5 ? 2.0 * base.r * blend.r : 1.0 - 2.0 * (1.0 - base.r) * (1.0 - blend.r),
        base.g < 0.5 ? 2.0 * base.g * blend.g : 1.0 - 2.0 * (1.0 - base.g) * (1.0 - blend.g),
        base.b < 0.5 ? 2.0 * base.b * blend.b : 1.0 - 2.0 * (1.0 - base.b) * (1.0 - blend.b)
      );
    }

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = overlay(base.rgb, layer.rgb);
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,

  darken: /* glsl */ `
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = min(base.rgb, layer.rgb);
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,

  lighten: /* glsl */ `
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = max(base.rgb, layer.rgb);
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,

  exclusion: /* glsl */ `
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = base.rgb + layer.rgb - (2.0 * base.rgb * layer.rgb);
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,

  hardlight: /* glsl */ `
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 lo = 2.0 * base.rgb * layer.rgb;
      vec3 hi = 1.0 - (2.0 * (1.0 - base.rgb) * (1.0 - layer.rgb));
      vec3 blended = mix(lo, hi, step(vec3(0.5), layer.rgb));
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,

  softlight: /* glsl */ `
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = ((1.0 - 2.0 * layer.rgb) * base.rgb * base.rgb) + (2.0 * layer.rgb * base.rgb);
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, clamp(blended, 0.0, 1.0), a), max(base.a, a));
    }
  `,

  'color-dodge': /* glsl */ `
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = base.rgb / max(vec3(1.0) - layer.rgb, vec3(0.001));
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, clamp(blended, 0.0, 1.0), a), max(base.a, a));
    }
  `,

  'color-burn': /* glsl */ `
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = 1.0 - ((1.0 - base.rgb) / max(layer.rgb, vec3(0.001)));
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, clamp(blended, 0.0, 1.0), a), max(base.a, a));
    }
  `,

  hue: /* glsl */ `
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    vec3 rgb2hsv(vec3 c) {
      vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
      vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
      vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
      float d = q.x - min(q.w, q.y);
      float e = 1.0e-10;
      return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
    }
    vec3 hsv2rgb(vec3 c) {
      vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
      vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
      return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    }

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 bh = rgb2hsv(base.rgb);
      vec3 lh = rgb2hsv(layer.rgb);
      vec3 blended = hsv2rgb(vec3(lh.x, bh.y, bh.z));
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,

  saturation: /* glsl */ `
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    vec3 rgb2hsv(vec3 c) {
      vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
      vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
      vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
      float d = q.x - min(q.w, q.y);
      float e = 1.0e-10;
      return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
    }
    vec3 hsv2rgb(vec3 c) {
      vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
      vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
      return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    }

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 bh = rgb2hsv(base.rgb);
      vec3 lh = rgb2hsv(layer.rgb);
      vec3 blended = hsv2rgb(vec3(bh.x, lh.y, bh.z));
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,

  color: /* glsl */ `
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    vec3 rgb2hsv(vec3 c) {
      vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
      vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
      vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
      float d = q.x - min(q.w, q.y);
      float e = 1.0e-10;
      return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
    }
    vec3 hsv2rgb(vec3 c) {
      vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
      vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
      return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    }

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 bh = rgb2hsv(base.rgb);
      vec3 lh = rgb2hsv(layer.rgb);
      vec3 blended = hsv2rgb(vec3(lh.x, lh.y, bh.z));
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,

  luminosity: /* glsl */ `
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    vec3 rgb2hsv(vec3 c) {
      vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
      vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
      vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
      float d = q.x - min(q.w, q.y);
      float e = 1.0e-10;
      return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
    }
    vec3 hsv2rgb(vec3 c) {
      vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
      vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
      return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    }

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 bh = rgb2hsv(base.rgb);
      vec3 lh = rgb2hsv(layer.rgb);
      vec3 blended = hsv2rgb(vec3(bh.x, bh.y, lh.z));
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,

  divide: /* glsl */ `
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = base.rgb / max(layer.rgb, vec3(0.001));
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, clamp(blended, 0.0, 1.0), a), max(base.a, a));
    }
  `,

  average: /* glsl */ `
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = (base.rgb + layer.rgb) * 0.5;
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,

  negation: /* glsl */ `
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = 1.0 - abs(1.0 - base.rgb - layer.rgb);
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, clamp(blended, 0.0, 1.0), a), max(base.a, a));
    }
  `,

  phoenix: /* glsl */ `
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = min(base.rgb, layer.rgb) - max(base.rgb, layer.rgb) + 1.0;
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, clamp(blended, 0.0, 1.0), a), max(base.a, a));
    }
  `,

  'linear-light': /* glsl */ `
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 blended = clamp(base.rgb + (2.0 * layer.rgb) - 1.0, 0.0, 1.0);
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,

  'hard-mix': /* glsl */ `
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 linearLight = clamp(base.rgb + (2.0 * layer.rgb) - 1.0, 0.0, 1.0);
      vec3 blended = step(vec3(0.5), linearLight);
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,

  'vivid-light': /* glsl */ `
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 burn = 1.0 - ((1.0 - base.rgb) / max(2.0 * layer.rgb, vec3(0.001)));
      vec3 dodge = base.rgb / max(2.0 * (1.0 - layer.rgb), vec3(0.001));
      vec3 blended = clamp(mix(burn, dodge, step(vec3(0.5), layer.rgb)), 0.0, 1.0);
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,

  'pin-light': /* glsl */ `
    uniform sampler2D uBase;
    uniform sampler2D uLayer;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(uBase, vUv);
      vec4 layer = texture2D(uLayer, vUv);
      vec3 low = min(base.rgb, 2.0 * layer.rgb);
      vec3 high = max(base.rgb, (2.0 * layer.rgb) - 1.0);
      vec3 blended = clamp(mix(low, high, step(vec3(0.5), layer.rgb)), 0.0, 1.0);
      float a = layer.a * uOpacity;
      gl_FragColor = vec4(mix(base.rgb, blended, a), max(base.a, a));
    }
  `,
};

// Simple passthrough for compositing
export const passthroughVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Final output shader - forces alpha to 1.0 to fix faded recording issues
// When canvas has alpha enabled, captureStream can pick up transparency
// This shader ensures the final output is always fully opaque
export const opaqueOutputFragmentShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec4 uOutputCrop;
  uniform int uOutputRotation;
  uniform float uBrightness;
  uniform float uContrast;
  uniform float uGamma;
  varying vec2 vUv;

  vec2 rotateUv(vec2 uv) {
    if (uOutputRotation == 1) {
      return vec2(uv.y, 1.0 - uv.x);
    }
    if (uOutputRotation == 2) {
      return vec2(1.0 - uv.x, 1.0 - uv.y);
    }
    if (uOutputRotation == 3) {
      return vec2(1.0 - uv.y, uv.x);
    }
    return uv;
  }

  void main() {
    vec2 uv = rotateUv(vUv);
    uv = uOutputCrop.xy + uv * uOutputCrop.zw;

    vec4 color = texture2D(uTexture, clamp(uv, 0.0, 1.0));
    vec3 corrected = color.rgb * uBrightness;
    corrected = (corrected - 0.5) * uContrast + 0.5;
    corrected = pow(max(corrected, vec3(0.0)), vec3(max(uGamma, 0.001)));
    gl_FragColor = vec4(clamp(corrected, 0.0, 1.0), 1.0);
  }
`;

// Grid for mesh warping (Phase 2)
export const meshWarpVertexShader = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uMeshPositions;
  uniform vec2 uGridSize;

  void main() {
    vUv = uv;

    // Sample the mesh position from the texture
    vec4 meshPos = texture2D(uMeshPositions, uv);
    vec2 pos = meshPos.xy;

    vec2 clipPos = pos * 2.0 - 1.0;
    gl_Position = vec4(clipPos, 0.0, 1.0);
  }
`;
