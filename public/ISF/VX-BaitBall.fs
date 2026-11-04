/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A bait ball: a tight school of silver fish circling as one spinning ring in deep blue water, the scales flashing as they turn toward the light. Each hit is a predator strike: a wave of panic rolls out through the school, flinging the fish outward away from the attack before they circle back and close ranks. The music sets how fast they swim and how big the ball grows.",
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
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "scatter", "LABEL": "Scatter", "TYPE": "float", "DEFAULT": 0.65, "MIN": 0, "MAX": 1 },
        { "NAME": "swim", "LABEL": "Swim speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "school", "LABEL": "School size", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "flash", "LABEL": "Flash", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "fishSize", "LABEL": "Fish size", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Water and fish", "TYPE": "color", "DEFAULT": [0.25, 0.6, 0.95, 1.0] },
        { "NAME": "accent", "LABEL": "Glints", "TYPE": "color", "DEFAULT": [0.6, 1.0, 0.85, 1.0] },
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

// The pulse a seconds ago, softened over a fifth of a second so pushes
// build up over several frames instead of snapping.
float histSoft(float a) {
    return 0.25 * (histAt(a) + histAt(a + 0.06) + histAt(a + 0.12) + histAt(a + 0.18));
}

// One layer of the school: fish laid out on rings round the centre, each
// ring swimming at its own speed. Returns cover, shine and glint.
vec3 fishLayer(float r, float th, float R, float push, float pushPrev, float holeA, float turns,
               float t, float turnRate, float lenPx, float fill, float seed) {
    vec2 res = RENDERSIZE;
    vec2 lightDir = normalize(vec2(0.3, 1.0));
    float rh = r / push;
    float dr = lenPx * 0.32 / res.y;
    float ds = lenPx * 1.2 / res.y;
    float ring0 = floor(rh / dr);

    float cover = 0.0;
    float shine = 0.0;
    float glint = 0.0;
    for (int k = -1; k <= 1; k++) {
        float ring = ring0 + float(k);
        if (ring < 1.0) continue;
        float rc = (ring + 0.5) * dr;
        // How full this ring is: a dense ball with a ragged rim.
        float u = rc / R;
        float dens = smoothstep(1.25, 0.55, u) * smoothstep(0.08, 0.25, u);
        if (dens <= 0.0) continue;
        float nCells = max(floor(TAU * rc / ds), 3.0);
        // Rings swim at different speeds; a few run the other way.
        float hr = hash21(vec2(ring, 9.3 + seed));
        float dir = hr < 0.12 ? -0.7 : 1.0;
        float spinR = dir * (0.6 + 0.8 / (0.4 + u)) * (0.85 + 0.3 * hr);
        float a = (th / TAU + turns * spinR) * nCells;
        float j0 = floor(a);
        for (int m = -1; m <= 1; m++) {
            float j = j0 + float(m);
            float jw = mod(j, nCells);
            vec3 h = hash32(vec2(jw, ring) + 0.37 + seed * 13.1);
            if (h.x > dens * fill) continue;
            // Place in the cell, with a small wiggle in and out.
            float wig = sin(t * (3.0 + 2.0 * h.y) + h.z * TAU) * 0.18;
            float along = (a - j - 0.5 - (h.y - 0.5) * 0.4) * TAU * rc / nCells * dir;
            float across = (rh - rc - (h.z - 0.5) * dr * 0.5 - wig * dr) * push;
            vec2 f = vec2(along, across) * res.y / lenPx;
            // Motion blur: average the fish over the distance it swims in one
            // frame, so fast swimming smears smoothly instead of strobing.
            float bl = abs(spinR) * turnRate * TAU * rc * res.y * clamp(TIMEDELTA, 0.008, 0.04) / lenPx * 2.0;
            float radialBlur = rc * (push - pushPrev) * res.y / lenPx;
            float cv = 0.0;
            for (int q = 0; q < 4; q++) {
                float sq = float(q) / 3.0 - 0.5;
                float x = (f.x - bl * sq) * 2.0;
                // ...and over how far the strike pushed it out this frame.
                vec2 fq = vec2(f.x, f.y + radialBlur * sq);
                // A slim fish: rounded head, tapered body, forked tail.
                float halfW = x > 0.0 ? 0.12 * sqrt(max(1.0 - x * x, 0.0))
                                      : 0.12 * (1.0 + x * 0.8) + 0.1 * smoothstep(-0.75, -1.05, x);
                float tailFork = x < -0.8 ? smoothstep(0.0, 0.06, abs(fq.y) - 0.05 * (x + 1.05) * 4.0) : 1.0;
                float edge = (halfW - abs(fq.y)) * lenPx;
                cv += clamp(edge + 0.5, 0.0, 1.0) * step(abs(x), 1.05) * mix(1.0, tailFork, step(x, -0.8));
            }
            cv *= 0.25;
            if (cv > cover) {
                cover = cv;
                // Scales catch the light as the body swings to face it.
                float ang = th + 1.5708 * dir + 0.35 * sin(t * 2.0 + h.y * TAU);
                vec2 tang = vec2(cos(ang), sin(ang));
                float face = abs(dot(tang, lightDir));
                shine = pow(face, 6.0) * (0.6 + 0.4 * h.z);
                // A few fish glint; more of them on a strike, fading in and out.
                float gt = 0.96 - 0.12 * vxPulse;
                glint = smoothstep(gt - 0.015, gt + 0.015, h.y) * pow(face, 2.0);
                shine *= 0.35 + 0.65 * smoothstep(-0.05, 0.12, f.y + 0.05);
            }
        }
    }

    return vec3(cover, shine, glint);
}

