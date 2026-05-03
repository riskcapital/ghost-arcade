/*{
  "CREDIT": "by Justin Robie Wood",
  "CATEGORIES": [
    "generator"
  ],
  "DESCRIPTION": "Fractal Dimension Supreme - Infinite Mathematical Structures",
  "INPUTS": [
    {
      "NAME": "fractalMode",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 9.0
    },
    {
      "NAME": "iterations",
      "TYPE": "float",
      "DEFAULT": 8.0,
      "MIN": 3.0,
      "MAX": 20.0
    },
    {
      "NAME": "power",
      "TYPE": "float",
      "DEFAULT": 8.0,
      "MIN": 2.0,
      "MAX": 16.0
    },
    {
      "NAME": "scale",
      "TYPE": "float",
      "DEFAULT": 2.0,
      "MIN": 1.5,
      "MAX": 5.0
    },
    {
      "NAME": "morphAmount",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 2.0
    },
    {
      "NAME": "foldAmount",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 2.0
    },
    {
      "NAME": "cameraMode",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 5.0
    },
    {
      "NAME": "cameraSpeed",
      "TYPE": "float",
      "DEFAULT": 0.3,
      "MIN": 0.0,
      "MAX": 2.0
    },
    {
      "NAME": "cameraDistance",
      "TYPE": "float",
      "DEFAULT": 3.0,
      "MIN": 1.0,
      "MAX": 8.0
    },
    {
      "NAME": "renderMode",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 7.0
    },
    {
      "NAME": "colorMode",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 8.0
    },
    {
      "NAME": "colorCycle",
      "TYPE": "float",
      "DEFAULT": 0.5,
      "MIN": 0.0,
      "MAX": 2.0
    },
    {
      "NAME": "glowIntensity",
      "TYPE": "float",
      "DEFAULT": 0.5,
      "MIN": 0.0,
      "MAX": 3.0
    },
    {
      "NAME": "edgeGlow",
      "TYPE": "float",
      "DEFAULT": 0.3,
      "MIN": 0.0,
      "MAX": 2.0
    },
    {
      "NAME": "aoIntensity",
      "TYPE": "float",
      "DEFAULT": 0.3,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "fogAmount",
      "TYPE": "float",
      "DEFAULT": 0.2,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "kaleidoscope",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 12.0
    },
    {
      "NAME": "rotationSpeed",
      "TYPE": "float",
      "DEFAULT": 0.2,
      "MIN": 0.0,
      "MAX": 2.0
    },
    {
      "NAME": "pulseAmount",
      "TYPE": "float",
      "DEFAULT": 0.0,
      "MIN": 0.0,
      "MAX": 1.0
    },
    {
      "NAME": "contrast",
      "TYPE": "float",
      "DEFAULT": 1.5,
      "MIN": 0.5,
      "MAX": 3.0
    },
    {
      "NAME": "brightness",
      "TYPE": "float",
      "DEFAULT": 1.0,
      "MIN": 0.5,
      "MAX": 2.0
    }
  ]
}*/

// ============================================================================
// FRACTAL DIMENSION SUPREME - Infinite Mathematical Beauty
// By Justin Robie Wood
// ============================================================================

#define PI 3.14159265359
#define MAX_STEPS 100
#define MAX_DIST 50.0
#define SURF_DIST 0.001

// Rotation matrices
mat2 rot2D(float a) {
    float s = sin(a), c = cos(a);
    return mat2(c, -s, s, c);
}

// Fold space
vec3 fold(vec3 p, float amount) {
    p.xy = abs(p.xy);
    if (p.x < p.y) p.xy = p.yx;
    p -= amount;
    if (p.x < 0.0) p.x = -p.x;
    if (p.y < 0.0) p.y = -p.y;
    return p;
}

// Mandelbulb distance estimator
float mandelbulb(vec3 pos, float power, int iters) {
    vec3 z = pos;
    float dr = 1.0;
    float r = 0.0;

    for (int i = 0; i < 20; i++) {
        if (i >= iters) break;

        r = length(z);
        if (r > 2.0) break;

        // Convert to polar
        float theta = acos(z.z / r);
        float phi = atan(z.y, z.x);
        dr = pow(r, power - 1.0) * power * dr + 1.0;

        // Scale and rotate
        float zr = pow(r, power);
        theta = theta * power;
        phi = phi * power;

        // Convert back
        z = zr * vec3(
            sin(theta) * cos(phi),
            sin(phi) * sin(theta),
            cos(theta)
        );
        z += pos;
    }

    return 0.5 * log(r) * r / dr;
}

