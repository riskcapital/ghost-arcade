/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A pen plotter at work on a black sheet. Hundreds of hairline strokes follow a stream that bends round a few round obstacles and winds into eddies, each stroke growing from its start as a pen draws it, a bright point at its tip. Stroke is laid over stroke, the stream shifting a little between passes, until the sheet is dense with flowing lines; then a wiper sweeps it clean and a new stream begins. The sound's motion moves the pens, so the drawing grows with the music; its level puts more pens to the paper; each hit lifts a set of pens to new starting points, and the strokes they draw next are in the accent color. With no sound the drawing rests as it is.",
    "PASSES": [
        {
            "TARGET": "sheet",
            "PERSISTENT": true,
            "FLOAT": true
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 6, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "pens", "LABEL": "Pens", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "reach", "LABEL": "Line length", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "scale", "LABEL": "Field scale", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "wipe", "LABEL": "Wipe", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Ink", "TYPE": "color", "DEFAULT": [0.86, 0.92, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Strokes after a hit", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// The drawing is made in passes. During one pass the stream holds still and a set of pens each draw one
// stroke along it; the next pass uses a stream turned and shifted a little. A sheet takes a number of
// passes, then it is wiped.
//
// The target "sheet" holds the drawing: red is the ink (only ever the brightest laid at a pixel),
// green marks ink laid after a hit (the hit's number plus one), blue is which sheet the ink belongs to.
// Each frame lays again the whole recent run of every stroke in progress, so nothing depends on how
// many frames have gone by or on how late the target reads back.

// Passes to a sheet, at most, and the length of one pass on the sound's clock.
const int MAX_PASSES = 26;
const float PASS_LEN = 1.2;
// The part of a sheet's first pass that the wiper takes to cross it.
const float WIPE_PART = 0.4;
// The sheet's margin, in screen heights.
const float MARGIN = 0.045;
const float TAU = 6.2831853;

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

// The way the stream runs on sheet S during pass m: it turns a little from pass to pass.
float streamAngle(float S, float m) {
    float way = hash11(S * 5.3 + 2.0) < 0.5 ? -1.0 : 1.0;
    return hash11(S * 3.17 + 0.5) * TAU + way * (m - 9.0) * 0.011;
}

// The stream at p: (stream function, its slope along x, its slope along y, clearance from the obstacles).
// Lines of equal stream function are the paths the water takes: it parts round three round obstacles,
// winds round two eddies and sways in a slow swell.
vec4 stream(vec2 p, float S, float m, float fs) {
    float al = streamAngle(S, m);
    vec2 nrm = vec2(-sin(al), cos(al));
    float psi = dot(p, nrm);
    vec2 g = nrm;
    float clearance = 1.0;
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        vec2 c = (vec2(hash11(S * 7.1 + fi * 3.3 + 1.0), hash11(S * 9.7 + fi * 5.1 + 2.0)) - 0.5) * vec2(1.45, 0.78);
        c += (vec2(hash11(S + fi * 2.2 + 4.0), hash11(S + fi * 4.4 + 6.0)) - 0.5) * 0.012 * m;
        float a = (0.06 + 0.12 * hash11(S * 2.3 + fi * 7.7 + 3.0)) / fs;
        vec2 d = p - c;
        float R2 = max(dot(d, d), 1e-5);
        float Y = dot(d, nrm);
        psi -= a * a * Y / R2;
        g -= a * a * (nrm / R2 - 2.0 * Y * d / (R2 * R2));
        float R = sqrt(R2);
        if (R < a) {
            // Inside an obstacle nothing flows: the pens rule it with rings instead.
            return vec4(a - R, -d / R, 0.5 * a - abs(R - 0.5 * a));
        }
        clearance = min(clearance, R - a);
    }
    for (int i = 0; i < 2; i++) {
        float fi = float(i);
        vec2 c = (vec2(hash11(S * 4.9 + fi * 6.1 + 8.0), hash11(S * 6.3 + fi * 2.7 + 9.0)) - 0.5) * vec2(1.3, 0.7);
        c += (vec2(hash11(S + fi * 3.1 + 11.0), hash11(S + fi * 5.9 + 13.0)) - 0.5) * 0.01 * m;
        float gam = (0.035 + 0.05 * hash11(S * 8.1 + fi * 1.9 + 10.0)) * (hash11(S * 1.3 + fi + 12.0) < 0.5 ? -1.0 : 1.0) / fs;
        vec2 d = p - c;
        float R2 = dot(d, d) + 0.0003;
        psi += gam * 0.5 * log(R2);
        g += gam * d / R2;
    }
    float ph = hash11(S * 2.7 + 14.0) * TAU + m * 0.05;
    vec2 k1 = vec2(cos(al + 0.9), sin(al + 0.9)) * 4.2 * fs;
    vec2 k2 = vec2(cos(al - 1.3), sin(al - 1.3)) * 7.1 * fs;
    psi += 0.022 * sin(dot(p, k1) + ph) + 0.011 * sin(dot(p, k2) + ph * 1.7);
    g += 0.022 * cos(dot(p, k1) + ph) * k1 + 0.011 * cos(dot(p, k2) + ph * 1.7) * k2;
    return vec4(psi, g, clearance);
}

// The ink one set of pens lays at a point: (ink, how near the pixel is to a pen's tip).
// st is the stream there and phi the distance along it. The stream is ruled into bands a gap wide;
// each band has one path, and a pen draws dashes of that path, each growing from its start.
// seed names the set of pens, grown is how far through their strokes they are (0-1),
// recent how far back from the tip to lay (as a part of the stroke; over 1 lays it all),
// share how many of the bands have a pen down.
vec2 strokes(vec4 st, float phi, float seed, float grown, float recent, float share, float gap, float len, float px) {
    float g = max(length(st.yz), 1e-4);
    float kk = floor(st.x / gap);
    vec2 id = vec2(kk, seed);
    if (hash21(id + 5.1) >= share) return vec2(0.0);
    float jit = (hash21(id + 0.37) - 0.5) * 0.7;
    // Distance from the path in pixels, and the spacing of neighboring paths in pixels:
    // where the stream squeezes them closer than a few pixels, the pens lift.
    float dpx = abs(st.x - (kk + 0.5 + jit) * gap) / (g * px);
    float room = smoothstep(2.4, 4.5, gap / (g * px)) * smoothstep(0.0, 2.0 * px, st.w);
    float way = hash21(id + 9.3) < 0.5 ? -1.0 : 1.0;
    float period = len * 1.7 + 0.12;
    float s = phi * way + hash21(id + 2.9) * period;
    float cell = floor(s / period);
    float loc = s - cell * period;
    float Lc = len * (0.35 + 0.85 * hash21(id + cell * 0.71 + 3.3));
    // Pens start at different moments of the pass.
    float begun = hash21(id + cell * 1.31 + 7.7) * 0.4;
    float gk = clamp((grown - begun) / 0.6, 0.0, 1.0);
    float tipAt = Lc * gk;
    float from = Lc * max(gk - recent, 0.0);
    float along = clamp((loc - from) / px + 0.5, 0.0, 1.0) * clamp((tipAt - loc) / px + 0.5, 0.0, 1.0);
    float across = clamp(0.95 - dpx, 0.0, 1.0);
    float hw = hash21(id + cell * 0.37 + 1.9);
    float weight = 0.34 + 0.66 * hw * hw;
    float laid = across * along * room * weight * step(1e-4, gk);
    float dt = (loc - tipAt) / (1.7 * px);
    float tip = exp(-dt * dt - dpx * dpx * 0.35) * room * step(1e-4, gk) * step(gk, 0.999);
    return vec2(laid, tip);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 p = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
    // The size of one stored pixel: the core may keep this layer coarser than its render size.
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(0.001));
    float px = max(fw.x, fw.y) / RENDERSIZE.y;

    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);
    float n = floor(vxCount + 0.5);

    // The sheet's clock runs with the sound, with a trace of drift so it never quite stops.
    // It starts part of the way through a sheet, so there is a drawing to see from the first frame.
    float span = floor(mix(9.0, float(MAX_PASSES), wipe) + 0.5);
    float clock = (vxFlow + TIME * 0.02) / PASS_LEN + floor(span * 0.62) + 0.45;
    float pass = floor(clock);
    float f = clock - pass;
    float S = floor(pass / span);
    float m = pass - S * span;

    float fs = mix(0.7, 1.7, scale);
    float gap = mix(0.042, 0.013, pens);
    float len = mix(0.18, 1.1, reach);
    // More pens are down the louder the sound.
    float share = 0.3 + 0.65 * sw;

    // The sheet inside its margin.
    vec2 half2 = vec2(0.5 * asp - MARGIN, 0.5 - MARGIN);
    float onSheet = step(abs(p.x), half2.x) * step(abs(p.y), half2.y);

    // The wiper crosses the sheet during the first part of a sheet's first pass.
    float wa = floor(hash11(S * 6.1 + 3.0) * 4.0) * 0.25 * TAU + 0.12;
    vec2 wdir = vec2(cos(wa), sin(wa));
    float wext = abs(wdir.x) * 0.5 * asp + abs(wdir.y) * 0.5;
    float wcoord = (dot(p, wdir) + wext) / (2.0 * wext);
    bool wiping = m < 0.5 && f < WIPE_PART;
    float wiped = f / WIPE_PART;

    // The stream of this pass, and the one the latest hit's pens follow (it holds still for as long as they draw).
    float al = streamAngle(S, m);
    vec4 st = stream(p, S, m, fs);
    float phi = dot(p, vec2(cos(al), sin(al)));
    float mh = mod(n * 5.0, span) + 0.5;
    float alh = streamAngle(S, mh);
    vec4 sth = stream(p, S, mh, fs);
    float phih = dot(p, vec2(cos(alh), sin(alh)));
    float seed = S * 37.0 + m;
    float seedHit = S * 37.0 + 211.0 + n * 3.0;
    float hitGrown = n > 0.5 ? 1.0 - pu * sqrt(pu) : 0.0;
    float hitShare = 0.1 + 0.12 * sw;

    float pageNow = mod(S, 32.0) + 1.0;

    if (PASSINDEX == 0) {
        vec4 prev = IMG_NORM_PIXEL(sheet, uv);
        float inkv = clamp(prev.r, 0.0, 1.0);
        float stamp = prev.g;
        float page = prev.b;
        bool fresh = FRAMEINDEX < 2 || prev.a < 0.5;
        if (fresh) {
            inkv = 0.0;
            stamp = 0.0;
            page = pageNow;
        }
        // Ink from the sheet before stays only ahead of the wiper.
        if (abs(page - pageNow) > 0.5 && !(wiping && wcoord > wiped)) {
            inkv = 0.0;
            stamp = 0.0;
            page = pageNow;
        }

        if (abs(page - pageNow) < 0.5 && onSheet > 0.5) {
            if (fresh) {
                // Starting up: lay the passes this sheet would already hold, whole.
                for (int j = 0; j < MAX_PASSES; j++) {
                    float fj = float(j);
                    if (fj >= m) break;
                    float aj = streamAngle(S, fj);
                    vec2 old = strokes(stream(p, S, fj, fs), dot(p, vec2(cos(aj), sin(aj))), S * 37.0 + fj, 1.0, 2.0, 0.62, gap, len, px);
                    inkv = max(inkv, old.x);
                }
                // The part of this pass already gone by.
                inkv = max(inkv, strokes(st, phi, seed, f, 2.0, 0.62, gap, len, px).x);
            }
            // The pens of this pass: the last stretch behind each tip, laid by the pens that are down.
            inkv = max(inkv, strokes(st, phi, seed, f, 0.2, share, gap, len, px).x);
            // The pens the latest hit lifted and set down again: their strokes are marked as the hit's.
            float hit = strokes(sth, phih, seedHit, hitGrown, 2.0, hitShare, gap, len * 1.5, px).x;
            if (hit > inkv) {
                inkv = hit;
                stamp = n + 1.0;
            }
        }
        gl_FragColor = vec4(inkv, stamp, page, 1.0);
        return;
    }

    vec3 inkC = ink.rgb;
    vec3 accC = accent.rgb;
    vec4 sh = IMG_NORM_PIXEL(sheet, uv);
    float inkv = clamp(sh.r, 0.0, 1.0);
    // Ink from the latest two hits shows in the accent color; older strokes have dried to plain ink.
    float older = mod(n + 63.0, 64.0);
    float hot = (n > 0.5 && sh.g > 0.5 && (abs(sh.g - 1.0 - n) < 0.5 || abs(sh.g - 1.0 - older) < 0.5)) ? 1.0 : 0.0;
    float level = 0.55 + 0.45 * sw;
    vec3 col = mix(inkC * level, accC * (0.85 + 0.6 * pu), hot) * inkv;

    // The pens themselves: a bright point at the tip of every stroke being drawn.
    bool live = abs(sh.b - pageNow) < 0.5 || !wiping || wcoord <= wiped;
    if (live && onSheet > 0.5) {
        float tip = strokes(st, phi, seed, f, 0.2, share, gap, len, px).y;
        float tipHit = strokes(sth, phih, seedHit, hitGrown, 2.0, hitShare, gap, len * 1.5, px).y;
        col += (inkC * 0.6 + vec3(0.7)) * tip * (0.7 + 0.5 * sw) + (accC + vec3(0.6)) * tipHit * 1.2;
    }

    // The sheet's edge, with a scale of small marks along the bottom and a row of boxes
    // on the left that fill as the passes of this sheet go by.
    float hair = max(0.0009, 0.7 * px);
    vec2 dEdge = abs(p) - half2;
    float edge = abs(max(dEdge.x, dEdge.y));
    float frame = (1.0 - smoothstep(0.0, hair, edge)) * step(max(dEdge.x, dEdge.y), hair);
    float inMargin = step(0.0, max(dEdge.x, dEdge.y));
    float tx = p.x / 0.02;
    float tk = floor(tx + 0.5);
    float tall = mod(tk, 5.0) < 0.5 ? 0.014 : 0.007;
    float ticks = (1.0 - smoothstep(0.0, hair, abs(tx - tk) * 0.02)) * step(abs(p.x), half2.x)
                * step(-half2.y - tall - 0.006, p.y) * step(p.y, -half2.y - 0.006);
    float by = (p.y + half2.y) / 0.016;
    float bk = floor(by);
    vec2 bq = vec2(p.x + half2.x + MARGIN * 0.5, (by - bk - 0.5) * 0.016);
    float box = step(abs(bq.x), 0.006) * step(abs(bq.y), 0.0045) * step(0.0, bk) * step(bk, span - 0.5);
    float filled = bk < m ? 0.5 : (bk < m + 0.5 ? 0.25 + 0.75 * f : 0.07);
    col += inkC * (frame * 0.22 + ticks * 0.2 + box * filled * 0.5) * (0.6 + 0.4 * sw);

    // The wiper: a hairline crossing the sheet, with a short wake behind it.
    if (wiping && onSheet > 0.5) {
        float dw = (wcoord - wiped) * 2.0 * wext;
        col += inkC * ((1.0 - smoothstep(0.0, max(0.0012, px), abs(dw))) * 0.9 + 0.06 * exp(dw / 0.05) * step(dw, 0.0));
    }

    // The view falls off a little toward its corners.
    vec2 vg = uv - 0.5;
    col *= 1.0 - 0.3 * dot(vg, vg) * 2.0;

    // Tone map on the brightest channel so the ink keeps its color, then dither against banding.
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.6));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // Only the ink is solid: the black sheet lets what is under it show.
        outa = clamp(max(max(col.r, col.g), col.b) * 1.4, 0.0, 1.0);
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
