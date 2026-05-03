/*{
    "DESCRIPTION": "Glowing neon wireframe cubes floating in dark space with bloom-like glow accumulation",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D SDF"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.5, "MIN": 0.2, "MAX": 4.0},
        {"NAME": "camDist", "TYPE": "float", "DEFAULT": 5.0, "MIN": 2.0, "MAX": 12.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "glowRadius", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.02, "MAX": 0.5},
        {"NAME": "cubeScale", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0.2, "MAX": 2.0}
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

float hash11(float p) {
    return fract(sin(p * 127.1) * 43758.5453);
}

// --- Rotation ---
vec3 rotY(vec3 p, float a) {
    float c = cos(a); float s = sin(a);
    return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

vec3 rotX(vec3 p, float a) {
    float c = cos(a); float s = sin(a);
    return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}

vec3 rotZ(vec3 p, float a) {
    float c = cos(a); float s = sin(a);
    return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
}

// --- SDF: Box Frame (wireframe cube) ---
float sdBoxFrame(vec3 p, vec3 b, float e) {
    p = abs(p) - b;
    vec3 q = abs(p + e) - e;
    return min(min(
        length(max(vec3(p.x, q.y, q.z), 0.0)) + min(max(p.x, max(q.y, q.z)), 0.0),
        length(max(vec3(q.x, p.y, q.z), 0.0)) + min(max(q.x, max(p.y, q.z)), 0.0)),
        length(max(vec3(q.x, q.y, p.z), 0.0)) + min(max(q.x, max(q.y, p.z)), 0.0));
}

// --- Neon cube data ---
// 9 cubes with different positions, sizes, rotations, colors

vec3 cubePos(int idx, float t) {
    float fi = float(idx);
    float a = fi * 0.7 + t * (0.15 + fi * 0.05);
    float r = 1.5 + fi * 0.4;
    float h = sin(fi * 1.3 + t * 0.25) * 2.0;

    vec3 base;
    if (idx == 0) base = vec3(0.0, 0.0, 0.0);
    else if (idx == 1) base = vec3(cos(a) * 2.5, h * 0.5, sin(a) * 2.5);
    else if (idx == 2) base = vec3(sin(a * 0.7) * 3.0, h * 0.7 + 1.0, cos(a * 0.8) * 2.0);
    else if (idx == 3) base = vec3(-2.0, sin(t * 0.3 + fi) * 1.5, cos(a) * 2.5);
    else if (idx == 4) base = vec3(cos(a * 0.5) * 3.5, h * 0.3 - 1.0, sin(a * 0.6) * 3.5);
    else if (idx == 5) base = vec3(sin(a * 0.9) * 1.8, 2.0 + sin(t * 0.2) * 0.5, -2.5);
    else if (idx == 6) base = vec3(-3.0, h * 0.4, sin(a * 0.4) * 2.0);
    else if (idx == 7) base = vec3(2.5, -1.5 + sin(t * 0.35 + 2.0) * 0.8, cos(a * 0.3) * 3.0);
    else base = vec3(cos(a * 0.6) * 4.0, h * 0.2, sin(a * 0.7) * 1.5);

    // Audio beat pushes outward
    base *= 1.0 + audioBeat * 0.1;

    return base;
}

float cubeSz(int idx) {
    float fi = float(idx);
    if (idx == 0) return 1.0;  // central large cube
    return 0.4 + hash11(fi * 7.3) * 0.6;
}

// Neon colors: cyan, magenta, yellow, green
vec3 cubeColor(int idx, float shift) {
    float fi = float(idx);
    float phase = mod(fi + shift / 1.57, 4.0);
    vec3 col;
    if (phase < 1.0) {
        col = vec3(0.0, 0.9, 1.0);    // cyan
    } else if (phase < 2.0) {
        col = vec3(1.0, 0.1, 0.7);    // magenta
    } else if (phase < 3.0) {
        col = vec3(1.0, 0.95, 0.1);   // yellow
    } else {
        col = vec3(0.1, 1.0, 0.3);    // green
    }
    return col;
}

// --- Scene: minimum distance to any wireframe cube ---
int gHitCube;

float map(vec3 p, float t) {
    float d = 1e10;
    gHitCube = 0;

    for (int i = 0; i < 9; i++) {
        vec3 cp = cubePos(i, t);
        float sz = cubeSz(i) * cubeScale;
        vec3 lp = p - cp;

        // Per-cube rotation
        float fi = float(i);
        float ra = fi * 1.1 + t * (0.2 + fi * 0.06);
        float rb = fi * 0.7 + t * (0.15 + fi * 0.04);
        lp = rotY(lp, ra);
        lp = rotX(lp, rb);

        // Audio-reactive size pulse
        float beatSz = 1.0 + audioBass * 0.1;
        sz *= beatSz;

        float edgeThick = sz * 0.06;
        float sd = sdBoxFrame(lp, vec3(sz), edgeThick);

        if (sd < d) {
            d = sd;
            gHitCube = i;
        }
    }

    return d;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * speed;

    // Camera orbit
    float camAngle = t * 0.25;
    vec3 ro = vec3(
        cos(camAngle) * camDist,
        1.5 + sin(t * 0.18) * 1.0,
        sin(camAngle) * camDist
    );
    vec3 target = vec3(0.0, 0.0, 0.0);

    vec3 fwd = normalize(target - ro);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    vec3 rd = normalize(fwd + uv.x * right + uv.y * up);

    // Black background
    vec3 col = vec3(0.0);

    // === Glow accumulation ray march ===
    // Instead of just finding the surface, we accumulate glow based on proximity
    float dist = 0.0;
    vec3 glowAccum = vec3(0.0);
    float hitDist = -1.0;
    int hitCube = -1;

    for (int i = 0; i < 64; i++) {
        vec3 p = ro + rd * dist;
        float d = map(p, t);
        int curCube = gHitCube;

        // Glow accumulation: inverse distance falloff
        float glowAmt = glowRadius / (abs(d) + glowRadius * 0.5);
        glowAmt *= glowAmt; // quadratic falloff for sharper glow
        vec3 neonCol = cubeColor(curCube, colorShift);

        // Audio reactivity on glow
        float audioBoost = 1.0 + audioHigh * 0.3 + audioMid * 0.2;
        glowAccum += neonCol * glowAmt * 0.04 * audioBoost;

        if (d < 0.002) {
            hitDist = dist;
            hitCube = curCube;
            break;
        }
        if (dist > 30.0) break;

        // Step carefully near surfaces for better glow
        dist += max(d * 0.7, 0.01);
    }

    // Apply glow
    col += glowAccum * intensity;

    // If we hit a surface, add bright core
    if (hitDist > 0.0) {
        vec3 neonCol = cubeColor(hitCube, colorShift);

        // Bright neon core
        col += neonCol * 2.0 * intensity;

        // Normal for subtle shading
        vec3 p = ro + rd * hitDist;
        vec2 e = vec2(0.002, 0.0);
        vec3 n = normalize(vec3(
            map(p + e.xyy, t) - map(p - e.xyy, t),
            map(p + e.yxy, t) - map(p - e.yxy, t),
            map(p + e.yyx, t) - map(p - e.yyx, t)
        ));

        // Fresnel-like edge brightness
        float fresnel = pow(1.0 - abs(dot(-rd, n)), 2.0);
        col += neonCol * fresnel * 0.8;

        // Distance fade
        float fade = exp(-0.04 * hitDist * hitDist);
        col *= fade;
    }

    // Subtle background glow from audio
    col += vec3(0.02, 0.01, 0.04) * audioBass * 0.5;

    // Vignette
    float vig = 1.0 - 0.3 * length(uv);
    col *= vig;

    // Tone mapping: soft clamp for bloom feel
    col = col / (col + vec3(1.0));
    col = pow(col, vec3(0.9)); // slight gamma lift for glow

    gl_FragColor = vec4(col, 1.0);
}
