/*{
  "CREDIT": "by Justin Robie Wood",
  "CATEGORIES": [
    "generator"
  ],
  "DESCRIPTION": "Fractal Tunnel Cosmos - Geometric Fractals Through Infinite Tunnels",
  "INPUTS": [
    {
      "NAME": "tunnelMode",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 7.0
    },
    {
      "NAME": "fractalType",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 6.0
    },
    {
      "NAME": "tunnelSpeed",
      "TYPE": "float",
      "DEFAULT": 0.5,
      "MIN": -2.0,
      "MAX": 3.0
    },
    {
      "NAME": "tunnelDepth",
      "TYPE": "float",
      "DEFAULT": 3.0,
      "MIN": 1.0,
      "MAX": 10.0
    },
    {
      "NAME": "tunnelTwist",
      "TYPE": "float",
      "DEFAULT": 0.5,
      "MIN": 0.0,
      "MAX": 3.0
    },
    {
      "NAME": "fractalScale",
      "TYPE": "float",
      "DEFAULT": 3.0,
      "MIN": 0.5,
      "MAX": 10.0
    },
    {
      "NAME": "fractalDetail",
      "TYPE": "float",
      "DEFAULT": 5.0,
      "MIN": 1.0,
      "MAX": 10.0
    },
    {
      "NAME": "geometryAmount",
      "TYPE": "float",
      "DEFAULT": 0.7,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "cloudAmount",
      "TYPE": "float",
      "DEFAULT": 0.5,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "cloudFlow",
      "TYPE": "float",
      "DEFAULT": 0.3,
      "MIN": 0.0,
      "MAX": 2.0
    },
    {
      "NAME": "atomCount",
      "TYPE": "float",
      "DEFAULT": 20.0,
      "MIN": 0.0,
      "MAX": 50.0
    },
    {
      "NAME": "atomSize",
      "TYPE": "float",
      "DEFAULT": 0.015,
      "MIN": 0.005,
      "MAX": 0.05
    },
    {
      "NAME": "orbitSpeed",
      "TYPE": "float",
      "DEFAULT": 0.5,
      "MIN": 0.0,
      "MAX": 3.0
    },
    {
      "NAME": "nucleusGlow",
      "TYPE": "float",
      "DEFAULT": 1.0,
      "MIN": 0.0,
      "MAX": 3.0
    },
    {
      "NAME": "starField",
      "TYPE": "float",
      "DEFAULT": 0.5,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "nodeNetwork",
      "TYPE": "float",
      "DEFAULT": 0.3,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "colorPalette",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 9.0
    },
    {
      "NAME": "colorShift",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "brightness",
      "TYPE": "float",
      "DEFAULT": 1.3,
      "MIN": 0.3,
      "MAX": 2.5
    },
    {
      "NAME": "contrast",
      "TYPE": "float",
      "DEFAULT": 1.4,
      "MIN": 0.5,
      "MAX": 2.5
    }
  ]
}*/

// ============================================================================
// Fractal Tunnel Cosmos - Infinite Geometric Fractal Journeys
// By Justin Robie Wood
// ============================================================================

#define PI 3.14159265359

// Hash functions
float hash(float n) {
    return fract(sin(n) * 43758.5453123);
}

float hash2(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec2 hash22(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453123);
}

vec3 hash3(float n) {
    return fract(sin(vec3(n, n + 1.0, n + 2.0)) * vec3(43758.5453123, 22578.1459123, 19642.3490423));
}

