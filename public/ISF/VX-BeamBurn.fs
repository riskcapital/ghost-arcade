/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A vector beam on an old phosphor tube. The beam keeps drawing a looping figure whose shape follows the notes; its fresh trace burns hot in the ink color and leaves a long afterglow in the accent, and where it lingers it slowly burns a ghost into the glass. Every hit overdrives the beam: it flares and blooms, parks for an instant and scorches a spot, skips pieces of its path, kicks off in deflection spikes and leaves faint retraces beside itself. Afterglow sets how long the trace lingers, Burn-in how fast the glass scars and how slowly it clears, Overdrive how hard a hit pushes the beam, Damage how broken the beam gets on hits, Sweep how fast it draws and Figure the family of shapes.",
    "PASSES": [
        {
            "TARGET": "phos",
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
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 6, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "figure", "LABEL": "Figure", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2], "LABELS": ["Lissajous", "Rose", "Spiral knot"] },
        { "NAME": "sweep", "LABEL": "Sweep", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "afterglow", "LABEL": "Afterglow", "TYPE": "float", "DEFAULT": 0.65, "MIN": 0, "MAX": 1 },
        { "NAME": "burnIn", "LABEL": "Burn-in", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "overdrive", "LABEL": "Overdrive", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "damage", "LABEL": "Damage", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Trace", "TYPE": "color", "DEFAULT": [0.75, 1.0, 0.92, 1.0] },
        { "NAME": "accent", "LABEL": "Afterglow", "TYPE": "color", "DEFAULT": [1.0, 0.45, 0.12, 1.0] },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "vxGlide", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxBars", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// phos (full frame): r fresh trace, g afterglow, b burn-in, a overdrive heat.
// clock (1x1): last count seen, seconds since the last hit, beam position
// along its figure, last vxPhase seen. The phosphor pass runs first and works
// out this frame's clock from last frame's, so it knows where the beam was
// and where it is now; the clock pass then stores the same step.

const float TAU = 6.2831853;
const float WRAP = 402.1238597;   // 64 turns: where the beam position wraps
const int STEPS = 40;
const int GHOST_STEPS = 16;

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

float sweepRate() {
    return mix(2.0, 14.0, sweep * sweep);
}

// One step of the clock: (count, age, beam position, phase seen).
vec4 stepClock(vec4 c, float n) {
    float dt = clamp(TIMEDELTA, 0.0, 0.1);
    if (FRAMEINDEX < 2) c = vec4(n, 30.0, 0.0, vxPhase);
    bool newHit = abs(n - c.r) > 0.5;
    float age = newHit ? 0.0 : min(c.g + dt, 30.0);
    float dp = vxPhase - c.a;
    if (dp < 0.0 || dp > 2.0) dp = dt;
    // The beam runs with the sound's motion clock, never stops dead, and
    // parks for a moment right on a hit so it scorches a spot.
    float park = smoothstep(0.02, 0.07, age);
    float du = (dp * 0.8 + dt * 0.35) * sweepRate() * mix(0.04, 1.0, park);
    float u = c.b + du;
    if (u > WRAP) u -= WRAP;
    return vec4(n, age, u, vxPhase);
}

// The figure, in frame-height units round the centre of the frame.
vec2 figurePoint(float u, float shape, float glide, float bars) {
    vec2 q;
    if (figure == 0) {
        // Lissajous: the second ratio follows the note, and the figure turns in depth.
        float fy = 2.0 + floor(shape * 4.0);
        float fx = fy + 1.0 + 0.012 + glide * 0.01;
        float ph = u * 0.006 + bars * 0.7;
        float z = sin(u * 1.0 + ph);
        q = vec2(sin(fx * u * 0.5 + ph), sin(fy * u * 0.5));
        float a = 0.35 * sin(u * 0.004 + bars);
        q = vec2(q.x * cos(a) - z * 0.25 * sin(a), q.y) * vec2(0.62, 0.4);
    } else if (figure == 1) {
        // A rose whose petal count follows the note.
        float k = 3.0 + floor(shape * 5.0) + 0.01;
        float r = cos(k * u * 0.25) * (0.88 + 0.12 * sin(u * 0.05));
        float a = u * 0.25 + bars * 0.4;
        q = vec2(cos(a), sin(a)) * r * 0.42;
    } else {
        // A spiral knot: two circles beating against each other.
        float k = 3.0 + floor(shape * 4.0);
        float a = u * 0.5;
        q = vec2(cos(a), sin(a)) * 0.27 + vec2(cos(-a * (k - 1.0) + glide), sin(-a * (k - 1.0) + glide)) * 0.15;
        q *= 1.0 + 0.06 * sin(u * 0.01);
    }
    return q;
}

float segDist(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    vec2 ap = p - a;
    float h = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-9), 0.0, 1.0);
    return length(ap - ab * h);
}

