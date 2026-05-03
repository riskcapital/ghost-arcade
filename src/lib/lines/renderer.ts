// Lines Renderer - WebGL-based line rendering with stroke effects and draw animations
// Forked from drawing/renderer.ts — no fills, no shapes, no shape animations
import * as THREE from 'three';
import type {
  LineElement,
  LineStroke,
  LineDrawAnimation,
  LineShape,
  ShapeWarpCorners,
  ShapeMeshWarp,
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

  // Shared shader mask mode
  uniform bool uUseSharedShader;
  uniform sampler2D uSharedShaderTexture;

  // Per-element corner warp uniforms
  uniform bool uWarpEnabled;
  uniform vec2 uWarpTL;
  uniform vec2 uWarpTR;
  uniform vec2 uWarpBL;
  uniform vec2 uWarpBR;

  // Per-element mesh warp uniforms (up to 4x4 = 16 points)
  uniform bool uMeshWarpEnabled;
  uniform int uMeshRows;
  uniform int uMeshCols;
  uniform vec2 uMeshPoints[16];

  // Custom vertex uniforms (polyline points)
  uniform int uCustomVertexCount;
  uniform vec2 uCustomVertices[64];
  uniform bool uCustomVerticesClosed;

  // Element transform
  uniform vec2 uPosition;
  uniform float uRotation;
  uniform vec2 uScale;

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

  // Extended stroke uniforms
  uniform float uDashLength;
  uniform float uGapLength;
  uniform float uElectricArc;
  uniform float uElectricBranches;
  uniform float uScannerBeamWidth;
  uniform float uScannerTrail;
  uniform float uStrobeRate;

  // Draw progress uniforms
  uniform float uDrawProgress;   // 0-1, how much of the line is drawn
  uniform float uTrailLength;    // 0-1, trail behind the head

  // MultiTail stroke uniforms
  uniform float uMultiTailCount;
  uniform float uMultiTailLength;
  uniform float uMultiTailSpacing;
  uniform float uMultiTailSpeed;
  uniform bool uMultiTailFade;
  uniform bool uMultiTailHeadGlow;
  uniform bool uMultiTailColorShift;
  uniform float uMultiTailColorShiftAmt;

  // Laser stroke uniforms
  uniform float uLaserIntensity;
  uniform float uLaserScatter;
  uniform float uLaserFlicker;

  // Pipe stroke uniforms
  uniform float uPipeDepth;
  uniform float uPipeEdgeLight;
  uniform vec4 uPipeEdgeLightColor;
  uniform float uPipeSpecular;
  uniform float uPipeRoughness;

  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  // ========== UTILITY FUNCTIONS ==========

  float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  vec2 inverseWarp(vec2 p, vec2 tl, vec2 tr, vec2 bl, vec2 br) {
    vec2 uv = vec2(0.5, 0.5);

    for (int i = 0; i < 8; i++) {
      vec2 top = mix(tl, tr, uv.x);
      vec2 bottom = mix(bl, br, uv.x);
      vec2 predicted = mix(top, bottom, uv.y);

      vec2 error = p - predicted;

      vec2 dTop = tr - tl;
      vec2 dBottom = br - bl;
      vec2 dX = mix(dTop, dBottom, uv.y);
      vec2 dY = bottom - top;

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

  vec2 inverseMeshWarp(vec2 p, int rows, int cols) {
    vec2 uv = clamp(p, 0.0, 1.0);

    for (int iter = 0; iter < 8; iter++) {
      float cellX = uv.x * float(cols - 1);
      float cellY = uv.y * float(rows - 1);
      int col0 = int(floor(cellX));
      int row0 = int(floor(cellY));
      col0 = clamp(col0, 0, cols - 2);
      row0 = clamp(row0, 0, rows - 2);

      float tx = cellX - float(col0);
      float ty = cellY - float(row0);

      int i00 = row0 * cols + col0;
      int i10 = row0 * cols + col0 + 1;
      int i01 = (row0 + 1) * cols + col0;
      int i11 = (row0 + 1) * cols + col0 + 1;

      vec2 p00 = uMeshPoints[i00];
      vec2 p10 = uMeshPoints[i10];
      vec2 p01 = uMeshPoints[i01];
      vec2 p11 = uMeshPoints[i11];

      vec2 top = mix(p00, p10, tx);
      vec2 bottom = mix(p01, p11, tx);
      vec2 predicted = mix(top, bottom, ty);

      vec2 error = p - predicted;
      if (length(error) < 0.0001) break;

      vec2 dTop = p10 - p00;
      vec2 dBottom = p11 - p01;
      vec2 dX = mix(dTop, dBottom, ty) * float(cols - 1);
      vec2 dY = (bottom - top) * float(rows - 1);

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

  // ========== LINE SDF FUNCTIONS ==========

  float sdLine(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }

  // SDF for polyline using edge distances
  float sdPolygonCustom(vec2 p, int count, bool closed) {
    if (count < 2) return 1000.0;

    float minDist = 1000.0;
    float sign = 1.0;
    int numEdges = closed ? count : count - 1;

    if (closed) {
      float winding = 0.0;
      for (int i = 0; i < 64; i++) {
        if (i >= count) break;
        int j = (i + 1 < count) ? i + 1 : 0;
        vec2 a = uCustomVertices[i];
        vec2 b = uCustomVertices[j];

        vec2 pa = p - a;
        vec2 ba = b - a;
        float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        float d = length(pa - ba * h);
        minDist = min(minDist, d);

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

  // Calculate path position along polyline (0-1) for animated effects
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

  // ========== DRAW PROGRESS MASKING ==========

  float drawMask(float pathPos, float progress, float trail) {
    if (progress >= 1.0) return 1.0;
    if (progress <= 0.0) return 0.0;
    float headPos = progress;
    float tailPos = max(0.0, progress - trail);
    float mask = smoothstep(tailPos - 0.02, tailPos, pathPos) *
                 (1.0 - smoothstep(headPos, headPos + 0.02, pathPos));
    return mask;
  }

  // ========== HSV UTILITY ==========

  vec3 hsvToRgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  vec3 rgbToHsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  }

  // ========== STROKE RENDERING ==========

  vec4 renderSolidStroke(float d, vec4 color, float width) {
    float strokeDist = abs(d) - width * 0.5;
    float alpha = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, strokeDist);
    return vec4(color.rgb, color.a * alpha);
  }

  vec4 renderGlowStroke(float d, vec4 color, float width, float glowSize, float intensity, float pulse) {
    float pulseMod = pulse > 0.0 ? 0.7 + 0.3 * sin(uTime * pulse * 3.0) : 1.0;

    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

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

    float coreDist = abs(d) - width * 0.3;
    float core = 1.0 - smoothstep(0.0, 1.5 / uResolution.x, coreDist);

    float innerDist = abs(d) - width * 0.5;
    float inner = 1.0 - smoothstep(0.0, 3.0 / uResolution.x, innerDist);

    float outerDist = abs(d);
    float outer = 1.0 - smoothstep(0.0, glowSize / uResolution.x, outerDist);
    outer = pow(outer, 1.5);

    vec3 finalColor = vec3(1.0) * core * 0.8 + color.rgb * inner + color.rgb * outer * 0.5;
    finalColor *= flickerMod;
    float finalAlpha = max(core, max(inner * 0.9, outer * 0.6));

    return vec4(finalColor, finalAlpha * color.a);
  }

  vec4 renderSnakeStroke(float d, vec4 color, float width, float snakeLen, float speed, float pathPos, int snakeCount) {
    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

    float totalInSnake = 0.0;
    float totalFade = 0.0;
    float totalHeadGlow = 0.0;

    for (int s = 0; s < 8; s++) {
      if (s >= snakeCount) break;

      float snakeOffset = float(s) / float(snakeCount);
      float t = mod(uTime * speed + snakeOffset, 1.0);

      float headPos = t;
      float tailPos = t - snakeLen;

      float inSnake = 0.0;
      float fade = 0.0;

      if (tailPos >= 0.0) {
        inSnake = smoothstep(tailPos - 0.02, tailPos + 0.02, pathPos) *
                  (1.0 - smoothstep(headPos - 0.02, headPos + 0.02, pathPos));
        fade = 1.0 - smoothstep(tailPos, headPos, pathPos);
      } else {
        float wrappedTail = tailPos + 1.0;
        float inHead = smoothstep(-0.02, 0.02, pathPos) *
                       (1.0 - smoothstep(headPos - 0.02, headPos + 0.02, pathPos));
        float inTail = smoothstep(wrappedTail - 0.02, wrappedTail + 0.02, pathPos);

        inSnake = max(inHead, inTail);

        if (pathPos <= headPos) {
          fade = 1.0 - (pathPos / (headPos + (1.0 - wrappedTail)));
        } else if (pathPos >= wrappedTail) {
          fade = 1.0 - ((pathPos - wrappedTail + headPos + 0.001) / (headPos + (1.0 - wrappedTail)));
        }
      }

      totalInSnake = max(totalInSnake, inSnake);
      totalFade = max(totalFade, fade * inSnake);

      float headDist = abs(pathPos - headPos);
      float headDistWrapped = min(headDist, 1.0 - headDist);
      totalHeadGlow = max(totalHeadGlow, exp(-headDistWrapped * 30.0));
    }

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

  vec4 renderDashedStroke(float d, vec4 color, float width, float dashLen, float gapLen, float pathPos, float speed) {
    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

    float cycle = dashLen + gapLen;
    float pos = mod(pathPos + uTime * speed * 0.1, 1.0);
    float dashPhase = mod(pos * 10.0, cycle);
    float dash = smoothstep(0.0, 0.02, dashPhase) * (1.0 - smoothstep(dashLen - 0.02, dashLen, dashPhase));

    return vec4(color.rgb * core * dash, color.a * core * dash);
  }

  vec4 renderDottedStroke(float d, vec4 color, float width, float dotSize, float spacing, float pathPos, float speed) {
    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

    float cycle = dotSize + spacing;
    float pos = mod(pathPos + uTime * speed * 0.1, 1.0);
    float dotPhase = mod(pos * 10.0, cycle);
    float dot = smoothstep(0.0, 0.02, dotPhase) * (1.0 - smoothstep(dotSize - 0.02, dotSize, dotPhase));

    return vec4(color.rgb * core * dot, color.a * core * dot);
  }

  vec4 renderElectricStroke(float d, vec4 color, float width, float arcIntensity, float speed, float pathPos) {
    float t = uTime * speed;

    float jitter = sin(pathPos * 50.0 + t * 20.0) * arcIntensity * 0.003;
    jitter += sin(pathPos * 120.0 + t * 35.0) * arcIntensity * 0.002;
    float coreDist = abs(d + jitter) - width * 0.3;
    float core = 1.0 - smoothstep(0.0, 1.5 / uResolution.x, coreDist);

    float arc1Offset = sin(pathPos * 30.0 + t * 15.0) * arcIntensity * 0.008;
    float arc1 = 1.0 - smoothstep(0.0, 3.0 / uResolution.x, abs(d + arc1Offset) - width * 0.15);

    float arc2Offset = cos(pathPos * 45.0 + t * 22.0) * arcIntensity * 0.006;
    float arc2 = 1.0 - smoothstep(0.0, 3.0 / uResolution.x, abs(d + arc2Offset) - width * 0.1);

    vec3 coreColor = vec3(1.0) * core;
    vec3 arcColor = color.rgb * (arc1 * 0.6 + arc2 * 0.4);

    float glow = 1.0 - smoothstep(0.0, width * 3.0 / uResolution.x, abs(d));
    glow = pow(glow, 2.5) * 0.4;
    vec3 glowColor = color.rgb * glow;

    float flicker = 0.85 + 0.15 * random(vec2(floor(t * 12.0), pathPos * 5.0));

    vec3 finalColor = (coreColor + arcColor + glowColor) * flicker;
    float alpha = max(core, max(arc1 * 0.6, max(arc2 * 0.4, glow * 0.5)));
    return vec4(finalColor, alpha * color.a);
  }

  vec4 renderScannerStroke(float d, vec4 color, float width, float beamWidth, float speed, float pathPos, float trail) {
    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

    float scanPos = mod(uTime * speed * 0.2, 1.0);
    float dist = abs(pathPos - scanPos);
    dist = min(dist, 1.0 - dist);

    float beam = 1.0 - smoothstep(0.0, beamWidth, dist);
    beam = pow(beam, 2.0);

    float trailDist = mod(scanPos - pathPos + 1.0, 1.0);
    float trailFade = (1.0 - smoothstep(0.0, trail, trailDist)) * 0.4;

    float intensity = max(beam, trailFade);

    float glow = 1.0 - smoothstep(0.0, width * 2.0 / uResolution.x, abs(d));
    glow = pow(glow, 2.0) * beam * 0.6;

    vec3 finalColor = color.rgb * (core * intensity + glow);
    float alpha = core * intensity + glow * 0.5;
    return vec4(finalColor, alpha * color.a);
  }

  vec4 renderFireStroke(float d, vec4 color, float width, float speed, float pathPos) {
    float t = uTime * speed;

    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

    float noise = sin(pathPos * 20.0 + t * 5.0) * 0.5 + 0.5;
    noise *= sin(pathPos * 35.0 - t * 3.0) * 0.5 + 0.5;
    noise += sin(pathPos * 8.0 + t * 7.0) * 0.3;

    vec3 fireColor = mix(vec3(1.0, 0.2, 0.0), vec3(1.0, 0.9, 0.2), noise);
    fireColor = mix(fireColor, vec3(1.0), core * 0.5);

    float flameDist = abs(d) - width * (0.5 + noise * 0.8);
    float flame = 1.0 - smoothstep(0.0, width * 2.0 / uResolution.x, max(flameDist, 0.0));
    flame *= noise;

    vec3 finalColor = fireColor * core + vec3(1.0, 0.3, 0.0) * flame * 0.6;
    float alpha = max(core, flame * 0.5);
    return vec4(finalColor, alpha * color.a);
  }

  vec4 renderPulseStroke(float d, vec4 color, float width, float pulseCount, float speed, float pathPos, float fadeLength) {
    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

    float totalPulse = 0.0;
    for (int i = 0; i < 12; i++) {
      if (float(i) >= pulseCount) break;
      float offset = float(i) / pulseCount;
      float t = mod(uTime * speed + offset, 1.0);
      float dist = abs(pathPos - t);
      dist = min(dist, 1.0 - dist);
      float pulse = exp(-dist * (1.0 / max(fadeLength, 0.01)) * 10.0);
      totalPulse = max(totalPulse, pulse);
    }

    vec3 finalColor = color.rgb * core * totalPulse;
    float alpha = core * totalPulse;

    float glow = 1.0 - smoothstep(0.0, width * 1.5 / uResolution.x, abs(d));
    glow = pow(glow, 2.0) * totalPulse * 0.4;
    finalColor += color.rgb * glow;
    alpha = max(alpha, glow * 0.6);

    return vec4(finalColor, alpha * color.a);
  }

  // ========== STROKE: MultiTail ==========

  vec4 renderMultiTailStroke(float d, vec4 color, float width, float pathPos) {
    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

    float totalIntensity = 0.0;
    vec3 totalColor = vec3(0.0);
    float totalHeadGlow = 0.0;

    int tailCount = int(uMultiTailCount);

    for (int i = 0; i < 12; i++) {
      if (i >= tailCount) break;

      float headOffset = float(i) * uMultiTailSpacing;
      float headPos = mod(uTime * uMultiTailSpeed + headOffset, 1.0);
      float tailPos = headPos - uMultiTailLength;

      float inTail = 0.0;
      float fade = 1.0;

      if (tailPos >= 0.0) {
        inTail = smoothstep(tailPos - 0.02, tailPos + 0.02, pathPos) *
                 (1.0 - smoothstep(headPos - 0.02, headPos + 0.02, pathPos));
        if (uMultiTailFade) {
          fade = smoothstep(tailPos, headPos, pathPos);
        }
      } else {
        float wrappedTail = tailPos + 1.0;
        float inHead = smoothstep(-0.02, 0.02, pathPos) *
                       (1.0 - smoothstep(headPos - 0.02, headPos + 0.02, pathPos));
        float inTailWrap = smoothstep(wrappedTail - 0.02, wrappedTail + 0.02, pathPos);
        inTail = max(inHead, inTailWrap);

        if (uMultiTailFade) {
          if (pathPos <= headPos) {
            fade = (pathPos + (1.0 - wrappedTail)) / (headPos + (1.0 - wrappedTail));
          } else if (pathPos >= wrappedTail) {
            fade = (pathPos - wrappedTail) / (headPos + (1.0 - wrappedTail));
          }
        }
      }

      // Per-tail hue shift
      vec3 tailColor = color.rgb;
      if (uMultiTailColorShift) {
        vec3 hsv = rgbToHsv(color.rgb);
        hsv.x = mod(hsv.x + float(i) * uMultiTailColorShiftAmt, 1.0);
        tailColor = hsvToRgb(hsv);
      }

      float contribution = inTail * fade;
      totalIntensity = max(totalIntensity, contribution);
      totalColor = max(totalColor, tailColor * contribution);

      // Head glow per tail
      if (uMultiTailHeadGlow) {
        float headDist = abs(pathPos - headPos);
        float headDistWrapped = min(headDist, 1.0 - headDist);
        totalHeadGlow = max(totalHeadGlow, exp(-headDistWrapped * 30.0));
      }
    }

    float glowDist = abs(d);
    float glow = (1.0 - smoothstep(0.0, width * 2.0 / uResolution.x, glowDist)) * totalHeadGlow;

    vec3 finalColor = totalColor * core + color.rgb * glow;
    float alpha = core * totalIntensity + glow * 0.5;

    return vec4(finalColor, alpha * color.a);
  }

  // ========== NEW STROKE: Laser ==========

  vec4 renderLaserStroke(float d, vec4 color, float width) {
    float absDist = abs(d);

    // Flicker modulation
    float flickerMod = 1.0;
    if (uLaserFlicker > 0.0) {
      flickerMod = 1.0 - uLaserFlicker * 0.3 * (0.5 + 0.5 * sin(uTime * 37.0));
      flickerMod *= 1.0 - uLaserFlicker * 0.15 * step(0.92, random(vec2(floor(uTime * 20.0), 0.0)));
    }

    // Tight bright gaussian core
    float coreWidth = width * 0.3 / uResolution.x;
    float core = exp(-absDist * absDist / (coreWidth * coreWidth * 0.5));
    core *= uLaserIntensity;

    // Wider scatter glow (atmospheric scatter)
    float scatterWidth = width * 3.0 / uResolution.x;
    float scatter = exp(-absDist * absDist / (scatterWidth * scatterWidth));
    scatter *= uLaserScatter * 0.6;

    // Super-bright white center, colored edges
    vec3 coreColor = mix(color.rgb, vec3(1.0), 0.7) * core;
    vec3 scatterColor = color.rgb * scatter;

    vec3 finalColor = (coreColor + scatterColor) * flickerMod;
    float alpha = max(core, scatter * 0.8);

    return vec4(finalColor, clamp(alpha, 0.0, 1.0) * color.a);
  }

  // ========== NEW STROKE: Pipe ==========

  vec4 renderPipeStroke(float d, vec4 color, float width) {
    float absDist = abs(d);
    float halfWidth = width * 0.5 / uResolution.x;

    // Inside the pipe band
    float inside = 1.0 - smoothstep(halfWidth - 1.0 / uResolution.x, halfWidth + 1.0 / uResolution.x, absDist);
    if (inside < 0.01) return vec4(0.0);

    // Normalized distance from center of pipe (0 = center, 1 = edge)
    float normDist = absDist / halfWidth;

    // Cylindrical shading: dark center, bright edges (rim light)
    float shade = mix(1.0 - uPipeDepth * 0.6, 1.0, pow(normDist, 1.5));

    // Specular highlight band (fake light direction — slightly off-center)
    float specPos = 0.3; // highlight position (0 = center, 1 = edge)
    float specWidth = mix(0.4, 0.1, uPipeRoughness);
    float spec = exp(-pow((normDist - specPos) / specWidth, 2.0));
    spec *= uPipeSpecular;

    // Edge (rim) lighting
    float rimStart = 0.7;
    float rim = smoothstep(rimStart, 1.0, normDist);
    rim *= uPipeEdgeLight;

    // Combine
    vec3 baseColor = color.rgb * shade;
    baseColor += vec3(1.0) * spec * 0.6;  // White specular
    vec3 rimColor = uPipeEdgeLightColor.rgb * rim;
    vec3 finalColor = baseColor + rimColor;

    return vec4(finalColor * inside, inside * color.a);
  }

  // ========== MAIN ==========

  void main() {
    vec2 p = vUv;

    // Apply per-element mesh warp if enabled
    if (uMeshWarpEnabled && uMeshRows >= 2 && uMeshCols >= 2) {
      p = inverseMeshWarp(p, uMeshRows, uMeshCols);

      if (p.x < -0.1 || p.x > 1.1 || p.y < -0.1 || p.y > 1.1) {
        gl_FragColor = vec4(0.0);
        return;
      }
    }

    // Apply per-element corner warp if enabled
    if (uWarpEnabled) {
      p = inverseWarp(p, uWarpTL, uWarpTR, uWarpBL, uWarpBR);

      if (p.x < -0.1 || p.x > 1.1 || p.y < -0.1 || p.y > 1.1) {
        gl_FragColor = vec4(0.0);
        return;
      }
    }

    // Lines always use polyline SDF via custom vertices
    if (uCustomVertexCount < 2) {
      gl_FragColor = vec4(0.0);
      return;
    }

    float d = sdPolygonCustom(p, uCustomVertexCount, uCustomVerticesClosed);
    float pathPos = getCustomPolygonPathPos(p, uCustomVertexCount, uCustomVerticesClosed);

    // Render stroke by type
    vec4 strokeColor = vec4(0.0);

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
    } else if (uStrokeType == 7) { // Dotted
      strokeColor = renderDottedStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, uDashLength, uGapLength, pathPos, uSnakeSpeed);
    } else if (uStrokeType == 8) { // Electric
      strokeColor = renderElectricStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, uElectricArc, uSnakeSpeed, pathPos);
    } else if (uStrokeType == 9) { // Scanner
      strokeColor = renderScannerStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, uScannerBeamWidth, uSnakeSpeed, pathPos, uScannerTrail);
    } else if (uStrokeType == 10) { // Fire
      strokeColor = renderFireStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, uSnakeSpeed, pathPos);
    } else if (uStrokeType == 11) { // Pulse
      strokeColor = renderPulseStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, uSnakeLength, uSnakeSpeed, pathPos, uScannerTrail);
    } else if (uStrokeType == 12) { // MultiTail
      strokeColor = renderMultiTailStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, pathPos);
    } else if (uStrokeType == 13) { // Laser
      strokeColor = renderLaserStroke(d, uStrokeColor, uStrokeWidth / uResolution.x);
    } else if (uStrokeType == 14) { // Pipe
      strokeColor = renderPipeStroke(d, uStrokeColor, uStrokeWidth / uResolution.x);
    }

    // Apply draw progress mask
    float mask = drawMask(pathPos, uDrawProgress, uTrailLength);
    strokeColor *= mask;

    // Shared shader mask mode: use line alpha as a window into a shared texture
    if (uUseSharedShader) {
      vec4 shaderSample = texture2D(uSharedShaderTexture, vUv);
      // Use the stroke's alpha shape as the mask, shader's color as the fill
      gl_FragColor = vec4(shaderSample.rgb * strokeColor.a, strokeColor.a);
    } else {
      gl_FragColor = strokeColor;
    }
  }
