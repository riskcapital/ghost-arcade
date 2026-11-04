/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A murmuration: thousands of starlings wheel as one cloud across a dusk sky, dark waves rippling through the flock as it folds and turns. The music sets how fast the flock wheels and how far it spreads; every hit sends a ripple of panic rolling out through the birds, pushing them apart and twisting the cloud before it settles back. Look picks dark birds against a sunset, birds lit gold by the low sun, or glowing birds at night.",
    "PASSES": [
        {
            "TARGET": "hist",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 128,
            "HEIGHT": 1
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "split", "LABEL": "Shock", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "twist", "LABEL": "Twist", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "flockSize", "LABEL": "Flock size", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "waves", "LABEL": "Waves", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "birdSize", "LABEL": "Bird size", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0, "MAX": 1 },
        { "NAME": "look", "LABEL": "Look", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2], "LABELS": ["Dusk silhouette", "Golden light", "Night glow"] },
        { "NAME": "ink", "LABEL": "Birds", "TYPE": "color", "DEFAULT": [0.55, 0.62, 0.95, 1.0] },
        { "NAME": "accent", "LABEL": "Sunset", "TYPE": "color", "DEFAULT": [1.0, 0.55, 0.25, 1.0] },
        { "NAME": "vxEnergy", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxMorph", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/


const float TAU = 6.2831853;

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec3 hash32(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.xxy + p3.yzz) * p3.zyx);
}

float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}

// hist (128x1): the last ~2.5 s of the music, newest at the left, one texel
// per HSTEP seconds: the pulse in red, the swell in green. A hit becomes a
// smooth wave that can travel outward (what is at distance d now is the pulse
// from d / speed seconds ago), and the swell can be eased over a second.
const float HSTEP = 0.02;
const float HN = 128.0;

// A texel never written (a fresh buffer: the voice was just added, or the
// renderer rebuilt its buffers) reads as a best guess from the signals now,
// so nothing dips; the record heals itself as it scrolls.
vec4 histTexel(float i) {
    i = clamp(i, 0.0, HN - 1.0);
    vec4 h = IMG_NORM_PIXEL(hist, vec2((i + 0.5) / HN, 0.5));
    if (h.a < 0.5) h = vec4(vxPulse * exp(-i * HSTEP / 0.1), vxSwell, 0.0, 0.0);
    return h;
}

// The pulse as it was a seconds ago (zero beyond the record).
float histAt(float a) {
    float x = a / HSTEP;
    if (x >= HN - 1.0) return 0.0;
    x = max(x, 0.0);
    float i = floor(x);
    return mix(histTexel(i).r, histTexel(i + 1.0).r, x - i);
}

// The swell averaged over the last second: a slow, rounded breath.
float slowSwell() {
    float s = 0.0;
    for (int k = 0; k < 6; k++) {
        s += histTexel(float(k) * 10.0).g;
    }
    return s / 6.0;
}

// Pass 0: slide the record along by this frame's time and put the newest
// values at the front.
vec4 histUpdate() {
    float dt = clamp(TIMEDELTA, 0.0, 0.1);
    float i = floor(gl_FragCoord.x);
    float sh = dt / HSTEP;
    float src = i - sh;
    vec2 v;
    if (src < 0.0) {
        v = mix(histTexel(0.0).rg, vec2(vxPulse, vxSwell), clamp(-src / max(sh, 1e-4), 0.0, 1.0));
    } else {
        float j = floor(src);
        v = mix(histTexel(j).rg, histTexel(j + 1.0).rg, src - j);
    }
    return vec4(v, 0.0, 1.0);
}

float fbm3(vec2 p) {
    float s = 0.5 * vnoise(p);
    p = mat2(0.8, 0.6, -0.6, 0.8) * p * 2.02 + vec2(1.7, 9.2);
    s += 0.25 * vnoise(p);
    p = mat2(0.8, 0.6, -0.6, 0.8) * p * 2.03 + vec2(8.3, 2.8);
    s += 0.125 * vnoise(p);
    return s;
}

mat2 rot(float a) {
    float c = cos(a);
    float s = sin(a);
    return mat2(c, s, -s, c);
}