void main() {
    float n = floor(vxCount + 0.5);
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;

    if (PASSINDEX == 1) {
        gl_FragColor = stepClock(IMG_NORM_PIXEL(clock, vec2(0.5)), n);
        return;
    }

    vec2 fwp = fwidth(gl_FragCoord.xy);
    float px = max(1.0, max(fwp.x, fwp.y)) / RENDERSIZE.y;

    if (PASSINDEX == 0) {
        vec4 old = IMG_NORM_PIXEL(clock, vec2(0.5));
        vec4 c = stepClock(old, n);
        float age = c.g;
        // A held hit flash pins the age, so the overdrive shows while it lasts.
        if (vxHit > 0.01) age = min(age, (1.0 - clamp(vxHit, 0.0, 1.0)) * 0.1);
        float u1 = c.b;
        float u0 = FRAMEINDEX < 2 ? u1 - 0.05 : old.b;
        if (u0 > u1) u0 -= WRAP;
        float span = min(u1 - u0, 3.0);
        u0 = u1 - max(span, 0.0005);

        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        vec4 prev = IMG_NORM_PIXEL(phos, uv);
        if (FRAMEINDEX < 2) prev = vec4(0.0);
        // Decay: fresh trace in a flash, afterglow over seconds, burn over most of a minute.
        float tauG = mix(0.25, 3.0, afterglow * afterglow);
        float tauB = mix(6.0, 45.0, burnIn);
        vec4 ph = prev * vec4(exp(-dt / 0.14), exp(-dt / tauG), exp(-dt / tauB), exp(-dt / 0.25));

        vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
        float vel = clamp(vxVel, 0.0, 1.0);
        float od = n > 0.5 ? exp(-age / mix(0.08, 0.3, overdrive)) * mix(0.5, 1.0, vel) * overdrive : 0.0;
        float broken = n > 0.5 ? clamp(1.0 - age / mix(0.08, 0.3, damage), 0.0, 1.0) * damage : 0.0;
        float shape = clamp(vxGlide, 0.0, 1.0);
        float glide = shape;
        float bars = floor(vxBars + 0.5);
        float sigma = px * mix(1.35, 2.4, od);

        float dep = 0.0;
        float spike = 0.0;
        vec2 a = figurePoint(u0, shape, glide, bars);
        for (int i = 1; i <= STEPS; i++) {
            float fi = float(i);
            float u = mix(u0, u1, fi / float(STEPS));
            vec2 b = figurePoint(u, shape, glide, bars);
            vec2 aa = a;
            vec2 bb = b;
            float on = 1.0;
            if (broken > 0.0) {
                float hk = hash21(vec2(floor(u * 9.0), n + 0.5));
                // Blanking failures: pieces of the path go missing.
                if (hk < broken * 0.4) on = 0.0;
                // Deflection kicks: the beam is thrown off its path and snaps back.
                if (hk > 1.0 - broken * 0.3) {
                    vec2 kick = (vec2(hash11(hk * 91.0 + n), hash11(hk * 37.0 + n * 1.7)) - 0.5) * vec2(0.8, 0.5);
                    float fa = fract(mix(u0, u1, (fi - 1.0) / float(STEPS)) * 9.0);
                    float fb = fract(u * 9.0);
                    float ta = 1.0 - abs(fa * 2.0 - 1.0);
                    float tb = 1.0 - abs(fb * 2.0 - 1.0);
                    if (fb < fa) tb = 0.0;
                    aa = a + kick * pow(ta, 3.0) * broken;
                    bb = b + kick * pow(tb, 3.0) * broken;
                    spike = max(spike, exp(-pow(segDist(p, aa, bb) / (px * 1.2), 2.0)) * 0.7);
                    on = 0.0;
                }
            }
            float len = length(bb - aa);
            float dwell = clamp(0.004 / (len + 0.0008), 0.05, 4.0);
            float d = segDist(p, aa, bb);
            dep = max(dep, on * dwell * exp(-d * d / (2.0 * sigma * sigma)));
            a = b;
        }
        dep = min(dep, 6.0);

        // Ghost retraces beside the beam while it is overdriven.
        float ghost = 0.0;
        if (od > 0.02 || broken > 0.02) {
            vec2 off = (vec2(hash11(n * 3.1), hash11(n * 5.3)) - 0.5) * 0.06 * (0.3 + damage);
            float lag = 0.6 + hash11(n * 1.9) * 1.5;
            vec2 ga = figurePoint(u0 - lag, shape, glide, bars) + off;
            for (int i = 1; i <= GHOST_STEPS; i++) {
                float u = mix(u0, u1, float(i) / float(GHOST_STEPS)) - lag;
                vec2 gb = figurePoint(u, shape, glide, bars) + off;
                float d = segDist(p, ga, gb);
                ghost += exp(-d * d / (2.0 * px * px * 1.6));
                ga = gb;
            }
            ghost *= max(od, broken) * 0.5;
        }

        float gain = 0.55 + 1.8 * od;
        float fresh = dep * gain;
        ph.r = max(ph.r, fresh) + ghost * 0.3 + spike;
        ph.g = min(ph.g + fresh * 0.9 + ghost * 0.6 + spike * 0.6, 5.0);
        // Burn: the glass scars where the beam dwells, faster when overdriven.
        ph.b = min(ph.b + dep * mix(0.0, 0.02, burnIn) * (0.25 + 3.0 * od) * dt * 30.0, 1.5);
        ph.a = max(ph.a, dep * od * 1.5 + spike * od);
        gl_FragColor = ph;
        return;
    }

    // Show: the trace, its afterglow, the scar and a soft bloom where it is hot.
    vec4 ph = IMG_NORM_PIXEL(phos, uv);
    vec2 bpx = vec2(px * RENDERSIZE.y) / RENDERSIZE;
    vec3 bloom = vec3(0.0);
    // A soft bloom: taps on two rings, turned per pixel so they never show as copies.
    float spin = hash21(gl_FragCoord.xy) * TAU;
    for (int i = 0; i < 8; i++) {
        float a = float(i) * TAU / 8.0 + spin;
        vec2 o = vec2(cos(a), sin(a));
        float r1 = 3.0 + 5.0 * hash11(float(i) + spin);
        vec4 s1 = IMG_NORM_PIXEL(phos, uv + o * bpx * r1);
        vec4 s2 = IMG_NORM_PIXEL(phos, uv - o.yx * vec2(1.0, -1.0) * bpx * r1 * 2.6);
        bloom += vec3(s1.r + s1.a, s1.g, s2.r + s2.a * 1.5 + s2.g * 0.3);
    }
    bloom /= 8.0;

    float fresh = ph.r;
    float glow = ph.g;
    float heat = ph.a;
    vec3 hot = mix(ink.rgb, vec3(1.0), 0.45);
    vec3 col = vec3(0.0);
    col += accent.rgb * (1.0 - exp(-glow * 1.1));
    col += ink.rgb * (1.0 - exp(-fresh * 1.6)) * 1.1;
    col += hot * smoothstep(0.8, 3.5, fresh) * 0.35;
    col += accent.rgb * (1.0 - exp(-heat * 0.8)) * 0.6;
    col += ink.rgb * bloom.x * 0.22 + accent.rgb * (bloom.y * 0.16 + bloom.z * 0.08);
    // The scar: a dim brown-gold ghost in the grain of the glass.
    float grain = 0.75 + 0.5 * hash21(floor(gl_FragCoord.xy / max(fwp, vec2(1.0))));
    vec3 scar = mix(accent.rgb, ink.rgb, 0.25) * 0.5;
    col += scar * (1.0 - exp(-ph.b * 1.5)) * 0.45 * grain;

    col = col / (1.0 + max(max(col.r, col.g), col.b) * 0.25);
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
