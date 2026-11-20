/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A wall of clockwork: dozens of toothed wheels at several sizes, on three layers one behind another, over a plate of engine-turned metal. The wheels really mesh, each turning against its neighbors at the rate its tooth count demands. Dark brushed steel under a raking light, with bright edges, engraved index marks and the shadow of each layer on the one behind. The sound's motion turns the whole train and its level turns it faster and lights it; each hit ticks the escapement, so every wheel jumps on by one tooth, and one train of wheels is picked out in the accent color. With no sound the works stand still, dimly lit.",
    "PASSES": [
        {
            "TARGET": "spin",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "size", "LABEL": "Gear size", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "layers", "LABEL": "Layers", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0, "MAX": 1 },
        { "NAME": "detail", "LABEL": "Detail", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "speed", "LABEL": "Speed", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Light", "TYPE": "color", "DEFAULT": [0.86, 0.92, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Lit train", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// Each layer is a checkerboard of wheels: large ones on the dark squares, small ones on the light,
// in the ratio 5 to 3, so every wheel meshes with its four neighbors and turns against them.
// Tooth counts are 80 and 48, or 40 and 24: all divide evenly round the four neighbors.
// The 1x1 target "spin" keeps how far the level of the sound has turned the train, in teeth.

const float TAU = 6.2831853;
const float BIG = 0.625;
const float SMALL = 0.375;
// The train comes back to the same picture every this many teeth.
const float WRAP = 240.0;

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

float noise1(float x) {
    float i = floor(x);
    float f = fract(x);
    return mix(hash11(i), hash11(i + 1.0), f * f * (3.0 - 2.0 * f));
}

vec2 turn2(vec2 v, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

// A layer's checkerboard: (square size, how far it is turned, offset x, offset y).
vec4 layerFrame(float k, float S) {
    if (k < 0.5) return vec4(0.44 * S, 0.19, 0.08, -0.05);
    if (k < 1.5) return vec4(0.275 * S, -0.43, -0.13, 0.04);
    return vec4(0.172 * S, 0.74, 0.02, 0.11);
}

// Teeth on a layer's large wheels; the small ones have three fifths as many.
float layerTeeth(float k) {
    return k < 0.5 ? 80.0 : 40.0;
}

// How a wheel is cut, from its kind (0 large, 1 small) and a number drawn for its place:
// (how many spokes or holes, 1 for round holes, rim width, spoke half width), widths as parts of its radius.
vec4 wheelCut(float kind, float h, float k) {
    if (kind < 0.5) {
        if (k < 0.5) {
            // The front wheels are the lightest: thin rims on slender spokes, so the works show through.
            if (h < 0.5) return vec4(5.0, 0.0, 0.08, 0.034);
            if (h < 0.86) return vec4(10.0, 0.0, 0.07, 0.017);
            return vec4(5.0, 1.0, 0.085, 0.0);
        }
        if (h < 0.42) return vec4(5.0, 0.0, 0.12, 0.05);
        if (h < 0.74) return vec4(10.0, 0.0, 0.1, 0.026);
        return vec4(5.0, 1.0, 0.12, 0.0);
    }
    float slim = k < 0.5 ? 0.7 : 1.0;
    if (h < 0.42) return vec4(6.0, 0.0, 0.17 * slim, 0.06 * slim);
    if (h < 0.74) return vec4(3.0, 0.0, 0.17 * slim, 0.1 * slim);
    return vec4(6.0, 1.0, 0.17 * slim, 0.0);
}

// The metal of one wheel: positive inside it, in screen heights. q is the place measured from its arbor,
// rp its pitch radius, N its teeth, rot how far it has turned, cut how it is pierced.
float wheelMetal(vec2 q, float rp, float N, float rot, vec4 cut) {
    float r = length(q);
    float m = 2.0 * rp / N;
    float rr = rp - 1.2 * m;
    float rt = rp + 0.95 * m;
    if (r > rt + 0.02) return rt - r;
    float th = atan(q.y, q.x) - rot;

    // Teeth: wide at the root, narrowing in a slight curve to a flat tip.
    float u = fract(th * N / TAU + 0.5) - 0.5;
    float f = clamp((r - rr) / (rt - rr), 0.0, 1.0);
    float hw = mix(0.3, 0.13, f * (0.65 + 0.35 * f));
    float flank = (hw - abs(u)) * (TAU * r / N) * 0.94;
    float body = max(rr - r, min(rt - r, flank));

    // The windows cut through it between hub and rim.
    float ri = rr - cut.z * rp;
    float rh = rp * 0.2;
    float fold = cut.x;
    float win;
    float round0 = 0.02 * rp;
    if (cut.y < 0.5) {
        float ang = (fract(th * fold / TAU + 0.5) - 0.5) * TAU / fold;
        float along = (r - rh) / max(ri - rh, 1e-4);
        float across = r * abs(sin(ang)) - cut.w * rp * mix(1.25, 0.8, clamp(along, 0.0, 1.0));
        vec3 e = vec3(r - rh, ri - r, across);
        float least = min(min(e.x, e.y), e.z);
        // Their corners are rounded.
        win = least > round0 ? least : round0 - length(max(vec3(round0) - e, 0.0));
    } else {
        float ang = (fract(th * fold / TAU) - 0.5) * TAU / fold;
        float rc = (rh + ri) * 0.5;
        float rad = min((ri - rh) * 0.5 - 0.035 * rp, 3.14159 * rc / fold - 0.05 * rp);
        win = rad - length(r * vec2(cos(ang), sin(ang)) - vec2(rc, 0.0));
    }
    return min(body, -win);
}

// The wheel of layer k nearest to p of one kind: (its metal at p, where it stands x and y, a number for its place).
vec4 nearWheel(vec2 p, float k, float kind, float S, float pos, float turnDir) {
    vec4 fr = layerFrame(k, S);
    vec2 g = turn2(p - fr.zw, -fr.y) / fr.x - vec2(kind, 0.0);
    // The nearest square of this kind on the checkerboard.
    vec2 d = floor(vec2(g.x + g.y, g.x - g.y) * 0.5 + 0.5);
    vec2 site = vec2(d.x + d.y + kind, d.x - d.y);
    vec2 c = fr.zw + turn2(site * fr.x, fr.y);
    float h = hash21(site * 1.7 + k * 31.0 + 5.0);
    float NA = layerTeeth(k);
    float N = kind < 0.5 ? NA : NA * 0.6;
    float rp = fr.x * (kind < 0.5 ? BIG : SMALL);
    // Large wheels turn one way, small ones the other, tooth for tooth, and half a tooth out of step so they mesh.
    float rot = fr.y + (kind < 0.5 ? pos * TAU / N : -pos * TAU / N + 3.14159 / N) * turnDir;
    float sd = wheelMetal(p - c, rp, N, rot, wheelCut(kind, h, k));
    return vec4(sd, site, h);
}

// One layer at p: (metal, kind of the wheel there, its place x and y).
vec4 layerAt(vec2 p, float k, float S, float pos) {
    float turnDir = mod(k, 2.0) < 0.5 ? 1.0 : -1.0;
    vec4 a = nearWheel(p, k, 0.0, S, pos, turnDir);
    vec4 b = nearWheel(p, k, 1.0, S, pos, turnDir);
    return a.x >= b.x ? vec4(a.x, 0.0, a.yz) : vec4(b.x, 1.0, b.yz);
}

// The face of a wheel under the raking light. G is what layerAt gave, grad the slope of its metal on the screen.
vec3 wheelFace(vec2 p, float k, vec4 G, vec2 grad, float S, float pos, vec2 Ld, float px, vec3 inkC, vec3 lamp, float glow) {
    vec4 fr = layerFrame(k, S);
    float kind = G.y;
    vec2 site = G.zw;
    vec2 c = fr.zw + turn2(site * fr.x, fr.y);
    float h = hash21(site * 1.7 + k * 31.0 + 5.0);
    float NA = layerTeeth(k);
    float N = kind < 0.5 ? NA : NA * 0.6;
    float rp = fr.x * (kind < 0.5 ? BIG : SMALL);
    float turnDir = mod(k, 2.0) < 0.5 ? 1.0 : -1.0;
    float rot = fr.y + (kind < 0.5 ? pos * TAU / N : -pos * TAU / N + 3.14159 / N) * turnDir;
    vec4 cut = wheelCut(kind, h, k);

    vec2 q = p - c;
    float r = length(q);
    vec2 qn = q / max(r, 1e-5);
    float th = atan(q.y, q.x) - rot;
    float m = 2.0 * rp / N;
    float rr = rp - 1.2 * m;
    float ri = rr - cut.z * rp;
    float rh = rp * 0.2;
    float sd = G.x;

    // Dark steel. The rim and hub are turned on a lathe, so they throw a bow-tie of light toward and away
    // from the lamp; fine rings of the tool show in it.
    float bow = pow(abs(dot(qn, Ld)), 6.0);
    float rings = 0.62 + 0.76 * noise1(r / rp * 150.0 + h * 40.0);
    rings = mix(1.0, rings, 1.0 - smoothstep(0.3, 0.8, px * 150.0 / rp));
    float sheen = bow * rings;
    float steel = 0.032 + 0.016 * h;
    float ridge = 0.0;
    if (r > rh && r < ri && cut.y < 0.5) {
        // Spokes are grained along their length: each one flares as it swings square to the lamp.
        float ia = floor(th * cut.x / TAU + 0.5) * TAU / cut.x + rot;
        vec2 along = vec2(cos(ia), sin(ia));
        float sq = 1.0 - abs(dot(along, Ld));
        float off = dot(q, vec2(-along.y, along.x));
        sheen = pow(sq, 3.0) * (0.75 + 0.5 * noise1(off / rp * 120.0 + h * 9.0));
        // A fine line is cut down the middle of each spoke.
        ridge = 1.0 - smoothstep(0.0, max(0.0011, 0.7 * px), abs(off));
    }
    vec3 col = lamp * (steel + 0.36 * sheen);

    // Engraving on the rim: two fine circles, and index marks, every fifth one long.
    float cutw = max(0.0011, 0.7 * px);
    float dim = 0.0011 / cutw;
    float mark = ridge * 0.5;
    float band = rr - ri;
    mark += (1.0 - smoothstep(0.0, cutw, abs(r - (ri + band * 0.22)))) * 0.8;
    mark += (1.0 - smoothstep(0.0, cutw, abs(r - (rr - band * 0.12)))) * 0.6;
    float marks = N * 0.5;
    float ti = th * marks / TAU;
    float tk = floor(ti + 0.5);
    // Long marks are spaced so the wheel looks the same after every 64 hits, when the count starts over.
    float long5 = mod(tk, marks / (kind < 0.5 ? 5.0 : 3.0)) < 0.5 ? 1.0 : 0.0;
    float dTick = abs(ti - tk) * TAU / marks * r;
    float inBand = step(ri + band * 0.22, r) * step(r, ri + band * mix(0.5, 0.85, long5));
    float sparse = 1.0 - smoothstep(0.25, 0.6, px * marks / (TAU * r) * 2.0);
    mark += (1.0 - smoothstep(0.0, cutw, dTick)) * inBand * sparse * mix(0.45, 0.9, long5);
    // On the hub: a raised boss, and the polished end of the arbor.
    mark += (1.0 - smoothstep(0.0, cutw, abs(r - rh * 0.62))) * 0.7;
    float arbor = 1.0 - smoothstep(rh * 0.3 - px, rh * 0.3 + px, r);
    col *= 1.0 - 0.75 * (1.0 - smoothstep(0.0, 1.5 * px, abs(r - rh * 0.3)));
    col += inkC * arbor * (0.1 + 0.5 * pow(max(dot(qn, Ld), 0.0), 2.0) * smoothstep(0.0, rh * 0.3, r));
    col += (inkC * 0.3 + lamp * 0.6) * mark * dim * detail * (0.6 + glow);

    // Every edge is chamfered: bright where it faces the lamp, dark where it turns away.
    vec2 nrm = -grad / max(length(grad), 1e-6);
    float facing = dot(nrm, Ld);
    float edge = 1.0 - smoothstep(0.0, max(0.0028, 1.6 * px), sd);
    col *= 1.0 - edge * 0.6 * max(-facing, 0.0);
    col += lamp * edge * (0.06 + 1.4 * pow(max(facing, 0.0), 1.5)) * (1.0 + glow);
    return col;
}

// The plate behind the works: engine-turned, a grid of overlapping round spots each brushed in a circle.
vec3 plateFace(vec2 p, vec2 Ld, float px, vec3 inkC) {
    float s = 0.03;
    vec2 g = turn2(p, 0.31) / s;
    vec2 i0 = floor(g);
    float best = -1e6;
    vec2 bc = i0;
    for (int j = 0; j < 4; j++) {
        vec2 c = i0 + vec2(mod(float(j), 2.0), floor(float(j) / 2.0));
        float pri = c.y * 64.0 + c.x;
        if (length(g - c) < 0.74 && pri > best) {
            best = pri;
            bc = c;
        }
    }
    vec2 v = turn2(g - bc, -0.31);
    float d = length(v);
    float bow = pow(abs(dot(v / max(d, 1e-4), Ld)), 4.0) * smoothstep(0.0, 0.25, d);
    float lip = smoothstep(0.74 - 2.5 * px / s, 0.74, d);
    return inkC * (0.012 + (0.025 + 0.035 * detail) * bow) * (1.0 - 0.5 * lip);
}

void main() {
    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);

    if (PASSINDEX == 0) {
        // How far the sound's level has turned the train: whole teeth in red, the part of a tooth in green.
        // The clock is kept beside it, so the sum is right however often this pass runs.
        vec4 prev = IMG_NORM_PIXEL(spin, vec2(0.5));
        float now = fract(TIME * 0.25);
        float dt = fract(now - prev.b + 1.0) * 4.0;
        float teeth = prev.r + prev.g;
        if (FRAMEINDEX < 2 || prev.a < 0.5 || dt > 0.5) dt = 0.0;
        if (FRAMEINDEX < 2 || prev.a < 0.5) teeth = 0.0;
        teeth = mod(teeth + dt * sw * mix(0.4, 7.0, speed), WRAP);
        gl_FragColor = vec4(floor(teeth), fract(teeth), now, 1.0);
        return;
    }

    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
    // The size of one stored pixel: the core may keep this layer coarser than its render size.
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(0.001));
    float px = max(fw.x, fw.y) / RENDERSIZE.y;

    float n = floor(vxCount + 0.5);
    vec3 inkC = ink.rgb;
    vec3 accC = accent.rgb;
    vec2 Ld = normalize(vec2(-0.62, 0.78));

    // How far the train has turned, in teeth: steadily with the sound's motion, faster with its level,
    // and one tooth at each hit, snapped on as the hit dies away.
    vec4 kept = IMG_NORM_PIXEL(spin, vec2(0.5));
    float snap = pu * pu * pu;
    float pos = n - snap + (vxFlow + TIME * 0.01) * mix(0.3, 3.5, speed) + kept.r + kept.g;

    float S = mix(1.5, 0.62, size);
    float count = floor(1.0 + clamp(layers, 0.0, 0.999) * 3.0);

    // The three layers at this pixel, front to back, and the slope of each one's metal.
    vec4 G0 = layerAt(p, 0.0, S, pos);
    vec4 G1 = layerAt(p, 1.0, S, pos);
    vec4 G2 = layerAt(p, 2.0, S, pos);
    vec2 s0 = vec2(dFdx(G0.x), dFdy(G0.x));
    vec2 s1 = vec2(dFdx(G1.x), dFdy(G1.x));
    vec2 s2 = vec2(dFdx(G2.x), dFdy(G2.x));
    // With fewer layers, the ones that remain are the nearer ones.
    float c0 = smoothstep(-0.6 * px, 0.6 * px, G0.x);
    float c1 = count > 1.5 ? smoothstep(-0.6 * px, 0.6 * px, G1.x) : 0.0;
    float c2 = count > 2.5 ? smoothstep(-0.6 * px, 0.6 * px, G2.x) : 0.0;

    // The train the latest hit picked out: one row or one column of a layer's checkerboard.
    float tl = floor(hash11(n * 4.7 + 2.1) * count);
    float alongRow = hash11(n * 7.3 + 0.4) < 0.5 ? 1.0 : 0.0;
    float which = floor(hash11(n * 2.9 + 6.6) * 5.0) - 2.0;
    float lit = n > 0.5 ? 1.0 : 0.0;

    float level = 0.5 + 0.5 * sw;
    vec3 col = vec3(0.0);
    float open = 1.0;
    float gapShadow = 0.02 * S;

    if (c0 > 0.0) {
        float on = lit * (tl < 0.5 ? 1.0 : 0.0) * ((alongRow > 0.5 ? G0.w : G0.z) == which ? 1.0 : 0.0);
        vec3 lamp = mix(mix(inkC, vec3(1.0), 0.35), accC, on * 0.85) * level * 0.95 * (1.0 + on * 0.6);
        col += c0 * wheelFace(p, 0.0, G0, s0, S, pos, Ld, px, inkC, lamp, on * (0.4 + pu));
        open *= 1.0 - c0;
    }
    if (open > 0.003 && count > 1.5) {
        // The front layer's shadow falls on the middle one.
        float sh = smoothstep(-0.006, 0.006, layerAt(p + Ld * gapShadow, 0.0, S, pos).x);
        if (c1 > 0.0) {
            float on = lit * (abs(tl - 1.0) < 0.5 ? 1.0 : 0.0) * ((alongRow > 0.5 ? G1.w : G1.z) == which ? 1.0 : 0.0);
            vec3 lamp = mix(inkC, accC, on * 0.85) * level * 0.62 * (1.0 + on * 0.7);
            col += open * c1 * wheelFace(p, 1.0, G1, s1, S, pos, Ld, px, inkC, lamp, on * (0.4 + pu)) * (1.0 - 0.88 * sh);
            open *= 1.0 - c1;
        }
        if (open > 0.003 && count > 2.5) {
            float sh1 = smoothstep(-0.005, 0.005, layerAt(p + Ld * gapShadow * 0.8, 1.0, S, pos).x);
            float sh0 = smoothstep(-0.012, 0.012, layerAt(p + Ld * gapShadow * 1.9, 0.0, S, pos).x);
            float shade = (1.0 - 0.88 * sh1) * (1.0 - 0.6 * sh0);
            if (c2 > 0.0) {
                float on = lit * (tl > 1.5 ? 1.0 : 0.0) * ((alongRow > 0.5 ? G2.w : G2.z) == which * 2.0 ? 1.0 : 0.0);
                vec3 lamp = mix(inkC, accC, on * 0.85) * level * 0.45 * (1.0 + on * 0.9);
                col += open * c2 * wheelFace(p, 2.0, G2, s2, S, pos, Ld, px, inkC, lamp, on * (0.4 + pu)) * shade;
                open *= 1.0 - c2;
            }
            if (open > 0.003) {
                float sh2 = smoothstep(-0.004, 0.004, layerAt(p + Ld * gapShadow * 0.7, 2.0, S, pos).x);
                col += open * plateFace(p, Ld, px, inkC) * level * shade * (1.0 - 0.75 * sh2);
            }
        } else if (open > 0.003) {
            float sh1 = smoothstep(-0.005, 0.005, layerAt(p + Ld * gapShadow * 0.9, 1.0, S, pos).x);
            col += open * plateFace(p, Ld, px, inkC) * level * (1.0 - 0.75 * sh1) * (1.0 - 0.5 * sh);
        }
    } else if (open > 0.003) {
        float sh = smoothstep(-0.006, 0.006, layerAt(p + Ld * gapShadow, 0.0, S, pos).x);
        col += open * plateFace(p, Ld, px, inkC) * level * (1.0 - 0.75 * sh);
    }

    // The view falls off a little toward its corners.
    vec2 vg = uv - 0.5;
    col *= 1.0 - 0.35 * dot(vg, vg) * 2.0;

    // Tone map on the brightest channel so the lit train keeps its color, then dither against banding.
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.6));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // The wheels are solid; the plate behind them lets what is under it show.
        outa = max(1.0 - open, clamp(max(max(col.r, col.g), col.b) * 1.4, 0.0, 1.0));
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
