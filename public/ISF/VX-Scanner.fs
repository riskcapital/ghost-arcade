/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A slit scanner. Every hit of the sound it follows sends a thin bar of light across the frame in about a beat, and as it passes it prints a record of horizontal hairlines: a code of rows and lengths drawn from the hit's velocity and its own seed. The prints fade slowly and each pass dims the one beneath it, so the frame builds a layered landscape of past sweeps. The sweep turns round every fourth hit; a red mark rides the bar's head.",
    "PASSES": [
        {
            "TARGET": "launchA",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "launchB",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "velA",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "velB",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "clock",
            "PERSISTENT": true,
            "FLOAT": true,
            "WIDTH": 1,
            "HEIGHT": 1
        },
        {
            "TARGET": "record",
            "PERSISTENT": true,
            "FLOAT": true
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 1, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "sweepBeats", "LABEL": "Sweep time (beats)", "TYPE": "float", "DEFAULT": 1, "MIN": 0.25, "MAX": 4 },
        { "NAME": "lineDensity", "LABEL": "Line density", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "rowCount", "LABEL": "Rows", "TYPE": "float", "DEFAULT": 120, "MIN": 30, "MAX": 300 },
        { "NAME": "printFade", "LABEL": "Print fade", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "lineLength", "LABEL": "Line length", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "barWidth", "LABEL": "Bar width", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "dirMode", "LABEL": "Direction", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2, 3], "LABELS": ["Turns every 4th hit", "Left to right", "Right to left", "Back and forth"] },
        { "NAME": "jitter", "LABEL": "Jitter", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Print", "TYPE": "color", "DEFAULT": [0.94, 0.95, 0.97, 1.0] },
        { "NAME": "accent", "LABEL": "Bar head", "TYPE": "color", "DEFAULT": [1.0, 0.16, 0.1, 1.0] },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxBeat", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// The printed field sits between these heights; the margins carry the bar's head marks.
const float FIELD_LO = 0.09;
const float FIELD_HI = 0.91;

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

float vnoise(float x) {
    float i = floor(x);
    float f = fract(x);
    return mix(hash11(i), hash11(i + 1.0), f * f * (3.0 - 2.0 * f));
}

// Direction of sweep m: 1 left to right, 0 right to left.
float dirOf(float m) {
    if (dirMode == 1) return 1.0;
    if (dirMode == 2) return 0.0;
    if (dirMode == 3) return mod(m, 2.0) < 0.5 ? 1.0 : 0.0;
    return mod(floor(m / 4.0), 2.0) < 0.5 ? 1.0 : 0.0;
}

// Where sweep m prints: each sweep lays down one band of the field (centre, half height).
vec2 bandOf(float m, float vel) {
    float c = mix(0.14, 0.86, hash11(m * 3.71 + 0.9));
    float h = mix(0.06, 0.2, hash11(m * 5.17 + 2.3)) * (0.7 + 0.3 * vel);
    return vec2(c, h);
}

// The code sweep m prints at physical row `row` and across-position u (0..1);
// negative where the sweep leaves the field alone (outside its band).
float printAt(float m, float vel, float row, float rowsPhys, float u, float wide) {
    float slotH = max(3.0, floor(rowsPhys / clamp(rowCount, 30.0, 300.0)));
    float s = floor(row / slotH);
    float slots = floor(rowsPhys / slotH);
    float seed = m * 7.13 + 3.1;
    float y = (s + 0.5) / max(slots, 1.0);
    vec2 bd = bandOf(m, vel);
    float inBand = wide > 0.5 ? 0.45 : 1.0 - smoothstep(bd.y * 0.75, bd.y, abs(y - bd.x));
    if (inBand <= 0.0) return -1.0;
    // Each slot holds one hairline, nudged off the even ruling by the jitter.
    float lineRow = floor(hash21(vec2(s, seed)) * (slotH - 1.0) * jitter + 0.5);
    if (row - s * slotH != lineRow) return 0.0;
    // Inside the band, strata of dense and sparse rows.
    float strata = vnoise(y * mix(14.0, 30.0, hash11(seed)) + seed);
    strata = smoothstep(0.2, 0.8, strata);
    float dens = clamp(lineDensity * (0.6 + 0.4 * vel) * (0.25 + 1.0 * strata) * inBand, 0.0, 0.95);
    if (hash21(vec2(s + 0.5, seed + 1.7)) >= dens) return 0.0;
    // Segments: runs of cells along the row, of a length set per row.
    float len = mix(0.008, 0.12, lineLength * lineLength) * mix(0.35, 1.8, hash21(vec2(s, seed + 4.4))) * (0.6 + 0.6 * vel);
    float x = u / len + hash21(vec2(s, seed + 9.2)) * 7.0;
    float c = floor(x);
    float keep = mix(0.4, 0.75, strata);
    if (hash21(vec2(c + 0.5, s + seed * 0.37)) > keep) return 0.0;
    // A sliver of dark between cells keeps runs readable as separate lines.
    if (fract(x) > 0.97 && hash21(vec2(c + 1.5, s + seed * 0.37)) <= keep) return 0.0;
    // A few lines burn at full; most are fine and dim.
    float b = hash21(vec2(s + 3.3, seed));
    float level = b < 0.16 ? 1.0 : mix(0.28, 0.6, b);
    return level * (0.7 + 0.3 * vel);
}

void main() {
    float n = floor(vxCount + 0.5);
    float dt = clamp(TIMEDELTA, 0.0, 0.1);
    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    float last = clk.r;
    bool fresh = FRAMEINDEX >= 2 && abs(n - last) > 0.5;

    // State in 1x1 targets: per slot (8 sweeps) 1 + seconds since launch, and velocity.
    if (PASSINDEX < 2) {
        vec4 v = PASSINDEX == 0 ? IMG_NORM_PIXEL(launchA, vec2(0.5)) : IMG_NORM_PIXEL(launchB, vec2(0.5));
        if (FRAMEINDEX < 2) v = vec4(0.0);
        vec4 alive = step(0.5, v);
        v = (v + dt) * alive;
        v *= 1.0 - step(30.0, v);
        if (fresh) {
            float slot = mod(n, 8.0) - (PASSINDEX == 0 ? 0.0 : 4.0);
            vec4 pick = 1.0 - step(0.5, abs(vec4(0.0, 1.0, 2.0, 3.0) - slot));
            v = mix(v, vec4(1.0), pick);
        }
        gl_FragColor = v;
        return;
    }
    if (PASSINDEX < 4) {
        vec4 v = PASSINDEX == 2 ? IMG_NORM_PIXEL(velA, vec2(0.5)) : IMG_NORM_PIXEL(velB, vec2(0.5));
        if (FRAMEINDEX < 2) v = vec4(0.0);
        if (fresh) {
            float slot = mod(n, 8.0) - (PASSINDEX == 2 ? 0.0 : 4.0);
            vec4 pick = 1.0 - step(0.5, abs(vec4(0.0, 1.0, 2.0, 3.0) - slot));
            v = mix(v, vec4(clamp(vxVel, 0.0, 1.0)), pick);
        }
        gl_FragColor = v;
        return;
    }
    if (PASSINDEX == 4) {
        // The count, the last beat position, seconds per beat (from the beat clock;
        // 120 bpm until it moves) and seconds since the last hit.
        float spb = (FRAMEINDEX < 2 || clk.b < 0.1) ? 0.5 : clk.b;
        float step01 = mod(vxBeat - clk.g + 1.0, 1.0);
        if (FRAMEINDEX >= 2 && dt > 0.0 && step01 > 0.0005 && step01 < 0.3) {
            float measured = clamp(dt / step01, 0.25, 1.4);
            spb = mix(spb, measured, 1.0 - exp(-dt / 0.6));
        }
        float quiet = (FRAMEINDEX < 2) ? 100.0 : (fresh ? 0.0 : min(clk.a + dt, 100.0));
        gl_FragColor = vec4(n, vxBeat, spb, quiet);
        return;
    }

    float spb = clamp(clk.b, 0.25, 1.4);
    float dur = max(sweepBeats, 0.25) * spb;
    vec4 ageA = IMG_NORM_PIXEL(launchA, vec2(0.5));
    vec4 ageB = IMG_NORM_PIXEL(launchB, vec2(0.5));
    vec4 vA = IMG_NORM_PIXEL(velA, vec2(0.5));
    vec4 vB = IMG_NORM_PIXEL(velB, vec2(0.5));
    // At rest a dim bar crawls across on the motion clock and prints faintly.
    float idle = smoothstep(2.0, 4.0, clk.a);
    float idleU = fract(vxPhase * 0.06);

    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(0.001));

    if (PASSINDEX == 5) {
        // The record: fades slowly, never lifts the black, and takes each new print.
        float v = IMG_NORM_PIXEL(record, uv).r;
        if (FRAMEINDEX < 2) v = 0.0;
        // At rest the faint idle print lingers much longer.
        float halfLife = mix(mix(0.6, 9.0, printFade * printFade), 40.0, idle);
        v = max(v * pow(0.5, dt / halfLife) - dt * 0.004, 0.0);
        vec2 phys = gl_FragCoord.xy / fw;
        vec2 physSize = RENDERSIZE / fw;
        float lo = floor(physSize.y * FIELD_LO);
        float hi = floor(physSize.y * FIELD_HI);
        float row = floor(phys.y) - lo;
        float u = uv.x;
        if (row >= 0.0 && floor(phys.y) < hi) {
            for (int k = 0; k < 8; k++) {
                float m = mod(n - float(k) + 64.0, 64.0);
                float slot = mod(m, 8.0);
                vec4 pickA = 1.0 - step(0.5, abs(vec4(0.0, 1.0, 2.0, 3.0) - slot));
                vec4 pickB = 1.0 - step(0.5, abs(vec4(4.0, 5.0, 6.0, 7.0) - slot));
                float stored = dot(ageA, pickA) + dot(ageB, pickB);
                if (stored > 0.5) {
                    float age = stored - 1.0;
                    float p1 = clamp(age / dur, 0.0, 1.0);
                    float p0 = clamp((age - dt) / dur, 0.0, 1.0);
                    float d = dirOf(m);
                    float u0 = d > 0.5 ? p0 : 1.0 - p1;
                    float u1 = d > 0.5 ? p1 : 1.0 - p0;
                    if (p1 > p0 && u >= u0 && u < u1) {
                        float vel = dot(vA, pickA) + dot(vB, pickB);
                        // The bar dims what it passes over, then prints its own code.
                        float pr = printAt(m, vel, row, hi - lo, u, 0.0);
                        if (pr >= 0.0) v = max(v * 0.25, pr);
                    }
                }
            }
            if (idle > 0.0) {
                float u1 = idleU;
                float u0 = idleU - 0.004;
                if (u >= u0 && u < u1) {
                    float ep = floor(vxPhase * 0.06) + 100.0;
                    v = max(v, max(printAt(ep, 0.3, row, hi - lo, u, 1.0), 0.0) * 0.45 * idle);
                }
            }
        }
        gl_FragColor = vec4(v, 0.0, 0.0, 1.0);
        return;
    }

    // Final: the record, the moving bars, and their head marks.
    float rec = IMG_NORM_PIXEL(record, uv).r;
    vec3 col = ink.rgb * min(rec, 1.0);
    float px = 1.0 / RENDERSIZE.x;
    float bw = max(mix(1.0, 4.0, barWidth) * RENDERSIZE.y / 1080.0, fw.x);
    float y = uv.y;
    float inField = step(FIELD_LO, y) * step(y, FIELD_HI);
    float bar = 0.0;
    float head = 0.0;
    for (int k = 0; k < 8; k++) {
        float m = mod(n - float(k) + 64.0, 64.0);
        float slot = mod(m, 8.0);
        vec4 pickA = 1.0 - step(0.5, abs(vec4(0.0, 1.0, 2.0, 3.0) - slot));
        vec4 pickB = 1.0 - step(0.5, abs(vec4(4.0, 5.0, 6.0, 7.0) - slot));
        float stored = dot(ageA, pickA) + dot(ageB, pickB);
        if (stored > 0.5) {
            float age = stored - 1.0;
            float p = age / dur;
            if (p < 1.0) {
                float d = dirOf(m);
                float bx = d > 0.5 ? p : 1.0 - p;
                float dx = (uv.x - bx) * RENDERSIZE.x;
                float ad = abs(dx);
                float core = clamp((0.5 * bw - ad) / fw.x + 0.5, 0.0, 1.0) * min(bw / fw.x, 1.0);
                // A short afterglow behind the bar, on the side it has printed.
                float behind = (d > 0.5 ? -dx : dx);
                float trail = behind > 0.0 ? exp(-behind / (RENDERSIZE.x * 0.006)) * 0.08 : 0.0;
                float fadeOut = 1.0 - smoothstep(0.92, 1.0, p);
                bar = max(bar, (core * (inField * 0.95 + 0.05) + trail * inField) * fadeOut);
                // The head: a short red tick in each margin, riding the bar.
                float tickH = RENDERSIZE.y * 0.035;
                float yPx = y * RENDERSIZE.y;
                float topD = RENDERSIZE.y * (1.0 - FIELD_HI) * 0.5;
                float inTick = step(abs(yPx - RENDERSIZE.y + topD), tickH * 0.5) + step(abs(yPx - topD), tickH * 0.5);
                float tw = max(bw * 2.0, 2.0 * fw.x);
                head = max(head, inTick * clamp((0.5 * tw - ad) / fw.x + 0.5, 0.0, 1.0) * fadeOut);
            }
        }
    }
    // The idle bar, dim.
    if (idle > 0.0) {
        float ad = abs(uv.x - idleU) * RENDERSIZE.x;
        float core = clamp((0.5 * bw - ad) / fw.x + 0.5, 0.0, 1.0) * min(bw / fw.x, 1.0);
        bar = max(bar, core * inField * 0.3 * idle);
    }
    col = max(col, ink.rgb * bar);
    col = mix(col, accent.rgb, clamp(head, 0.0, 1.0));

    float lum = max(col.r, max(col.g, col.b));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0 * step(0.004, lum);
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