// One layer of birds on a jittered grid laid over the flock's own frame.
// Returns how much of the pixel the birds cover, and which bird it is.
vec2 birdLayer(vec2 q, float density, float cellPx, float pxPerUnit, float t, float flinch, float seed) {
    float cpu = pxPerUnit / cellPx;
    vec2 g = q * cpu + vec2(seed * 17.0, seed * 5.0);
    vec2 id0 = floor(g);
    float cover = 0.0;
    float who = 0.0;
    float rBody = 0.34 + 0.22 * birdSize;
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 id = id0 + vec2(float(i), float(j));
            vec3 h = hash32(id + seed * 31.0);
            if (h.x > density) continue;
            float ph = t * (1.3 + h.z) + h.y * TAU;
            // Each bird jinks about its place; a hit makes them all flinch.
            vec2 wob = vec2(sin(ph * 1.7 + h.z * 9.0), cos(ph * 1.3 + h.y * 7.0)) * (0.18 + 0.3 * flinch);
            vec2 c = id + 0.5 + (h.yz - 0.5) * 0.55 + wob;
            vec2 d = g - c;
            // Wings beat: the bird is a short dash across its flight that thins
            // and widens, so the flock shimmers.
            float flap = 0.5 + 0.5 * sin(t * (5.0 + 3.0 * h.y) + h.z * TAU);
            vec2 e = d / vec2(rBody * (0.85 + 0.3 * flap), rBody * (0.45 - 0.1 * flap));
            float r = length(e);
            float cv = clamp(1.0 - (r - 1.0) * rBody * cellPx * 0.6, 0.0, 1.0);
            if (cv > cover) {
                cover = cv;
                who = fract(h.y * 7.31 + h.z * 3.17);
            }
        }
    }
    return vec2(cover, who);
}

