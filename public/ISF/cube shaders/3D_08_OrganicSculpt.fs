/*{
    "DESCRIPTION": "Organic blobby sculpture with FBM noise displacement creating coral/brain-like surface",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D SDF"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "camDist", "TYPE": "float", "DEFAULT": 3.5, "MIN": 1.5, "MAX": 7.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "deformation", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "complexity", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.0, "MAX": 6.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

// 3D noise
float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n = dot(i, vec3(1.0, 57.0, 113.0));
    return mix(
        mix(
            mix(fract(sin(n) * 43758.5), fract(sin(n + 1.0) * 43758.5), f.x),
            mix(fract(sin(n + 57.0) * 43758.5), fract(sin(n + 58.0) * 43758.5), f.x),
            f.y
        ),
        mix(
            mix(fract(sin(n + 113.0) * 43758.5), fract(sin(n + 114.0) * 43758.5), f.x),
            mix(fract(sin(n + 170.0) * 43758.5), fract(sin(n + 171.0) * 43758.5), f.x),
            f.y
        ),
        f.z
    );
}

// Multi-octave FBM with controllable complexity
float fbm(vec3 p, float t, int octaves) {
    float val = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    vec3 shift = vec3(t * 0.15, t * 0.1, t * 0.12);
    // Unrolled loop with max 6 octaves, using complexity to blend
    for (int i = 0; i < 6; i++) {
        if (float(i) >= complexity) break;
        val += amp * (noise3(p * freq + shift) - 0.5) * 2.0;
        shift = shift * 1.3 + vec3(7.3, 2.1, 5.7);
        freq *= 2.03;
        amp *= 0.48;
    }
    return val;
}

// The organic sculpt SDF
float mapScene(vec3 p, float t, float bassAmt) {
    float r = length(p);

    // Base sphere
    float sphere = r - 1.2;

    // Direction for noise lookup
    vec3 dir = normalize(p + vec3(0.0001));

    // FBM displacement on the sphere surface
    float deformAmt = deformation * (1.0 + bassAmt * 0.8);
    float disp = fbm(dir * 2.5 + vec3(t * 0.1), t, 6) * deformAmt;

    // Second layer of larger deformation (was 4 octaves → 2; it's already modulated by the primary fbm above).
    float disp2 = fbm(dir * 1.2 + vec3(0.0, t * 0.07, 0.0), t * 0.5, 2) * deformAmt * 0.5;

    // Combine
    float d = sphere - disp - disp2;

    // Slight bulge at bottom (organic weight)
    d -= smoothstep(0.0, -1.5, p.y) * 0.15;

    return d;
}

vec3 calcNormal(vec3 p, float t, float bass) {
    vec2 e = vec2(0.002, 0.0);
    return normalize(vec3(
        mapScene(p + e.xyy, t, bass) - mapScene(p - e.xyy, t, bass),
        mapScene(p + e.yxy, t, bass) - mapScene(p - e.yxy, t, bass),
        mapScene(p + e.yyx, t, bass) - mapScene(p - e.yyx, t, bass)
    ));
}

// Ambient occlusion approximation
float calcAO(vec3 p, vec3 n, float t, float bass) {
    float ao = 0.0;
    float scale = 1.0;
    for (int i = 0; i < 5; i++) {
        float fi = float(i);
        float dist = 0.02 + fi * 0.06;
        float d = mapScene(p + n * dist, t, bass);
        ao += (dist - d) * scale;
        scale *= 0.65;
    }
    return clamp(1.0 - ao * 3.0, 0.0, 1.0);
}

// HSV to RGB
vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / min(RENDERSIZE.x, RENDERSIZE.y);
    float t = TIME * speed;
    float bass = audioBass;

    // Camera orbit slowly
    float ca = t * 0.2;
    float camY = 0.8 + sin(t * 0.13) * 0.5;
    vec3 ro = vec3(sin(ca) * camDist, camY, cos(ca) * camDist);
    vec3 ta = vec3(0.0, 0.0, 0.0);
    vec3 ww = normalize(ta - ro);
    vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
    vec3 vv = cross(uu, ww);
    vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.6 * ww);

    // Ray march
    float totalDist = 0.0;
    float hit = -1.0;
    vec3 p;
    for (int i = 0; i < 96; i++) {
        p = ro + rd * totalDist;
        float d = mapScene(p, t, bass);
        if (d < 0.001) { hit = 1.0; break; }
        if (totalDist > 15.0) break;
        totalDist += d * 0.7; // slow step for detailed surface
    }

    vec3 col = vec3(0.02, 0.015, 0.03); // dark background

    if (hit > 0.0) {
        vec3 n = calcNormal(p, t, bass);
        float ao = calcAO(p, n, t, bass);

        // Lighting
        vec3 lightDir1 = normalize(vec3(2.0, 3.0, 1.0));
        vec3 lightDir2 = normalize(vec3(-1.5, 1.0, -2.0));
        vec3 rimDir = normalize(ro - p);

        float diff1 = max(dot(n, lightDir1), 0.0);
        float diff2 = max(dot(n, lightDir2), 0.0);

        // Specular
        vec3 halfDir = normalize(lightDir1 - rd);
        float spec = pow(max(dot(n, halfDir), 0.0), 24.0);

        // Rim lighting
        float rim = pow(1.0 - max(dot(n, -rd), 0.0), 4.0);

        // Position-based coloring: green/purple/teal
        float hue1 = fract(0.45 + p.y * 0.1 + colorShift / 6.28); // green base
        float hue2 = fract(0.8 + p.x * 0.08 + colorShift / 6.28); // purple accents
        float hue3 = fract(0.5 + (p.z + p.y) * 0.06 + colorShift / 6.28); // teal

        vec3 col1 = hsv2rgb(vec3(hue1, 0.65, 0.85)); // green
        vec3 col2 = hsv2rgb(vec3(hue2, 0.6, 0.7));  // purple
        vec3 col3 = hsv2rgb(vec3(hue3, 0.5, 0.9));  // teal

        // Mix colors based on normal direction and position
        float nmix = dot(n, vec3(0.0, 1.0, 0.0)) * 0.5 + 0.5;
        float pmix = sin(p.x * 2.0 + p.z * 1.5 + t * 0.3) * 0.5 + 0.5;
        vec3 baseColor = mix(mix(col1, col2, nmix), col3, pmix * 0.4);

        // Compose
        col = baseColor * (diff1 * 0.6 + diff2 * 0.25 + 0.2);
        col *= ao;
        col += vec3(0.95, 0.9, 1.0) * spec * 0.5;
        col += vec3(0.4, 0.6, 0.9) * rim * 0.35; // blue rim light
        col += vec3(0.6, 0.2, 0.5) * rim * 0.15; // subtle purple rim

        col *= intensity;

        // Distance fade
        float fog = exp(-totalDist * 0.06);
        col = mix(vec3(0.02, 0.015, 0.03), col, fog);
    }

    // Vignette
    vec2 vuv = gl_FragCoord.xy / RENDERSIZE;
    float vig = 1.0 - 0.3 * length((vuv - 0.5) * 1.5);
    col *= vig;

    // Tone mapping
    col = col / (col + vec3(1.0));
    col = pow(col, vec3(0.88));

    gl_FragColor = vec4(col, 1.0);
}