void main() {
    if (PASSINDEX == 0) {
        gl_FragColor = histUpdate();
        return;
    }

    // How far the school has swum round, on the music's flow clock: it
    // swims faster as the music swells and sprints on each strike.
    float turns = vxFlow * (0.06 + 0.1 * swim);
    // Its speed now, in turns per second (the flow clock's own rate).
    float turnRate = (0.06 + 0.1 * swim) * (0.25 + 1.4 * vxSwell + 0.9 * vxPulse);

    vec2 res = RENDERSIZE;
    float s1080 = res.y / 1080.0;
    vec2 p = (gl_FragCoord.xy - 0.5 * res) / res.y;
    float t = vxFlow * 0.45;

    // Where the strikes come from: drifts round a little with each hit.
    float holeA = vxMorph * 0.4908739;
    vec2 centre = vec2(0.06 * sin(t * 0.05), 0.03 * sin(t * 0.07 + 1.0));
    vec2 rel = p - centre;
    // Seen a little from the side: the ring is squashed and tilts slowly.
    float tilt = 0.12 * sin(t * 0.04);
    float ct = cos(tilt);
    float st = sin(tilt);
    rel = mat2(ct, st, -st, ct) * rel;
    rel.y /= 0.78;
    float part = 1.0;
    float r = length(rel);
    float th = atan(rel.y, rel.x);

    // The panic wave: rolls out from the middle, pushing each ring of fish
    // outward as it passes and letting them drift back.
    float burst = scatter * (0.6 * histAt(0.02 + r * 1.4) + 0.4 * histSoft(0.1 + r * 1.4));
    float R = (0.27 + 0.16 * school) * (1.0 + 0.14 * slowSwell() + 0.05 * sin(t * 0.21));
    // Undo the burst so each fish keeps its place in its ring.
    // The fish nearest the strike flee hardest, so the ball bulges away
    // from it and the near side thins, then everything settles.
    float away = 0.5 + 0.5 * cos(th - holeA);
    float pushShape = 0.35 + 0.6 * away * away + 0.12 * vnoise(vec2(cos(th), sin(th)) * 1.5 + 3.0);
    float push = 1.0 + burst * pushShape;
    // Where the strike had pushed them a frame ago, for motion blur.
    float dtF = clamp(TIMEDELTA, 0.008, 0.04);
    float burstPrev = scatter * (0.6 * histAt(0.02 + r * 1.4 + dtF) + 0.4 * histSoft(0.1 + r * 1.4 + dtF));
    float pushPrev = 1.0 + burstPrev * pushShape;

    float lenPx = (12.0 + 14.0 * fishSize) * s1080;
    // A far layer of smaller, dimmer fish behind, swimming a touch slower.
    vec3 back = fishLayer(r * 1.04, th + 0.4, R, push, pushPrev, holeA, turns * 0.83, t, turnRate * 0.83, lenPx * 0.7, 0.85, 1.0);
    vec3 front = fishLayer(r, th, R, push, pushPrev, holeA, turns, t, turnRate, lenPx, 0.55 + 0.35 * school, 0.0);
    float cover = max(front.x, back.x * 0.85) * part;
    bool isFront = front.x >= back.x * 0.85;
    float shine = isFront ? front.y : back.y * 0.55;
    float glint = isFront ? front.z : back.z * 0.6;

    vec2 uv = gl_FragCoord.xy / res;
    vec3 inkC = ink.rgb;
    vec3 acc = accent.rgb;
    // Water: dark with depth, rays from above.
    vec3 water = mix(inkC * 0.03, inkC * 0.32, pow(uv.y, 1.6));
    float rays = 0.0;
    float rx = (uv.x - 0.5) * (res.x / res.y) + uv.y * 0.25;
    rays += smoothstep(0.35, 1.0, vnoise(vec2(rx * 7.0, t * 0.08))) * 0.6;
    rays += smoothstep(0.4, 1.0, vnoise(vec2(rx * 15.0 + 4.0, t * 0.11))) * 0.4;
    water += inkC * rays * 0.22 * smoothstep(0.1, 1.0, uv.y);
        // Drifting motes, each a soft speck that rises slowly.
    vec2 mp = gl_FragCoord.xy / (14.0 * s1080) + vec2(0.0, -t * 0.4);
    vec2 mid = floor(mp);
    vec2 mo = fract(mp) - 0.25 - 0.5 * vec2(hash21(mid), hash21(mid + 7.1));
    float motes = step(0.9, hash21(mid + 3.3)) * exp(-dot(mo, mo) * 900.0);
    water += inkC * motes * 0.15;

    // Fish: dark backs, silver flanks that flash toward the light.
    float fl = flash * (0.6 + 0.5 * vxSwell + 1.1 * vxPulse) + 0.25 + 0.3 * vxPulse;
    vec3 silver = mix(inkC, vec3(0.8), 0.55);
    vec3 fishC = mix(silver * 0.2, mix(inkC, vec3(1.0), 0.75) * 1.1, clamp(0.15 + shine * fl, 0.0, 1.0));
    fishC = mix(fishC, acc * 1.2 + 0.2, glint);
    // The core of the ball is in its own shadow.
    float core = smoothstep(0.75, 0.0, r / R);
    fishC *= 1.0 - 0.35 * core * (1.0 - glint);

    float outA = 1.0;
    // A silver haze of fish too small to pick out fills the body of the ring.
    float band = smoothstep(1.2, 0.6, r / (R * (1.0 + burst * 0.7))) * smoothstep(0.1, 0.45, r / R);
    float haze = part * band * (0.16 + 0.1 * vxSwell) * (0.7 + 0.3 * vnoise(vec2(cos(th + turns * 4.0), sin(th + turns * 4.0)) * 4.0 + r * 20.0));
    vec3 hazeC = silver * 0.55;
    vec3 under = mix(water, hazeC, haze);
    vec3 outC = mix(under, fishC, cover);
    if (vxClear) {
        outA = cover + haze * (1.0 - cover);
        outC = fishC * cover + hazeC * haze * (1.0 - cover);
    }
    outC *= vxPresence;
    outA *= vxPresence;
    outC = min(clamp(outC, 0.0, 1.0), vec3(outA));
    gl_FragColor = vec4(outC, outA);
}