// Menger sponge
float mengerSponge(vec3 p, float scale, int iters) {
    vec3 z = p;
    float d = 1000.0;

    for (int i = 0; i < 20; i++) {
        if (i >= iters) break;

        z = abs(z);
        if (z.x < z.y) z.xy = z.yx;
        if (z.x < z.z) z.xz = z.zx;
        if (z.y < z.z) z.yz = z.zy;

        z = z * scale - vec3(1.0) * (scale - 1.0);

        if (z.z < -0.5 * (scale - 1.0)) z.z += (scale - 1.0);

        d = min(d, length(z) * pow(scale, -float(i + 1)));
    }

    return d - 0.01;
}

// Sierpinski pyramid
float sierpinski(vec3 p, float scale, int iters) {
    vec3 z = p;
    float r;

    for (int i = 0; i < 20; i++) {
        if (i >= iters) break;

        if (z.x + z.y < 0.0) z.xy = -z.yx;
        if (z.x + z.z < 0.0) z.xz = -z.zx;
        if (z.y + z.z < 0.0) z.yz = -z.zy;

        z = z * scale - vec3(1.0) * (scale - 1.0);
    }

    return (length(z) - 2.0) * pow(scale, -float(iters));
}

// Kaleidoscopic IFS
float kaleidoscopic(vec3 p, float scale, int iters, float foldAmt) {
    vec3 z = p;

    for (int i = 0; i < 20; i++) {
        if (i >= iters) break;

        z = fold(z, foldAmt);
        z = z * scale - vec3(scale - 1.0);
        z = abs(z);
    }

    return length(z) * pow(scale, -float(iters));
}

// Julia set 3D
float julia3D(vec3 p, vec3 c, int iters) {
    vec3 z = p;
    float r;

    for (int i = 0; i < 20; i++) {
        if (i >= iters) break;

        r = length(z);
        if (r > 2.0) break;

        // Quaternion-like iteration
        float x2 = z.x * z.x;
        float y2 = z.y * z.y;
        float z2 = z.z * z.z;

        z = vec3(
            x2 - y2 - z2 + c.x,
            2.0 * z.x * z.y + c.y,
            2.0 * z.x * z.z + c.z
        );
    }

    return length(z) * 0.5;
}

// Mandelbox
float mandelbox(vec3 p, float scale, int iters, float foldLimit) {
    vec3 z = p;
    float dr = 1.0;

    for (int i = 0; i < 20; i++) {
        if (i >= iters) break;

        // Box fold
        z = clamp(z, -foldLimit, foldLimit) * 2.0 - z;

        // Sphere fold
        float r2 = dot(z, z);
        if (r2 < 0.5) {
            z *= 4.0;
            dr *= 4.0;
        } else if (r2 < 1.0) {
            z /= r2;
            dr /= r2;
        }

        z = z * scale + p;
        dr = dr * abs(scale) + 1.0;
    }

    return length(z) / abs(dr);
}

// Get fractal distance
float getFractal(vec3 p, float time, int mode, int iters) {
    float pulse = 1.0 + sin(time * 2.0) * pulseAmount * 0.3;
    float rot = time * rotationSpeed;

    // Apply rotation
    p.xz = rot2D(rot) * p.xz;
    p.yz = rot2D(rot * 0.7) * p.yz;

    // Morph parameter
    float morph = sin(time * 0.5) * morphAmount;

    if (mode == 0) {
        // Mandelbulb
        return mandelbulb(p, power * pulse, iters);

    } else if (mode == 1) {
        // Menger sponge
        return mengerSponge(p, scale * pulse, iters);

    } else if (mode == 2) {
        // Sierpinski
        return sierpinski(p, scale * pulse, iters);

    } else if (mode == 3) {
        // Kaleidoscopic
        return kaleidoscopic(p, scale * pulse, iters, foldAmount);

    } else if (mode == 4) {
        // Julia set
        vec3 c = vec3(
            sin(time * 0.3) * morph,
            cos(time * 0.2) * morph,
            sin(time * 0.4) * morph
        );
        return julia3D(p, c, iters);

    } else if (mode == 5) {
        // Mandelbox
        return mandelbox(p, scale * pulse, iters, 1.0 + foldAmount);

    } else if (mode == 6) {
        // Hybrid: Mandelbulb + Menger
        float d1 = mandelbulb(p, power * pulse, iters);
        float d2 = mengerSponge(p, scale * pulse, iters);
        return mix(d1, d2, sin(time * 0.5) * 0.5 + 0.5);

    } else if (mode == 7) {
        // Morphing kaleidoscope
        return kaleidoscopic(p, scale * pulse, iters, 0.5 + sin(time) * foldAmount);

    } else if (mode == 8) {
        // Nested structures
        float d1 = sierpinski(p, scale, iters / 2);
        float d2 = mandelbulb(p * 0.5, power, iters / 2);
        return min(d1, d2);

    } else {
        // Ultimate hybrid
        float d1 = mandelbulb(p, power * pulse, iters);
        float d2 = mengerSponge(p * 0.7, scale, iters);
        float d3 = kaleidoscopic(p * 1.2, scale, iters, foldAmount);
        return min(min(d1, d2), d3);
    }
}