// 2D rotation
vec2 rotate(vec2 p, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

// Noise
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash2(i);
    float b = hash2(i + vec2(1.0, 0.0));
    float c = hash2(i + vec2(0.0, 1.0));
    float d = hash2(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// FBM
float fbm(vec2 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for (int i = 0; i < 10; i++) {
        if (i >= octaves) break;
        value += amplitude * noise(p * frequency);
        frequency *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}

// Fractal patterns
float getFractal(vec2 p, int type, float scale, int detail) {
    p *= scale;
    float value = 0.0;

    if (type == 0) {
        // Mandelbrot-inspired
        vec2 c = p * 0.5;
        vec2 z = vec2(0.0);
        for (int i = 0; i < 10; i++) {
            if (i >= detail) break;
            z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
            if (length(z) > 2.0) {
                value = float(i) / float(detail);
                break;
            }
        }
        if (value == 0.0) value = 1.0;

    } else if (type == 1) {
        // Sierpinski triangle
        vec2 uv = fract(p);
        for (int i = 0; i < 10; i++) {
            if (i >= detail) break;
            uv = abs(uv);
            if (uv.x + uv.y > 1.0) {
                uv = vec2(1.0 - uv.y, 1.0 - uv.x);
            }
            uv = uv * 2.0;
        }
        value = 1.0 - smoothstep(0.0, 0.2, length(fract(uv) - 0.5));

    } else if (type == 2) {
        // Kaleidoscope
        float angle = atan(p.y, p.x);
        float radius = length(p);
        angle = mod(angle, PI / 4.0);
        vec2 kp = vec2(cos(angle), sin(angle)) * radius;
        value = fbm(kp, detail);

    } else if (type == 3) {
        // Voronoi cells
        vec2 cell = floor(p);
        vec2 frac = fract(p);
        float minDist = 10.0;
        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                vec2 neighbor = vec2(float(x), float(y));
                vec2 point = hash22(cell + neighbor);
                float dist = length(neighbor + point - frac);
                minDist = min(minDist, dist);
            }
        }
        value = 1.0 - smoothstep(0.0, 1.0, minDist);

    } else if (type == 4) {
        // Circuit pattern
        vec2 grid = fract(p) - 0.5;
        float pattern = smoothstep(0.35, 0.45, abs(grid.x)) + smoothstep(0.35, 0.45, abs(grid.y));
        value = pattern * fbm(p * 0.5, detail);

    } else if (type == 5) {
        // Hexagonal tiling
        vec2 r = vec2(1.0, 1.732);
        vec2 h = r * 0.5;
        vec2 a = mod(p, r) - h;
        vec2 b = mod(p - h, r) - h;
        float d = min(length(a), length(b));
        value = 1.0 - smoothstep(0.3, 0.5, d);

    } else {
        // DNA helix
        float angle = atan(p.y, p.x);
        float radius = length(p);
        float helix = sin(angle * 6.0 + radius * 8.0);
        value = smoothstep(-0.3, 0.3, helix) * fbm(p * 0.3, detail);
    }

    return clamp(value, 0.0, 1.0);
}

// Tunnel effect
vec2 getTunnelUV(vec2 uv, float time, int mode, float depth, float twist) {
    float dist = length(uv);
    float angle = atan(uv.y, uv.x);

    // Create tunnel perspective
    float z = depth / (dist + 0.3) + time * tunnelSpeed;

    // Apply twist
    angle += z * twist * 0.3;

    // Different tunnel shapes
    vec2 tunnelUV;

    if (mode == 0) {
        // Circular
        tunnelUV = vec2(angle / PI, z);

    } else if (mode == 1) {
        // Square
        vec2 p = vec2(cos(angle), sin(angle)) * dist;
        float maxCoord = max(abs(p.x), abs(p.y));
        tunnelUV = vec2(angle / PI, z / maxCoord);

    } else if (mode == 2) {
        // Triangle
        float triAngle = mod(angle + PI, 2.0 * PI / 3.0);
        tunnelUV = vec2(triAngle, z);

    } else if (mode == 3) {
        // Hexagon
        float hexAngle = mod(angle + PI, 2.0 * PI / 6.0);
        tunnelUV = vec2(hexAngle, z);

    } else if (mode == 4) {
        // Star
        float star = 1.0 + 0.3 * sin(angle * 5.0);
        tunnelUV = vec2(angle / PI, z * star);

    } else if (mode == 5) {
        // Spiral
        tunnelUV = vec2(angle / PI + z * 0.5, z);

    } else if (mode == 6) {
        // Braided
        float braid = sin(angle * 4.0 + z) * 0.3;
        tunnelUV = vec2(angle / PI + braid, z);

    } else {
        // Organic
        float organic = fbm(vec2(angle, z * 0.3), 3) * 0.5;
        tunnelUV = vec2(angle / PI + organic, z);
    }

    return tunnelUV;
}

// Stars
float getStars(vec2 p, float density) {
    vec2 cell = floor(p * 30.0);
    vec2 local = fract(p * 30.0);
    float star = 0.0;

    for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
            vec2 offset = vec2(float(x), float(y));
            vec2 cellId = cell + offset;
            vec2 h = hash22(cellId);

            if (h.x > 1.0 - density) {
                vec2 starPos = offset + h;
                float dist = length(local - starPos);
                star += exp(-dist * dist / 0.0001) * 0.5;
            }
        }
    }

    return star;
}

