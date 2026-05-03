/*{
    "DESCRIPTION": "Abstract cylindrical pillars at various heights with dramatic shadows, architectural monumental feel, audio-reactive pillar heights",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D SDF"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "camDist", "TYPE": "float", "DEFAULT": 8.0, "MIN": 3.0, "MAX": 20.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "pillarHeight", "TYPE": "float", "DEFAULT": 2.0, "MIN": 0.5, "MAX": 6.0},
        {"NAME": "pillarDensity", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.0, "MAX": 6.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

// --- Hash ---
float hash21(vec2 p) {
    p = fract(p * vec2(443.897, 441.423));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
}

float hash31(vec3 p) {
    p = fract(p * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
}

// --- Capped cylinder SDF ---
float sdCylinder(vec3 p, float r, float h) {
    vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

// --- Ground plane SDF ---
float sdPlane(vec3 p) {
    return p.y;
}

// --- Scene: pillar field with ground ---
vec3 gPillarId;
float gHitGround;

float map(vec3 p) {
    float t = TIME * speed;
    float beatPulse = 1.0 + audioBeat * 0.6 * intensity;

    // Ground plane
    float ground = sdPlane(p);
    float d = ground;
    gHitGround = 1.0;
    gPillarId = vec3(0.0);

    // Grid of pillars using domain repetition
    float sp = pillarDensity;
    vec2 cellId = floor(p.xz / sp + 0.5);
    vec2 cellCenter = cellId * sp;

    // Check nearest cells (3x3 neighborhood for proper SDF)
    for (int ix = -1; ix <= 1; ix++) {
        for (int iz = -1; iz <= 1; iz++) {
            vec2 cid = cellId + vec2(float(ix), float(iz));
            vec2 cc = cid * sp;

            // Pseudo-random pillar properties per cell
            float h1 = hash21(cid);
            float h2 = hash21(cid + 100.0);
            float h3 = hash21(cid + 200.0);

            // Skip some cells for variation (about 30% empty)
            if (h1 < 0.3) continue;

            // Pillar height with variation and beat response
            float ph = pillarHeight * (0.3 + h1 * 1.2) * beatPulse;

            // Pillar radius: some thick, some thin
            float pr = 0.15 + h2 * 0.35;

            // Slight position jitter within cell
            vec2 jitter = (vec2(h2, h3) - 0.5) * sp * 0.3;

            vec3 pillarP = vec3(p.x - cc.x - jitter.x, p.y, p.z - cc.y - jitter.y);
            float pd = sdCylinder(pillarP - vec3(0.0, ph, 0.0), pr, ph);

            if (pd < d) {
                d = pd;
                gPillarId = vec3(cid, h1);
                gHitGround = 0.0;
            }
        }
    }

    return d;
}

// --- Normal ---
vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.002, 0.0);
    return normalize(vec3(
        map(p + e.xyy) - map(p - e.xyy),
        map(p + e.yxy) - map(p - e.yxy),
        map(p + e.yyx) - map(p - e.yyx)
    ));
}

// --- Soft shadow ---
float softShadow(vec3 ro, vec3 rd, float mint, float maxt, float k) {
    float res = 1.0;
    float t2 = mint;
    for (int i = 0; i < 40; i++) {
        if (t2 > maxt) break;
        float d = map(ro + rd * t2);
        if (d < 0.001) return 0.0;
        res = min(res, k * d / t2);
        t2 += clamp(d, 0.02, 0.5);
    }
    return clamp(res, 0.0, 1.0);
}

// --- Ambient Occlusion ---
float calcAO(vec3 p, vec3 n) {
    float ao = 0.0;
    float scale = 1.0;
    for (int i = 0; i < 5; i++) {
        float fi = float(i);
        float h = 0.01 + 0.12 * fi;
        float d = map(p + n * h);
        ao += (h - d) * scale;
        scale *= 0.65;
    }
    return clamp(1.0 - 2.0 * ao, 0.0, 1.0);
}

// --- Concrete/stone color ---
vec3 concreteColor(vec3 p, float id, float shift) {
    // Base concrete grey with subtle variation
    float noise = fract(sin(dot(p.xz * 5.0, vec2(12.9898, 78.233))) * 43758.5453);
    vec3 base = vec3(0.55, 0.52, 0.48) + noise * 0.06;

    // Slight warm/cool tint per pillar
    float cs = cos(shift + id * 3.14);
    float ss = sin(shift + id * 3.14);
    base.r += cs * 0.03;
    base.b += ss * 0.03;

    return clamp(base, 0.0, 1.0);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * speed;

    // Camera at eye level, slowly orbiting
    float camAngle = t * 0.2;
    float camY = 1.5 + sin(t * 0.1) * 0.5;
    vec3 ro = vec3(
        cos(camAngle) * camDist,
        camY,
        sin(camAngle) * camDist
    );
    vec3 target = vec3(0.0, pillarHeight * 0.4, 0.0);

    vec3 fwd = normalize(target - ro);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    vec3 rd = normalize(fwd + uv.x * right + uv.y * up);

    // Sky background - dramatic gradient
    vec3 skyTop = vec3(0.55, 0.6, 0.75);
    vec3 skyHorizon = vec3(0.85, 0.78, 0.65);
    float skyT = clamp(rd.y * 2.0 + 0.3, 0.0, 1.0);
    vec3 bgColor = mix(skyHorizon, skyTop, skyT);

    vec3 col = bgColor;

    // Strong directional light (sun angle)
    vec3 lightDir = normalize(vec3(1.5, 3.0, 0.8));

    // Ray march
    float dist = 0.0;
    bool hit = false;
    for (int i = 0; i < 100; i++) {
        vec3 p = ro + rd * dist;
        float d = map(p);
        if (d < 0.001) {
            hit = true;
            break;
        }
        if (dist > 50.0) break;
        dist += d;
    }

    if (hit) {
        vec3 p = ro + rd * dist;
        map(p);  // re-eval for globals
        float isGround = gHitGround;
        vec3 pid = gPillarId;

        vec3 n = calcNormal(p);
        float ao = calcAO(p, n);

        // Material color
        vec3 matCol;
        if (isGround > 0.5) {
            // Ground: darker stone
            float noise = fract(sin(dot(p.xz * 2.0, vec2(12.9898, 78.233))) * 43758.5453);
            matCol = vec3(0.35, 0.33, 0.3) + noise * 0.05;
        } else {
            matCol = concreteColor(p, pid.z, colorShift);
        }

        // Diffuse lighting
        float diff = max(dot(n, lightDir), 0.0);

        // Shadows
        float shadow = softShadow(p + n * 0.01, lightDir, 0.02, 25.0, 8.0);

        // Secondary fill light
        vec3 fillDir = normalize(vec3(-1.0, 0.5, -1.0));
        float fill = max(dot(n, fillDir), 0.0) * 0.2;

        float ambient = 0.12;
        float lighting = ambient + (diff * shadow * 0.75 + fill) * ao;

        // Subtle specular for wet look
        vec3 halfDir = normalize(lightDir - rd);
        float spec = pow(max(dot(n, halfDir), 0.0), 32.0) * 0.2 * shadow;

        col = matCol * lighting * intensity + vec3(spec);

        // Height-based darkening at pillar bases
        if (isGround < 0.5) {
            float heightFade = smoothstep(0.0, 0.5, p.y);
            col *= 0.7 + 0.3 * heightFade;
        }

        // Distance fog
        float fog = 1.0 - exp(-0.002 * dist * dist);
        col = mix(col, bgColor, fog);
    }

    // Vignette
    float vignette = 1.0 - 0.3 * length(uv) * (1.0 + audioBass * 0.3);
    col *= vignette;

    // Slight warm tone
    col = pow(col, vec3(0.95, 1.0, 1.05));

    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
