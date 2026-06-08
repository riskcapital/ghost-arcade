/*{
  "CREDIT": "by Justin Robie Wood",
  "CATEGORIES": [
    "generator"
  ],
  "DESCRIPTION": "Quantum Grids - Generative Line Art",
  "INPUTS": [
    {
      "NAME": "visualType",
      "TYPE": "float",
      "DEFAULT": 0,
      "MIN": 0,
      "MAX": 6
    },
    {
      "NAME": "scrollSpeed",
      "TYPE": "float",
      "DEFAULT": 14.0,
      "MIN": 1.0,
      "MAX": 30.0
    },
    {
      "NAME": "colorShift",
      "TYPE": "float",
      "DEFAULT": 0.005,
      "MIN": 0.0,
      "MAX": 0.02
    },
    {
      "NAME": "timeScale",
      "TYPE": "float",
      "DEFAULT": 1.0,
      "MIN": 0.1,
      "MAX": 3.0
    },
    {
      "NAME": "depth",
      "TYPE": "float",
      "DEFAULT": 30.0,
      "MIN": 10.0,
      "MAX": 60.0
    },
    {
      "NAME": "spacing",
      "TYPE": "float",
      "DEFAULT": 0.065,
      "MIN": 0.02,
      "MAX": 0.15
    },
    {
      "NAME": "lineCount",
      "TYPE": "float",
      "DEFAULT": 40.0,
      "MIN": 10.0,
      "MAX": 100.0
    },
    {
      "NAME": "circleDensity",
      "TYPE": "float",
      "DEFAULT": 25.0,
      "MIN": 10.0,
      "MAX": 60.0
    },
    {
      "NAME": "lineWeight",
      "TYPE": "float",
      "DEFAULT": 0.002,
      "MIN": 0.0005,
      "MAX": 0.01
    },
    {
      "NAME": "glowIntensity",
      "TYPE": "float",
      "DEFAULT": 0.7,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "baseHue",
      "TYPE": "float",
      "DEFAULT": 0.5,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "colorCount",
      "TYPE": "float",
      "DEFAULT": 3.0,
      "MIN": 1.0,
      "MAX": 6.0
    },
    {
      "NAME": "paletteType",
      "TYPE": "float",
      "DEFAULT": 1,
      "MIN": 0,
      "MAX": 6
    },
    {
      "NAME": "bgGradient",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "bgHue",
      "TYPE": "float",
      "DEFAULT": 0.5,
      "MIN": 0.0,
      "MAX": 1.0
    }
  ]
}*/

// ============================================================================
// Quantum Grids - Generative Line Art
// By Justin Robie Wood
// ============================================================================

// HSV to RGB conversion
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// Get color from palette
vec3 getColor(int index, float time) {
    float hue = baseHue;
    int numColors = int(colorCount);
    float colorIndex = float(index - (index / numColors) * numColors);
    int palType = int(paletteType);

    if (palType == 0) {
        hue = baseHue;
    } else if (palType == 1) {
        hue = baseHue + (colorIndex * 0.0833);
    } else if (palType == 2) {
        hue = baseHue + (colorIndex * 0.5);
    } else if (palType == 3) {
        hue = baseHue + (colorIndex * 0.333);
    } else if (palType == 4) {
        hue = colorIndex / float(numColors);
    } else if (palType == 5) {
        hue = mod(0.917 + colorIndex * 0.0833, 1.0);
    } else if (palType == 6) {
        hue = 0.5 + colorIndex * 0.0556;
    }

    hue = mod(hue + time * colorShift * (colorIndex + 1.0) * 0.3, 1.0);
    return hsv2rgb(vec3(hue, 0.9, 0.95));
}