void main() {
    if (PASSINDEX == 0) {
        gl_FragColor = histUpdate();
        return;
    }

    vec2 res = RENDERSIZE;
    float pxPerUnit = res.y;
    vec2 p = (gl_FragCoord.xy - 0.5 * res) / res.y;
    // All motion runs on the music's flow clock, so it speeds and slows with it.
    float t = vxFlow * 0.48;

    // The flock wheels on the flow clock; each hit adds a push of turn there.
    float turn = vxFlow * 0.22 * (0.3 + twist);
    float flinch = clamp(vxPulse, 0.0, 1.0);
    // The flock spreads with the music on a slow breath, not on every beat.
    float breath = slowSwell();

    // The cloud's own frame: it wanders, wheels and leans as a whole, and
    // spreads with the swell.
    vec2 centre = vec2(0.2 * sin(t * 0.071 + 1.0), 0.08 * sin(t * 0.093) + 0.05);
    float grow = 0.8 + 0.6 * flockSize + 0.22 * breath + 0.06 * vxSwell;
    vec2 q = (p - centre) / grow;
    float r0 = length(q);
    // Twisting: the core turns further than the rim, so the flock folds; a
    // hit twists the core further and lets it spring back.
    float swirl = turn + (0.6 + 1.2 * twist) * exp(-r0 * r0 * 9.0) * (sin(t * 0.13 + 0.7) + 0.9 * twist * vxPulse)
                + 0.35 * sin(t * 0.05);
    q = rot(swirl) * q;
    // A slow flowing warp: the shape breathes and its edges stream out.
    vec2 w = vec2(fbm3(q * 2.1 + vec2(0.0, t * 0.11)), fbm3(q * 2.1 + vec2(5.2, -t * 0.09)));
    q += w * (0.13 + 0.05 * breath);

    // The shock: each hit rolls out from the middle as a ring of birds
    // pushed outward, crowding into a dark front, then settling back.
    float rq = length(q / vec2(1.0, 0.45));
    float shockAge = rq / 0.5;
    float fromMid = smoothstep(0.05, 0.3, rq);
    float shock = histAt(shockAge) * exp(-shockAge * 0.6) * fromMid;
    float shockFront = max(histAt(shockAge) - histAt(shockAge + 0.12), 0.0) * exp(-shockAge * 0.6) * fromMid;
    q -= normalize(q + 1e-5) * split * 0.08 * shock;

    // A long, curving cloud: a bent ellipse thinning toward its tips.
    float bend = 0.9 * sin(t * 0.06 + 2.0);
    vec2 qe = vec2(q.x, q.y - bend * q.x * q.x);
    float tip = 1.0 - 0.45 * smoothstep(0.1, 0.5, abs(qe.x));
    float d = length(qe / vec2(0.62, 0.15 * tip + 0.03));
    d += 0.35 * fbm3(q * 3.3 + vec2(t * 0.07, 3.0));
    float body = smoothstep(1.15, 0.35, d);
    // Ragged streamers peel off the rim.
    float streak = smoothstep(1.6, 0.9, d) * smoothstep(0.15, 0.55, fbm3(vec2(q.x * 2.0, q.y * 9.0) + vec2(-t * 0.15, 7.0)));
    float density = max(body, streak * 0.45);

    // Waves of turning birds ripple through the flock as dark bands, and
    // each hit's shock front crowds the birds together as it passes.
    vec2 wd = normalize(vec2(1.0, 0.35 * sin(t * 0.04)));
    float band = sin(dot(q, wd) * 15.0 - t * 1.8 + 4.0 * w.x);
    float waveL = waves * (0.5 + 0.5 * band) * (0.5 + 0.5 * band) * (0.8 + 0.4 * breath);
    float ring = clamp(shockFront * 4.0 * split + shock * 0.3, 0.0, 1.0);
    // The shock moves birds and lights them; it never adds or removes any.
    float thick = density * (0.75 + 0.8 * waveL);

    // Two depths of birds: small far ones and bigger near ones.
    float s1080 = res.y / 1080.0;
    float cellNear = (4.2 + 4.0 * birdSize) * s1080;
    float cellFar = cellNear * 0.62;
    vec2 nearB = birdLayer(q, clamp(thick * 0.85, 0.0, 0.95), cellNear, pxPerUnit, t, flinch, 1.0);
    vec2 farB = birdLayer(q * 1.03 + vec2(0.02, 0.0), clamp(thick * 1.1 - 0.15, 0.0, 0.95), cellFar, pxPerUnit, t + 7.0, flinch, 2.0);
    // Where the flock is thickest the birds merge into a solid mass.
    float mass = smoothstep(0.7, 1.5, thick);
    // Too many birds to see one by one: a speckled dark mass, still grainy.
    float speck = vnoise(q * res.y / (2.2 * s1080)) * 0.5 + 0.5;
    mass *= smoothstep(0.15, 0.75, speck + mass * 0.35);
    float birds = 1.0 - (1.0 - nearB.x) * (1.0 - farB.x * 0.22) * (1.0 - mass * 0.92);
    // Which bird the pixel shows; the speckled mass counts as no single bird.
    float who = nearB.x >= farB.x ? nearB.y : farB.y;
    float single = max(nearB.x, farB.x * 0.22);
    single = single / max(birds, 1e-3);

    // Sky.
    vec2 uv = gl_FragCoord.xy / res;
    vec2 sunP = vec2(0.5 + 0.18 * sin(t * 0.01), -0.08);
    float sunD = length((uv - sunP) * vec2(res.x / res.y, 1.0));
    vec3 inkC = ink.rgb;
    vec3 acc = accent.rgb;
    vec3 sky;
    vec3 birdCol;
    float h = uv.y;
    if (look == 0) {
        sky = mix(acc * 1.05, mix(acc, inkC, 0.5) * 0.55, smoothstep(0.0, 0.55, h));
        sky = mix(sky, inkC * 0.18 + vec3(0.02, 0.02, 0.05), smoothstep(0.45, 1.0, h));
        sky += acc * 0.6 * exp(-sunD * 4.0) + vec3(1.0, 0.95, 0.85) * 0.35 * exp(-sunD * 18.0);
        birdCol = inkC * 0.06 + vec3(0.012);
    } else if (look == 1) {
        sky = mix(acc * 0.55, inkC * 0.32, smoothstep(0.0, 0.6, h));
        sky = mix(sky, inkC * 0.08 + vec3(0.01, 0.01, 0.03), smoothstep(0.5, 1.0, h));
        sky += acc * 0.35 * exp(-sunD * 3.5);
        // Birds facing the sun catch it; the rest stay in shadow.
        // Bands of the flock bank toward the sun and some birds flash gold;
        // the thick core shades itself.
        float lit = 0.5 + 0.5 * sin(dot(q, vec2(6.0, 3.0)) + t * 0.2 + w.y * 3.0);
        float share = clamp(0.05 + 0.55 * lit * lit * lit + 0.12 * breath + 0.55 * ring, 0.0, 1.0) * (1.0 - 0.75 * mass);
        // Birds turn gold gradually as the share rises past them.
        float gold = smoothstep(who - 0.12, who + 0.12, share) * single;
        birdCol = mix(inkC * 0.1 + vec3(0.015), acc * 1.15 + vec3(0.1), gold);
    } else {
        sky = mix(inkC * 0.07, vec3(0.005, 0.006, 0.015), smoothstep(0.0, 0.8, h));
        sky += acc * 0.08 * exp(-sunD * 2.5);
        birdCol = mix(inkC * 1.1, acc * 1.2 + 0.15, smoothstep(who - 0.12, who + 0.12, clamp(waveL * 0.6 + ring * 0.8 + flinch * 0.3, 0.0, 1.0)));
        birdCol *= 0.65 + 0.35 * single;
    }

    float cover = birds;
    vec3 col = mix(sky, birdCol, cover);
    float outA = 1.0;
    vec3 outC = col;
    if (vxClear) {
        outA = cover;
        outC = birdCol * cover;
    }
    outC *= vxPresence;
    outA *= vxPresence;
    outC = clamp(outC, 0.0, 1.0);
    outC = min(outC, vec3(outA));
    gl_FragColor = vec4(outC, outA);
}
