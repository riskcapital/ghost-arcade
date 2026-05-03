// Drawing Renderer - WebGL-based shape rendering with animated effects
import * as THREE from 'three';
import type {
  DrawingLayer,
  DrawingElement,
  Shape,
  CircleShape,
  RectangleShape,
  TriangleShape,
  PolygonShape,
  StarShape,
  RingShape,
  SpiralShape,
  GlowStroke,
  NeonStroke,
  SnakeStroke,
  ConcentricAnimation,
  SolidFill,
  PlasmaFill,
} from './types';
import type { Point2D } from '../types';

// ============================================================================
// SHADER CODE
// ============================================================================

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform vec2 uResolution;

  // Shape uniforms
  uniform int uShapeType;
  uniform vec2 uShapeCenter;
  uniform float uShapeRadius;
  uniform float uShapeRotation;
  uniform vec2 uShapeScale;
  uniform int uShapeSides;
  uniform float uInnerRadius;
  uniform float uWidth;
  uniform float uHeight;

  // Per-shape corner warp uniforms
  uniform bool uWarpEnabled;
  uniform vec2 uWarpTL;  // Top-left corner offset
  uniform vec2 uWarpTR;  // Top-right corner offset
  uniform vec2 uWarpBL;  // Bottom-left corner offset
  uniform vec2 uWarpBR;  // Bottom-right corner offset

  // Per-shape mesh warp uniforms (up to 4x4 = 16 points)
  uniform bool uMeshWarpEnabled;
  uniform int uMeshRows;
  uniform int uMeshCols;
  uniform vec2 uMeshPoints[16];  // Flattened grid: row * cols + col

  // Custom vertex uniforms (for warped/arbitrary polygon shapes)
  uniform bool uUseCustomVertices;
  uniform int uCustomVertexCount;
  uniform vec2 uCustomVertices[64];  // Up to 64 vertices for arbitrary polygons
  uniform bool uCustomVerticesClosed;  // Whether the polygon is closed

  // Stroke uniforms
  uniform int uStrokeType;
  uniform vec4 uStrokeColor;
  uniform float uStrokeWidth;
  uniform float uGlowSize;
  uniform float uGlowIntensity;
  uniform float uPulseSpeed;
  uniform float uSnakeLength;
  uniform float uSnakeSpeed;
  uniform int uSnakeCount;

  // Fill uniforms
  uniform int uFillType;
  uniform vec4 uFillColor;
  uniform float uFillSpeed;

  // Animation uniforms
  uniform int uAnimationType;
  uniform float uAnimCount;
  uniform float uAnimSpacing;
  uniform float uAnimSpeed;
  uniform int uConcentricDirection;  // 0 = out, 1 = in, 2 = both

  // Extended stroke uniforms
  uniform float uDashLength;     // Dashed stroke dash length
  uniform float uGapLength;      // Dashed stroke gap length
  uniform float uElectricArc;    // Electric stroke arc intensity
  uniform float uElectricBranches; // Electric stroke branch count
  uniform float uScannerBeamWidth; // Scanner beam width
  uniform float uScannerTrail;    // Scanner trail length
  uniform float uStrobeRate;      // Strobe on/off rate

  // Extended fill uniforms
  uniform float uNoiseScale;      // Noise fill scale
  uniform float uNoiseTurbulence; // Noise fill turbulence
  uniform float uHoloShift;       // Holographic hue shift
  uniform float uHoloScanlines;   // Holographic scanline count
  uniform float uGradAngle;       // Gradient fill angle

  // Enhanced fill parameter uniforms
  uniform float uPlasmaScale;     // Plasma spatial scale
  uniform float uPlasmaComplexity; // Plasma wave complexity
  uniform int uPlasmaPalette;     // Plasma color palette (0=rainbow,1=fire,2=ocean,3=neon)
  uniform float uLiquidViscosity; // Liquid distortion amount
  uniform float uLiquidTurbulence; // Liquid noise turbulence
  uniform float uLiquidMetallic;  // Liquid metallic highlight intensity
  uniform float uFireIntensity;   // Fire brightness
  uniform float uFireTurbulence;  // Fire turbulence amount
  uniform int uFirePalette;       // Fire palette (0=orange,1=blue,2=green,3=purple)
  uniform float uElectricIntensity; // Electric fill bolt intensity
  uniform float uElectricArcCount;  // Electric fill arc density
  uniform float uHoloFlicker;     // Holographic flicker amount
  uniform vec4 uNoiseColor2;      // Noise fill second color
  uniform vec4 uGradColor2;       // Gradient fill second color
  uniform int uGradType;          // Gradient type (0=linear, 1=radial, 2=angular)

  // Extended animation uniforms
  uniform float uBreatheMin;      // Breathe min scale
  uniform float uBreatheMax;      // Breathe max scale
  uniform float uRotateSpeed;     // Rotate speed
  uniform int uRotateDir;         // Rotate direction (0=cw, 1=ccw)
  uniform float uWaveAmplitude;   // Wave amplitude
  uniform float uWaveFrequency;   // Wave frequency
  uniform float uRippleDecay;     // Ripple decay
  uniform float uGlitchIntensity; // Glitch intensity
  uniform float uGlitchBlockSize; // Glitch block size

  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  // ========== UTILITY FUNCTIONS ==========

  float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  // Inverse bilinear interpolation - find UV from warped position
  // Given a point p and four corners, find the corresponding UV (0-1) in the original quad
  vec2 inverseWarp(vec2 p, vec2 tl, vec2 tr, vec2 bl, vec2 br) {
    // Use iterative approach for inverse bilinear interpolation
    vec2 uv = vec2(0.5, 0.5);

    for (int i = 0; i < 8; i++) {
      // Forward bilinear interpolation
      vec2 top = mix(tl, tr, uv.x);
      vec2 bottom = mix(bl, br, uv.x);
      vec2 predicted = mix(top, bottom, uv.y);

      // Compute error
      vec2 error = p - predicted;

      // Compute Jacobian
      vec2 dTop = tr - tl;
      vec2 dBottom = br - bl;
      vec2 dX = mix(dTop, dBottom, uv.y);
      vec2 dY = bottom - top;

      // Solve 2x2 system using Cramer's rule
      float det = dX.x * dY.y - dX.y * dY.x;
      if (abs(det) < 0.0001) break;

      vec2 delta = vec2(
        (error.x * dY.y - error.y * dY.x) / det,
        (dX.x * error.y - dX.y * error.x) / det
      );

      uv += delta;
    }

    return uv;
  }

  // Inverse mesh warp - find the original UV from warped position
  // Uses iterative Newton-Raphson approach within mesh cells
  vec2 inverseMeshWarp(vec2 p, int rows, int cols) {
    // Initial guess - the input position
    vec2 uv = clamp(p, 0.0, 1.0);

    for (int iter = 0; iter < 8; iter++) {
      // Find which cell we're in based on current UV guess
      float cellX = uv.x * float(cols - 1);
      float cellY = uv.y * float(rows - 1);
      int col0 = int(floor(cellX));
      int row0 = int(floor(cellY));
      col0 = clamp(col0, 0, cols - 2);
      row0 = clamp(row0, 0, rows - 2);

      // Local coords within cell (0-1)
      float tx = cellX - float(col0);
      float ty = cellY - float(row0);

      // Get the 4 corners of this cell
      int i00 = row0 * cols + col0;
      int i10 = row0 * cols + col0 + 1;
      int i01 = (row0 + 1) * cols + col0;
      int i11 = (row0 + 1) * cols + col0 + 1;

      vec2 p00 = uMeshPoints[i00];
      vec2 p10 = uMeshPoints[i10];
      vec2 p01 = uMeshPoints[i01];
      vec2 p11 = uMeshPoints[i11];

      // Bilinear interpolation to get predicted position
      vec2 top = mix(p00, p10, tx);
      vec2 bottom = mix(p01, p11, tx);
      vec2 predicted = mix(top, bottom, ty);

      // Compute error
      vec2 error = p - predicted;
      if (length(error) < 0.0001) break;

      // Compute Jacobian for the cell
      vec2 dTop = p10 - p00;
      vec2 dBottom = p11 - p01;
      vec2 dX = mix(dTop, dBottom, ty) * float(cols - 1);
      vec2 dY = (bottom - top) * float(rows - 1);

      // Solve 2x2 system
      float det = dX.x * dY.y - dX.y * dY.x;
      if (abs(det) < 0.0001) break;

      vec2 delta = vec2(
        (error.x * dY.y - error.y * dY.x) / det,
        (dX.x * error.y - dX.y * error.x) / det
      );

      uv += delta;
      uv = clamp(uv, 0.0, 1.0);
    }

    return uv;
  }

  mat2 rotate2d(float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return mat2(c, -s, s, c);
  }

  // ========== SDF FUNCTIONS ==========

  float sdCircle(vec2 p, float r) {
    return length(p) - r;
  }

  float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  }

  float sdEquilateralTriangle(vec2 p, float r) {
    const float k = sqrt(3.0);
    p.x = abs(p.x) - r;
    p.y = p.y + r / k;
    if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
    p.x -= clamp(p.x, -2.0 * r, 0.0);
    return -length(p) * sign(p.y);
  }

  float sdPolygon(vec2 p, float r, int sides) {
    float a = atan(p.x, p.y) + PI;
    float seg = TAU / float(sides);
    a = mod(a, seg) - seg * 0.5;
    return length(p) * cos(a) - r * cos(PI / float(sides));
  }

  float sdStar(vec2 p, float r1, float r2, int n) {
    float an = PI / float(n);
    float en = PI / float(n * 2);
    vec2 acs = vec2(cos(an), sin(an));
    vec2 ecs = vec2(cos(en), sin(en));

    float bn = mod(atan(p.x, p.y), 2.0 * an) - an;
    p = length(p) * vec2(cos(bn), abs(sin(bn)));

    p -= r1 * acs;
    p += ecs * clamp(-dot(p, ecs), 0.0, r1 * acs.y / ecs.y);
    return length(p) * sign(p.x);
  }

  float sdRing(vec2 p, float r1, float r2) {
    return abs(length(p) - (r1 + r2) * 0.5) - abs(r1 - r2) * 0.5;
  }

  float sdLine(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }

  float sdSpiral(vec2 p, float turns, float r1, float r2) {
    float angle = atan(p.y, p.x);
    float dist = length(p);
    float minDist = 1000.0;

    for (float i = -1.0; i <= turns; i += 1.0) {
      float a = angle + i * TAU;
      float t = clamp(a / (turns * TAU), 0.0, 1.0);
      float targetR = mix(r1, r2, t);
      minDist = min(minDist, abs(dist - targetR));
    }

    return minDist;
  }

  // SDF for arbitrary polygon using edge distances
  float sdPolygonCustom(vec2 p, int count, bool closed) {
    if (count < 2) return 1000.0;

    float minDist = 1000.0;
    float sign = 1.0;
    int numEdges = closed ? count : count - 1;

    // For closed polygons, compute winding number
    if (closed) {
      float winding = 0.0;
      for (int i = 0; i < 64; i++) {
        if (i >= count) break;
        int j = (i + 1 < count) ? i + 1 : 0;
        vec2 a = uCustomVertices[i];
        vec2 b = uCustomVertices[j];

        // Distance to edge
        vec2 pa = p - a;
        vec2 ba = b - a;
        float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        float d = length(pa - ba * h);
        minDist = min(minDist, d);

        // Winding number contribution
        if (a.y <= p.y) {
          if (b.y > p.y) {
            if ((b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) > 0.0) {
              winding += 1.0;
            }
          }
        } else {
          if (b.y <= p.y) {
            if ((b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) < 0.0) {
              winding -= 1.0;
            }
          }
        }
      }
      sign = winding != 0.0 ? -1.0 : 1.0;
    } else {
      // Open polyline - just compute distance to edges
      for (int i = 0; i < 63; i++) {
        if (i >= count - 1) break;
        vec2 a = uCustomVertices[i];
        vec2 b = uCustomVertices[i + 1];

        vec2 pa = p - a;
        vec2 ba = b - a;
        float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        float d = length(pa - ba * h);
        minDist = min(minDist, d);
      }
    }

    return sign * minDist;
  }

  // Calculate path position along custom polygon (0-1) for animated effects
  float getCustomPolygonPathPos(vec2 p, int count, bool closed) {
    if (count < 2) return 0.0;

    float totalLen = 0.0;
    float closestDist = 1000.0;
    float closestLen = 0.0;

    int numEdges = closed ? count : count - 1;

    for (int i = 0; i < 64; i++) {
      if (i >= numEdges) break;
      int j = closed ? ((i + 1 < count) ? i + 1 : 0) : i + 1;
      vec2 a = uCustomVertices[i];
      vec2 b = uCustomVertices[j];

      float edgeLen = length(b - a);

      // Distance to this edge segment
      vec2 pa = p - a;
      vec2 ba = b - a;
      float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
      float d = length(pa - ba * h);

      if (d < closestDist) {
        closestDist = d;
        closestLen = totalLen + edgeLen * h;
      }

      totalLen += edgeLen;
    }

    return totalLen > 0.0 ? closestLen / totalLen : 0.0;
  }

  // ========== GET SHAPE SDF ==========

  float getShapeSDF(vec2 p, vec2 center, float radius, int shapeType, int sides, float inner, vec2 size) {
    p -= center;
    p = rotate2d(uShapeRotation) * p;
    p /= uShapeScale;

    // Preserve proportions for radial shapes on non-square render targets.
    if (shapeType == 0 || shapeType == 2 || shapeType == 3 || shapeType == 4 || shapeType == 5 || shapeType == 6) {
      p.x *= uResolution.x / uResolution.y;
    }

    if (shapeType == 0) { // Circle
      return sdCircle(p, radius);
    } else if (shapeType == 1) { // Rectangle
      return sdBox(p, size * 0.5);
    } else if (shapeType == 2) { // Triangle
      return sdEquilateralTriangle(p, radius);
    } else if (shapeType == 3) { // Polygon
      return sdPolygon(p, radius, sides);
    } else if (shapeType == 4) { // Star
      return sdStar(p, radius, inner, sides);
    } else if (shapeType == 5) { // Ring
      return sdRing(p, radius, inner);
    } else if (shapeType == 6) { // Spiral
      return sdSpiral(p, float(sides), inner, radius);
    } else if (shapeType == 7) { // Line
      return sdLine(p, vec2(-size.x * 0.5, 0.0), vec2(size.x * 0.5, 0.0));
    }

    return sdCircle(p, radius);
  }

  // ========== STROKE RENDERING ==========

  vec4 renderSolidStroke(float d, vec4 color, float width) {
    float strokeDist = abs(d) - width * 0.5;
    float alpha = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, strokeDist);
    return vec4(color.rgb, color.a * alpha);
  }

  vec4 renderGlowStroke(float d, vec4 color, float width, float glowSize, float intensity, float pulse) {
    float pulseMod = pulse > 0.0 ? 0.7 + 0.3 * sin(uTime * pulse * 3.0) : 1.0;

    // Core stroke
    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

    // Glow
    float glowDist = abs(d);
    float glow = 1.0 - smoothstep(0.0, glowSize / uResolution.x, glowDist);
    glow = pow(glow, 2.0) * intensity * pulseMod;

    vec3 finalColor = color.rgb * (core + glow);
    float finalAlpha = max(core, glow * 0.8);

    return vec4(finalColor, finalAlpha * color.a);
  }

  vec4 renderNeonStroke(float d, vec4 color, float width, float glowSize, float flicker) {
    float flickerMod = 1.0;
    if (flicker > 0.0) {
      flickerMod = 0.85 + 0.15 * sin(uTime * flicker * 15.0);
      flickerMod *= 0.9 + 0.1 * random(vec2(floor(uTime * 8.0), 0.0));
    }

    // Bright white core
    float coreDist = abs(d) - width * 0.3;
    float core = 1.0 - smoothstep(0.0, 1.5 / uResolution.x, coreDist);

    // Inner glow (colored)
    float innerDist = abs(d) - width * 0.5;
    float inner = 1.0 - smoothstep(0.0, 3.0 / uResolution.x, innerDist);

    // Outer glow
    float outerDist = abs(d);
    float outer = 1.0 - smoothstep(0.0, glowSize / uResolution.x, outerDist);
    outer = pow(outer, 1.5);

    vec3 finalColor = vec3(1.0) * core * 0.8 + color.rgb * inner + color.rgb * outer * 0.5;
    finalColor *= flickerMod;
    float finalAlpha = max(core, max(inner * 0.9, outer * 0.6));

    return vec4(finalColor, finalAlpha * color.a);
  }

  vec4 renderSnakeStroke(float d, vec4 color, float width, float snakeLen, float speed, float pathPos, int snakeCount) {
    // Core stroke distance
    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

    float totalInSnake = 0.0;
    float totalFade = 0.0;
    float totalHeadGlow = 0.0;

    // Render each snake using circular distance (no branch for wrap-around)
    for (int s = 0; s < 8; s++) {
      if (s >= snakeCount) break;

      float snakeOffset = float(s) / float(snakeCount);
      float headPos = mod(uTime * speed + snakeOffset, 1.0);

      // How far behind the head is this point? (circular, always 0..1)
      float distBehind = mod(headPos - pathPos + 1.0, 1.0);

      // Inside the snake body?
      float inSnake = smoothstep(snakeLen + 0.02, snakeLen - 0.02, distBehind);

      // Fade: bright at head (0), dim at tail (snakeLen)
      float fade = 1.0 - clamp(distBehind / max(snakeLen, 0.001), 0.0, 1.0);

      totalInSnake = max(totalInSnake, inSnake);
      totalFade = max(totalFade, fade * inSnake);

      // Head glow (already uses correct circular distance)
      float headDist = abs(pathPos - headPos);
      float headDistWrapped = min(headDist, 1.0 - headDist);
      totalHeadGlow = max(totalHeadGlow, exp(-headDistWrapped * 30.0));
    }

    // Apply glow
    float glowDist = abs(d);
    float glow = (1.0 - smoothstep(0.0, width * 2.0 / uResolution.x, glowDist)) * totalHeadGlow;

    float alpha = core * totalInSnake * max(totalFade, 0.1) + glow * 0.5;
    vec3 finalColor = color.rgb * (core * totalInSnake * max(totalFade, 0.1) + glow);

    return vec4(finalColor, alpha * color.a);
  }

  vec4 renderRainbowStroke(float d, float width, float speed, float pathPos) {
    float hue = mod(pathPos * 2.0 + uTime * speed, 1.0);
    vec3 rainbow = 0.5 + 0.5 * cos(TAU * (hue + vec3(0.0, 0.33, 0.67)));

    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

    float glowDist = abs(d);
    float glow = 1.0 - smoothstep(0.0, width * 1.5 / uResolution.x, glowDist);
    glow = pow(glow, 2.0) * 0.5;

    vec3 finalColor = rainbow * (core + glow);
    float alpha = max(core, glow * 0.7);

    return vec4(finalColor, alpha);
  }

  // --- Dashed stroke (type 6) ---
  vec4 renderDashedStroke(float d, vec4 color, float width, float dashLen, float gapLen, float pathPos, float speed) {
    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

    // Animated dash pattern along path
    float cycle = dashLen + gapLen;
    float pos = mod(pathPos + uTime * speed * 0.1, 1.0);
    float dashPhase = mod(pos * 10.0, cycle);
    float dash = smoothstep(0.0, 0.02, dashPhase) * (1.0 - smoothstep(dashLen - 0.02, dashLen, dashPhase));

    return vec4(color.rgb * core * dash, color.a * core * dash);
  }

  // --- Electric stroke (type 7) ---
  vec4 renderElectricStroke(float d, vec4 color, float width, float arcIntensity, float speed, float pathPos) {
    float t = uTime * speed;

    // Core line with jittered width
    float jitter = sin(pathPos * 50.0 + t * 20.0) * arcIntensity * 0.003;
    jitter += sin(pathPos * 120.0 + t * 35.0) * arcIntensity * 0.002;
    float coreDist = abs(d + jitter) - width * 0.3;
    float core = 1.0 - smoothstep(0.0, 1.5 / uResolution.x, coreDist);

    // Electric arcs - displaced copies
    float arc1Offset = sin(pathPos * 30.0 + t * 15.0) * arcIntensity * 0.008;
    float arc1 = 1.0 - smoothstep(0.0, 3.0 / uResolution.x, abs(d + arc1Offset) - width * 0.15);

    float arc2Offset = cos(pathPos * 45.0 + t * 22.0) * arcIntensity * 0.006;
    float arc2 = 1.0 - smoothstep(0.0, 3.0 / uResolution.x, abs(d + arc2Offset) - width * 0.1);

    // Bright white core + colored arcs
    vec3 coreColor = vec3(1.0) * core;
    vec3 arcColor = color.rgb * (arc1 * 0.6 + arc2 * 0.4);

    // Outer glow
    float glow = 1.0 - smoothstep(0.0, width * 3.0 / uResolution.x, abs(d));
    glow = pow(glow, 2.5) * 0.4;
    vec3 glowColor = color.rgb * glow;

    // Random flicker
    float flicker = 0.85 + 0.15 * random(vec2(floor(t * 12.0), pathPos * 5.0));

    vec3 finalColor = (coreColor + arcColor + glowColor) * flicker;
    float alpha = max(core, max(arc1 * 0.6, max(arc2 * 0.4, glow * 0.5)));
    return vec4(finalColor, alpha * color.a);
  }

  // --- Strobe stroke (type 8) ---
  vec4 renderStrobeStroke(float d, vec4 color, float width, float rate) {
    float on = step(0.0, sin(uTime * rate * TAU));

    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

    // Intense glow when on
    float glow = 1.0 - smoothstep(0.0, width * 2.0 / uResolution.x, abs(d));
    glow = pow(glow, 1.5) * 0.8;

    vec3 finalColor = color.rgb * (core + glow) * on;
    float alpha = max(core, glow * 0.7) * on;
    return vec4(finalColor, alpha * color.a);
  }

  // --- Scanner stroke (type 9) ---
  vec4 renderScannerStroke(float d, vec4 color, float width, float beamWidth, float speed, float pathPos, float trail) {
    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

    // Scanning beam position
    float scanPos = mod(uTime * speed * 0.2, 1.0);
    float dist = abs(pathPos - scanPos);
    dist = min(dist, 1.0 - dist); // Wrap around

    // Bright beam
    float beam = 1.0 - smoothstep(0.0, beamWidth, dist);
    beam = pow(beam, 2.0);

    // Trail behind beam
    float trailDist = mod(scanPos - pathPos + 1.0, 1.0);
    float trailFade = (1.0 - smoothstep(0.0, trail, trailDist)) * 0.4;

    float intensity = max(beam, trailFade);

    // Glow around beam position
    float glow = 1.0 - smoothstep(0.0, width * 2.0 / uResolution.x, abs(d));
    glow = pow(glow, 2.0) * beam * 0.6;

    vec3 finalColor = color.rgb * (core * intensity + glow);
    float alpha = core * intensity + glow * 0.5;
    return vec4(finalColor, alpha * color.a);
  }

  // --- Fire stroke (type 10) ---
  vec4 renderFireStroke(float d, vec4 color, float width, float speed, float pathPos) {
    float t = uTime * speed;

    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

    // Flickering fire noise
    float noise = sin(pathPos * 20.0 + t * 5.0) * 0.5 + 0.5;
    noise *= sin(pathPos * 35.0 - t * 3.0) * 0.5 + 0.5;
    noise += sin(pathPos * 8.0 + t * 7.0) * 0.3;

    // Fire gradient: white core -> color -> dark
    vec3 fireColor = mix(vec3(1.0, 0.2, 0.0), vec3(1.0, 0.9, 0.2), noise);
    fireColor = mix(fireColor, vec3(1.0), core * 0.5);

    // Extended glow with flame shape
    float flameDist = abs(d) - width * (0.5 + noise * 0.8);
    float flame = 1.0 - smoothstep(0.0, width * 2.0 / uResolution.x, max(flameDist, 0.0));
    flame *= noise;

    vec3 finalColor = fireColor * core + vec3(1.0, 0.3, 0.0) * flame * 0.6;
    float alpha = max(core, flame * 0.5);
    return vec4(finalColor, alpha * color.a);
  }

  // ========== FILL RENDERING ==========

  vec4 renderSolidFill(float d, vec4 color) {
    float inside = 1.0 - smoothstep(-2.0 / uResolution.x, 0.0, d);
    return vec4(color.rgb, color.a * inside);
  }

  vec4 renderPlasmaFill(float d, vec2 p, float speed, float scale, float complexity, int palette) {
    float inside = 1.0 - smoothstep(-2.0 / uResolution.x, 0.0, d);
    if (inside < 0.01) return vec4(0.0);

    float t = uTime * speed;
    float s = scale;
    float plasma = 0.0;
    plasma += sin(p.x * s + t);
    plasma += sin(p.y * s + t * 1.2);
    plasma += sin((p.x + p.y) * s * 0.75 + t * 0.7);
    plasma += sin(length(p - 0.5) * s * 1.5 + t * 0.9);
    // Additional complexity layers
    if (complexity > 2.0) {
      plasma += sin(p.x * s * 2.0 - p.y * s * 1.5 + t * 1.5) * 0.5;
      plasma += sin(length(p - vec2(0.3, 0.7)) * s * 2.0 + t * 1.1) * 0.4;
    }
    if (complexity > 4.0) {
      plasma += sin((p.x * p.y) * s * 3.0 + t * 2.0) * 0.3;
      plasma += cos(p.x * s * 3.0 + sin(p.y * s * 2.0 + t)) * 0.25;
    }
    float totalWeight = 4.0 + (complexity > 2.0 ? 0.9 : 0.0) + (complexity > 4.0 ? 0.55 : 0.0);
    plasma = plasma / totalWeight + 0.5;

    vec3 color;
    if (palette == 1) {
      // Fire palette
      color = mix(vec3(0.1, 0.0, 0.0), vec3(1.0, 0.9, 0.2), plasma);
      color = mix(color, vec3(1.0, 0.3, 0.0), sin(plasma * PI) * 0.5 + 0.5);
    } else if (palette == 2) {
      // Ocean palette
      color = mix(vec3(0.0, 0.05, 0.2), vec3(0.0, 0.8, 1.0), plasma);
      color = mix(color, vec3(0.2, 0.4, 0.8), sin(plasma * PI * 2.0) * 0.3 + 0.5);
    } else if (palette == 3) {
      // Neon palette
      color = 0.5 + 0.5 * cos(TAU * (plasma * 2.0 + vec3(0.0, 0.15, 0.4)));
      color = pow(color, vec3(0.8)); // Boost brightness
    } else {
      // Rainbow (default)
      color = 0.5 + 0.5 * cos(TAU * (plasma + vec3(0.0, 0.33, 0.67)));
    }
    return vec4(color, inside);
  }

  vec4 renderLiquidFill(float d, vec2 p, vec4 baseColor, float speed, float viscosity, float turbulence, float metallic) {
    float inside = 1.0 - smoothstep(-2.0 / uResolution.x, 0.0, d);
    if (inside < 0.01) return vec4(0.0);

    float t = uTime * speed;
    // Viscosity controls distortion amount (higher = less movement, thicker fluid)
    float distAmt = 0.05 * (1.0 - viscosity * 0.8);
    float distort1 = sin(p.x * 15.0 + t) * cos(p.y * 12.0 + t * 0.8) * distAmt;
    float distort2 = cos(p.x * 10.0 - t * 0.6) * sin(p.y * 18.0 + t * 1.2) * distAmt * turbulence;
    vec2 dp = p + vec2(distort1, distort2);

    // Turbulence adds more octaves of noise
    float noise = sin(dp.x * 25.0 + t) * sin(dp.y * 25.0 - t) * 0.5 + 0.5;
    if (turbulence > 0.3) {
      noise += sin(dp.x * 50.0 - t * 1.5) * sin(dp.y * 40.0 + t * 1.3) * 0.2 * turbulence;
    }
    if (turbulence > 0.6) {
      noise += sin(dp.x * 80.0 + t * 2.0) * cos(dp.y * 70.0 - t * 1.8) * 0.1 * turbulence;
    }
    noise = clamp(noise, 0.0, 1.0);

    // Color modulation with depth variation
    vec3 color = baseColor.rgb * (0.6 + noise * 0.6);
    // Add subtle color shift in darker areas
    vec3 deepColor = baseColor.rgb * vec3(0.6, 0.8, 1.2);
    color = mix(deepColor, color, noise);

    // Metallic highlights - intensity controlled by uniform
    float highlight = pow(noise, 3.0 + (1.0 - metallic) * 3.0) * metallic;
    // Specular-like sheen
    float sheen = pow(max(0.0, sin(dp.x * 40.0 + t * 2.0) * cos(dp.y * 35.0 - t * 1.5)), 8.0) * metallic * 0.4;
    color += vec3(highlight + sheen);

    return vec4(color, baseColor.a * inside);
  }

  vec4 renderFireFill(float d, vec2 p, float speed, float intensity, float turbulence, int palette) {
    float inside = 1.0 - smoothstep(-2.0 / uResolution.x, 0.0, d);
    if (inside < 0.01) return vec4(0.0);

    float t = uTime * speed;
    float fire = 0.0;
    fire += sin(p.x * 8.0 + t * 3.0) * 0.5;
    fire += sin(p.y * 6.0 - t * 2.5) * 0.5;
    fire += sin((p.x + p.y) * 5.0 + t * 4.0) * 0.3;
    // Turbulence adds more chaotic detail
    if (turbulence > 0.3) {
      fire += sin(p.x * 16.0 - t * 5.0) * sin(p.y * 14.0 + t * 3.5) * turbulence * 0.4;
    }
    if (turbulence > 0.6) {
      fire += sin(p.x * 30.0 + t * 8.0) * cos(p.y * 25.0 - t * 6.0) * turbulence * 0.2;
    }
    fire = fire * 0.5 + 0.5;

    vec3 darkColor, brightColor, midColor;
    if (palette == 1) {
      // Blue fire
      darkColor = vec3(0.0, 0.0, 0.4);
      brightColor = vec3(0.4, 0.7, 1.0);
      midColor = vec3(0.1, 0.3, 0.9);
    } else if (palette == 2) {
      // Green fire
      darkColor = vec3(0.0, 0.2, 0.0);
      brightColor = vec3(0.5, 1.0, 0.3);
      midColor = vec3(0.1, 0.7, 0.2);
    } else if (palette == 3) {
      // Purple fire
      darkColor = vec3(0.2, 0.0, 0.3);
      brightColor = vec3(1.0, 0.5, 1.0);
      midColor = vec3(0.5, 0.1, 0.8);
    } else {
      // Orange fire (default)
      darkColor = vec3(1.0, 0.2, 0.0);
      brightColor = vec3(1.0, 0.9, 0.2);
      midColor = vec3(1.0, 0.5, 0.1);
    }

    vec3 color = mix(darkColor, brightColor, pow(fire, 1.5));
    color = mix(color, midColor, fire * 0.4);
    color *= intensity;

    return vec4(color, inside);
  }

  // --- Electric fill (type 5) ---
  vec4 renderElectricFill(float d, vec2 p, vec4 color, float speed, float intensity, float arcCount) {
    float inside = 1.0 - smoothstep(-2.0 / uResolution.x, 0.0, d);
    if (inside < 0.01) return vec4(0.0);

    float t = uTime * speed;
    float freqMult = arcCount * 6.0; // More arcs = higher frequency

    // Electric arc noise
    float arc = 0.0;
    arc += sin(p.x * freqMult + t * 8.0) * sin(p.y * freqMult * 0.83 - t * 6.0);
    arc += sin((p.x - p.y) * freqMult * 1.33 + t * 12.0) * 0.5;
    arc += sin(length(p - 0.5) * freqMult * 0.67 + t * 10.0) * 0.3;
    arc = pow(abs(arc), 0.3);

    // Intensity controls bolt threshold (lower threshold = more bolts)
    float boltThreshold = 1.0 - intensity * 0.25;
    float bolt = step(boltThreshold, arc);
    float glow = pow(arc, 3.0 - intensity * 0.5);

    vec3 finalColor = color.rgb * (glow * 0.4 * intensity + bolt * 1.5);
    finalColor += vec3(0.8, 0.9, 1.0) * bolt * 0.5 * intensity; // White flash on bolts

    // Random flash - more frequent at higher intensity
    float flashRate = 4.0 + intensity * 4.0;
    float flash = step(0.97 - intensity * 0.05, random(vec2(floor(t * flashRate), 0.0)));
    finalColor += color.rgb * flash * 0.3 * intensity;

    // Background glow between arcs
    float bgGlow = glow * 0.15 * intensity;
    finalColor += color.rgb * bgGlow;

    return vec4(finalColor, inside * max(glow * 0.5, bolt));
  }

  // --- Holographic fill (type 6) ---
  vec4 renderHolographicFill(float d, vec2 p, float speed, float shift, float scanlines, float flickerAmt) {
    float inside = 1.0 - smoothstep(-2.0 / uResolution.x, 0.0, d);
    if (inside < 0.01) return vec4(0.0);

    float t = uTime * speed;

    // Angle-based hue shift (holographic rainbow)
    float angle = atan(p.y - 0.5, p.x - 0.5);
    float hue = mod(angle / TAU + t * 0.1 + shift, 1.0);
    vec3 rainbow = 0.5 + 0.5 * cos(TAU * (hue + vec3(0.0, 0.33, 0.67)));

    // Fresnel-like edge brightening
    float edgeDist = abs(d) / 0.05;
    float fresnel = exp(-edgeDist * 2.0);

    // Scanlines - density controlled by uniform
    float scan = 1.0;
    if (scanlines > 0.1) {
      scan = sin(p.y * scanlines * 100.0 + t * 2.0) * 0.5 + 0.5;
      scan = mix(0.7, 1.0, scan);
    }

    // Flicker - amount controlled by uniform
    float flicker = 1.0;
    if (flickerAmt > 0.01) {
      flicker = 1.0 - flickerAmt * 0.15;
      flicker += flickerAmt * 0.15 * sin(t * 15.0);
      // Add random flicker bursts
      flicker *= 1.0 - flickerAmt * 0.1 * step(0.95, random(vec2(floor(t * 8.0), 0.0)));
    }

    vec3 finalColor = rainbow * scan * flicker * (0.5 + fresnel * 0.5);
    return vec4(finalColor, inside * 0.8);
  }

  // --- Noise fill (type 7) ---
  vec4 renderNoiseFill(float d, vec2 p, vec4 color, float speed, float scale, float turbulence, vec4 color2) {
    float inside = 1.0 - smoothstep(-2.0 / uResolution.x, 0.0, d);
    if (inside < 0.01) return vec4(0.0);

    float t = uTime * speed;

    // Multi-octave procedural noise
    float n = 0.0;
    float amp = 1.0;
    float freq = scale;
    for (int i = 0; i < 4; i++) {
      n += amp * (sin(p.x * freq + t + float(i)) * cos(p.y * freq * 1.3 - t * 0.7 + float(i) * 2.0));
      amp *= 0.5;
      freq *= 2.0 + turbulence;
    }
    n = n * 0.5 + 0.5;

    // Interpolate between the two user-defined colors
    vec3 c1 = color.rgb;
    vec3 c2 = color2.rgb;
    vec3 finalColor = mix(c2, c1, n);

    return vec4(finalColor, inside * color.a);
  }

  // --- Gradient fill (type 8) ---
  vec4 renderGradientFill(float d, vec2 p, vec4 color, vec4 color2, float angle, float speed, int gradType) {
    float inside = 1.0 - smoothstep(-2.0 / uResolution.x, 0.0, d);
    if (inside < 0.01) return vec4(0.0);

    float t;
    if (gradType == 1) {
      // Radial gradient from center
      float dist = length(p - 0.5) * 2.0;
      t = clamp(dist + uTime * speed * 0.1, 0.0, 1.0);
      t = fract(t); // Repeat for animation
    } else if (gradType == 2) {
      // Angular/conical gradient
      float a = atan(p.y - 0.5, p.x - 0.5);
      t = mod(a / TAU + 0.5 + uTime * speed * 0.1, 1.0);
    } else {
      // Linear gradient (default)
      float a = angle + uTime * speed * 0.5;
      vec2 dir = vec2(cos(a), sin(a));
      t = dot(p - 0.5, dir) + 0.5;
      t = clamp(t, 0.0, 1.0);
    }

    // Two-stop gradient with user-defined colors
    vec3 c1 = color.rgb;
    vec3 c2 = color2.rgb;
    vec3 finalColor = mix(c1, c2, t);

    float alpha = mix(color.a, color2.a, t);
    return vec4(finalColor, inside * alpha);
  }

  // ========== CONCENTRIC ANIMATION ==========

  vec4 renderConcentric(vec2 p, vec4 baseColor, int count, float spacing, float speed, int direction, vec2 customCentroid) {
    vec4 result = vec4(0.0);
    float t = uTime * speed;

    // Direction: 0 = out (external), 1 = in (internal), 2 = both
    int loopCount = (direction == 2) ? count * 2 : count;

    // Stroke thickness uses the global stroke width uniform
    float strokeW = uStrokeWidth * 2.0 / uResolution.x;

    for (int i = 0; i < 40; i++) {
      if (i >= loopCount) break;

      float fi = float(i % count);
      bool isInward = (direction == 1) || (direction == 2 && i >= count);

      float scale;
      if (isInward) {
        // Internal: evenly spaced rings shrinking toward center.
        // Smooth animation scrolls rings inward continuously.
        float phase = mod(fi * spacing + t * 0.15, float(count) * spacing);
        scale = 1.0 - phase / (float(count) * spacing) * 0.95;
        scale = max(scale, 0.02);
      } else {
        // External: expand outward
        float phase = mod(fi * spacing + t * 0.15, float(count) * spacing);
        scale = 1.0 + phase;
      }

      float d;
      if (uUseCustomVertices && uCustomVertexCount >= 2) {
        vec2 sp = customCentroid + (p - customCentroid) / scale;
        d = sdPolygonCustom(sp, uCustomVertexCount, uCustomVerticesClosed);
      } else {
        float scaledRadius = uShapeRadius * scale;
        d = getShapeSDF(p, uShapeCenter, scaledRadius, uShapeType, uShapeSides, uInnerRadius * scale, vec2(uWidth, uHeight) * scale);
      }

      // Clean stroke outline only — no fill between rings
      float strokeAlpha = 1.0 - smoothstep(0.0, strokeW, abs(d));

      result = max(result, baseColor * strokeAlpha);
    }

    return result;
  }

  // ========== MAIN ==========

  void main() {
    vec2 p = vUv;

    // Apply per-shape mesh warp if enabled (applied first, then corner warp)
    if (uMeshWarpEnabled && uMeshRows >= 2 && uMeshCols >= 2) {
      p = inverseMeshWarp(p, uMeshRows, uMeshCols);

      // Discard pixels outside the mesh bounds
      if (p.x < -0.1 || p.x > 1.1 || p.y < -0.1 || p.y > 1.1) {
        gl_FragColor = vec4(0.0);
        return;
      }
    }

    // Apply per-shape corner warp if enabled
    // The warp corners define where the shape's bounding box corners map to
    if (uWarpEnabled) {
      // Compute the warped position by inverse bilinear interpolation
      // The shape is defined in 0-1 space, so we find where in the warped quad this pixel is
      p = inverseWarp(p, uWarpTL, uWarpTR, uWarpBL, uWarpBR);

      // Discard pixels outside the warped quad
      if (p.x < -0.1 || p.x > 1.1 || p.y < -0.1 || p.y > 1.1) {
        gl_FragColor = vec4(0.0);
        return;
      }
    }

    // Get SDF for this shape - use custom vertices if available
    float d;
    float pathPos;

    if (uUseCustomVertices && uCustomVertexCount >= 2) {
      // Use custom polygon SDF
      d = sdPolygonCustom(p, uCustomVertexCount, uCustomVerticesClosed);
      // Calculate path position along the custom polygon edges
      pathPos = getCustomPolygonPathPos(p, uCustomVertexCount, uCustomVerticesClosed);
    } else {
      // Use parametric shape SDF
      d = getShapeSDF(p, uShapeCenter, uShapeRadius, uShapeType, uShapeSides, uInnerRadius, vec2(uWidth, uHeight));
      // Calculate path position for animated strokes (angle-based for parametric shapes)
      vec2 toCenter = p - uShapeCenter;
      pathPos = mod(atan(toCenter.y, toCenter.x) / TAU + 0.5, 1.0);
    }

    vec4 fillColor = vec4(0.0);
    vec4 strokeColor = vec4(0.0);

    // Render fill first
    if (uFillType == 1) { // Solid
      fillColor = renderSolidFill(d, uFillColor);
    } else if (uFillType == 2) { // Plasma
      fillColor = renderPlasmaFill(d, p, uFillSpeed, uPlasmaScale, uPlasmaComplexity, uPlasmaPalette);
    } else if (uFillType == 3) { // Liquid
      fillColor = renderLiquidFill(d, p, uFillColor, uFillSpeed, uLiquidViscosity, uLiquidTurbulence, uLiquidMetallic);
    } else if (uFillType == 4) { // Fire
      fillColor = renderFireFill(d, p, uFillSpeed, uFireIntensity, uFireTurbulence, uFirePalette);
    } else if (uFillType == 5) { // Electric
      fillColor = renderElectricFill(d, p, uFillColor, uFillSpeed, uElectricIntensity, uElectricArcCount);
    } else if (uFillType == 6) { // Holographic
      fillColor = renderHolographicFill(d, p, uFillSpeed, uHoloShift, uHoloScanlines, uHoloFlicker);
    } else if (uFillType == 7) { // Noise
      fillColor = renderNoiseFill(d, p, uFillColor, uFillSpeed, uNoiseScale, uNoiseTurbulence, uNoiseColor2);
    } else if (uFillType == 8) { // Gradient
      fillColor = renderGradientFill(d, p, uFillColor, uGradColor2, uGradAngle, uFillSpeed, uGradType);
    }

    // Render stroke
    if (uStrokeType == 1) { // Solid
      strokeColor = renderSolidStroke(d, uStrokeColor, uStrokeWidth / uResolution.x);
    } else if (uStrokeType == 2) { // Glow
      strokeColor = renderGlowStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, uGlowSize, uGlowIntensity, uPulseSpeed);
    } else if (uStrokeType == 3) { // Neon
      strokeColor = renderNeonStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, uGlowSize, uPulseSpeed);
    } else if (uStrokeType == 4) { // Snake
      strokeColor = renderSnakeStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, uSnakeLength, uSnakeSpeed, pathPos, uSnakeCount);
    } else if (uStrokeType == 5) { // Rainbow
      strokeColor = renderRainbowStroke(d, uStrokeWidth / uResolution.x, uSnakeSpeed, pathPos);
    } else if (uStrokeType == 6) { // Dashed
      strokeColor = renderDashedStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, uDashLength, uGapLength, pathPos, uSnakeSpeed);
    } else if (uStrokeType == 7) { // Electric
      strokeColor = renderElectricStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, uElectricArc, uSnakeSpeed, pathPos);
    } else if (uStrokeType == 8) { // Strobe
      strokeColor = renderStrobeStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, uStrobeRate);
    } else if (uStrokeType == 9) { // Scanner
      strokeColor = renderScannerStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, uScannerBeamWidth, uSnakeSpeed, pathPos, uScannerTrail);
    } else if (uStrokeType == 10) { // Fire
      strokeColor = renderFireStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, uSnakeSpeed, pathPos);
    }

    // Apply concentric animation
    if (uAnimationType == 1 && uAnimCount > 0.0) {
      // Pre-compute centroid of custom vertices (used for scaling concentric rings around warped shape)
      vec2 cCentroid = uShapeCenter;
      if (uUseCustomVertices && uCustomVertexCount >= 2) {
        cCentroid = vec2(0.0);
        for (int i = 0; i < 64; i++) {
          if (i >= uCustomVertexCount) break;
          cCentroid += uCustomVertices[i];
        }
        cCentroid /= float(uCustomVertexCount);
      }
      vec4 concentric = renderConcentric(p, uStrokeColor, int(uAnimCount), uAnimSpacing, uAnimSpeed, uConcentricDirection, cCentroid);
      strokeColor += concentric;
    }

    // Apply animation effects (transform-based)
    // Breathe (type 3): scale pulsing
    if (uAnimationType == 3) {
      float breatheT = sin(uTime * uAnimSpeed * PI) * 0.5 + 0.5;
      float breatheScale = mix(uBreatheMin, uBreatheMax, breatheT);
      // Re-evaluate SDF at scaled position
      vec2 breatheP = uShapeCenter + (p - uShapeCenter) / breatheScale;
      float bd;
      if (uUseCustomVertices && uCustomVertexCount >= 2) {
        // Scale query around centroid
        vec2 cent = vec2(0.0);
        for (int i = 0; i < 64; i++) {
          if (i >= uCustomVertexCount) break;
          cent += uCustomVertices[i];
        }
        cent /= float(uCustomVertexCount);
        vec2 sp = cent + (p - cent) / breatheScale;
        bd = sdPolygonCustom(sp, uCustomVertexCount, uCustomVerticesClosed);
      } else {
        bd = getShapeSDF(breatheP, uShapeCenter, uShapeRadius, uShapeType, uShapeSides, uInnerRadius, vec2(uWidth, uHeight));
      }
      // Re-render with breathe'd SDF
      float alpha = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, abs(bd) - uStrokeWidth * 0.5 / uResolution.x);
      strokeColor = vec4(uStrokeColor.rgb * alpha, uStrokeColor.a * alpha);
    }

    // Rotate (type 4): handled via uShapeRotation in renderElement, just add continuous rotation
    // (This is handled in the TypeScript side by modifying uShapeRotation each frame)

    // Radiate (type 2): ray burst from center
    if (uAnimationType == 2 && uAnimCount > 0.0) {
      float rayCount = uAnimCount;
      float raySpeed = uAnimSpeed;
      vec2 rayCenter = uShapeCenter;
      if (uUseCustomVertices && uCustomVertexCount >= 2) {
        rayCenter = vec2(0.0);
        for (int i = 0; i < 64; i++) {
          if (i >= uCustomVertexCount) break;
          rayCenter += uCustomVertices[i];
        }
        rayCenter /= float(uCustomVertexCount);
      }
      float angle = atan(p.y - rayCenter.y, p.x - rayCenter.x);
      float rayAngle = mod(angle + uTime * raySpeed * 0.5, TAU);
      float ray = pow(abs(cos(rayAngle * rayCount * 0.5)), 20.0);
      float dist = length(p - rayCenter);
      float radiate = ray * (1.0 - smoothstep(0.0, 0.4, dist));
      strokeColor += uStrokeColor * radiate * 0.5;
    }

    // Ripple (type 5): expanding ring waves
    if (uAnimationType == 5) {
      vec2 rippleCenter = uShapeCenter;
      if (uUseCustomVertices && uCustomVertexCount >= 2) {
        rippleCenter = vec2(0.0);
        for (int i = 0; i < 64; i++) {
          if (i >= uCustomVertexCount) break;
          rippleCenter += uCustomVertices[i];
        }
        rippleCenter /= float(uCustomVertexCount);
      }
      float dist = length(p - rippleCenter);
      float rippleCount = max(uAnimCount, 3.0);
      for (int i = 0; i < 10; i++) {
        if (float(i) >= rippleCount) break;
        float r = mod(uTime * uAnimSpeed * 0.15 + float(i) * uAnimSpacing, rippleCount * uAnimSpacing);
        float ring = 1.0 - smoothstep(0.0, uStrokeWidth * 2.0 / uResolution.x, abs(dist - r));
        float fade = exp(-r * uRippleDecay * 5.0);
        strokeColor += uStrokeColor * ring * fade * 0.3;
      }
    }

    // Wave (type 6): sinusoidal position distortion
    if (uAnimationType == 6) {
      float wt = uTime * uAnimSpeed;
      vec2 waveOffset = vec2(
        sin(p.y * uWaveFrequency * 20.0 + wt * 3.0) * uWaveAmplitude * 0.02,
        cos(p.x * uWaveFrequency * 20.0 + wt * 2.5) * uWaveAmplitude * 0.02
      );
      vec2 wp = p + waveOffset;
      float wd;
      if (uUseCustomVertices && uCustomVertexCount >= 2) {
        wd = sdPolygonCustom(wp, uCustomVertexCount, uCustomVerticesClosed);
      } else {
        wd = getShapeSDF(wp, uShapeCenter, uShapeRadius, uShapeType, uShapeSides, uInnerRadius, vec2(uWidth, uHeight));
      }
      float walpha = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, abs(wd) - uStrokeWidth * 0.5 / uResolution.x);
      strokeColor = vec4(uStrokeColor.rgb * walpha, uStrokeColor.a * walpha);
      // Re-evaluate fill too
      if (uFillType > 0) {
        float wInside = 1.0 - smoothstep(-2.0 / uResolution.x, 0.0, wd);
        fillColor = vec4(fillColor.rgb, fillColor.a * wInside);
      }
    }

    // Glitch (type 7): block displacement + RGB split
    if (uAnimationType == 7 && uGlitchIntensity > 0.0) {
      float gt = uTime * uAnimSpeed;
      // Block-based offset
      float blockY = floor(p.y * (10.0 / uGlitchBlockSize)) * uGlitchBlockSize * 0.1;
      float glitchTrigger = step(0.92, random(vec2(blockY, floor(gt * 4.0))));
      float offset = (random(vec2(blockY + 1.0, floor(gt * 4.0))) - 0.5) * uGlitchIntensity * 0.05;

      if (glitchTrigger > 0.5) {
        // RGB split with displaced samples
        vec2 rp = p + vec2(offset, 0.0);
        vec2 bp = p - vec2(offset, 0.0);
        float dr, db;
        if (uUseCustomVertices && uCustomVertexCount >= 2) {
          dr = sdPolygonCustom(rp, uCustomVertexCount, uCustomVerticesClosed);
          db = sdPolygonCustom(bp, uCustomVertexCount, uCustomVerticesClosed);
        } else {
          dr = getShapeSDF(rp, uShapeCenter, uShapeRadius, uShapeType, uShapeSides, uInnerRadius, vec2(uWidth, uHeight));
          db = getShapeSDF(bp, uShapeCenter, uShapeRadius, uShapeType, uShapeSides, uInnerRadius, vec2(uWidth, uHeight));
        }
        float ar = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, abs(dr) - uStrokeWidth * 0.5 / uResolution.x);
        float ab = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, abs(db) - uStrokeWidth * 0.5 / uResolution.x);
        float ag = strokeColor.a;

        strokeColor = vec4(
          uStrokeColor.r * ar,
          uStrokeColor.g * ag,
          uStrokeColor.b * ab,
          max(ar, max(ag, ab)) * uStrokeColor.a
        );
      }
    }

    // Composite fill and stroke
    vec4 result = fillColor;
    result = mix(result, strokeColor, strokeColor.a);

    gl_FragColor = result;
  }