// Distance to line segment
float distanceToLine(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

// Draw glowing line
vec4 drawGlowLine(vec2 uv, vec2 p1, vec2 p2, vec3 color, float alpha, float thickness) {
    float dist = distanceToLine(uv, p1, p2);
    float glow = exp(-dist * 100.0 / thickness) * alpha * 0.3 * glowIntensity;
    float line = smoothstep(thickness, 0.0, dist) * alpha;
    float totalAlpha = max(glow, line);
    return vec4(color * totalAlpha, totalAlpha);
}

// ============================================================================
// VISUAL TYPES
// ============================================================================

vec4 drawTronFloor(vec2 uv, float time) {
    vec4 finalColor = vec4(0.0);
    vec2 center = vec2(0.5, 0.35);
    float scrollDist = time * scrollSpeed * 0.01;
    float firstLine = floor(scrollDist / spacing);

    for (float i = 0.0; i <= 64.0; i += 1.0) {
        if (i > depth + 2.0) break;
        float lineIndex = firstLine + i;
        float linePos = lineIndex * spacing - scrollDist;
        float t = linePos / (depth * spacing);
        if (t < 0.0 || t > 1.0) continue;

        float y = mix(1.0, center.y, pow(t, 1.8));
        float lineWidth = mix(1.0, 0.0, pow(t, 2.0));
        vec2 p1 = vec2(center.x - lineWidth * 0.5, y);
        vec2 p2 = vec2(center.x + lineWidth * 0.5, y);

        vec3 color = getColor(int(lineIndex), time);
        float alpha = mix(0.7, 0.05, pow(t, 1.2));
        finalColor += drawGlowLine(uv, p1, p2, color, alpha, lineWeight);
    }

    for (float i = 0.0; i <= 102.0; i += 1.0) {
        if (i > lineCount) break;
        float t = i / lineCount;
        vec2 p1 = vec2(t, 1.0);
        vec2 p2 = center;
        vec3 color = getColor(int(i / 5.0), time);
        float alpha = 0.5 - abs(t - 0.5) * 0.4;
        finalColor += drawGlowLine(uv, p1, p2, color, alpha, lineWeight * 0.8);
    }

    return finalColor;
}

vec4 drawTronFloorCeiling(vec2 uv, float time) {
    vec4 finalColor = vec4(0.0);
    vec2 floorCenter = vec2(0.5, 0.65);
    vec2 ceilingCenter = vec2(0.5, 0.35);
    float scrollDist = time * scrollSpeed * 0.01;
    float firstLine = floor(scrollDist / spacing);

    for (float i = 0.0; i <= 64.0; i += 1.0) {
        if (i > depth + 2.0) break;
        float lineIndex = firstLine + i;
        float linePos = lineIndex * spacing - scrollDist;
        float t = linePos / (depth * spacing);
        if (t < 0.0 || t > 1.0) continue;

        float lineWidth = mix(1.0, 0.0, pow(t, 2.0));
        vec3 color = getColor(int(lineIndex), time);
        float alpha = mix(0.7, 0.05, pow(t, 1.2));

        float yFloor = mix(1.0, floorCenter.y, pow(t, 1.8));
        finalColor += drawGlowLine(uv, vec2(0.5 - lineWidth * 0.5, yFloor), vec2(0.5 + lineWidth * 0.5, yFloor), color, alpha, lineWeight);

        float yCeiling = mix(0.0, ceilingCenter.y, pow(t, 1.8));
        finalColor += drawGlowLine(uv, vec2(0.5 - lineWidth * 0.5, yCeiling), vec2(0.5 + lineWidth * 0.5, yCeiling), color, alpha, lineWeight);
    }

    for (float i = 0.0; i <= 102.0; i += 1.0) {
        if (i > lineCount) break;
        float t = i / lineCount;
        vec3 color = getColor(int(i / 5.0), time);
        float alpha = 0.5 - abs(t - 0.5) * 0.4;
        finalColor += drawGlowLine(uv, vec2(t, 1.0), floorCenter, color, alpha, lineWeight * 0.8);
        finalColor += drawGlowLine(uv, vec2(t, 0.0), ceilingCenter, color, alpha, lineWeight * 0.8);
    }

    return finalColor;
}

vec4 drawTronFullTunnel(vec2 uv, float time) {
    vec4 finalColor = vec4(0.0);
    vec2 center = vec2(0.5, 0.5);
    float scrollDist = time * scrollSpeed * 0.01;
    float firstLine = floor(scrollDist / spacing);

    for (float i = 0.0; i <= 64.0; i += 1.0) {
        if (i > depth + 2.0) break;
        float lineIndex = firstLine + i;
        float linePos = lineIndex * spacing - scrollDist;
        float t = linePos / (depth * spacing);
        if (t < 0.0 || t > 1.0) continue;

        float depthFactor = pow(t, 1.8);
        float lineWidth = mix(1.0, 0.0, pow(t, 2.0));
        float lineHeight = mix(1.0, 0.0, pow(t, 2.0));

        vec3 color = getColor(int(lineIndex), time);
        float alpha = mix(0.7, 0.05, pow(t, 1.2));

        float yBottom = mix(1.0, center.y, depthFactor);
        float yTop = mix(0.0, center.y, depthFactor);
        float xLeft = mix(0.0, center.x, depthFactor);
        float xRight = mix(1.0, center.x, depthFactor);

        finalColor += drawGlowLine(uv, vec2(center.x - lineWidth * 0.5, yBottom), vec2(center.x + lineWidth * 0.5, yBottom), color, alpha, lineWeight);
        finalColor += drawGlowLine(uv, vec2(center.x - lineWidth * 0.5, yTop), vec2(center.x + lineWidth * 0.5, yTop), color, alpha, lineWeight);
        finalColor += drawGlowLine(uv, vec2(xLeft, center.y - lineHeight * 0.5), vec2(xLeft, center.y + lineHeight * 0.5), color, alpha, lineWeight);
        finalColor += drawGlowLine(uv, vec2(xRight, center.y - lineHeight * 0.5), vec2(xRight, center.y + lineHeight * 0.5), color, alpha, lineWeight);
    }

    float numCornerLines = lineCount * 0.5;
    for (float i = 0.0; i <= 52.0; i += 1.0) {
        if (i > numCornerLines) break;
        float t = i / numCornerLines;
        vec3 color = getColor(int(i / 5.0), time);
        float alpha = 0.4 - abs(t - 0.5) * 0.3;
        finalColor += drawGlowLine(uv, vec2(t, 1.0), center, color, alpha, lineWeight * 0.6);
        finalColor += drawGlowLine(uv, vec2(t, 0.0), center, color, alpha, lineWeight * 0.6);
        finalColor += drawGlowLine(uv, vec2(0.0, t), center, color, alpha, lineWeight * 0.6);
        finalColor += drawGlowLine(uv, vec2(1.0, t), center, color, alpha, lineWeight * 0.6);
    }

    return finalColor;
}

vec4 drawConcentricSquaresStatic(vec2 uv, float time) {
    vec4 finalColor = vec4(0.0);
    vec2 center = vec2(0.5);
    float maxDim = 1.5;
    float ns = 30.0;
    float spacingVal = maxDim / ns;
    float scrollDist = time * 6.0;
    float firstSquare = floor(scrollDist / spacingVal);

    for (float i = 0.0; i <= 34.0; i += 1.0) {
        if (i > ns + 2.0) break;
        float squareIndex = firstSquare + i;
        float squarePos = squareIndex * spacingVal - scrollDist;
        float t = squarePos / maxDim;
        if (t < 0.0 || t > 1.0 || squarePos <= 0.0) continue;

        float size = squarePos;
        vec3 color = getColor(int(squareIndex), time);
        float alpha = mix(0.7, 0.05, t);
        float halfSize = size * 0.5;

        finalColor += drawGlowLine(uv, center + vec2(-halfSize, -halfSize), center + vec2(halfSize, -halfSize), color, alpha, lineWeight);
        finalColor += drawGlowLine(uv, center + vec2(halfSize, -halfSize), center + vec2(halfSize, halfSize), color, alpha, lineWeight);
        finalColor += drawGlowLine(uv, center + vec2(halfSize, halfSize), center + vec2(-halfSize, halfSize), color, alpha, lineWeight);
        finalColor += drawGlowLine(uv, center + vec2(-halfSize, halfSize), center + vec2(-halfSize, -halfSize), color, alpha, lineWeight);
    }

    return finalColor;
}

vec4 drawConcentricSquaresRotating(vec2 uv, float time) {
    vec4 finalColor = vec4(0.0);
    vec2 center = vec2(0.5);
    float maxDim = 1.5;
    float ns = 15.0;
    float spacingVal = maxDim / ns;
    float scrollDist = time * 2.0;
    float firstSquare = floor(scrollDist / spacingVal);

    for (float i = 0.0; i <= 19.0; i += 1.0) {
        if (i > ns + 2.0) break;
        float squareIndex = firstSquare + i;
        float squarePos = squareIndex * spacingVal - scrollDist;
        float t = squarePos / maxDim;
        if (t < 0.0 || t > 1.0 || squarePos <= 0.0) continue;

        float size = squarePos;
        float rot = time * 0.03 + squareIndex * 0.1;
        vec3 color = getColor(int(squareIndex), time);
        float alpha = mix(0.7, 0.05, t);

        mat2 rotation = mat2(cos(rot), -sin(rot), sin(rot), cos(rot));
        float halfSize = size * 0.5;

        // Compute corners on demand instead of using array
        vec2 c0 = center + rotation * vec2(-halfSize, -halfSize);
        vec2 c1 = center + rotation * vec2(halfSize, -halfSize);
        vec2 c2 = center + rotation * vec2(halfSize, halfSize);
        vec2 c3 = center + rotation * vec2(-halfSize, halfSize);

        finalColor += drawGlowLine(uv, c0, c1, color, alpha, lineWeight);
        finalColor += drawGlowLine(uv, c1, c2, color, alpha, lineWeight);
        finalColor += drawGlowLine(uv, c2, c3, color, alpha, lineWeight);
        finalColor += drawGlowLine(uv, c3, c0, color, alpha, lineWeight);
    }

    return finalColor;
}

vec4 drawConcentricCirclesStatic(vec2 uv, float time) {
    vec4 finalColor = vec4(0.0);
    vec2 center = vec2(0.5);
    float maxRadius = 2.0;
    float ns = circleDensity;
    float spacingVal = maxRadius / ns;
    float scrollDist = time * 8.0;
    float firstCircle = floor(scrollDist / spacingVal);

    for (float i = 0.0; i <= 68.0; i += 1.0) {
        if (i > ns + 5.0) break;
        float circleIndex = firstCircle + i;
        float circlePos = circleIndex * spacingVal - scrollDist;
        float t = circlePos / maxRadius;
        if (t < 0.0 || t > 1.0 || circlePos <= 0.0) continue;

        float radius = circlePos;
        vec2 toCenter = uv - center;
        float dist = length(toCenter);
        float circleDist = abs(dist - radius);

        vec3 color = getColor(int(circleIndex), time);
        float alpha = mix(0.8, 0.05, t);

        float glow = exp(-circleDist * 100.0 / lineWeight) * alpha * 0.3 * glowIntensity;
        float line = smoothstep(lineWeight, 0.0, circleDist) * alpha;
        float totalAlpha = max(glow, line);
        finalColor += vec4(color * totalAlpha, totalAlpha);
    }

    return finalColor;
}

vec4 drawConcentricCirclesRotating(vec2 uv, float time) {
    vec4 finalColor = vec4(0.0);
    vec2 center = vec2(0.5);
    float maxRadius = 2.0;
    float ns = circleDensity;
    float spacingVal = maxRadius / ns;
    float scrollDist = time * 5.0;
    float firstCircle = floor(scrollDist / spacingVal);

    for (float i = 0.0; i <= 68.0; i += 1.0) {
        if (i > ns + 5.0) break;
        float circleIndex = firstCircle + i;
        float circlePos = circleIndex * spacingVal - scrollDist;
        float t = circlePos / maxRadius;
        if (t < 0.0 || t > 1.0 || circlePos <= 0.0) continue;

        float radius = circlePos;
        float rot = time * 0.02 + circleIndex * 0.15;

        mat2 rotation = mat2(cos(rot), -sin(rot), sin(rot), cos(rot));
        vec2 rotatedUV = rotation * (uv - center) + center;

        vec2 toCenter = rotatedUV - center;
        float dist = length(toCenter);
        float circleDist = abs(dist - radius);

        vec3 color = getColor(int(circleIndex), time);
        float alpha = mix(0.8, 0.05, t);

        float glow = exp(-circleDist * 100.0 / lineWeight) * alpha * 0.3 * glowIntensity;
        float line = smoothstep(lineWeight, 0.0, circleDist) * alpha;
        float totalAlpha = max(glow, line);
        finalColor += vec4(color * totalAlpha, totalAlpha);
    }

    return finalColor;
}

// ============================================================================
// MAIN
// ============================================================================

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float time = TIME * timeScale;

    // Background
    vec3 bgColor = vec3(0.0);
    if (bgGradient > 0.0) {
        float sat = 0.3 + sin(time * 0.0003) * 0.1;
        float bri = 0.05 + sin(time * 0.0005) * 0.03;
        bgColor = hsv2rgb(vec3(bgHue, sat, bri)) * bgGradient;
    }

    vec4 artColor = vec4(0.0);
    int vType = int(visualType);

    if (vType == 0) {
        artColor = drawTronFloor(uv, time);
    } else if (vType == 1) {
        artColor = drawTronFloorCeiling(uv, time);
    } else if (vType == 2) {
        artColor = drawTronFullTunnel(uv, time);
    } else if (vType == 3) {
        artColor = drawConcentricSquaresStatic(uv, time);
    } else if (vType == 4) {
        artColor = drawConcentricSquaresRotating(uv, time);
    } else if (vType == 5) {
        artColor = drawConcentricCirclesStatic(uv, time);
    } else if (vType == 6) {
        artColor = drawConcentricCirclesRotating(uv, time);
    }

    vec3 finalColor = bgColor * (1.0 - artColor.a) + artColor.rgb;
    gl_FragColor = vec4(finalColor, 1.0);
}
