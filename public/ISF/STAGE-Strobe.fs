/*{
    "DESCRIPTION": "Strobes. Flash tubes, not a blinking screen: each unit fires a hard flash and then dies away along a real decay curve, with the bloom and the streak a hot tube throws. Five rigs: a full flood, a row of tubes, a grid of panels, lightning that forks across the frame, and a scatter of random pops. Fire on the beat, at a set rate, or in irregular bursts. Starts slow; fast full-frame flashing can trigger seizures in people with photosensitive epilepsy, so raise the rate with care. Bass sets how hard each flash hits, beats fire the flash, spectral centroid picks which units go.",
    "CREDIT": "Ghost Arcade 2.0 stage pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Xenon White", "Tungsten Flash", "UV", "Red Room", "Ice Blue", "Acid Green", "Two Tone"]},
        {"NAME": "rig",       "TYPE": "long",  "DEFAULT": 1,
         "VALUES": [0, 1, 2, 3, 4],
         "LABELS": ["Flood", "Tube row", "Panels", "Lightning", "Pops"]},
        {"NAME": "trigger",   "TYPE": "long",  "DEFAULT": 1,
         "VALUES": [0, 1, 2],
         "LABELS": ["On the beat", "Steady rate", "Bursts"]},
        {"NAME": "rate",      "TYPE": "float", "DEFAULT": 2.00, "MIN": 0.25, "MAX": 20.0},
        {"NAME": "decay",     "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.02, "MAX": 1.00},
        {"NAME": "units",     "TYPE": "float", "DEFAULT": 6.00, "MIN": 1.00, "MAX": 24.0},
        {"NAME": "unitRows",  "TYPE": "float", "DEFAULT": 3.00, "MIN": 1.00, "MAX": 12.0},
        {"NAME": "sequence",  "TYPE": "long",  "DEFAULT": 2,
         "VALUES": [0, 1, 2, 3],
         "LABELS": ["All together", "Chase", "Random units", "Alternate"]},
        {"NAME": "chance",    "TYPE": "float", "DEFAULT": 0.45, "MIN": 0.05, "MAX": 1.00},
        {"NAME": "tubeSize",  "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.10, "MAX": 1.00},
        {"NAME": "bloom",     "TYPE": "float", "DEFAULT": 0.60, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "streak",    "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "afterglow", "TYPE": "float", "DEFAULT": 0.20, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "branches",  "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "level",     "TYPE": "float", "DEFAULT": 0.90, "MIN": 0.00, "MAX": 1.50},
        {"NAME": "hueShift",  "TYPE": "float", "DEFAULT": 0.00, "MIN": 0.00, "MAX": 1.00},
        {"NAME": "exposure",  "TYPE": "float", "DEFAULT": 1.00, "MIN": 0.20, "MAX": 2.00}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * A xenon tube does not switch on and off. A capacitor dumps into it, the
 * gas flashes over in well under a millisecond, and the light then falls
 * away exponentially as the plasma cools. To the eye that is a hard white
 * hit with a short warm tail.
 *
 * Every unit here works from one number: the time since it last fired. The
 * brightness is a decay from that moment and the colour slides from white
 * toward the tube's own tint as it fades. Which unit fires on which flash is
 * decided by a hash of the flash count, so the pattern needs no memory.
 */

const float TAU = 6.28318530718;

float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash21(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}

float noise1(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash11(i), hash11(i + 1.0), f);
}

/* Tube colours. Columns: [flash, tail, second tube]. */
mat3 paletteFor(int mode) {
    vec3 a, b, c;
    if (mode == 1) {            /* Tungsten Flash */
        a = vec3(1.00, 0.94, 0.80);
        b = vec3(1.00, 0.46, 0.12);
        c = vec3(1.00, 0.80, 0.56);
    } else if (mode == 2) {     /* UV */
        a = vec3(0.70, 0.50, 1.00);
        b = vec3(0.30, 0.06, 0.90);
        c = vec3(0.90, 0.40, 1.00);
    } else if (mode == 3) {     /* Red Room */
        a = vec3(1.00, 0.30, 0.20);
        b = vec3(0.70, 0.02, 0.02);
        c = vec3(1.00, 0.60, 0.40);
    } else if (mode == 4) {     /* Ice Blue */
        a = vec3(0.80, 0.94, 1.00);
        b = vec3(0.10, 0.36, 1.00);
        c = vec3(0.50, 0.80, 1.00);
    } else if (mode == 5) {     /* Acid Green */
        a = vec3(0.80, 1.00, 0.60);
        b = vec3(0.16, 0.80, 0.06);
        c = vec3(0.90, 1.00, 0.20);
    } else if (mode == 6) {     /* Two Tone - cyan against magenta */
        a = vec3(0.50, 0.96, 1.00);
        b = vec3(0.06, 0.40, 0.90);
        c = vec3(1.00, 0.30, 0.86);
    } else {                    /* Xenon White */
        a = vec3(1.00, 1.00, 1.00);
        b = vec3(0.56, 0.70, 1.00);
        c = vec3(0.90, 0.95, 1.00);
    }
    return mat3(a, b, c);
}

