/*{
    "DESCRIPTION": "Glowing plasma energy sphere with volumetric light tendrils, noise-displaced surface, and accumulated emission glow",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D SDF"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.5, "MIN": 0.2, "MAX": 4.0},
        {"NAME": "camDist", "TYPE": "float", "DEFAULT": 4.0, "MIN": 2.0, "MAX": 8.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "plasmaSize", "TYPE": "float", "DEFAULT": 1.5, "MIN": 0.5, "MAX": 3.0},
        {"NAME": "tendrilLength", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

// --- 3D noise ---
float hash(float n) { return fract(sin(n) * 43758.5453); }

float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n = dot(i, vec3(1.0, 57.0, 113.0));
    return mix(
        mix(mix(hash(n), hash(n + 1.0), f.x),
            mix(hash(n + 57.0), hash(n + 58.0), f.x), f.y),
        mix(mix(hash(n + 113.0), hash(n + 114.0), f.x),
            mix(hash(n + 170.0), hash(n + 171.0), f.x), f.y),
        f.z);
}

// --- FBM noise ---
// Was 5 octaves — trimmed to 3 (dominant octaves contribute most; surface still looks plasma-like).
float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    vec3 shift = vec3(100.0);
    for (int i = 0; i < 3; i++) {
        v += a * noise3(p);
        p = p * 2.0 + shift;
        a *= 0.5;
    }
    return v;
}

// --- Plasma sphere SDF with noise displacement ---
float map(vec3 p, float t) {
    float r = length(p);
    float baseR = plasmaSize;

    // Noise displacement for organic surface
    float highReact = 1.0 + audioHigh * tendrilLength * 0.5;
    float noiseVal = fbm(p * 1.5 + t * 0.3) * 0.6 * tendrilLength * highReact;

    // Core sphere
    float d = r - baseR - noiseVal;

    return d;
}

// --- Normal ---
vec3 calcNormal(vec3 p, float t) {
    vec2 e = vec2(0.005, 0.0);
    return normalize(vec3(
        map(p + e.xyy, t) - map(p - e.xyy, t),
        map(p + e.yxy, t) - map(p - e.yxy, t),
        map(p + e.yyx, t) - map(p - e.yyx, t)
    ));
}

// --- HSV to RGB ---
vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * speed;

    // Camera orbits
    float camAngle = t * 0.3;
    float camH = sin(t * 0.2) * 1.0;
    vec3 ro = vec3(
        cos(camAngle) * camDist,
        camH,
        sin(camAngle) * camDist
    );
    vec3 target = vec3(0.0);

    // Camera matrix
    vec3 fwd = normalize(target - ro);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    vec3 rd = normalize(fwd + uv.x * right + uv.y * up);

    // Dark background
    vec3 col = vec3(0.01, 0.01, 0.02);

    // Glow accumulation during march
    vec3 glowAccum = vec3(0.0);
    float glowTotal = 0.0;

    // Ray march
    float dist = 0.0;
    bool hit = false;

    for (int i = 0; i < 80; i++) {
        vec3 p = ro + rd * dist;
        float d = map(p, t);

        // Accumulate volumetric glow based on proximity to surface
        float r = length(p);
        float proximity = 1.0 / (1.0 + d * d * 4.0);
        float falloff = 1.0 / (1.0 + r * r * 0.1);

        // Determine glow color based on position + noise
        float nv = fbm(p * 0.8 + t * 0.2);
        float hue = colorShift / 6.28 + nv * 0.3 + 0.6; // blue/purple base
        float sat = 0.6 + 0.4 * (1.0 - proximity);
        vec3 glowCol = hsv2rgb(vec3(hue, sat, 1.0));

        // Brighter near core
        float coreGlow = exp(-r * r * 0.5) * 2.0;
        glowAccum += glowCol * proximity * falloff * 0.15 * intensity;
        glowAccum += vec3(0.8, 0.85, 1.0) * coreGlow * proximity * 0.02 * intensity;
        glowTotal += proximity * falloff;

        if (d < 0.002) {
            hit = true;
            break;
        }
        if (dist > 20.0) break;
        dist += max(d * 0.5, 0.01); // Slow stepping for better glow accumulation
    }

    if (hit) {
        vec3 p = ro + rd * dist;
        vec3 n = calcNormal(p, t);

        // Surface color: bright plasma
        float nv = fbm(p * 2.0 + t * 0.5);
        float hue = colorShift / 6.28 + nv * 0.4 + 0.55;
        vec3 surfCol = hsv2rgb(vec3(hue, 0.5, 1.0));

        // Fresnel for rim glow
        float fresnel = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);

        // Emission - the surface itself glows
        float emission = 0.5 + fresnel * 1.5;
        col = surfCol * emission * intensity;

        // Add white-hot core reflection
        float core = exp(-length(p) * 2.0);
        col += vec3(1.0, 0.95, 0.9) * core * 2.0 * intensity;
    }

    // Add accumulated volumetric glow
    col += glowAccum;

    // Tendril streaks: radial noise patterns
    float highReact = 1.0 + audioHigh * 0.6;
    vec3 viewP = vec3(uv * 3.0, t * 0.1);
    float streak = fbm(viewP * 2.0) * fbm(viewP * 4.0 + 7.0);
    float streakMask = exp(-length(uv) * 2.0) * streak * tendrilLength * highReact;
    float streakHue = colorShift / 6.28 + 0.7;
    col += hsv2rgb(vec3(streakHue, 0.6, 1.0)) * streakMask * 0.3 * intensity;

    // Central bright spot
    float centerGlow = exp(-length(uv) * length(uv) * 8.0);
    col += vec3(0.6, 0.7, 1.0) * centerGlow * 0.5 * intensity * (1.0 + audioBeat * 0.5);

    // Audio beat pulse on overall brightness
    col *= 1.0 + audioBeat * 0.3;

    // Vignette
    float vignette = 1.0 - 0.5 * length(uv);
    col *= vignette;

    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
