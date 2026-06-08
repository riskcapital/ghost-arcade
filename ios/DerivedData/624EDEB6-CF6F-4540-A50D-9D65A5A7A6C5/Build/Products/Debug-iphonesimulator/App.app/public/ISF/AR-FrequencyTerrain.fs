/*{
    "DESCRIPTION": "Raymarched flyover heightfield terrain where height at each X position is the FFT spectrum. Camera flies forward with FBM erosion detail modulated by RMS. Terrain color maps to height with fog and optional wireframe grid.",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "terrainHeight", "TYPE": "float", "MIN": 0.5, "MAX": 4.0, "DEFAULT": 2.0},
        {"NAME": "flySpeed", "TYPE": "float", "MIN": 0.1, "MAX": 1.0, "DEFAULT": 0.3},
        {"NAME": "fogDensity", "TYPE": "float", "MIN": 0.02, "MAX": 0.2, "DEFAULT": 0.08},
        {"NAME": "erosion", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.0},
        {"NAME": "gridGlow", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3},
        {"NAME": "colorIntensity", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.5}
    ]
}*/

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

// Terrain height: FFT spectrum as x-axis + FBM erosion
float terrainH(vec2 p) {
    float energy = max(audioLevel, 0.25 + 0.1 * sin(TIME * 0.4));

    // Map world x to FFT frequency (0-1)
    float fftU = clamp(p.x * 0.1 + 0.5, 0.0, 1.0);
    float fftVal = sampleFFT(fftU);
    float fftFallback = 0.3 + 0.25 * sin(TIME * 0.6 + p.x * 0.5) + 0.15 * sin(p.x * 1.3 + TIME * 0.3);
    float hasAudio = step(0.01, max(audioLevel, 0.0));
    float fftH = mix(fftFallback, fftVal, hasAudio);

    // FBM erosion detail modulated by RMS
    float erosionAmount = erosion * (0.5 + energy * 0.5);
    float detail = fbm(p * 0.8) * erosionAmount * 0.3;

    // Small-scale ridges
    float ridges = abs(noise(p * 3.0) - 0.5) * erosion * 0.15;

    return (fftH * terrainHeight + detail + ridges) * 0.8;
}

// Terrain normal from finite differences
vec3 terrainNormal(vec2 p) {
    float e = 0.05;
    float h = terrainH(p);
    float hx = terrainH(p + vec2(e, 0.0));
    float hz = terrainH(p + vec2(0.0, e));
    return normalize(vec3(h - hx, e, h - hz));
}

// Terrain color by height
vec3 terrainColor(float h) {
    float maxH = terrainHeight * 1.2;
    float t = clamp(h / maxH, 0.0, 1.0);

    vec3 dark    = vec3(0.03, 0.04, 0.08);
    vec3 deep    = vec3(0.05, 0.08, 0.2);
    vec3 mid     = vec3(0.1, 0.25, 0.15);
    vec3 bright  = vec3(0.5, 0.35, 0.1);
    vec3 peak    = vec3(0.9, 0.8, 0.6);

    vec3 col;
    if (t < 0.2) {
        col = mix(dark, deep, t * 5.0);
    } else if (t < 0.45) {
        col = mix(deep, mid, (t - 0.2) * 4.0);
    } else if (t < 0.7) {
        col = mix(mid, bright, (t - 0.45) * 4.0);
    } else {
        col = mix(bright, peak, (t - 0.7) * 3.333);
    }

    return col * colorIntensity;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 screen = (uv - vec2(0.5)) * vec2(aspect, 1.0);

    float t = TIME * flySpeed;

    // Camera: fly forward along Z
    vec3 camPos = vec3(0.0, 2.5 + sin(t * 0.3) * 0.3, t * 5.0);
    vec3 lookAt = camPos + vec3(0.0, -0.5, 5.0);

    // Camera matrix
    vec3 fwd = normalize(lookAt - camPos);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);

    vec3 rd = normalize(fwd + screen.x * right * 1.2 + screen.y * up * 1.2);

    // Fog color
    float bassE = max(audioBass, 0.2);
    vec3 fogCol = mix(vec3(0.02, 0.03, 0.06), vec3(0.04, 0.06, 0.1), bassE);

    // Raymarch terrain
    float dist2 = 0.0;
    vec3 col = fogCol;
    bool hit = false;
    vec3 hitPos;

    // Step along ray
    for (int i = 0; i < 80; i++) {
        vec3 p = camPos + rd * dist2;
        float h = terrainH(p.xz);
        float d = p.y - h;

        if (d < 0.02) {
            // Hit terrain - refine
            dist2 -= 0.5 * d;
            hitPos = camPos + rd * dist2;
            hit = true;
            break;
        }

        // Adaptive step size
        dist2 += max(d * 0.5, 0.1);

        if (dist2 > 60.0) break;
    }

    if (hit) {
        float h = terrainH(hitPos.xz);
        vec3 n = terrainNormal(hitPos.xz);

        // Lighting
        vec3 lightDir = normalize(vec3(0.5, 0.8, 0.3));
        float diff = max(dot(n, lightDir), 0.0);
        float ambient = 0.2;

        vec3 tCol = terrainColor(h);
        col = tCol * (ambient + diff * 0.8);

        // Specular highlight
        vec3 halfDir = normalize(lightDir - rd);
        float spec = pow(max(dot(n, halfDir), 0.0), 32.0);
        col += vec3(0.5, 0.4, 0.3) * spec * 0.3;

        // Wireframe grid overlay
        if (gridGlow > 0.01) {
            vec2 gp = hitPos.xz;
            float gridScale = 1.0;
            vec2 gridFrac = fract(gp * gridScale);
            float gx = smoothstep(0.02, 0.0, gridFrac.x) + smoothstep(0.98, 1.0, gridFrac.x);
            float gz = smoothstep(0.02, 0.0, gridFrac.y) + smoothstep(0.98, 1.0, gridFrac.y);
            float gridLine = clamp(gx + gz, 0.0, 1.0);

            // Grid color: bright cyan-ish glow
            float beat = max(audioBeat, 0.0);
            vec3 gridCol = vec3(0.2, 0.6, 0.9) * (1.0 + beat * 0.5);
            col += gridCol * gridLine * gridGlow;
        }

        // Beat flash on peaks
        float beat = max(audioBeat, 0.0);
        float peakGlow = smoothstep(terrainHeight * 0.5, terrainHeight, h);
        col += vec3(0.4, 0.3, 0.2) * beat * peakGlow * 0.4;

        // Distance fog
        float fog = 1.0 - exp(-dist2 * fogDensity);
        col = mix(col, fogCol, fog);
    }

    // Sky gradient for misses
    if (!hit) {
        float skyGrad = clamp(rd.y * 2.0 + 0.3, 0.0, 1.0);
        col = mix(fogCol, vec3(0.01, 0.01, 0.03), skyGrad);
    }

    // Vignette
    vec2 vc = uv - vec2(0.5);
    float vig = 1.0 - dot(vc, vc) * 0.8;
    col *= vig;

    // Tone map
    col = col / (1.0 + col);

    gl_FragColor = vec4(col, 1.0);
}