// Color palette
vec3 getPalette(float t, int palette, float shift) {
    t = fract(t + shift);
    vec3 color;

    if (palette == 0) {
        color = mix(vec3(0.0, 0.3, 0.8), vec3(0.5, 0.0, 1.0), t);
        color = mix(color, vec3(0.0, 1.0, 1.0), smoothstep(0.7, 1.0, t));
    } else if (palette == 1) {
        color = mix(vec3(1.0, 0.0, 0.5), vec3(0.0, 1.0, 1.0), t);
    } else if (palette == 2) {
        color = mix(vec3(1.0, 0.3, 0.0), vec3(1.0, 1.0, 0.0), t);
        color = mix(color, vec3(1.0, 1.0, 1.0), smoothstep(0.8, 1.0, t));
    } else if (palette == 3) {
        color = mix(vec3(0.0, 0.5, 0.0), vec3(0.5, 1.0, 0.0), t);
        color = mix(color, vec3(1.0, 1.0, 0.5), smoothstep(0.6, 1.0, t));
    } else if (palette == 4) {
        float hue = t * 6.28;
        color = vec3(sin(hue) * 0.5 + 0.5, sin(hue + 2.094) * 0.5 + 0.5, sin(hue + 4.189) * 0.5 + 0.5);
    } else if (palette == 5) {
        color = mix(vec3(0.1, 0.0, 0.2), vec3(0.5, 0.0, 0.8), t);
        color = mix(color, vec3(1.0, 0.5, 1.0), smoothstep(0.7, 1.0, t));
    } else if (palette == 6) {
        color = mix(vec3(0.0, 0.2, 0.4), vec3(0.5, 0.8, 1.0), t);
        color = mix(color, vec3(1.0, 1.0, 1.0), smoothstep(0.8, 1.0, t));
    } else if (palette == 7) {
        color = mix(vec3(0.3, 0.0, 0.0), vec3(1.0, 0.0, 0.0), t);
        color = mix(color, vec3(1.0, 0.5, 0.0), smoothstep(0.6, 1.0, t));
    } else if (palette == 8) {
        color = mix(vec3(0.0, 0.2, 0.0), vec3(0.0, 1.0, 0.3), t);
    } else {
        color = mix(vec3(0.5, 0.3, 0.0), vec3(1.0, 0.8, 0.0), t);
        color = mix(color, vec3(0.8, 0.3, 1.0), smoothstep(0.5, 0.9, t));
    }

    return color;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float time = TIME;

    vec3 col = vec3(0.0);

    int tMode = int(tunnelMode);
    int fType = int(fractalType);
    int palette = int(colorPalette);
    int detail = int(fractalDetail);

    // Get tunnel coordinates
    vec2 tunnelUV = getTunnelUV(uv, time, tMode, tunnelDepth, tunnelTwist);
    float tunnelDist = length(uv);

    // Geometry - fractal patterns
    if (geometryAmount > 0.0) {
        float fractal = getFractal(tunnelUV, fType, fractalScale, detail);
        vec3 fractalColor = getPalette(fractal, palette, colorShift * time * 0.1);
        float edgeFade = 1.0 - smoothstep(0.5, 1.5, tunnelDist);
        col += fractalColor * fractal * geometryAmount * edgeFade;
    }

    // Clouds - flowing nebula
    if (cloudAmount > 0.0) {
        vec2 cloudUV = tunnelUV + vec2(time * cloudFlow * 0.1, 0.0);
        float clouds = fbm(cloudUV * 2.0, 6);
        vec3 cloudColor = getPalette(clouds, palette, 0.3 + colorShift * time * 0.1);
        col += cloudColor * clouds * cloudAmount * 0.6;
    }

    // Atoms - orbital particles
    if (atomCount > 0.0) {
        int atomCnt = int(atomCount);
        for (int i = 0; i < 50; i++) {
            if (i >= atomCnt) break;

            float fi = float(i);
            vec3 seed = hash3(fi * 7.13);

            float theta = seed.x * PI * 2.0;
            float phi = seed.y * PI;
            float orbitRadius = 0.2 + seed.z * 0.3;
            float orbitPhase = time * orbitSpeed + fi * 0.5;

            vec2 atomPos = vec2(
                sin(phi + orbitPhase) * cos(theta) * orbitRadius,
                cos(phi + orbitPhase) * sin(theta) * orbitRadius
            );

            float dist = length(uv - atomPos);
            float atom = exp(-dist * dist / (atomSize * atomSize));
            vec3 atomColor = getPalette(fi / float(atomCnt), palette, colorShift * time * 0.1);
            col += atomColor * atom * 2.0;
        }
    }

    // Nucleus - central glow
    if (nucleusGlow > 0.0) {
        float centerDist = length(uv);
        float nucleus = exp(-centerDist * centerDist * 8.0);
        vec3 nucleusColor = getPalette(0.5 + sin(time) * 0.2, palette, colorShift * time * 0.1);
        col += nucleusColor * nucleus * nucleusGlow;
    }

    // Star field
    if (starField > 0.0) {
        float stars = getStars(uv + vec2(time * 0.05, 0.0), starField);
        col += vec3(1.0, 0.95, 0.9) * stars;
    }

    // Node network
    if (nodeNetwork > 0.0) {
        vec2 networkUV = tunnelUV * 5.0;
        float nodes = fbm(networkUV, 3);
        nodes = smoothstep(0.55, 0.65, nodes);
        vec3 nodeColor = getPalette(0.8, palette, colorShift * time * 0.1);
        col += nodeColor * nodes * nodeNetwork;
    }

    // Tunnel depth glow
    float depthGlow = 1.0 - smoothstep(0.0, 1.0, tunnelDist);
    depthGlow = pow(depthGlow, 2.0);
    vec3 glowColor = getPalette(tunnelUV.y * 0.1, palette, colorShift * time * 0.1);
    col += glowColor * depthGlow * 0.2;

    // Post processing
    col = pow(col, vec3(1.0 / contrast));
    col *= brightness;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
