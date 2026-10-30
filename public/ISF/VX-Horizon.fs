/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A still horizon over calm water. Faint stepped bands of sky, a hairline horizon, a disc that sits on the sea and rises with the pitch, and its warm path broken across slow ripples below. The sound raises the light as gently as a dawn; every change takes seconds.",
    "PASSES": [
        {
            "TARGET": "hzState",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 8, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "horizonHeight", "LABEL": "Horizon height", "TYPE": "float", "DEFAULT": 0.42, "MIN": 0, "MAX": 1 },
        { "NAME": "bands", "LABEL": "Bands", "TYPE": "float", "DEFAULT": 7, "MIN": 2, "MAX": 16 },
        { "NAME": "reflection", "LABEL": "Reflection", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "ripple", "LABEL": "Ripple", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "discSize", "LABEL": "Disc size", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "light", "LABEL": "Light", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "discAcross", "LABEL": "Disc position", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "haze", "LABEL": "Haze lines", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Sky", "TYPE": "color", "DEFAULT": [0.72, 0.82, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Light path", "TYPE": "color", "DEFAULT": [1.0, 0.8, 0.45, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote0", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote2", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote3", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE0", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE2", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE3", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 }
    ]
}*/

// hzState = (light, disc height 0-1, running flag, 0), both eased over seconds.
const float REST_HEIGHT = 0.3;

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float horizonY() {
    return mix(0.28, 0.62, horizonHeight);
}

float discRadius() {
    return mix(0.025, 0.12, discSize);
}

// The sky's light at height t above the horizon (0 at the line, 1 at the top),
// in soft steps.
float skyLight(float t, float lvl, float pxT) {
    float nb = floor(bands + 0.5);
    float q = t * nb;
    float k = floor(q);
    float f = q - k;
    // Each step eases into the next over several pixels, and inside a
    // step the light still falls a little, so the bands read as layers of air.
    float edge = clamp(pxT * nb * 8.0, 0.004, 0.5);
    float stepped = (k + smoothstep(1.0 - edge, 1.0, f) + 0.35 * f) / nb;
    float glow = exp(-stepped * 4.0);
    return glow * (0.012 + 0.09 * lvl);
}

