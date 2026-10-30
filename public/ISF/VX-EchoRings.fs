/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "Tape echo drawn as rings. Every hit throws a thin ring out of a slowly wandering source, and the ring repeats like a dub delay: each echo lands on the echo time, fainter and softer than the last, walking off-centre and wavering with tape wow. Old echoes sink back into the dark.",
    "PASSES": [
        {
            "TARGET": "hits",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 80,
            "HEIGHT": 1
        },
        {
            "TARGET": "tape",
            "PERSISTENT": true,
            "FLOAT": true
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "echoTime", "LABEL": "Echo time", "TYPE": "long", "DEFAULT": 3, "VALUES": [0, 1, 2, 3], "LABELS": ["1/4 beat", "3/8 beat", "1/2 beat", "3/4 beat"] },
        { "NAME": "feedback", "LABEL": "Feedback", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ringWidth", "LABEL": "Ring width", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "expansion", "LABEL": "Expansion", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "wow", "LABEL": "Wow and flutter", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "drift", "LABEL": "Drift", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "zoom", "LABEL": "Trail zoom", "TYPE": "float", "DEFAULT": 0.35, "MIN": -1, "MAX": 1 },
        { "NAME": "trails", "LABEL": "Trails", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Echoes", "TYPE": "color", "DEFAULT": [1.0, 0.72, 0.36, 1.0] },
        { "NAME": "accent", "LABEL": "Dry ring", "TYPE": "color", "DEFAULT": [0.25, 0.9, 0.62, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxBeat", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// hits: slots 0..7 hold the newest hits as (age in seconds, centre x, centre y,
// 1 + velocity); slot 8 holds (last count + 1, beat length in seconds, last beat, ready).
// Each slot is 8 pixels wide and read at its centre, so it survives the core
// resampling small targets to its output density.
const float SLOTS = 8.0;
const float STATE_W = 10.0;

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// One line pixel in height units: never finer than the texel the core really renders,
// which can be coarser than RENDERSIZE suggests.
float pixelSize() {
    vec2 fw = fwidth(gl_FragCoord.xy);
    return max(1.0, max(fw.x, fw.y)) / RENDERSIZE.y;
}

vec4 slotAt(float i) {
    return IMG_NORM_PIXEL(hits, vec2((i + 0.5) / STATE_W, 0.5));
}

// The source wanders slowly round the middle of the frame (height units, centred).
vec2 sourceAt(float ph) {
    float a = ph * 0.7;
    float r = 0.05 + drift * 0.28;
    return vec2(sin(a * 0.83 + 1.1) * r * 1.2, sin(a * 1.21 + 0.4) * r * 0.8 + cos(a * 0.37) * r * 0.25);
}

float ringRadius(float age, float v0) {
    return v0 * age / (1.0 + 0.45 * age);
}

float ringSpeed(float age, float v0) {
    float k = 1.0 + 0.45 * age;
    return v0 / (k * k);
}

// One ring. x: the thin line. y: the band it swept through this frame (feeds the trails).
vec2 ringAt(vec2 p, vec2 c, float r, float oval, float ovalAng, float wPx, float sweepPx, float px) {
    vec2 q = p - c;
    float dist = length(q);
    float rr = r;
    if (oval > 0.0) {
        vec2 n = q / max(dist, 1e-5);
        float c2 = n.x * n.x - n.y * n.y;
        float s2 = 2.0 * n.x * n.y;
        rr = r * (1.0 + oval * (c2 * cos(ovalAng) + s2 * sin(ovalAng)));
    }
    float d = (dist - rr) / px;
    float line = exp(-d * d / (wPx * wPx)) + 0.045 * exp(-abs(d) / (wPx * 5.0));
    float b = (d + 0.5 * sweepPx) / (0.5 * sweepPx + wPx);
    return vec2(line, exp(-b * b));
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float dt = clamp(TIMEDELTA, 0.0, 0.1);

    if (PASSINDEX == 0) {
        float i = floor(gl_FragCoord.x / 8.0);
        vec4 meta = slotAt(SLOTS);
        float n = floor(vxCount + 0.5);
        bool ready = meta.w > 0.5;
        bool fresh = ready && abs(meta.x - (n + 1.0)) > 0.5;
        if (i < SLOTS) {
            vec4 s = slotAt(i);
            s.x += dt;
            if (!ready || FRAMEINDEX < 2) s = vec4(0.0);
            if (fresh && abs(i - mod(n, SLOTS)) < 0.5) {
                s = vec4(0.0, sourceAt(vxPhase), 1.0 + clamp(vxVel, 0.08, 1.0) * 0.999);
            }
            gl_FragColor = s;
        } else {
            // Beat length, measured from how fast the beat clock turns.
            float beatSec = meta.y > 0.05 ? meta.y : 0.5;
            float d = fract(vxBeat - meta.z + 1.0);
            if (ready && dt > 0.0001 && d > 0.0001 && d < 0.3) {
                beatSec = mix(beatSec, clamp(dt / d, 0.2, 2.0), 1.0 - exp(-dt * 3.0));
            }
            gl_FragColor = vec4(n + 1.0, beatSec, vxBeat, 1.0);
        }
        return;
    }

    if (PASSINDEX == 1) {
        vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
        float px = pixelSize();
        vec4 meta = slotAt(SLOTS);
        float beatSec = meta.y > 0.05 ? meta.y : 0.5;
        float et = float(echoTime);
        float echoBeats = et < 0.5 ? 0.25 : (et < 1.5 ? 0.375 : (et < 2.5 ? 0.5 : 0.75));
        float gap = echoBeats * beatSec;
        float fb = mix(0.32, 0.86, feedback);
        float repeats = clamp(ceil(log(0.06) / log(fb)), 1.0, 8.0);
        float v0 = mix(0.16, 1.0, expansion);
        float wPx = mix(0.55, 2.4, ringWidth);
        float wowPh = vxPhase * 1.7;

        float dry = 0.0;
        float wet = 0.0;
        float dep = 0.0;
        float lastAge = 99.0;
        for (int i = 0; i < 8; i++) {
            vec4 s = slotAt(float(i));
            if (s.w < 0.5) continue;
            float age = s.x;
            lastAge = min(lastAge, age);
            if (age > 4.5 + repeats * gap) continue;
            float vel = clamp(s.w - 1.0, 0.0, 1.0);
            float seed = hash21(s.yz * 173.0 + 7.0);
            // Every chain of repeats walks the same way, as if the tape slips; the way turns slowly.
            float wa = (s.y + s.z) * 2.0 + vxPhase * 0.05 + 0.8;
            vec2 dir = vec2(cos(wa), sin(wa));
            for (int k = 0; k < 8; k++) {
                float fk = float(k);
                if (fk >= repeats) break;
                float a = age - fk * gap;
                if (a < 0.0) break;
                float amp = vel * pow(fb, fk) * exp(-a * 1.6);
                if (amp < 0.004) continue;
                float r = ringRadius(a, v0);
                vec2 c = s.yz;
                float oval = 0.0;
                if (k > 0) {
                    // Each repeat walks a little further off and wavers like stretched tape.
                    float wk = wow * sqrt(fk);
                    c += dir * fk * 0.04 * (0.25 + drift);
                    c += wk * 0.01 * vec2(sin(wowPh * 1.3 + fk * 2.1 + seed * 9.0), cos(wowPh * 0.9 + fk * 1.7 + seed * 5.0));
                    r *= 1.0 + wk * 0.05 * sin(wowPh * 2.3 + fk * 1.9 + seed * 3.0);
                    oval = wk * 0.03;
                }
                float w = wPx * (1.0 + 0.3 * fk);
                float sweep = ringSpeed(a, v0) * dt / px;
                vec2 rb = ringAt(p, c, r, oval, wowPh * 0.7 + seed * 6.0 + fk, w, sweep, px);
                if (k == 0) {
                    // The dry ring leaves in the accent and cools to the ink as it spreads.
                    float green = 1.0 - smoothstep(0.05, 0.7, a);
                    dry += rb.x * amp * green;
                    wet += rb.x * amp * (1.0 - green);
                } else {
                    wet += rb.x * amp / sqrt(1.0 + 0.3 * fk);
                }
                dep += rb.y * amp;
            }
        }

        // Resting state: a slow, faint echo of nothing every few seconds.
        float quiet = smoothstep(1.5, 4.0, lastAge);
        if (quiet > 0.001) {
            float cyc = vxPhase / 0.9;
            float a0 = fract(cyc) * 4.5;
            vec2 c0 = sourceAt(vxPhase - fract(cyc) * 0.9);
            for (int k = 0; k < 3; k++) {
                float fk = float(k);
                float a = a0 - fk * 0.9;
                if (a < 0.0) break;
                float amp = 0.3 * quiet * pow(0.6, fk) * exp(-a * 0.35) * smoothstep(0.0, 0.7, a) * smoothstep(4.5, 3.0, a0);
                vec2 c = c0 + fk * vec2(0.006, -0.004) * (0.3 + drift);
                vec2 rb = ringAt(p, c, ringRadius(a, 0.2), wow * 0.02 * fk, wowPh, wPx * (1.0 + 0.5 * fk), 0.0, px);
                wet += rb.x * amp;
            }
        }

        // Trails: last frame pulled toward the source (zoom out) and faded.
        vec2 src = sourceAt(vxPhase);
        vec2 srcUV = src * vec2(RENDERSIZE.y / RENDERSIZE.x, 1.0) + 0.5;
        float f60 = dt * 60.0;
        vec2 suv = srcUV + (uv - srcUV) * (1.0 + zoom * 0.012 * f60);
        float inside = step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);
        float prev = IMG_NORM_PIXEL(tape, clamp(suv, 0.0, 1.0)).r * inside;
        float keep = pow(mix(0.8, 0.95, trails), f60);
        float trail = max(prev * keep - 0.0012 * f60, 0.0) + dep * trails * 0.08;
        if (FRAMEINDEX < 2) trail = 0.0;
        gl_FragColor = vec4(trail, wet, dry, quiet);
        return;
    }

    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float px = pixelSize();
    vec4 t = IMG_NORM_PIXEL(tape, uv);
    vec3 col = ink.rgb * (t.g + t.r * 0.8) + accent.rgb * t.b;

    // The source itself: a tiny point the rings leave from.
    float ds = length(p - sourceAt(vxPhase)) / px;
    col += ink.rgb * (0.16 + 0.3 * vxEnv) * exp(-ds * ds / 1.6);

    col = col / (1.0 + 0.3 * col);
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
