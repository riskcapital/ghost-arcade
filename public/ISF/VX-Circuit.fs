/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A dense black circuit board seen close and from an angle: buses of parallel traces that turn through 45 degree bends and run on from cell to cell until they end at the pins of a chip, a field of vias or a row of pads, over a hatched ground plane and a dimmer second layer underneath, with white printed reference codes and outlines. The copper stands a little proud of the board and catches a raking light. Small bright signals leave the chips and run along the traces; the sound's motion drives them and its level sets how many nets are live. Each hit sets a chip down at a new place, so the buses round it re-route, and fires a burst out of it along its traces in the accent color.",
    "PASSES": [
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 6, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "density", "LABEL": "Density", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0, "MAX": 1 },
        { "NAME": "bus", "LABEL": "Bus width", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "rate", "LABEL": "Signal rate", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "zoom", "LABEL": "Zoom", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Copper and signals", "TYPE": "color", "DEFAULT": [0.86, 0.92, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Burst from the hit", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// The board is a grid of square cells, one unit on a side. A bus crosses the middle of every cell edge:
// its lanes are LAM apart and a trace is 2 * TW wide.
const float LAM = 0.05;
const float TW = 0.0135;
const float T22 = 0.41421356;
const float R2 = 0.70710678;
const float FOCAL = 1.6;
// How many cells back a signal's path is followed to find the part it came from.
const int MAX_TRACE = 6;

// Set once per pixel, before anything is drawn: lanes in a bus, half a bus's width, how often buses end
// in a part, how often four cells make one large chip, how often buses run straight on, and the cells
// where the last four hits set a chip down.
float gLanes;
float gDelta;
float gTerm;
float gBig;
float gStraight;
vec2 gHit0;
vec2 gHit1;
vec2 gHit2;
vec2 gHit3;

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

bool hitCell(vec2 c) {
    return c == gHit0 || c == gHit1 || c == gHit2 || c == gHit3;
}

// What a cell holds: 0 the two buses turn through it, 1 they run straight on and cross, 2 they end
// in a part, 3 the cell is a quarter of a large chip that takes up four cells.
float tileKind(vec2 c) {
    if (hitCell(c)) return 2.0;
    vec2 blk = floor(c * 0.5);
    // One large chip always sits by the middle of the view.
    if (blk == vec2(0.0)) return 3.0;
    if (hash21(blk + vec2(31.7, 5.3)) < gBig && blk != floor(gHit0 * 0.5) && blk != floor(gHit1 * 0.5)
        && blk != floor(gHit2 * 0.5) && blk != floor(gHit3 * 0.5)) return 3.0;
    float h = hash21(c + vec2(7.1, 13.3));
    if (h < gTerm) return 2.0;
    return h < gTerm + (1.0 - gTerm) * gStraight ? 1.0 : 0.0;
}

// Signals cross every cell edge one way only: rightward along even rows and leftward along odd ones,
// upward along even columns and downward along odd ones. So each cell takes signals in through two
// edges and lets them out through the other two (0 west, 1 east, 2 south, 3 north).
bool inEdge(vec2 c, int e) {
    bool rowEven = mod(c.y, 2.0) < 0.5;
    bool colEven = mod(c.x, 2.0) < 0.5;
    return e == 0 ? rowEven : (e == 1 ? !rowEven : (e == 2 ? colEven : !colEven));
}

// The corner one of a cell's two buses turns round (the other turns round the opposite corner):
// the way the signals run fixes which pair of corners it is.
vec2 turnCorner(vec2 c) {
    return mod(c.x, 2.0) == mod(c.y, 2.0) ? vec2(0.0, 1.0) : vec2(1.0, 1.0);
}

// In a cell where the buses cross, is the level bus the one that stays on the top layer.
bool levelOnTop(vec2 c) {
    return hash21(c + vec2(4.4, 9.9)) < 0.5;
}

// How far from the middle of a crossing a lane of the bus that dips under goes down its via.
float dipAt(float lane) {
    return gDelta + 0.05 + 0.045 * mod(lane, 2.0);
}

// The body of the part in a cell where buses end: (center, half its size), in the cell's own coordinates.
vec3 partBody(vec2 c, float kind) {
    if (kind > 2.5) {
        vec2 m = mod(c, 2.0);
        return vec3(1.0 - m.x, 1.0 - m.y, 0.5 + gDelta + 0.075);
    }
    return vec3(0.5, 0.5, gDelta + 0.075);
}

// The part itself: 0 a chip, 1 a field of vias round a can, 2 two rows of square pads.
float partSort(vec2 c, float kind) {
    if (kind > 2.5 || hitCell(c)) return 0.0;
    float h = hash21(c + vec2(91.3, 47.7));
    return h < 0.5 ? 0.0 : (h < 0.8 ? 1.0 : 2.0);
}

// The lane of a bus nearest a place across it (0.5 is the middle of the bus): (where the lane runs, its number).
vec2 laneAt(float r) {
    float i = clamp(floor((r - 0.5) / LAM + (gLanes - 1.0) * 0.5 + 0.5), 0.0, gLanes - 1.0);
    return vec2(0.5 + (i - (gLanes - 1.0) * 0.5) * LAM, i);
}

// Distance from a cell corner measured the way the traces turn round it: straight, 45 degrees, straight.
float oct(vec2 q) {
    return max(max(q.x, q.y), (q.x + q.y) * R2);
}

// A cell seen from one of its four edges (0 west, 1 east, 2 south, 3 north): x runs in from the edge, y along it.
vec2 fromEdge(vec2 p, int e) {
    return e == 0 ? p : (e == 1 ? vec2(1.0 - p.x, p.y) : (e == 2 ? p.yx : vec2(1.0 - p.y, p.x)));
}

// How far in from an edge the part's body starts.
float bodyFrom(vec3 body, int e) {
    return e == 0 ? body.x - body.z : (e == 1 ? 1.0 - body.x - body.z : (e == 2 ? body.y - body.z : 1.0 - body.y - body.z));
}

// The copper of the top layer near a point: (distance to any copper, to bare metal, to a drilled hole,
// to a trace on the layer underneath).
vec4 topCopper(vec2 b) {
    vec2 c = floor(b);
    vec2 p = b - c;
    float kind = tileKind(c);
    float dCu = 1e3;
    float dMetal = 1e3;
    float dHole = 1e3;
    float dUnder = 1e3;
    if (kind < 0.5) {
        // Two buses turn round opposite corners of the cell.
        vec2 ka = turnCorner(c);
        float r1 = oct(abs(p - ka));
        float r2 = oct(abs(p - (1.0 - ka)));
        dCu = min(abs(r1 - laneAt(r1).x), abs(r2 - laneAt(r2).x)) - TW;
    } else if (kind < 1.5) {
        // The buses cross: one runs straight through, the other dips to the layer underneath through
        // a row of vias on each side.
        vec2 pp = levelOnTop(c) ? p : p.yx;
        dCu = abs(pp.y - laneAt(pp.y).x) - TW;
        vec2 ln = laneAt(pp.x);
        float off = abs(pp.x - ln.x);
        float dip = dipAt(ln.y);
        float ay = abs(pp.y - 0.5);
        dCu = min(dCu, max(off - TW, dip - ay));
        dUnder = max(off - TW, ay - dip);
        vec2 vq = vec2(off, ay - dip);
        dMetal = length(vq) - 0.0195;
        dHole = length(vq) - 0.0085;
    } else {
        // Four buses run straight in and end: at the pins of a chip, or each lane at its own via or pad.
        vec3 body = partBody(c, kind);
        float sort = partSort(c, kind);
        for (int e = 0; e < 4; e++) {
            float xb = bodyFrom(body, e);
            if (xb < 0.03) continue;
            vec2 pe = fromEdge(p, e);
            vec2 ln = laneAt(pe.y);
            float off = abs(pe.y - ln.x);
            if (sort < 0.5) {
                dCu = min(dCu, max(off - TW, pe.x - (xb - 0.02)));
                vec2 pd = abs(vec2(pe.x - (xb - 0.024), off)) - vec2(0.03, LAM * 0.29);
                dMetal = min(dMetal, max(pd.x, pd.y));
            } else {
                float len = 0.11 + 0.075 * mod(ln.y, 2.0);
                dCu = min(dCu, max(off - TW, pe.x - len));
                vec2 vq = vec2(pe.x - len, off);
                dMetal = min(dMetal, sort < 1.5 ? length(vq) - 0.0195 : max(abs(vq.x), abs(vq.y)) - 0.0185);
                dHole = min(dHole, length(vq) - 0.0085);
            }
        }
    }
    // Where four cells meet there is room clear of the buses for a small feature.
    vec2 v = floor(b + 0.5);
    vec2 o = b - v;
    float hv = hash21(v + vec2(3.3, 8.8));
    if (hv < 0.13) {
        // A plated mounting hole.
        float r = length(o);
        dMetal = min(dMetal, abs(r - 0.098) - 0.024);
        dHole = min(dHole, r - 0.076);
    } else if (hv < 0.33) {
        // Four vias in a square.
        vec2 q = abs(o) - 0.046;
        dMetal = min(dMetal, length(q) - 0.0195);
        dHole = min(dHole, length(q) - 0.0085);
    } else if (hv < 0.62) {
        // The four pads of two small parts side by side.
        vec2 oo = fract(hv * 57.0) < 0.5 ? o : o.yx;
        vec2 q = abs(vec2(abs(oo.x) - 0.052, abs(oo.y) - 0.033)) - vec2(0.021, 0.013);
        dMetal = min(dMetal, max(q.x, q.y));
    } else if (hv < 0.72) {
        // A bare dot for the placing machine to sight on.
        dMetal = min(dMetal, length(o) - 0.028);
    }
    return vec4(min(dCu, dMetal), dMetal, dHole, dUnder);
}

// The dimmer copper of the layer underneath: wide traces on their own grid.
float bottomCopper(vec2 b) {
    vec2 c = floor(b);
    vec2 p = b - c;
    vec2 ka = hash21(c + vec2(55.5, 2.2)) < 0.5 ? vec2(0.0, 1.0) : vec2(1.0, 1.0);
    float r1 = oct(abs(p - ka)) - 0.5;
    float r2 = oct(abs(p - (1.0 - ka))) - 0.5;
    float d1 = abs(r1 - clamp(floor(r1 / 0.1 + 0.5), -2.0, 2.0) * 0.1);
    float d2 = abs(r2 - clamp(floor(r2 / 0.1 + 0.5), -2.0, 2.0) * 0.1);
    return min(d1, d2) - 0.027;
}

// A line or an edge at distance d, half-width w, seen through a pixel that covers fp of the board.
float lineCov(float d, float w, float fp) {
    return min(clamp((w - abs(d)) / fp + 0.5, 0.0, 1.0), 2.0 * w / fp + 0.03);
}

// The 3 x 5 dot letters the board is printed with. 0-9 the figures, then U R C Q J L D T X A.
float glyphBits(float g) {
    if (g < 0.5) return 31599.0;
    if (g < 1.5) return 11415.0;
    if (g < 2.5) return 29671.0;
    if (g < 3.5) return 29647.0;
    if (g < 4.5) return 23497.0;
    if (g < 5.5) return 31183.0;
    if (g < 6.5) return 31215.0;
    if (g < 7.5) return 29257.0;
    if (g < 8.5) return 31727.0;
    if (g < 9.5) return 31695.0;
    if (g < 10.5) return 23407.0;
    if (g < 11.5) return 27565.0;
    if (g < 12.5) return 31015.0;
    if (g < 13.5) return 31609.0;
    if (g < 14.5) return 4719.0;
    if (g < 15.5) return 18727.0;
    if (g < 16.5) return 27502.0;
    if (g < 17.5) return 29842.0;
    if (g < 18.5) return 23213.0;
    return 11245.0;
}

// A short line of print. q is measured in dots from the line's lower left; each character is 3 dots wide
// and 5 tall with one dot between. lead is the first character, the rest are figures from the seed.
float printLine(vec2 q, float chars, float lead, float seed, float fpDots) {
    if (q.x < 0.0 || q.y < 0.0 || q.y >= 5.0 || q.x >= chars * 4.0 - 1.0) return 0.0;
    float ci = floor(q.x / 4.0);
    float col = floor(q.x - ci * 4.0);
    if (col > 2.5) return 0.0;
    float row = 4.0 - floor(q.y);
    float g = ci < 0.5 && lead >= 0.0 ? lead : floor(hash11(seed + ci * 7.7) * 9.999);
    float bits = glyphBits(g);
    float div = row < 0.5 ? 4096.0 : (row < 1.5 ? 512.0 : (row < 2.5 ? 64.0 : (row < 3.5 ? 8.0 : 1.0)));
    float rowBits = mod(floor(bits / div), 8.0);
    float on = mod(floor(rowBits / (col < 0.5 ? 4.0 : (col < 1.5 ? 2.0 : 1.0))), 2.0);
    // Far off the dots are smaller than a pixel: the line settles to a gray bar.
    return mix(on, 0.5, smoothstep(0.6, 1.6, fpDots));
}

// Parts and print over the copper: (how much a part's body covers the point, the body's shade,
// how much white print covers the point, 1 where the body is the top of a metal can).
vec4 partsAt(vec2 b, float fp, vec2 lb) {
    vec2 c = floor(b);
    vec2 p = b - c;
    float kind = tileKind(c);
    float cover = 0.0;
    float shade = 0.0;
    float print = 0.0;
    float can = 0.0;
    float cs = hash21(c + vec2(19.1, 77.7));

    if (kind > 1.5) {
        vec3 body = partBody(c, kind);
        float sort = partSort(c, kind);
        vec2 u = p - body.xy;
        if (sort < 0.5) {
            // A chip: a black molded body with a bevel, a dimple at pin one and two lines of laser marking.
            float half = body.z - 0.006;
            float dB = max(abs(u.x), abs(u.y)) - half;
            cover = clamp(0.5 - dB / fp, 0.0, 1.0);
            vec2 outw = abs(u.x) > abs(u.y) ? vec2(sign(u.x), 0.0) : vec2(0.0, sign(u.y));
            float bevel = smoothstep(-0.016, -0.006, dB);
            shade = 0.02 + 0.006 * hash21(floor(b * 900.0)) * smoothstep(0.004, 0.001, fp);
            shade += bevel * (0.012 + 0.07 * max(dot(outw, lb), 0.0));
            float ds = body.z * 1.15 / 19.0;
            vec2 t1 = (u - vec2(-9.5 * ds, 0.8 * ds)) / ds;
            vec2 t2 = (u - vec2(-7.5 * ds, -5.6 * ds)) / ds;
            float mark = printLine(t1, 5.0, 10.0 + floor(cs * 9.99), cs * 91.0, fp / ds)
                       + printLine(t2, 4.0, -1.0, cs * 37.0 + 5.0, fp / ds);
            shade += 0.075 * mark;
            float dimple = length(u - vec2(-0.72, 0.72) * half) - 0.09 * half;
            shade += 0.03 * lineCov(dimple, 0.004, fp);
            // Print outside the body: brackets at its corners, a dot at pin one, and the part's reference.
            float lshape = max(abs(max(abs(u.x), abs(u.y)) - (body.z + 0.036)) - 0.0035,
                               body.z - 0.035 - min(abs(u.x), abs(u.y)));
            print = max(print, clamp(0.5 - lshape / fp, 0.0, 1.0));
            print = max(print, clamp(0.5 - (length(u - vec2(-body.z - 0.036, body.z + 0.036) * vec2(1.0, 1.0)) - 0.012) / fp, 0.0, 1.0));
            if (kind < 2.5) {
                vec2 tq = (p - vec2(0.135, 0.5 + gDelta + 0.045)) / 0.0085;
                print = max(print, printLine(tq, 3.0, 10.0, cs * 53.0, fp / 0.0085));
            }
        } else if (sort < 1.5) {
            // A round metal can in the middle of the via field, in a printed circle.
            float r = length(u);
            float dC = r - 0.15;
            cover = clamp(0.5 - dC / fp, 0.0, 1.0);
            can = 1.0;
            float rim = smoothstep(-0.02, -0.004, dC);
            float ang = atan(u.y, u.x);
            shade = 0.1 + 0.14 * pow(abs(cos(ang - atan(lb.y, lb.x))), 6.0) * smoothstep(0.02, 0.1, r);
            shade = mix(shade, 0.05 + 0.3 * max(dot(u / max(r, 1e-4), lb), 0.0), rim);
            shade *= 1.0 - 0.6 * lineCov(u.x * lb.y - u.y * lb.x, 0.012, fp) * step(r, 0.11);
            print = max(print, lineCov(r - 0.185, 0.0035, fp));
        } else {
            // A header: a printed box round the pad rows with its reference inside.
            float dBox = max(abs(u.x), abs(u.y)) - 0.16;
            print = max(print, lineCov(dBox, 0.0035, fp));
            vec2 tq = (u - vec2(-0.063, -0.021)) / 0.0085;
            print = max(print, printLine(tq, 4.0, 14.0, cs * 71.0, fp / 0.0085));
            print = max(print, lineCov(length(u - vec2(-0.12, 0.12)) - 0.012, 0.004, fp));
        }
    }

    // The small features where four cells meet.
    vec2 v = floor(b + 0.5);
    vec2 o = b - v;
    float hv = hash21(v + vec2(3.3, 8.8));
    float vs = hash21(v + vec2(61.0, 23.0));
    if (hv < 0.13) {
        print = max(print, lineCov(length(o) - 0.145, 0.003, fp));
    } else if (hv >= 0.33 && hv < 0.62) {
        // The bodies of the two small parts, and their reference printed beside them.
        vec2 oo = fract(hv * 57.0) < 0.5 ? o : o.yx;
        vec2 q = abs(vec2(abs(oo.x) - 0.052, oo.y)) - vec2(0.017, 0.022);
        float dP = max(q.x, q.y);
        float pc = clamp(0.5 - dP / fp, 0.0, 1.0);
        if (pc > cover) {
            cover = pc;
            shade = oo.x > 0.0 ? 0.022 : 0.05 + 0.03 * smoothstep(-0.02, 0.02, oo.y);
            can = 0.0;
        }
        vec2 tq = (o - vec2(-0.047, 0.085)) / 0.008;
        print = max(print, printLine(tq, 3.0, vs < 0.5 ? 11.0 : 12.0, vs * 43.0, fp / 0.008));
    } else if (hv >= 0.62 && hv < 0.72) {
        print = max(print, lineCov(length(o) - 0.07, 0.003, fp));
    } else if (hv >= 0.72 && hv < 0.9) {
        // Nothing fitted: only a reference, or a row of printed ticks.
        vec2 tq = (o - vec2(-0.06, -0.02)) / 0.008;
        if (vs < 0.6) print = max(print, printLine(tq, 4.0, 17.0, vs * 29.0, fp / 0.008));
        else print = max(print, lineCov(abs(fract(o.x / 0.02) - 0.5) * 0.02, 0.003, fp) * step(abs(o.y), 0.02) * step(abs(o.x), 0.09));
    }
    return vec4(cover, shade, print * (1.0 - cover), can);
}

// The signal light at a point of the board: (plain light, accent light).
vec2 signals(vec2 b, float fp, float T, float n) {
    vec2 c = floor(b);
    vec2 p = b - c;
    float kind = tileKind(c);
    float d = 1e3;
    // How far through this cell the signal is (0 to 1), which way the cell it came from lies,
    // where on the shared edge its lane crosses, and whether it starts in this very cell.
    float sigma = 0.0;
    vec2 ed = vec2(0.0);
    float pos = 0.0;
    float own = 0.0;
    vec2 src = c;
    float key = 0.0;

    if (kind < 0.5) {
        vec2 ka = turnCorner(c);
        vec2 q1 = abs(p - ka);
        vec2 q2 = abs(p - (1.0 - ka));
        float r1 = oct(q1);
        float r2 = oct(q2);
        float a1 = laneAt(r1).x;
        float a2 = laneAt(r2).x;
        vec2 K = ka;
        vec2 q = q1;
        float r = r1;
        float a = a1;
        if (abs(r2 - a2) < abs(r1 - a1)) {
            K = 1.0 - ka;
            q = q2;
            r = r2;
            a = a2;
        }
        d = abs(r - a);
        // How far along the lane the point is, from the lane's end on the upright edge through the corner.
        float tot = a * (2.0 * T22 + 1.41421356 * (1.0 - T22));
        float s = r * T22 + ((q.x - r * T22) + (r - q.y)) * R2;
        if (q.x < r * T22) s = q.x;
        else if (q.y < r * T22) s = tot - q.y;
        if (inEdge(c, K.x < 0.5 ? 0 : 1)) {
            sigma = clamp(s / tot, 0.0, 1.0);
            ed = vec2(K.x < 0.5 ? -1.0 : 1.0, 0.0);
            pos = K.y + (K.y < 0.5 ? a : -a);
        } else {
            sigma = clamp(1.0 - s / tot, 0.0, 1.0);
            ed = vec2(0.0, K.y < 0.5 ? -1.0 : 1.0);
            pos = K.x + (K.x < 0.5 ? a : -a);
        }
    } else if (kind < 1.5) {
        bool lv = levelOnTop(c);
        vec2 pp = lv ? p : p.yx;
        vec2 l1 = laneAt(pp.y);
        vec2 l2 = laneAt(pp.x);
        float d1 = abs(pp.y - l1.x);
        float d2 = abs(pp.x - l2.x);
        // Under the bus that stays on top the dipping lane is out of sight, and only the top one counts.
        bool through = d1 < d2 || abs(pp.y - 0.5) < dipAt(l2.y);
        // Which of the two is the level bus, the one along x on the board.
        bool level = through ? lv : !lv;
        if (through) {
            d = d1;
            pos = l1.x;
        } else {
            d = d2;
            pos = l2.x;
        }
        if (level) {
            bool inW = inEdge(c, 0);
            sigma = inW ? p.x : 1.0 - p.x;
            ed = vec2(inW ? -1.0 : 1.0, 0.0);
        } else {
            bool inS = inEdge(c, 2);
            sigma = inS ? p.y : 1.0 - p.y;
            ed = vec2(0.0, inS ? -1.0 : 1.0);
        }
    } else {
        vec3 body = partBody(c, kind);
        float sort = partSort(c, kind);
        for (int e = 0; e < 4; e++) {
            float xb = bodyFrom(body, e);
            if (xb < 0.03) continue;
            vec2 pe = fromEdge(p, e);
            vec2 ln = laneAt(pe.y);
            float len = sort < 0.5 ? xb - 0.02 : 0.11 + 0.075 * mod(ln.y, 2.0);
            float de = max(abs(pe.y - ln.x), pe.x - len);
            if (de < d) {
                d = de;
                vec2 dir = e == 0 ? vec2(-1.0, 0.0) : (e == 1 ? vec2(1.0, 0.0) : (e == 2 ? vec2(0.0, -1.0) : vec2(0.0, 1.0)));
                float along = clamp(pe.x / len, 0.0, 1.0);
                pos = ln.x;
                if (inEdge(c, e)) {
                    own = 0.0;
                    sigma = 0.5 * along;
                    ed = dir;
                } else {
                    own = 1.0;
                    sigma = 0.5 * (1.0 - along);
                    key = pos * 97.0 + dir.x * 3.1 + dir.y * 7.3;
                }
            }
        }
    }
    if (d > 0.07) return vec2(0.0);

    // Follow the lane back from cell to cell, round each turn, until it reaches the part that drives it.
    float found = own;
    float hops = 0.0;
    if (own < 0.5) {
        vec2 cc = c;
        for (int k = 0; k < MAX_TRACE; k++) {
            vec2 c2 = cc + ed;
            float k2 = tileKind(c2);
            if (k2 > 1.5) {
                src = c2;
                found = 1.0;
                key = pos * 97.0 - ed.x * 3.1 - ed.y * 7.3;
                break;
            }
            cc = c2;
            hops += 1.0;
            // Through a crossing the lane runs straight on.
            if (k2 > 0.5) continue;
            bool nwse = turnCorner(c2).x < 0.5;
            vec2 K;
            if (abs(ed.x) > 0.5) {
                K.x = ed.x < 0.0 ? 1.0 : 0.0;
                K.y = nwse ? 1.0 - K.x : K.x;
                float a = abs(pos - K.y);
                ed = vec2(0.0, K.y < 0.5 ? -1.0 : 1.0);
                pos = K.x + (K.x < 0.5 ? a : -a);
            } else {
                K.y = ed.y < 0.0 ? 1.0 : 0.0;
                K.x = nwse ? 1.0 - K.y : K.y;
                float a = abs(pos - K.x);
                ed = vec2(K.x < 0.5 ? -1.0 : 1.0, 0.0);
                pos = K.y + (K.y < 0.5 ? a : -a);
            }
        }
    }
    if (found < 0.5) return vec2(0.0);

    // How far the point is from its part, in cells of travel.
    float D = own > 0.5 ? sigma : 0.5 + hops + sigma;
    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);
    float net = hash21(src * vec2(1.0, 1.7) + vec2(key, key * 0.37));
    // Each net answers to every fourth hit, so a hit switches a quarter of them on or off.
    float turn = floor((n + floor(net * 4.0)) / 4.0);
    float live = step(hash11(net * 61.0 + turn * 7.3), 0.12 + 0.7 * sw);

    float core = clamp((TW - d) / fp + 0.5, 0.0, 1.0);
    float halo = exp(-d / 0.022);
    float plain = 0.0;
    float hot = 0.0;

    // Packets leave the part at the net's own beat and run down the lane, head first.
    float per = 0.9 + 2.2 * fract(net * 17.0);
    float ph = (T - D) / per + fract(net * 5.0);
    float pk = floor(ph);
    float u = fract(ph) * per / 0.2;
    float sent = step(hash11(net * 31.0 + pk * 3.7), mix(0.35, 0.9, rate));
    float packet = live * sent * exp(-3.0 * u) * step(u, 1.6);
    plain += packet * (core * 2.6 + halo * 0.8);
    // A live net glows faintly along its whole length.
    plain += live * core * 0.16;

    // The burst from the chip the latest hit set down: a front running out along every lane, a train of
    // packets behind it, and the lanes it has passed left glowing.
    if (n > 0.5 && src == gHit0) {
        float front = (1.0 - pu) * 7.5;
        float behind = front - D;
        if (behind > 0.0) {
            float train = exp(-behind * 1.1) * (0.45 + 0.55 * step(fract(behind / 0.3), 0.45));
            hot += (core * 2.4 + halo * 0.7) * train * (0.4 + 0.9 * pu);
            hot += core * 0.22;
        } else {
            hot += core * 0.05;
        }
    }
    return vec2(plain, hot);
}

