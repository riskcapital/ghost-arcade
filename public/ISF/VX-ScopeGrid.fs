/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A wall of small oscilloscopes, one interval of the chord on each screen. Each column puts the root against one note of the chord and each row lifts the root an octave, so the screens fill with Lissajous figures at true frequency ratios: thirds roll slowly, fifths nearly stand still, octaves hold. A screen with no interval rests as a single dot; the newest note's screen is marked and its beam head burns in the accent.",
    "PASSES": [
        {
            "TARGET": "phosphor",
            "PERSISTENT": true,
            "FLOAT": true
        },
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 7, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "columns", "LABEL": "Columns", "TYPE": "float", "DEFAULT": 3, "MIN": 1, "MAX": 4 },
        { "NAME": "rows", "LABEL": "Rows", "TYPE": "float", "DEFAULT": 3, "MIN": 1, "MAX": 4 },
        { "NAME": "persistence", "LABEL": "Persistence", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "beamWidth", "LABEL": "Beam width", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "traceLength", "LABEL": "Trace length", "TYPE": "float", "DEFAULT": 1, "MIN": 0.2, "MAX": 2 },
        { "NAME": "graticule", "LABEL": "Graticule", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "roll", "LABEL": "Roll", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0, "MAX": 1 },
        { "NAME": "screenSize", "LABEL": "Screen size", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "focus", "LABEL": "Focus", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Beam", "TYPE": "color", "DEFAULT": [0.75, 1.0, 0.92, 1.0] },
        { "NAME": "accent", "LABEL": "Newest note", "TYPE": "color", "DEFAULT": [1.0, 0.45, 0.12, 1.0] },
        { "NAME": "vxEnv", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxHit", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPitch", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPhase", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxNote0", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote2", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNote3", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE0", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE1", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE2", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxNoteE3", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// phosphor: r = the beams' afterglow, g = the accent beam head's afterglow.
// Beams are measured in stored pixels, per axis, so a line is never thinner
// than the texel the core really keeps, and no thicker either.
const float TAU = 6.2831853;
// Most beam segments any one screen draws; Newton steps then find the true curve.
const int MAX_SEGS = 240;

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// Stored pixels per frame-height unit, per axis.
vec2 storedScale() {
    vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(1.0));
    return RENDERSIZE.y / fw;
}

// The sounding notes, lowest first. Column i = (MIDI note, energy, weight, unused).
// Notes far quieter than the loudest are let go, so a released chord makes way.
mat4 chordNotes() {
    float emax = max(max(vxNoteE0, vxNoteE1), max(vxNoteE2, vxNoteE3));
    float gate = max(0.002, 0.3 * emax);
    vec2 a = vec2((vxNote0 > 0.0 && vxNoteE0 >= gate) ? floor(vxNote0 * 127.0 + 0.5) : 999.0, vxNoteE0);
    vec2 b = vec2((vxNote1 > 0.0 && vxNoteE1 >= gate) ? floor(vxNote1 * 127.0 + 0.5) : 999.0, vxNoteE1);
    vec2 c = vec2((vxNote2 > 0.0 && vxNoteE2 >= gate) ? floor(vxNote2 * 127.0 + 0.5) : 999.0, vxNoteE2);
    vec2 d = vec2((vxNote3 > 0.0 && vxNoteE3 >= gate) ? floor(vxNote3 * 127.0 + 0.5) : 999.0, vxNoteE3);
    vec2 t;
    if (b.x < a.x) { t = a; a = b; b = t; }
    if (d.x < c.x) { t = c; c = d; d = t; }
    if (c.x < a.x) { t = a; a = c; c = t; }
    if (d.x < b.x) { t = b; b = d; d = t; }
    if (c.x < b.x) { t = b; b = c; c = t; }
    float e = max(emax, 1e-4);
    vec4 n0 = vec4(a.x, a.y, a.x < 998.0 ? smoothstep(0.3, 0.6, a.y / e) : 0.0, 0.0);
    vec4 n1 = vec4(b.x, b.y, b.x < 998.0 ? smoothstep(0.3, 0.6, b.y / e) : 0.0, 0.0);
    vec4 n2 = vec4(c.x, c.y, c.x < 998.0 ? smoothstep(0.3, 0.6, c.y / e) : 0.0, 0.0);
    vec4 n3 = vec4(d.x, d.y, d.x < 998.0 ? smoothstep(0.3, 0.6, d.y / e) : 0.0, 0.0);
    return mat4(n0, n1, n2, n3);
}

// The nearest simple ratio to q (denominator up to 5): x = how far q misses it,
// y = the denominator, which is how many root cycles the figure takes to close.
// An equal-tempered third misses 6:5 or 5:4 by about 1%, which makes it roll.
vec2 nearestRatio(float q) {
    vec2 best = vec2(0.0, 1.0);
    float err = 1e3;
    for (int m = 1; m <= 5; m++) {
        float fm = float(m);
        float pn = floor(q * fm + 0.5);
        float e = abs(q - pn / fm) + fm * 0.0015;
        if (e < err) {
            err = e;
            best = vec2(q - pn / fm, fm);
        }
    }
    return best;
}

vec2 gridDims() {
    return vec2(clamp(floor(columns + 0.5), 1.0, 4.0), clamp(floor(rows + 0.5), 1.0, 4.0));
}

// The cell of one screen, in frame-height units; screens are 10 by 8 divisions.
vec2 cellSize(vec2 dims) {
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float ch = min(0.9 / dims.y, aspect * 0.92 / (dims.x * 1.25));
    return vec2(1.25 * ch, ch);
}

// Squared distance from p to segment ab, and where along it.
vec2 segment(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    vec2 ap = p - a;
    float h = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-12), 0.0, 1.0);
    vec2 d = ap - ab * h;
    return vec2(dot(d, d), h);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    vec2 p = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    vec2 S = storedScale();

    vec2 dims = gridDims();
    vec2 cell = cellSize(dims);
    vec2 g = p / cell + 0.5 * dims;
    vec2 id = floor(g);
    bool inGrid = id.x >= 0.0 && id.y >= 0.0 && id.x < dims.x && id.y < dims.y;
    vec2 local = (g - id - 0.5) * cell;
    vec2 halfScreen = 0.5 * cell * mix(0.66, 0.9, screenSize);
    float div = halfScreen.y / 4.0;
    // Column: which note of the chord meets the root. Row, from the bottom: the root's octave.
    float col = id.x;
    float oct = id.y;

    mat4 ch = chordNotes();
    // The column of the newest note, while it sounds.
    float newest = floor(vxPitch * 127.0 + 0.5);
    float newCol = -1.0;
    for (int i = 3; i >= 0; i--) {
        if (ch[i].z > 0.05 && abs(ch[i].x - newest) < 0.5) newCol = float(i);
    }
    bool isNewest = inGrid && col == newCol && oct == 0.0;

    if (PASSINDEX == 0) {
        float hit2 = vxHit * vxHit;
        float beam = 0.0;
        float head = 0.0;
        if (inGrid) {
            vec4 na = ch[0];
            vec4 nb = col < 0.5 ? ch[0] : (col < 1.5 ? ch[1] : (col < 2.5 ? ch[2] : ch[3]));
            float emax = max(max(vxNoteE0, vxNoteE1), max(vxNoteE2, vxNoteE3));
            float present = na.z * nb.z * smoothstep(0.0, 0.2, emax);
            // Figure radius, in height units, and the ratio of the two oscillators.
            float R = 3.3 * div * present;
            // Each row lifts the root an octave, turning the interval over:
            // a minor third reads 6:5, then 5:3, then 10:3.
            float qn = exp2((nb.x - na.x) / 12.0);
            float qr = exp2(oct);
            float q = present > 0.0 ? max(qn, qr) / min(qn, qr) : 1.0;
            vec2 lp = local * S;
            vec2 RS = R * S;

            float sigma = mix(0.45, 1.25, beamWidth) * (1.0 + 0.4 * hit2);
            float haloR = mix(6.0, 2.0, focus);
            float haloA = mix(0.14, 0.03, focus);
            float reach = max(sigma * 3.5, haloR * 4.0);

            if (RS.y > 0.5 && abs(lp.x) < RS.x + reach && abs(lp.y) < RS.y + reach) {
                vec2 nr = nearestRatio(q);
                // The figure turns slowly; equal-tempered intervals roll against pure ones.
                float seed = col * 0.13 + oct * 0.29;
                float phy = 0.25 + seed + vxPhase * (roll * 0.02 * (1.0 + 0.4 * col) + nr.x * mix(1.5, 10.0, roll));
                // The beam crawls along its own path, so an open trace's ends never sit still.
                float t0 = fract(vxPhase * 0.04 + seed);
                // One closing period of the figure (at most about seven lobes, so a
                // complex ratio shows as an open, crawling figure), times the trace
                // length, plus a little overlap so a closed figure's tail hides under its head.
                float L = min(nr.y, 7.2 / q) * traceLength + 0.12;
                float N = clamp(ceil(L * max(q, 1.0) * 12.0), 24.0, float(MAX_SEGS));
                float dt = L / N;
                vec2 ra = vec2(cos(TAU * t0), sin(TAU * t0));
                vec2 rb = vec2(cos(TAU * (q * t0 + phy)), sin(TAU * (q * t0 + phy)));
                vec2 sa = vec2(cos(TAU * dt), sin(TAU * dt));
                vec2 sb = vec2(cos(TAU * q * dt), sin(TAU * q * dt));
                vec2 prevPt = RS * vec2(ra.y, rb.y);
                float meanSpeed = sqrt(0.5 * (1.0 + q * q));
                float bestScore = 0.0;
                float bestT = 0.0;
                float bestW = 0.0;
                float bestHead = 0.0;
                for (int k = 1; k <= MAX_SEGS; k++) {
                    float fk = float(k);
                    if (fk > N) break;
                    ra = vec2(ra.x * sa.x - ra.y * sa.y, ra.y * sa.x + ra.x * sa.y);
                    rb = vec2(rb.x * sb.x - rb.y * sb.y, rb.y * sb.x + rb.x * sb.y);
                    vec2 pt = RS * vec2(ra.y, rb.y);
                    vec2 sg = segment(lp, prevPt, pt);
                    if (sg.x < reach * reach) {
                        float prof = exp(-0.5 * sg.x / (sigma * sigma)) + haloA * exp(-sqrt(sg.x) / haloR);
                        // The beam burns brighter where it slows, at the turns of the figure.
                        float speed = length(vec2(ra.x, q * rb.x));
                        float dwell = pow(clamp(meanSpeed / (speed + 0.05), 0.5, 3.0), 0.45);
                        float u = (fk - 1.0 + sg.y) / N;
                        // The oldest end of the trace fades like a phosphor tail.
                        float w = dwell * smoothstep(0.0, 0.1 / L + 0.05, u);
                        float score = prof * w;
                        if (score > bestScore) {
                            bestScore = score;
                            bestT = (fk - 1.0 + sg.y) * dt;
                            bestW = w;
                            bestHead = smoothstep(1.0 - 0.07 / L - 0.02, 1.0, u);
                        }
                    }
                    prevPt = pt;
                }
                if (bestScore > 0.0) {
                    // Two Newton steps from the nearest segment onto the true curve.
                    float t = t0 + bestT;
                    for (int it = 0; it < 2; it++) {
                        float a1 = TAU * t;
                        float b1 = TAU * (q * t + phy);
                        vec2 P = RS * vec2(sin(a1), sin(b1));
                        vec2 D1 = RS * TAU * vec2(cos(a1), q * cos(b1));
                        vec2 D2 = -RS * TAU * TAU * vec2(sin(a1), q * q * sin(b1));
                        vec2 e = P - lp;
                        float fp = dot(D1, D1) + dot(e, D2);
                        if (fp > 1e-6) t -= clamp(dot(e, D1) / fp, -dt, dt);
                    }
                    vec2 P = RS * vec2(sin(TAU * t), sin(TAU * (q * t + phy)));
                    float d2 = dot(P - lp, P - lp);
                    float prof = exp(-0.5 * d2 / (sigma * sigma)) + haloA * exp(-sqrt(d2) / haloR);
                    beam = prof * bestW;
                    head = prof * bestHead;
                }
            }
            // A screen with nothing on it holds the beam at rest: one small dot.
            float rest = 1.0 - smoothstep(0.0, 0.25, R / max(div, 1e-4));
            float breathe = 0.55 + 0.15 * sin(vxPhase * 0.9 + col * 1.3 + oct * 2.1);
            vec2 dl = local * S;
            float sd = sigma * 1.5;
            float d2 = dot(dl, dl);
            float spot = (exp(-0.5 * d2 / (sd * sd)) + 0.06 * exp(-sqrt(d2) / (haloR * 1.5))) * breathe * rest;
            beam = max(beam, spot);
        }
        float level = mix(0.55, 1.0, smoothstep(0.0, 0.5, vxEnv)) * (1.0 + 0.4 * hit2);
        vec4 prev = IMG_NORM_PIXEL(phosphor, uv);
        float f60 = clamp(TIMEDELTA, 0.0, 0.1) * 60.0;
        float keep = pow(mix(0.55, 0.95, persistence), f60);
        float glow = max(prev.r * keep - 0.002 * f60, beam * level);
        float headGlow = max(prev.g * keep - 0.002 * f60, isNewest ? head * level : 0.0);
        if (FRAMEINDEX < 2) {
            glow = 0.0;
            headGlow = 0.0;
        }
        gl_FragColor = vec4(max(glow, 0.0), max(headGlow, 0.0), 0.0, 1.0);
        return;
    }

    vec4 ph = IMG_NORM_PIXEL(phosphor, uv);
    float glow = ph.r;
    vec3 col3 = ink.rgb * (1.0 - exp(-glow * 1.7));
    col3 += vec3(0.9, 0.9, 0.85) * max(glow - 1.2, 0.0) * 0.1;
    // The newest screen's beam head burns in the accent.
    float headTone = 1.0 - exp(-ph.g * 2.0);
    col3 = mix(col3, accent.rgb * 1.1, clamp(headTone, 0.0, 1.0));

    if (inGrid) {
        // Graticule: a dot at every division, a ticked centre cross, corner brackets.
        vec2 fw = max(fwidth(gl_FragCoord.xy), vec2(1.0));
        float px = max(fw.x, fw.y) / RENDERSIZE.y;
        vec2 gq = local / div;
        vec2 inScreen = step(abs(local), halfScreen + px);
        float on = inScreen.x * inScreen.y;
        vec2 toDiv = abs(fract(gq + 0.5) - 0.5) * div * S;
        float dots = exp(-dot(toDiv, toDiv) / 0.9);
        vec2 ax = abs(local) * S;
        vec2 toTick = abs(fract(gq * 5.0 + 0.5) - 0.5) * div / 5.0 * S;
        vec2 tickLen = div * 0.08 * S;
        float ticks = max((1.0 - smoothstep(tickLen.y, tickLen.y + 1.0, ax.y)) * (1.0 - smoothstep(0.35, 1.0, toTick.x)),
                          (1.0 - smoothstep(tickLen.x, tickLen.x + 1.0, ax.x)) * (1.0 - smoothstep(0.35, 1.0, toTick.y))) * 0.6;
        float centreCross = max(1.0 - smoothstep(0.35, 1.0, ax.x), 1.0 - smoothstep(0.35, 1.0, ax.y)) * 0.22;
        float grat = max(max(dots, ticks), centreCross) * on;
        // Corner brackets, measured in stored pixels.
        vec2 a = abs(local) * S;
        vec2 hsS = halfScreen * S;
        float arm = div * 0.9 * S.y;
        vec2 cH = segment(a, vec2(hsS.x - arm, hsS.y), hsS);
        vec2 cV = segment(a, vec2(hsS.x, hsS.y - arm), hsS);
        float bracket = 1.0 - smoothstep(0.4, 1.2, sqrt(min(cH.x, cV.x)));
        float level = graticule * (0.36 + 0.1 * vxEnv);
        col3 += ink.rgb * grat * level * 0.75;
        if (isNewest) {
            col3 += accent.rgb * bracket * (0.6 + 0.4 * vxHit) * max(graticule, 0.35);
        } else {
            col3 += ink.rgb * bracket * level * 0.9;
        }
    }

    col3 += (hash21(gl_FragCoord.xy + fract(TIME) * 61.0) - 0.5) / 255.0;
    col3 *= vxPresence;
    gl_FragColor = vec4(max(col3, 0.0), 1.0);
}
