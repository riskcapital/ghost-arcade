/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A pane of glass with light behind it. The voice draws a twisting ribbon of fine light lines; every hit strikes the pane at a point and it cracks into radial shards around it. The shards fly a little apart, tilt and turn, show their bright refracting edges and split the picture into an ink and an accent copy, then drift back and seal again, leaving a glint along the seams. Shards sets how finely it breaks, Impact how far they fly, Spin how much they turn, Channel split the colour fringe and Recovery how long they take to come back. Seed re-rolls the picture.",
    "PASSES": [
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
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "shards", "LABEL": "Shards", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "impact", "LABEL": "Impact", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "spin", "LABEL": "Spin", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "split", "LABEL": "Channel split", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "recovery", "LABEL": "Recovery", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "seed", "LABEL": "Seed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Light", "TYPE": "color", "DEFAULT": [0.72, 0.82, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Fringe", "TYPE": "color", "DEFAULT": [1.0, 0.8, 0.45, 1.0] },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// clock (1x1): last count seen, seconds since the last hit, velocity of that
// hit, the clock last frame (so time is measured even if frames are skipped).

const float TAU = 6.2831853;
const float PI = 3.1415927;
const int LINES = 18;

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

vec2 hash22(vec2 q) {
    vec3 p3 = fract(vec3(q.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

mat2 rot(float a) {
    float c = cos(a);
    float s = sin(a);
    return mat2(c, s, -s, c);
}

// The picture: a striped disc of light with a twisting ribbon of fine
// lines across it. p in frame-height units, origin in the middle. Returns
// light, and how much of it leans to the accent.
vec2 picture(vec2 p, float t, float ps, float w) {
    float tw = mix(1.2, 2.2, hash11(ps + 1.0));
    float k1 = mix(1.3, 2.1, hash11(ps + 2.0));
    float tilt = (hash11(ps + 3.0) - 0.5) * 0.4;
    // The disc: horizontal bands that thin out towards its top.
    vec2 dc = vec2((hash11(ps + 4.0) - 0.5) * 0.7, 0.04 + (hash11(ps + 5.0) - 0.5) * 0.1);
    float dr = mix(0.27, 0.34, hash11(ps + 6.0));
    vec2 dp = p - dc;
    float dl = length(dp);
    float v = 0.0;
    float acc = 0.0;
    if (dl < dr + 0.1) {
        float yy = (dp.y + dr) / (2.0 * dr);
        float pitch = 0.024;
        float f = fract((dp.y - t * 0.012) / pitch);
        float fill = mix(0.85, 0.15, clamp(yy, 0.0, 1.0));
        float band = smoothstep(0.0, w / pitch * 1.2, f) * smoothstep(fill + w / pitch * 1.2, fill, f);
        float inside = smoothstep(dr + w, dr - w, dl);
        float shade = mix(0.95, 0.4, clamp(yy, 0.0, 1.0));
        v = band * inside * shade * 0.75;
        acc = clamp(1.0 - yy * 1.3, 0.0, 1.0) * 0.8 * inside;
        // A thin halo ring.
        v = max(v, clamp(1.0 - abs(dl - dr - 0.025) / (w * 1.2), 0.0, 1.0) * 0.35);
    }
    vec2 q = rot(tilt) * p;
    float env = 0.30 * exp(-q.x * q.x * 0.45);
    float centre = 0.05 * sin(q.x * 1.1 + t * 0.23) - 0.06;
    float lines = 0.0;
    if (abs(q.y - centre) < env + 0.03) {
        float c2 = q.x * 0.6 - t * 0.17;
        for (int i = 0; i < LINES; i++) {
            float u = float(i) / float(LINES - 1);
            float ph = q.x * k1 + t * 0.35 + u * tw * PI;
            float s = sin(ph);
            float cc = cos(u * PI + c2);
            float y = centre + env * s * cc;
            float dy = env * k1 * cos(ph) * cc;
            float d = abs(q.y - y) * inversesqrt(1.0 + dy * dy);
            float edge = (i == 0 || i == LINES - 1) ? 1.0 : 0.5 + 0.5 * abs(s);
            lines = max(lines, clamp(1.4 - d / w * 0.75, 0.0, 1.0) * edge);
        }
    }
    float glow = exp(-pow((q.y - centre) / (env + 0.05), 2.0) * 1.5) * 0.07 * exp(-q.x * q.x * 0.5);
    // The ribbon passes in front of the disc and darkens it a little.
    v = max(v * (1.0 - glow * 2.0), lines) + glow;
    acc *= 1.0 - lines;
    // A fine row of ticks under it all, like a scale.
    float ty = -0.4;
    float gx = q.x * 30.0 + t * 0.05;
    float big = step(0.75, fract(floor(gx) / 5.0 + 0.01));
    float tick = clamp(1.0 - abs(fract(gx) - 0.5) / 30.0 / w, 0.0, 1.0) * step(abs(q.y - ty), mix(0.006, 0.018, big)) * step(abs(q.x), 0.8);
    v = max(v, tick * 0.5);
    return vec2(v, acc);
}

void main() {
    float n = floor(vxCount + 0.5);

    if (PASSINDEX == 0) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        if (FRAMEINDEX < 2) c = vec4(n, 30.0, 0.8, TIME);
        float dtT = TIME - c.a;
        float dt = (dtT > 0.0 && dtT < 0.25) ? dtT : clamp(TIMEDELTA, 0.0, 0.1);
        bool newHit = abs(n - c.r) > 0.5;
        float age = newHit ? 0.0 : min(c.g + dt, 30.0);
        float vel = newHit ? clamp(vxVel, 0.3, 1.0) : c.b;
        gl_FragColor = vec4(n, age, vel, TIME);
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    float age = clk.g;
    float vel = clamp(clk.b, 0.3, 1.0);
    float rs = floor(clamp(seed, 0.0, 1.0) * 127.0 + 0.5);
    float ps = rs * 2.414;
    float hs = rs * 1.37 + n * 7.13;   // this break

    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(0.5));
    float w = max(fw.x, fw.y) / RENDERSIZE.y;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = (gl_FragCoord.xy / RENDERSIZE - 0.5) * vec2(aspect, 1.0);
    float t = vxPhase;

    // How broken the pane is: a sharp break, a short drift apart, then a
    // quick return that slows as the shards meet.
    float recT = mix(0.25, 1.6, recovery);
    float attack = 1.0 - exp(-age * 45.0);
    float k = clamp(age / recT, 0.0, 1.0);
    float br = attack * (1.0 - k) * (1.0 - k);
    if (n < 0.5) br = 0.0;
    float drift = 1.0 + age * 0.6;

    // The point of impact, somewhere towards the middle.
    vec2 imp = (hash22(vec2(hs, 3.7)) - 0.5) * vec2(aspect * 0.55, 0.45);

    // Shards: a Voronoi pattern in log-polar space around the impact, so the
    // cracks run outwards as spokes, cut across by rings. Cells are longer
    // than they are wide, like real breaks.
    vec2 rel = p - imp;
    float r = length(rel);
    float ang = atan(rel.y, rel.x);
    float spokes = floor(mix(7.0, 20.0, shards) + 0.5);
    float ringK = spokes / TAU * 0.6;
    float rr = r + 0.03;
    vec2 g = vec2(ang / TAU * spokes, log(rr) * ringK);
    vec2 gi = floor(g);
    vec2 gf = fract(g);
    vec2 best = vec2(0.0);
    vec2 bestId = vec2(0.0);
    vec2 bestO = vec2(0.0);
    float bd = 8.0;
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 o = vec2(float(i), float(j));
            vec2 idw = vec2(mod(gi.x + o.x, spokes), gi.y + o.y);
            vec2 jit = 0.15 + 0.7 * hash22(idw + hs);
            vec2 d = o + jit - gf;
            float dd = dot(d, d);
            if (dd < bd) {
                bd = dd;
                best = d;
                bestId = idw;
                bestO = gi + o + jit;
            }
        }
    }
    float edge = 8.0;
    vec2 eN = vec2(0.0);
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 o = vec2(float(i), float(j));
            vec2 idw = vec2(mod(gi.x + o.x, spokes), gi.y + o.y);
            vec2 jit = 0.15 + 0.7 * hash22(idw + hs);
            vec2 d = o + jit - gf;
            vec2 dif = d - best;
            if (dot(dif, dif) > 0.0001) {
                float e = dot(0.5 * (best + d), normalize(dif));
                if (e < edge) {
                    edge = e;
                    eN = normalize(dif);
                }
            }
        }
    }
    // Edge distance in pixels: one warp unit is rr / ringK frame units
    // radially and 0.6 of that across, so take a scale between.
    float edgePx = edge * rr * 0.75 / ringK / w;

    // This shard's middle in the frame, and its own direction, tilt and turn.
    float cA = bestO.x / spokes * TAU;
    float cR = exp(bestO.y / ringK) - 0.03;
    vec2 out1 = vec2(cos(cA), sin(cA));
    vec2 sc = imp + out1 * cR;
    float h1 = hash21(bestId + hs + 0.3);
    float h2 = hash21(bestId + hs + 1.9);
    float h3 = hash21(bestId + hs + 4.1);
    // The break reaches so far; shards near the impact fly furthest.
    float reach = mix(0.45, 1.3, impact) * mix(0.7, 1.0, vel);
    float inBreak = smoothstep(reach, reach * 0.6, cR);
    float near = inBreak * mix(1.0, 0.35, clamp(cR / reach, 0.0, 1.0));
    float moved = br * near;
    vec2 dir = normalize(out1 + (vec2(h1, h2) - 0.5) * 1.1);
    vec2 disp = dir * moved * mix(0.02, 0.16, impact) * (0.3 + h3 * 1.2) * drift;
    float turn = (h2 - 0.5) * 2.0 * moved * mix(0.0, 0.8, spin);
    float zoom = 1.0 + (h1 - 0.5) * moved * 0.3;
    vec2 src = rot(-turn) * (p - sc - disp) / zoom + sc;

    vec2 pic = picture(src, t, ps, w);
    float v = pic.x;
    vec3 col = mix(ink.rgb, mix(ink.rgb, accent.rgb, 0.85), pic.y) * v;
    // The accent copy, pushed along the shard's flight.
    float sp = split * moved * 0.05 * (0.4 + h1);
    if (sp > 0.0008) {
        vec2 sd = rot(turn * 0.5) * dir * sp;
        float va = picture(src + sd, t, ps, w).x;
        col = mix(col, max(col, accent.rgb * va), 0.85);
        col = mix(col, col * vec3(0.55), clamp((va - v) * -2.0, 0.0, 1.0) * 0.6);
    }
    // A tilted shard catches the light, or falls into shadow, with a sheen
    // across its face.
    float facet = 1.0 + (h3 - 0.5) * 1.3 * moved;
    vec2 sheenAx = rot(h1 * 3.0) * vec2(1.0, 0.0);
    float sheen = exp(-abs(dot(p - sc, sheenAx) - (h2 - 0.5) * 0.06) / (w * 5.0)) * moved * step(0.6, h3);
    col = col * facet + mix(ink.rgb, accent.rgb, 0.25) * sheen * 0.18;

    // Cracks: a black gap that opens with the break, and a thin bright
    // refracting rim on the edges that face the light.
    vec2 lightDir = normalize(vec2(cos(t * 0.3 + 1.0), 0.7));
    // Edge normal back in the frame: the warp is conformal up to scale.
    vec2 en = normalize(eN.x * vec2(-out1.y, out1.x) * 0.6 + eN.y * out1);
    float face = clamp(dot(en, lightDir), -1.0, 1.0);
    float crackOn = step(0.0005, br) * inBreak;
    float gap = moved * mix(1.5, 7.0, impact);
    float crack = smoothstep(gap, gap + 1.6, edgePx);
    col *= mix(1.0, crack, crackOn);
    float rimD = max(edgePx - gap, 0.0);
    float rim = exp(-rimD / 1.3) * step(gap * 0.7, edgePx) * crackOn * clamp(br * 3.0, 0.0, 1.0);
    vec3 rimCol = face > 0.0 ? mix(ink.rgb, vec3(1.0), 0.3) * (0.35 + 0.9 * face * face) : accent.rgb * (0.15 + 0.5 * face * face);
    col += rimCol * rim;

    // The glint as it seals: a line of light running out along the seams.
    float seal = smoothstep(0.5, 0.8, k) * (1.0 - smoothstep(0.85, 1.0, k)) * step(0.5, n) * inBreak;
    float run = exp(-abs(r - (k - 0.5) * 2.0 * reach) * 9.0);
    col += mix(ink.rgb, accent.rgb, 0.35) * seal * run * exp(-edgePx / 0.9) * 0.9;

    // The strike itself: a small, brief star at the impact.
    float star = vxHit * (exp(-r * 30.0) * 0.9 + exp(-r * 7.0) * 0.12);
    col += mix(accent.rgb, vec3(1.0), 0.4) * star;

    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
