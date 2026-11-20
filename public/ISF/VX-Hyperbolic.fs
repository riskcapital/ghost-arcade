/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "An engraved disc holding a whole curved world: a tiling of many-sided tiles that are all the same size in their own space, so they crowd smaller and smaller toward the rim without ever reaching it. Every tile carries a finer pattern inside it: lines hatched parallel to its edges, arcs fanned round its corners, a small dial at its center. The sound's motion slides the tiling through the disc, tiles streaming in from one side of the rim and out at the other; its level thickens the lines and opens the inner pattern; each hit relights a scatter of tiles in the accent color, and every fourth hit turns the direction of travel. With no sound the disc rests, thinly cut and dim.",
    "PASSES": [
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 6, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "tiling", "LABEL": "Tiling", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0, "MAX": 1 },
        { "NAME": "detail", "LABEL": "Inner detail", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "weight", "LABEL": "Line weight", "TYPE": "float", "DEFAULT": 0.45, "MIN": 0, "MAX": 1 },
        { "NAME": "speed", "LABEL": "Speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Lines", "TYPE": "color", "DEFAULT": [0.86, 0.92, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Relit tiles", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

// How many times a point is folded back toward the middle tile before it is given up as too near the rim.
const int FOLDS = 40;
const float PI = 3.14159265;
// The disc on the screen: its middle, its radius and the width of its bevel, in screen heights.
const vec2 DISC_AT = vec2(0.0, 0.05);
const float DISC_R = 0.43;
const float BEVEL = 0.011;

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

// Points of the disc are complex numbers.
vec2 cmul(vec2 a, vec2 b) {
    return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

vec2 cdiv(vec2 a, vec2 b) {
    return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / max(dot(b, b), 1e-12);
}

float atanh1(float x) {
    return 0.5 * log((1.0 + x) / (1.0 - x));
}

float asinh1(float x) {
    return log(x + sqrt(x * x + 1.0));
}

float acosh1(float x) {
    return log(x + sqrt(max(x * x - 1.0, 0.0)));
}

// An engraved line: d is the distance from its middle and w its half width, both measured in the
// disc's own curved space; h is the size of a pixel there. A line is never drawn thinner than a
// pixel: toward the rim, where it would be, it fades instead.
float cut(float d, float w, float h) {
    float wf = max(w, 0.5 * h);
    return clamp((wf - d) / h + 0.5, 0.0, 1.0) * (w / wf);
}

// A family of evenly spaced lines at d = 1, 2, 3 ... times the gap, as far as reach.
// Where the gap nears a pixel the lines melt into their average tone.
float ruled(float d, float gap, float w, float reach, float h) {
    float x = d / gap;
    float k = floor(x + 0.5);
    float shown = step(0.5, k) * clamp((reach - k * gap) / gap + 0.5, 0.0, 1.0);
    float drawn = cut(abs(x - k) * gap, w, h);
    float tone = clamp(2.0 * w / gap, 0.0, 1.0) * step(gap, d) * clamp((reach - d) / gap, 0.0, 1.0);
    return mix(drawn * shown, tone, smoothstep(0.28, 0.55, h / gap));
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
    // The tiling slides with the sound; a trace of drift keeps it from freezing.
    float flow = vxFlow + TIME * 0.015;

    vec3 inkC = ink.rgb;
    vec3 accC = accent.rgb;

    // Which tiling: tiles of P sides, Q of them meeting at every corner.
    float ti = floor(clamp(tiling, 0.0, 0.999) * 5.0);
    float P = 7.0;
    float Q = 3.0;
    if (ti > 0.5) { P = 5.0; Q = 4.0; }
    if (ti > 1.5) { P = 6.0; Q = 4.0; }
    if (ti > 2.5) { P = 4.0; Q = 5.0; }
    if (ti > 3.5) { P = 8.0; Q = 3.0; }
    float sp = sin(PI / P);
    float cp = cos(PI / P);
    float sq = sin(PI / Q);
    float cq = cos(PI / Q);
    // One edge of the middle tile is an arc of the circle at dC on the x axis with radius rC.
    float den = sqrt(cq * cq - sp * sp);
    float dC = cq / den;
    float rC = sp / den;
    float sect = 2.0 * PI / P;
    // The tile's corner (on the screen disc), and its sizes in its own space:
    // middle to edge, middle to corner, half an edge.
    float V = dC * cp - sqrt(max(dC * dC * cp * cp - 1.0, 0.0));
    float rin = 2.0 * atanh1(dC - rC);
    float Rc = 2.0 * atanh1(V);
    float Lh = acosh1(cp / sq);
    // Sliding this far along the x axis brings the tiling back onto itself.
    float period = 2.0 * rin;
    if (mod(P, 2.0) > 0.5) period = mod(Q, 2.0) > 0.5 ? 2.0 * (rin + Rc + Lh) : 2.0 * (rin + Rc);

    // The disc stands on a dark glossy floor; under the floor line its reflection is drawn.
    float yFloor = DISC_AT.y - DISC_R - BEVEL - 0.006;
    bool below = p.y < yFloor;
    vec2 pe = below ? vec2(p.x, 2.0 * yFloor - p.y) : p;
    vec2 zs = (pe - DISC_AT) / DISC_R;
    float r2 = dot(zs, zs);
    float rs = sqrt(r2);
    // The raking light comes from the upper left; in the reflection it is flipped with everything else.
    vec2 Ld = normalize(vec2(-0.58, below ? -0.81 : 0.81));
    vec2 radial = zs / max(rs, 1e-4);

    vec3 col = vec3(0.0);
    float solid = 0.0;

    if (rs < 1.0 + BEVEL / DISC_R + 2.0 * px / DISC_R) {
        float inDisc = clamp((1.0 - rs) * DISC_R / px + 0.5, 0.0, 1.0);
        // The size of a pixel in the disc's own space: it grows without limit toward the rim.
        float h = 2.0 * (px / DISC_R) / max(1.0 - r2, 1e-4);

        // The plate itself: dark turned metal, with the faint bow-tie sheen of a lathe finish.
        float turn = abs(dot(radial, Ld));
        vec3 plate = vec3(0.007, 0.008, 0.01) + inkC * 0.03 * pow(turn, 10.0) * smoothstep(0.0, 0.6, rs);
        vec3 eng = vec3(0.0);

        if (rs < 0.9995) {
            // Every fourth hit turns the direction of travel, easing round as the hit dies away.
            float grp = floor(n / 4.0);
            float thNow = sect * floor(hash11(grp * 7.7 + 1.3) * P) + 0.4;
            float thWas = sect * floor(hash11((grp - 1.0) * 7.7 + 1.3) * P) + 0.4;
            float dth = thWas - thNow;
            dth -= 2.0 * PI * floor(dth / (2.0 * PI) + 0.5);
            float ease = (n > 0.5 && mod(n, 4.0) < 0.5) ? pu * pu * (3.0 - 2.0 * pu) : 0.0;
            float theta = thNow + dth * ease;

            // Slide the tiling along its axis. Only the part of the slide since the last whole period is
            // carried out; whole periods change nothing but which tile is which.
            float tau = flow * mix(0.08, 0.8, speed);
            float K = floor(tau / period + 0.5);
            float tt = tanh((tau - K * period) * 0.5);
            vec2 er = vec2(cos(theta), -sin(theta));
            vec2 zr = cmul(er, zs);
            vec2 u1 = vec2(1.0, 0.0) + tt * zr;
            vec2 w = cdiv(zr + vec2(tt, 0.0), u1);
            // J keeps track of which way the screen is turned at this point, so that the light
            // can rake across the engraving from one side of the screen.
            vec2 J = cmul(er, normalize(vec2(u1.x * u1.x - u1.y * u1.y, -2.0 * u1.x * u1.y)));

            // Fold the point back into the middle tile: turn it to face the +x edge, and if it lies
            // beyond that edge, mirror it in the edge. A and B record the moves, to tell the tile it came from.
            vec2 A = vec2(1.0, 0.0);
            vec2 B = vec2(0.0, 0.0);
            float flip = 0.0;
            float done = 0.0;
            for (int i = 0; i < FOLDS; i++) {
                float k = floor(atan(w.y, w.x) / sect + 0.5);
                if (k != 0.0) {
                    float ha = -0.5 * k * sect;
                    vec2 eh = vec2(cos(ha), sin(ha));
                    vec2 ef = vec2(eh.x * eh.x - eh.y * eh.y, 2.0 * eh.x * eh.y);
                    w = cmul(ef, w);
                    J = cmul(ef, J);
                    A = cmul(eh, A);
                    B = cmul(eh, B);
                }
                vec2 dd = w - vec2(dC, 0.0);
                float l2 = dot(dd, dd);
                if (l2 >= rC * rC) {
                    done = 1.0;
                    break;
                }
                w = vec2(dC, 0.0) + dd * (rC * rC / l2);
                vec2 cd2 = vec2(dd.x * dd.x - dd.y * dd.y, -2.0 * dd.x * dd.y);
                J = normalize(cmul(vec2(-cd2.x, cd2.y), vec2(J.x, -J.y)));
                vec2 ta = dC * vec2(A.x, -A.y) - B;
                vec2 tb = dC * vec2(B.x, -B.y) - A;
                A = vec2(-ta.y, ta.x);
                B = vec2(-tb.y, tb.x);
                float nr = 1.0 / max(length(A), 1e-9);
                A *= nr;
                B *= nr;
                flip = 1.0 - flip;
            }

            // Where the point sits in its tile, all measured in the tile's own space.
            float e2 = max(1.0 - dot(w, w), 1e-5);
            float ay = abs(w.y);
            // Each tile is 2P triangles, alternately of two kinds, like a pinwheel.
            float kind = abs(flip - (w.y < 0.0 ? 1.0 : 0.0));
            vec2 dd = w - vec2(dC, 0.0);
            float de = asinh1(max(dot(dd, dd) - rC * rC, 0.0) / (rC * e2));
            float rw = length(w);
            float rho = log((1.0 + rw) / max(1.0 - rw, 1e-5));
            float dMid = asinh1(2.0 * ay / e2);
            float dSpoke = asinh1(2.0 * abs(w.x * sp - ay * cp) / e2);
            vec2 wu = vec2(w.x, ay);
            vec2 wv = wu - V * vec2(cp, sp);
            float dv = acosh1(1.0 + 2.0 * dot(wv, wv) / (e2 * (1.0 - V * V)));

            // The neighboring tile's middle lies straight across the edge; its distance draws the arcs
            // of the circle through that tile's corners, which bulges into this one as a lens along the edge.
            vec2 wn = w - vec2(1.0 / dC, 0.0);
            float dN = acosh1(1.0 + 2.0 * dot(wn, wn) / (e2 * (1.0 - 1.0 / (dC * dC))));

            // Which way each family of lines faces on the screen, for the raking light.
            vec2 gE = normalize(dd);
            vec2 gR = w / max(rw, 1e-5);
            vec2 gV = cmul(wv, vec2(1.0, 0.0) - cmul(V * vec2(cp, -sp), wu));
            gV = normalize(vec2(gV.x, w.y < 0.0 ? -gV.y : gV.y));
            vec2 gN = normalize(cmul(wn, vec2(1.0, 0.0) - w / dC));
            vec2 Jc = vec2(J.x, -J.y);
            float litE = flip < 0.5 ? dot(cmul(Jc, gE), Ld) : dot(cmul(J, vec2(gE.x, -gE.y)), Ld);
            float litR = flip < 0.5 ? dot(cmul(Jc, gR), Ld) : dot(cmul(J, vec2(gR.x, -gR.y)), Ld);
            float litV = flip < 0.5 ? dot(cmul(Jc, gV), Ld) : dot(cmul(J, vec2(gV.x, -gV.y)), Ld);
            float litN = flip < 0.5 ? dot(cmul(Jc, gN), Ld) : dot(cmul(J, vec2(gN.x, -gN.y)), Ld);
            vec2 gT = vec2(-gR.y, gR.x);
            float litT = flip < 0.5 ? dot(cmul(Jc, gT), Ld) : dot(cmul(J, vec2(gT.x, -gT.y)), Ld);

            // The tile this point belongs to, named by where its middle lies along and beside the axis of travel.
            vec2 c0 = -cdiv(B, A);
            if (flip > 0.5) c0.y = -c0.y;
            vec2 qb = cdiv(vec2(1.0, 0.0) + c0, vec2(1.0, 0.0) - c0);
            float ub = 0.5 * log(max(dot(qb, qb), 1e-12));
            float vb = atan(qb.y, qb.x);
            float sK = ub / period + 0.31;
            float ku = floor(sK);
            vec2 key = vec2(floor((sK - ku) * period * 40.0 + 0.5) + 131.0 * mod(ku + K, 53.0), floor(vb * 40.0 + 0.5));
            // The tiles the latest hit relit.
            float relit = (n > 0.5 && hash21(key + vec2(n * 3.7, n * 1.3 + 9.0)) < 0.15) ? 1.0 : 0.0;

            // Line weights. The sound's level thickens every line and opens the inner pattern.
            float W = mix(0.5, 1.7, weight) * (0.7 + 0.55 * sw);
            float open = mix(0.3, 1.0, sw);
            float gap = mix(0.07, 0.02, detail);
            float fine = 0.0024 * W;
            float hub = rin * 0.3;
            float inLens = step(dN, Rc);
            float inRound = step(rho, rin) * (1.0 - inLens);
            float corner = step(rin, rho) * (1.0 - inLens);

            // The tile's edge, cut deep: one wall of the groove catches the light, the other is in shade.
            // (Where the groove is thinner than a pixel its two walls average out.)
            float bold = cut(de, 0.0125 * W, h) * (0.6 + 0.4 * litE * clamp(0.025 * W / h, 0.0, 1.0)) * 1.2;
            // Everything finer than the edge.
            float thin = 0.0;
            // The lens along the edge: its arc, and a ruling of lines parallel to the edge inside it.
            thin += cut(abs(dN - Rc), 0.0036 * W, h) * (0.45 + 0.55 * abs(litN)) * 0.8;
            thin += ruled(de, gap * 0.8, fine, (Rc - rin) * (0.35 + 0.65 * open) + gap, h) * inLens * (0.35 + 0.65 * abs(litE)) * 0.6;
            // The circle that just fits inside the tile.
            thin += cut(abs(rho - rin), 0.0034 * W, h) * (1.0 - inLens) * (0.5 + 0.5 * abs(litR)) * 0.85;
            // Between that circle and the corner: arcs fanned round the corner, so that every corner
            // of the tiling carries a rosette.
            thin += ruled(dv, gap * 0.8, fine, Rc, h) * corner * (0.35 + 0.65 * abs(litV)) * 0.6;
            // Inside the circle the tile is a pinwheel: one kind of triangle is ruled with rays from the middle,
            // the other with arcs round it. Both open inward from the circle as the sound rises.
            float reach = (rin - hub) * open;
            float nRays = floor(mix(4.0, 14.0, detail) + 0.5);
            float tr = atan(ay, w.x) / (PI / P) * nRays;
            float dRay = abs(tr - floor(tr + 0.5)) * (PI / P / nRays) * 0.5 * (exp(rho) - exp(-rho));
            float rays = cut(dRay, fine, h) * clamp((rho - (rin - reach)) / gap, 0.0, 1.0) * (0.35 + 0.65 * abs(litT));
            float arcs = ruled(rin - rho, gap, fine, reach, h) * (0.35 + 0.65 * abs(litR));
            thin += mix(rays, arcs, kind) * inRound * step(hub, rho) * 0.6;
            // Hairlines from the middle to each corner and to the middle of each edge.
            thin += (cut(dSpoke, fine, h) + cut(dMid, fine, h) * step(hub, rho)) * (0.3 + 0.4 * abs(litT)) * 0.6;
            // A dial at the middle of the tile: two rings, graduations between them, a hub.
            bold += cut(abs(rho - hub), 0.0045 * W, h) * (0.55 + 0.45 * abs(litR)) * 0.95;
            thin += cut(abs(rho - hub * 0.78), fine, h) * (0.5 + 0.5 * abs(litR)) * 0.6;
            float ta2 = atan(ay, w.x) / (PI / P) * 6.0;
            float dTick = abs(ta2 - floor(ta2 + 0.5)) * (PI / P / 6.0) * 0.5 * (exp(rho) - exp(-rho));
            thin += cut(dTick, fine, h) * step(hub * 0.78, rho) * step(rho, hub) * 0.55;
            thin += cut(abs(rho - hub * 0.3), fine, h) * 0.6 + cut(rho, 0.012 * W, h) * 0.9;
            float outside = step(hub, rho);

            // Toward the rim the tiles shrink without end. First the fine pattern melts into an even tone,
            // then, where a whole tile is only a pixel or two, the edges do as well.
            float melt = smoothstep(0.03, 0.09, h);
            float haze = max(smoothstep(0.08, 0.26, h), 1.0 - done);
            float lines = mix(min(bold, 1.2), 0.1 * W, haze) + mix(min(thin, 1.0), 0.12 * W, max(melt, haze));

            vec3 tint = mix(inkC, accC, relit * (1.0 - haze));
            // The light falls across the plate from the upper left.
            float level = (0.5 + 0.5 * sw) * (0.78 + 0.42 * dot(zs, Ld)) * (1.0 + relit * (0.25 + 0.9 * pu));
            eng = tint * lines * level;
            // A relit tile also glows faintly in its ruled triangles.
            eng += accC * relit * (1.0 - kind) * outside * (0.035 + 0.1 * pu) * (1.0 - haze);
        }

        // A soft light caught just inside the rim, strongest on the side the light comes from.
        float rim = smoothstep(0.86, 1.0, rs) * (0.35 + 0.65 * max(dot(radial, Ld), 0.0));
        vec3 face = plate + eng + inkC * rim * (0.02 + 0.03 * sw);

        // The bevel: a narrow polished ring, bright where it faces the light.
        float facing = dot(radial, Ld);
        vec3 ring = inkC * (0.035 + 0.55 * pow(max(facing, 0.0), 3.0) + 0.1 * pow(max(-facing, 0.0), 2.0));
        ring += inkC * 0.25 * cut(abs(rs - 1.0) * DISC_R, 0.0008, px);
        float outer = clamp((1.0 + BEVEL / DISC_R - rs) * DISC_R / px + 0.5, 0.0, 1.0);
        col = mix(ring, face, inDisc);
        solid = outer;
        col *= outer;
    }

    if (below) {
        // The floor's reflection: fainter, and fading with depth.
        float depth = yFloor - p.y;
        col *= 0.3 * exp(-depth / 0.085);
        solid *= 0.3;
        col += vec3(0.0035, 0.004, 0.005) * exp(-depth / 0.2);
    }

    // The view falls off a little toward its corners.
    vec2 vg = uv - 0.5;
    col *= 1.0 - 0.3 * dot(vg, vg) * 2.0;

    // Tone map on the brightest channel so the lines keep their color, then dither against banding.
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.6));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // The disc is solid; its reflection and the dark round it let what is under them show.
        float lt = clamp(max(max(col.r, col.g), col.b) * 1.4, 0.0, 1.0);
        outa = max(below ? 0.0 : solid, lt);
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
