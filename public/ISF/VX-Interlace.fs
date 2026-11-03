/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A carousel of level meters turning in the dark, shown as interlaced video: every other line belongs to a second field that is drawn a moment later and carries a tint of the accent. Fast edges already comb a little. Hits of the sound it follows pull the two fields apart: the second field lags far behind so every moving edge splits into teeth, tears sideways, slips down a few lines into a ghost, or drops out and leaves the first field doubled into coarse lines; then the fields lock back together. Break picks which of these the hits do, Separation how far the fields come apart, Lines how coarse the line structure is, Spin how fast the carousel turns, Field tint how strongly the second field takes the accent, and Shimmer the flicker between fields.",
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
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 2, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "breakMode", "LABEL": "Break", "TYPE": "long", "DEFAULT": 0, "VALUES": [0, 1, 2, 3, 4], "LABELS": ["Take turns", "Comb", "Tear", "Slip", "Drop a field"] },
        { "NAME": "separation", "LABEL": "Separation", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "lines", "LABEL": "Lines", "TYPE": "float", "DEFAULT": 300, "MIN": 120, "MAX": 540 },
        { "NAME": "spin", "LABEL": "Spin", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "fieldTint", "LABEL": "Field tint", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "shimmer", "LABEL": "Shimmer", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "First field", "TYPE": "color", "DEFAULT": [0.75, 1.0, 0.92, 1.0] },
        { "NAME": "accent", "LABEL": "Second field", "TYPE": "color", "DEFAULT": [1.0, 0.45, 0.12, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxVel", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// clock (1x1): r last count seen, g seconds since the last hit,
// b the break this hit makes (0 comb, 1 tear, 2 slip, 3 drop), a its strength.

const float TAU = 6.2831853;
const int PANELS = 18;

float hash11(float x) {
    float p = fract(x * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float vnoise(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash11(i), hash11(i + 1.0), f);
}

// The carousel: a ring of level meters turning about a vertical axis, seen
// from a little above. p in frame-height units, origin in the middle; t is
// the motion clock for this field. Returns light and how much is accent.
vec2 carousel(vec2 p, float t, float px) {
    float rot = t * mix(0.15, 1.3, spin);
    vec3 ro = vec3(0.0, 2.6 + 0.25 * sin(t * 0.21), -8.8);
    vec3 rd = normalize(vec3(p.x, p.y - 0.06, 1.55));
    // Look down a little.
    float pitch = 0.11;
    rd = vec3(rd.x, rd.y * cos(pitch) - rd.z * sin(pitch), rd.y * sin(pitch) + rd.z * cos(pitch));
    float R = 2.7;
    float hw = 0.27;
    float best = 1e9;
    vec2 res = vec2(0.0);
    for (int i = 0; i < PANELS; i++) {
        float fi = float(i);
        float a = fi * TAU / float(PANELS) + rot;
        vec3 nrm = vec3(sin(a), 0.0, cos(a));
        vec3 tg = vec3(cos(a), 0.0, -sin(a));
        vec3 c = nrm * R;
        float den = dot(rd, nrm);
        if (abs(den) < 1e-4) continue;
        float tt = dot(c - ro, nrm) / den;
        if (tt <= 0.0 || tt >= best) continue;
        vec3 h = ro + rd * tt;
        float u = dot(h - c, tg);
        float lvl = 0.12 + 0.88 * clamp(pow(vnoise(fi * 3.7 + t * 1.6), 1.6) * 0.85 + vxEnv * 0.3 * hash11(fi + 2.0), 0.0, 1.0);
        float H = 3.2;
        if (abs(u) > hw || h.y < 0.0 || h.y > H) continue;
        best = tt;
        // Screen-space size of one pixel at this depth, for soft edges.
        float pw = px * tt / 1.55;
        float cells = 12.0;
        float cv = h.y / H * cells;
        float ci = floor(cv);
        float cf = fract(cv);
        float lit = step(ci + 0.5, lvl * cells);
        float isTop = step(abs(ci - floor(lvl * cells - 0.5)), 0.5) * lit;
        float gapY = smoothstep(0.0, pw / H * cells * 1.5, cf) * smoothstep(1.0, 1.0 - pw / H * cells * 1.5 - 0.18, cf);
        float gapX = smoothstep(hw, hw - pw * 1.5 - 0.04, abs(u));
        float cell = gapY * gapX;
        bool front = den < 0.0;
        float facing = abs(den);
        float shade = front ? 0.35 + 0.65 * facing : 0.18;
        float v = cell * (lit * shade + (1.0 - lit) * 0.025);
        // A thin frame round every meter.
        float frame = max(smoothstep(pw * 1.5, 0.0, abs(abs(u) - hw + 0.005)), smoothstep(pw * 1.5, 0.0, abs(h.y - H + 0.005)));
        v = max(v, frame * (front ? 0.3 : 0.07));
        float acc = isTop * cell + (front ? 0.0 : 0.6) * v;
        // Depth haze.
        float fog = exp(-max(tt - 7.5, 0.0) * 0.22);
        res = vec2(v * fog, clamp(acc, 0.0, 1.0));
    }
    // The floor: a ring and its spokes, faint, where no meter covers it.
    if (best > 1e8 && rd.y < 0.0) {
        float tt = -ro.y / rd.y;
        vec3 h = ro + rd * tt;
        float r = length(h.xz);
        float pw = px * tt / 1.55;
        float ring = smoothstep(pw * 2.0, 0.0, abs(r - R)) * 0.3 + smoothstep(pw * 2.0, 0.0, abs(r - R * 1.35)) * 0.12;
        float ang = atan(h.z, h.x) - rot;
        float spoke = smoothstep(pw * 2.0 / max(r, 0.1), 0.0, abs(fract(ang / TAU * float(PANELS)) - 0.5) / float(PANELS) * TAU) * step(r, R * 1.35) * step(R * 0.4, r) * 0.1;
        res = vec2((ring + spoke) * exp(-max(tt - 7.5, 0.0) * 0.2), 0.0);
    }
    return res;
}

void main() {
    float n = floor(vxCount + 0.5);

    if (PASSINDEX == 0) {
        vec4 c = IMG_NORM_PIXEL(clock, vec2(0.5));
        float dt = clamp(TIMEDELTA, 0.0, 0.1);
        if (FRAMEINDEX < 2) c = vec4(n, 30.0, 0.0, 0.0);
        bool newHit = abs(n - c.r) > 0.5;
        float age = min(c.g + dt, 30.0);
        float kind = c.b;
        float amt = c.a;
        if (newHit) {
            age = 0.0;
            kind = breakMode == 0 ? mod(n, 4.0) : float(breakMode - 1);
            amt = mix(0.6, 1.0, clamp(vxVel, 0.0, 1.0));
        }
        gl_FragColor = vec4(n, age, kind, amt);
        return;
    }

    vec4 clk = IMG_NORM_PIXEL(clock, vec2(0.5));
    float age = clk.g;
    float kind = clk.b;
    float amt = clk.a * separation;
    // How far apart the fields are: jumps on a hit, locks back over about a third of a second.
    float e = exp(-age * 7.0) * amt;
    float wob = exp(-age * 5.0) * cos(age * 22.0) * amt;

    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float top = 1.0 - uv.y;
    float L = floor(lines * 0.5 + 0.5) * 2.0;
    float rowF = top * L;
    float row = floor(rowF);
    float rf = rowF - row;
    float field = mod(row, 2.0);
    float px = 1.0 / RENDERSIZE.y;

    // The second field is drawn a little later in the motion; hits make it much later.
    float lag = 0.022 + (kind < 0.5 ? 0.5 * e : 0.12 * e);
    float t = vxPhase - (field > 0.5 ? lag : 0.0);
    float sampleRow = row;
    float xoff = 0.0;
    float drop = 0.0;
    if (field > 0.5) {
        if (kind > 0.5 && kind < 1.5) {
            // Tear: the second field swings sideways, worse lower down.
            xoff = wob * 0.09 * (0.4 + 0.6 * top);
        } else if (kind > 1.5 && kind < 2.5) {
            // Slip: the second field lands some lines low.
            sampleRow = row - floor(e * 26.0) * 2.0;
            xoff = e * 0.01;
        } else if (kind > 2.5) {
            // Drop: the second field goes dark, the first is doubled into it.
            drop = smoothstep(0.35, 0.6, e / max(amt, 0.01)) * step(0.05, amt);
        }
    }
    // While a field is dropped, the first field is shown doubled.
    float doubled = 0.0;
    if (kind > 2.5) doubled = smoothstep(0.25, 0.5, e / max(amt, 0.01)) * step(0.05, amt);
    vec2 res;
    if (field > 0.5 && drop > 0.5) {
        // Doubled line: this row repeats the first field's line above it.
        float yTop = (row - 1.0 + 0.5) / L;
        vec2 q = vec2((uv.x - 0.5) * aspect, 0.5 - yTop);
        res = carousel(q, vxPhase, px) * 0.85;
    } else {
        float yTop = (sampleRow + 0.5) / L;
        float yy = mix(top, yTop, 0.65 + 0.35 * doubled);
        vec2 q = vec2((uv.x - 0.5 - xoff) * aspect, 0.5 - yy);
        res = carousel(q, t, px);
    }

    // Each field's colour: the first in ink, the second leaning to the accent.
    vec3 fieldCol = field > 0.5 ? mix(ink.rgb, accent.rgb, mix(0.15, 0.7, fieldTint)) : ink.rgb;
    vec3 col = mix(fieldCol, accent.rgb, res.y) * res.x;
    // The line itself: a bright core with a dark gap between lines.
    float lineW = mix(0.75, 0.55, clamp(e * 2.0, 0.0, 1.0));
    float prof = smoothstep(0.5, 0.5 - lineW * 0.5, abs(rf - 0.5));
    col *= mix(0.25, 1.15, prof);
    // Field shimmer: the two fields pulse against each other a little.
    float flick = mod(float(FRAMEINDEX), 2.0);
    col *= 1.0 + (field == flick ? 1.0 : -1.0) * shimmer * (0.06 + 0.2 * e);
    col *= vxPresence;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