`;

// ============================================================================
// EASING HELPERS
// ============================================================================

function applyEasing(t: number, easing: string): number {
  switch (easing) {
    case 'easeIn': return t * t;
    case 'easeOut': return t * (2 - t);
    case 'easeInOut': return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    default: return t; // linear
  }
}

// ============================================================================
// LINES RENDERER CLASS
// ============================================================================

export class LinesRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private renderTarget: THREE.WebGLRenderTarget;
  private quad: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private width: number;
  private height: number;
  private startTime: number;
  private animationStartTimes: Map<string, number> = new Map();
  private layerAnimationBaseTime: number = 0;

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

        // Element transform
        uPosition: { value: new THREE.Vector2(0, 0) },
        uRotation: { value: 0 },
        uScale: { value: new THREE.Vector2(1, 1) },

        // Per-element corner warp
        uWarpEnabled: { value: false },
        uWarpTL: { value: new THREE.Vector2(0, 0) },
        uWarpTR: { value: new THREE.Vector2(1, 0) },
        uWarpBL: { value: new THREE.Vector2(0, 1) },
        uWarpBR: { value: new THREE.Vector2(1, 1) },

        // Per-element mesh warp
        uMeshWarpEnabled: { value: false },
        uMeshRows: { value: 3 },
        uMeshCols: { value: 3 },
        uMeshPoints: { value: this.createDefaultMeshPoints(3, 3) },

        // Custom vertex polyline
        uCustomVertexCount: { value: 0 },
        uCustomVertices: { value: this.createDefaultCustomVertices() },
        uCustomVerticesClosed: { value: false },

        // Stroke
        uStrokeType: { value: 2 },
        uStrokeColor: { value: new THREE.Vector4(0, 1, 0.5, 1) },
        uStrokeWidth: { value: 4 },
        uGlowSize: { value: 20 },
        uGlowIntensity: { value: 1 },
        uPulseSpeed: { value: 0 },
        uSnakeLength: { value: 0.3 },
        uSnakeSpeed: { value: 1 },
        uSnakeCount: { value: 1 },

        // Extended stroke uniforms
        uDashLength: { value: 0.3 },
        uGapLength: { value: 0.2 },
        uElectricArc: { value: 1.0 },
        uElectricBranches: { value: 3.0 },
        uScannerBeamWidth: { value: 0.1 },
        uScannerTrail: { value: 0.3 },
        uStrobeRate: { value: 4.0 },

        // Draw progress
        uDrawProgress: { value: 1.0 },
        uTrailLength: { value: 0.0 },

        // Shared shader mask mode
        uUseSharedShader: { value: false },
        uSharedShaderTexture: { value: null },

        // MultiTail uniforms
        uMultiTailCount: { value: 3.0 },
        uMultiTailLength: { value: 0.15 },
        uMultiTailSpacing: { value: 0.12 },
        uMultiTailSpeed: { value: 1.0 },
        uMultiTailFade: { value: true },
        uMultiTailHeadGlow: { value: true },
        uMultiTailColorShift: { value: false },
        uMultiTailColorShiftAmt: { value: 0.1 },

        // Laser uniforms
        uLaserIntensity: { value: 1.5 },
        uLaserScatter: { value: 0.3 },
        uLaserFlicker: { value: 0.0 },

        // Pipe uniforms
        uPipeDepth: { value: 0.5 },
        uPipeEdgeLight: { value: 1.0 },
        uPipeEdgeLightColor: { value: new THREE.Vector4(1, 1, 1, 1) },
        uPipeSpecular: { value: 0.5 },
        uPipeRoughness: { value: 0.5 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    // Create fullscreen quad
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.translate(0.5, 0.5, 0);
    this.quad = new THREE.Mesh(geometry, this.material);
    this.scene.add(this.quad);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.renderTarget.setSize(width, height);
    this.material.uniforms.uResolution.value.set(width, height);
  }

  private createDefaultMeshPoints(rows: number, cols: number): THREE.Vector2[] {
    const points: THREE.Vector2[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        points.push(new THREE.Vector2(c / (cols - 1), r / (rows - 1)));
      }
    }
    while (points.length < 16) {
      points.push(new THREE.Vector2(0, 0));
    }
    return points;
  }

  private createDefaultCustomVertices(): THREE.Vector2[] {
    const verts: THREE.Vector2[] = [];
    for (let i = 0; i < 64; i++) {
      verts.push(new THREE.Vector2(0, 0));
    }
    return verts;
  }

  private getStrokeTypeIndex(type: string): number {
    const types: Record<string, number> = {
      solid: 1,
      glow: 2,
      neon: 3,
      snake: 4,
      rainbow: 5,
      dashed: 6,
      dotted: 7,
      electric: 8,
      scanner: 9,
      fire: 10,
      pulse: 11,
      multiTail: 12,
      laser: 13,
      pipe: 14,
    };
    return types[type] ?? 2;
  }

  /**
   * Compute time-based draw progress for an element, handling stagger modes and loop types.
   * Returns { progress, visible } — when visible is false, element should be skipped entirely.
   */
  private computeAnimatedDrawProgress(
    element: LineElement,
    elementIndex: number,
    totalElements: number,
    globalDrawSpeed: number,
    staggerMode: string,
    staggerDelay: number,
    waveWindowSize: number = 3
  ): { progress: number; visible: boolean } {
    const anim = element.drawAnimation;
    if (!anim.enabled) return { progress: 1.0, visible: true };

    const now = performance.now();

    // Ensure layer-level base time is set
    if (this.layerAnimationBaseTime === 0) {
      this.layerAnimationBaseTime = now;
    }

    // Per-element cycle duration (time for one full draw animation)
    const cycleDuration = 1000 / (anim.drawSpeed * globalDrawSpeed);
    const elapsed = now - this.layerAnimationBaseTime;

    // === VISIBILITY GATING for sequential-family modes ===
    if (totalElements > 0 && (staggerMode === 'sequential' || staggerMode === 'solo' || staggerMode === 'random' || staggerMode === 'wave')) {
      if (staggerMode === 'sequential') {
        // One line at a time, round-robin
        const totalCycleDuration = cycleDuration + staggerDelay;
        const activeIndex = Math.floor(elapsed / totalCycleDuration) % totalElements;
        if (elementIndex !== activeIndex) {
          return { progress: 0, visible: false };
        }
        // Compute progress within this element's active window
        const windowElapsed = elapsed % totalCycleDuration;
        const rawProgress = windowElapsed / cycleDuration;
        let progress = this.applyLoopAndEasing(Math.min(rawProgress, 1.0), anim);
        if (anim.reverse) progress = 1.0 - progress;
        return { progress: Math.max(0, Math.min(1, progress)), visible: true };

      } else if (staggerMode === 'solo') {
        // Like sequential but each line draws on then draws off within its window
        const totalCycleDuration = (cycleDuration * 2) + staggerDelay; // draw on + draw off + pause
        const activeIndex = Math.floor(elapsed / totalCycleDuration) % totalElements;
        if (elementIndex !== activeIndex) {
          return { progress: 0, visible: false };
        }
        const windowElapsed = elapsed % totalCycleDuration;
        const halfCycle = cycleDuration;
        let progress: number;
        if (windowElapsed < halfCycle) {
          // Drawing on
          progress = windowElapsed / halfCycle;
        } else if (windowElapsed < halfCycle * 2) {
          // Drawing off
          progress = 1.0 - ((windowElapsed - halfCycle) / halfCycle);
        } else {
          progress = 0;
        }
        progress = applyEasing(Math.max(0, Math.min(1, progress)), anim.easing);
        if (anim.reverse) progress = 1.0 - progress;
        return { progress: Math.max(0, Math.min(1, progress)), visible: progress > 0.001 };

      } else if (staggerMode === 'random') {
        // Deterministic pseudo-random order per cycle
        const totalCycleDuration = cycleDuration + staggerDelay;
        const cycleNumber = Math.floor(elapsed / totalCycleDuration);
        // Build a deterministic shuffled order for this cycle
        const activeIndex = this.getRandomActiveIndex(cycleNumber, totalElements);
        if (elementIndex !== activeIndex) {
          return { progress: 0, visible: false };
        }
        const windowElapsed = elapsed % totalCycleDuration;
        const rawProgress = windowElapsed / cycleDuration;
        let progress = this.applyLoopAndEasing(Math.min(rawProgress, 1.0), anim);
        if (anim.reverse) progress = 1.0 - progress;
        return { progress: Math.max(0, Math.min(1, progress)), visible: true };

      } else if (staggerMode === 'wave') {
        // Sliding window of N lines visible at once
        const windowSize = Math.max(1, Math.min(waveWindowSize, totalElements));
        const stepDuration = staggerDelay > 0 ? staggerDelay : 500;
        const headIndex = Math.floor(elapsed / stepDuration) % totalElements;
        // Check if elementIndex is within the window [headIndex - windowSize + 1 .. headIndex]
        let inWindow = false;
        for (let w = 0; w < windowSize; w++) {
          const idx = ((headIndex - w) % totalElements + totalElements) % totalElements;
          if (idx === elementIndex) {
            inWindow = true;
            break;
          }
        }
        if (!inWindow) {
          return { progress: 0, visible: false };
        }
        // Elements in window get full animation
        const windowElapsed = elapsed % (stepDuration * totalElements);
        const rawProgress = windowElapsed / cycleDuration;
        let progress = this.applyLoopAndEasing(rawProgress, anim);
        if (anim.reverse) progress = 1.0 - progress;
        return { progress: Math.max(0, Math.min(1, progress)), visible: true };
      }
    }

    // === CASCADE and SIMULTANEOUS modes (all elements stay visible) ===
    if (!this.animationStartTimes.has(element.id)) {
      this.animationStartTimes.set(element.id, now);
    }
    const elementStartTime = this.animationStartTimes.get(element.id)!;

    let staggerOffset = 0;
    if (staggerMode === 'cascade') {
      staggerOffset = elementIndex * staggerDelay;
    }

    const elapsedForElement = now - elementStartTime - staggerOffset;
    if (elapsedForElement < 0) {
      return { progress: anim.reverse ? 1.0 : 0.0, visible: true };
    }

    const rawProgress = elapsedForElement / cycleDuration;
    let progress = this.applyLoopAndEasing(rawProgress, anim);
    if (anim.reverse) progress = 1.0 - progress;

    return { progress: Math.max(0, Math.min(1, progress)), visible: true };
  }

  /**
   * Apply loop mode and easing to raw progress.
   */
  private applyLoopAndEasing(rawProgress: number, anim: LineDrawAnimation): number {
    let progress: number;
    switch (anim.loopMode) {
      case 'once':
        progress = Math.min(rawProgress, 1.0);
        break;
      case 'loop':
        progress = rawProgress % 1.0;
        break;
      case 'pingpong': {
        const cycle = rawProgress % 2.0;
        progress = cycle <= 1.0 ? cycle : 2.0 - cycle;
        break;
      }
      case 'continuous':
        progress = rawProgress % 1.0;
        break;
      default:
        progress = Math.min(rawProgress, 1.0);
    }
    return applyEasing(progress, anim.easing);
  }

  /**
   * Get a deterministic pseudo-random active index for a given cycle.
   * Uses a hash to create a seemingly random order that's repeatable.
   */
  private getRandomActiveIndex(cycleNumber: number, totalElements: number): number {
    // Knuth multiplicative hash for good distribution
    const hash = ((cycleNumber * 2654435761) >>> 0) % totalElements;
    return hash;
  }

  /**
   * Reset animation start times (for "Reset Animations" button).
   */
  resetAnimationTimes(): void {
    this.animationStartTimes.clear();
    this.layerAnimationBaseTime = 0;
  }

  /**
   * Set all per-element uniforms. Returns false if element should be skipped (not visible in current stagger window).
   */
  private setElementUniforms(
    element: LineElement,
    elementIndex: number,
    totalElements: number,
    globalDrawSpeed: number,
    staggerMode: string,
    staggerDelay: number,
    waveWindowSize: number = 3
  ): boolean {
    const u = this.material.uniforms;
    const time = performance.now() / 1000 - this.startTime;
    u.uTime.value = time;

    // Element transform
    u.uPosition.value.set(element.position.x, element.position.y);
    u.uRotation.value = (element.rotation * Math.PI) / 180;
    u.uScale.value.set(element.scale.x, element.scale.y);

    // Per-element corner warp
    if (element.warpEnabled && element.warpCorners) {
      u.uWarpEnabled.value = true;
      u.uWarpTL.value.set(element.warpCorners.topLeft.x, element.warpCorners.topLeft.y);
      u.uWarpTR.value.set(element.warpCorners.topRight.x, element.warpCorners.topRight.y);
      u.uWarpBL.value.set(element.warpCorners.bottomLeft.x, element.warpCorners.bottomLeft.y);
      u.uWarpBR.value.set(element.warpCorners.bottomRight.x, element.warpCorners.bottomRight.y);
    } else {
      u.uWarpEnabled.value = false;
    }

    // Per-element mesh warp
    if (element.meshWarpEnabled && element.meshWarp) {
      u.uMeshWarpEnabled.value = true;
      u.uMeshRows.value = element.meshWarp.rows;
      u.uMeshCols.value = element.meshWarp.cols;
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

    // Upload polyline points as custom vertices
    const points = element.shape.points;
    if (points.length >= 2) {
      u.uCustomVertexCount.value = Math.min(points.length, 64);
      u.uCustomVerticesClosed.value =
        element.shape.type === 'pointClick' ? element.shape.closed : false;

      const customVerts = u.uCustomVertices.value as THREE.Vector2[];
      for (let i = 0; i < 64; i++) {
        if (i < points.length) {
          customVerts[i].set(points[i].x, points[i].y);
        } else {
          customVerts[i].set(0, 0);
        }
      }
    } else {
      u.uCustomVertexCount.value = 0;
    }

    // Stroke uniforms
    const stroke = element.stroke;
    u.uStrokeType.value = this.getStrokeTypeIndex(stroke.type);

    // Color and width (all line strokes have these)
    if ('color' in stroke) {
      const c = stroke.color;
      u.uStrokeColor.value.set(c[0], c[1], c[2], c[3]);
    }
    if ('width' in stroke) {
      u.uStrokeWidth.value = stroke.width;
    }

    // Glow-family
    if ('glowSize' in stroke) {
      u.uGlowSize.value = (stroke as any).glowSize;
    }
    if ('glowIntensity' in stroke) {
      u.uGlowIntensity.value = (stroke as any).glowIntensity;
    }
    if ('pulseSpeed' in stroke) {
      u.uPulseSpeed.value = (stroke as any).pulseSpeed;
    }
    if ('flickerSpeed' in stroke) {
      u.uPulseSpeed.value = (stroke as any).flickerSpeed;
    }

    // Snake / animated path
    if ('length' in stroke) {
      u.uSnakeLength.value = (stroke as any).length;
    }
    if ('speed' in stroke) {
      u.uSnakeSpeed.value = (stroke as any).speed;
    }
    if ('snakeCount' in stroke) {
      u.uSnakeCount.value = (stroke as any).snakeCount;
    } else {
      u.uSnakeCount.value = 1;
    }

    // Dashed / dotted
    if ('dashLength' in stroke) {
      u.uDashLength.value = (stroke as any).dashLength;
    }
    if ('gapLength' in stroke) {
      u.uGapLength.value = (stroke as any).gapLength;
    }
    if ('dotSize' in stroke) {
      u.uDashLength.value = (stroke as any).dotSize; // reuse uniform
    }
    if ('spacing' in stroke && stroke.type === 'dotted') {
      u.uGapLength.value = (stroke as any).spacing; // reuse uniform
    }

    // Electric
    if ('arcIntensity' in stroke) {
      u.uElectricArc.value = (stroke as any).arcIntensity;
    }
    if ('branches' in stroke) {
      u.uElectricBranches.value = (stroke as any).branches;
    }

    // Scanner
    if ('beamWidth' in stroke) {
      u.uScannerBeamWidth.value = (stroke as any).beamWidth;
    }
    if ('trail' in stroke) {
      u.uScannerTrail.value = (stroke as any).trail;
    }

    // Pulse stroke
    if ('pulseCount' in stroke) {
      u.uSnakeLength.value = (stroke as any).pulseCount; // reuse for count
    }
    if ('fadeLength' in stroke) {
      u.uScannerTrail.value = (stroke as any).fadeLength; // reuse for fade
    }

    // MultiTail
    if (stroke.type === 'multiTail') {
      u.uMultiTailCount.value = (stroke as any).tailCount;
      u.uMultiTailLength.value = (stroke as any).tailLength;
      u.uMultiTailSpacing.value = (stroke as any).spacing;
      u.uMultiTailSpeed.value = (stroke as any).speed;
      u.uMultiTailFade.value = (stroke as any).tailFade;
      u.uMultiTailHeadGlow.value = (stroke as any).headGlow;
      u.uMultiTailColorShift.value = (stroke as any).colorShift;
      u.uMultiTailColorShiftAmt.value = (stroke as any).colorShiftAmount;
    }

    // Laser
    if (stroke.type === 'laser') {
      u.uLaserIntensity.value = (stroke as any).intensity;
      u.uLaserScatter.value = (stroke as any).scatter;
      u.uLaserFlicker.value = (stroke as any).flicker;
    }

    // Pipe
    if (stroke.type === 'pipe') {
      u.uPipeDepth.value = (stroke as any).depth;
      u.uPipeEdgeLight.value = (stroke as any).edgeLight;
      const elc = (stroke as any).edgeLightColor;
      u.uPipeEdgeLightColor.value.set(elc[0], elc[1], elc[2], elc[3]);
      u.uPipeSpecular.value = (stroke as any).specular;
      u.uPipeRoughness.value = (stroke as any).roughness;
    }

    // Draw animation — compute time-based progress and visibility
    const drawAnim = element.drawAnimation;
    if (drawAnim.enabled) {
      const result = this.computeAnimatedDrawProgress(
        element, elementIndex, totalElements,
        globalDrawSpeed, staggerMode, staggerDelay, waveWindowSize
      );
      if (!result.visible) return false; // Skip this element
      u.uDrawProgress.value = result.progress;
      u.uTrailLength.value = drawAnim.trailLength;
    } else {
      u.uDrawProgress.value = 1.0;
      u.uTrailLength.value = 0.0;
    }
    return true;
  }

  /**
   * Render a list of LineElements directly to an external render target.
   * All elements are composited together with additive blending.
   */
  renderElements(
    elements: LineElement[],
    target: THREE.WebGLRenderTarget,
    globalDrawSpeed: number = 1.0,
    staggerMode: string = 'simultaneous',
    staggerDelay: number = 200,
    sharedShaderTexture: THREE.Texture | null = null,
    waveWindowSize: number = 3
  ): THREE.Texture {
    // Set shared shader mask mode
    this.material.uniforms.uUseSharedShader.value = !!sharedShaderTexture;
    if (sharedShaderTexture) {
      this.material.uniforms.uSharedShaderTexture.value = sharedShaderTexture;
    }

    // Clear the target ONCE at the start
    this.renderer.setRenderTarget(target);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();

    // Disable autoClear so subsequent renders don't wipe previous lines
    const prevAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;

    // Update resolution uniform if target size differs
    const currentRes = this.material.uniforms.uResolution.value;
    if (currentRes.x !== target.width || currentRes.y !== target.height) {
      this.material.uniforms.uResolution.value.set(target.width, target.height);
    }

    // Sort elements by zIndex for proper layering
    const sortedElements = [...elements].sort((a, b) => a.zIndex - b.zIndex);

    // Render each visible element WITHOUT clearing between them
    for (let i = 0; i < sortedElements.length; i++) {
      const element = sortedElements[i];
      if (!element.visible) continue;
      if (element.shape.points.length < 2) continue;

      const shouldRender = this.setElementUniforms(
        element, i, sortedElements.length,
        globalDrawSpeed, staggerMode, staggerDelay, waveWindowSize
      );
      if (!shouldRender) continue;
      this.renderer.render(this.scene, this.camera);
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