vec3 hueRotate(vec3 c, float turns) {
    float a = turns * TAU;
    vec3 k = vec3(0.57735);
    return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}

/*
 * The clock: returns the index of the most recent flash and, in `age`, how
 * long ago it was, in seconds.
 */
float flashClock(int mode, float flashRate, float beatValue, out float age) {
    if (mode == 0) {
        /* The beat signal is 1 at the hit and falls away; treat it as age. */
        age = (1.0 - clamp(beatValue, 0.0, 1.0)) * 0.6;
        return floor(TIME * 2.0);
    }
    float ticks = TIME * flashRate;
    float index = floor(ticks);
    age = fract(ticks) / flashRate;
    if (mode == 2) {
        /* Bursts: runs of flashes with gaps between, like an operator's finger. */
        float burst = floor(TIME * flashRate / 6.0);
        float inBurst = step(0.45, hash11(burst * 3.7 + 1.0));
        age = mix(9.0, age, inBurst);
    }
    return index;
}

void main() {
    vec2 res = RENDERSIZE.xy;
    vec2 uv = (gl_FragCoord.xy - 0.5 * res) / res.y;
    vec2 st = gl_FragCoord.xy / res;
    float aspect = res.x / res.y;

    float bass = max(audioBass, 0.24 + 0.10 * sin(TIME * 0.21));
    float centroid = max(audioSpectralCentroid, 0.44 + 0.16 * sin(TIME * 0.12));
    float beat = audioBeat;

    int kind = int(rig);
    int seq = int(sequence);
    mat3 pal = paletteFor(int(colorMode));
    vec3 FLASH = hueRotate(pal[0], hueShift);
    vec3 TAIL = hueRotate(pal[1], hueShift);
    vec3 SECOND = hueRotate(pal[2], hueShift);

    float age;
    float index = flashClock(int(trigger), rate, beat, age);
    /* Decay time: from a click to a long bloom. */
    float tau = 0.012 + 0.45 * decay * decay;
    float hit = (0.75 + 0.55 * bass) * level;

    vec3 col = vec3(0.0);

    if (kind == 0) {
        /* Flood: the whole frame, brightest in the middle like a bank of them. */
        float e = exp(-age / tau);
        float shape = 1.0 - 0.45 * dot(uv, uv);
        col = mix(TAIL, FLASH, e) * e * shape * hit;
    } else if (kind == 1 || kind == 2) {
        /* Tubes in a row, or panels in a grid. */
        float nx = floor(units);
        float ny = kind == 1 ? 1.0 : floor(unitRows);
        vec2 g = vec2(st.x * nx, kind == 1 ? 0.5 : st.y * ny);
        vec2 id = floor(g);
        vec2 f = fract(g) - 0.5;
        if (kind == 1) f.y = (st.y - 0.5) * 1.0;
        float total = nx * ny;
        float serial = id.x + id.y * nx;

        /* Does this unit fire on flash number `index`, and when did it last? */
        float unitAge = 9.0;
        for (int back = 0; back < 4; back++) {
            float past = index - float(back);
            float fires;
            if (seq == 0)      fires = 1.0;
            else if (seq == 1) fires = step(abs(mod(past, total) - serial), 0.5);
            else if (seq == 3) fires = step(abs(mod(past + serial, 2.0)), 0.5);
            else               fires = step(hash21(vec2(serial * 1.7 + 3.0, past * 0.37 + centroid * 0.0)), chance);
            float since = age + float(back) / max(rate, 0.25);
            if (int(trigger) == 0) since = back == 0 ? age : 9.0;
            if (fires > 0.5) { unitAge = min(unitAge, since); }
        }
        float e = exp(-unitAge / tau);

        /* The tube: a long bright bar with rounded ends; a panel is squarer. */
        float cellAspect = kind == 1 ? (aspect / nx) / 1.0 : (aspect * ny) / nx;
        vec2 q = f * vec2(cellAspect, 1.0);
        vec2 box = kind == 1 ? vec2(cellAspect * 0.5 * (0.30 + 0.62 * tubeSize), 0.012 + 0.03 * tubeSize)
                             : vec2(cellAspect * 0.5, 0.5) * (0.35 + 0.55 * tubeSize);
        vec2 dq = abs(q) - box;
        float d = length(max(dq, 0.0)) + min(max(dq.x, dq.y), 0.0);
        float px = (kind == 1 ? 1.0 : ny) / res.y;
        float face = 1.0 - smoothstep(-px, px, d);
        float glow = exp(-max(d, 0.0) * (kind == 1 ? 20.0 : 14.0) / (0.4 + bloom)) * bloom;
        /* Bloom dies before the edge of the unit's slot, so slots never show. */
        glow *= smoothstep(0.5, 0.28, abs(f.x)) * (kind == 1 ? 1.0 : smoothstep(0.5, 0.28, abs(f.y)));
        /* Horizontal streak, the flare a lens puts across a hard source. */
        float flare = exp(-abs(q.y) * 60.0) * exp(-max(abs(q.x) - box.x, 0.0) * 3.0) * streak;
        vec3 tube = mix(TAIL, mod(serial, 2.0) < 0.5 || int(colorMode) != 6 ? FLASH : SECOND, e);
        col = tube * e * hit * (face * 1.6 + glow * 0.8 + flare * 0.7);
        /* The dead tube, faintly, so the rig is there between flashes. */
        col += TAIL * 0.03 * afterglow * face;
        /* Each flash also lifts the whole room a little. */
        col += tube * e * hit * 0.035 * bloom * smoothstep(0.5, 0.2, abs(f.x));
    } else if (kind == 3) {
        /* Lightning: a jagged bolt top to bottom, new each flash. */
        float e = exp(-age / (tau * 0.8));
        float flicker = 0.6 + 0.4 * step(0.5, fract(age * 45.0 + hash11(index)));
        float seed = index * 7.13;
        float startX = (hash11(seed + 1.0) - 0.5) * aspect * 0.9;
        float y = uv.y + 0.5;                                   /* 0 bottom .. 1 top */
        float path = startX
            + (noise1(y * 5.0 + seed) - 0.5) * 0.38
            + (noise1(y * 17.0 + seed * 3.0) - 0.5) * 0.10
            + (noise1(y * 53.0 + seed * 7.0) - 0.5) * 0.028;
        float d = abs(uv.x - path);
        float bolt = 0.0020 / (d * d * 40.0 + 0.00055) + exp(-d * 9.0) * 0.35 * bloom;
        /* A fork leaving the main channel part way down. */
        float forkAt = 0.35 + 0.4 * hash11(seed + 5.0);
        float forkDir = hash11(seed + 9.0) < 0.5 ? -1.0 : 1.0;
        float below = max(forkAt - y, 0.0);
        float forkPath = path + forkDir * below * (0.5 + 0.6 * hash11(seed + 11.0)) + (noise1(y * 29.0 + seed * 5.0) - 0.5) * 0.05 * step(0.001, below);
        float fd = abs(uv.x - forkPath);
        bolt += branches * step(0.001, below) * (0.0010 / (fd * fd * 40.0 + 0.00055)) * (1.0 - smoothstep(0.0, 0.45, below));
        /* The sky lights up behind it. */
        float sky = exp(-pow((uv.x - startX) * 1.4, 2.0)) * 0.22 * bloom;
        col = mix(TAIL, FLASH, e) * e * flicker * hit * (bolt + sky);
    } else {
        /* Pops: single small flashes scattered over the frame. */
        float cells = max(2.0, floor(units * 0.6));
        vec2 g = vec2(uv.x / aspect + 0.5, uv.y + 0.5) * vec2(cells * aspect, cells);
        vec2 id = floor(g);
        vec2 f = fract(g) - 0.5;
        float unitAge = 9.0;
        vec2 where = vec2(0.0);
        for (int back = 0; back < 3; back++) {
            float past = index - float(back);
            float h = hash21(id * 1.3 + past * 0.71 + 5.0);
            float since = age + float(back) / max(rate, 0.25);
            if (int(trigger) == 0) since = back == 0 ? age : 9.0;
            if (h < chance * 0.5 && since < unitAge) {
                unitAge = since;
                where = vec2(hash21(id + past + 1.0), hash21(id + past + 7.0)) - 0.5;
            }
        }
        float e = exp(-unitAge / tau);
        float d = length(f - where * 0.7);
        float r = 0.02 + 0.10 * tubeSize;
        float pop = r * r / (d * d + r * r * 0.12) * 0.12 + exp(-d * d / (r * r * 6.0)) * bloom * 0.5;
        float star = exp(-abs(f.y - where.y * 0.7) * 90.0) * exp(-abs(f.x - where.x * 0.7) * 5.0) * streak;
        col = mix(TAIL, FLASH, e) * e * hit * (pop + star);
    }

    /* The retina's own tail: a faint lift after any flash. */
    col += TAIL * afterglow * 0.02 * exp(-age / (tau * 6.0 + 0.05));

    col *= exposure;
    col = col / (1.0 + 0.14 * col);
    col *= 1.14;

    gl_FragColor = vec4(col, 1.0);
}
