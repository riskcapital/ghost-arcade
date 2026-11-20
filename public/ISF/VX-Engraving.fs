/*{
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2",
    "CATEGORIES": [
        "Visual Voices",
        "Generator"
    ],
    "DESCRIPTION": "A sculpture turning slowly over a ruled ground, drawn the way a copperplate is cut but reversed, light lines on black: every tone is made of lines that run round the form, swelling where the light falls and thinning to nothing in the shade, with a second and a third set cut across them in the brightest places. The lines stay the same fineness on screen however the form turns, each one tapering out as its neighbors close in. The sound's motion turns the form and the light; its level adds the cross-hatching; each hit cuts a new set of lines across the form in a new direction, drawn in the accent color as they are cut, and every fourth hit re-cuts the form itself: linked rings, a pierced ball, a twisted band, a faceted head.",
    "PASSES": [
        {}
    ],
    "INPUTS": [
        { "NAME": "vxSource", "LABEL": "Follows", "TYPE": "long", "DEFAULT": 7, "VALUES": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "LABELS": ["Everything", "Kick", "Snare and clap", "Hats", "Toms and crash", "Bass", "Lead", "Chords", "Pads and textures", "Shots and siren", "What you play", "Bowls", "Drone", "XY tone", "Analog synth", "Scan synth", "Echo shots", "Build and drop", "Siren", "Acid line", "Dub bass"] },
        { "NAME": "vxAuto", "LABEL": "Comes and goes with its sound", "TYPE": "bool", "DEFAULT": true },
        { "NAME": "vxClear", "LABEL": "Transparent background", "TYPE": "bool", "DEFAULT": false },
        { "NAME": "lines", "LABEL": "Line density", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
        { "NAME": "cross", "LABEL": "Cross-hatch", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0, "MAX": 1 },
        { "NAME": "form", "LABEL": "Form", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0, "MAX": 1 },
        { "NAME": "light", "LABEL": "Light", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0, "MAX": 1 },
        { "NAME": "ink", "LABEL": "Lines", "TYPE": "color", "DEFAULT": [0.86, 0.92, 1.0, 1.0] },
        { "NAME": "accent", "LABEL": "Newly cut lines", "TYPE": "color", "DEFAULT": [1.0, 0.3, 0.12, 1.0] },
        { "NAME": "vxSwell", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxPulse", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1 },
        { "NAME": "vxFlow", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 1000 },
        { "NAME": "vxCount", "TYPE": "float", "DEFAULT": 0, "MIN": 0, "MAX": 64 },
        { "NAME": "vxPresence", "TYPE": "float", "DEFAULT": 1, "MIN": 0, "MAX": 1 }
    ]
}*/

const float FOCAL = 2.3;
// The form stands at the origin; the ground lies a little under it.
const float GROUND = -1.14;
const float BOUND = 1.28;
const int STEPS = 64;
const int SHADOW_STEPS = 24;

// Set once per pixel: the form's turn (its own space to the room's), the form before the latest
// re-cut and the form after it, and how far the one has turned into the other.
mat3 gRot;
float gFormA;
float gFormB;
float gMorph;

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

// Three rings through one another, each in its own plane.
float sdRings(vec3 p) {
    float a = length(vec2(length(p.xy) - 0.74, p.z));
    float b = length(vec2(length(p.yz) - 0.74, p.x));
    float c = length(vec2(length(p.xz) - 0.74, p.y));
    return min(min(a, b), c) - 0.17;
}

// A flat band bent into a ring with three half-twists in it.
float sdBand(vec3 p) {
    float a = atan(p.z, p.x) * 1.5;
    vec2 q = vec2(length(p.xz) - 0.8, p.y);
    q = vec2(cos(a) * q.x - sin(a) * q.y, sin(a) * q.x + cos(a) * q.y);
    vec2 d = abs(q) - vec2(0.2, 0.045);
    return (length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - 0.02) * 0.7;
}

// A head roughed out in flat planes: crown, brow, face, cheeks, temples, jaw, chin and the back of the skull.
float sdHead(vec3 p0) {
    vec3 p = p0 / 0.86;
    vec3 q = vec3(abs(p.x), p.y, p.z);
    float d = q.y - 0.96;
    d = max(d, dot(q, vec3(0.0, 0.5523, 0.8336)) - 0.82);
    d = max(d, dot(q, vec3(0.0, -0.0995, 0.995)) - 0.6);
    d = max(d, dot(q, vec3(0.7498, -0.05, 0.6598)) - 0.64);
    d = max(d, dot(q, vec3(0.9196, 0.3798, 0.1)) - 0.6);
    d = max(d, dot(q, vec3(0.5970, -0.6965, 0.3980)) - 0.7);
    d = max(d, dot(q, vec3(0.0, -0.8985, 0.4392)) - 0.84);
    d = max(d, dot(q, vec3(0.3008, 0.2005, -0.9324)) - 0.76);
    d = max(d, dot(q, vec3(0.3497, -0.5995, -0.7194)) - 0.8);
    d = max(d, dot(q, vec3(0.5552, 0.8076, -0.2019)) - 0.88);
    // The sockets of the eyes, cut back under the brow.
    d = max(d, 0.2 - length(q - vec3(0.27, 0.16, 0.66)));
    return d * 0.86;
}