// Brightness of the disc at point q (frame-height units), with haze lines across its lower half.
float discAt(vec2 q, vec2 c, float r, float h, float pxH, float lvl) {
    float d = length(q - c);
    float aa = 0.8 * pxH;
    float body = 1.0 - smoothstep(r - aa, r + aa, d);
    // Thin strata of haze cross the disc near the sea, thinning higher up.
    float above = (q.y - h) / max(r, 1e-4);
    float lines = 0.5 + 0.5 * cos((q.y - h) / pxH * 0.6 / (1.0 + above * 0.8));
    float strata = haze * smoothstep(1.6, 0.0, above) * smoothstep(0.55, 1.0, lines) * 0.8;
    float glow = exp(-max(d - r, 0.0) / (0.06 * r + 2.0 * pxH)) * 0.12 + exp(-max(d - r, 0.0) / (0.6 * r)) * 0.04;
    return body * (1.0 - strata) * (0.3 + 0.7 * lvl) + glow * (0.2 + 0.8 * lvl);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float dt = clamp(TIMEDELTA, 0.0, 0.1);

    if (PASSINDEX == 0) {
        vec4 st = IMG_NORM_PIXEL(hzState, vec2(0.5));
        bool ready = FRAMEINDEX >= 2 && st.z > 0.5;
        float lv = ready ? st.x : 0.0;
        float ht = ready ? st.y : REST_HEIGHT;
        // Light rises like a dawn and fades more slowly still.
        float target = clamp(vxEnv, 0.0, 1.0);
        lv += (target - lv) * (1.0 - exp(-dt / (target > lv ? 2.2 : 4.5)));
        // The disc drifts to the energy-weighted pitch of what sounds.
        float wsum = vxNoteE0 + vxNoteE1 + vxNoteE2 + vxNoteE3;
        if (wsum > 0.02) {
            float midi = (vxNote0 * vxNoteE0 + vxNote1 * vxNoteE1 + vxNote2 * vxNoteE2 + vxNote3 * vxNoteE3) / wsum * 127.0;
            float want = clamp((midi - 36.0) / 48.0, 0.0, 1.0);
            ht += (want - ht) * (1.0 - exp(-dt / 3.5));
        }
        gl_FragColor = vec4(lv, ht, 1.0, 1.0);
        return;
    }

    vec4 st = IMG_NORM_PIXEL(hzState, vec2(0.5));
    float lvl = smoothstep(0.0, 0.85, st.x) * (0.35 + 0.9 * light);
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(1.0));
    float pxH = fw.y / RENDERSIZE.y;
    vec2 q = vec2(uv.x * aspect, uv.y);
    float h = horizonY();
    float r = discRadius();
    // Low notes sink the disc half into the sea; high ones lift it clear.
    float elev = mix(-0.45, 1.9, st.y) * r;
    vec2 c = vec2(mix(0.22, 0.78, discAcross) * aspect, h + elev);
    float t = vxPhase * 0.05;

    vec3 col = vec3(0.0);
    if (q.y >= h) {
        float sky = skyLight((q.y - h) / (1.0 - h), lvl, pxH / (1.0 - h));
        // The sky is a touch brighter around the disc.
        float near = exp(-length((q - c) * vec2(0.6, 1.4)) / 0.35);
        col = ink.rgb * sky * (1.0 + 1.5 * near);
        col += ink.rgb * discAt(q, c, r, h, pxH, lvl) * 0.95;
    } else {
        float below = h - q.y;
        // Depth into the water: ripple lines crowd toward the horizon.
        float z = 0.02 / (below + 0.012);
        float rip = mix(0.2, 1.0, ripple);
        // Slow swell displaces the mirror sideways, more near the viewer.
        float swell = (noise2(vec2(q.x * 3.0 / (1.0 + below * 4.0), z * 6.0 - t * 0.6)) - 0.5);
        float shiftX = swell * rip * (0.006 + 0.08 * below);
        vec2 m = vec2(q.x + shiftX, h + below);
        float sky = skyLight(below / (1.0 - h), lvl, pxH / (1.0 - h));
        vec3 water = ink.rgb * sky * 0.5;
        // Ripple lines: thin bright crests, broken into lengths, drifting in.
        float crestPh = z * 7.0 + t * 0.9 + 0.35 * noise2(vec2(q.x * 4.0, z * 3.0));
        float cw = fwidth(crestPh);
        float f = fract(crestPh);
        float crest = 1.0 - smoothstep(0.0, max(cw * 1.2, 0.02), min(f, 1.0 - f));
        crest *= smoothstep(0.35, 0.7, noise2(vec2(q.x * 9.0 / (1.0 + below * 3.0), floor(crestPh) * 1.7)));
        crest *= smoothstep(0.6, 0.15, cw);
        water += ink.rgb * crest * rip * (0.012 + 0.05 * lvl) * exp(-below * 6.0);
        // The disc's own reflection, cut into slivers by the swell: the only gold.
        // Stretched toward the viewer, as reflections on moving water are.
        float mirrored = discAt(vec2(m.x, h + below / 1.7), c, r, h, pxH, lvl);
        float sliverPh = z * 16.0 + t * 1.3 + 0.35 * noise2(vec2(q.x * 9.0 / (1.0 + below * 4.0), z * 2.0));
        float sf = fract(sliverPh);
        float sliver = smoothstep(0.08, 0.2, sf) * smoothstep(0.75, 0.55, sf);
        sliver *= smoothstep(0.3, 0.55, noise2(vec2(q.x * 30.0 / (1.0 + below * 4.0), floor(sliverPh) * 3.1)));
        sliver = mix(sliver, 0.3, smoothstep(0.3, 1.0, fwidth(sliverPh)));
        float pathW = r * (1.0 + below * 5.0);
        float inPath = exp(-pow((q.x - c.x) / pathW, 2.0) * 1.5);
        // Glints: short dashes along the crests inside the path.
        float glint = smoothstep(0.6, 0.9, noise2(vec2(q.x * 60.0 / (1.0 + below * 6.0), crestPh * 2.0)))
                    * smoothstep(0.6, 0.15, cw);
        float lift = smoothstep(-0.45, 1.9, elev / r);
        float path = inPath * (0.3 * glint + 0.03 * sliver) * (0.3 + 0.7 * lvl) * exp(-below * mix(6.0, 2.0, lift));
        float refl = (mirrored * 0.75 * (0.04 + 0.96 * sliver) + path) * reflection;
        col = water * (0.4 + 0.6 * reflection) + accent.rgb * refl;
    }

    // The horizon itself: a hairline, warmed where the disc meets it.
    float dl = abs(q.y - h) / pxH;
    float lineL = exp(-dl * dl / 0.5) * (0.06 + 0.2 * lvl);
    float meet = exp(-abs(q.x - c.x) / (r * 3.0));
    col += ink.rgb * lineL * (0.6 + 0.4 * smoothstep(0.0, 0.25, uv.x) * smoothstep(1.0, 0.75, uv.x)) * (1.0 + meet);

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
