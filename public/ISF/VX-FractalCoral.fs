/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A glowing fractal coral: each branch splits in two, again and again, swaying as if under water, with bright polyps at every tip. A held sound grows it new generations of branches and quickens the current; each hit flares the branches open, floods the tips with light and lets them sway back. It can grow up from the floor as a sea fan or out from the center as a round bloom.",
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 7, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "growth", "LABEL": "Growth", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "spread", "LABEL": "Spread", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "sway", "LABEL": "Sway", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "polyps", "LABEL": "Polyps", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "form", "LABEL": "Form", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1], "LABELS": ["Sea fan", "Bloom"] },
        { "NAME": "thickness", "LABEL": "Thickness", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Branches", "TYPE": "color", "DEFAULT": [1.0, 0.35, 0.45, 1.0] },
        { "NAME": "accent", "LABEL": "Tips", "TYPE": "color", "DEFAULT": [0.3, 1.0, 0.85, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const float TAU = 6.2831853;
const float PI = 3.14159265;
const int DEPTH = 10;

vec3 hueShift(vec3 c, float a) {
    vec3 k = vec3(0.57735);
    float ca = cos(a);
    return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

// The tree in local space: trunk from the origin up +y. Returns
// x = distance to the wood (world units), y = level of the nearest branch,
// z = distance to the nearest tip polyp, w = how far across the branch (0 core, 1 skin).
vec4 coral(vec2 q, float len, float wid, float levels, float open, float t, float swayAmt, float seed) {
    float s = 1.0;                // world units per local unit
    float d = 1e3;
    float lvl = 0.0;
    float tip = 1e3;
    float across = 1.0;
    const float ratio = 0.77;
    for (int i = 0; i < DEPTH; i++) {
        float fi = float(i);
        float grow = clamp(levels - fi, 0.0, 1.0);
        if (grow <= 0.0) break;
        float L = len * grow;
        // A tapering branch from (0,0) to (0,L).
        float h = clamp(q.y / max(L, 1e-4), 0.0, 1.0);
        float w = wid * mix(1.0, 0.78, h) * (0.55 + 0.45 * grow);
        float db = (length(vec2(q.x, q.y - L * h)) - w) * s;
        if (db < d) {
            d = db;
            lvl = fi + h;
            across = clamp(abs(q.x) / max(w, 1e-4), 0.0, 1.0);
        }
        if (grow < 1.0 || i == DEPTH - 1) {
            // Growing tip (or the last generation): a polyp.
            tip = min(tip, length(q - vec2(0.0, L)) * s);
            break;
        }
        // To the fork: bend with the current, fold into two children.
        q.y -= len;
        float bend = (hash11(fi * 7.31 + seed) - 0.5) * 0.5 + swayAmt * sin(t * 0.9 - fi * 0.8) * (0.5 + 0.2 * fi);
        q = rot(bend) * q;
        q.x = abs(q.x);
        q = rot(open * (1.0 - 0.03 * fi)) * q;
        q /= ratio;
        s *= ratio;
    }
    return vec4(d, lvl, tip, across);
}

void main() {
    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float px = 1.0 / RENDERSIZE.y;
    float env = clamp(vxSwell, 0.0, 1.0);
    float kick = clamp(vxPulse, 0.0, 1.0);
    // Sway, sap and drift all run on the flow clock: the music quickens the current.
    float t = vxFlow * 2.0;

    float levels = mix(4.0, 9.0, growth) + 1.8 * env;
    levels = min(levels, float(DEPTH));
    float open = mix(0.28, 0.62, spread) + 0.2 * kick + 0.06 * env + 0.04 * sin(t * 0.31) + 0.05 * (vxGlide - 0.5);
    float swayAmt = mix(0.0, 0.22, sway);
    float wid = mix(0.012, 0.034, thickness);

    vec2 q;
    float len;
    float scaleW = 1.0;
    bool bloom = form == 1;
    if (bloom) {
        // Six arms out from a small heart.
        float N = 6.0;
        float ang = atan(p.y, p.x) + t * 0.06;
        float sec = TAU / N;
        float a2 = mod(ang + 0.5 * sec, sec) - 0.5 * sec;
        float r = length(p);
        q = vec2(r * sin(a2), r * cos(a2) - 0.035);
        len = 0.105;
        scaleW = 0.8;
    } else {
        q = p - vec2(0.0, -0.53);
        len = 0.17;
    }
    vec4 cr = coral(q, len, wid * scaleW, levels, open, t, swayAmt, 3.0 + floor(vxGlide * 4.0) * 0.0);
    float d = cr.x;
    float lvl = cr.y;

    vec3 c1 = ink.rgb;
    vec3 c2 = accent.rgb;
    float gdepth = clamp(lvl / max(levels, 1.0), 0.0, 1.0);
    // Colour runs from the branches' ink at the base to the tips' colour.
    vec3 wood = mix(c1, mix(c1, c2, 0.6), smoothstep(0.3, 1.0, gdepth));
    wood = hueShift(wood, 0.55 * sin(lvl * 0.9 - t * 0.6));
    // Sap: bands of light flow up every branch, faster with the sound.
    float sapPh = fract(lvl * 0.8 - t * 0.6);
    float sap = smoothstep(0.0, 0.15, sapPh) * smoothstep(0.45, 0.15, sapPh);
    // Tube shading: bright core, darker skin.
    float tube = sqrt(max(1.0 - cr.w * cr.w, 0.0));
    vec3 woodC = wood * (0.3 + 0.6 * tube + 0.45 * sap * tube) + mix(wood, vec3(1.0), 0.6) * pow(tube, 8.0) * 0.4;
    // Hits flood the outer branches with light, fading as the pulse eases.
    float climb = kick * smoothstep(0.2, 1.0, gdepth);
    woodC += c2 * climb * 0.8 * tube;
    float woodA = 1.0 - smoothstep(-px, px, d);

    // Polyps at the tips.
    float pr = mix(0.0, 0.014, polyps) * (1.0 + 0.6 * kick + 0.25 * env) * scaleW;
    float tipD = cr.z - pr;
    float polA = (1.0 - smoothstep(-px, px, tipD)) * step(0.001, polyps);
    float tipGlow = 0.8 * exp(-max(tipD, 0.0) / (0.006 + 0.012 * kick + 0.006 * env)) * step(0.001, polyps);
    vec3 polC = mix(c2, vec3(1.0), 0.2 + 0.35 * kick);

    // Soft aura round the wood.
    float aura = exp(-max(d, 0.0) / (0.01 + 0.012 * env + 0.012 * kick)) * 0.35;
    vec3 auraC = mix(c1, c2, 0.5);

    vec4 S = vec4(auraC * aura, aura);
    S = vec4(woodC, 1.0) * woodA + S * (1.0 - woodA);
    S.rgb += polC * tipGlow * 0.8 * (1.0 - polA);
    S.a = max(S.a, tipGlow * 0.8);
    S = vec4(polC, 1.0) * polA + S * (1.0 - polA);
    S.a = clamp(max(S.a, max(S.r, max(S.g, S.b))), 0.0, 1.0);
    S.rgb = min(S.rgb, vec3(S.a));

    // Opaque background: deep water with drifting light.
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float shaft = 0.5 + 0.5 * sin(p.x * 9.0 + p.y * 3.0 + t * 0.4) * sin(p.x * 4.3 - t * 0.27);
    vec3 bg = mix(c1 * 0.015 + vec3(0.004, 0.01, 0.02), (c1 * 0.3 + c2 * 0.7) * 0.07, uv.y * (0.6 + 0.4 * shaft));
    if (bloom) bg = mix(c1 * 0.015 + vec3(0.005, 0.008, 0.02), (c1 + c2) * 0.05, exp(-length(p) * 2.5));
    bg += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;

    vec4 outc = vxClear ? S : vec4(S.rgb + max(bg, 0.0) * (1.0 - S.a), 1.0);
    gl_FragColor = outc * vxPresence;
}