// Raymarch
vec2 raymarch(vec3 ro, vec3 rd, float time, int fracMode, int iters) {
    float dO = 0.0;
    float minDist = 100.0;

    for (int i = 0; i < MAX_STEPS; i++) {
        vec3 p = ro + rd * dO;
        float dS = getFractal(p, time, fracMode, iters);
        minDist = min(minDist, dS);
        dO += dS;

        if (dO > MAX_DIST || abs(dS) < SURF_DIST) break;
    }

    return vec2(dO, minDist);
}

// Normal
vec3 getNormal(vec3 p, float time, int fracMode, int iters) {
    vec2 e = vec2(0.001, 0.0);
    float d = getFractal(p, time, fracMode, iters);
    vec3 n = d - vec3(
        getFractal(p - e.xyy, time, fracMode, iters),
        getFractal(p - e.yxy, time, fracMode, iters),
        getFractal(p - e.yyx, time, fracMode, iters)
    );
    return normalize(n);
}

// Get color based on position and mode
vec3 getColor(vec3 p, vec3 n, float dist, float ao, int mode, float time) {
    float cyclePhase = time * colorCycle;

    if (mode == 0) {
        // Position-based rainbow
        float hue = (p.x + p.y + p.z) * 0.5 + cyclePhase;
        return vec3(
            sin(hue) * 0.5 + 0.5,
            sin(hue + 2.094) * 0.5 + 0.5,
            sin(hue + 4.189) * 0.5 + 0.5
        );

    } else if (mode == 1) {
        // Normal-based coloring
        return n * 0.5 + 0.5;

    } else if (mode == 2) {
        // Distance-based heat
        float heat = 1.0 - dist / MAX_DIST;
        return vec3(heat, heat * heat * 0.7, 1.0 - heat);

    } else if (mode == 3) {
        // Electric plasma
        float val = sin(p.x * 2.0 + cyclePhase) * cos(p.y * 2.0) * sin(p.z * 2.0);
        return mix(vec3(0.0, 0.5, 1.0), vec3(1.0, 0.0, 0.8), val * 0.5 + 0.5);

    } else if (mode == 4) {
        // Fractal orbit trap
        float trap = length(p.xy) + length(p.yz) + length(p.xz);
        float hue = fract(trap * 0.5 + cyclePhase);
        return vec3(
            sin(hue * 6.28) * 0.5 + 0.5,
            sin(hue * 6.28 + 2.094) * 0.5 + 0.5,
            sin(hue * 6.28 + 4.189) * 0.5 + 0.5
        );

    } else if (mode == 5) {
        // Depth layers
        float layer = fract(dist * 0.3 + cyclePhase * 0.1);
        return mix(vec3(0.0, 0.3, 0.6), vec3(1.0, 0.5, 0.2), layer);

    } else if (mode == 6) {
        // Cosmic nebula
        return vec3(
            sin(p.x + cyclePhase) * 0.5 + 0.5,
            sin(p.y + cyclePhase * 1.3) * 0.5 + 0.5,
            sin(p.z + cyclePhase * 0.7) * 0.5 + 0.5
        );

    } else if (mode == 7) {
        // Monochrome with AO
        return vec3(ao);

    } else {
        // Ultimate psychedelic
        float r = sin(p.x * 3.0 + cyclePhase) * sin(dist * 5.0);
        float g = cos(p.y * 3.0 + cyclePhase * 1.3) * cos(dist * 5.0);
        float b = sin(p.z * 3.0 + cyclePhase * 0.7) * sin(dist * 3.0);
        return vec3(r, g, b) * 0.5 + 0.5;
    }
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float time = TIME;

    // Kaleidoscope effect
    if (kaleidoscope > 0.0) {
        float angle = atan(uv.y, uv.x);
        float radius = length(uv);
        float segments = kaleidoscope;
        angle = mod(angle, PI * 2.0 / segments);
        angle = abs(angle - PI / segments);
        uv = vec2(cos(angle), sin(angle)) * radius;
    }

    int fracMode = int(fractalMode);
    int camMode = int(cameraMode);
    int rMode = int(renderMode);
    int colMode = int(colorMode);
    int iters = int(iterations);

    // Camera position based on mode
    vec3 ro;
    if (camMode == 0) {
        // Orbit
        float angle = time * cameraSpeed;
        ro = vec3(
            cos(angle) * cameraDistance,
            sin(time * cameraSpeed * 0.5) * cameraDistance * 0.5,
            sin(angle) * cameraDistance
        );
    } else if (camMode == 1) {
        // Forward tunnel
        ro = vec3(0.0, 0.0, -time * cameraSpeed * 2.0 + cameraDistance);
    } else if (camMode == 2) {
        // Spiral
        float angle = time * cameraSpeed;
        float height = time * cameraSpeed * 0.5;
        ro = vec3(
            cos(angle) * cameraDistance,
            height,
            sin(angle) * cameraDistance
        );
    } else if (camMode == 3) {
        // Figure-8
        float t = time * cameraSpeed;
        ro = vec3(
            sin(t) * cameraDistance,
            sin(t * 2.0) * cameraDistance * 0.5,
            cos(t) * cameraDistance
        );
    } else if (camMode == 4) {
        // Chaotic
        ro = vec3(
            sin(time * cameraSpeed * 1.3) * cameraDistance,
            cos(time * cameraSpeed * 0.7) * cameraDistance,
            sin(time * cameraSpeed * 0.9) * cameraDistance
        );
    } else {
        // Static
        ro = vec3(0.0, 0.0, cameraDistance);
    }

    vec3 rd = normalize(vec3(uv, 1.0));
    vec3 lookAt = vec3(0.0);
    vec3 forward = normalize(lookAt - ro);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), forward));
    vec3 up = cross(forward, right);
    rd = normalize(forward + uv.x * right + uv.y * up);

    // Raymarch
    vec2 march = raymarch(ro, rd, time, fracMode, iters);
    float d = march.x;
    float minDist = march.y;

    vec3 col = vec3(0.0);

    if (d < MAX_DIST) {
        vec3 p = ro + rd * d;
        vec3 n = getNormal(p, time, fracMode, iters);

        // Ambient occlusion
        float ao = 1.0;
        if (aoIntensity > 0.0) {
            float aoStep = 0.1;
            for (int i = 1; i <= 5; i++) {
                float dist = float(i) * aoStep;
                ao -= (dist - getFractal(p + n * dist, time, fracMode, iters)) * aoIntensity * 0.2;
            }
        }

        // Get base color
        vec3 baseColor = getColor(p, n, d, ao, colMode, time);

        if (rMode == 0) {
            // Standard shading
            float diff = max(dot(n, normalize(vec3(1.0, 1.0, -1.0))), 0.0);
            col = baseColor * (0.5 + diff * 0.5) * ao;

        } else if (rMode == 1) {
            // Flat shaded
            col = baseColor * ao;

        } else if (rMode == 2) {
            // Edge glow
            float fresnel = pow(1.0 - abs(dot(rd, n)), 3.0);
            col = baseColor * ao + baseColor * fresnel * edgeGlow;

        } else if (rMode == 3) {
            // X-ray
            float fresnel = pow(1.0 - abs(dot(rd, n)), 2.0);
            col = baseColor * fresnel;

        } else if (rMode == 4) {
            // Normal map
            col = n * 0.5 + 0.5;

        } else if (rMode == 5) {
            // Orbit trap glow
            col = baseColor * (1.0 + 1.0 / (minDist + 0.1) * glowIntensity);

        } else if (rMode == 6) {
            // Toon shading
            float diff = max(dot(n, normalize(vec3(1.0, 1.0, -1.0))), 0.0);
            diff = floor(diff * 4.0) / 4.0;
            col = baseColor * diff * ao;

        } else {
            // Ultimate combo
            float diff = max(dot(n, normalize(vec3(1.0, 1.0, -1.0))), 0.0);
            float fresnel = pow(1.0 - abs(dot(rd, n)), 3.0);
            col = baseColor * (0.5 + diff * 0.5) * ao + baseColor * fresnel * edgeGlow;
            col += baseColor * (1.0 / (minDist + 0.1)) * glowIntensity * 0.3;
        }

        // Fog
        if (fogAmount > 0.0) {
            float fog = 1.0 - exp(-d * fogAmount * 0.1);
            col = mix(col, vec3(0.0), fog);
        }
    } else {
        // Background glow
        if (glowIntensity > 0.0) {
            col = getColor(ro + rd * 10.0, rd, 10.0, 1.0, colMode, time) * glowIntensity * 0.1;
        }
    }

    // Post processing
    col = pow(col, vec3(1.0 / contrast));
    col *= brightness;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