// Where hit m set its chip down.
vec2 hitPlace(float m, float n, float spread) {
    if (n - m < 0.5) return vec2(9999.0);
    float k = n - m;
    vec2 cell = floor((vec2(hash11(k * 3.7 + 1.1), hash11(k * 9.1 + 4.7)) - 0.5) * vec2(4.6, 3.0) * spread);
    // Not on top of the large chip by the middle of the view.
    if (cell.x > -0.5 && cell.x < 1.5 && cell.y > -0.5 && cell.y < 1.5) cell.x += cell.y > 0.5 ? 2.0 : -2.0;
    return cell;
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 sp = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
    // The picture may be stored coarser than its nominal size: a pixel is never taken as finer than a stored one.
    vec2 fw = fwidth(gl_FragCoord.xy);
    float px = max(1.0, max(fw.x, fw.y)) / RENDERSIZE.y;

    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);
    float n = floor(vxCount + 0.5);
    float flow = vxFlow + TIME * 0.02;

    // The camera hangs over the board, looking down at an angle, and swings slowly round the middle of it.
    float dist = mix(9.5, 3.6, zoom);
    float orbit = 0.52 + 0.3 * sin(flow * 0.05 + 1.0);
    float tilt = 0.64 + 0.07 * sin(flow * 0.071);
    vec3 ro = dist * vec3(sin(tilt) * sin(orbit), -sin(tilt) * cos(orbit), cos(tilt));
    vec3 fwd = normalize(-ro);
    vec3 rgt = normalize(cross(fwd, vec3(0.0, 0.0, 1.0)));
    vec3 upv = cross(rgt, fwd);
    vec3 rd = normalize(sp.x * rgt + sp.y * upv + FOCAL * fwd);
    vec3 rdx = normalize((sp.x + px) * rgt + sp.y * upv + FOCAL * fwd);
    vec3 rdy = normalize(sp.x * rgt + (sp.y + px) * upv + FOCAL * fwd);
    float t = -ro.z / rd.z;
    vec2 off = vec2(0.37, 0.21);
    vec2 b = (ro + rd * t).xy + off;
    vec2 bx = (ro - rdx * ro.z / rdx.z).xy + off;
    vec2 by = (ro - rdy * ro.z / rdy.z).xy + off;
    // What one pixel covers of the board; a little more away from the plane of focus, as a lens close up would give.
    float fp = max(length(bx - b), length(by - b));
    fp *= 1.0 + 0.7 * abs(t - dist) / dist;

    gLanes = floor(mix(3.0, 9.0, bus) + 0.5);
    gDelta = (gLanes - 1.0) * 0.5 * LAM;
    gTerm = mix(0.2, 0.44, density);
    gBig = mix(0.03, 0.12, density);
    gStraight = 0.55;
    float spread = dist / 5.5;
    gHit0 = hitPlace(0.0, n, spread);
    gHit1 = hitPlace(1.0, n, spread);
    gHit2 = hitPlace(2.0, n, spread);
    gHit3 = hitPlace(3.0, n, spread);

    vec3 inkC = ink.rgb;
    vec3 accC = accent.rgb;

    // A low raking light, and a wide soft light whose reflection lies across the board.
    float la = 2.3 + 0.35 * sin(flow * 0.043);
    vec3 Lw = normalize(vec3(cos(la), sin(la), 0.42));
    vec2 lb = normalize(Lw.xy);

    vec4 cu = topCopper(b);
    float e = max(0.8 * fp, 0.002);
    vec2 g = vec2(topCopper(b + vec2(e, 0.0)).x - cu.x, topCopper(b + vec2(0.0, e)).x - cu.x) / e;
    g /= max(length(g), 1.0);
    float covCu = clamp(0.5 - cu.x / fp, 0.0, 1.0);
    float covMetal = clamp(0.5 - cu.y / fp, 0.0, 1.0);
    float covHole = clamp(0.5 - cu.z / fp, 0.0, 1.0);
    vec4 parts = partsAt(b, fp, lb);
    float dBot = bottomCopper(b * 0.8 + vec2(3.37, 1.71)) / 0.8;

    // The board: black mask over the weave of the laminate, the lower copper showing through as a darker shape.
    float weave = sin(b.x * 520.0) * sin(b.y * 520.0) * smoothstep(0.006, 0.0015, fp);
    vec3 col = vec3(0.011, 0.012, 0.0145) * (1.0 + 0.3 * weave);
    col += inkC * 0.02 * smoothstep(0.01 + 2.0 * fp, -0.01, min(dBot, cu.w));

    // The ground plane: a fine cross-hatch of copper everywhere that is clear of the traces.
    // It is poured in blocks, and some blocks are left bare.
    float poured = step(0.28, hash21(floor((b + 0.5) / 3.0) + vec2(12.0, 71.0)));
    float clear = smoothstep(0.03, 0.03 + fp, cu.x) * poured;
    float h1 = abs(fract((b.x + b.y) / 0.032) - 0.5) * 0.032 * R2;
    float h2 = abs(fract((b.x - b.y) / 0.032) - 0.5) * 0.032 * R2;
    float hatch = max(lineCov(h1, 0.0034, fp), lineCov(h2, 0.0034, fp));
    col += inkC * 0.045 * hatch * clear;

    // The traces: copper under the mask, lit along the edge that faces the light and shaded along the other.
    float rim = exp(-pow(cu.x / max(0.0045, 0.8 * fp), 2.0));
    float facing = dot(g, lb);
    col = mix(col, inkC * 0.075, covCu);
    col += inkC * 0.34 * rim * max(facing, 0.0);
    col *= 1.0 - 0.55 * rim * max(-facing, 0.0);

    // Bare metal: pads, pins and the rings of the vias.
    float brushed = 0.5 + 0.5 * sin(b.x * 37.0 + b.y * 91.0 + 6.0 * hash21(floor(b * 8.0)));
    vec3 metal = inkC * (0.3 + 0.16 * brushed) + vec3(1.0) * 0.5 * rim * max(facing, 0.0);
    metal *= 1.0 - 0.5 * rim * max(-facing, 0.0);
    col = mix(col, metal, covMetal);
    col = mix(col, vec3(0.0015), covHole);

    // White print, then the parts standing on the board.
    col = mix(col, vec3(0.42, 0.43, 0.44), parts.z * 0.9);
    vec3 bodyC = parts.w > 0.5 ? inkC * parts.y : vec3(parts.y);
    col = mix(col, bodyC, parts.x);

    // The gloss of the mask: the soft light's reflection, broken where the copper lifts the surface.
    vec3 nrm = normalize(vec3(g * rim * 0.5 * (1.0 - parts.x), 1.0));
    vec3 refl = reflect(rd, nrm);
    vec3 soft = normalize(vec3(-sin(orbit) * 0.75 + 0.2, cos(orbit) * 0.75, 0.62));
    float gl = max(dot(refl, soft), 0.0);
    float gloss = 0.05 * pow(gl, 5.0) + 0.3 * pow(gl, 90.0);
    col += inkC * gloss * (1.0 - 0.6 * covMetal) * (0.5 + 0.5 * sw);

    // The signals.
    float T = flow * mix(0.6, 2.4, rate);
    vec2 sg = signals(b, fp, T, n) * (1.0 - parts.x);
    col += (inkC * 0.75 + vec3(0.25)) * sg.x + (accC + vec3(0.2) * sg.y) * sg.y;
    // The chip the latest hit set down flashes at its edge.
    if (n > 0.5) {
        vec2 hu = abs(b - gHit0 - 0.5);
        float dOut = max(hu.x, hu.y) - (gDelta + 0.075);
        col += accC * pu * (0.6 * lineCov(dOut - 0.01, 0.006, fp) + 0.12 * exp(-max(dOut, 0.0) / 0.12) * step(0.0, dOut));
    }

    // The board dims away from the middle of the view, and the view falls off toward its corners.
    col *= 1.0 - 0.3 * smoothstep(0.8, 2.0, t / dist);
    vec2 vg = uv - 0.5;
    col *= 1.0 - 0.45 * dot(vg, vg) * 2.0;

    // Tone map on the brightest channel so the signals keep their color, then dither against banding.
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.6));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // Only the light is solid: the dark board lets what is under it show.
        outa = clamp(max(max(col.r, col.g), col.b) * 1.6, 0.0, 1.0);
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
