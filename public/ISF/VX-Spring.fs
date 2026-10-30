/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A spring reverb tank seen from above: long coiled springs drawn as fine helices in perspective. Every hit of the sound it follows kicks a wave into the springs at the input end; it runs down the coils, bounces off the ends and spreads into a chirp, short ripples racing ahead of long ones, so you can watch the coils bunch and stretch as the boing rings out.",
    "PASSES": [
        {
            "TARGET": "hits",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 24,
            "HEIGHT": 24
        },
        {
            "TARGET": "wave",
            "FLOAT": true,
            "WIDTH": 129,
            "HEIGHT": 3
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 9, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "springs", "LABEL": "Springs", "TYPE": "float", "DEFAULT": 3, "MIN": 1, "MAX": 3 },
        { "NAME": "coils", "LABEL": "Coils", "TYPE": "float", "DEFAULT": 56, "MIN": 20, "MAX": 120 },
        { "NAME": "waveSpeed", "LABEL": "Wave speed", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "dispersion", "LABEL": "Dispersion", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "decay", "LABEL": "Decay", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "boing", "LABEL": "Boing", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "perspective", "LABEL": "Perspective", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "lineWidth", "LABEL": "Line width", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Coils", "TYPE": "color", "DEFAULT": [1.0, 0.72, 0.36, 1.0] },
        { "NAME": "accent", "LABEL": "Transducers", "TYPE": "color", "DEFAULT": [0.25, 0.9, 0.62, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// hits: a 3 x 3 grid of cells, each 8 x 8 texels and read at its centre. Cells 0..5
// hold the newest hits as (whole seconds of age, fraction of a second, velocity,
// hit number + 1); cell 8 holds (last count + 1, 0, 0, 0).
// wave: for each spring (row) and each coil boundary (column), the lengthwise
// displacement in coils and the local wave energy.
const float CELLS = 3.0;
const float SLOTS = 6.0;
const float WCOLS = 129.0;
const float HALF_LEN = 1.35;
const float RADIUS = 0.062;
const float GAP = 0.46;
const float TAU = 6.2831853;
const int SEGS = 14;

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec4 cellAt(float i) {
    return IMG_NORM_PIXEL(hits, vec2((mod(i, CELLS) + 0.5) / CELLS, (floor(i / CELLS) + 0.5) / CELLS));
}

float coilCount() {
    return floor(clamp(coils, 20.0, 120.0) + 0.5);
}

float springCount() {
    return floor(clamp(springs, 1.0, 3.0) + 0.5);
}

// Each spring in a tank has its own length, so its own delay.
float springSpeed(float j) {
    return j < 0.5 ? 1.0 : (j < 1.5 ? 0.83 : 1.19);
}

// Springs stack down the frame, each a little nearer than the one above.
vec2 springYZ(float j, float ns) {
    float o = j - 0.5 * (ns - 1.0);
    return vec2(-o * GAP, o * GAP * 0.45);
}

vec2 waveAt(float j, float c) {
    return IMG_NORM_PIXEL(wave, vec2((clamp(c, 0.0, WCOLS - 1.0) + 0.5) / WCOLS, (j + 0.5) / 3.0)).xy;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float dt = clamp(TIMEDELTA, 0.0, 0.1);

    if (PASSINDEX == 0) {
        float ci = floor(uv.x * CELLS) + CELLS * floor(uv.y * CELLS);
        vec4 meta = cellAt(8.0);
        float n = floor(vxCount + 0.5);
        bool ready = meta.x > 0.5 && FRAMEINDEX >= 2;
        bool fresh = ready && abs(meta.x - (n + 1.0)) > 0.5;
        if (ci < SLOTS - 0.5) {
            vec4 s = cellAt(ci);
            if (!ready) {
                s = vec4(0.0);
            } else {
                s.y += dt;
                if (s.y >= 1.0) {
                    s.y -= 1.0;
                    s.x = min(s.x + 1.0, 60.0);
                }
            }
            if (fresh && abs(ci - mod(n, SLOTS)) < 0.5) s = vec4(0.0, 0.0, clamp(vxVel, 0.2, 1.0), n + 1.0);
            gl_FragColor = s;
        } else {
            gl_FragColor = vec4(n + 1.0, 0.0, 0.0, 0.0);
        }
        return;
    }

    if (PASSINDEX == 1) {
        // Wave packets, worked out afresh each frame from the hit ages, so nothing
        // smears between frames. Seven partials share one hit; higher ones travel
        // faster (dispersion), so a packet spreads into a chirp as it runs.
        float N = coilCount();
        float c = min(floor(uv.x * WCOLS), N);
        float j = floor(uv.y * 3.0);
        float s = c / N;
        float speed = mix(0.35, 1.6, waveSpeed) * springSpeed(j);
        float kMin = TAU / 0.42;
        float kMax = TAU / max(0.05, 3.0 / N);
        float dsp = dispersion * 1.4;
        float T = mix(0.5, 4.5, decay);
        float xi = 0.0;
        float energy = 0.0;
        for (int i = 0; i < 6; i++) {
            vec4 sl = cellAt(float(i));
            if (sl.w > 0.5) {
                float age = sl.x + sl.y;
                float vel = sl.z;
                float seed = hash11((sl.w - 1.0) * 3.7 + j * 11.0);
                for (int m = 0; m < 7; m++) {
                    float fm = float(m) / 6.0;
                    float k = kMin * pow(kMax / kMin, fm);
                    float kr = k / kMax;
                    float vp = speed * (1.0 + dsp * kr * kr);
                    float vg = speed * (1.0 + 3.0 * dsp * kr * kr);
                    float lam = TAU / k;
                    float sig = 0.7 * lam + 0.025 + 0.03 * age * dsp;
                    float amp = vel * pow(lam / 0.42, 0.7) * exp(-age / T * (0.55 + 0.9 * kr));
                    float ctr = vg * age;
                    float ph = k * vp * age + seed * TAU;
                    // The straight run and its mirror image off the far end; each bounce inverts.
                    float n1 = floor((ctr - s) / 2.0 + 0.5);
                    float n2 = floor((ctr + s) / 2.0 + 0.5);
                    float x1 = s + 2.0 * n1;
                    float x2 = 2.0 * n2 - s;
                    float e1 = exp(-(x1 - ctr) * (x1 - ctr) / (2.0 * sig * sig));
                    float e2 = exp(-(x2 - ctr) * (x2 - ctr) / (2.0 * sig * sig));
                    // Nothing exists ahead of where the wave has had time to reach.
                    e1 *= step(x1, ctr + 3.0 * sig) * step(-3.0 * sig, x1);
                    e2 *= step(x2, ctr + 3.0 * sig) * step(-3.0 * sig, x2);
                    xi += amp * (e1 * sin(k * x1 - ph) - e2 * sin(k * x2 - ph));
                    energy += amp * amp * (e1 * e1 + e2 * e2) * (0.4 + kr);
                }
            }
        }
        // In coils: the wave can bunch the coils up to about one pitch.
        float boingAmt = mix(0.0, 1.3, boing);
        xi = boingAmt * 1.2 * tanh(xi * 1.1);
        // Fixed ends.
        xi *= smoothstep(0.0, 1.5, c) * smoothstep(N, N - 1.5, c);
        gl_FragColor = vec4(xi, energy, 0.0, 1.0);
        return;
    }

    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    vec2 fwp = fwidth(gl_FragCoord.xy);
    float pxs = max(1.0, max(fwp.x, fwp.y));
    float px = pxs / RENDERSIZE.y;
    float N = coilCount();
    float NS = springCount();

    // Camera: in front of the tank and above it, turned a little so the springs recede.
    float pitch = mix(0.12, 0.5, perspective);
    float yaw = mix(0.0, 0.34, perspective);
    float dist = 3.6;
    vec3 C = dist * vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch));
    vec3 fwd = normalize(-C);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    float F = 1.8;
    vec3 rd = normalize(right * p.x + up * p.y + fwd * F);

    float wire = 0.0;
    float glow = 0.0;
    float trans = 0.0;
    float hitFlash = 0.0;
    float lastAge = 99.0;
    for (int i = 0; i < 6; i++) {
        vec4 sl = cellAt(float(i));
        if (sl.w > 0.5) lastAge = min(lastAge, sl.x + sl.y);
    }
    hitFlash = exp(-lastAge / 0.18);

    for (int jj = 0; jj < 3; jj++) {
        float j = float(jj);
        if (j < NS) {
            vec2 yz = springYZ(j, NS);
            // Where this pixel's ray passes the spring's axis.
            vec3 A = vec3(0.0, yz);
            vec3 e = vec3(1.0, 0.0, 0.0);
            vec3 w0 = C - A;
            float b = dot(rd, e);
            float dd = dot(rd, w0);
            float ee = dot(e, w0);
            float den = 1.0 - b * b;
            float tr = (b * ee - dd) / den;
            float sa = (ee - b * dd) / den;
            float axisDist = length((C + rd * tr) - (A + e * sa));
            if (axisDist < RADIUS * 2.2 && abs(sa) < HALF_LEN + RADIUS * 3.0) {
                float q0 = (sa + HALF_LEN) / (2.0 * HALF_LEN) * N;
                float shift = waveAt(j, floor(q0 + 0.5)).x;
                float cBase = floor(q0 - shift);
                float spin = j * 1.7;
                for (int k = -2; k <= 2; k++) {
                    float c = cBase + float(k);
                    if (c >= 0.0 && c < N) {
                        vec2 wa = waveAt(j, c);
                        vec2 wb = waveAt(j, c + 1.0);
                        float en = 1.0 - exp(-0.35 * (wa.y + wb.y));
                        vec2 prev = vec2(0.0);
                        float prevFront = 0.0;
                        for (int g = 0; g <= SEGS; g++) {
                            float f = float(g) / float(SEGS);
                            float q = c + f;
                            float xi = mix(wa.x, wb.x, f);
                            float ang = TAU * f + spin;
                            vec3 off = vec3(0.0, RADIUS * sin(ang), RADIUS * cos(ang));
                            vec3 P = vec3(-HALF_LEN + 2.0 * HALF_LEN * (q + xi) / N, yz) + off;
                            vec3 v = P - C;
                            float Z = dot(v, fwd);
                            vec2 sp = vec2(dot(v, right), dot(v, up)) / Z * F;
                            // The half of each turn facing us is brighter than the half behind.
                            float front = smoothstep(-0.35, 0.35, dot(normalize(off), -fwd));
                            if (g > 0) {
                                vec2 ab = sp - prev;
                                vec2 ap = p - prev;
                                float h = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-10), 0.0, 1.0);
                                float d = length(ap - ab * h) / px;
                                float sig = mix(0.5, 1.3, lineWidth);
                                float core = exp(-d * d / (sig * sig));
                                float facing = mix(prevFront, front, h);
                                float lvl = mix(0.28, 1.0, facing);
                                wire = max(wire, core * lvl * (0.12 + 1.8 * en));
                                glow = max(glow, core * lvl * en);
                            }
                            prev = sp;
                            prevFront = front;
                        }
                    }
                }
            }

            // Transducers: a ring round each end of the spring, in the accent.
            for (int s2 = 0; s2 < 2; s2++) {
                float sx = s2 == 0 ? -HALF_LEN : HALF_LEN;
                float tp = (sx - C.x) / (abs(rd.x) > 1e-4 ? rd.x : 1e-4);
                vec3 Q = C + rd * tp;
                float rr = tp > 0.0 ? length(Q.yz - yz) : 9.0;
                float fwr = clamp(fwidth(rr), 1e-5, 0.01);
                float ring = exp(-pow((rr - RADIUS * 1.55) / fwr, 2.0) / 0.7);
                float ring2 = exp(-pow((rr - RADIUS * 0.45) / fwr, 2.0) / 0.6) * 0.5;
                float endEn = waveAt(j, s2 == 0 ? 1.0 : N - 1.0).y;
                float lvl = 0.16 + (s2 == 0 ? 0.9 * hitFlash : 0.0) + 0.8 * (1.0 - exp(-0.35 * endEn));
                trans = max(trans, max(ring, ring2) * lvl);
            }
        }
    }

    vec3 col = ink.rgb * (1.0 - exp(-wire * 1.4)) * 1.05;
    col += ink.rgb * 0.08 * glow;
    col += accent.rgb * min(trans, 1.2) * 0.8;
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