// A ball pierced through and through by a winding surface.
float sdPierced(vec3 p) {
    float s = 5.0;
    float g = dot(sin(p * s), cos(p.zxy * s)) / s;
    return max(length(p) - 0.98, abs(g) - 0.04) * 0.75;
}

float sdForm(vec3 p, float k) {
    if (k < 0.5) return sdRings(p);
    if (k < 1.5) return sdPierced(p);
    if (k < 2.5) return sdBand(p);
    return sdHead(p);
}

float map(vec3 pw) {
    vec3 p = pw * gRot;
    float d = sdForm(p, gFormB);
    if (gMorph < 0.999) d = mix(sdForm(p, gFormA), d, gMorph);
    return d;
}

vec3 mapNormal(vec3 p) {
    vec2 k = vec2(1.0, -1.0);
    float e = 0.0015;
    return normalize(k.xyy * map(p + k.xyy * e) + k.yyx * map(p + k.yyx * e)
                   + k.yxy * map(p + k.yxy * e) + k.xxx * map(p + k.xxx * e));
}

// How much of the light reaches a point past the form.
float shadow(vec3 p, vec3 L, float k) {
    // Only the part of the ray inside the ball that holds the form can be blocked.
    float b = dot(p, L);
    float c = dot(p, p) - BOUND * BOUND;
    float h = b * b - c;
    if (h < 0.0) return 1.0;
    h = sqrt(h);
    float t = max(-b - h, 0.02);
    float tEnd = -b + h;
    float res = 1.0;
    for (int i = 0; i < SHADOW_STEPS; i++) {
        if (t > tEnd) break;
        float d = map(p + L * t);
        res = min(res, k * d / t);
        if (res < 0.01) break;
        t += clamp(d, 0.012, 0.25);
    }
    return clamp(res, 0.0, 1.0);
}

// One set of engraved lines. c is the line coordinate and gs how fast it changes per pixel; lines are kept
// between gap and twice gap pixels apart by dropping every other one as they crowd, each dropped line
// tapering away while its neighbors swell to hold the tone. weight is how much of the surface the lines cover.
float engrave(float c, float gs, float gap, float weight) {
    float lod = log2(max(gs * gap, 1e-5));
    float period = exp2(ceil(lod));
    float sp = period / max(gs, 1e-6);
    float oddW = smoothstep(1.0, 1.65, sp / gap);
    float wide = weight * 2.0 * sp / (1.0 + oddW);
    float ph = c / period;
    float i0 = floor(ph + 0.5);
    float odd = mod(i0, 2.0);
    float half0 = 0.5 * wide * (odd > 0.5 ? oddW : 1.0);
    float cov = min(clamp(half0 - abs(ph - i0) * sp + 0.5, 0.0, 1.0), 2.0 * half0);
    // A heavy line next door may reach this far too.
    float i1 = 2.0 * floor(ph * 0.5 + 0.5);
    cov = max(cov, min(clamp(0.5 * wide - abs(ph - i1) * sp + 0.5, 0.0, 1.0), wide));
    return cov;
}

// How fast a line coordinate with gradient grad changes from pixel to pixel, on a surface with normal n
// met by the ray rd at distance t. rdx and rdy are the rays through the pixels to the right and above.
float pixelRate(vec3 grad, vec3 n, vec3 rd, vec3 rdx, vec3 rdy, float t) {
    float nd = dot(n, rd);
    float ax = dot(n, rdx);
    float ay = dot(n, rdy);
    ax = abs(ax) < 0.03 ? -0.03 : ax;
    ay = abs(ay) < 0.03 ? -0.03 : ay;
    vec3 dx = rdx * (t * nd / ax) - rd * t;
    vec3 dy = rdy * (t * nd / ay) - rd * t;
    return length(vec2(dot(grad, dx), dot(grad, dy)));
}

