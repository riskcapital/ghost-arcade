/*{
    "DESCRIPTION": "Molten planet/sun with undulating lava surface, bright emission in crevices, rim lighting, atmospheric glow accumulation",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D SDF"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.5, "MIN": 0.2, "MAX": 4.0},
        {"NAME": "camDist", "TYPE": "float", "DEFAULT": 4.0, "MIN": 2.0, "MAX": 10.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "lavaIntensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 3.0},
        {"NAME": "deformation", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.0, "MAX": 1.5}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

// --- Hash ---
float hash31(vec3 p) {
    p = fract(p * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
}

// --- 3D Value noise ---
float noise3D(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float n000 = hash31(i);
    float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash31(i + vec3(1.0, 1.0, 1.0));

    float n00 = mix(n000, n100, f.x);
    float n10 = mix(n010, n110, f.x);
    float n01 = mix(n001, n101, f.x);
    float n11 = mix(n011, n111, f.x);

    float n0 = mix(n00, n10, f.y);
    float n1 = mix(n01, n11, f.y);

    return mix(n0, n1, f.z);
}

// --- FBM 3D noise (multi-octave) ---
float fbm3D(vec3 p) {
    float val = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    for (int i = 0; i < 5; i++) {
        val += amp * noise3D(p * freq);
        freq *= 2.0;
        amp *= 0.5;
    }
    return val;
}

// --- Molten sphere SDF with noise displacement ---
float map(vec3 p) {
    float t = TIME * speed;

    // Base sphere
    float baseR = 1.5;
    float r = length(p) - baseR;

    // Multi-octave noise displacement on the surface
    vec3 noiseP = normalize(p) * 2.5 + vec3(t * 0.2, t * 0.15, -t * 0.1);
    float disp = fbm3D(noiseP) * deformation;

    // Add bass-reactive pulsing
    float bassPulse = audioBass * 0.15 * lavaIntensity;
    disp += bassPulse;

    // Additional coarser deformation for big surface features
    float bigFeatures = noise3D(normalize(p) * 1.5 + vec3(t * 0.1)) * deformation * 0.5;

    return r - disp - bigFeatures;
}

// --- Normal ---
vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.003, 0.0);
    return normalize(vec3(
        map(p + e.xyy) - map(p - e.xyy),
        map(p + e.yxy) - map(p - e.yxy),
        map(p + e.yyx) - map(p - e.yyx)
    ));
}

// --- Approximate curvature (for emission in crevices) ---
float calcCurvature(vec3 p, vec3 n) {
    float eps = 0.05;
    float d1 = map(p + n * eps);
    float d2 = map(p - n * eps);
    return (d1 + d2 - 2.0 * map(p)) / (eps * eps);
}

// --- Lava color based on heat ---
vec3 lavaColor(float heat, float shift) {
    // From dark crust -> red -> orange -> yellow-white
    vec3 dark = vec3(0.1, 0.02, 0.0);
    vec3 red = vec3(0.8, 0.1, 0.0);
    vec3 orange = vec3(1.0, 0.5, 0.05);
    vec3 hot = vec3(1.0, 0.85, 0.4);

    vec3 col;
    if (heat < 0.3) {
        col = mix(dark, red, heat / 0.3);
    } else if (heat < 0.6) {
        col = mix(red, orange, (heat - 0.3) / 0.3);
    } else {
        col = mix(orange, hot, (heat - 0.6) / 0.4);
    }

    // Subtle color shift
    float cs = cos(shift * 0.5);
    float ss = sin(shift * 0.5);
    float r = col.r;
    float g = col.g * cs - col.b * ss;
    col.g = clamp(col.g * cs + col.b * ss * 0.3, 0.0, 1.0);

    return col;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * speed;

    // Camera orbit
    float camAngle = t * 0.25;
    float camH = sin(t * 0.15) * 0.5;
    vec3 ro = vec3(
        cos(camAngle) * camDist,
        camH,
        sin(camAngle) * camDist
    );
    vec3 target = vec3(0.0, 0.0, 0.0);

    vec3 fwd = normalize(target - ro);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    vec3 rd = normalize(fwd + uv.x * right + uv.y * up);

    // Dark space background
    vec3 bgColor = vec3(0.01, 0.005, 0.02);

    // Background stars
    float starNoise = hash31(vec3(floor(uv * 200.0), 1.0));
    if (starNoise > 0.985) {
        float brightness = (starNoise - 0.985) * 66.0;
        bgColor += vec3(brightness * 0.8);
    }

    vec3 col = bgColor;

    // Atmospheric glow accumulation during ray march
    float glowAcc = 0.0;
    float dist = 0.0;
    bool hit = false;

    for (int i = 0; i < 80; i++) {
        vec3 p = ro + rd * dist;
        float d = map(p);

        // Accumulate glow when near the surface (atmosphere)
        float nearness = length(p) - 1.5;  // distance from base sphere center
        if (nearness < 1.5 && nearness > -0.5) {
            float glowStrength = exp(-max(d, 0.0) * 3.0) * 0.02;
            glowAcc += glowStrength;
        }

        if (d < 0.002) {
            hit = true;
            break;
        }
        if (dist > 20.0) break;
        dist += d;
    }

    if (hit) {
        vec3 p = ro + rd * dist;
        vec3 n = calcNormal(p);

        // Curvature: negative = concave (crevices), positive = convex (ridges)
        float curv = calcCurvature(p, n);

        // Heat based on curvature (crevices are hot) and noise
        float t2 = TIME * speed;
        vec3 noiseP2 = p * 3.0 + vec3(t2 * 0.3);
        float surfaceNoise = noise3D(noiseP2);

        // Crevices: negative curvature -> high heat
        float creviceHeat = clamp(-curv * 0.3, 0.0, 1.0);
        // Add noise-based variation
        float noiseHeat = smoothstep(0.35, 0.65, surfaceNoise);
        // Bass makes the magma glow more
        float bassGlow = audioBass * lavaIntensity * 0.5;

        float heat = clamp(creviceHeat * 0.7 + noiseHeat * 0.5 + bassGlow * 0.4, 0.0, 1.0);
        heat *= lavaIntensity;

        vec3 matCol = lavaColor(heat, colorShift);

        // Lighting
        vec3 lightDir = normalize(vec3(2.0, 3.0, 1.5));
        float diff = max(dot(n, lightDir), 0.0);

        // Rim lighting (strong backlight effect)
        float rim = 1.0 - max(dot(n, -rd), 0.0);
        rim = pow(rim, 3.0);
        vec3 rimCol = vec3(1.0, 0.3, 0.05) * rim * 1.5;

        // Self-illumination from hot areas
        vec3 emission = matCol * heat * 2.0 * intensity;

        // Combined: dark crust gets diffuse, hot areas glow
        float crustFactor = 1.0 - heat;
        vec3 surfaceCol = matCol * (0.1 + diff * 0.3) * crustFactor + emission;
        surfaceCol += rimCol;

        col = surfaceCol;
    }

    // Atmospheric glow (orange haze around the sphere)
    vec3 glowCol = vec3(1.0, 0.35, 0.05) * lavaIntensity;
    glowCol += vec3(0.3, 0.05, 0.0) * audioBass * lavaIntensity;
    col += glowCol * glowAcc * intensity * 2.0;

    // Extra outer glow based on proximity to center of screen
    float screenDist = length(uv);
    float outerGlow = exp(-screenDist * 2.5) * 0.15 * lavaIntensity * intensity;
    col += vec3(0.8, 0.2, 0.02) * outerGlow;

    // Vignette
    float vignette = 1.0 - 0.15 * screenDist;
    col *= vignette;

    // Tone mapping (simple Reinhard for HDR emission)
    col = col / (col + vec3(1.0));

    // Slight gamma
    col = pow(col, vec3(0.9));

    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
