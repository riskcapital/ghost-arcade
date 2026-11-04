/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A long-exposure photograph of a firefly swarm come to life: hundreds of tiny lights wheel in a slow whirlpool above a dark meadow, each drawing a curved, fading trail that breaks into dashes where it blinked, with soft out-of-focus lights drifting close to the lens. Alone they blink at random; as the music builds they fall into step and the whole swarm pulses on the beat. Every hit blooms the swarm outward in sweeping arcs that slow and drift back together, the music sets how fast the whirlpool turns and how long the trails grow, and the grass below catches their light.",
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
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 3, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "sync", "LABEL": "Sync", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "shower", "LABEL": "Bloom", "TYPE": "float", "DEFAULT": 0.65, "MIN": 0, "MAX": 1 },
        { "NAME": "trails", "LABEL": "Trails", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "swarm", "LABEL": "Swarm size", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "glow", "LABEL": "Glow", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "meadow", "LABEL": "Meadow", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Fireflies", "TYPE": "color", "DEFAULT": [0.72, 1.0, 0.4, 1.0] },
        { "NAME": "accent", "LABEL": "Warm light", "TYPE": "color", "DEFAULT": [1.0, 0.72, 0.3, 1.0] },
        { "NAME": "vxBeat", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxEnergy", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxMorph", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/


const float TAU = 6.2831853;
const float PI = 3.14159265;
// How the swarm is seen: squashed into a tilted disc.
const float SQUASH = 0.7;
// Seconds of the past a trail shows during the bloom.
const float TRAIL_S = 0.45;

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec4 hash42(vec2 p) {
    vec4 p4 = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
    p4 += dot(p4, p4.wzxy + 33.33);
    return fract((p4.xxyz + p4.yzzw) * p4.zywx);
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

// The whirlpool: two curling arms, thickest toward the middle.
float armField(float r, float th, float R, float spin) {
    float u = r / R;
    float a = 0.5 + 0.5 * cos(2.0 * (th - 2.6 * log(max(u, 0.05)) - spin));
    a = pow(a, 2.5);
    float body = smoothstep(1.15, 0.25, u);
    float core = exp(-u * u * 18.0);
    return clamp(body * (0.15 + 0.85 * a) + core * 0.8, 0.0, 1.0);
}

// hist (128x1): the last ~2.5 s of the music, newest at the left, one texel
// per HSTEP seconds: the pulse in red, the swell in green and the bloom (how
// far the swarm is flung out, built from the pulses) in blue. Trails read the
// bloom as it was when they were laid down, so they curve out and back.
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

vec4 histRead(float a) {
    float x = clamp(a / HSTEP, 0.0, HN - 1.001);
    float i = floor(x);
    return mix(histTexel(i), histTexel(i + 1.0), x - i);
}

float histAt(float a) {
    return a / HSTEP >= HN - 1.0 ? 0.0 : histRead(a).r;
}

// The bloom a seconds ago (0 at rest, up to about 1).
float bloomAt(float a) {
    return histRead(a).b;
}

// Pass 0: slide the record along by this frame's time and put the newest
// values at the front. The bloom is the pulses felt through a slow spring:
// out fast after each hit, then easing home within the beat.
vec4 histUpdate() {
    float dt = clamp(TIMEDELTA, 0.0, 0.1);
    float i = floor(gl_FragCoord.x);
    float sh = dt / HSTEP;
    float src = i - sh;
    float k = 0.0;
    k += 0.45 * histAt(0.05) + 0.6 * histAt(0.15) + 0.4 * histAt(0.3) + 0.18 * histAt(0.5);
    k += 0.06 * histAt(0.75);
    k += 0.3 * vxPulse;
    float bloom = 1.0 - exp(-k * 0.8);
    vec3 v;
    if (src < 0.0) {
        v = mix(histTexel(0.0).rgb, vec3(vxPulse, vxSwell, bloom), clamp(-src / max(sh, 1e-4), 0.0, 1.0));
    } else {
        float j = floor(src);
        v = mix(histTexel(j).rgb, histTexel(j + 1.0).rgb, src - j);
    }
    return vec4(v, 1.0);
}

// A firefly's flash at blink phase x: a quick bright rise, a slow fade and
// a dim glow in between; continuous all the way round the cycle.
float flashAt(float x) {
    x = fract(x);
    return 0.12 + smoothstep(0.0, 0.05, x) * exp(-max(x - 0.05, 0.0) * 6.0) * 1.3
         + 0.25 * exp(-pow((x - 0.2) * 9.0, 2.0));
}

// Warm-to-cool light for one firefly, from the two set colours.
vec3 tintFor(float k) {
    vec3 c = mix(ink.rgb, accent.rgb, k * k);
    return c / max(max(c.r, max(c.g, c.b)), 0.2);
}

void main() {
    if (PASSINDEX == 0) {
        gl_FragColor = histUpdate();
        return;
    }

    vec2 res = RENDERSIZE;
    float s1080 = res.y / 1080.0;
    vec2 p = (gl_FragCoord.xy - 0.5 * res) / res.y;
    // All motion runs on the music's flow clock.
    float t = vxFlow * 0.9;
    float flowRate = 0.25 + 1.4 * vxSwell + 0.9 * vxPulse;

    // In step: as the music builds, the beat takes over everyone's blink.
    float s = clamp(sync * (0.9 * vxEnergy + 0.6 * vxSwell), 0.0, 1.0);
    float blink = vxFlow * 2.2;
    float together = vxBeat;
    float pulse = flashAt(together) * s;
    float B = shower * 1.25;
    // A hit: a fast flare of every light, easing off.
    float flash = 0.65 * vxPulse + 0.35 * histAt(0.15);
    float pushNow = 1.0 + B * bloomAt(0.0);

    // The swarm floats above the grass, seen a little from the side.
    vec2 centre = vec2(0.08 * sin(t * 0.021), 0.07 + 0.03 * sin(t * 0.017));
    vec2 q = p - centre;
    float tilt = 0.22 * sin(t * 0.013);
    q = mat2(cos(tilt), sin(tilt), -sin(tilt), cos(tilt)) * q;
    q.y /= SQUASH;
    float r = length(q);
    float th = atan(q.y, q.x);
    // Screen pixels per unit of swarm space, roughly, for this direction.
    float pxs = res.y * sqrt(cos(th) * cos(th) + SQUASH * SQUASH * sin(th) * sin(th));
    float R = (0.34 + 0.2 * swarm) * (1.0 + 0.08 * vxSwell);
    float spin = t * 0.04;

    vec3 L = vec3(0.0);
    float cover = 0.0;

    // In-focus fireflies with long-exposure trails, laid on rings that turn
    // with the whirlpool. Each trail is the arc the firefly swept out, so it
    // curves with the flow, thins and fades toward its tail and breaks where
    // the firefly blinked off.
    {
        float cellPx = 52.0 * s1080;
        float dr = cellPx / res.y;
        float ring0 = floor(r / pushNow / dr);
        float coreR = 2.3 * s1080;
        for (int k = -2; k <= 3; k++) {
            float ring = ring0 + float(k);
            if (ring < 0.0) continue;
            float rc = (ring + 0.5) * dr;
            float nCells = max(floor(TAU * rc / dr), 1.0);
            float omega = (0.6 + 0.5 * trails) / (0.3 + rc / R);
            float headOff = omega * t * 0.12;
            float a = fract((th - headOff) / TAU) * nCells;
            float j0 = floor(a);
            for (int m = -1; m <= 2; m++) {
                float jw = mod(j0 + float(m), nCells);
                vec4 h = hash42(vec2(jw, ring) + 3.7);
                float thH = (jw + 0.5 + (h.x - 0.5) * 0.7) / nCells * TAU + headOff;
                float dens = armField(rc, thH, R, spin);
                if (h.z > dens * (0.7 + 0.3 * swarm)) continue;
                float rj = rc + (h.y - 0.5) * dr * 0.7;
                // How far behind its head this pixel is, along its path.
                float d = mod(thH - th + PI, TAU) - PI;
                // Trails grow with the speed of the flow: a long exposure of a
                // faster swarm draws longer streaks.
                float lang = (0.9 + 0.9 * h.w) * (0.4 + 1.6 * trails) * dr / max(rc, dr) * (0.55 + 0.6 * flowRate);
                float f = d / max(lang, 1e-4);
                float size = 0.7 + 0.6 * h.y;
                float headAng = 6.0 * coreR * size / (max(r, 0.02) * pxs);
                if (f < -headAng / max(lang, 1e-4) - 0.05 || f > 1.05) continue;
                float fc = clamp(f, 0.0, 1.0);
                // Radius at that moment: the bloom flings it out and back.
                // Each drifts a little in or out as it goes, so trails spiral rather than
                // ring the centre.
                float rt = rj * (1.0 + B * bloomAt(fc * TRAIL_S)) * (1.0 + (h.y - 0.5) * 0.35 * fc * lang);
                float across = (r - rt) * pxs;
                // The light it gave then: dashes where it blinked.
                float own = blink * (0.7 + 0.6 * h.y) + h.x;
                float inStep = together + 0.03 * h.x;
                float lit = mix(flashAt(own - fc * 0.9), flashAt(inStep - fc * 0.9), s);
                float taper = 1.0 - fc;
                float w = coreR * size * (0.35 + 0.65 * taper);
                float trailL = exp(-across * across / (2.0 * w * w)) * lit * taper * taper * step(0.0, f) * (0.55 + 0.6 * trails);
                // The head: a hot point inside a soft bloom.
                vec2 hd = vec2(d * r * pxs, (r - rj * pushNow) * pxs);
                float dh2 = dot(hd, hd);
                float headI = mix(flashAt(own), flashAt(inStep), s) + flash * 1.5;
                float sz = coreR * size * (1.0 + 0.25 * flash);
                float core = exp(-dh2 / (2.0 * sz * sz * 0.5));
                // Bloom and halo end smoothly inside the window this head is
                // looked up in, so no light gets clipped.
                float win = smoothstep(6.0 * sz, 3.0 * sz, sqrt(dh2));
                float bloom = exp(-sqrt(dh2) / (sz * (1.2 + 1.2 * glow))) * 0.4 * win;
                float halo = exp(-dh2 / (2.0 * pow(sz * 2.6, 2.0))) * (0.1 + 0.15 * glow) * win;
                vec3 tint = tintFor(h.w);
                L += tint * (trailL * 1.7 + (core * 2.2 + bloom + halo) * headI)
                   + vec3(1.0, 0.97, 0.9) * core * headI * 0.8;
                cover = max(cover, max(core * min(headI, 1.0), min(trailL * 1.6, 1.0)));
            }
        }
    }

    // Far fireflies: small, slightly soft points behind, no trails.
    {
        float cellPx = 24.0 * s1080;
        float dr = cellPx / res.y;
        float pushF = 1.0 + (pushNow - 1.0) * 0.8;
        float rh = r / pushF;
        float ring0 = floor(rh / dr);
        float sz = 1.5 * s1080;
        for (int k = -1; k <= 1; k++) {
            float ring = ring0 + float(k);
            if (ring < 0.0) continue;
            float rc = (ring + 0.5) * dr;
            float nCells = max(floor(TAU * rc / dr), 1.0);
            float omega = (0.6 + 0.5 * trails) / (0.3 + rc / R) * 0.8;
            float headOff = omega * t * 0.12;
            float a = fract((th - headOff) / TAU) * nCells;
            float j0 = floor(a);
            for (int m = -1; m <= 1; m++) {
                float jw = mod(j0 + float(m), nCells);
                vec4 h = hash42(vec2(jw, ring) + 91.3);
                float thH = (jw + 0.5 + (h.x - 0.5) * 0.7) / nCells * TAU + headOff;
                if (h.z > armField(rc, thH, R * 1.05, spin) * 0.6) continue;
                float rj = (rc + (h.y - 0.5) * dr * 0.7) * pushF;
                float d = mod(thH - th + PI, TAU) - PI;
                vec2 hd = vec2(d * r, r - rj) * pxs;
                float dh2 = dot(hd, hd);
                float I = (mix(flashAt(blink * (0.7 + 0.6 * h.y) + h.x), flashAt(together + 0.03 * h.x), s) + flash) * 0.55;
                float core = exp(-dh2 / (2.0 * sz * sz));
                float bloom = exp(-sqrt(dh2) / (sz * 3.0)) * 0.25;
                L += tintFor(h.w) * (core + bloom) * I;
                cover = max(cover, core * min(I, 1.0) * 0.8);
            }
        }
    }

    // The swarm's shared glow, in the shape of its arms, swelling on the beat.
    float cloudF = armField(r / (1.0 + (pushNow - 1.0) * 0.9), th, R, spin);
    float cloud = cloudF * (0.025 + 0.05 * glow) * (0.6 + 1.0 * pulse + 0.5 * vxSwell + flash * 0.8) / pushNow;
    cloud *= 0.8 + 0.2 * vnoise(q * 7.0 + vec2(t * 0.05, 0.0));
    L += mix(ink.rgb, accent.rgb, 0.3) * cloud;

    // Near the lens: a few big, soft, out-of-focus lights drifting past,
    // pinched into cat's eyes toward the frame's edges.
    vec2 fragPx = gl_FragCoord.xy;
    vec2 centrePx = 0.5 * res + centre * res.y;
    {
        float cell = 190.0 * s1080;
        vec2 drift = vec2(t * 3.0, sin(t * 0.02) * 20.0) * s1080;
        vec2 g = (fragPx - drift) / cell;
        vec2 id0 = floor(g);
        for (int j = -1; j <= 1; j++) {
            for (int i = -1; i <= 1; i++) {
                vec2 id = id0 + vec2(float(i), float(j));
                vec4 h = hash42(id + 17.0);
                vec2 home = (id + 0.2 + 0.6 * h.xy) * cell + drift;
                // Only near the swarm.
                vec2 fromC = (home - centrePx) / res.y;
                float near = exp(-dot(fromC, fromC) / (R * R * 1.4));
                if (h.z > near * 0.3) continue;
                vec2 pos = centrePx + (home - centrePx) * (1.0 + (pushNow - 1.0) * 0.5);
                float rb = (22.0 + 30.0 * h.w) * s1080;
                vec2 dd = fragPx - pos;
                vec2 edge = (pos - 0.5 * res) / (0.5 * res.y);
                vec2 off = -edge * rb * 0.45;
                float d1 = length(dd);
                float d2 = length(dd - off);
                float soft = (4.0 + 6.0 * h.z) * s1080;
                float disc = smoothstep(rb, rb - soft, d1) * smoothstep(rb, rb - soft, d2);
                // A real lens: a faint fill with a brighter rim and a little texture.
                float rim = 0.55 + 0.9 * smoothstep(rb * 0.6, rb - soft * 0.5, d1) + 0.1 * vnoise(dd / (6.0 * s1080) + h.xy * 50.0);
                float I = (0.25 + 0.45 * mix(flashAt(blink * (0.5 + 0.4 * h.y) + h.x), flashAt(together + 0.05 * h.x), s) + flash * 0.5) * 0.16;
                L += tintFor(h.y) * disc * rim * I;
                cover = max(cover, disc * min(I * 1.2, 0.2));
            }
        }
    }

    // Filmic tone curve: highlights roll off instead of clipping.
    vec3 Lx = L * (2.4 + 0.6 * vxSwell);
    vec3 lightC = clamp((Lx * (2.51 * Lx + 0.03)) / (Lx * (2.43 * Lx + 0.59) + 0.14), 0.0, 1.0);

    // Night meadow, lit by the swarm.
    vec2 uv = fragPx / res;
    vec3 inkC = ink.rgb;
    float swarmX = (fragPx.x - centrePx.x) / res.y;
    float spill = exp(-swarmX * swarmX / (R * R * 2.2)) * (0.7 + 0.6 * pulse + 0.4 * vxSwell + flash * 0.8);
    vec3 sky = mix(inkC * 0.03 + vec3(0.005, 0.007, 0.02), vec3(0.002, 0.003, 0.01), smoothstep(0.1, 1.0, uv.y));
    // Grass: thin, leaning, curved blades in three rows.
    float gx = fragPx.x / res.y;
    float bladeH = 0.0;
    for (int k = 0; k < 3; k++) {
        float fk = float(k);
        float fq = 90.0 + 70.0 * fk;
        float hgt = (0.05 + 0.11 * (1.0 - 0.3 * fk)) * meadow;
        // Blades lean and bend more toward their tips.
        float yrel = clamp((uv.y - 0.02) / max(hgt, 1e-3), 0.0, 1.0);
        float sway = 0.25 * sin(t * 0.08 + gx * 4.0 + fk * 2.0);
        float x = gx * fq + fk * 13.0;
        float id0 = floor(x);
        float hb = hash21(vec2(id0, fk));
        x += (hb - 0.5 + sway) * 1.6 * yrel * yrel;
        float id = floor(x);
        float hb2 = hash21(vec2(id, fk + 7.0));
        float shape = 1.0 - abs(fract(x) - 0.5) * 2.0;
        bladeH = max(bladeH, hgt * (0.35 + 0.65 * hb2) * pow(shape, 1.8));
    }
    float hill = 0.035 * meadow + 0.02 * vnoise(vec2(gx * 2.0, 1.0)) * meadow;
    float top = hill + bladeH;
    float below = top - uv.y;
    float ground = smoothstep(0.0, 1.2 / res.y, below);
    // Haze hanging over the grass, glowing under the swarm.
    float haze = exp(-max(uv.y - hill, 0.0) / 0.1) * (0.03 + 0.14 * spill) * meadow;
    sky += mix(inkC, accent.rgb, 0.3) * haze;
    // Blade edges catch the light from above.
    float rimG = exp(-max(below, 0.0) * res.y / (2.5 * s1080)) * ground;
    vec3 grassC = inkC * 0.006 + mix(inkC, accent.rgb, 0.3) * rimG * 1.6 * spill * meadow;
    vec3 bg = mix(sky, grassC, ground);

    float outA = 1.0;
    vec3 outC;
    // Light over the scene (screen-like), then very fine grain.
    outC = bg + lightC * (1.0 - bg);
    float grain = hash21(fragPx + fract(TIME * 7.13) * 97.0) - 0.5;
    outC += grain * (0.012 + 0.02 * max(outC.g, max(outC.r, outC.b)));
    if (vxClear) {
        // Cores solid, glow soft: coverage follows the light, a little ahead.
        // On its own the light is pushed brighter. Cores are solid; elsewhere
        // coverage follows the light so glows stay soft and never smoky.
        vec3 Lt = L * 4.0;
        vec3 lt = clamp((Lt * (2.51 * Lt + 0.03)) / (Lt * (2.43 * Lt + 0.59) + 0.14), 0.0, 1.0);
        float l = max(lt.r, max(lt.g, lt.b));
        float la = clamp(max(cover, l * 1.1), 0.0, 1.0);
        // A soft veil of night travels with the swarm, so the lights still
        // glow when the picture underneath is bright.
        float ru = r / (R * (1.0 + (pushNow - 1.0) * 0.7));
        float veil = 0.34 * exp(-ru * ru * 1.6) * smoothstep(1.6, 0.6, ru);
        outA = la + veil * (1.0 - la);
        outC = lt + (inkC * 0.02) * veil * (1.0 - la);
    }
    outC = max(outC, 0.0);
    outC *= vxPresence;
    outA *= vxPresence;
    outC = min(outC, vec3(outA));
    gl_FragColor = vec4(outC, outA);
}