// A direction to cut lines in, different for every hit.
vec3 cutAxis(float m) {
    float a = hash11(m * 7.31 + 1.7) * 6.2832;
    float z = hash11(m * 3.17 + 5.3) * 1.4 - 0.7;
    float r = sqrt(1.0 - z * z);
    return vec3(r * cos(a), z, r * sin(a));
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float asp = RENDERSIZE.x / RENDERSIZE.y;
    vec2 sp = vec2((uv.x - 0.5) * asp, uv.y - 0.5);
    // The picture may be stored coarser than its nominal size: a pixel is never taken as finer than a stored one.
    vec2 fw = fwidth(gl_FragCoord.xy);
    float coarse = max(1.0, max(fw.x, fw.y));
    float px = coarse / RENDERSIZE.y;

    float sw = clamp(vxSwell, 0.0, 1.0);
    float pu = clamp(vxPulse, 0.0, 1.0);
    float n = floor(vxCount + 0.5);
    float flow = vxFlow + TIME * 0.03;

    // The form turns on its stand and nods a little as it goes.
    float ry = flow * 0.33;
    float rx = 0.32 * sin(flow * 0.13) + 0.2;
    mat3 my = mat3(cos(ry), 0.0, -sin(ry), 0.0, 1.0, 0.0, sin(ry), 0.0, cos(ry));
    mat3 mx = mat3(1.0, 0.0, 0.0, 0.0, cos(rx), sin(rx), 0.0, -sin(rx), cos(rx));
    gRot = my * mx;

    // Every fourth hit re-cuts the form; it turns from the old one into the new as the hit dies away.
    float base = floor(form * 3.999);
    gFormB = mod(base + floor(n / 4.0), 4.0);
    gFormA = mod(base + floor(max(n - 1.0, 0.0) / 4.0), 4.0);
    gMorph = gFormA == gFormB ? 1.0 : smoothstep(0.0, 1.0, 1.0 - pu);

    vec3 ro = vec3(0.0, 0.5, 5.3);
    vec3 fwd = normalize(vec3(0.0, -0.16, 0.0) - ro);
    vec3 rgt = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 upv = cross(rgt, fwd);
    vec3 rd = normalize(sp.x * rgt + sp.y * upv + FOCAL * fwd);
    vec3 rdx = normalize((sp.x + px) * rgt + sp.y * upv + FOCAL * fwd);
    vec3 rdy = normalize(sp.x * rgt + (sp.y + px) * upv + FOCAL * fwd);

    // The light stands high to one side and moves round as the form turns.
    float az = 0.75 + light * 3.1416 + 0.5 * sin(flow * 0.09);
    vec3 L = normalize(vec3(cos(az) * 0.82, 0.78, sin(az) * 0.82));

    // Pixels between lines: finer with the density control, and the same share of the picture at any size.
    // Never closer than three stored pixels, or they could not be told apart.
    float gap = max(mix(9.0, 4.2, lines) * RENDERSIZE.y / 1080.0 / coarse, 3.0);
    vec3 inkC = ink.rgb;
    vec3 accC = accent.rgb;

    // March to the form, inside the ball that holds it; keep how near a ray that missed came to its edge.
    float hitT = -1.0;
    float nearPx = 1e3;
    float bq = dot(ro, rd);
    float cq = dot(ro, ro) - BOUND * BOUND;
    float hq = bq * bq - cq;
    if (hq > 0.0) {
        hq = sqrt(hq);
        float t = -bq - hq;
        float tEnd = -bq + hq;
        for (int i = 0; i < STEPS; i++) {
            float d = map(ro + rd * t);
            float r = d * FOCAL / (px * t);
            if (r < 0.25) { hitT = t; break; }
            nearPx = min(nearPx, r);
            t += d * 0.9;
            if (t > tEnd) break;
        }
    }

    float cover = 0.0;
    float hot = 0.0;
    float solid = 0.0;

    if (hitT > 0.0) {
        vec3 p = ro + rd * hitT;
        vec3 nor = mapNormal(p);
        vec3 po = p * gRot;
        // Tone: the light and its shadow, a touch of light off the ground from below, a small bright point.
        float diff = max(dot(nor, L), 0.0);
        float sh = diff > 0.001 ? shadow(p + nor * 0.012, L, 9.0) : 0.0;
        float occ = clamp(0.5 + 0.5 * map(p + nor * 0.12) / 0.12, 0.0, 1.0);
        float spec = pow(max(dot(reflect(-L, nor), -rd), 0.0), 20.0);
        float tone = diff * sh * 0.95 + 0.12 * max(-nor.y, 0.0) * occ + 0.05 * occ + 0.5 * spec * sh;
        tone = clamp(tone, 0.0, 1.0);

        // The first set of lines runs round the form, cut square to an axis of its own.
        vec3 a1 = cutAxis(floor(n / 4.0) * 4.0 + 100.0);
        float g1 = pixelRate(gRot * a1, nor, rd, rdx, rdy, hitT);
        float c1 = engrave(dot(po, a1) * 40.0, g1 * 40.0, gap, 0.72 * smoothstep(0.0, 0.75, tone));
        // The second is cut across it in a direction the latest hit chose, and only where there is light to carry.
        vec3 a2 = normalize(cross(a1, cutAxis(n)) + 0.001);
        float g2 = pixelRate(gRot * a2, nor, rd, rdx, rdy, hitT);
        float second = clamp(cross * (0.35 + 1.3 * sw), 0.0, 1.0);
        // While the hit lasts the new lines are cut one after another across the form.
        float cutAt = mix(-1.25, 1.25, 1.0 - pu * pu);
        float along = dot(po, a2);
        float cut = n > 0.5 ? smoothstep(cutAt + 0.02, cutAt - 0.02, along) : 1.0;
        float c2 = engrave(along * 40.0, g2 * 40.0, gap * 1.15, 0.6 * smoothstep(0.35, 1.0, tone) * second) * cut;
        // The third, finer and steeper, only in the brightest places and only when the sound is strong.
        vec3 a3 = normalize(cross(a1, a2) + a1 * 0.6);
        float g3 = pixelRate(gRot * a3, nor, rd, rdx, rdy, hitT);
        float third = clamp(cross * (2.2 * sw - 0.7), 0.0, 1.0);
        float c3 = engrave(dot(po, a3) * 40.0, g3 * 40.0, gap * 0.85, 0.6 * smoothstep(0.62, 1.0, tone) * third);

        cover = 1.0 - (1.0 - c1) * (1.0 - c2) * (1.0 - c3);
        // The lines the hit is cutting show in the accent color, brightest at the cutting edge.
        float edge = exp(-max(cutAt - along, 0.0) / 0.22);
        hot = n > 0.5 ? c2 * clamp(pu * 1.2 * (0.35 + 0.9 * edge) + 0.12, 0.0, 1.0) : 0.0;
        solid = 1.0;
    } else {
        // The ground: ruled lines running across, lit in a pool round the form and dark in its shadow.
        float tg = rd.y < -1e-4 ? (GROUND - ro.y) / rd.y : -1.0;
        if (tg > 0.0) {
            vec3 p = ro + rd * tg;
            float pool = exp(-dot(p.xz, p.xz) / 5.0) * smoothstep(-8.0, -1.0, p.z);
            float sh = shadow(p + vec3(0.0, 0.01, 0.0), L, 7.0);
            // Close under the form the ground is shut in.
            float under = smoothstep(0.0, 1.1, length(p.xz));
            float tone = pool * (0.06 + 0.94 * sh) * (0.4 + 0.6 * under) * L.y * 0.7;
            vec3 up = vec3(0.0, 1.0, 0.0);
            float g1 = pixelRate(vec3(0.0, 0.0, 1.0), up, rd, rdx, rdy, tg);
            float c1 = engrave(p.z * 24.0, g1 * 24.0, gap * 1.1, 0.8 * smoothstep(0.0, 0.75, tone));
            float g2 = pixelRate(vec3(1.0, 0.0, 0.0), up, rd, rdx, rdy, tg);
            float second = clamp(cross * (0.2 + 1.2 * sw), 0.0, 1.0);
            float c2 = engrave(p.x * 24.0, g2 * 24.0, gap * 1.4, 0.5 * smoothstep(0.5, 1.0, tone) * second);
            cover = 1.0 - (1.0 - c1) * (1.0 - c2);
        }
        // A hairline round the form where it stands against the dark.
        float outline = 1.0 - smoothstep(0.4, 1.5, nearPx);
        cover = max(cover, 0.6 * outline);
    }

    float level = 0.5 + 0.5 * sw;
    vec3 col = vec3(0.004, 0.0045, 0.006) + mix(inkC, accC, clamp(hot / max(cover, 1e-3), 0.0, 1.0)) * cover * (level + 0.5 * hot);

    // A fine ruled border, as a plate is trimmed.
    vec2 fr = abs(sp) - vec2(0.5 * asp - 0.035, 0.465);
    float frame = max(fr.x, fr.y);
    col += inkC * 0.3 * level * clamp(1.0 - abs(frame) / px, 0.0, 1.0);
    col *= step(frame, 0.5 * px) * 0.999 + 0.001;

    // Tone map on the brightest channel so the lines keep their color, then dither against banding.
    float lum = max(max(col.r, col.g), col.b);
    col = col / max(lum, 1e-4) * (1.0 - exp(-lum * 1.6));
    col += (hash21(gl_FragCoord.xy + fract(TIME) * 91.7) - 0.5) / 255.0;
    col = max(col, 0.0);

    vec3 outc = col;
    float outa = 1.0;
    if (vxClear) {
        // Only the lines are solid: the black between them lets what is under it show.
        outa = clamp(max(max(col.r, col.g), col.b) * 1.5, 0.0, 1.0);
        outc = min(col, vec3(outa));
    }
    gl_FragColor = vec4(outc, outa) * vxPresence;
}
