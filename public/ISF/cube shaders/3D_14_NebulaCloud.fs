/*{
    "DESCRIPTION": "Volumetric nebula cloud with multi-colored gas regions, background stars, and bass-reactive density",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D SDF"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.5, "MIN": 0.2, "MAX": 4.0},
        {"NAME": "camDist", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.0, "MAX": 8.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "cloudDensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "starDensity", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

// --- 3D noise ---
float n3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f *= f * (3.0 - 2.0 * f);
    float n = dot(i, vec3(1.0, 57.0, 113.0));
    return mix(
        mix(mix(fract(sin(n) * 43758.5), fract(sin(n + 1.0) * 43758.5), f.x),
            mix(fract(sin(n + 57.0) * 43758.5), fract(sin(n + 58.0) * 43758.5), f.x), f.y),
        mix(mix(fract(sin(n + 113.0) * 43758.5), fract(sin(n + 114.0) * 43758.5), f.x),
            mix(fract(sin(n + 170.0) * 43758.5), fract(sin(n + 171.0) * 43758.5), f.x), f.y),
        f.z);
}

// --- FBM with 6 octaves for rich detail ---
float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    vec3 shift = vec3(100.0, 50.0, 75.0);
    for (int i = 0; i < 6; i++) {
        v += a * n3(p);
        p = p * 2.03 + shift;
        a *= 0.48;
    }
    return v;
}

// --- Star field ---
float starField(vec3 rd, float density) {
    // Create stars from ray direction hash
    vec3 p = rd * 300.0;
    vec3 cellId = floor(p);
    vec3 cellUv = fract(p) - 0.5;

    float n = dot(cellId, vec3(1.0, 57.0, 113.0));
    float rnd = fract(sin(n) * 43758.5);

    // Only some cells have stars
    float threshold = 1.0 - density * 0.015;
    if (rnd < threshold) return 0.0;

    // Star position within cell
    float sx = fract(sin(n + 1.0) * 43758.5) - 0.5;
    float sy = fract(sin(n + 2.0) * 43758.5) - 0.5;
    vec2 starPos = vec2(sx, sy) * 0.6;
    float d = length(cellUv.xy - starPos);

    // Star brightness variation
    float brightness = fract(sin(n + 3.0) * 43758.5);
    brightness = brightness * brightness * 2.0;

    // Twinkle
    float twinkle = 0.7 + 0.3 * sin(TIME * 2.0 + rnd * 50.0);

    float star = exp(-d * d * 800.0) * brightness * twinkle;
    return star;
}

// --- HSV to RGB ---
vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

// --- Nebula color based on position ---
vec3 nebulaColor(vec3 p, float shift) {
    // Three color zones blended based on position noise
    float zone = fbm(p * 0.3 + vec3(shift, 0.0, shift * 0.5));

    vec3 pink = vec3(0.9, 0.3, 0.5);
    vec3 blue = vec3(0.2, 0.4, 0.95);
    vec3 orange = vec3(0.95, 0.5, 0.15);
    vec3 purple = vec3(0.5, 0.2, 0.8);

    vec3 col;
    if (zone < 0.3) {
        col = mix(pink, blue, zone / 0.3);
    } else if (zone < 0.55) {
        col = mix(blue, purple, (zone - 0.3) / 0.25);
    } else if (zone < 0.75) {
        col = mix(purple, orange, (zone - 0.55) / 0.2);
    } else {
        col = mix(orange, pink, (zone - 0.75) / 0.25);
    }

    // Apply color shift
    float cs = cos(shift);
    float ss = sin(shift);
    float rr = col.r * cs - col.g * ss;
    float gg = col.r * ss + col.g * cs;
    col.r = clamp(rr, 0.0, 1.0);
    col.g = clamp(gg, 0.0, 1.0);

    return col;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * speed;

    // Camera
    float camAngle = t * 0.15;
    float camH = sin(t * 0.1) * 0.5;
    vec3 ro = vec3(
        cos(camAngle) * camDist,
        camH,
        sin(camAngle) * camDist
    );
    vec3 target = vec3(sin(t * 0.07) * 0.5, cos(t * 0.05) * 0.3, 0.0);

    // Camera matrix
    vec3 fwd = normalize(target - ro);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    vec3 rd = normalize(fwd + uv.x * right + uv.y * up);

    // Deep space background
    vec3 col = vec3(0.005, 0.005, 0.015);

    // Stars
    float stars = starField(rd, starDensity);
    // Star color: mostly white with slight blue/yellow
    float starHash = fract(sin(dot(floor(rd * 300.0), vec3(1.0, 57.0, 113.0))) * 43758.5);
    vec3 starCol = mix(vec3(0.9, 0.9, 1.0), vec3(1.0, 0.95, 0.8), starHash);
    col += starCol * stars * starDensity;

    // Volumetric ray march through nebula
    float bassReact = 1.0 + audioBass * 0.8 * cloudDensity;
    float stepSize = 0.08;
    float totalDensity = 0.0;
    vec3 emission = vec3(0.0);

    float marchDist = 0.2; // Start slightly ahead
    float maxDist = 8.0;

    for (int i = 0; i < 80; i++) {
        if (totalDensity > 0.95) break;
        if (marchDist > maxDist) break;

        vec3 p = ro + rd * marchDist;

        // Bounding sphere check
        float boundR = 4.0;
        if (length(p) > boundR) {
            marchDist += stepSize;
            continue;
        }

        // Multiple noise octaves for density
        float rawDensity = fbm(p * 0.8 + t * 0.1);
        rawDensity += fbm(p * 1.6 - t * 0.05) * 0.5;
        rawDensity -= 0.55; // threshold: only high-noise areas are dense

        // Bass makes clouds denser
        rawDensity *= bassReact * cloudDensity;

        // Spherical falloff
        float distFromCenter = length(p);
        float falloff = 1.0 - smoothstep(1.0, boundR, distFromCenter);
        rawDensity *= falloff;

        if (rawDensity > 0.0) {
            float sampDensity = rawDensity * stepSize * 3.0;
            sampDensity = min(sampDensity, 1.0 - totalDensity);

            // Emission color from nebula zones
            vec3 nebulaCol = nebulaColor(p, colorShift);

            // Brightness varies with density and position
            float brightness = 0.5 + 0.5 * fbm(p * 2.0 + 200.0);
            vec3 sampleEmission = nebulaCol * brightness * intensity;

            // Internal illumination: brighter near center
            float internalLight = exp(-distFromCenter * 0.5) * 0.5;
            sampleEmission += nebulaCol * internalLight * intensity;

            emission += sampleEmission * sampDensity;
            totalDensity += sampDensity;
        }

        marchDist += stepSize;
    }

    // Blend nebula over background
    col = col * (1.0 - totalDensity) + emission;

    // Subtle outer glow
    float outerGlow = exp(-length(uv) * length(uv) * 2.0) * 0.1 * intensity;
    col += nebulaColor(vec3(uv, 0.0), colorShift) * outerGlow;

    // Audio beat pulse
    col *= 1.0 + audioBeat * 0.15;

    // Vignette
    float vignette = 1.0 - 0.3 * length(uv);
    col *= vignette;

    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