`;

// ============================================================================
// DRAWING RENDERER CLASS
// ============================================================================

export class DrawingRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private renderTarget: THREE.WebGLRenderTarget;
  private quad: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private width: number;
  private height: number;
  private startTime: number;

  // For path-based shapes (freehand, pointClickLine)
  private pathScene: THREE.Scene;
  private pathMaterial: THREE.LineBasicMaterial;
  private currentPathLine: THREE.Line | null = null;

  constructor(renderer: THREE.WebGLRenderer, width: number, height: number) {
    this.renderer = renderer;
    this.width = width;
    this.height = height;
    this.startTime = performance.now() / 1000;

    // Create render target with transparency
    this.renderTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    });

    // Create scene with camera that maps UV 0-1 to clip space
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0.1, 10);
    this.camera.position.z = 1;

    // Create shader material
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(width, height) },

        // Shape
        uShapeType: { value: 0 },
        uShapeCenter: { value: new THREE.Vector2(0.5, 0.5) },
        uShapeRadius: { value: 0.2 },
        uShapeRotation: { value: 0 },
        uShapeScale: { value: new THREE.Vector2(1, 1) },
        uShapeSides: { value: 6 },
        uInnerRadius: { value: 0.1 },
        uWidth: { value: 0.3 },
        uHeight: { value: 0.2 },

        // Per-shape corner warp
        uWarpEnabled: { value: false },
        uWarpTL: { value: new THREE.Vector2(0, 0) },
        uWarpTR: { value: new THREE.Vector2(1, 0) },
        uWarpBL: { value: new THREE.Vector2(0, 1) },
        uWarpBR: { value: new THREE.Vector2(1, 1) },

        // Per-shape mesh warp (up to 4x4 = 16 points)
        uMeshWarpEnabled: { value: false },
        uMeshRows: { value: 3 },
        uMeshCols: { value: 3 },
        uMeshPoints: { value: this.createDefaultMeshPoints(3, 3) },

        // Custom vertex polygon (for warped shapes)
        uUseCustomVertices: { value: false },
        uCustomVertexCount: { value: 0 },
        uCustomVertices: { value: this.createDefaultCustomVertices() },
        uCustomVerticesClosed: { value: true },

        // Stroke
        uStrokeType: { value: 2 },
        uStrokeColor: { value: new THREE.Vector4(0, 1, 0.5, 1) },
        uStrokeWidth: { value: 4 },
        uGlowSize: { value: 20 },
        uGlowIntensity: { value: 1 },
        uPulseSpeed: { value: 1 },
        uSnakeLength: { value: 0.3 },
        uSnakeSpeed: { value: 1 },
        uSnakeCount: { value: 1 },

        // Fill
        uFillType: { value: 0 },
        uFillColor: { value: new THREE.Vector4(1, 1, 1, 0.5) },
        uFillSpeed: { value: 1 },

        // Animation
        uAnimationType: { value: 0 },
        uAnimCount: { value: 5 },
        uAnimSpacing: { value: 0.04 },
        uAnimSpeed: { value: 1 },
        uConcentricDirection: { value: 0 },

        // Extended stroke uniforms
        uDashLength: { value: 0.3 },
        uGapLength: { value: 0.2 },
        uElectricArc: { value: 1.0 },
        uElectricBranches: { value: 3.0 },
        uScannerBeamWidth: { value: 0.1 },
        uScannerTrail: { value: 0.3 },
        uStrobeRate: { value: 4.0 },

        // Extended fill uniforms
        uNoiseScale: { value: 5.0 },
        uNoiseTurbulence: { value: 0.5 },
        uHoloShift: { value: 0.0 },
        uHoloScanlines: { value: 3.0 },
        uGradAngle: { value: 0.0 },

        // Enhanced fill parameter uniforms
        uPlasmaScale: { value: 8.0 },
        uPlasmaComplexity: { value: 3.0 },
        uPlasmaPalette: { value: 0 },
        uLiquidViscosity: { value: 0.5 },
        uLiquidTurbulence: { value: 0.5 },
        uLiquidMetallic: { value: 0.5 },
        uFireIntensity: { value: 1.0 },
        uFireTurbulence: { value: 0.5 },
        uFirePalette: { value: 0 },
        uElectricIntensity: { value: 1.0 },
        uElectricArcCount: { value: 5.0 },
        uHoloFlicker: { value: 0.5 },
        uNoiseColor2: { value: new THREE.Vector4(0, 0.2, 0.4, 1) },
        uGradColor2: { value: new THREE.Vector4(1, 1, 1, 1) },
        uGradType: { value: 0 },

        // Extended animation uniforms
        uBreatheMin: { value: 0.8 },
        uBreatheMax: { value: 1.2 },
        uRotateSpeed: { value: 1.0 },
        uRotateDir: { value: 0 },
        uWaveAmplitude: { value: 1.0 },
        uWaveFrequency: { value: 1.0 },
        uRippleDecay: { value: 1.0 },
        uGlitchIntensity: { value: 1.0 },
        uGlitchBlockSize: { value: 1.0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      // Additive blending for glow effects - shapes add together
      // This preserves both the new shape AND existing content
      blending: THREE.AdditiveBlending,
    });

    // Create fullscreen quad
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.translate(0.5, 0.5, 0);
    this.quad = new THREE.Mesh(geometry, this.material);
    this.scene.add(this.quad);

    // Initialize path rendering components for freehand/pointClickLine
    this.pathScene = new THREE.Scene();
    this.pathMaterial = new THREE.LineBasicMaterial({
      color: 0xff00ff,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.renderTarget.setSize(width, height);
    this.material.uniforms.uResolution.value.set(width, height);
  }

  // Create default mesh points array for uniform
  private createDefaultMeshPoints(rows: number, cols: number): THREE.Vector2[] {
    const points: THREE.Vector2[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        points.push(new THREE.Vector2(c / (cols - 1), r / (rows - 1)));
      }
    }
    // Pad to 16 points for uniform array
    while (points.length < 16) {
      points.push(new THREE.Vector2(0, 0));
    }
    return points;
  }

  private createDefaultCustomVertices(): THREE.Vector2[] {
    // Create 64 empty vectors for the custom vertex array
    const verts: THREE.Vector2[] = [];
    for (let i = 0; i < 64; i++) {
      verts.push(new THREE.Vector2(0, 0));
    }
    return verts;
  }

  private getShapeTypeIndex(type: string): number {
    const types: Record<string, number> = {
      circle: 0,
      ellipse: 0, // Uses circle SDF with separate radiusX/radiusY handled via scale
      arc: 0,     // Arc renders as circle, clipping handled externally
      rectangle: 1,
      roundedRect: 1, // Falls back to rectangle SDF
      triangle: 2,
      polygon: 3,
      star: 4,
      ring: 5,
      spiral: 6,
      line: 7,
      freehand: 0,
      pointClickLine: 7,
    };
    return types[type] ?? 0;
  }

  private getStrokeTypeIndex(type: string): number {
    const types: Record<string, number> = {
      none: 0,
      solid: 1,
      glow: 2,
      neon: 3,
      snake: 4,
      rainbow: 5,
      dashed: 6,
      electric: 7,
      strobe: 8,
      scanner: 9,
      fire: 10,
      pulse: 4,     // maps to snake-style rendering
      dotted: 6,    // maps to dashed
    };
    return types[type] ?? 2;
  }

  private getFillTypeIndex(type: string): number {
    const types: Record<string, number> = {
      none: 0,
      solid: 1,
      plasma: 2,
      liquid: 3,
      fire: 4,
      electric: 5,
      holographic: 6,
      noise: 7,
      gradient: 8,
      radialGradient: 8,
    };
    return types[type] ?? 0;
  }

  private getAnimationTypeIndex(type: string): number {
    const types: Record<string, number> = {
      none: 0,
      concentric: 1,
      radiate: 2,
      breathe: 3,
      rotate: 4,
      ripple: 5,
      wave: 6,
      glitch: 7,
    };
    return types[type] ?? 0;
  }

  /**
   * Check if a shape should be rendered as a custom vertex path/polygon.
   * This includes shapes with customVertices OR explicit point arrays (freehand, polyline, etc.)
   * NOTE: This now returns false because we render everything through the shader.
   * Custom vertices are passed to the shader via uniforms.
   */
  private isCustomVertexShape(_shape: Shape): boolean {
    // All shapes now render through the shader, which handles custom vertices
    // Only return true for shapes that CANNOT be handled by the shader (none currently)
    return false;
  }

  /**
   * Get the vertices for rendering a shape.
   * Uses customVertices if available, otherwise falls back to shape-specific points.
   */
  private getShapeVerticesForRender(shape: Shape): Point2D[] {
    // Use customVertices if available
    if (shape.customVertices && shape.customVertices.length >= 2) {
      return shape.customVertices;
    }
    // For freehand/polyline shapes, use their points array
    if ('points' in shape && Array.isArray(shape.points)) {
      return shape.points as Point2D[];
    }
    return [];
  }

  /**
   * Determine if a shape should be rendered as a closed polygon or open polyline
   */
  private isClosedVertexShape(shape: Shape): boolean {
    // Shapes with customVertices are closed (they started as parametric shapes)
    if (shape.customVertices && shape.customVertices.length >= 2) {
      // Open shapes that got customVertices should stay open
      if (shape.type === 'freehand' || shape.type === 'line') {
        return false;
      }
      // Polyline/pointClickLine check their closed property
      if ((shape.type === 'pointClickLine' || shape.type === 'polyline') && 'closed' in shape) {
        return (shape as any).closed;
      }
      // All other shapes (circle, rect, polygon, star, etc.) are closed
      return true;
    }
    // For polyline/pointClickLine, check their closed property
    if ((shape.type === 'pointClickLine' || shape.type === 'polyline') && 'closed' in shape) {
      return (shape as any).closed;
    }
    // Freehand and line are open
    return false;
  }

  /**
   * Render a vertex-based shape (with customVertices or point arrays) using THREE.Line/LineLoop
   */
  renderVertexElement(element: DrawingElement): void {
    const shape = element.shape;
    const vertices = this.getShapeVerticesForRender(shape);
    if (vertices.length < 2) return;

    // Remove old line if exists
    if (this.currentPathLine) {
      this.pathScene.remove(this.currentPathLine);
      this.currentPathLine.geometry.dispose();
      if (this.currentPathLine.material instanceof THREE.Material) {
        this.currentPathLine.material.dispose();
      }
      this.currentPathLine = null;
    }

    // Create geometry from vertices
    const points3D: THREE.Vector3[] = vertices.map(pt => new THREE.Vector3(pt.x, pt.y, 0));

    const geometry = new THREE.BufferGeometry().setFromPoints(points3D);

    // Get stroke color
    let color = 0xff00ff; // Default magenta
    let opacity = 1;
    if (element.stroke.type !== 'none' && 'color' in element.stroke) {
      const c = element.stroke.color;
      color = (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255);
      opacity = c[3];
    }

    // Create material with stroke color
    const material = new THREE.LineBasicMaterial({
      color: color,
      transparent: true,
      opacity: opacity,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      linewidth: 1,
    });

    // Use LineLoop for closed shapes, Line for open shapes
    const isClosed = this.isClosedVertexShape(shape);
    this.currentPathLine = isClosed
      ? new THREE.LineLoop(geometry, material)
      : new THREE.Line(geometry, material);

    this.pathScene.add(this.currentPathLine);
  }

  // Legacy method name for backward compatibility
  renderPathElement(element: DrawingElement): void {
    this.renderVertexElement(element);
  }

  /**
   * Check if a shape is path-based (legacy, now uses isCustomVertexShape)
   */
  private isPathShape(shape: Shape): boolean {
    return this.isCustomVertexShape(shape);
  }

  renderElement(element: DrawingElement): void {
    const u = this.material.uniforms;
    const time = performance.now() / 1000 - this.startTime;
    u.uTime.value = time;

    const shape = element.shape;
    u.uShapeType.value = this.getShapeTypeIndex(shape.type);
    u.uShapeCenter.value.set(shape.position.x, shape.position.y);
    u.uShapeRotation.value = (shape.rotation * Math.PI) / 180;
    u.uShapeScale.value.set(shape.scale.x, shape.scale.y);

    // Per-shape corner warp
    if (element.warpEnabled && element.warpCorners) {
      u.uWarpEnabled.value = true;
      u.uWarpTL.value.set(element.warpCorners.topLeft.x, element.warpCorners.topLeft.y);
      u.uWarpTR.value.set(element.warpCorners.topRight.x, element.warpCorners.topRight.y);
      u.uWarpBL.value.set(element.warpCorners.bottomLeft.x, element.warpCorners.bottomLeft.y);
      u.uWarpBR.value.set(element.warpCorners.bottomRight.x, element.warpCorners.bottomRight.y);
    } else {
      u.uWarpEnabled.value = false;
    }

    // Per-shape mesh warp
    if (element.meshWarpEnabled && element.meshWarp) {
      u.uMeshWarpEnabled.value = true;
      u.uMeshRows.value = element.meshWarp.rows;
      u.uMeshCols.value = element.meshWarp.cols;
      // Flatten mesh points into array
      const meshPoints = u.uMeshPoints.value as THREE.Vector2[];
      let idx = 0;
      for (let r = 0; r < element.meshWarp.rows && r < 4; r++) {
        for (let c = 0; c < element.meshWarp.cols && c < 4; c++) {
          if (idx < 16) {
            const pt = element.meshWarp.points[r][c];
            meshPoints[idx].set(pt.x, pt.y);
            idx++;
          }
        }
      }
    } else {
      u.uMeshWarpEnabled.value = false;
    }

    // Custom vertices (for warped shapes or freehand/polyline)
    if (shape.type !== 'circle' && shape.customVertices && shape.customVertices.length >= 2) {
      u.uUseCustomVertices.value = true;
      u.uCustomVertexCount.value = Math.min(shape.customVertices.length, 64);
      u.uCustomVerticesClosed.value = this.isClosedVertexShape(shape);

      // Copy vertices to uniform array
      const customVerts = u.uCustomVertices.value as THREE.Vector2[];
      for (let i = 0; i < 64; i++) {
        if (i < shape.customVertices.length) {
          customVerts[i].set(shape.customVertices[i].x, shape.customVertices[i].y);
        } else {
          customVerts[i].set(0, 0);
        }
      }
    } else if ('points' in shape && Array.isArray(shape.points) &&
               (shape.type === 'freehand' || shape.type === 'pointClickLine' || shape.type === 'polyline')) {
      // Freehand and point-click lines also use custom vertex rendering
      const points = shape.points as Point2D[];
      if (points.length >= 2) {
        u.uUseCustomVertices.value = true;
        u.uCustomVertexCount.value = Math.min(points.length, 64);
        u.uCustomVerticesClosed.value = this.isClosedVertexShape(shape);

        const customVerts = u.uCustomVertices.value as THREE.Vector2[];
        for (let i = 0; i < 64; i++) {
          if (i < points.length) {
            customVerts[i].set(points[i].x, points[i].y);
          } else {
            customVerts[i].set(0, 0);
          }
        }
      } else {
        u.uUseCustomVertices.value = false;
      }
    } else {
      u.uUseCustomVertices.value = false;
    }

    // Shape-specific properties
    if ('radius' in shape) {
      u.uShapeRadius.value = (shape as CircleShape).radius;
    }
    if ('width' in shape && 'height' in shape) {
      u.uWidth.value = (shape as RectangleShape).width;
      u.uHeight.value = (shape as RectangleShape).height;
    }
    if ('size' in shape) {
      u.uShapeRadius.value = (shape as TriangleShape).size;
    }
    if ('sides' in shape) {
      u.uShapeSides.value = (shape as PolygonShape).sides;
    }
    if ('points' in shape && shape.type === 'star') {
      u.uShapeSides.value = (shape as StarShape).points;
    }
    if ('innerRadius' in shape) {
      u.uInnerRadius.value = (shape as StarShape | RingShape).innerRadius;
    }
    if ('outerRadius' in shape) {
      u.uShapeRadius.value = (shape as StarShape | RingShape).outerRadius;
    }
    if ('turns' in shape) {
      u.uShapeSides.value = (shape as SpiralShape).turns;
      u.uInnerRadius.value = (shape as SpiralShape).startRadius;
      u.uShapeRadius.value = (shape as SpiralShape).endRadius;
    }

    // Stroke
    const stroke = element.stroke;
    u.uStrokeType.value = this.getStrokeTypeIndex(stroke.type);

    if (stroke.type !== 'none' && 'color' in stroke) {
      const c = (stroke as GlowStroke).color;
      u.uStrokeColor.value.set(c[0], c[1], c[2], c[3]);
    }
    if (stroke.type !== 'none' && 'width' in stroke) {
      u.uStrokeWidth.value = (stroke as GlowStroke).width;
    }
    if ('glowSize' in stroke) {
      u.uGlowSize.value = (stroke as GlowStroke).glowSize;
    }
    if ('glowIntensity' in stroke) {
      u.uGlowIntensity.value = (stroke as GlowStroke).glowIntensity;
    }
    if ('pulseSpeed' in stroke) {
      u.uPulseSpeed.value = (stroke as GlowStroke).pulseSpeed;
    }
    if ('flickerSpeed' in stroke) {
      u.uPulseSpeed.value = (stroke as NeonStroke).flickerSpeed;
    }
    if ('length' in stroke) {
      u.uSnakeLength.value = (stroke as SnakeStroke).length;
    }
    if ('speed' in stroke) {
      u.uSnakeSpeed.value = (stroke as SnakeStroke).speed;
    }
    if ('snakeCount' in stroke) {
      u.uSnakeCount.value = (stroke as SnakeStroke).snakeCount;
    } else {
      u.uSnakeCount.value = 1;
    }
    // Extended stroke uniforms
    if ('dashLength' in stroke) {
      u.uDashLength.value = (stroke as any).dashLength;
    }
    if ('gapLength' in stroke) {
      u.uGapLength.value = (stroke as any).gapLength;
    }
    if ('arcIntensity' in stroke) {
      u.uElectricArc.value = (stroke as any).arcIntensity;
    }
    if ('beamWidth' in stroke) {
      u.uScannerBeamWidth.value = (stroke as any).beamWidth;
    }
    if ('trail' in stroke) {
      u.uScannerTrail.value = (stroke as any).trail;
    }
    if ('rate' in stroke) {
      u.uStrobeRate.value = (stroke as any).rate;
    }

    // Fill
    const fill = element.fill;
    u.uFillType.value = this.getFillTypeIndex(fill.type);

    if (fill.type !== 'none' && 'color' in fill) {
      const c = (fill as SolidFill).color;
      u.uFillColor.value.set(c[0], c[1], c[2], c[3]);
    }
    if ('speed' in fill) {
      u.uFillSpeed.value = (fill as PlasmaFill).speed;
    }
    // Extended fill uniforms
    if ('scale' in fill) {
      u.uNoiseScale.value = (fill as any).scale;
    }
    if ('turbulence' in fill) {
      u.uNoiseTurbulence.value = (fill as any).turbulence;
    }
    if ('shiftAmount' in fill) {
      u.uHoloShift.value = (fill as any).shiftAmount;
    }
    if ('scanlines' in fill) {
      u.uHoloScanlines.value = (fill as any).scanlines;
    }
    if ('angle' in fill) {
      u.uGradAngle.value = (fill as any).angle;
    }

    // Enhanced fill parameters
    // Plasma
    if (fill.type === 'plasma') {
      u.uPlasmaScale.value = (fill as any).scale ?? 8;
      u.uPlasmaComplexity.value = (fill as any).complexity ?? 3;
      const paletteMap: Record<string, number> = { rainbow: 0, fire: 1, ocean: 2, neon: 3 };
      u.uPlasmaPalette.value = paletteMap[(fill as any).palette] ?? 0;
    }
    // Liquid
    if (fill.type === 'liquid') {
      u.uLiquidViscosity.value = (fill as any).viscosity ?? 0.5;
      u.uLiquidTurbulence.value = (fill as any).turbulence ?? 0.5;
      u.uLiquidMetallic.value = (fill as any).metallic ?? 0.5;
    }
    // Fire
    if (fill.type === 'fire') {
      u.uFireIntensity.value = (fill as any).intensity ?? 1;
      u.uFireTurbulence.value = (fill as any).turbulence ?? 0.5;
      const firePaletteMap: Record<string, number> = { orange: 0, blue: 1, green: 2, purple: 3 };
      u.uFirePalette.value = firePaletteMap[(fill as any).palette] ?? 0;
    }
    // Electric
    if (fill.type === 'electric') {
      u.uElectricIntensity.value = (fill as any).intensity ?? 1;
      u.uElectricArcCount.value = (fill as any).arcCount ?? 5;
    }
    // Holographic
    if (fill.type === 'holographic') {
      u.uHoloFlicker.value = (fill as any).flicker ?? 0.5;
    }
    // Noise - second color
    if (fill.type === 'noise' && 'color2' in fill) {
      const c2 = (fill as any).color2;
      u.uNoiseColor2.value.set(c2[0], c2[1], c2[2], c2[3]);
      // Also set primary color from color1
      if ('color1' in fill) {
        const c1 = (fill as any).color1;
        u.uFillColor.value.set(c1[0], c1[1], c1[2], c1[3]);
      }
    }
    // Gradient - second color and type
    if (fill.type === 'gradient') {
      if ('color2' in fill) {
        const c2 = (fill as any).color2;
        u.uGradColor2.value.set(c2[0], c2[1], c2[2], c2[3]);
      }
      if ('color' in fill) {
        const c1 = (fill as any).color;
        u.uFillColor.value.set(c1[0], c1[1], c1[2], c1[3]);
      }
      const gradTypeMap: Record<string, number> = { linear: 0, radial: 1, angular: 2 };
      u.uGradType.value = gradTypeMap[(fill as any).gradientType] ?? 0;
    }

    // Animation
    const animation = element.animation;
    u.uAnimationType.value = this.getAnimationTypeIndex(animation.type);

    if (animation.type === 'concentric') {
      const anim = animation as ConcentricAnimation;
      u.uAnimCount.value = anim.count;
      u.uAnimSpacing.value = anim.spacing;
      u.uAnimSpeed.value = anim.speed;
      const directionMap: Record<string, number> = { 'out': 0, 'in': 1, 'both': 2 };
      u.uConcentricDirection.value = directionMap[anim.direction] ?? 0;
    } else if (animation.type === 'breathe') {
      u.uAnimSpeed.value = (animation as any).speed ?? 1;
      u.uBreatheMin.value = (animation as any).minScale ?? 0.8;
      u.uBreatheMax.value = (animation as any).maxScale ?? 1.2;
    } else if (animation.type === 'rotate') {
      u.uAnimSpeed.value = (animation as any).speed ?? 1;
      u.uRotateDir.value = (animation as any).direction === 'ccw' ? 1 : 0;
      // Apply continuous rotation by modifying shape rotation
      const time = performance.now() / 1000 - this.startTime;
      const rotSpeed = (animation as any).speed ?? 1;
      const dir = (animation as any).direction === 'ccw' ? -1 : 1;
      u.uShapeRotation.value = (element.shape.rotation * Math.PI / 180) + time * rotSpeed * dir;
    } else if (animation.type === 'radiate') {
      u.uAnimCount.value = (animation as any).rays ?? 8;
      u.uAnimSpeed.value = (animation as any).speed ?? 1;
    } else if (animation.type === 'ripple') {
      u.uAnimCount.value = (animation as any).count ?? 5;
      u.uAnimSpacing.value = (animation as any).spacing ?? 0.04;
      u.uAnimSpeed.value = (animation as any).speed ?? 1;
      u.uRippleDecay.value = (animation as any).decay ?? 1;
    } else if (animation.type === 'wave') {
      u.uAnimSpeed.value = (animation as any).speed ?? 1;
      u.uWaveAmplitude.value = (animation as any).amplitude ?? 1;
      u.uWaveFrequency.value = (animation as any).frequency ?? 1;
    } else if (animation.type === 'glitch') {
      u.uAnimSpeed.value = (animation as any).speed ?? 1;
      u.uGlitchIntensity.value = (animation as any).intensity ?? 1;
      u.uGlitchBlockSize.value = (animation as any).blockSize ?? 1;
    } else {
      u.uAnimCount.value = 0;
    }
  }

  render(layers: DrawingLayer[]): THREE.Texture {
    // Clear render target
    this.renderer.setRenderTarget(this.renderTarget);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();

    // Render each visible layer
    for (const layer of layers) {
      if (!layer.visible) continue;

      // Render each visible element
      for (const element of layer.elements) {
        if (!element.shape.visible) continue;

        // Check if this is a path-based shape (freehand, pointClickLine)
        if (this.isPathShape(element.shape)) {
          this.renderPathElement(element);
          this.renderer.render(this.pathScene, this.camera);
        } else {
          this.renderElement(element);
          this.renderer.render(this.scene, this.camera);
        }
      }
    }

    this.renderer.setRenderTarget(null);
    return this.renderTarget.texture;
  }

  /**
   * Render a list of elements directly to an external render target.
   * Used for generative layers in the main layer pipeline.
   * All elements are composited together with additive blending.
   */
  renderElements(elements: DrawingElement[], target: THREE.WebGLRenderTarget): THREE.Texture {
    // Clear the target ONCE at the start
    this.renderer.setRenderTarget(target);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();

    // CRITICAL: Disable autoClear so subsequent renders don't wipe previous shapes
    const prevAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;

    // Update resolution uniform if target size differs from internal
    const currentRes = this.material.uniforms.uResolution.value;
    if (currentRes.x !== target.width || currentRes.y !== target.height) {
      this.material.uniforms.uResolution.value.set(target.width, target.height);
    }

    // Sort elements by zIndex for proper layering
    const sortedElements = [...elements].sort((a, b) => a.shape.zIndex - b.shape.zIndex);

    // Render each visible element WITHOUT clearing between them
    for (const element of sortedElements) {
      if (!element.shape.visible) continue;

      // Check if this is a path-based shape (freehand, pointClickLine)
      if (this.isPathShape(element.shape)) {
        this.renderPathElement(element);
        this.renderer.render(this.pathScene, this.camera);
      } else {
        this.renderElement(element);
        // Render with additive blending - each shape adds to the result
        this.renderer.render(this.scene, this.camera);
      }
    }

    // Restore autoClear and resolution
    this.renderer.autoClear = prevAutoClear;
    this.material.uniforms.uResolution.value.set(this.width, this.height);

    this.renderer.setRenderTarget(null);
    return target.texture;
  }

  dispose(): void {
    this.renderTarget.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
    this.pathMaterial.dispose();
    if (this.currentPathLine) {
      this.currentPathLine.geometry.dispose();
    }
  }
}

// ============================================================================
// PATH UTILITIES
// ============================================================================

export function smoothPath(points: Point2D[], smoothing: number): Point2D[] {
  if (points.length < 3 || smoothing === 0) return points;

  const result: Point2D[] = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    result.push({
      x: curr.x * (1 - smoothing) + (prev.x + next.x) * 0.5 * smoothing,
      y: curr.y * (1 - smoothing) + (prev.y + next.y) * 0.5 * smoothing,
    });
  }

  result.push(points[points.length - 1]);
  return result;
}

export function simplifyPath(points: Point2D[], tolerance: number): Point2D[] {
  if (points.length < 3) return points;

  function rdp(start: number, end: number): number[] {
    if (end - start < 2) return [start, end];

    let maxDist = 0;
    let maxIndex = start;

    const lineStart = points[start];
    const lineEnd = points[end];

    for (let i = start + 1; i < end; i++) {
      const dist = pointToLineDistance(points[i], lineStart, lineEnd);
      if (dist > maxDist) {
        maxDist = dist;
        maxIndex = i;
      }
    }

    if (maxDist > tolerance) {
      const left = rdp(start, maxIndex);
      const right = rdp(maxIndex, end);
      return [...left.slice(0, -1), ...right];
    }

    return [start, end];
  }

  const indices = rdp(0, points.length - 1);
  return indices.map((i) => points[i]);
}

function pointToLineDistance(point: Point2D, lineStart: Point2D, lineEnd: Point2D): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const len = Math.sqrt(dx * dx + dy * dy);

  if (len === 0) return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2);

  const t = Math.max(0, Math.min(1, ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (len * len)));
  const projX = lineStart.x + t * dx;
  const projY = lineStart.y + t * dy;

  return Math.sqrt((point.x - projX) ** 2 + (point.y - projY) ** 2);
}
