/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A picture frame holding a smaller frame holding a smaller frame, over and over, each one turned a little further than the last so the stack winds into a spiral. Light glints along the bevelled edges and a bright band runs down through the frames with the beat. Each hit whips the whole stack round, the deepest frames swinging furthest, and lights the frames up; a held sound slowly winds the spiral tighter.",
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "twist", "LABEL": "Twist", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "whip", "LABEL": "Whip", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "depth", "LABEL": "Depth", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "frameWidth", "LABEL": "Frame width", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "sides", "LABEL": "Shape", "TYPE": "long", "DEFAULT": 4, "VALUES": [3, 4, 5, 6, 8], "LABELS": ["Triangle", "Square", "Pentagon", "Hexagon", "Octagon"] },
        { "NAME": "size", "LABEL": "Size", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Frames", "TYPE": "color", "DEFAULT": [0.95, 0.7, 0.25, 1.0] },
        { "NAME": "accent", "LABEL": "Alternate frames", "TYPE": "color", "DEFAULT": [0.6, 0.2, 0.95, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxBeat", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const float TAU = 6.2831853;
const float PI = 3.14159265;
const int LEVELS = 18;

vec3 hueShift(vec3 c, float a) {
    vec3 k = vec3(0.57735);
    float ca = cos(a);
    return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// Regular polygon of circumradius r turned by ang: signed distance to its
// edges (negative inside) and the angle of the nearest edge's normal.
vec2 ngon(float pa, float pr, float r, float n, float ang) {
    float an = PI / n;
    float a = pa - ang;
    float sector = floor((a + an) / (2.0 * an));
    float bn = a - sector * 2.0 * an;
    float d = pr * cos(bn) - r * cos(an);
    return vec2(d, sector * 2.0 * an + ang);
}

void main() {
    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float px = 1.0 / RENDERSIZE.y;
    float hit = clamp(vxHit, 0.0, 1.0);
    float env = clamp(vxEnv, 0.0, 1.0);
    float kick = hit * (0.5 + 0.5 * vxVel);
    float t = vxPhase + TIME * 0.12;
    float n = float(sides);

    float R0 = mix(0.34, 0.52, size) * (1.0 + 0.035 * kick);
    float ratio = mix(0.9, 0.78, depth);
    float tw = mix(0.0, 0.22, twist) * (1.0 + 0.5 * env) + 0.04 * sin(t * 0.23);
    float base = t * 0.08;
    float fw = mix(0.12, 0.6, frameWidth);
    float beatPos = fract(vxBeat + TIME * 0.0) * float(LEVELS) * 0.7;

    vec3 c1 = ink.rgb;
    vec3 c2 = accent.rgb;
    vec3 L = normalize(vec3(cos(t * 0.3 + 2.2), sin(t * 0.3 + 2.2), 0.9));

    float pAng = atan(p.y, p.x);
    float pRad = length(p);
    float cosAn = cos(PI / n);
    // Painter's order: each deeper frame lies on top of the one before.
    vec4 S = vec4(0.0);
    float shadowPrev = 0.0;
    float outerD = 1e3;
    float r = R0;
    for (int i = 0; i < LEVELS; i++) {
        float fi = float(i);
        float ang = base + fi * tw + kick * whip * 0.5 * fi / float(LEVELS) * fi * 0.15
                  + 0.06 * whip * sin(t * 0.7 - fi * 0.45);
        vec2 g = ngon(pAng, pRad, r, n, ang);
        float d = g.x;
        if (i == 0) outerD = d;
        float cover = 1.0 - smoothstep(-px, px, d);
        // Drop shadow this plate casts on what is below.
        float sh = (1.0 - smoothstep(-0.004, 0.025 * r / R0 + 0.006, d - 0.006)) * 0.55;
        S.rgb *= 1.0 - sh * (1.0 - cover);

        if (cover > 0.0) {
            // Bevelled frame band, then a recessed matte inside it.
            float w = r * cosAn * (1.0 - ratio) * fw + 1.5 * px;
            float inBand = 1.0 - smoothstep(-w - px, -w + px, d);
            float u = clamp(-d / w, 0.0, 1.0);           // 0 outer edge, 1 inner edge
            // Bevel: outer half faces out, inner half faces in.
            float slope = u < 0.5 ? 1.0 : -1.0;
            vec3 nrm = normalize(vec3(cos(g.y) * slope * 0.8, sin(g.y) * slope * 0.8, 1.0));
            float lam = max(dot(nrm, L), 0.0);
            float spec = pow(lam, 24.0);
            vec3 fc = mod(fi, 2.0) < 0.5 ? c1 : c2;
            fc = hueShift(fc, (vxGlide - 0.5) * fi * 0.12);
            float pulse = exp(-pow(fi - beatPos, 2.0) * 0.6) * (0.35 + 0.65 * env);
            float idle = 0.5 + 0.5 * sin(fi * 0.9 - TIME * 1.5);
            vec3 frameC = fc * (0.25 + 0.85 * lam) + vec3(1.0) * spec * 0.6;
            frameC *= 1.0 + 0.6 * pulse + 0.15 * idle + 0.9 * kick * (0.4 + 0.6 * fi / float(LEVELS));
            // Fine gilt line at the middle of the bevel.
            frameC += mix(fc, vec3(1.0), 0.5) * (1.0 - smoothstep(0.0, 0.08, abs(u - 0.5))) * 0.35;
            vec3 matte = mix(fc, c1 * 0.5 + c2 * 0.5, 0.5) * 0.12 * (0.7 + 0.3 * u);
            vec3 plate = mix(matte, frameC, inBand);
            S = vec4(plate, 1.0) * cover + S * (1.0 - cover);
        }
        r *= ratio;
    }

    // The innermost: a bright jewel.
    float rj = r * 1.4;
    float jd = length(p) - rj;
    float jewel = 1.0 - smoothstep(-px, px, jd);
    vec3 jc = mix(c2, vec3(1.0), 0.4) * (1.0 + 1.5 * kick + 0.5 * env);
    S.rgb = mix(S.rgb, jc, jewel);
    S.rgb += mix(c1, c2, 0.5) * exp(-max(jd, 0.0) / (0.01 + 0.02 * kick)) * 0.6 * (1.0 - jewel);

    // Outer glow and a soft shadow so the stack sits on whatever is below.
    float og = exp(-max(outerD, 0.0) / (0.02 + 0.03 * kick)) * (1.0 - smoothstep(-px, px, -outerD));
    vec4 glowL = vec4(mix(c1, c2, 0.5) * og * 0.6, og * 0.6);
    float shOut = (1.0 - smoothstep(-0.01, 0.06, outerD - 0.012)) * 0.45 * (1.0 - smoothstep(-px, px, -outerD));
    vec4 under = glowL + vec4(0.0, 0.0, 0.0, shOut) * (1.0 - glowL.a);
    S = S + under * (1.0 - S.a);
    S.a = clamp(max(S.a, max(S.r, max(S.g, S.b))), 0.0, 1.0);
    S.rgb = min(S.rgb, vec3(S.a));

    // Opaque background: dark wall with a faint echo of the frames.
    vec2 bgp = ngon(pAng, pRad, R0 * 1.4, n, base);
    float echo = 0.5 + 0.5 * cos(bgp.x * 40.0 - t * 0.8);
    vec3 bg = mix(c1, c2, 0.5) * (0.02 + 0.02 * echo * exp(-max(bgp.x, 0.0) * 4.0));
    bg += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;

    vec4 outc = vxClear ? S : vec4(S.rgb + max(bg, 0.0) * (1.0 - S.a), 1.0);
    gl_FragColor = outc * vxPresence;
}
