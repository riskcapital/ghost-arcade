/*{
    "DESCRIPTION": "Dark liquid chrome — molten obsidian with studio speculars and anisotropic streak lighting. Bass swells the waves; mids drive the current.",
    "CREDIT": "Ghost Arcade LIVE pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "flowSpeed", "TYPE": "float", "DEFAULT": 0.4,  "MIN": 0.0, "MAX": 1.5},
        {"NAME": "scale",     "TYPE": "float", "DEFAULT": 3.0,  "MIN": 1.0, "MAX": 8.0},
        {"NAME": "gloss",     "TYPE": "float", "DEFAULT": 0.75, "MIN": 0.1, "MAX": 1.0},
        {"NAME": "tint",      "TYPE": "float", "DEFAULT": 0.6,  "MIN": 0.0, "MAX": 1.0},
        {"NAME": "relief",    "TYPE": "float", "DEFAULT": 0.6,  "MIN": 0.1, "MAX": 1.2}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash2(i).x;
    float b = hash2(i + vec2(1.0, 0.0)).x;
    float c = hash2(i + vec2(0.0, 1.0)).x;
    float d = hash2(i + vec2(1.0, 1.0)).x;
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float heightField(vec2 p, float t, float amp) {
    // Domain-warped fbm: two warp passes give the molten folding look.
    vec2 q = vec2(vnoise(p + vec2(0.0, t * 0.7)), vnoise(p + vec2(5.2, 1.3) - t * 0.4));
    vec2 r = vec2(vnoise(p + 3.6 * q + vec2(1.7, 9.2) + t * 0.3),
                  vnoise(p + 3.6 * q + vec2(8.3, 2.8) - t * 0.2));
    float h = 0.0;
    float a = 0.5;
    vec2 pp = p + 2.6 * r;
    for (int i = 0; i < 4; i++) {
        h += a * vnoise(pp);
        pp = pp * 2.03 + vec2(3.1, 1.7);
        a *= 0.5;
    }
    return h * amp;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;

    float bass = max(audioBass, 0.3 + 0.15 * sin(TIME * 0.37));
    float mid = max(audioMid, 0.25 + 0.1 * sin(TIME * 0.53));
    float centroid = max(audioSpectralCentroid, 0.5);

    float t = TIME * flowSpeed * (0.7 + mid * 0.6);
    vec2 p = uv * scale;
    float amp = relief * (0.75 + bass * 0.6);

    // Height + screen-space normal from central differences.
    float e = 0.02;
    float h  = heightField(p, t, amp);
    float hx = heightField(p + vec2(e, 0.0), t, amp);
    float hy = heightField(p + vec2(0.0, e), t, amp);
    vec3 n = normalize(vec3((h - hx) / e, (h - hy) / e, 1.6));

    vec3 viewDir = normalize(vec3(-uv * 0.4, 1.0));

    // Two studio key lights + a cool rim.
    vec3 l1 = normalize(vec3(0.6, 0.7, 0.5));
    vec3 l2 = normalize(vec3(-0.7, -0.3, 0.45));
    vec3 l3 = normalize(vec3(0.1, -0.8, 0.3));

    float d1 = max(dot(n, l1), 0.0);
    float d2 = max(dot(n, l2), 0.0);
    float d3 = max(dot(n, l3), 0.0);

    // Blinn speculars — tight for chrome, plus a stretched anisotropic streak.
    float shininess = mix(24.0, 220.0, gloss);
    vec3 h1 = normalize(l1 + viewDir);
    vec3 h2 = normalize(l2 + viewDir);
    float s1 = pow(max(dot(n, h1), 0.0), shininess);
    float s2 = pow(max(dot(n, h2), 0.0), shininess * 0.6);
    // Anisotropy: collapse the normal's x before the streak highlight.
    vec3 nA = normalize(vec3(n.x * 0.15, n.y, n.z));
    float streak = pow(max(dot(nA, h1), 0.0), shininess * 2.2) * 1.6;

    // Fresnel-ish environment: dark obsidian body, tinted sky at grazing angles.
    float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
    vec3 bodyCol = mix(vec3(0.015, 0.014, 0.02), vec3(0.05, 0.03, 0.09), tint * h);
    vec3 skyCol  = mix(vec3(0.35, 0.4, 0.55), vec3(0.65, 0.35, 0.75), tint * centroid);

    vec3 col = bodyCol;
    col += vec3(0.9, 0.88, 0.95) * d1 * 0.10;
    col += vec3(0.4, 0.45, 0.7) * d2 * 0.06;
    col += vec3(0.5, 0.3, 0.6) * d3 * 0.05 * tint;
    col += skyCol * fres * 0.55;
    col += vec3(1.0) * (s1 + s2 * 0.5 + streak) * gloss;

    // Depth cue: valleys sink into black.
    col *= 0.35 + 0.65 * smoothstep(0.0, 0.9, h + 0.35);

    col = col / (col + 0.9);
    col = pow(col, vec3(0.85));
    col += (fract(sin(dot(gl_FragCoord.xy + fract(TIME), vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;

    gl_FragColor = vec4(col, 1.0);
}
