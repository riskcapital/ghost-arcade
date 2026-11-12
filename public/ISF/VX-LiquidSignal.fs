/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A bold picture melting in a slow current. The voice paints its own image (a slatted sun, a staring eye or a block of Bauhaus shapes) and a flowing field pushes it around, smearing it into glossy liquid streaks whose color channels drift apart at the edges. The picture keeps pulling itself back together, so it always reads. Every hit of the sound it follows stirs a few turbulent swirls into the flow that wind the picture up and slowly unwind. Picture picks the image, Flow how strongly the current moves, Smear how long the streaks hold before the picture recovers, Swirl how hard hits stir it, Split how far the colors separate, and Gloss the wet shine on the streaks.",
    "PASSES": [
        {
            "TARGET": "pic",
            "PERSISTENT": true,
            "FLOAT": true
        },
        {
            "TARGET": "clock",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 5, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "picture", "LABEL": "Picture", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2], "LABELS": ["Sun", "Eye", "Shapes"] },
        { "NAME": "flow", "LABEL": "Flow", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "smear", "LABEL": "Smear", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "swirl", "LABEL": "Swirl", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "split", "LABEL": "Split", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "gloss", "LABEL": "Gloss", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Picture", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Accent", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// pic (full frame): r, g, b are the picture's ink carried at three slightly
// different speeds (the colour split), a is its accent.
// clock (1x1): last count seen, seconds since the last hit. The picture pass
// runs first and works out the same step from last frame's clock.

const float TAU = 6.2831853;
const float PI = 3.14159265;

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash21(vec2 q) {
    vec3 p3 = fract(vec3(q.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float noise2(vec2 x) {
    vec2 i = floor(x);
    vec2 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}

float potential(vec2 p, float t) {
    return noise2(p * 2.2 + vec2(t * 0.07, -t * 0.05)) + 0.45 * noise2(p * 5.1 - vec2(t * 0.11, t * 0.04) + 7.3);
}

// A divergence-free current: the curl of a drifting noise field.
vec2 curlFlow(vec2 p, float t) {
    float e = 0.01;
    float a = potential(p + vec2(0.0, e), t);
    float b = potential(p - vec2(0.0, e), t);
    float c = potential(p + vec2(e, 0.0), t);
    float d = potential(p - vec2(e, 0.0), t);
    return vec2(a - b, d - c) / (2.0 * e);
}

float fill(float d, float aa) {
    return clamp(0.5 - d / aa, 0.0, 1.0);
}

// The picture: x = ink, y = accent, both 0-1. p in frame-height units, centred.
vec2 source(vec2 p, float aa) {
    float inkA = 0.0;
    float acc = 0.0;
    if (picture == 0) {
        // A slatted sun: ink at the top, accent at the bottom, slats widening downwards.
        vec2 c = vec2(0.0, 0.04);
        float r = length(p - c);
        float disc = fill(r - 0.3, aa);
        float yy = (p.y - c.y) / 0.3;
        float slatW = clamp((-yy + 0.05) * 0.5, 0.0, 1.0);
        float band = fract(yy * 5.0);
        float slat = yy < 0.05 ? smoothstep(slatW - 0.06, slatW, band) : 1.0;
        // Fine engraved lines across the disc, so the current shows as streaks.
        float engr = 0.72 + 0.28 * smoothstep(0.3, 0.7, abs(fract(p.y * 90.0) - 0.5) * 2.0);
        float body = disc * slat * engr;
        float m = smoothstep(0.55, -0.7, yy);
        inkA = body * (1.0 - m);
        acc = body * m;
        // Fine rings round it and a horizon line.
        float rings = fill(abs(fract((r - 0.34) / 0.035) - 0.5) * 0.035 - 0.0035, aa) * step(0.33, r) * smoothstep(0.62, 0.36, r);
        inkA = max(inkA, rings * 0.55);
        float hz = fill(abs(p.y + 0.26) - 0.002, aa) * smoothstep(0.9, 0.2, abs(p.x));
        acc = max(acc, hz * 0.8);
    } else if (picture == 1) {
        // An eye: almond outline, a ribbed iris, a black pupil and a catch light.
        vec2 q = p - vec2(0.0, 0.0);
        float w = 0.62;
        float lid = 0.24 * (1.0 - (q.x / w) * (q.x / w));
        float inside = step(abs(q.x), w) * fill(abs(q.y) - lid, aa);
        float outline = step(abs(q.x), w) * fill(abs(abs(q.y) - lid) - 0.006, aa);
        float r = length(q);
        float a = atan(q.y, q.x);
        float iris = fill(r - 0.19, aa) * (1.0 - fill(r - 0.075, aa));
        float ribs = 0.55 + 0.45 * smoothstep(0.2, 0.8, abs(sin(a * 36.0)));
        float pupil = fill(r - 0.075, aa);
        float catchL = fill(length(q - vec2(0.05, 0.05)) - 0.025, aa);
        acc = iris * inside * ribs * mix(0.6, 1.0, smoothstep(0.08, 0.19, r));
        inkA = max(outline, inside * (1.0 - fill(r - 0.2, aa)) * 0.12);
        inkA = max(inkA, fill(abs(r - 0.19) - 0.004, aa) * inside);
        inkA = max(inkA, catchL);
        inkA *= 1.0 - pupil * (1.0 - catchL);
        // Lashes: short strokes above the lid.
        float lx = clamp(q.x / w, -1.0, 1.0);
        float lashes = 0.0;
        if (abs(q.x) < w * 0.9 && q.y > 0.0) {
            float k = floor(q.x / 0.06 + 0.5);
            float x0 = k * 0.06;
            float y0 = 0.24 * (1.0 - (x0 / w) * (x0 / w));
            vec2 d = q - vec2(x0, y0);
            vec2 dir = normalize(vec2(x0 * 0.6, 1.0));
            float h = clamp(dot(d, dir), 0.0, 0.07);
            lashes = fill(length(d - dir * h) - 0.004, aa) * step(abs(x0), w * 0.85);
        }
        inkA = max(inkA, lashes);
        lx = 0.0;
    } else {
        // Bauhaus block: a circle, a square, a triangle and bars.
        float cr = length(p - vec2(-0.32, 0.08));
        float circle = fill(cr - 0.22, aa) * (0.7 + 0.3 * smoothstep(0.3, 0.7, abs(fract(cr * 45.0) - 0.5) * 2.0));
        vec2 sq = abs(p - vec2(0.18, -0.06)) - vec2(0.17);
        float square = fill(max(sq.x, sq.y), aa);
        vec2 tp = p - vec2(0.42, 0.12);
        float tri = fill(max(abs(tp.x) * 0.866 + tp.y * 0.5, -tp.y) - 0.12, aa);
        float bars = fill(abs(p.y + 0.3) - 0.012, aa) * step(abs(p.x + 0.1), 0.6);
        bars = max(bars, fill(abs(p.x + 0.62) - 0.012, aa) * step(abs(p.y), 0.32));
        float stripes = square * step(0.5, fract((p.x + p.y) * 14.0));
        inkA = max(circle * (1.0 - square), max(stripes, bars));
        acc = max(square * (1.0 - stripes) * 0.9, tri);
        inkA *= 1.0 - tri;
    }
    return vec2(inkA, acc);
}

vec2 swirlAt(vec2 p, vec2 c, float s, float rad) {
    vec2 d = p - c;
    float f = exp(-dot(d, d) / (rad * rad));
    return vec2(-d.y, d.x) / rad * s * f;
}

void main() {
    float n = floor(vxCount + 0.5);
    float dt = clamp(TIMEDELTA, 0.0, 0.1);

    if (PASSINDEX == 1) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        if (FRAMEINDEX < 2) c = vec4(n, 30.0, 0.0, 1.0);
        bool newHit = abs(n - c.r) > 0.5;
        gl_FragColor = vec4(n, newHit ? 0.0 : min(c.g + dt, 30.0), 0.0, 1.0);
        return;
    }

    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 fwp = fwidth(gl_FragCoord.xy);
    float pxs = max(1.0, max(fwp.x, fwp.y));
    float px = pxs / RENDERSIZE.y;
    float fit = max(1.0, 1.5 / aspect);

    if (PASSINDEX == 0) {
        vec4 old = IMG_NORM_PIXEL(clock, vec2(0.5));
        float age = abs(n - old.r) > 0.5 ? 0.0 : old.g + dt;
        if (FRAMEINDEX < 2 || n < 0.5) age = 30.0;
        if (vxHit > 0.01) age = min(age, (1.0 - clamp(vxHit, 0.0, 1.0)) * 0.1);
        float t = vxPhase;
        vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5) * fit;
        vec2 src = source(p, px * 1.5 * fit);

        // The current, plus the swirls the last hit stirred in.
        vec2 v = curlFlow(p, t) * mix(0.004, 0.03, flow);
        float vel = clamp(vxVel, 0.0, 1.0);
        float stir = exp(-age / mix(0.4, 1.4, swirl)) * swirl * mix(0.6, 1.0, vel);
        if (stir > 0.002) {
            for (int i = 0; i < 4; i++) {
                float fi = float(i);
                vec2 c = (vec2(hash11(n * 3.1 + fi * 1.7), hash11(n * 5.7 + fi * 2.9)) - 0.5) * vec2(1.1, 0.7);
                float s = (hash11(n + fi * 4.1) < 0.5 ? -1.0 : 1.0) * mix(0.5, 1.0, hash11(n * 1.3 + fi));
                float rad = mix(0.08, 0.22, hash11(n * 2.3 + fi * 5.0));
                v += swirlAt(p, c, s * stir * 0.55, rad);
            }
        }
        // Step back along the flow, each colour channel at its own speed.
        float sp = mix(0.0, 0.6, split);
        vec2 step0 = v * dt * 2.0 / vec2(aspect, 1.0) / fit;
        vec4 prev;
        prev.r = IMG_NORM_PIXEL(pic, uv - step0 * (1.0 + sp)).r;
        prev.g = IMG_NORM_PIXEL(pic, uv - step0).g;
        prev.b = IMG_NORM_PIXEL(pic, uv - step0 * (1.0 - sp)).b;
        prev.a = IMG_NORM_PIXEL(pic, uv - step0).a;
        if (FRAMEINDEX < 2) prev = vec4(src.x, src.x, src.x, src.y);
        // The picture pulls itself back together, slower right after a hit.
        float back = mix(4.5, 0.7, smear) * mix(0.35, 1.0, smoothstep(0.0, 0.7, age));
        float k = 1.0 - exp(-dt * back);
        vec4 target = vec4(src.x, src.x, src.x, src.y);
        // A slow fade keeps smeared light from piling up.
        vec4 outp = mix(prev, target, k) * (1.0 - dt * 0.02);
        gl_FragColor = clamp(outp, 0.0, 1.5);
        return;
    }

    vec4 c = IMG_NORM_PIXEL(pic, uv);
    vec2 e = vec2(pxs) / RENDERSIZE;
    float lx = IMG_NORM_PIXEL(pic, uv + vec2(e.x * 2.0, 0.0)).g + IMG_NORM_PIXEL(pic, uv + vec2(e.x * 2.0, 0.0)).a;
    float ly = IMG_NORM_PIXEL(pic, uv + vec2(0.0, e.y * 2.0)).g + IMG_NORM_PIXEL(pic, uv + vec2(0.0, e.y * 2.0)).a;
    float l0 = c.g + c.a;
    vec3 col = ink.rgb * c.g * (1.0 - c.a * 0.5) + accent.rgb * c.a;
    // Where the copies have drifted apart, the leading fringe takes the accent
    // and the trailing one a hot ink edge.
    col += accent.rgb * max(c.r - c.g, 0.0) * 1.1 + mix(ink.rgb, vec3(1.0), 0.4) * max(c.b - c.g, 0.0) * 0.8;
    // Gloss: the picture as a wet surface catching a light from the upper left.
    vec3 nrm = normalize(vec3((l0 - lx) * 6.0, (l0 - ly) * 6.0, 1.0));
    vec3 h = normalize(vec3(-0.4, 0.5, 1.0) + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(nrm, h), 0.0), 60.0) * step(0.02, l0);
    float rough = smoothstep(0.02, 0.3, length(vec2(l0 - lx, l0 - ly)));
    col += mix(ink.rgb, vec3(1.0), 0.5) * spec * gloss * 0.6 * rough;
    col = col / (1.0 + max(max(col.r, col.g), col.b) * 0.2);
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
